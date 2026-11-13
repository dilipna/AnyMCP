// Failure scenarios. For every one: the status must be honest, nothing unsafe may happen, and the
// fixture's own request/write logs (ground truth) must agree with what AnyMCP reported.

import { expect, test, type Page } from "@playwright/test";
import type { ResultEnvelope } from "anymcp-protocol";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let s: Stack;
let n = 0;
const fresh = () => ({ order_id: "A-1012", note: `Failure scenario note ${++n}.` });
const writes = () => s.fixture.state.writeLog;
const posts = () => s.fixture.state.requestLog.filter((r) => r.method === "POST" && r.path.includes("/drafts"));
const taskPage = (): Page | undefined => s.context.pages().find((p) => p.url().startsWith(s.fixture.origin));

test.beforeAll(async () => {
  s = await startStack({ reconnectGraceMs: 4000 });
});
test.afterAll(async () => {
  await s?.close();
});
test.beforeEach(async () => {
  await s.chaos({ reset: true });
  await waitForState(s, (st) => !st.active && !st.approval);
});

test.describe("read workflow", () => {
  test("expired session at the start: stops, says the session expired, did nothing", async () => {
    await s.chaos({ sessionExpired: true });
    const c = await s.mcp();
    const env = await s.run(c, "find_order", { order_id: "A-1012" });
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("session_expired");
    expect(env.message).toMatch(/never signs in for you/i);
    expect(env.actionMayHaveOccurred).toBe(false);
    await c.close();
  });

  test("session expires while the search is running: reported as expired, not as 'no results'", async () => {
    await s.chaos({ searchDelayMs: 1200 });
    const c = await s.mcp();
    const pending = s.run(c, "find_order", { order_id: "A-1012" });
    await sleep(500);
    await s.chaos({ sessionExpired: true });
    const env = await pending;
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("session_expired");
    await c.close();
  });

  test("changed layout (label and button renamed): stops without guessing another element", async () => {
    await s.chaos({ layoutChanged: true });
    const c = await s.mcp();
    const env = await s.run(c, "find_order", { order_id: "A-1012" });
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("locator_missing");
    expect(env.message).toMatch(/without guessing|page may have changed/i);
    await c.close();
  });

  test("ambiguous element (duplicate result rows): stops, will not pick one", async () => {
    await s.chaos({ duplicateRows: true });
    const c = await s.mcp();
    const env = await s.run(c, "find_order", { order_id: "A-1012" });
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("locator_ambiguous");
    await c.close();
  });

  test("the site reports an error: failed, nothing changed", async () => {
    await s.chaos({ searchError: true });
    const c = await s.mcp();
    const env = await s.run(c, "find_order", { order_id: "A-1012" });
    expect(env.status).toBe("failed");
    expect(env.reasonCode).toBe("site_error");
    expect(env.actionMayHaveOccurred).toBe(false);
    await c.close();
  });

  test("hostile instructions inside page content are returned as DATA and change nothing", async () => {
    const c = await s.mcp();
    const toolsBefore = (await c.listTools()).tools.map((t) => t.name).sort();
    const env = await s.run(c, "find_order", { order_id: "A-1007" }); // this order's note contains an injection attempt
    expect(env.status).toBe("success");
    const note = (env.output as { latest_note: string }).latest_note;
    expect(note).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/);
    expect(env.untrustedContent).toBe(true);
    // ...and it did not expand anything: no writes were attempted, the tool set is unchanged, no extra steps ran
    expect(posts()).toHaveLength(0);
    expect(writes()).toHaveLength(0);
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(toolsBefore);
    const st = await s.state();
    const rec = st.runs.find((r) => r.executionId === env.executionId)!;
    expect(rec.events.filter((e) => e.phase === "approval_requested")).toHaveLength(0);
    await c.close();
  });

  test("tab closed mid-run: interrupted (safe to retry), not success", async () => {
    await s.chaos({ searchDelayMs: 3000 });
    const c = await s.mcp();
    const pending = s.run(c, "find_order", { order_id: "A-1012" });
    const deadline = Date.now() + 8000;
    while (!taskPage() && Date.now() < deadline) await sleep(50);
    await sleep(600);
    await taskPage()!.close();
    const env = await pending;
    expect(env.status).toBe("interrupted");
    expect(env.reasonCode).toBe("tab_closed");
    expect(env.retry.safe).toBe(true);
    await c.close();
  });

  test("duplicate concurrent requests run ONCE", async () => {
    await s.chaos({ searchDelayMs: 600 });
    const c = await s.mcp();
    const before = s.fixture.state.requestLog.filter((r) => r.path === "/api/orders").length;
    const [a, b] = await Promise.all([s.run(c, "find_order", { order_id: "A-1012" }), s.run(c, "find_order", { order_id: "A-1012" })]);
    expect(a.executionId).toBe(b.executionId);
    expect(a.status).toBe("success");
    expect([a.deduplicated, b.deduplicated].filter(Boolean)).toHaveLength(1);
    expect(s.fixture.state.requestLog.filter((r) => r.path === "/api/orders").length - before).toBe(1);
    await c.close();
  });

  test("bridge connection drops mid-read: the read is NOT replayed; its result is delivered after reconnect", async () => {
    await s.chaos({ searchDelayMs: 1500 });
    const c = await s.mcp();
    const before = s.fixture.state.requestLog.filter((r) => r.path === "/api/orders").length;
    const pending = s.run(c, "find_order", { order_id: "A-1012" });
    await waitForState(s, (st) => !!st.active);
    s.bridge.hub.dropActive();
    const env = await pending;
    expect(env.status).toBe("success"); // transport retry: reconnect + resend the finished result
    expect(s.fixture.state.requestLog.filter((r) => r.path === "/api/orders").length - before).toBe(1); // action retry: never
    await c.close();
  });
});

