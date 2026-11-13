// Reviewable tool creation, for real: a person records a workflow on the fixture, picks outputs and a
// success check, turns the typed value into a parameter, reviews the derived summary, tests, enables,
// and an MCP client uses the result. Plus: sensitive fields are never recorded or stored.

import { expect, test, type Page } from "@playwright/test";
import { deriveReviewSummary } from "mycp-protocol";
import { buildDraft, type DraftSpec } from "../packages/extension/src/shared/draft";
import type { TabCandidate } from "../packages/extension/src/shared/panel-api";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack({ tools: [] }); // paired, origin allowed, no tools yet
});
test.afterAll(async () => {
  await s?.close();
});

async function openTab(path: string): Promise<{ page: Page; tabId: number }> {
  const page = await s.context.newPage();
  await page.goto(`${s.fixture.origin}${path}`);
  const r = await s.call<TabCandidate[]>({ type: "tabs.candidates" });
  const tab = (r.ok ? (r.data ?? []) : []).find((t) => t.url === page.url());
  if (!tab) throw new Error("tab not found among candidates");
  expect(tab.allowed).toBe(true);
  return { page, tabId: tab.tabId };
}

test("recording never captures password, token, card or data-mycp-ignore fields — and none of it is stored", async () => {
  const { page, tabId } = await openTab("/account");
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);

  const type = async (label: string, text: string) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Tab"); // blur => change event
  };
  await type("Display name", "Alice Example");
  await type("Password", "hunter2-SECRET");
  await type("API token", "tok_live_abc123SECRET");
  await type("Card number", "4111111111111111");
  await type("Internal reference", "internal-xyz-PRIVATE");

  const st = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 1 && (x.recording?.skippedSensitive ?? 0) >= 4);
  const labels = st.recording!.steps.map((x) => x.label);
  expect(labels).toEqual(["Display name"]); // the only non-sensitive field
  expect(st.recording!.skippedSensitive).toBe(4);

  // scan EVERYTHING the extension persisted or holds in memory-storage, plus what the panel receives
  const dump = await s.panel.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  for (const secret of ["hunter2", "tok_live_abc123", "4111111111111111", "internal-xyz"]) expect(dump, `leaked ${secret}`).not.toContain(secret);
  expect(JSON.stringify(st)).not.toContain("hunter2");
  // the user's own, non-sensitive typed example may exist ONLY in memory-only session storage, never in local storage
  const local = await s.panel.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  expect(local).not.toContain("Alice Example");

  await s.call({ type: "record.discard" });
  await page.close();
});

