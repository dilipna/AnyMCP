// Run orchestrator: the heart of "correct execution and honest outcomes".
//
// Invariants this file exists to uphold:
//  1. Nothing consequential happens until permission, arguments, preconditions AND (for writes) a
//     fresh, matching, single-use approval have all been checked.
//  2. `commitStarted` is journaled BEFORE the consequential click (write-ahead intent). If anything
//     goes wrong after that point and we cannot positively verify the result, the outcome is
//     `unknown_outcome`. A write is NEVER replayed automatically.
//  3. The only "no effect" claims are ones we can prove: the content script explicitly refused before
//     clicking, or the site itself reported rejection.
//  4. Success requires every postcondition to be observed AND the output to validate against the schema.

import {
  computeBindingHash,
  describeCondition,
  describeStep,
  formatIssues,
  isCommitStep,
  makeEnvelope,
  renderEntry,
  redactEnvelopeForStorage,
  renderTemplate,
  toolDefinitionHash,
  validateAgainstSchema,
  validateToolPolicy,
  type ActionMayHaveOccurred,
  type ApprovalRequest,
  type ConditionResult,
  type OutcomeStatus,
  type ReasonCode,
  type ResultEnvelope,
  type RunPhase,
  type RunRecord,
  type CommitStep,
  type Locator,
  type Step,
  type ToolDefinition,
} from "anymcp-protocol";
import type { Binding, CommitAction, StepResult, Watch } from "../content/engine";
import type { ContentReply, PingResult, TerminalHit, ToContent } from "../shared/messages";
import type { StoredToolVersion } from "../shared/types";
import type { ApprovalCenter } from "./approvals";
import { getGrants, getSettings, getToolVersion, upsertRun } from "./storage";
import { TabError, acquireTab, ensureContent, send, tabUrl, waitComplete, waitForNewDocument } from "./tabs";

export interface RunRequest {
  executionId: string;
  toolId: string;
  version: number;
  /** Present for MCP runs: the hash the bridge advertised. A mismatch means the tool changed since sync. */
  definitionHash?: string;
  args: Record<string, unknown>;
  trigger: "mcp" | "test";
}

export interface OrchestratorDeps {
  approvals: ApprovalCenter;
  /** Best-effort progress channel to the bridge (MCP runs only). */
  sendEvent: (executionId: string, phase: RunPhase, detail?: string) => void;
  sendResult: (env: ResultEnvelope, recovered?: boolean) => void;
  requestResync: () => void;
  onChange: () => void;
  setBadge: (kind: "idle" | "running" | "approval") => void;
}

type CancelReason = "user_stopped" | "client_cancelled" | "bridge_shutdown";

class CancelledError extends Error {}

/** Attach the plain-language description of each check (placeholders, never values). */
function labelled(results: ConditionResult[], defs: { id: string; condition: Parameters<typeof describeCondition>[0] }[]): ConditionResult[] {
  return results.map((r) => {
    const d = defs.find((x) => x.id === r.id);
    return d ? { ...r, label: describeCondition(d.condition) } : r;
  });
}

function cancelReasonCode(r: CancelReason | null): ReasonCode {
  return r === "client_cancelled" ? "client_cancelled" : r === "bridge_shutdown" ? "bridge_disconnected" : "user_stopped";
}

interface Outcome {
  status: OutcomeStatus;
  reason: ReasonCode;
  message: string;
  actionMayHaveOccurred?: ActionMayHaveOccurred;
  output?: unknown;
  source?: { origin: string; path: string };
  pre?: ConditionResult[];
  post?: ConditionResult[];
  /** Whole-run retry is allowed (reads only; never after commitStarted). */
  retryable?: boolean;
}

interface ActiveRun {
  req: RunRequest;
  tool: ToolDefinition;
  stored: StoredToolVersion | null;
  record: RunRecord;
  tabId: number | null;
  cancel: { requested: boolean; reason: CancelReason | null };
  cancelPromise: Promise<never>;
  rejectCancel: () => void;
  finished: boolean;
  watch: Watch;
  pre: ConditionResult[];
  extracted: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_EVENTS = 80;

export class Orchestrator {
  active: ActiveRun | null = null;

  constructor(private readonly d: OrchestratorDeps) {}

  view(): { executionId: string; toolTitle: string; trigger: "mcp" | "test"; commitStarted: boolean } | null {
    const a = this.active;
    return a ? { executionId: a.req.executionId, toolTitle: a.record.toolTitle, trigger: a.req.trigger, commitStarted: a.record.commitStarted } : null;
  }

  /** Immediate stop. Reports truthfully whether the action had already begun. */
  stop(reason: CancelReason): { stopped: boolean; beforeAction: boolean } {
    const run = this.active;
    if (!run || run.finished) return { stopped: false, beforeAction: true };
    run.cancel = { requested: true, reason };
    this.d.approvals.cancel(run.req.executionId);
    run.rejectCancel();
    return { stopped: true, beforeAction: !run.record.commitStarted };
  }

