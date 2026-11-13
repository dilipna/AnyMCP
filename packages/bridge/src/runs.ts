// Run manager: validates a request, enforces concurrency/duplicate rules, dispatches to the
// extension, and turns every possible ending into an honest ResultEnvelope.
//
// Transport retries vs action retries: the bridge NEVER re-dispatches a run. If the connection
// drops, it waits a grace period for the extension to report, then answers from what it knows.
// A write that reached the approval stage becomes `unknown_outcome`, never "safe to retry".

import {
  RUN_PHASES,
  formatIssues,
  hashCanonical,
  makeEnvelope,
  newExecutionId,
  validateAgainstSchema,
  type OutcomeStatus,
  type ReasonCode,
  type ResultEnvelope,
  type RunPhase,
  type ToolManifest,
} from "anymcp-protocol";
import type { ExtensionHub } from "./hub";
import type { StateStore } from "./store";

export interface ExecuteOptions {
  manifest: ToolManifest;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  /** Called with a short human message; the MCP layer turns it into notifications/progress. */
  progress?: (message: string) => void;
}

interface RunCtx {
  executionId: string;
  manifest: ToolManifest;
  key: string;
  startedAt: string;
  phase: RunPhase | "dispatched";
  settled: boolean;
  promise: Promise<ResultEnvelope>;
  resolve: (env: ResultEnvelope) => void;
  timers: NodeJS.Timeout[];
  progress?: (message: string) => void;
}

const phaseIndex = (p: RunPhase | "dispatched") => (p === "dispatched" ? -1 : RUN_PHASES.indexOf(p));
const WRITE_DEDUPE_MS = 10 * 60_000;

