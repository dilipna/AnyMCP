// Requests the side panel (an extension page) can make of the service worker.
// Only extension pages can send these; web pages and the MCP client cannot reach them.

import type { ResultEnvelope, ToolDefinition } from "mycp-protocol";
import type { PickMode } from "../content/recorder";
import type { DraftSpec } from "./draft";
import type { PanelState, Settings, StoredToolVersion } from "./types";

export type PanelRequest =
  | { type: "state" }
  | { type: "pair"; url: string; code: string }
  | { type: "reconnect" }
  | { type: "forget" }
  | { type: "credentials" }
  | { type: "client.disconnect" }
  | { type: "revoke.all" }
  | { type: "origin.granted"; origin: string }
  | { type: "origin.revoke"; origin: string }
  | { type: "tool.save"; definition: ToolDefinition; source: StoredToolVersion["source"] }
  | { type: "tool.nextVersion"; id: string }
  | { type: "tool.definition"; id: string; version: number }
  | { type: "tool.test"; id: string; version: number; args: Record<string, unknown> }
  | { type: "tool.enable"; id: string; version: number }
  | { type: "tool.disable"; id: string }
  | { type: "tool.delete"; id: string }
  | { type: "run.stop" }
  | { type: "approval.decide"; executionId: string; bindingHash: string; decision: "approve" | "reject" }
  | { type: "history.clear" }
  | { type: "settings.update"; settings: Partial<Settings> }
  | { type: "tab.show" }
  | { type: "tabs.candidates" }
  | { type: "record.start"; tabId: number }
  | { type: "record.stop" }
  | { type: "record.discard" }
  | { type: "record.pick"; mode: PickMode }
  | { type: "record.removePick"; id: string; list: "outputs" | "signals" }
  | { type: "record.spec" }
  // ---- test builds only (compiled out of production) ----
  | { type: "__test.setup"; definitions: ToolDefinition[]; origins: string[] }
  | { type: "__test.state" }
  | { type: "__test.swStartedAt" };

export type PanelResponse<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export interface TabCandidate {
  tabId: number;
  title: string;
  url: string;
  origin: string;
  allowed: boolean;
}

export interface TestOutcome {
  envelope: ResultEnvelope;
}

export type { DraftSpec, PanelState };

export const REQUEST_TAG = "__mycp_panel__";
export interface Envelope<R extends PanelRequest = PanelRequest> {
  [REQUEST_TAG]: true;
  req: R;
}
