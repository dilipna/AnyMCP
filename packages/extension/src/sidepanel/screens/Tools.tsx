import { useEffect, useMemo, useState } from "react";
import {
  ToolDefinitionZ,
  deriveReviewSummary,
  describeStep,
  validateToolPolicy,
  type ResultEnvelope,
  type ReviewSummary,
  type ToolDefinition,
} from "anymcp-protocol";
import type { PanelState, ToolRow, ToolStatus } from "../../shared/types";
import { call } from "../api";
import { Banner, Empty, Field, Loading, originLabel } from "../ui";
import { ResultView } from "./Runs";

const STATUS_CHIP: Record<ToolStatus, { label: string; cls: string }> = {
  draft: { label: "Draft — needs a test", cls: "warn" },
  tested: { label: "Tested — not enabled", cls: "info" },
  enabled: { label: "Enabled", cls: "ok" },
  disabled: { label: "Disabled", cls: "" },
  superseded: { label: "Replaced", cls: "" },
};

export function ReviewCard({ s, collapsed = false }: { s: ReviewSummary; collapsed?: boolean }) {
  const changeTone = s.changes.level === "commit" ? "warn" : s.changes.level === "ui_only" ? "info" : "ok";
  const changeShort = s.changes.level === "commit" ? "Data on the site (after approval)" : s.changes.level === "ui_only" ? "Fills in fields only" : "Nothing";
  const open = !collapsed;
  return (
    <div className="card" aria-label="Tool review">
      <h3>What this tool can do</h3>
      <p style={{ margin: 0 }}>{s.authorDescription}</p>
      <small className="muted">Written by the tool’s author. Everything below is generated from what AnyMCP will actually enforce.</small>

      <dl className="glance">
        <div><dt>Runs only on</dt><dd className="mono">{s.runsOn.map(originLabel).join(", ")}</dd></div>
        <div><dt>Reads</dt><dd>{s.reads.length} value{s.reads.length === 1 ? "" : "s"}</dd></div>
        <div><dt>May change</dt><dd><span className={`chip ${changeTone}`}>{changeShort}</span></dd></div>
        <div><dt>Approval</dt><dd>{s.approval.required ? "Every single run" : "Not needed"}</dd></div>
      </dl>

      <details className="sec" open={open}>
        <summary>What data it reads</summary>
        {s.inputs.length > 0 && <p className="muted">Takes: {s.inputs.map((i) => `${i.name}${i.constraint ? ` (${i.constraint})` : ""}`).join(", ")}</p>}
        <ul>{s.reads.map((r) => <li key={r.field}><span className="mono">{r.field}</span> — <span className="muted">{r.from}</span></li>)}</ul>
        <small className="muted">Starts at <span className="mono">{s.startsAt}</span>. It uses a tab AnyMCP opens itself and never navigates your other tabs.</small>
      </details>

      <details className="sec" open={open}>
        <summary>What it may change</summary>
        <p><strong>{s.changes.headline}.</strong></p>
        {s.changes.lines.length > 0 && <ul>{s.changes.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </details>

      <details className="sec" open={open}>
        <summary>When approval is required</summary>
        <p><strong>{s.approval.headline}.</strong> {s.approval.detail}</p>
      </details>

      <details className="sec" open={open}>
        <summary>How success is verified</summary>
        <p className="muted">A click or a successful page load is never treated as proof.</p>
        {s.verification.before.length > 0 && (<><strong>Before it starts, it checks that</strong><ul>{s.verification.before.map((v, i) => <li key={i}>{v}</li>)}</ul></>)}
        {s.verification.after.length > 0 && (<><strong>Afterwards it must observe that</strong><ul>{s.verification.after.map((v, i) => <li key={i}>{v}</li>)}</ul></>)}
        {s.verification.emptyResult.length > 0 && (<><strong>A valid “nothing found” is when</strong><ul>{s.verification.emptyResult.map((v, i) => <li key={i}>{v}</li>)}</ul></>)}
        {s.verification.siteFailure.length > 0 && (<><strong>It stops and reports a failure if</strong><ul>{s.verification.siteFailure.map((v, i) => <li key={i}>{v}</li>)}</ul></>)}
        {s.verification.sessionExpired.length > 0 && (<><strong>It treats your session as expired if</strong><ul>{s.verification.sessionExpired.map((v, i) => <li key={i}>{v}</li>)}</ul></>)}
      </details>

      {s.fragile > 0 && (
        <Banner tone="warn" title="May break if the site changes">
          {s.fragile} place{s.fragile === 1 ? "" : "s"} in this tool find{s.fragile === 1 ? "s" : ""} an element by page layout (CSS) because the page offers no clearer handle. If the site is redesigned, AnyMCP will stop and tell you — it will not guess.
        </Banner>
      )}
      <details className="sec">
        <summary>Safety rules that always apply</summary>
        <ul>{s.guarantees.map((g, i) => <li key={i}>{g}</li>)}</ul>
      </details>
    </div>
  );
}

function TestForm({ def, row, version, state }: { def: ToolDefinition; row: ToolRow; version: number; state: PanelState }) {
  const props = Object.entries(def.input.properties);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState<ResultEnvelope | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const blocked = !!state.active || (state.recording && state.recording.status !== "stopped");

  async function run() {
    setBusy(true);
    setErr(null);
    setEnv(null);
    const args: Record<string, unknown> = {};
    for (const [k, schema] of props) {
      const v = vals[k] ?? "";
      if (v === "") continue;
      args[k] = schema.type === "integer" || schema.type === "number" ? Number(v) : schema.type === "boolean" ? v === "true" : v;
    }
    const r = await call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: row.id, version, args });
    setBusy(false);
    if (r.ok && r.data) setEnv(r.data.envelope);
    else setErr(r.ok ? "No answer." : r.error);
  }

  return (
    <div className="card">
      <h3>Test it</h3>
      <p className="muted">
        Runs the tool for real in an AnyMCP tab.{def.kind === "write" && <> This tool changes data, so <strong>you will be asked to approve</strong> the action.</>}
      </p>
      {props.map(([name, schema]) => (
        <Field key={name} label={name} hint={schema.description}>
          {schema.type === "boolean" ? (
            <select value={vals[name] ?? ""} onChange={(e) => setVals({ ...vals, [name]: e.target.value })}>
              <option value="">Choose…</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : schema.type === "string" && schema.enum ? (
            <select value={vals[name] ?? ""} onChange={(e) => setVals({ ...vals, [name]: e.target.value })}>
              <option value="">Choose…</option>
              {schema.enum.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input type="text" value={vals[name] ?? ""} onChange={(e) => setVals({ ...vals, [name]: e.target.value })} />
          )}
        </Field>
      ))}
      {err && <Banner tone="bad">{err}</Banner>}
      <button type="button" className="btn primary" disabled={busy || !!blocked} onClick={() => void run()}>
        {busy ? "Running…" : "Run test"}
      </button>
      {env && <ResultView env={env} showOutput />}
    </div>
  );
}

function DefinitionEditor({ def, onSaved, onCancel }: { def: ToolDefinition; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState<ToolDefinition>(def);
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ToolDefinition>(k: K, v: ToolDefinition[K]) => setD({ ...d, [k]: v });
  const issues = useMemo(() => {
    const p = ToolDefinitionZ.safeParse(d);
    return p.success ? validateToolPolicy(p.data).map((i) => i.message) : p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }, [d]);

  function editStepText(i: number, text: string) {
    const steps = d.steps.map((s, idx) => {
      if (idx !== i || s.op !== "locate") return s;
      const l = s.locator;
      if (l.by === "role") return { ...s, locator: { ...l, name: text } };
      if (l.by === "label" || l.by === "text") return { ...s, locator: { ...l, text } };
      if (l.by === "field") return { ...s, locator: { ...l, label: text } };
      if (l.by === "css") return { ...s, locator: { ...l, selector: text } };
      return { ...s, locator: { ...l, id: text } };
    });
    set("steps", steps);
  }

  async function save() {
    setBusy(true);
    const v = await call<number>({ type: "tool.nextVersion", id: d.id });
    const next = v.ok ? (v.data as number) : d.version + 1;
    const r = await call({ type: "tool.save", definition: { ...d, version: next }, source: "edited" });
    setBusy(false);
    if (r.ok) onSaved();
    else setErr([r.error]);
  }

  return (
    <div className="card view">
      <h3>Edit (creates version {def.version + 1})</h3>
      <p className="muted">Editing never changes the version you enabled. The new version must be tested and enabled before it runs.</p>
      <Field label="Name"><input type="text" value={d.title} onChange={(e) => set("title", e.target.value)} /></Field>
      <Field label="Description for the AI assistant"><textarea value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
      {d.kind === "write" && (
        <Field label="Approval text" hint="Shown to you before every run. Use {parameter} placeholders.">
          <textarea value={d.approval.actionTemplate} onChange={(e) => set("approval", { ...d.approval, actionTemplate: e.target.value })} />
        </Field>
      )}
      <Field label="Per-step timeout (ms)">
        <input type="number" min={500} max={30000} value={d.limits.stepTimeoutMs} onChange={(e) => set("limits", { ...d.limits, stepTimeoutMs: Number(e.target.value) })} />
      </Field>
      <h3>Steps</h3>
      <ul className="plain">
        {d.steps.map((s, i) => (
          <li key={s.id} className="step">
            <span className="mono">{i + 1}</span>
            <div className="stack">
              <span>{describeStep(s)}</span>
              {s.op === "locate" && (
                <input
                  type="text"
                  aria-label={`Edit what step ${i + 1} looks for`}
                  value={s.locator.by === "role" ? (typeof s.locator.name === "string" ? s.locator.name : "") : s.locator.by === "testid" ? s.locator.id : s.locator.by === "css" ? s.locator.selector : s.locator.by === "field" ? (typeof s.locator.label === "string" ? s.locator.label : "") : typeof s.locator.text === "string" ? s.locator.text : ""}
                  onChange={(e) => editStepText(i, e.target.value)}
                />
              )}
              {!(s.op === "click" && s.effect === "commit") && (
                <button type="button" className="btn small" onClick={() => set("steps", d.steps.filter((_, idx) => idx !== i))}>Remove step</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {(issues.length > 0 || err.length > 0) && (
        <Banner tone="bad" title="Can’t save yet">
          <ul>{[...issues, ...err].map((m, i) => <li key={i}>{m}</li>)}</ul>
        </Banner>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || issues.length > 0} onClick={() => void save()}>Save as new version</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ToolDetail({ row, state, onBack }: { row: ToolRow; state: PanelState; onBack: () => void }) {
  const [version, setVersion] = useState(row.latest.version);
  const [def, setDef] = useState<ToolDefinition | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const vrow = row.versions.find((v) => v.version === version) ?? row.latest;

  useEffect(() => {
    setDef(null);
    void call<ToolDefinition>({ type: "tool.definition", id: row.id, version }).then((r) => r.ok && r.data && setDef(r.data));
  }, [row.id, version]);

  useEffect(() => setVersion((v) => (row.versions.some((x) => x.version === v) ? v : row.latest.version)), [row.versions.length]);

  const summary = useMemo(() => (def ? deriveReviewSummary(def) : null), [def]);
  const grantedAll = def ? def.origins.every((o) => state.grants.some((g) => g.origin === o)) : true;
  const isEnabled = vrow.status === "enabled";

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    const r = await fn();
    if (!r.ok) setErr(r.error ?? "Something went wrong.");
  }

  if (editing && def) return <DefinitionEditor def={def} onSaved={() => { setEditing(false); }} onCancel={() => setEditing(false)} />;

  return (
    <div className="stack view">
      <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={onBack}>← All tools</button>
      <div className="card">
        <div className="row between">
          <h2>{row.title}</h2>
          <span className={`chip ${STATUS_CHIP[vrow.status].cls}`}>{STATUS_CHIP[vrow.status].label}</span>
        </div>
        <div className="row">
          {row.versions.length > 1 && (
            <label className="row">
              <small className="muted">Version</small>
              <select style={{ width: "auto" }} value={version} onChange={(e) => setVersion(Number(e.target.value))}>
                {row.versions.map((v) => <option key={v.version} value={v.version}>v{v.version} — {STATUS_CHIP[v.status].label}</option>)}
              </select>
            </label>
          )}
          <span className="chip">{row.kind === "write" ? "Changes data (needs approval)" : "Read-only"}</span>
        </div>
        {!grantedAll && <Banner tone="warn" title="Site not allowed">You have not allowed AnyMCP to use this site yet. Open Settings → Allowed sites. Until then runs are blocked.</Banner>}
        {err && <Banner tone="bad">{err}</Banner>}
        <div className="row">
          {isEnabled ? (
            <button type="button" className="btn" onClick={() => void act(() => call({ type: "tool.disable", id: row.id }))}>Disable</button>
          ) : (
            <button type="button" className="btn primary" disabled={!vrow.tested || !grantedAll || vrow.status === "superseded"} title={vrow.tested ? "" : "Run a successful test of this exact version first"} onClick={() => void act(() => call({ type: "tool.enable", id: row.id, version }))}>
              Enable for my AI assistant
            </button>
          )}
          <button type="button" className="btn" onClick={() => setEditing(true)} disabled={!def}>Edit…</button>
        </div>
        {!isEnabled && <small className="muted" data-testid="enable-notice">Enabling lets your AI app run this tool and receive what it reads (see “What data it reads” below); your AI app may pass that to its model provider.</small>}
        {!vrow.tested && !isEnabled && <small className="muted">Enabling unlocks after a successful test of this exact version. Any edit creates a new version that needs its own test.</small>}
      </div>

      {!def || !summary ? <Loading rows={4} /> : (
        <>
          <ReviewCard s={summary} collapsed={isEnabled} />
          <details className="card">
            <summary>Exact steps ({def.steps.length})</summary>
            <ol style={{ paddingLeft: 18, margin: "8px 0 0" }}>{def.steps.map((s) => <li key={s.id}>{describeStep(s)}</li>)}</ol>
          </details>
          <TestForm def={def} row={row} version={version} state={state} />
        </>
      )}

      <div className="card">
        {!confirmDelete ? (
          <button type="button" className="btn small" onClick={() => setConfirmDelete(true)}>Delete this tool…</button>
        ) : (
          <div className="row">
            <span>Delete “{row.title}” and all its versions?</span>
            <button type="button" className="btn danger small" onClick={() => { void call({ type: "tool.delete", id: row.id }).then(onBack); }}>Delete</button>
            <button type="button" className="btn small" onClick={() => setConfirmDelete(false)}>Keep</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Tools({ state, goRecord, selected, setSelected }: { state: PanelState; goRecord: () => void; selected: string | null; setSelected: (id: string | null) => void }) {
  const row = selected ? state.tools.find((t) => t.id === selected) : null;
  if (row) return <ToolDetail row={row} state={state} onBack={() => setSelected(null)} />;

  if (!state.tools.length) {
    return (
      <Empty title="No tools yet" action={<button type="button" className="btn primary" onClick={goRecord}>Teach AnyMCP a workflow</button>}>
        A tool is a website task you teach once — like “find an order” — that your AI assistant can then run. You review what it can read and change before turning it on.
      </Empty>
    );
  }
  return (
    <div className="stack view">
      <ul className="plain">
        {state.tools.map((t) => {
          const v = t.versions.find((x) => x.version === (t.enabledVersion ?? t.latest.version)) ?? t.latest;
          return (
            <li key={t.id}>
              <button type="button" className="card flat" style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => setSelected(t.id)}>
                <div className="row between">
                  <strong>{t.title}</strong>
                  <span className={`chip ${STATUS_CHIP[v.status].cls}`}>{STATUS_CHIP[v.status].label}</span>
                </div>
                <small className="muted">{t.kind === "write" ? "Changes data · approval each time" : "Read-only"} · {t.origins.map(originLabel).join(", ")} · v{v.version}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn" onClick={goRecord}>Teach another workflow</button>
    </div>
  );
}
