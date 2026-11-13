import { useState } from "react";
import type { PanelState } from "../../shared/types";
import { ago, call } from "../api";
import { Banner, CopyLine } from "../ui";

interface Creds {
  mcpUrl: string;
  token: string;
  stdio: { command: string; args: string[] } | null;
}

export function clientCommand(c: Creds, masked = false): string {
  return `claude mcp add --transport http mycp ${c.mcpUrl} --header "Authorization: Bearer ${masked ? "••••••••" + c.token.slice(-4) : c.token}"`;
}

/** The standard "mcpServers" entry for apps that start MCP servers as local programs. Contains no secret. */
export function stdioConfig(stdio: NonNullable<Creds["stdio"]>): string {
  return JSON.stringify({ mcpServers: { mycp: { command: stdio.command, args: stdio.args } } }, null, 2);
}

export function Connect({ state, compact = false }: { state: PanelState; compact?: boolean }) {
  const c = state.conn;
  const [code, setCode] = useState("");
  const [url, setUrl] = useState(c.bridgeUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [adv, setAdv] = useState(false);

  async function pair() {
    setBusy(true);
    setErr(null);
    const r = await call({ type: "pair", url, code });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else setCode("");
  }
  async function showCreds() {
    const r = await call<Creds>({ type: "credentials" });
    if (r.ok && r.data) setCreds(r.data);
    else setErr(r.ok ? "No answer from the bridge." : r.error);
  }
  async function disconnectClient() {
    const r = await call<Creds>({ type: "client.disconnect" });
    if (r.ok && r.data) setCreds(r.data);
    else setErr(r.ok ? "No answer from the bridge." : r.error);
  }

  // ------------- not paired: guided setup -------------
  if (!c.paired) {
    return (
      <section className="card" aria-labelledby="connect-h">
        <h2 id="connect-h">Connect MyCP to your AI assistant</h2>
        {!compact && <p className="muted">MyCP has two parts that talk to each other on this computer only: this extension, and a small local program called the bridge. Three steps:</p>}
        <div className="stack">
          <h3>1 · Start the bridge</h3>
          <p className="muted">It runs on your computer and lets your AI assistant call the tools you approve. Run this in a terminal, in the MyCP folder:</p>
          <CopyLine id="bridge" label="Start the bridge" text="npm run bridge" />
          <p className="muted">It prints a pairing code and the command for step 3.</p>
        </div>
        <div className="stack">
          <h3>2 · Pair this browser</h3>
          <label className="field">
            Pairing code
            <span className="hint">The 8 digits the bridge printed. Single use.</span>
            <input type="text" inputMode="numeric" autoComplete="off" placeholder="1234 5678" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.replace(/\s/g, "").length === 8 && void pair()} />
          </label>
          <button type="button" className="btn ghost small" onClick={() => setAdv(!adv)} aria-expanded={adv}>
            {adv ? "Hide" : "Show"} advanced
          </button>
          {adv && (
            <label className="field">
              Bridge address
              <span className="hint">Only this computer is allowed.</span>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
          )}
          {(err || c.error) && <Banner tone="bad" title="Could not pair">{err ?? c.error}</Banner>}
          <button type="button" className="btn primary" disabled={busy || code.replace(/\s/g, "").length !== 8} onClick={() => void pair()}>
            {busy ? "Pairing…" : "Pair"}
          </button>
        </div>
        <div className="stack">
          <h3>3 · Connect your AI client</h3>
          <p className="muted">Available after pairing. You will copy one command into a terminal.</p>
        </div>
      </section>
    );
  }

  // ------------- paired -------------
  return (
    <section className="card" aria-labelledby="conn-h">
      <div className="row between">
        <h2 id="conn-h">Connection</h2>
        <span className={`pill ${c.state === "connected" ? "ok" : c.state === "connecting" ? "warn" : "bad"}`}>
          <span className="dot" aria-hidden="true" />
          {c.state === "connected" ? "Connected" : c.state === "connecting" ? "Connecting…" : "Not connected"}
        </span>
      </div>

      {c.state !== "connected" && (
        <Banner tone={c.state === "connecting" ? "info" : "warn"} title={c.state === "connecting" ? "Connecting to the bridge…" : "Not connected to the bridge"}>
          <p>{c.error ?? "Start the bridge (npm run bridge). MyCP reconnects automatically."}</p>
          <button type="button" className="btn small" onClick={() => void call({ type: "reconnect" })}>
            Reconnect now
          </button>
        </Banner>
      )}

      <dl className="kv">
        <dt>Bridge</dt>
        <dd className="mono">{c.bridgeUrl}{c.bridgeVersion ? ` · v${c.bridgeVersion}` : ""}</dd>
        <dt>AI client</dt>
        <dd>{c.clientName ? `${c.clientName}${c.lastCallAt ? ` · last call ${ago(c.lastCallAt)}` : ""}` : "None has connected yet"}</dd>
      </dl>

      {c.state === "connected" && (
        <div className="stack">
          <h3>Connect your AI client</h3>
          {!creds ? (
            <button type="button" className="btn" onClick={() => void showCreds()}>
              Show the client command
            </button>
          ) : (
            <>
              <h4>Claude Code (and other apps that connect over HTTP)</h4>
              <p className="muted">Paste this into a terminal. The token is a password for the bridge — don’t share it.</p>
              <CopyLine id="client" label="Client command (copies the full command including the token)" text={clientCommand(creds)} shown={clientCommand(creds, true)} />
              <div className="row">
                <button type="button" className="btn small" onClick={() => void disconnectClient()}>
                  Disconnect the AI client
                </button>
                <small className="muted">Rotates the token. Apps that use it must be set up again.</small>
              </div>
              <h4>Claude Desktop, Cursor and other apps that start tools themselves</h4>
              {creds.stdio ? (
                <>
                  <p className="muted">
                    Add this to the app’s MCP settings (in Claude Desktop: Settings → Developer → Edit Config). It contains no password: the app
                    starts MyCP on this computer and shares this browser connection. To disconnect such an app, remove “mycp” from its settings.
                  </p>
                  <CopyLine id="stdio" label="MCP settings entry for apps that start tools themselves" text={stdioConfig(creds.stdio)} />
                </>
              ) : (
                <p className="muted">Run the packaged bridge (<span className="mono">mycp-bridge.mjs</span>) to get a ready-made settings entry here.</p>
              )}
            </>
          )}
          {err && <Banner tone="bad">{err}</Banner>}
        </div>
      )}
    </section>
  );
}