  // ---------------------------------------------------------------- start
  async start(req: RunRequest): Promise<ResultEnvelope> {
    const startedAt = new Date().toISOString();
    const stored = await getToolVersion(req.toolId, req.version);
    const tool = stored?.definition ?? null;

    const record: RunRecord = {
      executionId: req.executionId,
      toolId: req.toolId,
      toolVersion: req.version,
      toolTitle: tool?.title ?? req.toolId,
      trigger: req.trigger,
      state: "running",
      commitStarted: false,
      startedAt,
      events: [],
    };

    if (this.active) {
      return this.finishDetached(record, { status: "precondition_failed", reason: "bridge_busy", message: "AnyMCP is already running another tool. Wait for it to finish, then retry." });
    }
    if (!stored || !tool) {
      return this.finishDetached(record, { status: "denied", reason: "tool_not_found", message: "That tool (or version) does not exist in AnyMCP." });
    }

    let rejectCancel!: () => void;
    const cancelPromise = new Promise<never>((_, rej) => (rejectCancel = () => rej(new CancelledError())));
    cancelPromise.catch(() => undefined); // never an unhandled rejection
    const run: ActiveRun = {
      req,
      tool,
      stored,
      record,
      tabId: null,
      cancel: { requested: false, reason: null },
      cancelPromise,
      rejectCancel,
      finished: false,
      watch: { sessionExpired: tool.sessionExpiredWhen, failure: tool.failureWhen, empty: tool.emptyWhen },
      pre: [],
      extracted: 0,
    };
    this.active = run;
    this.d.setBadge("running");
    this.log(run, "received", `Request received for “${tool.title}”.`, undefined, { trigger: req.trigger });
    await upsertRun(record);

    let outcome: Outcome;
    try {
      outcome = await this.execute(run);
    } catch (e) {
      outcome = this.fromThrown(run, e);
    }
    return this.finish(run, outcome);
  }

  // ---------------------------------------------------------------- core
  private async execute(run: ActiveRun): Promise<Outcome> {
    const { req, tool, stored } = run;

    // 1. permission ------------------------------------------------------------
    const denied = await this.checkPermission(run, stored!);
    if (denied) {
      this.log(run, "permission_checked", denied.message, false);
      return denied;
    }
    this.log(run, "permission_checked", "Permission checked: this tool, this website and these arguments are allowed.", true);

    // 2. tab ---------------------------------------------------------------------
    const origin = tool.origins[0]!;
    const entryUrl = origin + renderEntry(tool.entry, req.args);
    const maxAttempts = tool.kind === "write" ? 1 : tool.limits.maxAttempts;

    for (let attempt = 1; ; attempt++) {
      let tabId: number;
      try {
        tabId = await this.race(run, acquireTab(origin, entryUrl, tool.limits.stepTimeoutMs + 5000));
        run.tabId = tabId;
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        return { status: "precondition_failed", reason: e instanceof TabError && e.kind === "timeout" ? "timeout" : "no_tab", message: `AnyMCP could not open ${origin}: ${(e as Error).message}`, retryable: false };
      }
      const outcome = await this.attempt(run, tabId, attempt);
      if (outcome.retryable && attempt < maxAttempts && !run.record.commitStarted && !run.cancel.requested) {
        this.log(run, "step_executed", `Interrupted; trying the read again (attempt ${attempt + 1} of ${maxAttempts}). This is safe because it only reads.`, undefined);
        continue;
      }
      return outcome;
    }
  }

  private async checkPermission(run: ActiveRun, stored: StoredToolVersion): Promise<Outcome | null> {
    const { req, tool } = run;
    const deny = (reason: ReasonCode, message: string): Outcome => ({ status: "denied", reason, message });

    if (req.trigger === "mcp" && stored.status !== "enabled") return deny("tool_disabled", "This tool is not enabled in AnyMCP.");
    if (req.trigger === "mcp" && req.definitionHash && req.definitionHash !== stored.definitionHash) {
      this.d.requestResync();
      return deny("tool_disabled", "The tool changed after the bridge last synced. AnyMCP has re-synced; call it again.");
    }
    if ((await toolDefinitionHash(stored.definition)) !== stored.definitionHash) return deny("internal_error", "The stored tool failed its integrity check, so AnyMCP will not run it.");
    const issues = validateToolPolicy(tool);
    if (issues.length) return deny("internal_error", `This tool no longer satisfies AnyMCP policy: ${issues[0]!.message}`);

    const grants = await getGrants();
    for (const o of tool.origins) {
      const granted = !!grants[o] && (await chrome.permissions.contains({ origins: [`${o}/*`] }));
      if (!granted) return deny("origin_not_allowed", `You have not allowed AnyMCP to use ${o}. Open AnyMCP → Permissions and allow it.`);
    }
    const argIssues = validateAgainstSchema(tool.input, req.args);
    if (argIssues.length) return { status: "invalid_input", reason: "schema_violation", message: `The arguments were rejected: ${formatIssues(argIssues)}.` };
    return null;
  }

