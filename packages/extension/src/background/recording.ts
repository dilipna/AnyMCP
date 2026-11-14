// Recording session manager (service worker).
//
// Explicit start/stop only. Records only in the user-approved origin. The session (including typed
// example values the user may turn into parameters) lives in chrome.storage.session: memory only,
// survives worker suspension, never written to disk, gone when the browser closes.

import { randomHex } from "anymcp-protocol";
import type { PickMode, PickResult, RecordedEvent } from "../content/recorder";
import { buildDraft, paramNameFor, queryPartsFromSearch, type DraftParam, type DraftSpec, type DraftStep } from "../shared/draft";
import type { PickedOutputView, PickedSignalView, RecordedStepView, RecordingView } from "../shared/types";
import { getGrants, getSession, setSession } from "./storage";
import { send } from "./tabs";

export { buildDraft };

const SESSION_KEY = "recording";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Steps arrive slightly out of order (a checkbox's final state is read a moment after the click). Keep them in the order they happened. */
function insertInOrder(steps: RecordedStepView[], step: RecordedStepView) {
  let i = steps.length;
  while (i > 0 && steps[i - 1]!.seq > step.seq) i--;
  steps.splice(i, 0, step);
}

export class RecordingManager {
  private rec: RecordingView | null = null;
  private loaded = false;

  constructor(private readonly onChange: () => void) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    this.rec = await getSession<RecordingView | null>(SESSION_KEY, null);
  }

  private async save() {
    await setSession(SESSION_KEY, this.rec);
    this.onChange();
  }

  async view(): Promise<RecordingView | null> {
    await this.load();
    return this.rec;
  }

  get tabId(): number | null {
    return this.rec?.tabId ?? null;
  }

  async start(tabId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    await this.load();
    if (this.rec && this.rec.status !== "stopped") return { ok: false, error: "A recording is already in progress." };
    let url: string;
    try {
      const t = await chrome.tabs.get(tabId);
      url = t.url ?? "";
    } catch {
      return { ok: false, error: "That tab is not available." };
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, error: "AnyMCP can only record on web pages you have allowed." };
    }
    const origin = u.origin;
    const granted = (await getGrants())[origin] && (await chrome.permissions.contains({ origins: [`${origin}/*`] }));
    if (!granted) return { ok: false, error: `Allow AnyMCP to use ${origin} first (Permissions → Allow this site), then start recording.` };

    this.rec = {
      id: `rec_${randomHex(6)}`,
      tabId,
      origin,
      entryPath: u.pathname,
      entryQuery: queryPartsFromSearch(u.search),
      startedAt: new Date().toISOString(),
      status: "recording",
      steps: [],
      skippedSensitive: 0,
      outputs: [],
      signals: [],
      pick: null,
      notice: null,
    };
    await this.attach(tabId);
    await this.save();
    return { ok: true };
  }

  private async attach(tabId: number) {
    const rec = this.rec;
    if (!rec) return;
    for (let i = 0; i < 20; i++) {
      try {
        await send(tabId, { kind: "ping" }, 800);
      } catch {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        } catch {
          /* mid navigation */
        }
        await sleep(100);
        continue;
      }
      await send(tabId, { kind: "record.start", origin: rec.origin }, 3000);
      // A new document starts with no pick armed. If the user had armed one before navigating, re-arm it.
      if (rec.pick) await send(tabId, { kind: "record.pick", mode: rec.pick }, 1500).catch(() => undefined);
      return;
    }
  }

  async stop(): Promise<void> {
    await this.load();
    if (!this.rec) return;
    try {
      await send(this.rec.tabId, { kind: "record.stop" }, 1500);
    } catch {
      /* tab closed */
    }
    this.rec.status = "stopped";
    this.rec.pick = null;
    await this.save();
  }

  async discard(): Promise<void> {
    await this.load();
    if (this.rec && this.rec.status !== "stopped") await this.stop();
    this.rec = null;
    await this.save();
  }

  async setPick(mode: PickMode): Promise<void> {
    await this.load();
    if (!this.rec || this.rec.status !== "recording") return;
    this.rec.pick = mode;
    await send(this.rec.tabId, { kind: "record.pick", mode }, 1500).catch(() => undefined);
    await this.save();
  }

  /** Events arrive from the page. Ignore anything not from the recording tab. */
  async onEvent(event: RecordedEvent, tabId: number | undefined): Promise<void> {
    await this.load();
    const rec = this.rec;
    if (!rec || rec.status !== "recording" || tabId !== rec.tabId) return;
    if (event.t === "skipped") {
      rec.skippedSensitive++;
    } else if (event.t === "input") {
      const last = rec.steps[rec.steps.length - 1];
      const same = last && last.kind === "input" && last.seq < event.seq && JSON.stringify(last.locator) === JSON.stringify(event.locator);
      const step: RecordedStepView = {
        seq: event.seq,
        kind: "input",
        label: event.fieldLabel,
        locator: event.locator,
        quality: event.quality,
        example: event.example,
        ...(event.control && event.control !== "text" ? { control: event.control } : {}),
        ...(event.options ? { options: event.options } : {}),
      };
      if (same) rec.steps[rec.steps.length - 1] = step;
      else insertInOrder(rec.steps, step);
    } else if (event.t === "press") {
      insertInOrder(rec.steps, { seq: event.seq, kind: "press", label: event.targetLabel, locator: event.locator, quality: event.quality, effect: "ui" });
    } else {
      insertInOrder(rec.steps, {
        seq: event.seq,
        kind: "click",
        label: event.targetLabel,
        locator: event.locator,
        quality: event.quality,
        effect: event.effectGuess,
        ...(event.viaEnter ? { viaEnter: true } : {}),
        ...(event.options ? { options: event.options } : {}),
      });
    }
    await this.save();
  }

  async onPick(pick: PickResult, tabId: number | undefined): Promise<void> {
    await this.load();
    const rec = this.rec;
    if (!rec || tabId !== rec.tabId) return;
    rec.pick = null;
    const id = `p_${randomHex(4)}`;
    if (pick.mode === "success") {
      const sig: PickedSignalView = { id, kind: "success", locator: pick.locator, quality: pick.quality, preview: pick.preview };
      rec.signals.push(sig);
    } else if (pick.mode === "list") {
      rec.outputs.push({ id, name: `list_${rec.outputs.length + 1}`, kind: "list", locator: pick.locator, quality: pick.quality, preview: pick.preview, as: pick.links ? "link" : "string", optional: false, use: "result", maxRows: 50 });
    } else if (pick.mode === "table") {
      const columns: NonNullable<PickedOutputView["columns"]> = {};
      for (const h of pick.headers ?? []) columns[h] = { header: h, as: "string" };
      rec.outputs.push({ id, name: `table_${rec.outputs.length + 1}`, kind: "table", locator: pick.locator, quality: pick.quality, preview: pick.preview, as: "string", optional: false, use: "result", columns, maxRows: 50, ...(pick.headers ? {} : {}) });
    } else {
      rec.outputs.push({ id, name: `value_${rec.outputs.length + 1}`, kind: "text", locator: pick.locator, quality: pick.quality, preview: pick.preview, as: "string", optional: false, use: "result" });
    }
    await this.save();
  }

  /** The page navigated. Same origin: keep recording. Off origin: pause and say so. */
  async onTabUpdated(tabId: number, status: string | undefined, url: string | undefined): Promise<void> {
    await this.load();
    const rec = this.rec;
    if (!rec || tabId !== rec.tabId || rec.status === "stopped" || status !== "complete" || !url) return;
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      /* ignore */
    }
    if (origin !== rec.origin) {
      rec.status = "paused_off_origin";
      rec.notice = `The tab left ${rec.origin}. Recording is paused and nothing from the other site is captured. Go back to continue.`;
    } else {
      rec.status = "recording";
      rec.notice = null;
      await this.attach(tabId);
    }
    await this.save();
  }

  async onTabRemoved(tabId: number): Promise<void> {
    await this.load();
    if (this.rec && this.rec.tabId === tabId && this.rec.status !== "stopped") {
      this.rec.status = "stopped";
      this.rec.notice = "The tab was closed, so recording stopped.";
      await this.save();
    }
  }

  /** The first guess the user will edit. Every input becomes a parameter by default (so no typed value is kept). */
  async toSpec(): Promise<DraftSpec | null> {
    await this.load();
    const rec = this.rec;
    if (!rec) return null;
    const taken = new Set<string>();
    const params: DraftParam[] = [];
    const steps: DraftStep[] = rec.steps.map((s) => {
      if (s.kind === "input") {
        const control = s.control ?? "text";
        const base = { seq: s.seq, kind: "input" as const, label: s.label, locator: s.locator, effect: "ui" as const, enabled: true, ...(control !== "text" ? { control } : {}) };
        // choosing one option of a group is not a yes/no input: it is simply what the person did
        if (control === "radio") return { ...base, fill: { mode: "literal", text: "true" } };
        const name = paramNameFor(s.label, taken);
        if (control === "checkbox") {
          params.push({ name, description: `Whether “${s.label}” is ticked`, type: "boolean", example: "", maxLength: 200 });
        } else if (control === "select") {
          params.push({ name, description: `Choice for “${s.label}”`, type: "string", example: s.example ?? "", maxLength: 200, ...(s.options?.length ? { options: s.options } : {}) });
        } else {
          params.push({ name, description: `Value for “${s.label}”`, type: "string", example: s.example ?? "", maxLength: 200 });
        }
        return { ...base, fill: { mode: "param", param: name } };
      }
      if (s.kind === "press") return { seq: s.seq, kind: "press", label: s.label, locator: s.locator, effect: s.effect ?? "ui", fill: { mode: "skip" }, enabled: true };
      return { seq: s.seq, kind: "click", label: s.label, locator: s.locator, effect: s.effect ?? "ui", fill: { mode: "skip" }, enabled: true, ...(s.options ? { options: s.options } : {}) };
    });
    return {
      id: "new_tool",
      title: "New tool",
      description: "Describe what this tool does for the AI assistant.",
      origin: rec.origin,
      entryPath: rec.entryPath,
      entryQuery: rec.entryQuery ?? [],
      steps,
      params,
      outputs: rec.outputs.map(({ quality: _q, preview: _p, ...o }) => o),
      signals: rec.signals.map(({ quality: _q, preview: _p, ...s }) => s),
      approvalText: "",
    };
  }
}
