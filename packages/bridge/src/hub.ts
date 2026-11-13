// Extension hub: the authenticated WebSocket channel between the bridge and the MyCP Extension.
// This is a SEPARATE connection from the MCP transport.
//
// Security properties:
//  - loopback bind only; Host header must be a loopback name:port (DNS-rebinding guard)
//  - Origin must be chrome-extension://<id> and must equal the id the extension claims
//  - first contact requires a one-time pairing code; later contact requires an HMAC proof of the
//    pairing secret over a fresh nonce (the secret is never re-sent)
//  - one authenticated extension at a time; a newer one replaces the older

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BridgeToExtZ,
  ExtToBridgeZ,
  MYCP_VERSION,
  PROTOCOL_VERSION,
  hmacSha256Hex,
  parseJsonMessage,
  randomHex,
  timingSafeEqualStr,
  type BridgeToExt,
  type ExtToBridge,
  type ToolManifest,
} from "mycp-protocol";
import type { PairingManager } from "./pairing";
import type { StateStore } from "./store";

type Stage = "hello" | "auth" | "ready";
interface Conn {
  ws: WebSocket;
  stage: Stage;
  extensionId: string;
  originId: string;
  nonce: string;
  queue: Promise<void>;
  helloTimer?: ReturnType<typeof setTimeout>;
}

export interface HubEvents {
  ready: [];
  disconnected: [];
  tools: [ToolManifest[]];
  event: [Extract<ExtToBridge, { type: "run.event" }>];
  result: [Extract<ExtToBridge, { type: "run.result" }>];
  revoked: [];
  paired: [];
  log: [string];
}

export class ExtensionHub extends EventEmitter<HubEvents> {
  private wss!: WebSocketServer;
  private active: Conn | null = null;
  private tools = new Map<string, ToolManifest>();
  port = 0;
  lastClientName: string | null = null;
  lastCallAt: string | null = null;

  constructor(
    private readonly store: StateStore,
    private readonly pairing: PairingManager,
    private readonly getMcpUrl: () => string,
    private readonly opts: { helloTimeoutMs?: number; stdioLaunch?: { command: string; args: string[] } | null } = {},
  ) {
    super();
  }