  /** One pass over the workflow in an acquired tab. */
  private async attempt(run: ActiveRun, tabId: number, _attempt: number): Promise<Outcome> {
    const { req, tool } = run;
    const begin: Extract<ToContent, { kind: "begin" }> = { kind: "begin", runId: req.executionId, args: req.args, origins: tool.origins, title: tool.title };
    const output: Record<string, unknown> = {};

    try {
      await this.race(run, ensureContent(tabId, tool.origins, begin));

      // session guard first: an expired login page would otherwise look like "element missing"
      const t0 = await this.rpc<{ terminal: TerminalHit | null }>(run, tabId, begin, { kind: "terminal", watch: { sessionExpired: run.watch.sessionExpired, failure: [], empty: [] } });
      if (t0.terminal?.terminal === "session_expired") {
        this.log(run, "preconditions_checked", "The website says your session has expired.", false, { condition: t0.terminal.id });
        return { status: "precondition_failed", reason: "session_expired", message: "Your session on the website has expired. Sign in again in Chrome, then retry. AnyMCP never signs in for you." };
      }

      // 3. preconditions ---------------------------------------------------------
      const pre = await this.pollPre(run, tabId, begin);
      if (pre.expired) {
        this.log(run, "preconditions_checked", "The website says your session has expired.", false, { condition: pre.expired.id });
        return { status: "precondition_failed", reason: "session_expired", message: "Your session on the website has expired. Sign in again in Chrome, then retry. AnyMCP never signs in for you." };
      }
      run.pre = pre.results;
      const failedPre = pre.results.filter((r) => !r.passed);
      this.log(run, "preconditions_checked", failedPre.length ? `${failedPre.length} precondition(s) not met.` : `Preconditions checked: ${pre.results.length} of ${pre.results.length} met.`, failedPre.length === 0, { failed: failedPre.map((f) => f.id).join(",") || null });
      if (failedPre.length) {
        const first = tool.preconditions.find((c) => c.id === failedPre[0]!.id)!;
        return { status: "precondition_failed", reason: "precondition_unmet", message: `Stopped before doing anything: expected that ${describeCondition(first.condition)}, but the page does not match.`, pre: pre.results };
      }

      // 4. steps -------------------------------------------------------------------
      const stepOutcome = await this.runSteps(run, tabId, begin, tool.steps, output);
      if (stepOutcome) return { ...stepOutcome, pre: run.pre };

      // 5. verify ------------------------------------------------------------------
      return await this.verify(run, tabId, begin, output);
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      if (e instanceof TabError) return this.tabOutcome(run, e);
      throw e;
    }
  }

  /**
   * Pages built with JavaScript report "loaded" before their content exists. Wait (at most one step timeout) until
   * every precondition holds at the same moment, stopping early if the site shows its signed-out state.
   */
  private async pollPre(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>): Promise<{ results: ConditionResult[]; expired: TerminalHit | null }> {
    const { tool } = run;
    const deadline = Date.now() + tool.limits.stepTimeoutMs;
    for (;;) {
      this.checkCancel(run);
      const results = labelled((await this.rpc<{ results: ConditionResult[] }>(run, tabId, begin, { kind: "eval", list: tool.preconditions })).results, tool.preconditions);
      if (results.every((r) => r.passed)) return { results, expired: null };
      const t = await this.rpc<{ terminal: TerminalHit | null }>(run, tabId, begin, { kind: "terminal", watch: { sessionExpired: run.watch.sessionExpired, failure: [], empty: [] } });
      if (t.terminal) return { results, expired: t.terminal };
      if (Date.now() >= deadline) return { results, expired: null };
      await sleep(150);
    }
  }

