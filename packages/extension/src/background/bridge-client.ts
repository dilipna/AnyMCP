// WebSocket client to the local bridge (service worker side).
//
// Transport retries live here: reconnect with backoff, heartbeat, resend un-acknowledged RESULTS.
// Action retries do not: nothing here ever re-executes a run. A result that was not acknowledged is
// re-sent (idempotent on the bridge by executionId); an action is never replayed.
//
// MV3 note: an open WebSocket with traffic keeps the service worker alive (Chrome 116+), so we send
// a ping every 20 s. If the worker is suspended anyway, `chrome.alarms` wakes it and we reconnect.

import {
  BridgeToExtZ,
  MYCP_VERSION,
  PROTOCOL_VERSION,
  hmacSha256Hex,
  parseJsonMessage,
  randomHex,
  toToolManifest,
  type BridgeToExt,
  type ExtToBridge,
  type ResultEnvelope,
  type RunPhase,
} from "mycp-protocol";
import type { ConnState, ConnView, Pairing } from "../shared/types";
import { getEnabledTools, getPairing, getSession, savePairing, setSession } from "./storage";

const PING_MS = 20_000;
const PONG_TIMEOUT_MS = 45_000;
export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:47821/ext";

interface Handlers {
  onRunRequest: (m: Extract<BridgeToExt, { type: "run.request" }>) => void;
  onRunCancel: (m: Extract<BridgeToExt, { type: "run.cancel" }>) => void;
  /** Connection came up: report finished-while-away results and the current tool list. */
  onReady: () => void;
  /** Connection dropped. */
  onDown: () => void;
  onChange: () => void;
}

/** What the side panel needs to connect an AI app. `stdio` is how an app that launches local programs starts the bridge. */
export interface Credentials {
  mcpUrl: string;
  token: string;
  stdio: { command: string; args: string[] } | null;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private state: ConnState = "unpaired";
  private error: string | null = null;
  private bridgeUrl = DEFAULT_BRIDGE_URL;
  private bridgeVersion: string | null = null;
  private clientName: string | null = null;
  private lastCallAt: string | null = null;
  private paired = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private wantConnected = false;
  private credentialWaiters: ((c: Credentials) => void)[] = [];

  constructor(private readonly h: Handlers) {}

  view(): ConnView {
    return { state: this.state, bridgeUrl: this.bridgeUrl, paired: this.paired, error: this.error, bridgeVersion: this.bridgeVersion, clientName: this.clientName, lastCallAt: this.lastCallAt };
  }

  get connected(): boolean {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }

  private setState(s: ConnState, error: string | null = null) {
    this.state = s;
    this.error = error;
    this.h.onChange();
  }

  /** Called on worker start / alarm. Reconnects if we are paired and not connected. */
  async init(): Promise<void> {
    const p = await getPairing();
    this.paired = !!p;
    if (p) this.bridgeUrl = p.bridgeUrl;
    if (!p) return this.setState("unpaired");
    this.wantConnected = true;
    if (!this.connected && this.state !== "connecting") await this.connect();
  }

