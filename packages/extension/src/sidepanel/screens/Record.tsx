import { useEffect, useMemo, useState } from "react";
import { deriveReviewSummary, describeLocator, isCredentialQueryKey } from "anymcp-protocol";
import { PATH_PART_PATTERN, buildDraft, buildEntryPath, parameterizeLocator, partlyParameterized, type DraftOutput, type DraftParam, type DraftQueryPart, type DraftSignal, type DraftSpec, type DraftStep, type SignalKind } from "../../shared/draft";
import type { TabCandidate } from "../../shared/panel-api";
import type { PanelState, RecordedStepView } from "../../shared/types";
import { call } from "../api";
import { AllowSiteForm } from "../AllowSite";
import { Banner, Field, originLabel } from "../ui";
import { ReviewCard } from "./Tools";

const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]+/, "").slice(0, 40);

/** How a recorded or draft step reads to a person. */
function stepTitle(s: Pick<RecordedStepView, "kind" | "label" | "control" | "example">, recorded: boolean): string {
  if (s.kind === "click") return recorded ? `Clicked “${s.label}”` : `Click “${s.label}”`;
  if (s.kind === "press") return recorded ? `Pressed Enter in “${s.label}”` : `Press Enter in “${s.label}”`;
  switch (s.control) {
    case "select": return recorded ? `Chose “${s.example ?? ""}” in “${s.label}”` : `Choose in “${s.label}”`;
    case "checkbox": return recorded ? `${s.example === "false" ? "Unticked" : "Ticked"} “${s.label}”` : `Tick or untick “${s.label}”`;
    case "radio": return recorded ? `Chose the option “${s.label}”` : `Choose the option “${s.label}”`;
    default: return recorded ? `Typed into “${s.label}”` : `Type into “${s.label}”`;
  }
}

const OUTPUT_KIND: Record<DraftOutput["kind"], string> = { text: "Value", table: "Table", list: "List" };

const SIGNAL_LABEL: Record<SignalKind, string> = {
  success: "Shows it worked",
  empty: "Means: nothing found (valid empty result)",
  error: "Means: the site reported an error",
  expired: "Means: you are signed out",
};

