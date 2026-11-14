// "This site": what AnyMCP can do on the tab the person is looking at, what access is granted, and the next step.
// Built only from what Chrome reveals: a tab's address is visible to AnyMCP only on sites it may access.

import { useState } from "react";
import type { PanelState } from "../shared/types";
import { call } from "./api";
import { Banner, originLabel } from "./ui";

export function HereCard({ state, openTool, goTeach }: { state: PanelState; openTool: (id: string) => void; goTeach: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const h = state.here;
  if (h.kind === "other") return null; // a browser page or AnyMCP's own panel: nothing to say

  if (h.kind === "hidden") {
    return (
      <section className="card" aria-labelledby="here-h">
        <h2 id="here-h">This tab</h2>
        <p style={{ margin: 0 }}>
          AnyMCP cannot see which site this tab shows: you have not allowed it, and Chrome hides the address until you do. AnyMCP has no access to it.
        </p>
        <div>
          <button type="button" className="btn small" onClick={goTeach}>Allow a website</button>
        </div>
      </section>
    );
  }

  const origin = h.origin;
  const site = originLabel(origin);
  const tools = state.tools.filter((t) => t.origins.includes(origin));

  async function allow() {
    setErr(null);
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }); // first await: keeps the user gesture
    if (!granted) return setErr("Chrome did not grant access to this site.");
    const r = await call({ type: "origin.granted", origin });
    if (!r.ok) setErr(r.error);
  }

  return (
    <section className="card" aria-labelledby="here-h">
      <h2 id="here-h">
        This site: <span className="mono">{site}</span>
      </h2>
      {h.anymcpTab && <p className="muted" style={{ margin: 0 }}>This is a tab AnyMCP opened to run tools. To teach a task, use a tab of your own.</p>}
      {!h.allowed ? (
        <>
          <p style={{ margin: 0 }}>AnyMCP is <strong>not allowed</strong> on this site, so it cannot read or do anything here.</p>
          <div>
            <button type="button" className="btn small primary" onClick={() => void allow()}>Allow this site</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            AnyMCP may use this site, only through tools you enabled. Remove it any time in Settings → Allowed sites (its tools are turned off at once).
          </p>
          {tools.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No tools for this site yet.</p>
          ) : (
            <ul className="plain" aria-label={`Tools for ${site}`}>
              {tools.map((t) => (
                <li key={t.id} className="row between">
                  <button type="button" className="btn small" onClick={() => openTool(t.id)}>{t.title}</button>
                  <small className="muted">
                    {t.enabledVersion !== null ? `Available to your AI assistant${t.kind === "write" ? " · asks you before every change" : " · read-only"}` : "Not enabled"}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {!h.anymcpTab && (
            <div>
              <button type="button" className="btn small" onClick={goTeach}>Teach a task here</button>
            </div>
          )}
        </>
      )}
      {err && <Banner tone="bad">{err}</Banner>}
    </section>
  );
}
