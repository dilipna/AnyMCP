// AnyMCP Extension service worker. Wires: bridge client <-> orchestrator <-> side panel <-> recording.
//
// MV3 rules honoured here:
//  - every listener is registered synchronously at top level (the worker can be torn down at any time)
//  - no state is trusted to survive: run progress is journaled; in-flight runs found after a restart are
//    finalised honestly (see Orchestrator.recoverInterrupted); the bridge socket is re-established
//  - nothing consequential is retried automatically

import "../shared/zod-init";
import { ANYMCP_VERSION, newExecutionId, toolDefinitionHash, type ResultEnvelope, type RunRecord } from "anymcp-protocol";
import type { FromContent } from "../shared/messages";
import { REQUEST_TAG, type PanelRequest, type PanelResponse, type TabCandidate } from "../shared/panel-api";
import { isTrustedPanelSender } from "../shared/sender";
import type { PanelState, TestOutcomeView } from "../shared/types";
import { ApprovalCenter } from "./approvals";
import { BridgeClient, DEFAULT_BRIDGE_URL } from "./bridge-client";
import { Orchestrator } from "./orchestrator";
import { RecordingManager } from "./recording";
import * as store from "./storage";
import { getOwnedTabs, showTab } from "./tabs";

declare const __ANYMCP_TEST__: boolean;
const IS_TEST = typeof __ANYMCP_TEST__ !== "undefined" && __ANYMCP_TEST__;

/**
 * Test-only hooks. In the production build `__ANYMCP_TEST__` is the constant `false`, so this whole expression folds to
 * `null` and the hook code and its strings are REMOVED from the shipped bundle (verified by a build test), not merely
 * disabled at runtime.
 */
const TEST_HOOKS =
  typeof __ANYMCP_TEST__ !== "undefined" && __ANYMCP_TEST__
    ? {
        prefix: "__test.",
        startedAt: Date.now(), // lets a test prove the worker really was restarted
        async handle(req: PanelRequest): Promise<PanelResponse> {
          if (req.type === "__test.setup") {
            for (const o of req.origins) await store.addGrant(o);
            for (const def of req.definitions) {
              const hash = await toolDefinitionHash(def);
              if (!(await store.getToolVersion(def.id, def.version))) await store.saveDraft(def, "sample");
              await store.markTested(def.id, def.version, hash);
              await store.setStatus(def.id, def.version, "enabled");
            }
            await syncIfConnected();
            return { ok: true };
          }
          if (req.type === "__test.state") return { ok: true, data: await buildState() };
          if (req.type === "__test.swStartedAt") return { ok: true, data: TEST_HOOKS_STARTED() };
          return { ok: false, error: "Unknown request." };
        },
      }
    : null;
const TEST_HOOKS_STARTED = () => (TEST_HOOKS ? TEST_HOOKS.startedAt : 0);

// ---------------------------------------------------------------- panel state broadcast
const panelPorts = new Set<chrome.runtime.Port>();
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let lastTest: TestOutcomeView | null = null;

async function buildState(): Promise<PanelState> {
  const [tools, grants, runs, settings, recording] = await Promise.all([store.listToolRows(), store.getGrants(), store.getRuns(), store.getSettings(), recordingMgr.view()]);
  return {
    version: ANYMCP_VERSION,
    isTestBuild: IS_TEST,
    conn: bridge.view(),
    tools,
    grants: Object.entries(grants).map(([origin, g]) => ({ origin, grantedAt: g.grantedAt })),
    runs: runs.slice(-50).reverse(),
    active: orchestrator.view(),
    approval: approvals.current(),
    settings,
    recording,
    lastTest,
  };
}

function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    if (panelPorts.size === 0) return;
    const state = await buildState();
    for (const p of panelPorts) {
      try {
        p.postMessage({ type: "state", state });
      } catch {
        panelPorts.delete(p);
      }
    }
  }, 40);
}

function setBadge(kind: "idle" | "running" | "approval") {
  const text = kind === "idle" ? "" : kind === "running" ? "RUN" : "OK?";
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color: kind === "approval" ? "#b54708" : "#0b57d0" });
  void chrome.action.setTitle({ title: kind === "idle" ? "AnyMCP" : kind === "running" ? "AnyMCP is running a tool" : "AnyMCP needs your approval" });
}

// ---------------------------------------------------------------- core objects
const approvals = new ApprovalCenter(broadcast);
const recordingMgr = new RecordingManager(broadcast);