// ----------------------------------------------------------------------------------- tab picker
function TabPicker() {
  const [tabs, setTabs] = useState<TabCandidate[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    void call<TabCandidate[]>({ type: "tabs.candidates" }).then((r) => r.ok && setTabs(r.data ?? []));
    void call<number>({ type: "tabs.hidden" }).then((r) => r.ok && setHidden(r.data ?? 0));
  };
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  async function allow(origin: string) {
    setErr(null);
    // must be called directly from the click so Chrome treats it as a user gesture
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) return setErr("Chrome did not grant access. AnyMCP can only use sites you allow.");
    const r = await call({ type: "origin.granted", origin });
    if (!r.ok) setErr(r.error);
    load();
  }
  async function start(tabId: number) {
    setErr(null);
    const r = await call({ type: "record.start", tabId });
    if (!r.ok) setErr(r.error);
  }

  return (
    <div className="stack view">
      <div className="card">
        <h2>Teach AnyMCP a workflow</h2>
        <p>Open the website in a tab, choose it below, then do the task once as you normally would.</p>
        <ul>
          <li>AnyMCP records only your clicks and typing in <strong>that tab</strong>, only on <strong>that site</strong>, only until you stop.</li>
          <li>It <strong>never records</strong> password, payment or one-time-code fields.</li>
          <li>Nothing is saved until you review and approve it.</li>
        </ul>
      </div>
      {err && <Banner tone="bad">{err}</Banner>}

      <div className="card">
        <h3>Tabs on sites you allowed</h3>
        {tabs === null ? (
          <p className="muted">Looking at your open tabs…</p>
        ) : tabs.length === 0 ? (
          <p className="muted">None yet. Allow the website below, then open it in a tab.</p>
        ) : (
          <ul className="plain">
            {tabs.map((t) => (
              <li key={t.tabId} className="card flat">
                <div className="row between">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</strong>
                    <small className="muted">{originLabel(t.origin)}</small>
                  </div>
                  {t.allowed ? (
                    <button type="button" className="btn primary small" onClick={() => void start(t.tabId)}>Start recording</button>
                  ) : (
                    <button type="button" className="btn small" onClick={() => void allow(t.origin)}>Allow this site</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <small className="muted">
            {hidden} other tab{hidden === 1 ? " is" : "s are"} open on sites you have not allowed. Chrome does not show AnyMCP their addresses until you allow the site.
          </small>
        )}
      </div>

      <div className="card">
        <h3>Allow a website</h3>
        <AllowSiteForm idPrefix="teach" onAllowed={load} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------- live recording
function LiveRecording({ state, onSpec }: { state: PanelState; onSpec: (s: DraftSpec) => void }) {
  const rec = state.recording!;
  const live = rec.status === "recording";
  const params: DraftParam[] = [];
  const picking = rec.pick;

  async function toReview() {
    const r = await call<DraftSpec | null>({ type: "record.spec" });
    if (r.ok && r.data) onSpec(r.data);
  }

  return (
    <div className="stack view">
      <div className="card">
        <div className="row between">
          <h2>{live ? "Recording…" : rec.status === "paused_off_origin" ? "Recording paused" : "Recording stopped"}</h2>
          <span className={`pill ${live ? "run" : "warn"}`}><span className="dot" aria-hidden="true" />{originLabel(rec.origin)}</span>
        </div>
        {rec.notice && <Banner tone="warn">{rec.notice}</Banner>}
        {rec.skippedSensitive > 0 && (
          <Banner tone="info">{rec.skippedSensitive} password/payment field{rec.skippedSensitive > 1 ? "s were" : " was"} ignored. AnyMCP never records those.</Banner>
        )}
        {picking && <Banner tone="info" title="Click the item on the page">Press Esc on the page to cancel.</Banner>}
        {live && (
          <div className="row">
            <button type="button" className="btn small" disabled={!!picking} onClick={() => void call({ type: "record.pick", mode: "text" })}>Pick a value to return</button>
            <button type="button" className="btn small" disabled={!!picking} onClick={() => void call({ type: "record.pick", mode: "list" })}>Pick a list</button>
            <button type="button" className="btn small" disabled={!!picking} onClick={() => void call({ type: "record.pick", mode: "table" })}>Pick a table</button>
            <button type="button" className="btn small" disabled={!!picking} onClick={() => void call({ type: "record.pick", mode: "success" })}>Mark a message</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>What you did ({rec.steps.length})</h3>
        {rec.steps.length === 0 ? (
          <p className="muted">{live ? "Waiting for your first click or typing in the tab…" : "Nothing was recorded."}</p>
        ) : (
          <ol className="plain">
            {rec.steps.map((s) => (
              <li key={s.seq} className="step">
                <span aria-hidden="true">{s.kind === "input" ? (s.control && s.control !== "text" ? "☑" : "⌨") : s.kind === "press" ? "⏎" : "👆"}</span>
                <div>
                  <strong>{stepTitle(s, true)}</strong>
                  {s.viaEnter && <small className="muted"> (pressed Enter)</small>}
                  <div className="row">
                    <small className="muted">{describeLocator(parameterizeLocator(s.locator, params))}</small>
                    {s.quality === "ambiguous" && <span className="chip warn">May match several places</span>}
                    {s.quality === "fragile" && <span className="chip warn">Found by page layout — may break if the site changes</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {(rec.outputs.length > 0 || rec.signals.length > 0) && (
        <div className="card">
          <h3>What you picked</h3>
          <ul className="plain">
            {rec.outputs.map((o) => (
              <li key={o.id} className="row between">
                <span>{OUTPUT_KIND[o.kind]}: <span className="muted">{o.preview || describeLocator(o.locator)}</span></span>
                <button type="button" className="btn small" onClick={() => void call({ type: "record.removePick", id: o.id, list: "outputs" })}>Remove</button>
              </li>
            ))}
            {rec.signals.map((o) => (
              <li key={o.id} className="row between">
                <span>Success check: <span className="muted">{o.preview || describeLocator(o.locator)}</span></span>
                <button type="button" className="btn small" onClick={() => void call({ type: "record.removePick", id: o.id, list: "signals" })}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        {rec.status !== "stopped" ? (
          <button type="button" className="btn danger" onClick={() => void call({ type: "record.stop" })}>Stop recording</button>
        ) : (
          <button type="button" className="btn primary" disabled={rec.steps.length === 0 && rec.outputs.length === 0} onClick={() => void toReview()}>Review the tool →</button>
        )}
        <button type="button" className="btn" onClick={() => void call({ type: "record.discard" })}>Discard</button>
      </div>
      {rec.status !== "stopped" && <small className="muted">Tip: do the task once, then pick what to return — one value, a list of similar items (like search results), or a table — and use “Mark a message” on something that proves it worked.</small>}
    </div>
  );
}

// ----------------------------------------------------------------------------------- editor
function Editor({ initial, onDone }: { initial: DraftSpec; onDone: (savedId: string | null) => void }) {
  const [spec, setSpec] = useState<DraftSpec>(initial);
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const built = useMemo(() => buildDraft(spec, 1), [spec]);
  const summary = useMemo(() => (built.definition ? deriveReviewSummary(built.definition) : null), [built]);
  const isWrite = spec.steps.some((s) => s.enabled && s.effect === "commit");

  const patch = (p: Partial<DraftSpec>) => setSpec((s) => ({ ...s, ...p }));
  const setStep = (i: number, p: Partial<DraftStep>) => patch({ steps: spec.steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= spec.steps.length) return;
    const steps = [...spec.steps];
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    patch({ steps });
  };
  const setParam = (i: number, p: Partial<DraftParam>) => {
    const old = spec.params[i]!;
    const name = p.name !== undefined ? snake(p.name) : old.name;
    patch({
      params: spec.params.map((x, idx) => (idx === i ? { ...x, ...p, name } : x)),
      steps: spec.steps.map((s) => {
        let next = s.fill.mode === "param" && s.fill.param === old.name ? { ...s, fill: { mode: "param" as const, param: name } } : s;
        if (next.asParam === old.name) next = { ...next, asParam: name };
        return next;
      }),
    });
  };
  const usedParams = (s: DraftSpec, except?: { queryIndex?: number }) => {
    const used = new Set<string>();
    for (const st of s.steps) if (st.fill.mode === "param") used.add(st.fill.param);
    (s.entryQuery ?? []).forEach((q, idx) => {
      if (idx !== except?.queryIndex && q.mode === "param" && q.param) used.add(q.param);
    });
    return used;
  };
  const setQuery = (i: number, mode: DraftQueryPart["mode"]) =>
    setSpec((s) => {
      const parts = [...(s.entryQuery ?? [])];
      const part = parts[i]!;
      let params = s.params;
      if (part.mode === "param" && part.param && mode !== "param" && !usedParams(s, { queryIndex: i }).has(part.param)) {
        params = params.filter((p) => p.name !== part.param);
      }
      let next: DraftQueryPart = { key: part.key, value: part.value, mode };
      if (mode === "param") {
        const taken = new Set(params.map((p) => p.name));
        let name = snake(part.key) || "value";
        for (let n = 2; taken.has(name); n++) name = `${snake(part.key) || "value"}_${n}`;
        params = [...params, { name, description: `Value for “${part.key}” in the start address`, type: "string", example: part.value, maxLength: 200 }];
        next = { ...next, param: name };
      }
      parts[i] = next;
      return { ...s, params, entryQuery: parts };
    });
  /** Make one part of the start address an input (or fixed again). */
  const togglePathPart = (seg: string, idx: number) =>
    setSpec((sp) => {
      const existing = sp.params.find((p) => p.fromPath && p.example === seg);
      if (existing) return { ...sp, params: sp.params.filter((p) => p !== existing) };
      const segs = sp.entryPath.split("/").filter(Boolean);
      const base = (snake(segs[idx - 1] ?? "") || "part").replace(/s$/, "") || "part";
      const taken = new Set(sp.params.map((p) => p.name));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
      return {
        ...sp,
        params: [...sp.params, { name, description: `Part of the start address (you used “${seg}”)`, type: "string", example: seg, maxLength: 100, pattern: PATH_PART_PATTERN, fromPath: true }],
      };
    });
  /** Would turning this click's text into an input actually change what AnyMCP looks for? */
  const canBeInput = (s: DraftStep) =>
    !!s.label && JSON.stringify(parameterizeLocator(s.locator, [{ name: "probe", description: "", type: "string", example: s.label, maxLength: 200 }])) !== JSON.stringify(s.locator);
  const makeInput = (i: number) =>
    setSpec((sp) => {
      const st = sp.steps[i]!;
      const taken = new Set(sp.params.map((p) => p.name));
      const base = st.options ? "choice" : "item";
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
      const param: DraftParam = {
        name,
        description: st.options ? `Which choice to pick (you picked “${st.label}”)` : `Which item to click (you clicked “${st.label}”)`,
        type: "string",
        example: st.label,
        maxLength: 200,
        ...(st.options ? { options: st.options } : {}),
      };
      return { ...sp, params: [...sp.params, param], steps: sp.steps.map((x, idx) => (idx === i ? { ...x, asParam: name, keepText: false } : x)) };
    });
  const keepFixed = (i: number) =>
    setSpec((sp) => {
      const st = sp.steps[i]!;
      return { ...sp, params: sp.params.filter((p) => p.name !== st.asParam), steps: sp.steps.map((x, idx) => (idx === i ? { ...x, asParam: undefined } : x)) };
    });
  const setOutput = (i: number, p: Partial<DraftOutput>) => patch({ outputs: spec.outputs.map((o, idx) => (idx === i ? { ...o, ...p } : o)) });
  const setSignal = (i: number, p: Partial<DraftSignal>) => patch({ signals: spec.signals.map((o, idx) => (idx === i ? { ...o, ...p } : o)) });

  async function save() {
    setBusy(true);
    setSaveErr(null);
    const v = await call<number>({ type: "tool.nextVersion", id: spec.id });
    const final = buildDraft(spec, v.ok ? (v.data as number) : 1);
    if (!final.definition) {
      setBusy(false);
      return setSaveErr(final.errors.join(" "));
    }
    const r = await call({ type: "tool.save", definition: final.definition, source: "recorded" });
    if (!r.ok) {
      setBusy(false);
      return setSaveErr(r.error);
    }
    await call({ type: "record.discard" });
    setBusy(false);
    onDone(spec.id);
  }

  return (
    <div className="stack view">
      <div className="card">
        <h2>Review your tool</h2>
        <Field label="Name"><input type="text" value={spec.title} onChange={(e) => patch({ title: e.target.value, ...(idTouched ? {} : { id: snake(e.target.value) || "new_tool" }) })} /></Field>
        <Field label="Tool id" hint="What the AI assistant calls it. Lowercase letters, digits and underscores.">
          <input type="text" value={spec.id} onChange={(e) => { setIdTouched(true); patch({ id: snake(e.target.value) }); }} />
        </Field>
        <Field label="Description for the AI assistant" hint="One or two sentences. This is only a description; AnyMCP enforces the rules below.">
          <textarea value={spec.description} onChange={(e) => patch({ description: e.target.value })} />
        </Field>
      </div>

      <div className="card">
        <h3>Start page</h3>
        <p className="mono" style={{ wordBreak: "break-all" }}>{originLabel(spec.origin)}{buildEntryPath(spec.entryPath, spec.params)}</p>
        {spec.entryPath.split("/").filter(Boolean).length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <small className="muted">Should part of the address change on each run (an order number, a category)? Choose it to make it an input.</small>
            <div className="row" role="group" aria-label="Parts of the start address">
              {spec.entryPath.split("/").filter(Boolean).map((seg, idx) => {
                const on = spec.params.some((p) => p.fromPath && p.example === seg);
                return (
                  <button key={`${idx}-${seg}`} type="button" className={`btn small ${on ? "primary" : ""}`} aria-pressed={on} onClick={() => togglePathPart(seg, idx)}>
                    {seg.length > 24 ? `${seg.slice(0, 22)}…` : seg}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {(spec.entryQuery ?? []).length === 0 ? (
          <small className="muted">Every run starts here, in a tab AnyMCP opens itself.</small>
        ) : (
          <>
            <p className="muted">This address has extra settings after the “?”. Choose what each one does on every run.</p>
            {(spec.entryQuery ?? []).map((q, i) => {
              const credential = isCredentialQueryKey(q.key);
              return (
                <div key={q.key} className="row between">
                  <span className="mono" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {q.key}{q.mode === "fixed" ? `=${q.value}` : q.mode === "param" ? `={${q.param}}` : ""}
                  </span>
                  <select aria-label={`What to do with “${q.key}”`} value={q.mode} disabled={credential} onChange={(e) => setQuery(i, e.target.value as DraftQueryPart["mode"])}>
                    <option value="fixed">Keep this value</option>
                    <option value="param">Make it an input</option>
                    <option value="drop">Leave it out</option>
                  </select>
                </div>
              );
            })}
            {(spec.entryQuery ?? []).some((q) => isCredentialQueryKey(q.key)) && (
              <small className="muted">Settings that look like sign-in or security values are always left out. AnyMCP uses your normal signed-in session instead.</small>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>Inputs (what the assistant provides each time)</h3>
        <p className="muted">Everything you typed became an input so no typed value is saved. Turn one into a fixed value in Steps if it never changes.</p>
        {spec.params.length === 0 && <p className="muted">No inputs. The tool does the same thing every time.</p>}
        {spec.params.map((p, i) => (
          <div key={i} className="card flat">
            <div className="grid2">
              <Field label="Name"><input type="text" value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} /></Field>
              <Field label="Type">
                <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value as DraftParam["type"] })}><option value="string">Text</option><option value="integer">Whole number</option><option value="boolean">Yes / no</option></select>
              </Field>
            </div>
            <Field label="Description"><input type="text" value={p.description} onChange={(e) => setParam(i, { description: e.target.value })} /></Field>
            {p.type === "string" && p.options && p.options.length > 0 && (
              <div className="stack">
                <small className="muted">Accepts only one of the {p.options.length} choices in the dropdown: {p.options.slice(0, 8).join(", ")}{p.options.length > 8 ? ", …" : ""}</small>
                <button type="button" className="btn small" onClick={() => setParam(i, { options: undefined })}>Accept any text instead</button>
              </div>
            )}
            {p.type === "string" && !p.options?.length && (
              <div className="grid2">
                <Field label="Max length"><input type="number" min={1} max={2000} value={p.maxLength} onChange={(e) => setParam(i, { maxLength: Number(e.target.value) })} /></Field>
                <Field label="Required format" hint="Optional pattern, e.g. ^A-\d{4}$"><input type="text" value={p.pattern ?? ""} onChange={(e) => setParam(i, { pattern: e.target.value || undefined })} /></Field>
              </div>
            )}
            {p.example && <small className="muted">Your example “{p.example}” is used only to recognise it in the recording. It is not saved.</small>}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Steps</h3>
        <ol className="plain">
          {spec.steps.map((s, i) => (
            <li key={s.seq} className={`step ${s.enabled ? "" : "off"}`}>
              <input type="checkbox" checked={s.enabled} aria-label={`Include step ${i + 1}`} onChange={(e) => setStep(i, { enabled: e.target.checked })} />
              <div className="stack">
                <strong>{stepTitle(s, false)}</strong>
                <small className="muted">{describeLocator(s.keepText ? s.locator : parameterizeLocator(s.locator, spec.params))}</small>
                {s.kind === "input" ? (
                  <div className="row">
                    <select aria-label="What to type" value={s.fill.mode === "param" ? `p:${s.fill.param}` : s.fill.mode} onChange={(e) => {
                      const v = e.target.value;
                      const fixed = s.control === "checkbox" || s.control === "radio" ? "true" : "";
                      setStep(i, { fill: v.startsWith("p:") ? { mode: "param", param: v.slice(2) } : v === "literal" ? { mode: "literal", text: fixed } : { mode: "skip" } });
                    }}>
                      {spec.params.map((p) => <option key={p.name} value={`p:${p.name}`}>The input “{p.name}”</option>)}
                      <option value="literal">A fixed value…</option>
                      <option value="skip">{s.control && s.control !== "text" ? "Leave it as it is" : "Don’t type anything"}</option>
                    </select>
                    {s.fill.mode === "literal" && (s.control === "checkbox" || s.control === "radio") && (
                      <select aria-label="Fixed state" value={s.fill.text} onChange={(e) => setStep(i, { fill: { mode: "literal", text: e.target.value } })}>
                        <option value="true">{s.control === "radio" ? "Chosen" : "Ticked"}</option>
                        {s.control === "checkbox" && <option value="false">Not ticked</option>}
                        {s.fill.text !== "true" && s.fill.text !== "false" && <option value={s.fill.text}>Choose…</option>}
                      </select>
                    )}
                    {s.fill.mode === "literal" && s.control !== "checkbox" && s.control !== "radio" && <input type="text" aria-label="Fixed value" value={s.fill.text} onChange={(e) => setStep(i, { fill: { mode: "literal", text: e.target.value } })} />}
                  </div>
                ) : (
                  <select aria-label={s.kind === "press" ? "What pressing Enter does" : "What this click does"} value={s.effect} onChange={(e) => setStep(i, { effect: e.target.value as DraftStep["effect"] })}>
                    <option value="ui">{s.kind === "press" ? "Searches or moves on" : "Just moves around the page"}</option>
                    <option value="navigate">Opens another page</option>
                    <option value="commit">CHANGES DATA on the site (needs approval each run)</option>
                  </select>
                )}
                {s.kind === "input" && (
                  <select aria-label="Does changing it save by itself?" value={s.effect === "commit" ? "commit" : "ui"} onChange={(e) => setStep(i, { effect: e.target.value as DraftStep["effect"] })}>
                    <option value="ui">Only fills in the form</option>
                    <option value="commit">Saves by itself: CHANGES DATA (needs approval each run)</option>
                  </select>
                )}
                {s.kind === "click" && (s.asParam ? (
                  <div className="row">
                    <small className="muted">Which one is clicked comes from the input “{s.asParam}”.</small>
                    <button type="button" className="btn small" onClick={() => keepFixed(i)}>Always click “{s.label}”</button>
                  </div>
                ) : canBeInput(s) && (
                  <button type="button" className="btn small" onClick={() => makeInput(i)}>
                    {s.options ? `Make the choice an input (${s.options.length} options)` : `Make “${s.label.slice(0, 30)}” an input`}
                  </button>
                ))}
                {(s.keepText || partlyParameterized(s.locator, parameterizeLocator(s.locator, spec.params), spec.params)) && (
                  <label className="row"><input type="checkbox" checked={!!s.keepText} onChange={(e) => setStep(i, { keepText: e.target.checked })} /> Keep this text as recorded (“{s.label.slice(0, 40)}”)</label>
                )}
                {s.effect === "commit" && <span className="chip warn">This makes the tool a “changes data” tool</span>}
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <button type="button" className="btn small" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="btn small" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === spec.steps.length - 1}>↓</button>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h3>What it returns</h3>
        {spec.outputs.length === 0 && <Banner tone="warn">Go back and use “Pick a value to return” on the result. A tool must return something.</Banner>}
        {spec.outputs.map((o, i) => (
          <div key={o.id} className="card flat">
            <div className="grid2">
              <Field label="Name"><input type="text" value={o.name} onChange={(e) => setOutput(i, { name: snake(e.target.value) })} /></Field>
              <Field label="Use">
                <select value={o.use} onChange={(e) => setOutput(i, { use: e.target.value as DraftOutput["use"] })}>
                  <option value="result">Return to the assistant</option>
                  <option value="approval" disabled={!isWrite || o.kind !== "text"}>Show in my approval</option>
                  <option value="both" disabled={!isWrite || o.kind !== "text"}>Both</option>
                </select>
              </Field>
            </div>
            {o.kind === "list" && (
              <div className="row">
                <select aria-label="Type of each item" value={o.as} onChange={(e) => setOutput(i, { as: e.target.value as DraftOutput["as"] })}><option value="string">Each item is text</option><option value="number">Each item is a number</option><option value="link">Each item is a link (text and address)</option></select>
                <label className="row">At most <input type="number" min={1} max={200} style={{ width: 70 }} aria-label="Most items to return" value={o.maxRows ?? 50} onChange={(e) => setOutput(i, { maxRows: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} /> items</label>
              </div>
            )}
            {o.kind === "text" && (
              <div className="row">
                <select aria-label="Type" value={o.as} onChange={(e) => setOutput(i, { as: e.target.value as DraftOutput["as"] })}><option value="string">Text</option><option value="number">Number</option><option value="link">Link (text and address)</option></select>
                <label className="row"><input type="checkbox" checked={o.optional} onChange={(e) => setOutput(i, { optional: e.target.checked })} /> May be missing</label>
              </div>
            )}
            {o.kind === "table" && o.columns && (
              <div className="stack">
                <small className="muted">Columns to return</small>
                {Object.entries(o.columns).map(([k, c]) => (
                  <div key={k} className="row">
                    <span style={{ flex: 1 }}>{c.header}</span>
                    <select aria-label={`${c.header} type`} value={c.as} onChange={(e) => setOutput(i, { columns: { ...o.columns, [k]: { ...c, as: e.target.value as "string" | "number" } } })}><option value="string">Text</option><option value="number">Number</option></select>
                    <button type="button" className="btn small" onClick={() => { const { [k]: _gone, ...rest } = o.columns!; setOutput(i, { columns: rest }); }}>Drop</button>
                  </div>
                ))}
              </div>
            )}
            {(o.use === "approval" || o.use === "both") && <Field label="Label in the approval"><input type="text" value={o.approvalLabel ?? o.name} onChange={(e) => setOutput(i, { approvalLabel: e.target.value })} /></Field>}
            <small className="muted">Looks for: {describeLocator(parameterizeLocator(o.locator, spec.params))}</small>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>How AnyMCP knows it worked</h3>
        {spec.signals.length === 0 && <Banner tone="warn">Go back and use “Mark a message” on something that appears only when the task worked.</Banner>}
        {spec.signals.map((g, i) => (
          <div key={g.id} className="card flat">
            <select aria-label="What this message means" value={g.kind} onChange={(e) => setSignal(i, { kind: e.target.value as SignalKind })}>
              {(Object.keys(SIGNAL_LABEL) as SignalKind[]).map((k) => <option key={k} value={k}>{SIGNAL_LABEL[k]}</option>)}
            </select>
            <small className="muted">{describeLocator(parameterizeLocator(g.locator, spec.params))}</small>
          </div>
        ))}
      </div>

      {isWrite && (
        <div className="card">
          <h3>Approval</h3>
          <Field label="What you will be asked to approve" hint="Use {input_name} to include a value, e.g. Save a draft note on {order_id}: “{note}”">
            <textarea value={spec.approvalText} onChange={(e) => patch({ approvalText: e.target.value })} />
          </Field>
        </div>
      )}

      {built.errors.length > 0 && (
        <Banner tone="bad" title="Fix these before saving"><ul>{built.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Banner>
      )}
      {built.warnings.length > 0 && (
        <Banner tone="warn" title="Worth a look"><ul>{built.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul></Banner>
      )}
      {summary && <ReviewCard s={summary} />}
      {saveErr && <Banner tone="bad">{saveErr}</Banner>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !built.definition} onClick={() => void save()}>Save as draft</button>
        <button type="button" className="btn" onClick={() => onDone(null)}>Back</button>
      </div>
      <small className="muted">Saving does not enable anything. Next you test it, then decide whether to enable it.</small>
    </div>
  );
}

export function Record({ state, onSaved }: { state: PanelState; onSaved: (id: string) => void }) {
  const [spec, setSpec] = useState<DraftSpec | null>(null);
  if (spec) return <Editor initial={spec} onDone={(id) => { setSpec(null); if (id) onSaved(id); }} />;
  if (!state.recording) return <TabPicker />;
  return <LiveRecording state={state} onSpec={setSpec} />;
}