  /** Run steps in order. Returns an Outcome to stop early, or null to continue. */
  private async runSteps(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, steps: Step[], output: Record<string, unknown>, allowReconcile = true): Promise<Outcome | null> {
    const { tool } = run;
    let armed = false;
    for (const [index, step] of steps.entries()) {
      this.checkCancel(run);

      if (isCommitStep(step)) {
        const early = await this.doCommit(run, tabId, begin, step);
        if (early) return early;
        armed = false;
        continue;
      }

      const timeoutMs = step.op === "waitFor" ? (step.timeoutMs ?? tool.limits.stepTimeoutMs) : tool.limits.stepTimeoutMs;
      // the first action of a group: the page notes what the reads after it show now, so an old result left on the
      // page is never returned as the new one (content/engine.ts, armChange)
      const isAction = step.op === "click" || step.op === "press" || step.op === "fill";
      const arm = isAction && !armed ? readsAfter(steps, index) : undefined;
      if (isAction) armed = true;
      if (step.op === "extract") armed = false;
      let result: StepResult;
      if (step.op === "click" || step.op === "press") {
        result = await this.doClick(run, tabId, begin, step, timeoutMs, arm);
      } else {
        result = await this.rpc<StepResult>(run, tabId, begin, { kind: "step", step, watch: run.watch, timeoutMs, ...(arm?.length ? { arm } : {}) }, timeoutMs + 5000);
      }

      if (!result.ok) {
        this.log(run, "step_executed", `Step failed: ${describeStep(step)}`, false, { step: step.id, op: step.op, code: result.code, matches: result.matches ?? null, terminal: result.terminal ?? null });
        if ((await getSettings()).captureDiagnostics) await this.captureOutline(run, tabId);
        // The action already began and a LATER step could not see its effect (e.g. the acknowledgement was lost).
        // Unless the site itself reported an outcome, look again with a read-only GET before giving up.
        if (allowReconcile && run.record.commitStarted && run.tool.reconcile && !result.terminal) return this.reconcile(run, tabId, begin, output, []);
        return this.classifyStepFailure(run, step, result);
      }
      if (step.op === "extract" && result.value !== undefined) {
        output[step.into] = result.value;
        run.extracted++;
      }
      this.log(run, "step_executed", describeStep(step), true, { step: step.id, op: step.op });
    }
    return null;
  }

  /** A click or key press that may replace the document. Never retried. */
  private async doClick(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, step: Extract<Step, { op: "click" | "press" }>, timeoutMs: number, arm?: Locator[]): Promise<StepResult> {
    const before = { url: (await tabUrl(tabId)) ?? "", runIdBefore: run.req.executionId as string | null };
    let result: StepResult;
    try {
      result = await this.race(run, send<StepResult>(tabId, { kind: "step", step, watch: run.watch, timeoutMs, ...(arm?.length ? { arm } : {}) }, timeoutMs + 5000));
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      if (e instanceof TabError && e.kind === "closed") throw e;
      // The reply was lost, almost always because the click navigated away. A click or key press is never retried.
      result = { ok: true };
    }
    if (result.ok && step.effect === "navigate") {
      const moved = await this.race(run, waitForNewDocument(tabId, before, timeoutMs));
      if (moved) await this.race(run, ensureContent(tabId, run.tool.origins, begin));
    } else if (result.ok) {
      await this.race(run, ensureContent(tabId, run.tool.origins, begin)); // the click may still have replaced the document
    }
    return result;
  }

  // ---------------------------------------------------------------- the consequential action
  private async doCommit(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, step: CommitStep): Promise<Outcome | null> {
    const { tool, req, stored } = run;
    const fields = tool.approval.stateFields.map((f) => ({ id: f.id, locator: f.locator }));
    const action: CommitAction = step.op === "click" ? { type: "click" } : step.op === "press" ? { type: "press", key: step.key } : { type: "fill", value: step.value };

    const prep = await this.rpc<StepResult>(run, tabId, begin, { kind: "prepare-commit", target: step.target, fields, action });
    if (!prep.ok) {
      this.log(run, "step_executed", `Could not prepare the action: ${prep.detail}`, false, { step: step.id, code: prep.code });
      return this.classifyStepFailure(run, step, prep);
    }
    const binding = prep.value as Binding;
    if (prep.noop) {
      // Setting it would change nothing, so a field that saves by itself would not save: do not ask, do not act.
      this.log(run, "step_executed", "The field already has the requested value. Nothing needed to change, so AnyMCP did not ask for approval or act.", true, { step: step.id });
      return { status: "precondition_failed", reason: "no_change_needed", message: "The website already shows the requested value, so nothing needed to change. Nothing was done.", actionMayHaveOccurred: false, pre: run.pre };
    }
    const url = (await tabUrl(tabId)) ?? tool.origins[0]!;
    const origin = new URL(url).origin;
    const bindingHash = await computeBindingHash({
      executionId: req.executionId,
      toolId: tool.id,
      toolVersion: tool.version,
      definitionHash: stored!.definitionHash,
      origin,
      targetFingerprint: binding.fingerprint,
      args: req.args,
      state: binding.state,
    });
    const now = Date.now();
    const approvalReq: ApprovalRequest = {
      executionId: req.executionId,
      toolId: tool.id,
      toolTitle: tool.title,
      toolVersion: tool.version,
      origin,
      actionText: renderTemplate(tool.approval.actionTemplate, req.args),
      args: req.args,
      state: tool.approval.stateFields.map((f) => ({ id: f.id, label: f.label, value: binding.state[f.id] ?? "" })),
      bindingHash,
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + tool.approval.ttlSeconds * 1000).toISOString(),
    };

    run.record.state = "awaiting_approval";
    this.log(run, "approval_requested", "Waiting for your approval in the AnyMCP side panel.", undefined, { ttlSeconds: tool.approval.ttlSeconds });
    this.d.setBadge("approval");
    await upsertRun(run.record);

