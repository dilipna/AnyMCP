// Shared shapes: persisted storage and what the side panel renders.

import type { ApprovalRequest, Locator, RunRecord, ToolDefinition } from "anymcp-protocol";
import type { PickMode } from "../content/recorder";
import type { DraftOutput, DraftQueryPart, DraftSignal } from "./draft";

export type ToolStatus = "draft" | "tested" | "enabled" | "disabled" | "superseded";

export interface StoredToolVersion {
  definition: ToolDefinition;
  definitionHash: string;
  status: ToolStatus;
  /** Hash of the definition at the last PASSING test. Enabling requires testedHash === definitionHash. */
  testedHash: string | null;
  testedAt: string | null;
  createdAt: string;
  source: "recorded" | "sample" | "edited";
}

export interface Settings {
  /** Keep tool outputs in local run history. Off by default. */
  keepResults: boolean;
  /** On a failure, capture an explicit, redacted outline of visible controls for developer diagnostics. Off by default. */
  captureDiagnostics: boolean;
}

export const DEFAULT_SETTINGS: Settings = { keepResults: false, captureDiagnostics: false };

export interface Pairing {
  bridgeUrl: string;
  secret: string;
  pairedAt: string;
}

export type ConnState = "unpaired" | "connecting" | "connected" | "disconnected" | "error";

export interface ConnView {
  state: ConnState;
  bridgeUrl: string;
  paired: boolean;
  error: string | null;
  bridgeVersion: string | null;
  clientName: string | null;
  lastCallAt: string | null;
}

export interface ToolVersionView {
  version: number;
  status: ToolStatus;
  /** True if the current definition has passed a test. */
  tested: boolean;
  createdAt: string;
}

export interface ToolRow {
  id: string;
  title: string;
  kind: "read" | "write";
  origins: string[];
  /** Latest version (the one shown / edited). */
  latest: ToolVersionView;
  enabledVersion: number | null;
  versions: ToolVersionView[];
}

// ---- recording ----
export interface RecordedStepView {
  seq: number;
  kind: "input" | "click" | "press";
  label: string;
  locator: Locator;
  quality: "semantic" | "testid" | "container" | "fragile" | "ambiguous";
  /** Shown to the user while they choose parameters. Held in memory only; never written to storage. */
  example?: string;
  effect?: "ui" | "navigate" | "commit";
  viaEnter?: boolean;
  /** For input steps: the kind of control that was set. Absent = a text box. */
  control?: "text" | "select" | "checkbox" | "radio";
  /** The choices of a recorded dropdown, or the sibling choices of a clicked option/menu item (labels only). */
  options?: string[];
}

/** A value or table the user picked on the page. `preview` is shown to the user and never stored. */
export interface PickedOutputView extends DraftOutput {
  quality: "semantic" | "testid" | "container" | "fragile" | "ambiguous";
  preview: string;
}

/** A page element the user marked as meaning success / empty / error / expired-session. */
export interface PickedSignalView extends DraftSignal {
  quality: "semantic" | "testid" | "container" | "fragile" | "ambiguous";
  preview: string;
}

export interface RecordingView {
  id: string;
  tabId: number;
  origin: string;
  entryPath: string;
  /** Query string of the start page, already stripped of credential values. Memory only, like the rest. */
  entryQuery: DraftQueryPart[];
  startedAt: string;
  status: "recording" | "paused_off_origin" | "stopped";
  steps: RecordedStepView[];
  skippedSensitive: number;
  outputs: PickedOutputView[];
  signals: PickedSignalView[];
  pick: PickMode;
  notice: string | null;
}

export interface TestOutcomeView {
  toolId: string;
  version: number;
  at: string;
  record: RunRecord;
}

export interface PanelState {
  version: string;
  isTestBuild: boolean;
  conn: ConnView;
  tools: ToolRow[];
  grants: { origin: string; grantedAt: string }[];
  runs: RunRecord[];
  active: { executionId: string; toolTitle: string; trigger: "mcp" | "test"; commitStarted: boolean } | null;
  approval: ApprovalRequest | null;
  settings: Settings;
  recording: RecordingView | null;
  lastTest: TestOutcomeView | null;
}
