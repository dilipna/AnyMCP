import { useEffect, useState } from "react";
import type { TabCandidate } from "../../shared/panel-api";
import type { PanelState } from "../../shared/types";
import { call } from "../api";
import { Banner, originLabel } from "../ui";
import { Connect } from "./Connect";

function AllowedSites({ state }: { state: PanelState }) {
  const [tabs, setTabs] = useState<TabCandidate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => void call<TabCandidate[]>({ type: "tabs.candidates" }).then((r) => r.ok && setTabs((r.data ?? []).filter((t) => !t.allowed)));
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [state.grants.length]);

  const seen = new Set<string>();
  const candidates = tabs.filter((t) => (seen.has(t.origin) ? false : (seen.add(t.origin), true)));

  async function allow(origin: string) {
    setErr(null);
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }); // direct from the click: a user gesture
    if (!granted) return setErr("Chrome did not grant access.");
    const r = await call({ type: "origin.granted", origin });
    if (!r.ok) setErr(r.error);
  }

  return (
    <section className="card" aria-labelledby="sites-h">
      <h2 id="sites-h">Allowed sites</h2>
      <p className="muted">AnyMCP can only read or act on sites listed here, and only through tools you enabled. Removing a site disables its tools.</p>
      {state.grants.length === 0 ? (
        <p className="muted">No sites allowed yet.</p>
      ) : (
        <ul className="plain">
          {state.grants.map((g) => {
            const used = state.tools.filter((t) => t.origins.includes(g.origin));
            return (
              <li key={g.origin} className="row between">
                <span>
                  <span className="mono">{originLabel(g.origin)}</span>
                  <small className="muted"> · {used.length} tool{used.length === 1 ? "" : "s"}</small>
                </span>
                <button type="button" className="btn small" onClick={() => void call({ type: "origin.revoke", origin: g.origin })}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}
      {err && <Banner tone="bad">{err}</Banner>}
      {candidates.length > 0 && (
        <details>
          <summary>Allow a site you have open</summary>
          <ul className="plain" style={{ marginTop: 8 }}>
            {candidates.map((t) => (
              <li key={t.origin} className="row between">
                <span className="mono">{originLabel(t.origin)}</span>
                <button type="button" className="btn small" onClick={() => void allow(t.origin)}>Allow</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  // Optimistic: the stored value arrives from the service worker a moment later; do not make the checkbox snap back meanwhile.
  const [on, setOn] = useState(checked);
  useEffect(() => setOn(checked), [checked]);
  return (
    <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); onChange(e.target.checked); }} style={{ marginTop: 4 }} />
      <label htmlFor={id}>
        <strong>{label}</strong>
        <div className="muted">{hint}</div>
      </label>
    </div>
  );
}

export function Settings({ state }: { state: PanelState }) {
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div className="stack view">
      <Connect state={state} compact />
      <AllowedSites state={state} />

      <section className="card" aria-labelledby="priv-h">
        <h2 id="priv-h">Privacy</h2>
        <p className="muted">By default AnyMCP stores no page content, screenshots or typed values. Run history keeps only what happened, not the data.</p>
        <Toggle id="keep" checked={state.settings.keepResults} onChange={(v) => void call({ type: "settings.update", settings: { keepResults: v } })} label="Keep results in run history" hint="Saves returned values on this computer so you can review them later. Off by default." />
        <Toggle id="diag" checked={state.settings.captureDiagnostics} onChange={(v) => void call({ type: "settings.update", settings: { captureDiagnostics: v } })} label="Capture developer diagnostics on failures" hint="Saves a short outline of visible controls (names only, digits masked, never field values or passwords) to help debug a broken tool. Off by default." />
        <button type="button" className="btn" onClick={() => void call({ type: "history.clear" })}>Delete run history</button>
      </section>

      <section className="card" aria-labelledby="rev-h">
        <h2 id="rev-h">Revoke everything</h2>
        <p className="muted">Turns off every tool, removes access to every site, unpairs this browser and changes the bridge’s token so your AI client is locked out. Your saved tool definitions stay (disabled).</p>
        {done && <Banner tone="ok">Done. AnyMCP has no access to any site, and the AI client’s token no longer works.</Banner>}
        {!confirm ? (
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Revoke all access…</button>
        ) : (
          <div className="row">
            <strong>Are you sure?</strong>
            <button type="button" className="btn danger" onClick={() => { void call({ type: "revoke.all" }).then(() => { setConfirm(false); setDone(true); }); }}>Yes, revoke</button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="about-h">
        <h2 id="about-h">About AnyMCP</h2>
        <p className="muted">Version {state.version}{state.isTestBuild ? " · TEST BUILD" : ""}</p>
        <p className="muted">AnyMCP works on pages built from standard buttons, links, fields and tables. It has not been verified on arbitrary sites. It does not handle iframes, shadow DOM, file uploads or CAPTCHAs, and it never signs in for you. See docs/supported-capabilities.md.</p>
      </section>
    </div>
  );
}
