import type { ReactNode } from "react";
import type { RunState } from "anymcp-protocol";
import { useCopy } from "./api";

export const STATUS_VIEW: Record<RunState, { label: string; tone: "ok" | "warn" | "bad" | "info"; icon: string }> = {
  success: { label: "Verified", tone: "ok", icon: "✓" },
  empty: { label: "No results (verified)", tone: "ok", icon: "✓" },
  denied: { label: "Blocked", tone: "bad", icon: "⛔" },
  invalid_input: { label: "Invalid input", tone: "warn", icon: "!" },
  precondition_failed: { label: "Stopped safely", tone: "warn", icon: "!" },
  rejected: { label: "Declined", tone: "warn", icon: "!" },
  approval_expired: { label: "Approval expired", tone: "warn", icon: "!" },
  approval_invalidated: { label: "Approval withdrawn", tone: "warn", icon: "!" },
  cancelled_before_action: { label: "Stopped — nothing changed", tone: "warn", icon: "■" },
  interrupted: { label: "Interrupted — safe to retry", tone: "warn", icon: "!" },
  unknown_outcome: { label: "Unknown outcome", tone: "bad", icon: "?" },
  failed: { label: "Failed", tone: "bad", icon: "✕" },
  awaiting_approval: { label: "Waiting for approval", tone: "warn", icon: "…" },
  running: { label: "Running", tone: "info", icon: "▶" },
};

export function StatusChip({ state }: { state: RunState }) {
  const v = STATUS_VIEW[state];
  return (
    <span className={`chip ${v.tone}`}>
      <span aria-hidden="true">{v.icon} </span>
      {v.label}
    </span>
  );
}

export function Banner({ tone, title, children }: { tone: "info" | "ok" | "warn" | "bad"; title?: string; children?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === "bad" || tone === "warn" ? "alert" : "status"}>
      {title && <strong className="banner-title">{title}</strong>}
      {children}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {hint && <span className="hint">{hint}</span>}
      {children}
    </label>
  );
}

export function CopyLine({ text, shown, id, label }: { text: string; shown?: string; id: string; label: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="copy">
      <code aria-label={label} tabIndex={0}>
        {shown ?? text}
      </code>
      <button type="button" className="btn small" onClick={() => copy(text, id)} aria-label={`Copy: ${label}`}>
        {copied === id ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export const originLabel = (o: string) => o.replace(/^https?:\/\//, "");
