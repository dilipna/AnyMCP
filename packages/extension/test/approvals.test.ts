import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "mycp-protocol";
import { ApprovalCenter } from "../src/background/approvals";

const req = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  executionId: "run_a",
  toolId: "draft_customer_note",
  toolTitle: "Draft customer note",
  toolVersion: 1,
  origin: "http://127.0.0.1:4173",
  actionText: "Save a draft",
  args: { order_id: "A-1012" },
  state: [],
  bindingHash: "hash_a",
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ...over,
});

afterEach(() => vi.useRealTimers());

describe("ApprovalCenter: an approval applies to one execution, once", () => {
  it("approves exactly the request on screen", async () => {
    const c = new ApprovalCenter(() => undefined);
    const p = c.request(req(), async () => true, 10_000);
    expect(c.decide("run_a", "hash_a", "approve")).toEqual({ ok: true });
    expect(await p).toBe("approved");
    expect(c.current()).toBeNull();
  });

  it("rejects a decision for a different execution or a different binding hash", async () => {
    const c = new ApprovalCenter(() => undefined);
    const p = c.request(req(), async () => true, 10_000);
    expect(c.decide("run_OTHER", "hash_a", "approve").ok).toBe(false);
    expect(c.decide("run_a", "hash_OTHER", "approve").ok).toBe(false);
    expect(c.current()).not.toBeNull(); // still waiting; nothing was approved
    c.decide("run_a", "hash_a", "reject");
    expect(await p).toBe("rejected");
  });

  it("is single-use: a second approve after the first is refused", async () => {
    const c = new ApprovalCenter(() => undefined);
    const p = c.request(req(), async () => true, 10_000);
    expect(c.decide("run_a", "hash_a", "approve").ok).toBe(true);
    await p;
    expect(c.decide("run_a", "hash_a", "approve")).toEqual({ ok: false, error: "There is no approval waiting." });
  });

  it("cannot be approved after it expired", async () => {
    vi.useFakeTimers();
    const c = new ApprovalCenter(() => undefined);
    const p = c.request(req({ expiresAt: new Date(Date.now() + 5_000).toISOString() }), async () => true, 1_000);
    vi.advanceTimersByTime(5_100);
    expect(await p).toBe("expired");
    expect(c.decide("run_a", "hash_a", "approve").ok).toBe(false);
  });

  it("is withdrawn automatically when the page no longer matches the binding", async () => {
    vi.useFakeTimers();
    const c = new ApprovalCenter(() => undefined);
    let same = true;
    const p = c.request(req(), async () => same, 500);
    vi.advanceTimersByTime(600);
    await Promise.resolve();
    expect(c.current()).not.toBeNull();
    same = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(await p).toBe("invalidated");
    expect(c.decide("run_a", "hash_a", "approve").ok).toBe(false); // too late: nothing to approve
  });

  it("cancel (Stop / client cancelled / bridge dropped) resolves as cancelled", async () => {
    const c = new ApprovalCenter(() => undefined);
    const p = c.request(req(), async () => true, 10_000);
    c.cancel("run_a");
    expect(await p).toBe("cancelled");
  });

  it("only one approval can be pending at a time", async () => {
    const c = new ApprovalCenter(() => undefined);
    void c.request(req(), async () => true, 10_000);
    expect(await c.request(req({ executionId: "run_b", bindingHash: "hash_b" }), async () => true, 10_000)).toBe("cancelled");
    c.cancel("run_a");
  });
});
