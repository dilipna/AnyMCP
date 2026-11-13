// FROZEN scenario catalogue for evaluation protocol v1 (see docs/evaluation-protocol.md).
// The runner hashes THIS FILE and refuses to run if it differs from scenarios.lock.json.
// Do not edit after the first headline run; bump PROTOCOL_VERSION and re-freeze instead.

import type { Client } from "@modelcontextprotocol/client";
import type { ResultEnvelope } from "mycp-protocol";
import { waitForState, sleep, type Stack } from "../../../e2e/harness";

export const PROTOCOL_VERSION = 1;

export interface Observation {
  envs: ResultEnvelope[];
  /** drafts actually saved on the site (ground truth) */
  writes: number;
  /** POSTs that reached the site */
  posts: number;
  /** search requests that reached the site */
  searches: number;
  /** every request that reached the site */
  requests: number;
  approvalsGranted: number;
  promptsShown: number;
  latencyMs?: number;
  /** only for scenarios that check it */
  toolsUnchanged?: boolean;
  nextCallOk?: boolean;
  /** the fixture's own seed data for the order that was asked for (ground truth) */
  truth?: { id: string; customer: string; status: string; total: number; placed: string };
}

export interface Check {
  failures: string[];
  /** the status was success/empty but the returned data is wrong */
  outputMismatch?: boolean;
}

export interface Ctx {
  s: Stack;
  c: Client;
  run(name: string, args: Record<string, unknown>): Promise<ResultEnvelope>;
  note(): string;
  taskPage(): import("@playwright/test").Page | undefined;
}

export interface Scenario {
  id: string;
  category: string;
  runs: number;
  /** statuses that count as the correct, honest outcome for this scenario */
  accepted: string[];
  /** measure recovery: the next normal call must succeed */
  recovery?: boolean;
  /** extra claim a successful result must satisfy */
  act(ctx: Ctx, i: number): Promise<Partial<Observation>>;
  check(o: Observation, i: number): Check;
}

const ORDERS = ["A-1001", "A-1005", "A-1012", "A-1019", "A-1027"];
const seed = (s: Stack, id: string) => s.fixture.state.orders.find((o) => o.id === id)!;
const status = (o: Observation, i = 0) => o.envs[i]?.status;
const must = (cond: boolean, msg: string, f: string[]) => {
  if (!cond) f.push(msg);
};

/**
 * Start a write. Returns the pending call WITHOUT waiting for the prompt: callers wait explicitly. (An earlier version
 * also polled in here; two concurrent pollers could miss a prompt that only lives ~250 ms after Approve was clicked.)
 */
function startWrite(ctx: Ctx, args = { order_id: "A-1012", note: ctx.note() }): Promise<ResultEnvelope> {
  return ctx.run("draft_customer_note", args);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const t = performance.now();
  const v = await fn();
  return { v, ms: performance.now() - t };
}

