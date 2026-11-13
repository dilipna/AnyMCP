// Run records: what the side panel shows and what is stored locally.
// User-facing explanation and developer diagnostics are separate fields.
// By default NO entered values, page contents or screenshots are stored.

import type { OutcomeStatus, ReasonCode, ResultEnvelope } from "./result";

export const RUN_PHASES = [
  "received",
  "permission_checked",
  "preconditions_checked",
  "step_executed",
  "approval_requested",
  "approval_granted",
  "commit_started",
  "outcome_verified",
  "result_returned",
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const PHASE_LABELS: Record<RunPhase, string> = {
  received: "Request received",
  permission_checked: "Permission checked",
  preconditions_checked: "Preconditions checked",
  step_executed: "Step executed",
  approval_requested: "Approval requested",
  approval_granted: "Approval granted",
  commit_started: "Action started",
  outcome_verified: "Outcome verified",
  result_returned: "Result returned",
};

export interface TimelineEvent {
  at: string;
  phase: RunPhase;
  /** false = this phase failed; undefined = informational. */
  ok?: boolean;
  /** Plain-language, safe to show to anyone. */
  userText: string;
  /** Developer diagnostics. Never contains typed values or page text. Only shown in the "Developer details" section. */
  dev?: Record<string, string | number | boolean | null>;
}

export type RunState = "running" | "awaiting_approval" | OutcomeStatus;

export interface RunRecord {
  executionId: string;
  toolId: string;
  toolVersion: number;
  toolTitle: string;
  /** "test" runs come from the side panel; "mcp" runs come from the AI client. */
  trigger: "mcp" | "test";
  state: RunState;
  reasonCode?: ReasonCode;
  /** Set true BEFORE the consequential click. If true and no terminal state, the outcome is unknown. */
  commitStarted: boolean;
  startedAt: string;
  finishedAt?: string;
  events: TimelineEvent[];
  /** Final envelope. `output` is stripped unless the user enabled "keep results locally". */
  envelope?: ResultEnvelope;
}
