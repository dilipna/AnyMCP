import { useState } from "react";
import { call, usePanelState } from "./api";
import { ApprovalSheet } from "./screens/Approval";
import { Connect } from "./screens/Connect";
import { Record } from "./screens/Record";
import { Runs } from "./screens/Runs";
import { Settings } from "./screens/Settings";
import { Tools } from "./screens/Tools";
import { Loading } from "./ui";

type View = "tools" | "record" | "runs" | "settings";
const TABS: { id: View; label: string }[] = [
  { id: "tools", label: "Tools" },
  { id: "record", label: "Teach" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const state = usePanelState();
  const [view, setView] = useState<View>("tools");
  const [selected, setSelected] = useState<string | null>(null);

  if (!state) {
    return (
      <div className="app">
        <header className="top"><span className="brand">MyCP</span></header>
        <main><Loading /></main>
      </div>
    );
  }

  const c = state.conn;
  const connPill =
    c.state === "connected" ? { cls: "ok", text: "Connected" } : c.state === "connecting" ? { cls: "warn", text: "Connecting…" } : c.state === "unpaired" ? { cls: "", text: "Not connected" } : { cls: "bad", text: "Bridge offline" };
  const awaiting = !!state.approval;

  return (
    <div className="app">
      <header className="top">
        <span className="brand">MyCP</span>
        <span className={`pill ${connPill.cls}`} title={c.error ?? undefined}>
          <span className="dot" aria-hidden="true" />
          {connPill.text}
        </span>
        <span className="spacer" />
        {/* Persistent automation indicator + immediate stop. Always visible while anything runs. */}
        <div aria-live="polite" role="status" className="row">
          {state.active && (
            <>
              <span className={`pill ${awaiting ? "warn" : "run"}`}>
                <span className="dot" aria-hidden="true" />
                {awaiting ? "Needs your approval" : `Running “${state.active.toolTitle}”`}
              </span>
              <button type="button" className="btn danger small" onClick={() => void call({ type: "run.stop" })}>
                Stop
              </button>
            </>
          )}
          {!state.active && state.recording?.status === "recording" && (
            <span className="pill run"><span className="dot" aria-hidden="true" />Recording</span>
          )}
        </div>
      </header>

      <nav className="nav" aria-label="MyCP sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={view === t.id ? "page" : undefined} onClick={() => { setView(t.id); if (t.id !== "tools") setSelected(null); }}>
            {t.label}
            {t.id === "runs" && awaiting ? " •" : ""}
          </button>
        ))}
      </nav>

      <main>
        {state.approval && <ApprovalSheet req={state.approval} />}

        {view === "tools" && (
          <>
            {!c.paired && !selected && <Connect state={state} compact />}
            {c.paired && c.state !== "connected" && !selected && (
              <div className="banner warn" role="alert">
                <strong>Your AI assistant can’t reach MyCP right now</strong>
                <p>{c.error ?? "The bridge is not running."} MyCP keeps trying to reconnect.</p>
                <button type="button" className="btn small" onClick={() => void call({ type: "reconnect" })}>Reconnect now</button>
              </div>
            )}
            <Tools state={state} selected={selected} setSelected={setSelected} goRecord={() => setView("record")} />
          </>
        )}
        {view === "record" && <Record state={state} onSaved={(id) => { setSelected(id); setView("tools"); }} />}
        {view === "runs" && <Runs state={state} />}
        {view === "settings" && <Settings state={state} />}
      </main>
    </div>
  );
}
