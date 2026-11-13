import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "anymcp-protocol";
import { call, useNow } from "../api";
import { Banner } from "../ui";

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Pre-empts everything. Shows the exact action and values; applies to this one run only. */
export function ApprovalSheet({ req }: { req: ApprovalRequest }) {
  const now = useNow(250);
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const total = Date.parse(req.expiresAt) - Date.parse(req.requestedAt);
  const left = Math.max(0, Date.parse(req.expiresAt) - now);

  // Move focus to the heading — NOT to Approve — so a stray Enter cannot approve anything.
  useEffect(() => heading.current?.focus(), [req.executionId]);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    const r = await call({ type: "approval.decide", executionId: req.executionId, bindingHash: req.bindingHash, decision });
    setBusy(null);
    if (!r.ok) setErr(r.error);
  }

  return (
    <section className="approval" role="alertdialog" aria-labelledby="ap-h" aria-describedby="ap-d">
      <div className="row between">
        <h2 id="ap-h" ref={heading} tabIndex={-1}>
          Approve this action?
        </h2>
        <span className="chip warn">Expires in {fmt(left)}</span>
      </div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${total > 0 ? (left / total) * 100 : 0}%` }} />
      </div>
      <p id="ap-d" className="muted">
        Your AI assistant asked to run <strong>{req.toolTitle}</strong> (v{req.toolVersion}) on <span className="mono">{req.origin.replace(/^https?:\/\//, "")}</span>.
      </p>
      <div className="action">{req.actionText}</div>

      <details open>
        <summary>Values this approval is tied to</summary>
        <dl className="kv" style={{ marginTop: 6 }}>
          {Object.entries(req.args).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt className="mono">{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
          {req.state.map((s) => (
            <div key={s.id} style={{ display: "contents" }}>
              <dt>{s.label}</dt>
              <dd>{s.value || <em>(empty)</em>} <small className="muted">on the page now</small></dd>
            </div>
          ))}
        </dl>
      </details>

      <Banner tone="info">
        This approval is for <strong>this one run only</strong>. If the page, these values or the button change before the click, AnyMCP cancels it and does nothing.
      </Banner>
      {err && <Banner tone="bad">{err}</Banner>}
      <div className="row">
        <button type="button" className="btn" disabled={!!busy} onClick={() => void decide("reject")}>
          {busy === "reject" ? "Declining…" : "Decline"}
        </button>
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => void decide("approve")}>
          {busy === "approve" ? "Approving…" : "Approve once"}
        </button>
        <button type="button" className="btn ghost small" onClick={() => void call({ type: "tab.show" })}>
          Show the page
        </button>
      </div>
    </section>
  );
}
