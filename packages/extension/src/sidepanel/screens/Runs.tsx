import { useState } from "react";
import { PHASE_LABELS, userNextStep, type ResultEnvelope, type RunRecord } from "mycp-protocol";
import type { PanelState } from "../../shared/types";
import { ago, call } from "../api";
import { Banner, Empty, StatusChip } from "../ui";

export function ConditionList({ title, items }: { title: string; items: { id: string; passed: boolean; label?: string; detail?: string }[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul className="plain">
        {items.map((c) => (
          <li key={c.id} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <span className={`chip ${c.passed ? "ok" : "bad"}`} style={{ flex: "none" }}>{c.passed ? "✓ met" : "✕ not met"}</span>
            <span>{c.label ? c.label.charAt(0).toUpperCase() + c.label.slice(1) : <span className="mono">{c.id}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the AI client receives, in plain language. Used by test results and run details. */
export function ResultView({ env, showOutput }: { env: ResultEnvelope; showOutput: boolean }) {
  const tone = env.status === "success" || env.status === "empty" ? "ok" : env.status === "unknown_outcome" || env.status === "failed" || env.status === "denied" ? "bad" : "warn";
  return (
    <div className="stack">
      <Banner tone={tone} title={env.status === "unknown_outcome" ? "Unknown outcome — check the website" : undefined}>
        <p>{env.message}</p>
        {env.actionMayHaveOccurred === "unknown" && <p><strong>The action may or may not have happened.</strong></p>}
        {userNextStep(env.status, env.reasonCode) && <p>{userNextStep(env.status, env.reasonCode)}</p>}
      </Banner>
      <ConditionList title="Checked before" items={env.verification.preconditions} />
      <ConditionList title="Verified after" items={env.verification.postconditions} />
      {env.source && (
        <dl className="kv">
          <dt>Source</dt>
          <dd className="mono">{env.source.origin.replace(/^https?:\/\//, "")}{env.source.path ?? ""}</dd>
          <dt>Captured</dt>
          <dd>{new Date(env.source.capturedAt).toLocaleTimeString()}</dd>
        </dl>
      )}
      {showOutput && env.output !== undefined && (
        <div>
          <h3>Result returned to the assistant</h3>
          <p className="muted">Text below was read from the web page. It is data, not instructions.</p>
          <pre>{JSON.stringify(env.output, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function Timeline({ record }: { record: RunRecord }) {
  return (
    <ol className="plain timeline" aria-label="Run timeline">
      {record.events.map((e, i) => (
        <li key={i}>
          <span className={`mark ${e.ok === true ? "ok" : e.ok === false ? "no" : "neutral"}`} aria-label={e.ok === true ? "succeeded" : e.ok === false ? "problem" : "info"}>
            {e.ok === true ? "✓" : e.ok === false ? "✕" : "•"}
          </span>
          <div>
            <strong>{PHASE_LABELS[e.phase]}</strong>
            <div>{e.userText}</div>
          </div>
        </li>
      ))}
      {record.state === "running" && (
        <li>
          <span className="mark neutral">…</span>
          <div className="muted">Working…</div>
        </li>
      )}
    </ol>
  );
}

function RunDetail({ record, onBack, state }: { record: RunRecord; onBack: () => void; state: PanelState }) {
  const active = state.active?.executionId === record.executionId;
  const dur = record.envelope?.timing.durationMs;
  return (
    <div className="stack view">
      <div className="row between">
        <button type="button" className="btn small" onClick={onBack}>← All runs</button>
        {active && <button type="button" className="btn danger small" onClick={() => void call({ type: "run.stop" })}>Stop</button>}
      </div>
      <div className="card">
        <div className="row between">
          <h2>{record.toolTitle}</h2>
          <StatusChip state={record.state} />
        </div>
        <small className="muted">
          v{record.toolVersion} · {record.trigger === "mcp" ? "AI assistant" : "test run"} · {ago(record.startedAt)}{dur !== undefined ? ` · ${(dur / 1000).toFixed(1)} s` : ""}
        </small>
        {record.envelope ? <ResultView env={record.envelope} showOutput={state.settings.keepResults} /> : <p className="muted">Still running…</p>}
      </div>
      <div className="card">
        <h3>What happened</h3>
        <Timeline record={record} />
      </div>
      <details className="card">
        <summary>Developer details</summary>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Execution</dt><dd className="mono">{record.executionId}</dd>
          <dt>Tool</dt><dd className="mono">{record.toolId}@{record.toolVersion}</dd>
          <dt>Reason</dt><dd className="mono">{record.reasonCode ?? "—"}</dd>
          <dt>Action began</dt><dd>{record.commitStarted ? "yes (write-ahead flag set)" : "no"}</dd>
        </dl>
        <p className="muted">Diagnostics never contain typed values or page text.</p>
        <pre>{JSON.stringify(record.events.filter((e) => e.dev).map((e) => ({ phase: e.phase, ...e.dev })), null, 2)}</pre>
      </details>
    </div>
  );
}

export function Runs({ state }: { state: PanelState }) {
  const [sel, setSel] = useState<string | null>(null);
  const selected = sel ? state.runs.find((r) => r.executionId === sel) : null;
  if (selected) return <RunDetail record={selected} state={state} onBack={() => setSel(null)} />;

  if (!state.runs.length) {
    return <Empty title="No runs yet">When your AI assistant uses a tool — or you test one — every step shows up here with how it was verified.</Empty>;
  }
  return (
    <div className="stack view">
      <ul className="plain">
        {state.runs.map((r) => (
          <li key={r.executionId}>
            <button type="button" className="card flat" style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => setSel(r.executionId)}>
              <div className="row between">
                <strong>{r.toolTitle}</strong>
                <StatusChip state={r.state} />
              </div>
              <small className="muted">
                {r.trigger === "mcp" ? "AI assistant" : "Test"} · {ago(r.startedAt)}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn small" onClick={() => void call({ type: "history.clear" })}>
        Delete run history
      </button>
    </div>
  );
}