    const sameBinding = (b: Binding) => b.fingerprint === binding.fingerprint && fields.every((f) => b.state[f.id] === binding.state[f.id]);
    const decision = await this.d.approvals.request(approvalReq, async () => {
      try {
        const p = await send<StepResult>(tabId, { kind: "peek", target: step.target, fields }, 3000);
        return p.ok && sameBinding(p.value as Binding);
      } catch {
        return false; // the page went away or reloaded: the approval no longer describes anything real
      }
    });

    run.record.state = "running";
    this.d.setBadge("running");

    if (decision === "rejected") return { status: "rejected", reason: "approval_rejected", message: "You declined this action. Nothing was changed." };
    if (decision === "expired") return { status: "approval_expired", reason: "approval_timeout", message: "No one approved in time, so nothing was done. Run the tool again if you still want it." };
    if (decision === "cancelled") {
      const why =
        run.cancel.reason === "client_cancelled" ? "The AI client cancelled the request" : run.cancel.reason === "bridge_shutdown" ? "The connection to the bridge was lost" : "The run was stopped";
      return { status: "cancelled_before_action", reason: cancelReasonCode(run.cancel.reason), message: `${why} before the action started. Nothing was changed.` };
    }
    if (decision === "invalidated") {
      const gone = run.tabId !== null && !(await tabUrl(run.tabId));
      return gone
        ? { status: "approval_invalidated", reason: "tab_closed", message: "The tab was closed while waiting for approval. Nothing was done." }
        : { status: "approval_invalidated", reason: "approval_binding_changed", message: "The page changed while the approval was open, so the approval was withdrawn. Nothing was done. Run the tool again to review the new values." };
    }

    // ---- approved. WRITE-AHEAD INTENT: journal before the click. ----
    this.log(run, "approval_granted", "You approved this exact action.", true);
    run.record.commitStarted = true;
    this.log(run, "commit_started", "Action started. From here on AnyMCP will not retry it.", true);
    await upsertRun(run.record);

    let r: StepResult;
    try {
      r = await send<StepResult>(tabId, { kind: "commit", target: step.target, fields, expected: binding, action }, 8000);
    } catch (e) {
      if (e instanceof TabError && e.kind === "closed") throw e; // handled as unknown_outcome by tabOutcome
      // No reply: the click may have happened and navigated away. Keep commitStarted and verify below.
      this.log(run, "commit_started", "Lost contact with the page right after the action started; verifying what happened.", undefined);
      try {
        await ensureContent(tabId, tool.origins, begin);
      } catch {
        /* verification will report unknown_outcome if the page cannot be read */
      }
      return null;
    }
    if (!r.ok && r.acted) {
      // The control WAS clicked or set, then did not end up as expected: it may or may not have saved.
      this.log(run, "step_executed", `The action started but did not finish as expected: ${r.detail}`, false, { code: r.code });
      return this.classifyStepFailure(run, step, r);
    }
    if (!r.ok) {
      // The content script answered BEFORE acting: this is the only moment we may say "nothing happened".
      run.record.commitStarted = false;
      this.log(run, "commit_started", "The page no longer matched what you approved, so the action was NOT performed.", false, { code: r.code });
      await upsertRun(run.record);
      return r.code === "approval_binding_changed"
        ? { status: "approval_invalidated", reason: "approval_binding_changed", message: `The page changed after you approved (${r.detail}). Nothing was done. Run the tool again to review the new values.` }
        : this.classifyStepFailure(run, step, r);
    }
    return null;
  }

  // ---------------------------------------------------------------- verification
  private async verify(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, output: Record<string, unknown>): Promise<Outcome> {
    const { tool } = run;
    const post = await this.pollPost(run, tabId, begin, tool.limits.stepTimeoutMs);

    if (post.terminal) return this.fromTerminal(run, post.terminal, post.results);

    if (!post.allPassed) {
      if (run.record.commitStarted) return this.reconcile(run, tabId, begin, output, post.results);
      return { status: "failed", reason: "postcondition_unmet", message: "The page did not reach the state this tool expects, so AnyMCP is not reporting a result.", post: post.results };
    }

    Object.assign(output, tool.successResult ?? {});
    const issues = validateAgainstSchema(tool.output, output);
    if (issues.length) {
      return {
        status: "failed",
        reason: "output_invalid",
        message: `The result did not match the tool's output format (${formatIssues(issues)}), so AnyMCP is not returning it.${run.record.commitStarted ? " The action itself was verified." : ""}`,
        actionMayHaveOccurred: run.record.commitStarted ? true : false,
        post: post.results,
      };
    }
    this.log(run, "outcome_verified", `Outcome verified: ${post.results.length} condition(s) observed on the page.`, true);
    return {
      status: "success",
      reason: "ok",
      message: `Verified: ${post.results.length} postcondition(s) observed on the page.`,
      actionMayHaveOccurred: run.record.commitStarted ? true : false,
      output,
      source: await this.source(run),
      post: post.results,
    };
  }

