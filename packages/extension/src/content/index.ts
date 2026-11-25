// Content script entry. Injected programmatically (chrome.scripting) into user-approved origins only.
// It trusts ONLY messages from this extension's own service worker. Page scripts cannot reach
// chrome.runtime.onMessage, and window.postMessage from the page is never listened to.

import type { ContentReply, FromContent, PingResult, ToContent } from "../shared/messages";
import { hideBanner, showBanner } from "./banner";
import { NO_WATCH, captureOutline, commit, evalConditions, peekBinding, prepareCommit, runStep, terminalNow, type RunContext } from "./engine";
import { startRecording, stopRecording, setPickMode, isRecording } from "./recorder";

declare global {
  interface Window {
    __anymcpContent?: true;
  }
}

if (!window.__anymcpContent) {
  window.__anymcpContent = true;
  let run: RunContext | null = null;

  const post = (m: FromContent) => void chrome.runtime.sendMessage(m).catch(() => undefined);

  chrome.runtime.onMessage.addListener((raw: ToContent, sender, sendResponse: (r: ContentReply) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false; // only our own service worker
    void (async () => {
      switch (raw.kind) {
        case "ping": {
          const r: PingResult = { runId: run?.runId ?? null, url: location.href, readyState: document.readyState, recording: isRecording() };
          return sendResponse(r);
        }
        case "begin": {
          run?.change?.observer.disconnect();
          run = { runId: raw.runId, args: raw.args, origins: raw.origins, bindings: new Map() };
          showBanner(`AnyMCP is running “${raw.title}”`, "running", () => post({ kind: "content.stop", runId: raw.runId }));
          return sendResponse({ ok: true });
        }
        case "end": {
          run?.change?.observer.disconnect();
          run = null;
          hideBanner();
          return sendResponse({ ok: true });
        }
        case "eval":
          return sendResponse({ results: run ? evalConditions(raw.list, run.args) : [] });
        case "terminal":
          return sendResponse({ terminal: run ? terminalNow(raw.watch ?? NO_WATCH, run.args) : null });
        case "step":
          if (!run) return sendResponse({ ok: false, code: "stale_element", detail: "No run is active in this page." });
          return sendResponse(await runStep(run, raw.step, raw.watch, raw.timeoutMs, raw.arm));
        case "prepare-commit":
          if (!run) return sendResponse({ ok: false, code: "stale_element", detail: "No run is active in this page." });
          return sendResponse(prepareCommit(run, raw.target, raw.fields, raw.action));
        case "peek":
          if (!run) return sendResponse({ ok: false, code: "stale_element", detail: "No run is active in this page." });
          return sendResponse(peekBinding(run, raw.target, raw.fields));
        case "commit":
          if (!run) return sendResponse({ ok: false, code: "stale_element", detail: "No run is active in this page." });
          return sendResponse(await commit(run, raw.target, raw.fields, raw.expected, raw.action));
        case "outline":
          return sendResponse({ outline: captureOutline() });
        case "record.start":
          startRecording(raw.origin, (event) => post({ kind: "record.event", event }), (pick) => post({ kind: "record.pick.done", pick }), () => post({ kind: "record.stop-requested" }));
          return sendResponse({ ok: true });
        case "record.stop":
          stopRecording();
          return sendResponse({ ok: true });
        case "record.pick":
          setPickMode(raw.mode);
          return sendResponse({ ok: true });
      }
    })();
    return true; // async response
  });
}
