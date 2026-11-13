// `anymcp-bridge --stdio`, for real: the CLI is spawned as a separate process and driven over stdin/stdout by the
// official MCP SDK client, the way Claude Desktop or Cursor would. A FakeExtension stands in for the browser.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { makeDraftNoteTool, makeFindOrderTool } from "anymcp-fixture/tools";
import type { ResultEnvelope } from "anymcp-protocol";
import { startBridge, type BridgeHandle } from "../src/bridge";
import { FakeExtension, okEnvelope, pairedExtension, sleep } from "./helpers";

const ROOT = resolve(import.meta.dirname, "../../..");
const CLI = resolve(ROOT, "packages/bridge/src/cli.ts");

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

async function stdioClient(home: string, mcpPort: number, extPort: number): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", CLI, "--stdio", `--home=${home}`, `--mcp-port=${mcpPort}`, `--ext-port=${extPort}`],
    cwd: ROOT,
    env: getDefaultEnvironment(),
    stderr: "pipe", // human-readable logs; stdout must carry ONLY protocol messages
  });
  const client = new Client({ name: "stdio-test-app", version: "0.0.0" });
  await client.connect(transport);
  cleanups.push(() => client.close().catch(() => undefined));
  return { client, transport };
}

async function listNames(c: Client): Promise<string[]> {
  return (await c.listTools()).tools.map((t) => t.name).sort();
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`condition not met in ${ms} ms: ${JSON.stringify(v)}`);
    await sleep(200);
  }
}

describe("pairing code for a bridge running in the background", () => {
  it("is published only by the bridge that owns the ports, removed once paired, and gone when it stops", async () => {
    const home = mkdtempSync(join(tmpdir(), "anymcp-pairfile-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const file = join(home, "pairing.json");
    const read = () => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { code: string; expiresAt: string }) : null);
    const mcpPort = await freePort();
    const extPort = await freePort();

    const bridge = await startBridge({ mcpPort, extPort, home });
    cleanups.push(() => bridge.close());
    expect(read()?.code).toBe(bridge.pairingCode());
    expect(Date.parse(read()!.expiresAt)).toBeGreaterThan(Date.now());

    // a second start on the same ports fails AND leaves the real code alone (regression)
    await expect(startBridge({ mcpPort, extPort, home })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(read()?.code).toBe(bridge.pairingCode());

    const ext = await pairedExtension(bridge);
    await waitFor(async () => read(), (v) => v === null);
    ext.close();
    await bridge.close();
    expect(read()).toBeNull();
  });
});

describe("anymcp-bridge --stdio", () => {
  it("forwards to a running bridge: same tools, same results, tool changes appear, the app's name is shown", async () => {
    const home = mkdtempSync(join(tmpdir(), "anymcp-stdio-"));
    const bridge = await startBridge({ mcpPort: await freePort(), extPort: await freePort(), home, reconnectGraceMs: 300, cancelWaitMs: 300 });
    cleanups.push(async () => {
      await bridge.close();
      rmSync(home, { recursive: true, force: true });
    });
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);

    const { client } = await stdioClient(home, bridge.mcpPort, bridge.extPort);
    expect(await listNames(client)).toEqual(["anymcp_get_run", "anymcp_status", "find_order"]);
    const find = (await client.listTools()).tools.find((t) => t.name === "find_order")!;
    expect(find.annotations?.readOnlyHint).toBe(true);
    expect(find.outputSchema).toBeTruthy();

    const pending = client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } });
    const req = await ext.waitFor("run.request");
    expect(req.args).toEqual({ order_id: "A-1042" });
    ext.send({ type: "run.result", envelope: okEnvelope(req.executionId, { id: "find_order", version: 1 }, { found: true, order_id: "A-1042", customer: "Test Customer 42", status: "Shipped", total: 128.4, placed: "2026-10-03" }) });
    const res = await pending;
    expect(res.isError).toBeFalsy();
    const env = res.structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("success");
    expect(env.executionId).toBe(req.executionId);
    // the side panel shows WHICH app called, not "the forwarder"
    expect(bridge.hub.lastClientName).toBe("stdio-test-app (via stdio)");

    // invalid arguments are refused before the extension is contacted
    const bad = await client.callTool({ name: "find_order", arguments: { order_id: "XYZ" } });
    expect(bad.isError).toBe(true);
    await sleep(100);
    expect(ext.inbox.filter((m) => m.type === "run.request")).toHaveLength(0); // (the first request was consumed above)

    // a tool enabled later shows up without restarting the app
    await ext.syncTools([makeFindOrderTool(), makeDraftNoteTool()]);
    expect(await waitFor(() => listNames(client), (n) => n.includes("draft_customer_note"))).toContain("draft_customer_note");
    // ...and a disabled one disappears
    await ext.syncTools([makeDraftNoteTool()]);
    expect(await waitFor(() => listNames(client), (n) => !n.includes("find_order"))).toEqual(["anymcp_get_run", "anymcp_status", "draft_customer_note"]);

    // status explains the connection without revealing secrets
    const st = await client.callTool({ name: "anymcp_status", arguments: {} });
    expect(st.structuredContent).toEqual({ extension: "connected", enabledTools: 1, bridgeVersion: expect.any(String) });
    expect(JSON.stringify(st)).not.toContain(bridge.token());
    expect(JSON.stringify(st)).not.toContain(bridge.pairingCode());
  }, 60_000);

  it("becomes the bridge when none runs, takes over when the one it forwarded to stops, and exits when the app closes", async () => {
    const home = mkdtempSync(join(tmpdir(), "anymcp-stdio-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const mcpPort = await freePort();
    const extPort = await freePort();

    // a bridge started in a terminal, paired with the browser
    let bridge: BridgeHandle | null = await startBridge({ mcpPort, extPort, home });
    cleanups.push(async () => void (await bridge?.close()));
    const ext = await pairedExtension(bridge);
    ext.close();

    const { client } = await stdioClient(home, mcpPort, extPort);
    expect((await client.callTool({ name: "anymcp_status", arguments: {} })).structuredContent).toMatchObject({ extension: "paired_not_connected" });

    // the terminal bridge is closed: the stdio process takes over the ports and keeps answering
    await bridge.close();
    bridge = null;
    const st = await client.callTool({ name: "anymcp_status", arguments: {} });
    expect(st.isError).toBeFalsy();
    expect(st.structuredContent).toMatchObject({ extension: "paired_not_connected" });

    // the browser reconnects to the new owner with its existing pairing
    const again = new FakeExtension({ extUrl: `ws://127.0.0.1:${extPort}/ext` } as BridgeHandle);
    await again.open();
    await again.auth(ext.secret);
    await again.syncTools([makeFindOrderTool()]);
    expect(await waitFor(() => listNames(client), (n) => n.includes("find_order"))).toContain("find_order");
    again.close();

    // the app quits: the process exits and frees the ports for the next bridge
    await client.close();
    const next = await waitFor(
      async () => startBridge({ mcpPort, extPort, home }).catch(() => null),
      (b) => b !== null,
      10_000,
    );
    await next!.close();
  }, 60_000);
});