  private async pollPost(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, timeoutMs: number) {
    const { tool } = run;
    const deadline = Date.now() + timeoutMs;
    let results: ConditionResult[] = [];
    for (;;) {
      this.checkCancel(run);
      results = labelled((await this.rpc<{ results: ConditionResult[] }>(run, tabId, begin, { kind: "eval", list: tool.postconditions })).results, tool.postconditions);
      if (results.every((r) => r.passed)) return { allPassed: true, results, terminal: null as TerminalHit | null };
      const t = await this.rpc<{ terminal: TerminalHit | null }>(run, tabId, begin, { kind: "terminal", watch: run.watch });
      if (t.terminal) return { allPassed: false, results, terminal: t.terminal };
      if (Date.now() >= deadline) return { allPassed: false, results, terminal: null };
      await sleep(150);
    }
  }

  /**
   * After the action, the page did not show the expected result. For tools that opted in, re-read the page
   * with a fresh GET (never a reload: a reload could resubmit a form) and re-check. Only a positive
   * observation upgrades this to success; otherwise it stays unknown_outcome.
   */
  private async reconcile(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, output: Record<string, unknown>, firstPost: ConditionResult[]): Promise<Outcome> {
    const { tool, req } = run;
    const unknown = (reason: ReasonCode, message: string): Outcome => ({ status: "unknown_outcome", reason, message, actionMayHaveOccurred: "unknown", post: firstPost });
    if (!tool.reconcile) return unknown("postcondition_unmet", "The action was started but AnyMCP could not see the expected result. It may or may not have happened. Check the website before trying again; AnyMCP will not repeat it.");

    this.log(run, "outcome_verified", "The result was not visible yet. Re-reading the page (read-only) to check what happened.", undefined);
    try {
      await this.race(run, (async () => {
        await chrome.tabs.update(tabId, { url: tool.origins[0]! + renderEntry(tool.entry, req.args) }); // GET, never a reload
        await sleep(50);
        await waitComplete(tabId, tool.limits.stepTimeoutMs + 5000);
        await ensureContent(tabId, tool.origins, begin);
      })());
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      return unknown("navigation_interrupted", "The action was started and AnyMCP then could not re-read the page. It may or may not have happened. Check the website; AnyMCP will not repeat it.");
    }
    const post = await this.pollPost(run, tabId, begin, tool.limits.stepTimeoutMs);
    if (post.terminal?.terminal === "session_expired") return unknown("session_expired", "The action was started, then your session expired before AnyMCP could check. It may or may not have happened. Sign in and check the website; AnyMCP will not repeat it.");
    if (!post.allPassed) return unknown("postcondition_unmet", "The action was started and a second, read-only look at the page still could not confirm it. It may or may not have happened. Check the website; AnyMCP will not repeat it.");

    // read-only tail (steps after the commit) to rebuild the output
    const commitIdx = tool.steps.findIndex(isCommitStep);
    const tailOut: Record<string, unknown> = {};
    const tail = await this.runSteps(run, tabId, begin, tool.steps.slice(commitIdx + 1), tailOut, false);
    if (tail) return unknown("postcondition_unmet", "The action looks complete but AnyMCP could not read the result afterwards. It may or may not have happened. Check the website.");
    Object.assign(tailOut, tool.successResult ?? {});
    const issues = validateAgainstSchema(tool.output, tailOut);
    if (issues.length) return { status: "failed", reason: "output_invalid", message: "The action was confirmed but the result could not be read in the expected format.", actionMayHaveOccurred: true, post: post.results };
    this.log(run, "outcome_verified", "Confirmed by re-reading the page after the action.", true);
    return { status: "success", reason: "ok", message: "Verified by re-reading the page after the action (the first look did not show it).", actionMayHaveOccurred: true, output: tailOut, source: await this.source(run), post: post.results };
  }

  // ---------------------------------------------------------------- classification
  private fromTerminal(run: ActiveRun, t: TerminalHit, post: ConditionResult[]): Outcome {
    const committed = run.record.commitStarted;
    if (t.terminal === "empty" && !committed) {
      this.log(run, "outcome_verified", "The website reports no results (a valid empty result).", true, { condition: t.id });
      return { status: "empty", reason: "no_results", message: "The website reports that there is nothing to return. This is a valid, verified empty result.", output: run.tool.emptyResult ?? {}, post };
    }
    if (t.terminal === "session_expired") {
      return committed
        ? { status: "unknown_outcome", reason: "session_expired", message: "The action had started when your session expired. It may or may not have happened. Sign in and check the website; AnyMCP will not repeat it.", actionMayHaveOccurred: "unknown", post }
        : { status: "precondition_failed", reason: "session_expired", message: "Your session on the website expired. Sign in again in Chrome, then retry. Nothing was changed.", post };
    }
    // site-declared failure
    return committed
      ? { status: "failed", reason: "site_rejected_action", message: "The website reported that it did not accept the action. Nothing was saved (as reported by the site).", actionMayHaveOccurred: false, post }
      : { status: "failed", reason: "site_error", message: "The website reported an error while loading the data. Nothing was changed. You can retry.", post };
  }

