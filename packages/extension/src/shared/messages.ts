// Messages between the service worker, content scripts and the side panel.

import type { Condition, Locator, NamedCondition, Step, ToolDefinition } from "anymcp-protocol";
import type { Binding, CommitAction, StepResult, Watch } from "../content/engine";

// ---- service worker -> content script ----
export type ToContent =
  | { kind: "ping" }
  | { kind: "begin"; runId: string; args: Record<string, unknown>; origins: string[]; title: string }
  | { kind: "end" }
  | { kind: "eval"; list: NamedCondition[] }
  | { kind: "step"; step: Step; watch: Watch; timeoutMs: number }
  | { kind: "terminal"; watch: Watch }
  | { kind: "prepare-commit"; target: string; fields: { id: string; locator: Locator }[]; action: CommitAction }
  | { kind: "peek"; target: string; fields: { id: string; locator: Locator }[] }
  | { kind: "commit"; target: string; fields: { id: string; locator: Locator }[]; expected: Binding; action: CommitAction }
  | { kind: "outline" }
  | { kind: "record.start"; origin: string }
  | { kind: "record.stop" }
  | { kind: "record.pick"; mode: "text" | "table" | "list" | "success" | null };

export type FromContent =
  | { kind: "content.stop"; runId: string }
  | { kind: "record.event"; event: unknown }
  | { kind: "record.pick.done"; pick: unknown }
  | { kind: "record.stop-requested" };

export interface PingResult {
  runId: string | null;
  url: string;
  readyState: DocumentReadyState;
  recording: boolean;
}

export type TerminalHit = { terminal: "session_expired" | "failure" | "empty"; id: string };

export type ContentReply =
  | PingResult
  | StepResult
  | { results: { id: string; passed: boolean; detail?: string }[] }
  | { terminal: TerminalHit | null }
  | { outline: string[] }
  | { ok: true };

export type { Condition, ToolDefinition };