test("record → review → save → test → enable → an MCP client uses it, with verified results", async () => {
  const { page, tabId } = await openTab("/orders");
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);

  // the person does the task once
  await page.getByLabel("Order ID").click();
  await page.keyboard.type("A-1012");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "A-1012" }).click();
  await page.waitForURL(/\/orders\/A-1012$/);
  await page.locator("[data-mycp-banner]").waitFor({ state: "attached" }); // the recorder is live on the NEW page
  await waitForState(s, (x) => x.recording?.status === "recording" && (x.recording?.steps.length ?? 0) >= 3);

  // pick what to return, and what proves it worked
  const pick = async (mode: "text" | "success", selector: string, expectOutputs: number, expectSignals: number) => {
    await s.call({ type: "record.pick", mode });
    await waitForState(s, (x) => x.recording?.pick === mode);
    await page.locator(selector).click();
    await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === expectOutputs && (x.recording?.signals.length ?? 0) === expectSignals);
  };
  await pick("text", '[data-testid="order-status"]', 1, 0);
  await pick("text", '[data-testid="customer-name"]', 2, 0);
  await pick("success", '[data-testid="order-id"]', 2, 1);

  await s.call({ type: "record.stop" });
  const specRes = await s.call<DraftSpec>({ type: "record.spec" });
  const spec = (specRes as { data: DraftSpec }).data;
  expect(spec.params.map((p) => p.name)).toEqual(["order_id"]);
  expect(spec.params[0]!.example).toBe("A-1012");
  expect(spec.steps.map((x) => `${x.kind}:${x.label}`)).toEqual(["input:Order ID", "click:Search", "click:A-1012"]);

  // the person edits: names, a format rule for the parameter
  spec.id = "recorded_find_order";
  spec.title = "Recorded: find order";
  spec.description = "Look up an order by its ID and return its status and customer (taught by recording).";
  spec.params[0]!.pattern = "^A-\\d{4}$";
  spec.params[0]!.maxLength = 6;
  spec.outputs[0]!.name = "status";
  spec.outputs[1]!.name = "customer";

  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  // the typed example value is NOT in the saved definition: the link name became a parameter reference
  expect(JSON.stringify(def)).not.toContain("A-1012");
  expect(JSON.stringify(def)).toContain('"param":"order_id"');
  expect(def.kind).toBe("read");

  // the review is derived from the structure
  const summary = deriveReviewSummary(def);
  expect(summary.changes.level).toBe("ui_only");
  expect(summary.reads.map((r) => r.field).sort()).toEqual(["customer", "status"]);
  expect(summary.runsOn).toEqual([s.fixture.origin]);

  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);

  // cannot enable before a successful test of this exact version
  const early = await s.call({ type: "tool.enable", id: def.id, version: 1 });
  expect(early.ok).toBe(false);

  const test1 = await s.call<{ envelope: { status: string; output: Record<string, unknown> } }>({ type: "tool.test", id: def.id, version: 1, args: { order_id: "A-1012" } });
  const order = s.fixture.state.orders.find((o) => o.id === "A-1012")!;
  const t1 = (test1 as { data: { envelope: { status: string; output: Record<string, unknown> } } }).data;
  expect(t1.envelope.status).toBe("success");
  expect(t1.envelope.output).toMatchObject({ status: order.status, customer: order.customer });

  expect((await s.call({ type: "tool.enable", id: def.id, version: 1 })).ok).toBe(true);
  const deadline = Date.now() + 5000;
  while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);

  const client = await s.mcp();
  const env = await s.run(client, def.id, { order_id: "A-1013" }); // a different order than the one recorded
  const other = s.fixture.state.orders.find((o) => o.id === "A-1013")!;
  expect(env.status).toBe("success");
  expect(env.output).toMatchObject({ status: other.status, customer: other.customer });
  expect(env.verification.postconditions.every((c) => c.passed)).toBe(true);

  // any edit is a new version that must be tested again before it can run
  const edited = buildDraft({ ...spec, description: "Look up an order by its ID and return its status and customer (edited)." }, 2);
  await s.call({ type: "tool.save", definition: edited.definition!, source: "edited" });
  const row = (await s.state()).tools.find((t) => t.id === def.id)!;
  expect(row.enabledVersion).toBe(1);
  expect(row.latest.version).toBe(2);
  expect(row.latest.tested).toBe(false);
  expect((await s.call({ type: "tool.enable", id: def.id, version: 2 })).ok).toBe(false);

  // disable removes it from the AI client immediately
  await s.call({ type: "tool.disable", id: def.id });
  const gone = Date.now() + 5000;
  while (s.bridge.hub.getTool(def.id) && Date.now() < gone) await sleep(50);
  expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(def.id);
  await client.close();
  await page.close();
});

test("recording stops capturing when the tab leaves the approved site", async () => {
  const { page, tabId } = await openTab("/orders");
  await s.call({ type: "record.start", tabId });
  await page.goto("http://localhost:" + new URL(s.fixture.origin).port + "/account"); // same server, DIFFERENT origin
  const st = await waitForState(s, (x) => x.recording?.status === "paused_off_origin");
  expect(st.recording!.notice).toMatch(/left/);
  await page.getByLabel("Display name").click().catch(() => undefined);
  await page.keyboard.type("should not be recorded");
  await sleep(300);
  expect((await s.state()).recording!.steps).toHaveLength(0);
  await s.call({ type: "record.discard" });
  await page.close();
});