  private classifyStepFailure(run: ActiveRun, step: Step, r: Extract<StepResult, { ok: false }>): Outcome {
    if (r.terminal) {
      const post: ConditionResult[] = [];
      return this.fromTerminal(run, { terminal: r.terminal, id: r.conditionId ?? "" }, post);
    }
    const what = `Step “${describeStep(step)}” could not be completed: ${r.detail}`;
    if (run.record.commitStarted) {
      // something failed AFTER the action began: we cannot claim it did not happen
      return { status: "unknown_outcome", reason: r.code, message: `${what} The action had already started, so it may or may not have happened. Check the website; AnyMCP will not repeat it.`, actionMayHaveOccurred: "unknown" };
    }
    if (r.code === "timeout" || r.code === "output_invalid") return { status: "failed", reason: r.code, message: `${what} Nothing was changed.`, retryable: r.code === "timeout" };
    return { status: "precondition_failed", reason: r.code, message: `${what} AnyMCP stopped without guessing. The page may have changed; review or re-record the tool.` };
  }

  private tabOutcome(run: ActiveRun, e: TabError): Outcome {
    const committed = run.record.commitStarted;
    if (e.kind === "denied") return { status: "precondition_failed", reason: "wrong_origin", message: e.message };
    const reason: ReasonCode = e.kind === "closed" ? "tab_closed" : "navigation_interrupted";
    if (committed) {
      return { status: "unknown_outcome", reason, message: `${e.kind === "closed" ? "The tab was closed" : "The page became unreachable"} after the action started. It may or may not have happened. Check the website; AnyMCP will not repeat it.`, actionMayHaveOccurred: "unknown" };
    }
    return { status: "interrupted", reason, message: `${e.kind === "closed" ? "The tab was closed" : "The page became unreachable"} before anything was changed. It is safe to retry.`, retryable: e.kind !== "closed" };
  }

  private fromThrown(run: ActiveRun, e: unknown): Outcome {
    if (e instanceof CancelledError || run.cancel.requested) {
      const reason: ReasonCode = cancelReasonCode(run.cancel.reason);
      if (run.record.commitStarted) {
        return { status: "unknown_outcome", reason, message: "The run was stopped after the action had already started. It may already have happened; check the website. AnyMCP will not repeat it.", actionMayHaveOccurred: "unknown" };
      }
      return { status: "cancelled_before_action", reason, message: "The run was stopped before it changed anything." };
    }
    if (e instanceof TabError) return this.tabOutcome(run, e);
    const msg = String((e as Error)?.message ?? e);
    if (run.record.commitStarted) return { status: "unknown_outcome", reason: "internal_error", message: `AnyMCP hit an internal error after the action started (${msg}). It may or may not have happened; AnyMCP will not repeat it.`, actionMayHaveOccurred: "unknown" };
    return { status: "failed", reason: "internal_error", message: `AnyMCP hit an internal error before changing anything (${msg}).` };
  }

  // ---------------------------------------------------------------- plumbing
  private race<T>(run: ActiveRun, p: Promise<T>): Promise<T> {
    return Promise.race([p, run.cancelPromise]);
  }

  private checkCancel(run: ActiveRun) {
    if (run.cancel.requested) throw new CancelledError();
  }

  /** RPC to the content script. Read-only messages survive a navigation by re-establishing the run context. */
  private async rpc<R extends ContentReply>(run: ActiveRun, tabId: number, begin: Extract<ToContent, { kind: "begin" }>, msg: ToContent, timeoutMs = 15_000): Promise<R> {
    for (let i = 0; ; i++) {
      this.checkCancel(run);
      try {
        return await this.race(run, send<R>(tabId, msg, timeoutMs));
      } catch (e) {
        if (!(e instanceof TabError) || e.kind !== "gone" || i >= 3) throw e;
        await this.race(run, ensureContent(tabId, run.tool.origins, begin)); // document replaced: re-inject + re-begin, then retry
      }
    }
  }

  private async captureOutline(run: ActiveRun, tabId: number) {
    try {
      const r = await send<{ outline: string[] }>(tabId, { kind: "outline" }, 3000);
      this.log(run, "step_executed", "Developer diagnostics captured (you enabled this).", undefined, { outline: r.outline.join(" | ").slice(0, 900) });
    } catch {
      /* diagnostics are best-effort */
    }
  }

