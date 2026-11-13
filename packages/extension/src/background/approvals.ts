// Approval center. Only the side panel (an extension page, reached by a real user click) can approve.
// The MCP client, the bridge and the web page have no path to `decide`.
//
// An approval is: single-use, time-limited, bound to one execution + one hash, and invalidated
// automatically if the live page stops matching what the user was shown.

import type { ApprovalRequest } from "anymcp-protocol";

export type ApprovalDecision = "approved" | "rejected" | "expired" | "cancelled" | "invalidated";

interface Pending {
  req: ApprovalRequest;
  resolve: (d: ApprovalDecision) => void;
  timers: ReturnType<typeof setTimeout>[];
}

export class ApprovalCenter {
  private pending: Pending | null = null;

  constructor(private readonly onChange: () => void) {}

  current(): ApprovalRequest | null {
    return this.pending?.req ?? null;
  }

  /**
   * Resolve with the user's decision. `stillValid` is polled while the sheet is open: if the page no
   * longer matches the binding, the approval is withdrawn (the user is never left approving stale values).
   */
  request(req: ApprovalRequest, stillValid: () => Promise<boolean>, pollMs = 1000): Promise<ApprovalDecision> {
    if (this.pending) return Promise.resolve("cancelled");
    return new Promise<ApprovalDecision>((resolve) => {
      const p: Pending = { req, resolve, timers: [] };
      const done = (d: ApprovalDecision) => {
        if (this.pending !== p) return;
        p.timers.forEach((t) => {
          clearTimeout(t);
          clearInterval(t);
        });
        this.pending = null;
        this.onChange();
        resolve(d);
      };
      p.timers.push(setTimeout(() => done("expired"), Math.max(0, Date.parse(req.expiresAt) - Date.now())));
      p.timers.push(
        setInterval(() => {
          void stillValid().then((ok) => {
            if (!ok) done("invalidated");
          });
        }, pollMs),
      );
      (p as Pending & { done: typeof done }).done = done;
      this.pending = p;
      this.onChange();
    });
  }

  /** The user clicked Approve/Reject. Verifies this decision is for exactly the request on screen. */
  decide(executionId: string, bindingHash: string, decision: "approve" | "reject"): { ok: true } | { ok: false; error: string } {
    const p = this.pending as (Pending & { done?: (d: ApprovalDecision) => void }) | null;
    if (!p) return { ok: false, error: "There is no approval waiting." };
    if (p.req.executionId !== executionId) return { ok: false, error: "That approval is for a different run." };
    if (p.req.bindingHash !== bindingHash) return { ok: false, error: "That approval does not match what is on the page." };
    if (Date.now() > Date.parse(p.req.expiresAt)) {
      p.done?.("expired");
      return { ok: false, error: "That approval expired." };
    }
    p.done?.(decision === "approve" ? "approved" : "rejected"); // clears `pending` first: single use
    return { ok: true };
  }

  /** Stop was pressed, the client cancelled, or the bridge connection dropped while waiting. */
  cancel(executionId: string): void {
    const p = this.pending as (Pending & { done?: (d: ApprovalDecision) => void }) | null;
    if (p && p.req.executionId === executionId) p.done?.("cancelled");
  }
}