  // ---- pairing ----
  async pair(bridgeUrl: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!/^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/ext$/.test(bridgeUrl)) return { ok: false, error: "The bridge address must be on this computer, like ws://127.0.0.1:47821/ext." };
    this.closeSocket();
    this.bridgeUrl = bridgeUrl;
    this.setState("connecting");
    try {
      const ws = await this.open(bridgeUrl);
      const result = await new Promise<{ ok: true; secret: string } | { ok: false; error: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: "The bridge did not answer. Is it running?" }), 8000);
        ws.onmessage = (ev) => {
          const m = parseJsonMessage(BridgeToExtZ, ev.data);
          if (!m.ok) return;
          if (m.msg.type === "pair.ok") {
            clearTimeout(timer);
            resolve({ ok: true, secret: m.msg.secret });
          } else if (m.msg.type === "hello.rejected") {
            clearTimeout(timer);
            resolve({ ok: false, error: m.msg.message });
          }
        };
        ws.onclose = () => {
          clearTimeout(timer);
          resolve({ ok: false, error: "The bridge closed the connection." });
        };
        this.sendRaw(ws, { type: "hello", protocol: PROTOCOL_VERSION, extensionId: chrome.runtime.id, extensionVersion: MYCP_VERSION, mode: "pair", pairingCode: code.replace(/\s+/g, "") });
      });
      if (!result.ok) {
        this.closeSocket();
        this.setState("unpaired", result.error);
        return result;
      }
      const pairing: Pairing = { bridgeUrl, secret: result.secret, pairedAt: new Date().toISOString() };
      await savePairing(pairing);
      this.paired = true;
      this.closeSocket();
      this.wantConnected = true;
      await this.connect();
      return { ok: true };
    } catch (e) {
      this.setState("unpaired", this.explain(e));
      return { ok: false, error: this.explain(e) };
    }
  }

  async forget(): Promise<void> {
    this.wantConnected = false;
    this.closeSocket();
    await savePairing(null);
    this.paired = false;
    this.clientName = null;
    this.lastCallAt = null;
    this.setState("unpaired");
  }

  // ---- connection ----
  private explain(e: unknown): string {
    const msg = String((e as Error)?.message ?? e);
    // Chrome 147+ may gate loopback WebSockets behind a "local network access" permission.
    return `Could not reach the bridge at ${this.bridgeUrl}. Make sure it is running (npm run bridge). If Chrome asked about local network access, choose Allow. (${msg})`;
  }

  private open(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timed out"));
      }, 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("connection failed"));
      };
    });
  }

  private sendRaw(ws: WebSocket, m: ExtToBridge) {
    ws.send(JSON.stringify(m));
  }

  send(m: ExtToBridge): boolean {
    if (!this.connected || !this.ws) return false;
    this.sendRaw(this.ws, m);
    return true;
  }

  private closeSocket() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  async connect(): Promise<void> {
    const pairing = await getPairing();
    if (!pairing) return this.setState("unpaired");
    this.bridgeUrl = pairing.bridgeUrl;
    this.paired = true;
    this.closeSocket();
    this.setState("connecting");
    let ws: WebSocket;
    try {
      ws = await this.open(pairing.bridgeUrl);
    } catch (e) {
      this.setState("disconnected", this.explain(e));
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onmessage = (ev) => void this.onMessage(ev.data, pairing);
    ws.onclose = () => this.onClosed();
    ws.onerror = () => undefined;
    this.sendRaw(ws, { type: "hello", protocol: PROTOCOL_VERSION, extensionId: chrome.runtime.id, extensionVersion: MYCP_VERSION, mode: "auth" });
  }

  private onClosed() {
    const wasConnected = this.state === "connected";
    this.closeSocket();
    if (this.state !== "unpaired") this.setState("disconnected", wasConnected ? "The connection to the bridge was lost. Reconnecting…" : this.error);
    if (wasConnected) this.h.onDown();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.wantConnected || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15_000);
  }

  private startHeartbeat() {
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > PONG_TIMEOUT_MS) return this.onClosed();
      this.send({ type: "ping" });
    }, PING_MS);
  }

  private async onMessage(raw: unknown, pairing: Pairing) {
    const parsed = parseJsonMessage(BridgeToExtZ, raw);
    if (!parsed.ok) return;
    const m = parsed.msg;
    switch (m.type) {
      case "auth.challenge": {
        if (!this.ws) return;
        this.sendRaw(this.ws, { type: "auth.response", hmac: await hmacSha256Hex(pairing.secret, `${m.nonce}:${chrome.runtime.id}`) });
        return;
      }
      case "hello.rejected": {
        const gone = m.code === "not_paired" || m.code === "bad_credentials";
        this.wantConnected = !gone;
        if (gone) {
          await savePairing(null);
          this.paired = false;
          this.closeSocket();
          this.setState("unpaired", "The bridge no longer recognises this browser. Pair again.");
        } else this.setState("error", m.message);
        return;
      }
      case "ready": {
        this.backoff = 1000;
        this.bridgeVersion = m.bridgeVersion;
        this.setState("connected");
        this.startHeartbeat();
        this.h.onReady();
        return;
      }
      case "pong":
        this.lastPong = Date.now();
        return;
      case "run.request":
        this.h.onRunRequest(m);
        return;
      case "run.cancel":
        this.h.onRunCancel(m);
        return;
      case "client.status":
        this.clientName = m.lastClientName;
        this.lastCallAt = m.lastCallAt;
        this.h.onChange();
        return;
      case "credentials": {
        const waiters = this.credentialWaiters.splice(0);
        waiters.forEach((w) => w({ mcpUrl: m.mcpUrl, token: m.token, stdio: m.stdio ?? null }));
        return;
      }
      case "revoked":
        await savePairing(null);
        this.wantConnected = false;
        this.paired = false;
        this.closeSocket();
        this.setState("unpaired", "Access was revoked. The AI client can no longer use MyCP.");
        return;
      case "ack":
        await this.onAck(m.ref);
        return;
      case "pair.ok":
        return;
    }
  }

  // ---- results (idempotent, resent until acknowledged) ----
  async sendResult(env: ResultEnvelope, recovered = false): Promise<void> {
    const pending = await getSession<Record<string, { env: ResultEnvelope; recovered: boolean }>>("pendingResults", {});
    pending[env.executionId] = { env, recovered };
    await setSession("pendingResults", pending);
    this.send({ type: "run.result", envelope: env, recovered });
  }

  async resendPending(): Promise<void> {
    const pending = await getSession<Record<string, { env: ResultEnvelope; recovered: boolean }>>("pendingResults", {});
    // Results that were never acknowledged are re-sent flagged `recovered`; the bridge de-duplicates by executionId.
    for (const { env } of Object.values(pending)) this.send({ type: "run.result", envelope: env, recovered: true });
  }

  private async onAck(ref: string) {
    const pending = await getSession<Record<string, unknown>>("pendingResults", {});
    if (ref in pending) {
      delete pending[ref];
      await setSession("pendingResults", pending);
    }
  }

  sendEvent(executionId: string, phase: RunPhase, detail?: string) {
    this.send({ type: "run.event", executionId, phase, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
  }

  async syncTools(): Promise<void> {
    const tools = await Promise.all((await getEnabledTools()).map((t) => toToolManifest(t.definition)));
    this.send({ type: "tools.sync", syncId: `sync_${randomHex(6)}`, tools });
  }

  requestCredentials(): Promise<Credentials> {
    return new Promise((resolve, reject) => {
      if (!this.send({ type: "credentials.get" })) return reject(new Error("Not connected to the bridge."));
      const timer = setTimeout(() => reject(new Error("The bridge did not answer.")), 5000);
      this.credentialWaiters.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
  }

  disconnectClient(): Promise<Credentials> {
    return new Promise((resolve, reject) => {
      if (!this.send({ type: "client.revoke" })) return reject(new Error("Not connected to the bridge."));
      const timer = setTimeout(() => reject(new Error("The bridge did not answer.")), 5000);
      this.credentialWaiters.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
  }

  /** Full revocation: ask the bridge to unpair and rotate its token, then forget locally even if it is unreachable. */
  async revokeAll(): Promise<void> {
    this.send({ type: "revoke" });
    await new Promise((r) => setTimeout(r, 300));
    await this.forget();
  }
}