  private async source(run: ActiveRun): Promise<{ origin: string; path: string } | undefined> {
    const url = run.tabId !== null ? await tabUrl(run.tabId) : null;
    if (!url) return undefined;
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname }; // path only: no query string, no fragment
  }

  private log(run: ActiveRun, phase: RunPhase, userText: string, ok?: boolean, dev?: Record<string, string | number | boolean | null>) {
    if (run.record.events.length < MAX_EVENTS) run.record.events.push({ at: new Date().toISOString(), phase, userText, ...(ok === undefined ? {} : { ok }), ...(dev ? { dev } : {}) });
    this.d.onChange();
    if (run.req.trigger === "mcp") this.d.sendEvent(run.req.executionId, phase, userText.slice(0, 160));
  }

  private async finish(run: ActiveRun, o: Outcome): Promise<ResultEnvelope> {
    const settings = await getSettings();
    const env = makeEnvelope({
      executionId: run.req.executionId,
      tool: { id: run.tool.id, version: run.tool.version },
      status: o.status,
      reasonCode: o.reason,
      message: o.message,
      actionMayHaveOccurred: o.actionMayHaveOccurred ?? false,
      startedAt: run.record.startedAt,
      ...(o.source ? { source: { ...o.source, capturedAt: new Date().toISOString() } } : {}),
      ...(o.output !== undefined ? { output: o.output } : {}),
      verification: { preconditions: o.pre ?? run.pre, postconditions: o.post ?? [] },
      untrustedContent: run.extracted > 0 || o.status === "empty",
    });
    this.log(run, "result_returned", `Result: ${env.status}. ${env.message}`, env.status === "success" || env.status === "empty");
    run.record.state = env.status;
    run.record.reasonCode = env.reasonCode;
    run.record.finishedAt = env.timing.finishedAt;
    run.record.envelope = redactEnvelopeForStorage(env, settings.keepResults);
    run.finished = true;
    await upsertRun(run.record);

    if (run.tabId !== null) void send(run.tabId, { kind: "end" }, 1500).catch(() => undefined);
    this.active = null;
    this.d.setBadge("idle");
    this.d.onChange();
    if (run.req.trigger === "mcp") this.d.sendResult(env);
    return env;
  }

  /** For runs rejected before they become the active run (busy / unknown tool). */
  private async finishDetached(record: RunRecord, o: { status: OutcomeStatus; reason: ReasonCode; message: string }): Promise<ResultEnvelope> {
    const env = makeEnvelope({ executionId: record.executionId, tool: { id: record.toolId, version: record.toolVersion }, status: o.status, reasonCode: o.reason, message: o.message, startedAt: record.startedAt });
    record.state = env.status;
    record.reasonCode = env.reasonCode;
    record.finishedAt = env.timing.finishedAt;
    record.envelope = env;
    record.events.push({ at: env.timing.finishedAt, phase: "result_returned", ok: false, userText: env.message });
    await upsertRun(record);
    this.d.onChange();
    if (record.trigger === "mcp") this.d.sendResult(env);
    return env;
  }

  /**
   * After the service worker restarted: any run still marked running/awaiting_approval cannot continue.
   * If the action had started we say so honestly (unknown_outcome); otherwise it is safe to retry.
   */
  async recoverInterrupted(runs: RunRecord[]): Promise<ResultEnvelope[]> {
    const out: ResultEnvelope[] = [];
    for (const r of runs) {
      if (r.state !== "running" && r.state !== "awaiting_approval") continue;
      const committed = r.commitStarted;
      const env = makeEnvelope({
        executionId: r.executionId,
        tool: { id: r.toolId, version: r.toolVersion },
        status: committed ? "unknown_outcome" : "interrupted",
        reasonCode: "worker_restarted",
        message: committed
          ? "The browser extension restarted after the action had started. It may or may not have happened. Check the website; AnyMCP will not repeat it."
          : "The browser extension restarted before anything was changed. It is safe to retry.",
        actionMayHaveOccurred: committed ? "unknown" : false,
        startedAt: r.startedAt,
      });
      r.state = env.status;
      r.reasonCode = env.reasonCode;
      r.finishedAt = env.timing.finishedAt;
      r.envelope = env;
      r.events.push({ at: env.timing.finishedAt, phase: "result_returned", ok: false, userText: env.message });
      await upsertRun(r);
      if (r.trigger === "mcp") out.push(env);
    }
    return out;
  }
}

export type { PingResult };

/** The values recorded as changed by actions (`fresh`) read after the action at `index`, up to the next action that
 * follows a read: what that action changes. */
export function readsAfter(steps: Step[], index: number): Locator[] {
  const out: Locator[] = [];
  let sawRead = false;
  for (const st of steps.slice(index + 1)) {
    if (st.op === "extract") {
      if (st.source.fresh) out.push(st.source.locator);
      sawRead = true;
    } else if (sawRead && (st.op === "click" || st.op === "press" || st.op === "fill")) break;
  }
  return out;
}
