// Extension service-worker suspension (MV3 can stop the worker at any time). We really terminate it
// mid-run and check the three honest outcomes. Nothing is "resumed" blindly: a read is reported as
// interrupted (the client retries a read safely); a write whose action began is unknown_outcome.

import { expect, test } from "@playwright/test";
import { startStack, waitForState, type Stack } from "./harness";

let s: Stack;
let n = 0;
const fresh = () => ({ order_id: "A-1012", note: `Resilience note ${++n}.` });

test.beforeAll(async () => {
  s = await startStack({ reconnectGraceMs: 8000 });
});
test.afterAll(async () => {
  await s?.close();
});
test.beforeEach(async () => {
  await s.chaos({ reset: true });
});

test("the worker really restarts, and pairing, tools and grants survive it", async () => {
  await s.killWorker();
  const st = await s.state();
  expect(st.conn.paired).toBe(true);
  expect(st.tools.map((t) => t.enabledVersion)).toEqual([1, 1]);
  expect(st.grants).toHaveLength(1);
  const deadline = Date.now() + 8000;
  while (!s.bridge.hub.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  expect(s.bridge.hub.connected).toBe(true); // reconnected on its own
  const c = await s.mcp();
  expect((await s.run(c, "find_order", { order_id: "A-1012" })).status).toBe("success");
  await c.close();
});

test("worker suspended mid-READ: reported as interrupted and safe to retry — not replayed, not success", async () => {
  await s.chaos({ searchDelayMs: 3000 });
  const c = await s.mcp();
  const before = s.fixture.state.requestLog.filter((r) => r.path === "/api/orders").length;
  const pending = s.run(c, "find_order", { order_id: "A-1012" });
  await waitForState(s, (st) => !!st.active);
  await s.killWorker();
  const env = await pending;
  expect(env.status).toBe("interrupted");
  expect(env.reasonCode).toBe("worker_restarted");
  expect(env.retry.safe).toBe(true);
  expect(env.actionMayHaveOccurred).toBe(false);
  expect(s.fixture.state.requestLog.filter((r) => r.path === "/api/orders").length - before).toBeLessThanOrEqual(1); // never replayed (0 if the worker died before the search click)
  // and the very next call works
  await s.chaos({ searchDelayMs: 0 });
  expect((await s.run(c, "find_order", { order_id: "A-1012" })).status).toBe("success");
  await c.close();
});

test("worker suspended while an approval is open: the stale prompt is gone and nothing is written", async () => {
  const c = await s.mcp();
  const pending = s.run(c, "draft_customer_note", fresh());
  await waitForState(s, (st) => !!st.approval);
  await s.killWorker();
  const env = await pending;
  expect(env.status).toBe("interrupted");
  expect(env.reasonCode).toBe("worker_restarted");
  expect(env.actionMayHaveOccurred).toBe(false);
  expect((await s.state()).approval).toBeNull(); // an approval cannot survive the worker: it was held in memory only
  expect(s.fixture.state.writeLog).toHaveLength(0);
  await c.close();
});

test("worker suspended AFTER the action began: unknown_outcome (write-ahead intent), never 'safe to retry'", async () => {
  await s.chaos({ saveDelayMs: 2500 });
  const c = await s.mcp();
  const pending = s.run(c, "draft_customer_note", fresh());
  await waitForState(s, (st) => !!st.approval);
  await s.approve();
  await waitForState(s, (st) => st.active?.commitStarted === true);
  await s.killWorker();
  const env = await pending;
  expect(env.status).toBe("unknown_outcome");
  expect(env.reasonCode).toBe("worker_restarted");
  expect(env.retry.safe).toBe(false);
  expect(env.actionMayHaveOccurred).toBe("unknown");
  await new Promise((r) => setTimeout(r, 3000));
  expect(s.fixture.state.writeLog).toHaveLength(1); // the click had already gone out: "unknown" was the honest answer
  await c.close();
});