const bridge: BridgeClient = new BridgeClient({
  onRunRequest: (m) => {
    void orchestrator.start({ executionId: m.executionId, toolId: m.toolId, version: m.version, definitionHash: m.definitionHash, args: m.args, trigger: "mcp" });
  },
  onRunCancel: (m) => {
    if (orchestrator.active?.req.executionId === m.executionId) orchestrator.stop(m.reason === "bridge_shutdown" ? "bridge_shutdown" : "client_cancelled");
  },
  onReady: () => {
    void (async () => {
      await recoverInterrupted();
      await bridge.syncTools();
      await bridge.resendPending();
    })();
  },
  onDown: () => {
    // An approval prompt that can no longer be answered over the bridge is withdrawn: never leave a stale prompt armed.
    const a = orchestrator.active;
    if (a && a.req.trigger === "mcp" && a.record.state === "awaiting_approval") orchestrator.stop("bridge_shutdown");
  },
  onChange: broadcast,
});

const orchestrator: Orchestrator = new Orchestrator({
  approvals,
  sendEvent: (id, phase, detail) => bridge.sendEvent(id, phase, detail),
  sendResult: (env: ResultEnvelope, recovered?: boolean) => void bridge.sendResult(env, recovered),
  requestResync: () => void bridge.syncTools(),
  onChange: broadcast,
  setBadge,
});

async function recoverInterrupted() {
  if (orchestrator.active) return;
  const runs: RunRecord[] = await store.getRuns();
  const envs = await orchestrator.recoverInterrupted(runs);
  for (const env of envs) await bridge.sendResult(env, true);
  if (envs.length) broadcast();
}

async function startup() {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  await chrome.alarms.create("anymcp-keepalive", { periodInMinutes: 0.5 });
  await recoverInterrupted();
  await bridge.init();
}

// ---------------------------------------------------------------- listeners (top level, synchronous)
chrome.runtime.onInstalled.addListener(() => void startup());
chrome.runtime.onStartup.addListener(() => void startup());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "anymcp-keepalive") void bridge.init();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "anymcp-panel" || port.sender?.id !== chrome.runtime.id) return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  void buildState().then((state) => port.postMessage({ type: "state", state }));
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => void recordingMgr.onTabUpdated(tabId, info.status, tab.url));
chrome.tabs.onRemoved.addListener((tabId) => void recordingMgr.onTabRemoved(tabId));

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (r: PanelResponse) => void) => {
  const m = msg as { [REQUEST_TAG]?: true; req?: PanelRequest } & Partial<FromContent>;
  // ---- from an extension page (side panel): must carry our tag AND come from our own extension origin ----
  if (m && m[REQUEST_TAG] && m.req) {
    if (!isTrustedPanelSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: "Not allowed." });
      return false;
    }
    void handlePanel(m.req).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) }));
    return true;
  }
  // ---- from one of our content scripts ----
  if (sender.id === chrome.runtime.id && sender.tab && m && "kind" in m) {
    const c = m as FromContent;
    if (c.kind === "content.stop") {
      if (orchestrator.active?.req.executionId === c.runId) orchestrator.stop("user_stopped");
    } else if (c.kind === "record.event") void recordingMgr.onEvent(c.event as never, sender.tab.id);
    else if (c.kind === "record.pick.done") void recordingMgr.onPick(c.pick as never, sender.tab.id);
    else if (c.kind === "record.stop-requested") void recordingMgr.stop();
  }
  return false;
});

// ---------------------------------------------------------------- panel API
const ok = <T>(data?: T): PanelResponse<T> => ({ ok: true, data });
const fail = (error: string): PanelResponse<never> => ({ ok: false, error });

async function syncIfConnected() {
  if (bridge.connected) await bridge.syncTools();
  broadcast();
}

