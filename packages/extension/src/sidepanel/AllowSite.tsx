// "Allow a website": the explicit, per-site way to give AnyMCP access.
//
// Chrome only tells an extension the address of a tab on a site it may access, so AnyMCP cannot offer a list of
// "sites you have open" until the person names the site. The person types or pastes the address; AnyMCP asks
// Chrome for that ONE origin (Chrome shows its own prompt), then records the grant.

import { useState } from "react";
import { siteOrigin } from "../shared/site";
import { call } from "./api";
import { Banner, Field } from "./ui";

export function AllowSiteForm({ idPrefix, onAllowed }: { idPrefix: string; onAllowed?: (origin: string) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const parsed = text.trim() ? siteOrigin(text) : null;

  async function allow(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDone(null);
    const p = siteOrigin(text);
    if (!p.ok) return setErr(p.error);
    // must be the first await inside the submit handler: Chrome only shows its prompt for a user gesture
    const granted = await chrome.permissions.request({ origins: [`${p.origin}/*`] });
    if (!granted) return setErr("Chrome did not grant access to that site. AnyMCP can only use sites you allow.");
    const r = await call({ type: "origin.granted", origin: p.origin });
    if (!r.ok) return setErr(r.error);
    setText("");
    setDone(p.origin);
    onAllowed?.(p.origin);
  }

  return (
    <form className="stack" onSubmit={(e) => void allow(e)} aria-label="Allow a website">
      <Field label="Website address" hint="Paste the address of the site from its tab. AnyMCP is then allowed on every page of that site, and nowhere else.">
        <input
          id={`${idPrefix}-site`}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://books.toscrape.com"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {parsed && !parsed.ok && <small className="muted">{parsed.error}</small>}
      {parsed?.ok && <small className="muted">Chrome will ask you to allow <span className="mono">{parsed.origin}</span>.</small>}
      <div className="row">
        <button type="submit" className="btn primary small" disabled={!parsed?.ok}>Allow this site</button>
      </div>
      {err && <Banner tone="bad">{err}</Banner>}
      {done && <Banner tone="ok">Allowed: <span className="mono">{done}</span>. Open (or reload) that site in a tab to use it.</Banner>}
    </form>
  );
}
