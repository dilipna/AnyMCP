// The consequential action (a DRAFT customer note) under every approval outcome.
// Truth comes from the fixture's own write log, not from AnyMCP's report: "nothing was changed"
// must mean the site received no write.

import { expect, test, type Page } from "@playwright/test";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let n = 0;
/** Unique arguments per call: an identical repeat of a completed write is (correctly) refused as a duplicate. */
const fresh = () => ({ order_id: "A-1012", note: `Please call the customer back about the delayed shipment (case ${++n}).` });
let s: Stack;

test.beforeAll(async () => {
  s = await startStack();
});
test.afterAll(async () => {
  await s?.close();
});
test.beforeEach(async () => {
  await s.chaos({ reset: true });
});

const taskPage = (): Page | undefined => s.context.pages().find((p) => p.url().startsWith(s.fixture.origin));
const writes = () => s.fixture.state.writeLog;

async function startWrite(args: Record<string, unknown> = fresh()) {
  const client = await s.mcp();
  const pending = s.run(client, "draft_customer_note", args);
  await waitForState(s, (st) => !!st.approval);
  return { client, pending };
}

test("approve: the draft is saved exactly once, verified, and the AI client gets the result", async () => {
  const ARGS = fresh();
  const { client, pending } = await startWrite(ARGS);
  // the approval sheet shows the exact action and the page values it is bound to
  const sheet = s.panel.getByRole("alertdialog");
  await expect(sheet).toContainText("Save a DRAFT customer note on order A-1012");
  await expect(sheet).toContainText(ARGS.note);
  await expect(sheet).toContainText("this one run only");
  expect(writes()).toHaveLength(0); // nothing happens before approval

  await s.approve();
  const env = await pending;
  expect(env.status).toBe("success");
  expect(env.actionMayHaveOccurred).toBe(true);
  expect(env.output).toEqual({ order_id: "A-1012", draft_count: 1 });
  expect(env.verification.postconditions.every((c) => c.passed)).toBe(true);
  expect(writes()).toHaveLength(1);
  expect(writes()[0]).toMatchObject({ orderId: "A-1012", note: ARGS.note });

  const st = await waitForState(s, (x) => x.runs.some((r) => r.executionId === env.executionId));
  const rec = st.runs.find((r) => r.executionId === env.executionId)!;
  expect(rec.commitStarted).toBe(true);
  expect(rec.events.map((e) => e.phase)).toEqual(expect.arrayContaining(["approval_requested", "approval_granted", "commit_started", "outcome_verified"]));
  await client.close();
});

test("decline: nothing is written and the client is told it was rejected", async () => {
  const { client, pending } = await startWrite();
  await s.decline();
  const env = await pending;
  expect(env.status).toBe("rejected");
  expect(env.actionMayHaveOccurred).toBe(false);
  expect(env.retry.safe).toBe(true);
  expect(writes()).toHaveLength(0);
  await client.close();
});

test("a repeat of a completed write is refused by the bridge, and nothing new is written", async () => {
  const args = fresh();
  const { client, pending } = await startWrite(args);
  await s.approve();
  expect((await pending).status).toBe("success");
  const again = await s.run(client, "draft_customer_note", args);
  expect(again.status).toBe("denied");
  expect(again.reasonCode).toBe("duplicate_request");
  expect(writes()).toHaveLength(1);
  await client.close();
});

test("approval is INVALIDATED if a page value the user was shown changes before the click", async () => {
  const { client, pending } = await startWrite();
  await taskPage()!.evaluate(() => {
    document.querySelector('[data-testid="order-status"]')!.textContent = "Cancelled"; // the order changed under the user
  });
  const env = await pending;
  expect(env.status).toBe("approval_invalidated");
  expect(env.reasonCode).toBe("approval_binding_changed");
  expect(env.actionMayHaveOccurred).toBe(false);
  expect(writes()).toHaveLength(0);
  // the panel no longer offers the stale approval
  await expect(s.panel.getByRole("alertdialog")).toHaveCount(0);
  await client.close();
});

test("approval is INVALIDATED if the button that would be clicked changes", async () => {
  const { client, pending } = await startWrite();
  await taskPage()!.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Save draft note")!;
    b.textContent = "Delete draft note";
  });
  const env = await pending;
  expect(env.status).toBe("approval_invalidated");
  expect(writes()).toHaveLength(0);
  await client.close();
});

test("a stale approval cannot be granted after the page changed (the click is re-checked at the last moment)", async () => {
  // Race the poll: change the page and approve in the same instant. The commit re-check must still refuse.
  const { client, pending } = await startWrite();
  const page = taskPage()!;
  await page.evaluate(() => {
    document.querySelector('[data-testid="customer-name"]')!.textContent = "Someone Else";
  });
  await s.panel.getByRole("button", { name: "Approve once" }).click({ timeout: 3000 }).catch(() => undefined);
  const env = await pending;
  expect(["approval_invalidated"]).toContain(env.status);
  expect(writes()).toHaveLength(0);
  await client.close();
});

test("Stop during the approval prompt: cancelled before action, nothing written", async () => {
  const { client, pending } = await startWrite();
  await s.panel.getByRole("button", { name: "Stop" }).first().click();
  const env = await pending;
  expect(env.status).toBe("cancelled_before_action");
  expect(env.reasonCode).toBe("user_stopped");
  expect(env.actionMayHaveOccurred).toBe(false);
  expect(writes()).toHaveLength(0);
  await client.close();
});

test("Stop AFTER the action began is reported as unknown_outcome — never 'nothing changed'", async () => {
  await s.chaos({ saveDelayMs: 2500 }); // the save is in flight when we press Stop
  const { client, pending } = await startWrite();
  await s.approve();
  await waitForState(s, (st) => st.active?.commitStarted === true);
  await s.panel.getByRole("button", { name: "Stop" }).first().click();
  const env = await pending;
  expect(env.status).toBe("unknown_outcome");
  expect(env.actionMayHaveOccurred).toBe("unknown");
  expect(env.retry.safe).toBe(false);
  await sleep(3000);
  expect(writes()).toHaveLength(1); // and indeed the action DID go through — the honest answer was "unknown", not "nothing"
  await client.close();
});

test("approval expires if nobody answers: nothing written", async () => {
  // a 10 s approval window variant of the tool
  const short = { ...s.draft, version: 2, approval: { ...s.draft.approval, ttlSeconds: 10 } };
  await s.call({ type: "__test.setup", definitions: [short], origins: [s.fixture.origin] });
  const deadline = Date.now() + 5000;
  while (!s.bridge.hub.getTool("draft_customer_note") || s.bridge.hub.getTool("draft_customer_note")!.version !== 2) {
    if (Date.now() > deadline) throw new Error("v2 not synced");
    await sleep(50);
  }
  const { client, pending } = await startWrite();
  const env = await pending;
  expect(env.status).toBe("approval_expired");
  expect(env.actionMayHaveOccurred).toBe(false);
  expect(writes()).toHaveLength(0);
  await client.close();
  await s.call({ type: "__test.setup", definitions: [{ ...s.draft, version: 3 }], origins: [s.fixture.origin] }); // restore the normal window
});