test.describe("write workflow", () => {
  test("ambiguous save button: stops BEFORE asking for approval; nothing written", async () => {
    await s.chaos({ ambiguousSave: true });
    const c = await s.mcp();
    const env = await s.run(c, "draft_customer_note", fresh());
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("locator_ambiguous");
    expect((await s.state()).approval).toBeNull();
    expect(writes()).toHaveLength(0);
    await c.close();
  });

  test("changed layout: stops before approval; nothing written", async () => {
    await s.chaos({ layoutChanged: true });
    const c = await s.mcp();
    const env = await s.run(c, "draft_customer_note", fresh());
    expect(env.status).toBe("precondition_failed");
    expect(writes()).toHaveLength(0);
    await c.close();
  });

  test("session expired: stops before approval", async () => {
    await s.chaos({ sessionExpired: true });
    const c = await s.mcp();
    const env = await s.run(c, "draft_customer_note", fresh());
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("session_expired");
    expect(writes()).toHaveLength(0);
    await c.close();
  });

  test("the site explicitly rejects the draft: failed, and nothing was saved (as reported by the site)", async () => {
    await s.chaos({ draftRejected: true });
    const c = await s.mcp();
    const pending = s.run(c, "draft_customer_note", fresh());
    await waitForState(s, (st) => !!st.approval);
    await s.approve();
    const env = await pending;
    expect(env.status).toBe("failed");
    expect(env.reasonCode).toBe("site_rejected_action");
    expect(env.actionMayHaveOccurred).toBe(false);
    expect(writes()).toHaveLength(0);
    await c.close();
  });

  test("lost acknowledgement, resolvable: verified by a read-only re-check; the write happened exactly once", async () => {
    await s.chaos({ ackLost: "resolvable" });
    const c = await s.mcp();
    const args = fresh();
    const pending = s.run(c, "draft_customer_note", args);
    await waitForState(s, (st) => !!st.approval);
    await s.approve();
    const env = await pending;
    expect(env.status).toBe("success");
    expect(env.message).toMatch(/re-reading the page/i);
    expect(writes()).toHaveLength(1); // not replayed during the re-check
    expect(posts()).toHaveLength(1);
    await c.close();
  });

  test("lost acknowledgement that cannot be verified: unknown_outcome — and AnyMCP does not guess or retry", async () => {
    await s.chaos({ ackLost: "opaque" });
    const c = await s.mcp();
    const pending = s.run(c, "draft_customer_note", fresh());
    await waitForState(s, (st) => !!st.approval);
    await s.approve();
    const env = await pending;
    expect(env.status).toBe("unknown_outcome");
    expect(env.actionMayHaveOccurred).toBe("unknown");
    expect(env.retry.safe).toBe(false);
    expect(env.message).toMatch(/will not repeat/i);
    expect(posts()).toHaveLength(1); // exactly one attempt reached the site
    expect(writes()).toHaveLength(1); // ...and it did save: "unknown" was the honest answer
    await c.close();
  });

  test("tab closed AFTER the action started: unknown_outcome, not 'interrupted'", async () => {
    await s.chaos({ saveDelayMs: 2500 });
    const c = await s.mcp();
    const pending = s.run(c, "draft_customer_note", fresh());
    await waitForState(s, (st) => !!st.approval);
    await s.approve();
    await waitForState(s, (st) => st.active?.commitStarted === true);
    await taskPage()!.close();
    const env = await pending;
    expect(env.status).toBe("unknown_outcome");
    expect(env.retry.safe).toBe(false);
    await sleep(3000); // let the already-sent, delayed save land so it cannot leak into the next test's oracle
    // Whether the site saw the request depends on timing: closing a tab can cancel a request that has not left the browser yet.
    // That uncertainty is exactly why the honest answer is "unknown" — never "nothing changed", never "safe to retry".
    expect(writes().length).toBeLessThanOrEqual(1); // at most one: the click is never replayed
    await c.close();
  });

  test("bridge drops while waiting for approval: the prompt is withdrawn, the client gets unknown, the truth is retrievable", async () => {
    const c = await s.mcp();
    const pending = s.run(c, "draft_customer_note", fresh());
    await waitForState(s, (st) => !!st.approval);
    s.bridge.hub.dropActive();
    // the extension withdraws the now-unanswerable prompt
    await waitForState(s, (st) => !st.approval, 5000);
    const env = await pending;
    // Either the extension reconnected inside the grace window and delivered its authoritative answer (cancelled), or the
    // bridge answered conservatively (unknown). It must NEVER claim success or "safe to retry an action that may have run".
    expect(["cancelled_before_action", "unknown_outcome"]).toContain(env.status);
    expect(writes()).toHaveLength(0);
    // after the extension reconnects it reports what really happened
    const deadline = Date.now() + 15_000;
    let truth: ResultEnvelope | undefined;
    while (Date.now() < deadline) {
      const r = await c.callTool({ name: "anymcp_get_run", arguments: { execution_id: env.executionId } });
      const info = r.structuredContent as unknown as { state: string; envelope?: ResultEnvelope };
      if (info.envelope && info.envelope.status === "cancelled_before_action") {
        truth = info.envelope;
        break;
      }
      await sleep(300);
    }
    expect(truth?.status).toBe("cancelled_before_action");
    expect(truth?.reasonCode).toBe("bridge_disconnected");
    await c.close();
  });

  test("an identical write whose draft already exists is stopped by the precondition (safe retry after an unknown outcome)", async () => {
    const args = fresh();
    const first = s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: "draft_customer_note", version: 1, args });
    await waitForState(s, (st) => !!st.approval);
    await s.approve();
    expect((await first).ok && ((await first) as { data: { envelope: ResultEnvelope } }).data.envelope.status).toBe("success");
    const second = await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: "draft_customer_note", version: 1, args });
    const env = (second as { data: { envelope: ResultEnvelope } }).data.envelope;
    const why = JSON.stringify({ first: (await first), env, writes: writes().length, active: (await s.state()).active });
    expect(env.status, why).toBe("precondition_failed");
    expect(env.reasonCode, why).toBe("precondition_unmet");
    expect(writes()).toHaveLength(1);
  });
});
