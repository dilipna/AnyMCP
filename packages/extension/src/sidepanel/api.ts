import { useEffect, useRef, useState } from "react";
import { REQUEST_TAG, type PanelRequest, type PanelResponse } from "../shared/panel-api";
import type { PanelState } from "../shared/types";

export async function call<T = unknown>(req: PanelRequest): Promise<PanelResponse<T>> {
  try {
    const res = (await chrome.runtime.sendMessage({ [REQUEST_TAG]: true, req })) as PanelResponse<T> | undefined;
    return res ?? { ok: false, error: "AnyMCP did not answer. Try again." };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

/** Live state pushed from the service worker over a port; re-connects if the worker restarts. */
export function usePanelState(): PanelState | null {
  const [state, setState] = useState<PanelState | null>(null);
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      port = chrome.runtime.connect({ name: "anymcp-panel" });
      port.onMessage.addListener((m: { type: string; state: PanelState }) => {
        if (m.type === "state") setState(m.state);
      });
      port.onDisconnect.addListener(() => {
        // The service worker is gone. An open approval or running tool cannot survive that (they live in the
        // worker's memory), so never keep offering them: drop them from the UI immediately, then reconnect.
        setState((s) => (s ? { ...s, approval: null, active: null } : s));
        if (!closed) timer = setTimeout(connect, 400);
      });
    };
    connect();
    void call<PanelState>({ type: "state" }).then((r) => r.ok && r.data && setState(r.data));
    return () => {
      closed = true;
      clearTimeout(timer);
      port?.disconnect();
    };
  }, []);
  return state;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useCopy(): [string | null, (text: string, id: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return [
    copied,
    (text, id) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(id);
        clearTimeout(t.current);
        t.current = setTimeout(() => setCopied(null), 1800);
      });
    },
  ];
}

export const ago = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