async function handlePanel(req: PanelRequest): Promise<PanelResponse> {
  if (TEST_HOOKS && req.type.startsWith(TEST_HOOKS.prefix)) return TEST_HOOKS.handle(req);
  switch (req.type) {
    case "state":
      return ok(await buildState());

    // ---- connection ----
    case "pair": {
      const r = await bridge.pair(req.url || DEFAULT_BRIDGE_URL, req.code);
      return r.ok ? ok() : fail(r.error);
    }
    case "reconnect":
      await bridge.connect();
      return ok();
    case "forget":
      await bridge.forget();
      return ok();
    case "credentials":
      return ok(await bridge.requestCredentials());
    case "client.disconnect":
      return ok(await bridge.disconnectClient());

    // ---- complete revocation: tools off, site access removed, bridge unpaired, token rotated ----
    case "revoke.all": {
      orchestrator.stop("user_stopped");
      await store.disableAllTools();
      const grants = await store.getGrants();
      for (const origin of Object.keys(grants)) await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
      await store.clearGrants();
      await bridge.revokeAll();
      broadcast();
      return ok();
    }

    // ---- origins ----
    case "origin.granted": {
      // The panel called chrome.permissions.request inside a click. Verify Chrome really granted it.
      if (!(await chrome.permissions.contains({ origins: [`${req.origin}/*`] }))) return fail("Chrome did not grant access to that site.");
      await store.addGrant(req.origin);
      broadcast();
      return ok();
    }
    case "origin.revoke": {
      await chrome.permissions.remove({ origins: [`${req.origin}/*`] }).catch(() => false);
      await store.removeGrant(req.origin);
      for (const row of await store.listToolRows()) if (row.origins.includes(req.origin)) await store.disableTool(row.id);
      await syncIfConnected();
      return ok();
    }

    // ---- tools ----
    case "tool.nextVersion":
      return ok(await store.nextVersion(req.id));
    case "tool.definition": {
      const v = await store.getToolVersion(req.id, req.version);
      return v ? ok(v.definition) : fail("That tool version does not exist.");
    }
    case "tool.save": {
      const hash = await store.saveDraft(req.definition, req.source);
      broadcast();
      return ok({ hash });
    }
    case "tool.test": {
      if (orchestrator.active) return fail("A run is already in progress.");
      const v = await store.getToolVersion(req.id, req.version);
      if (!v) return fail("That tool version does not exist.");
      const env = await orchestrator.start({ executionId: newExecutionId(), toolId: req.id, version: req.version, args: req.args, trigger: "test" });
      if (env.status === "success") await store.markTested(req.id, req.version, v.definitionHash);
      const record = (await store.getRuns()).find((r) => r.executionId === env.executionId);
      if (record) lastTest = { toolId: req.id, version: req.version, at: new Date().toISOString(), record };
      broadcast();
      return ok({ envelope: env });
    }
    case "tool.enable": {
      await store.setStatus(req.id, req.version, "enabled");
      await syncIfConnected();
      return ok();
    }
    case "tool.disable":
      await store.disableTool(req.id);
      await syncIfConnected();
      return ok();
    case "tool.delete":
      await store.deleteTool(req.id);
      await syncIfConnected();
      return ok();

    // ---- runs / approvals ----
    case "run.stop": {
      const r = orchestrator.stop("user_stopped");
      return ok(r);
    }
    case "approval.decide": {
      const r = approvals.decide(req.executionId, req.bindingHash, req.decision);
      return r.ok ? ok() : fail(r.error);
    }
    case "history.clear":
      await store.clearRuns();
      lastTest = null;
      broadcast();
      return ok();
    case "settings.update": {
      await store.saveSettings({ ...(await store.getSettings()), ...req.settings });
      broadcast();
      return ok();
    }
    case "tab.show": {
      const owned = await getOwnedTabs();
      const id = orchestrator.active?.tabId ?? Object.values(owned)[0];
      if (id !== undefined && id !== null) await showTab(id);
      return ok();
    }

    // ---- recording ----
    case "tabs.candidates": {
      const grants = await store.getGrants();
      const tabs = await chrome.tabs.query({ currentWindow: true });
      // AnyMCP's own automation tabs are not offered: the next tool run would navigate them away mid-recording
      const owned = new Set(Object.values(await getOwnedTabs()));
      const out: TabCandidate[] = [];
      for (const t of tabs) {
        if (t.id === undefined || owned.has(t.id) || !t.url || !/^https?:/.test(t.url)) continue;
        const origin = new URL(t.url).origin;
        out.push({ tabId: t.id, title: (t.title ?? t.url).slice(0, 80), url: t.url, origin, allowed: !!grants[origin] });
      }
      return ok(out);
    }
    case "tabs.hidden": {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return ok(tabs.filter((t) => !t.url && !t.pendingUrl).length);
    }
    case "record.start": {
      if (orchestrator.active) return fail("Wait for the running tool to finish before recording.");
      if (Object.values(await getOwnedTabs()).includes(req.tabId)) return fail("That is a tab AnyMCP uses to run tools. Open the website in a tab of your own and record there.");
      const r = await recordingMgr.start(req.tabId);
      return r.ok ? ok() : fail(r.error);
    }
    case "record.stop":
      await recordingMgr.stop();
      return ok();
    case "record.discard":
      await recordingMgr.discard();
      return ok();
    case "record.pick":
      await recordingMgr.setPick(req.mode);
      return ok();
    case "record.removePick": {
      const rec = await recordingMgr.view();
      if (rec) {
        rec[req.list] = rec[req.list].filter((x: { id: string }) => x.id !== req.id) as never;
        await chrome.storage.session.set({ recording: rec });
        broadcast();
      }
      return ok();
    }
    case "record.spec":
      return ok(await recordingMgr.toSpec());

    default:
      return fail("Unknown request.");
  }
}

// run once per worker start (also covers the very first load after install)
void startup();
