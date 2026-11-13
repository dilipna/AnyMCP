// Tab handling for runs.
//
//  - AnyMCP runs workflows in a tab IT owns (one per origin, reused). It never navigates a tab the user opened.
//  - The content script is injected on demand, only into origins the user granted.
//  - A lost message is classified: tab gone (closed), or document replaced (navigation).
//  - After navigation, content-script state (element bindings) is gone by design; the engine re-locates.

import { getSession, setSession } from "./storage";
import type { ContentReply, PingResult, ToContent } from "../shared/messages";

export class TabError extends Error {
  constructor(readonly kind: "closed" | "gone" | "denied" | "timeout", message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getOwnedTabs(): Promise<Record<string, number>> {
  return getSession<Record<string, number>>("ownedTabs", {});
}

async function tabExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

export async function waitComplete(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === "complete" && t.url) return;
    } catch {
      throw new TabError("closed", "The tab was closed.");
    }
    await sleep(100);
  }
  throw new TabError("timeout", "The page did not finish loading in time.");
}

/**
 * Get a tab AnyMCP owns for this origin and point it at `entryUrl` (same origin as `origin`).
 * Reuses the previous AnyMCP tab when it still exists; otherwise opens a new background tab.
 */
export async function acquireTab(origin: string, entryUrl: string, timeoutMs: number): Promise<number> {
  const owned = await getOwnedTabs();
  let tabId = owned[origin];
  if (tabId === undefined || !(await tabExists(tabId))) {
    const tab = await chrome.tabs.create({ url: entryUrl, active: false });
    if (tab.id === undefined) throw new TabError("gone", "Chrome did not open a tab.");
    tabId = tab.id;
    owned[origin] = tabId;
    await setSession("ownedTabs", owned);
  } else {
    await chrome.tabs.update(tabId, { url: entryUrl });
    await sleep(50); // let the navigation start so we do not read the OLD page's "complete" status
  }
  await waitComplete(tabId, timeoutMs);
  return tabId;
}

export async function tabUrl(tabId: number): Promise<string | null> {
  try {
    return (await chrome.tabs.get(tabId)).url ?? null;
  } catch {
    return null;
  }
}

export async function showTab(tabId: number): Promise<void> {
  try {
    const t = await chrome.tabs.update(tabId, { active: true });
    if (t?.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
  } catch {
    /* tab is gone */
  }
}

/** Send a message to the content script, classifying failures. */
export async function send<T extends ContentReply>(tabId: number, msg: ToContent, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new TabError("timeout", "The page did not respond.")), timeoutMs);
    });
    return (await Promise.race([chrome.tabs.sendMessage(tabId, msg) as Promise<T>, timeout])) as T;
  } catch (e) {
    if (e instanceof TabError) throw e;
    if (!(await tabExists(tabId))) throw new TabError("closed", "The tab was closed.");
    throw new TabError("gone", String((e as Error).message ?? e)); // document replaced or script not present
  } finally {
    clearTimeout(timer);
  }
}

async function inject(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (e) {
    if (!(await tabExists(tabId))) throw new TabError("closed", "The tab was closed.");
    const msg = String((e as Error).message ?? e);
    if (/cannot access|permission|extensions gallery/i.test(msg)) throw new TabError("denied", "AnyMCP does not have permission to use this page.");
    // otherwise: the document is mid-navigation; the caller retries
  }
}

/**
 * Make sure THIS document has the content script and (optionally) the run context.
 * `begin` is re-sent after every navigation because a new document starts with no run.
 */
export async function ensureContent(
  tabId: number,
  allowedOrigins: string[],
  begin: Extract<ToContent, { kind: "begin" }> | null,
  timeoutMs = 8000,
): Promise<PingResult> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const ping = await send<PingResult>(tabId, { kind: "ping" }, 1500);
      if (ping.readyState !== "loading") {
        const origin = new URL(ping.url).origin;
        if (!allowedOrigins.includes(origin)) throw new TabError("denied", `The tab is now on ${origin}, which this tool may not use.`);
        if (begin && ping.runId !== begin.runId) await send(tabId, begin, 3000);
        return ping;
      }
    } catch (e) {
      if (e instanceof TabError && (e.kind === "closed" || e.kind === "denied")) throw e;
      lastError = String((e as Error).message ?? e);
      await inject(tabId);
    }
    await sleep(100);
  }
  throw new TabError("timeout", `The page was not ready for AnyMCP (${lastError || "still loading"}).`);
}

/** Wait until the document in the tab is a different one than `previousUrl`/doc. Used after a navigating click. */
export async function waitForNewDocument(tabId: number, previous: { url: string; runIdBefore: string | null }, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new TabError("closed", "The tab was closed.");
    if (t.status === "complete" && t.url && t.url !== previous.url) return true;
    // same-URL reload or SPA: if the content script lost its run context, the document was replaced
    try {
      const ping = await send<PingResult>(tabId, { kind: "ping" }, 800);
      if (previous.runIdBefore !== null && ping.runId === null) return true;
    } catch {
      /* mid-navigation */
    }
    await sleep(100);
  }
  return false;
}