  async listen(port: number, host: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({
        host,
        port,
        path: "/ext",
        maxPayload: 4 * 1024 * 1024,
        verifyClient: (info, cb) => {
          const origin = info.origin ?? "";
          if (!origin.startsWith("chrome-extension://")) return cb(false, 403, "extension origin required");
          const hostHeader = info.req.headers.host ?? "";
          if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(hostHeader)) return cb(false, 403, "bad host");
          cb(true);
        },
      });
      this.wss.once("listening", () => resolve());
      this.wss.once("error", reject);
      this.wss.on("connection", (ws, req) => this.onConnection(ws, req.headers.origin ?? ""));
    });
    const addr = this.wss.address();
    this.port = typeof addr === "object" && addr ? addr.port : port;
  }

  get connected(): boolean {
    return this.active?.stage === "ready" && this.active.ws.readyState === 1;
  }

  listTools(): ToolManifest[] {
    return [...this.tools.values()];
  }

  getTool(id: string): ToolManifest | undefined {
    return this.tools.get(id);
  }

  send(msg: BridgeToExt): boolean {
    const c = this.active;
    if (!c || c.stage !== "ready" || c.ws.readyState !== 1) return false;
    c.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Drop the extension connection abruptly (simulates a network failure; used by tests and shutdown). */
  dropActive(): void {
    this.active?.ws.terminate();
  }

  noteClient(name: string | null, at: string | null): void {
    if (name) this.lastClientName = name;
    if (at) this.lastCallAt = at;
    this.send({ type: "client.status", lastClientName: this.lastClientName, lastCallAt: this.lastCallAt });
  }

  async close(): Promise<void> {
    for (const c of this.wss?.clients ?? []) c.close(1001, "bridge shutdown");
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  // ---- connection handling ----
  private onConnection(ws: WebSocket, origin: string): void {
    const conn: Conn = {
      ws,
      stage: "hello",
      extensionId: "",
      originId: origin.replace("chrome-extension://", "").replace(/\/$/, ""),
      nonce: "",
      queue: Promise.resolve(),
    };
    // A connection that never completes the handshake is dropped; one that does must NOT be (cleared in becomeReady).
    conn.helloTimer = setTimeout(() => ws.close(4001, "hello timeout"), this.opts.helloTimeoutMs ?? 5000);
    ws.on("message", (data) => {
      conn.queue = conn.queue
        .then(() => this.onMessage(conn, data.toString()))
        .catch((e) => {
          this.emit("log", `hub error: ${String(e)}`);
        });
    });
    ws.on("close", () => {
      clearTimeout(conn.helloTimer);
      if (this.active === conn) {
        this.active = null;
        this.emit("disconnected");
      }
    });
    ws.on("error", () => ws.close());
  }

  private reject(conn: Conn, code: string, message: string): void {
    const msg: BridgeToExt = { type: "hello.rejected", code, message };
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
    conn.ws.close(4003, code);
    this.emit("log", `extension rejected: ${code}`);
  }

  private becomeReady(conn: Conn): void {
    if (this.active && this.active !== conn) this.active.ws.close(4000, "replaced by a newer connection");
    clearTimeout(conn.helloTimer);
    conn.stage = "ready";
    this.active = conn;
    conn.ws.send(
      JSON.stringify({ type: "ready", bridgeVersion: MYCP_VERSION, protocol: PROTOCOL_VERSION, clientConnected: this.lastClientName !== null } satisfies BridgeToExt),
    );
    this.emit("ready");
  }

  private async onMessage(conn: Conn, raw: string): Promise<void> {
    const parsed = parseJsonMessage(ExtToBridgeZ, raw);
    if (!parsed.ok) {
      if (conn.stage !== "ready") this.reject(conn, "bad_message", "Invalid message.");
      return;
    }
    const msg = parsed.msg;

    if (conn.stage === "hello") {
      if (msg.type !== "hello") return this.reject(conn, "bad_message", "Expected hello.");
      if (msg.extensionId !== conn.originId) return this.reject(conn, "origin_mismatch", "Extension id does not match its origin.");
      conn.extensionId = msg.extensionId;
      if (msg.mode === "pair") {
        const r = this.pairing.consume(msg.pairingCode ?? "");
        if (!r.ok) {
          const text =
            r.reason === "wrong_code"
              ? "That pairing code is not correct."
              : r.reason === "expired"
                ? "That pairing code expired. A new one was issued: the bridge terminal shows it, or run mycp-bridge in a terminal to see it."
                : "Too many wrong attempts. A new pairing code was issued: the bridge terminal shows it, or run mycp-bridge in a terminal to see it.";
          return this.reject(conn, `pairing_${r.reason}`, text);
        }
        const secret = randomHex(32);
        this.store.setExtension({ id: conn.extensionId, secret, pairedAt: new Date().toISOString() });
        conn.ws.send(JSON.stringify({ type: "pair.ok", secret } satisfies BridgeToExt));
        this.emit("log", `paired extension ${conn.extensionId}`);
        this.emit("paired");
        return this.becomeReady(conn);
      }
      const paired = this.store.state.extension;
      if (!paired || paired.id !== conn.extensionId) return this.reject(conn, "not_paired", "This extension is not paired with this bridge.");
      conn.nonce = randomBytes(16).toString("hex");
      conn.stage = "auth";
      conn.ws.send(JSON.stringify({ type: "auth.challenge", nonce: conn.nonce } satisfies BridgeToExt));
      return;
    }

    if (conn.stage === "auth") {
      if (msg.type !== "auth.response") return this.reject(conn, "bad_message", "Expected auth response.");
      const paired = this.store.state.extension;
      if (!paired) return this.reject(conn, "not_paired", "Pairing was revoked.");
      const expected = await hmacSha256Hex(paired.secret, `${conn.nonce}:${conn.extensionId}`);
      if (!timingSafeEqualStr(expected, msg.hmac)) return this.reject(conn, "bad_credentials", "Pairing proof was not valid.");
      return this.becomeReady(conn);
    }

    // ---- authenticated messages ----
    switch (msg.type) {
      case "ping":
        conn.ws.send(JSON.stringify({ type: "pong" } satisfies BridgeToExt));
        return;
      case "tools.sync":
        this.tools = new Map(msg.tools.map((t) => [t.id, t]));
        conn.ws.send(JSON.stringify({ type: "ack", ref: msg.syncId } satisfies BridgeToExt));
        this.emit("tools", this.listTools());
        return;
      case "run.event":
        this.emit("event", msg);
        return;
      case "run.result":
        conn.ws.send(JSON.stringify({ type: "ack", ref: msg.envelope.executionId } satisfies BridgeToExt));
        this.emit("result", msg);
        return;
      case "credentials.get":
        conn.ws.send(JSON.stringify({ type: "credentials", mcpUrl: this.getMcpUrl(), token: this.store.state.mcpToken, stdio: this.opts.stdioLaunch ?? null } satisfies BridgeToExt));
        return;
      case "client.revoke": {
        const token = this.store.rotateToken();
        this.lastClientName = null;
        this.lastCallAt = null;
        conn.ws.send(JSON.stringify({ type: "credentials", mcpUrl: this.getMcpUrl(), token, stdio: this.opts.stdioLaunch ?? null } satisfies BridgeToExt));
        this.send({ type: "client.status", lastClientName: null, lastCallAt: null });
        this.emit("log", "MCP client token rotated (client disconnected)");
        return;
      }
      case "revoke":
        this.store.clearExtension();
        this.store.rotateToken();
        this.tools.clear();
        this.lastClientName = null;
        this.lastCallAt = null;
        conn.ws.send(JSON.stringify({ type: "revoked" } satisfies BridgeToExt));
        this.emit("log", "extension unpaired and MCP token rotated (full revocation)");
        this.emit("revoked");
        conn.ws.close(4004, "revoked");
        return;
      case "ack":
      case "hello":
      case "auth.response":
        return;
    }
  }
}