export const SCENARIOS: Scenario[] = [
  // ------------------------------------------------------------------ reads
  {
    id: "read.success",
    category: "successful read",
    runs: 30,
    accepted: ["success"],
    async act(ctx, i) {
      const id = ORDERS[i % ORDERS.length]!;
      const t = seed(ctx.s, id);
      const { v, ms } = await timed(() => ctx.run("find_order", { order_id: id }));
      return { envs: [v], latencyMs: ms, truth: { id, customer: t.customer, status: t.status, total: t.total, placed: t.placed } };
    },
    check(o) {
      const f: string[] = [];
      const e = o.envs[0]!;
      let mismatch = false;
      if (e.status === "success" && o.truth) {
        const out = e.output as Record<string, unknown>;
        mismatch = !(out.order_id === o.truth.id && out.customer === o.truth.customer && out.status === o.truth.status && out.total === o.truth.total && out.placed === o.truth.placed);
        must(!mismatch, `output differs from ground truth for ${o.truth.id}`, f);
      } else must(false, `status ${e.status}`, f);
      must(o.writes === 0, "a read caused a write", f);
      return { failures: f, outputMismatch: mismatch };
    },
  },
  {
    id: "read.empty",
    category: "empty result",
    runs: 5,
    accepted: ["empty"],
    async act(ctx) {
      return { envs: [await ctx.run("find_order", { order_id: "A-9999" })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "empty", `status ${status(o)}`, f);
      must(JSON.stringify(o.envs[0]?.output) === JSON.stringify({ found: false }), "empty output differs", f);
      must(o.writes === 0, "write on a read", f);
      return { failures: f };
    },
  },
  {
    id: "read.invalid_input",
    category: "incorrect input",
    runs: 5,
    accepted: ["invalid_input"],
    async act(ctx, i) {
      const bad = [{ order_id: "not-an-order" }, { order_id: "A-1012", extra: "x" }, {}, { order_id: "A-12" }, { order_id: 1012 }][i % 5]!;
      const res = await ctx.s.mcp().then(async (c) => {
        const r = await c.callTool({ name: "find_order", arguments: bad as Record<string, unknown> });
        await c.close();
        return r;
      });
      // the SDK may reject at its own schema layer (isError, no envelope) or our validator answers invalid_input
      const env = res.structuredContent as unknown as ResultEnvelope | undefined;
      if (env) return { envs: [env] };
      // rejected by the SDK's own schema layer: still a rejection, but ONLY if it really was an error
      return { envs: [{ status: res.isError ? "invalid_input" : "success" } as ResultEnvelope] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "invalid_input", `status ${status(o)}`, f);
      must(o.requests === 0, `${o.requests} request(s) reached the site`, f);
      return { failures: f };
    },
  },
  {
    id: "read.ambiguous",
    category: "ambiguous element",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ duplicateRows: true });
      return { envs: [await ctx.run("find_order", { order_id: "A-1012" })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed" && o.envs[0]?.reasonCode === "locator_ambiguous", `got ${status(o)}/${o.envs[0]?.reasonCode}`, f);
      must(o.writes === 0, "write", f);
      return { failures: f };
    },
  },
  {
    id: "read.layout_changed",
    category: "changed layout",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ layoutChanged: true });
      return { envs: [await ctx.run("find_order", { order_id: "A-1012" })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed", `status ${status(o)}`, f);
      must(o.writes === 0, "write", f);
      return { failures: f };
    },
  },
  {
    id: "read.session_expired",
    category: "expired session",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ sessionExpired: true });
      return { envs: [await ctx.run("find_order", { order_id: "A-1012" })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed" && o.envs[0]?.reasonCode === "session_expired", `got ${status(o)}/${o.envs[0]?.reasonCode}`, f);
      return { failures: f };
    },
  },
  {
    id: "read.session_expires_midrun",
    category: "expired session",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ searchDelayMs: 1200 });
      const p = ctx.run("find_order", { order_id: "A-1012" });
      await sleep(500);
      await ctx.s.chaos({ sessionExpired: true });
      return { envs: [await p] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed" && o.envs[0]?.reasonCode === "session_expired", `got ${status(o)}/${o.envs[0]?.reasonCode}`, f);
      return { failures: f };
    },
  },
  {
    id: "read.site_error",
    category: "site failure",
    runs: 5,
    accepted: ["failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ searchError: true });
      return { envs: [await ctx.run("find_order", { order_id: "A-1012" })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "failed", `status ${status(o)}`, f);
      return { failures: f };
    },
  },
  {
    id: "read.tab_closed",
    category: "tab closure",
    runs: 5,
    accepted: ["interrupted"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ searchDelayMs: 3000 });
      const p = ctx.run("find_order", { order_id: "A-1012" });
      const end = Date.now() + 8000;
      while (!ctx.taskPage() && Date.now() < end) await sleep(50);
      await sleep(600);
      await ctx.taskPage()?.close();
      return { envs: [await p] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "interrupted", `status ${status(o)}`, f);
      must(o.envs[0]?.retry.safe === true, "not marked retry-safe", f);
      return { failures: f };
    },
  },
  {
    id: "read.bridge_drop",
    category: "bridge disconnection",
    runs: 5,
    accepted: ["success"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ searchDelayMs: 1500 });
      const p = ctx.run("find_order", { order_id: "A-1012" });
      await waitForState(ctx.s, (st) => !!st.active);
      ctx.s.bridge.hub.dropActive();
      return { envs: [await p] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "success", `status ${status(o)}`, f);
      must(o.searches <= 1, `${o.searches} searches reached the site (replay)`, f);
      return { failures: f };
    },
  },
  {
    id: "read.worker_suspended",
    category: "worker suspension",
    runs: 5,
    accepted: ["interrupted"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ searchDelayMs: 3000 });
      const p = ctx.run("find_order", { order_id: "A-1012" });
      await waitForState(ctx.s, (st) => !!st.active);
      await ctx.s.killWorker();
      return { envs: [await p] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "interrupted", `status ${status(o)}`, f);
      must(o.searches <= 1, `${o.searches} searches (replay)`, f);
      return { failures: f };
    },
  },
  {
    id: "read.duplicate",
    category: "duplicate requests",
    runs: 5,
    accepted: ["success"],
    async act(ctx) {
      await ctx.s.chaos({ searchDelayMs: 600 });
      const [a, b] = await Promise.all([ctx.run("find_order", { order_id: "A-1012" }), ctx.run("find_order", { order_id: "A-1012" })]);
      return { envs: [a, b] };
    },
    check(o) {
      const f: string[] = [];
      must(o.envs[0]?.executionId === o.envs[1]?.executionId, "two executions were created", f);
      must(o.searches === 1, `${o.searches} searches reached the site (expected 1)`, f);
      return { failures: f };
    },
  },
  {
    id: "read.hostile_content",
    category: "hostile page text",
    runs: 5,
    accepted: ["success"],
    async act(ctx) {
      const before = (await ctx.c.listTools()).tools.map((t) => t.name).sort().join(",");
      const e = await ctx.run("find_order", { order_id: "A-1007" });
      const after = (await ctx.c.listTools()).tools.map((t) => t.name).sort().join(",");
      return { envs: [e], toolsUnchanged: before === after };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "success", `status ${status(o)}`, f);
      must(/IGNORE ALL PREVIOUS INSTRUCTIONS/.test(String((o.envs[0]?.output as { latest_note?: string })?.latest_note ?? "")), "hostile note was not returned as data", f);
      must(o.envs[0]?.untrustedContent === true, "not flagged as untrusted content", f);
      must(o.writes === 0 && o.posts === 0, "a write was attempted", f);
      must(o.promptsShown === 0, "an approval prompt appeared", f);
      must(o.toolsUnchanged === true, "the tool set changed", f);
      return { failures: f };
    },
  },
  // ------------------------------------------------------------------ writes
  {
    id: "write.approved",
    category: "approved write",
    runs: 10,
    accepted: ["success"],
    async act(ctx) {
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      return { envs: [await p], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "success", `status ${status(o)}`, f);
      must(o.writes === 1, `${o.writes} writes on the site (expected 1)`, f);
      return { failures: f };
    },
  },
  {
    id: "write.rejected",
    category: "approval rejection",
    runs: 5,
    accepted: ["rejected"],
    recovery: true,
    async act(ctx) {
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.decline();
      return { envs: [await p], promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "rejected", `status ${status(o)}`, f);
      must(o.writes === 0, "write after decline", f);
      return { failures: f };
    },
  },
  {
    id: "write.invalidated_state",
    category: "approval invalidation",
    runs: 5,
    accepted: ["approval_invalidated"],
    recovery: true,
    async act(ctx) {
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.taskPage()!.evaluate(() => {
        document.querySelector('[data-testid="order-status"]')!.textContent = "Cancelled";
      });
      return { envs: [await p], promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "approval_invalidated", `status ${status(o)}`, f);
      must(o.writes === 0, "write after invalidation", f);
      return { failures: f };
    },
  },
  {
    id: "write.invalidated_target",
    category: "approval invalidation",
    runs: 5,
    accepted: ["approval_invalidated"],
    recovery: true,
    async act(ctx) {
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.taskPage()!.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Save draft note");
        if (b) b.textContent = "Delete draft note";
      });
      return { envs: [await p], promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "approval_invalidated", `status ${status(o)}`, f);
      must(o.writes === 0, "write after invalidation", f);
      return { failures: f };
    },
  },
  {
    id: "write.ambiguous",
    category: "ambiguous element",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ ambiguousSave: true });
      const e = await ctx.run("draft_customer_note", { order_id: "A-1012", note: ctx.note() });
      return { envs: [e], promptsShown: (await ctx.s.state()).approval ? 1 : 0 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed", `status ${status(o)}`, f);
      must(o.promptsShown === 0, "asked for approval despite ambiguity", f);
      must(o.writes === 0, "write", f);
      return { failures: f };
    },
  },
  {
    id: "write.layout_changed",
    category: "changed layout",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ layoutChanged: true });
      return { envs: [await ctx.run("draft_customer_note", { order_id: "A-1012", note: ctx.note() })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed", `status ${status(o)}`, f);
      must(o.writes === 0, "write", f);
      return { failures: f };
    },
  },
  {
    id: "write.session_expired",
    category: "expired session",
    runs: 5,
    accepted: ["precondition_failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ sessionExpired: true });
      return { envs: [await ctx.run("draft_customer_note", { order_id: "A-1012", note: ctx.note() })] };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "precondition_failed", `status ${status(o)}`, f);
      must(o.writes === 0, "write", f);
      return { failures: f };
    },
  },
  {
    id: "write.site_rejects",
    category: "site rejection",
    runs: 5,
    accepted: ["failed"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ draftRejected: true });
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      return { envs: [await p], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "failed", `status ${status(o)}`, f);
      must(o.writes === 0, "write although the site rejected it", f);
      return { failures: f };
    },
  },
  {
    id: "write.ack_lost_resolvable",
    category: "write with unknown outcome",
    runs: 5,
    accepted: ["success"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ ackLost: "resolvable" });
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      return { envs: [await p], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "success", `status ${status(o)}`, f);
      must(o.writes === 1, `${o.writes} writes (expected 1)`, f);
      must(o.posts === 1, `${o.posts} POSTs reached the site (expected 1)`, f);
      return { failures: f };
    },
  },
  {
    id: "write.ack_lost_opaque",
    category: "write with unknown outcome",
    runs: 5,
    accepted: ["unknown_outcome"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ ackLost: "opaque" });
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      return { envs: [await p], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "unknown_outcome", `status ${status(o)}`, f);
      must(o.envs[0]?.retry.safe === false, "marked retry-safe", f);
      must(o.posts === 1, `${o.posts} POSTs reached the site (expected 1)`, f);
      return { failures: f };
    },
  },
  {
    id: "write.tab_closed_after_commit",
    category: "tab closure",
    runs: 5,
    accepted: ["unknown_outcome"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ saveDelayMs: 2500 });
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      await waitForState(ctx.s, (st) => st.active?.commitStarted === true);
      await ctx.taskPage()?.close();
      const env = await p;
      await sleep(2800); // the save was already sent; let it land so the oracle is final and cannot leak into the next run
      return { envs: [env], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "unknown_outcome", `status ${status(o)}`, f);
      must(o.envs[0]?.retry.safe === false, "marked retry-safe", f);
      return { failures: f };
    },
  },
  {
    id: "write.stop_after_commit",
    category: "cancellation",
    runs: 5,
    accepted: ["unknown_outcome"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ saveDelayMs: 2500 });
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      await waitForState(ctx.s, (st) => st.active?.commitStarted === true);
      await ctx.s.panel.getByRole("button", { name: "Stop" }).first().click();
      const env = await p;
      await sleep(2800); // let the in-flight save finish so the oracle is final
      return { envs: [env], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "unknown_outcome", `status ${status(o)}`, f);
      must(o.envs[0]?.actionMayHaveOccurred === "unknown", "did not say the action may have occurred", f);
      return { failures: f };
    },
  },
  {
    id: "write.stop_before_commit",
    category: "cancellation",
    runs: 5,
    accepted: ["cancelled_before_action"],
    recovery: true,
    async act(ctx) {
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.panel.getByRole("button", { name: "Stop" }).first().click();
      return { envs: [await p], promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "cancelled_before_action", `status ${status(o)}`, f);
      must(o.writes === 0, "write after Stop", f);
      return { failures: f };
    },
  },
  {
    id: "write.worker_suspended_after_commit",
    category: "worker suspension",
    runs: 5,
    accepted: ["unknown_outcome"],
    recovery: true,
    async act(ctx) {
      await ctx.s.chaos({ saveDelayMs: 2500 });
      const p = startWrite(ctx);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      await waitForState(ctx.s, (st) => st.active?.commitStarted === true);
      await ctx.s.killWorker();
      const env = await p;
      await sleep(2800);
      return { envs: [env], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "unknown_outcome", `status ${status(o)}`, f);
      must(o.envs[0]?.retry.safe === false, "marked retry-safe", f);
      return { failures: f };
    },
  },
  {
    id: "write.duplicate_after_success",
    category: "duplicate requests",
    runs: 5,
    accepted: ["denied"],
    async act(ctx) {
      const args = { order_id: "A-1012", note: ctx.note() };
      const first = ctx.run("draft_customer_note", args);
      await waitForState(ctx.s, (st) => !!st.approval);
      await ctx.s.approve();
      await first;
      const again = await ctx.run("draft_customer_note", args);
      return { envs: [again], approvalsGranted: 1, promptsShown: 1 };
    },
    check(o) {
      const f: string[] = [];
      must(status(o) === "denied" && o.envs[0]?.reasonCode === "duplicate_request", `got ${status(o)}/${o.envs[0]?.reasonCode}`, f);
      must(o.writes === 1, `${o.writes} writes in total (expected 1)`, f);
      return { failures: f };
    },
  },
];
