// Permission enforcement is implemented in code, not in prompts or MCP annotations.
// Each test attacks a boundary and checks that the code (not good manners) stops it.

import { expect, test } from "@playwright/test";
import { toolDefinitionHash, type ToolDefinition } from "mycp-protocol";
import { startFixture } from "mycp-fixture";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let s: Stack;
test.afterEach(async () => {
  await s?.close();
});

const waitTools = async (n: number) => {
  const d = Date.now() + 8000;
  while (s.bridge.hub.listTools().length !== n && Date.now() < d) await sleep(50);
};

test("a tool whose site the user has NOT allowed is refused by the extension, even though the bridge lists it", async () => {
  s = await startStack({ tools: [] });
  const port = new URL(s.fixture.origin).port;
  const origin = `http://localhost:${port}`; // a different origin; we do not grant it
  const def: ToolDefinition = { ...s.find, id: "find_order_other_site", origins: [origin] };
  await s.call({ type: "__test.setup", definitions: [def], origins: [] }); // enabled, but NO grant
  await waitTools(1);
  const c = await s.mcp();
  const env = await s.run(c, "find_order_other_site", { order_id: "A-1012" });
  expect(env.status).toBe("denied");
  expect(env.reasonCode).toBe("origin_not_allowed");
  expect(s.fixture.state.requestLog.filter((r) => r.path === "/orders")).toHaveLength(0); // the browser never went there
  await c.close();
});

test("a page that redirects to another origin mid-run is stopped; MyCP does not act on the other site", async () => {
  s = await startStack();
  const other = await startFixture({ port: 0, control: true }); // a second, reachable site on a different origin
  try {
    await s.chaos({ redirectTo: `${other.origin}/orders` });
    const c = await s.mcp();
    const env = await s.run(c, "find_order", { order_id: "A-1012" });
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("wrong_origin");
    expect(other.state.requestLog.filter((r) => r.path.startsWith("/api/"))).toHaveLength(0); // nothing was done on the other site
    await c.close();
  } finally {
    await other.close();
  }
});

test("a stored tool that was tampered with (definition changed, hash unchanged) is refused", async () => {
  s = await startStack();
  await s.panel.evaluate(async () => {
    const { tools } = (await chrome.storage.local.get("tools")) as { tools: Record<string, { definition: { origins: string[] } }[]> };
    tools.find_order![0]!.definition.origins.push("https://evil.example"); // hash NOT updated
    await chrome.storage.local.set({ tools });
  });
  const st = await s.call({ type: "__test.state" });
  expect(st.ok).toBe(true);
  const c = await s.mcp();
  const env = await s.run(c, "find_order", { order_id: "A-1012" });
  expect(env.status).toBe("denied");
  expect(env.message).toMatch(/integrity/i);
  await c.close();
});

test("a stored WRITE tool edited to skip approval is refused by policy even with a recomputed hash", async () => {
  s = await startStack();
  const evil = { ...s.draft, approval: { ...s.draft.approval, required: false } } as ToolDefinition;
  const hash = await toolDefinitionHash(evil);
  await s.panel.evaluate(
    async ({ def, h }) => {
      const { tools } = (await chrome.storage.local.get("tools")) as { tools: Record<string, { definition: unknown; definitionHash: string }[]> };
      tools.draft_customer_note![0]!.definition = def;
      tools.draft_customer_note![0]!.definitionHash = h;
      await chrome.storage.local.set({ tools });
    },
    { def: evil, h: hash },
  );
  // the bridge still advertises the OLD manifest hash, so this also exercises "tool changed since sync"
  const c = await s.mcp();
  const env = await s.run(c, "draft_customer_note", { order_id: "A-1012", note: "should never be written" });
  expect(["denied"]).toContain(env.status);
  expect(s.fixture.state.writeLog).toHaveLength(0);
  expect(s.fixture.state.requestLog.filter((r) => r.method === "POST")).toHaveLength(0);
  await c.close();
});

test("disabling a tool removes it from the AI client immediately", async () => {
  s = await startStack();
  const c = await s.mcp();
  expect((await c.listTools()).tools.map((t) => t.name)).toContain("find_order");
  await s.call({ type: "tool.disable", id: "find_order" });
  const d = Date.now() + 5000;
  while (s.bridge.hub.getTool("find_order") && Date.now() < d) await sleep(50);
  expect((await c.listTools()).tools.map((t) => t.name)).not.toContain("find_order");
  const res = await c.callTool({ name: "find_order", arguments: { order_id: "A-1012" } }).catch((e) => ({ isError: true, e }));
  expect((res as { isError?: boolean }).isError).toBe(true);
  await c.close();
});

test("removing an allowed site disables every tool for that site", async () => {
  s = await startStack();
  expect((await s.call({ type: "origin.revoke", origin: s.fixture.origin })).ok).toBe(true);
  await waitTools(0);
  const st = await s.state();
  expect(st.grants).toHaveLength(0);
  expect(st.tools.every((t) => t.enabledVersion === null)).toBe(true);
});

test("disconnecting the AI client rotates its token: the old token stops working, pairing is kept", async () => {
  s = await startStack();
  const old = s.bridge.token();
  const r = await s.call<{ mcpUrl: string; token: string }>({ type: "client.disconnect" });
  expect(r.ok).toBe(true);
  expect(s.bridge.token()).not.toBe(old);
  await expect(s.mcp(old)).rejects.toBeTruthy();
  const c = await s.mcp();
  expect((await c.listTools()).tools.length).toBeGreaterThan(0);
  await c.close();
  expect((await s.state()).conn.state).toBe("connected");
});

test("revoke everything: tools off, sites removed, pairing gone, AI client locked out", async () => {
  s = await startStack();
  const old = s.bridge.token();
  expect((await s.call({ type: "revoke.all" })).ok).toBe(true);
  await waitForState(s, (st) => st.conn.state === "unpaired");
  const st = await s.state();
  expect(st.grants).toHaveLength(0);
  expect(st.tools.every((t) => t.enabledVersion === null)).toBe(true);
  expect(s.bridge.store.state.extension).toBeNull();
  expect(s.bridge.token()).not.toBe(old);
  await expect(s.mcp(old)).rejects.toBeTruthy();
});

test("local history deletion removes run records from storage", async () => {
  s = await startStack();
  const c = await s.mcp();
  await s.run(c, "find_order", { order_id: "A-1012" });
  expect((await s.state()).runs.length).toBeGreaterThan(0);
  await s.call({ type: "history.clear" });
  expect((await s.state()).runs).toHaveLength(0);
  const local = await s.panel.evaluate(async () => (await chrome.storage.local.get("runs")).runs);
  expect(local).toEqual([]);
  await c.close();
});