export class RunManager {
  private current: RunCtx | null = null;
  private byKey = new Map<string, RunCtx>();
  private recentWrites = new Map<string, { executionId: string; status: OutcomeStatus; at: number }>();
  private disconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly hub: ExtensionHub,
    private readonly store: StateStore,
    private readonly opts: { reconnectGraceMs?: number; cancelWaitMs?: number } = {},
  ) {
    hub.on("event", (e) => {
      const ctx = this.current;
      if (!ctx || ctx.executionId !== e.executionId) return;
      if (phaseIndex(e.phase) > phaseIndex(ctx.phase)) ctx.phase = e.phase;
      if (e.phase === "approval_requested") ctx.progress?.("Waiting for you to approve this action in the AnyMCP side panel.");
    });
    hub.on("result", (r) => {
      const env = r.envelope;
      const ctx = this.current;
      if (ctx && ctx.executionId === env.executionId) return this.finish(ctx, env);
      // A late or recovered result for a run we already answered: keep the authoritative record.
      if (!this.closed) this.store.upsertRun(env);
    });
    hub.on("disconnected", () => {
      if (!this.current || this.closed) return;
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      this.disconnectTimer = setTimeout(() => {
        const ctx = this.current;
        if (ctx) this.settleByPhase(ctx, "bridge_disconnected", "The connection to AnyMCP Extension was lost.");
      }, this.opts.reconnectGraceMs ?? 10_000);
    });
    hub.on("ready", () => {
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    });
  }

  /**
   * Bridge shutdown: stop every timer and answer the in-flight call (if any) from what is known, exactly as a
   * lost connection would. Nothing runs after this returns.
   */
  close(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    const ctx = this.current;
    if (ctx) {
      this.hub.send({ type: "run.cancel", executionId: ctx.executionId, reason: "bridge_shutdown" });
      this.settleByPhase(ctx, "bridge_disconnected", "The AnyMCP bridge was shut down.");
    }
    this.closed = true;
  }

  get inFlightId(): string | null {
    return this.current?.executionId ?? null;
  }

  /** For `anymcp_get_run`. */
  describe(executionId: string): { state: "running" | "finished" | "unknown_run"; phase?: string; envelope?: ResultEnvelope } {
    if (this.current?.executionId === executionId) return { state: "running", phase: this.current.phase };
    const env = this.store.getRun(executionId);
    return env ? { state: "finished", envelope: env } : { state: "unknown_run" };
  }

  async execute(o: ExecuteOptions): Promise<ResultEnvelope> {
    const { manifest, args } = o;
    const startedAt = new Date().toISOString();
    const tool = { id: manifest.id, version: manifest.version };
    const quick = (executionId: string, status: OutcomeStatus, reasonCode: ReasonCode, message: string) => {
      const env = makeEnvelope({ executionId, tool, status, reasonCode, message, startedAt });
      this.store.upsertRun(env);
      return env;
    };

    // 1. arguments must satisfy the reviewed input schema
    const issues = validateAgainstSchema(manifest.input, args);
    if (issues.length) return quick(newExecutionId(), "invalid_input", "schema_violation", `The arguments were rejected: ${formatIssues(issues)}.`);

    // 2. duplicates
    const key = await hashCanonical({ id: manifest.id, v: manifest.version, h: manifest.definitionHash, args });
    const inflight = this.byKey.get(key);
    if (inflight && !inflight.settled) {
      const env = await inflight.promise;
      return { ...env, deduplicated: true };
    }
    if (manifest.kind === "write") {
      const prior = this.recentWrites.get(key);
      if (prior && Date.now() - prior.at < WRITE_DEDUPE_MS && (prior.status === "success" || prior.status === "unknown_outcome")) {
        return quick(
          newExecutionId(),
          "denied",
          "duplicate_request",
          `An identical request already ran (${prior.executionId}, outcome: ${prior.status}). AnyMCP will not repeat a write automatically. Ask the user to check the website first.`,
        );
      }
    }

    // 3. one run at a time (one browser tab, one human watching)
    if (this.current) return quick(newExecutionId(), "precondition_failed", "bridge_busy", "Another AnyMCP run is in progress. Wait for it to finish, then retry.");

    // 4. the extension must be connected
    if (!this.hub.connected) {
      return quick(newExecutionId(), "precondition_failed", "extension_disconnected", "AnyMCP Extension is not connected. Open Chrome with AnyMCP installed and check it shows “Connected”.");
    }

    const executionId = newExecutionId();
    let resolveFn!: (env: ResultEnvelope) => void;
    const promise = new Promise<ResultEnvelope>((r) => (resolveFn = r));
    const ctx: RunCtx = { executionId, manifest, key, startedAt, phase: "dispatched", settled: false, promise, resolve: resolveFn, timers: [], progress: o.progress };
    this.current = ctx;
    this.byKey.set(key, ctx);

    const sent = this.hub.send({
      type: "run.request",
      executionId,
      toolId: manifest.id,
      version: manifest.version,
      definitionHash: manifest.definitionHash,
      args,
      requestedAt: startedAt,
    });
    if (!sent) {
      this.current = null;
      this.byKey.delete(key);
      return quick(executionId, "precondition_failed", "extension_disconnected", "AnyMCP Extension is not connected.");
    }

    // overall safety net, and keep-alive progress while a human may be deciding
    ctx.timers.push(
      setTimeout(() => {
        this.hub.send({ type: "run.cancel", executionId, reason: "client_cancelled" });
        this.settleByPhase(ctx, "timeout", "The run did not finish in the allowed time.");
      }, manifest.budgetMs),
    );
    ctx.timers.push(setInterval(() => ctx.progress?.(ctx.phase === "approval_requested" ? "Still waiting for approval in the AnyMCP side panel." : "AnyMCP is working in the browser."), 15_000));

    const onAbort = () => {
      this.hub.send({ type: "run.cancel", executionId, reason: "client_cancelled" });
      // The extension decides what the cancellation meant. If it stays silent, answer conservatively.
      ctx.timers.push(setTimeout(() => this.settleByPhase(ctx, "client_cancelled", "The AI client cancelled the request."), this.opts.cancelWaitMs ?? 5000));
    };
    if (o.signal?.aborted) onAbort();
    else o.signal?.addEventListener("abort", onAbort, { once: true });

    const env = await promise;
    o.signal?.removeEventListener("abort", onAbort);
    return env;
  }

  private finish(ctx: RunCtx, env: ResultEnvelope): void {
    if (ctx.settled) return;
    ctx.settled = true;
    ctx.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    if (this.current === ctx) this.current = null;
    this.byKey.delete(ctx.key);
    if (ctx.manifest.kind === "write") this.recentWrites.set(ctx.key, { executionId: ctx.executionId, status: env.status, at: Date.now() });
    if (!this.closed) this.store.upsertRun(env);
    ctx.resolve(env);
  }

  /**
   * The extension went silent. Decide what we can truthfully say.
   *  - read tool, or write that never reached approval: nothing consequential happened -> interrupted (safe to retry)
   *  - write that reached approval: the action may have happened -> unknown_outcome (never "safe")
   */
  private settleByPhase(ctx: RunCtx, reasonCode: ReasonCode, message: string): void {
    if (ctx.settled) return;
    const risky = ctx.manifest.kind === "write" && phaseIndex(ctx.phase) >= phaseIndex("approval_requested");
    const env = makeEnvelope({
      executionId: ctx.executionId,
      tool: { id: ctx.manifest.id, version: ctx.manifest.version },
      status: risky ? "unknown_outcome" : "interrupted",
      reasonCode,
      message: risky
        ? `${message} The action had reached the approval step, so it may or may not have happened. AnyMCP will not replay it. Check the website, then use anymcp_get_run for the extension's final record.`
        : `${message} Nothing was changed on the website. It is safe to retry.`,
      actionMayHaveOccurred: risky ? "unknown" : false,
      startedAt: ctx.startedAt,
    });
    this.finish(ctx, env);
  }
}
