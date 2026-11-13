import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  hmacSha256Hex,
  makeEnvelope,
  toToolManifest,
  type BridgeToExt,
  type ExtToBridge,
  type ResultEnvelope,
  type ToolDefinition,
  type ToolManifest,
} from "mycp-protocol";
import { startBridge, type BridgeHandle, type BridgeOptions } from "../src/bridge";

export const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";

export async function withBridge(opts: BridgeOptions = {}): Promise<{ bridge: BridgeHandle; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "mycp-bridge-test-"));
  const bridge = await startBridge({ mcpPort: 0, extPort: 0, home, reconnectGraceMs: 300, cancelWaitMs: 300, ...opts });
  return {
    bridge,
    cleanup: async () => {
      await bridge.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** A stand-in for the MyCP Extension that speaks the real bridge protocol. */
export class FakeExtension {
  ws!: WebSocket;
  inbox: BridgeToExt[] = [];
  secret = "";
  private waiters: { type: string; resolve: (m: BridgeToExt) => void }[] = [];
  closed = false;

  constructor(readonly bridge: BridgeHandle, readonly id: string = EXT_ID, readonly origin: string = `chrome-extension://${id}`) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.bridge.extUrl, { origin: this.origin });
      this.ws.on("open", () => resolve());
      this.ws.on("error", reject);
      this.ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      this.ws.on("close", () => (this.closed = true));
      this.ws.on("message", (d) => void this.onMessage(JSON.parse(d.toString()) as BridgeToExt));
    });
  }

  private async onMessage(m: BridgeToExt): Promise<void> {
    if (m.type === "pair.ok") this.secret = m.secret;
    if (m.type === "auth.challenge") {
      this.send({ type: "auth.response", hmac: await hmacSha256Hex(this.secret, `${m.nonce}:${this.id}`) });
    }
    this.inbox.push(m);
    const i = this.waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
  }

  send(m: ExtToBridge): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Wait for the next message of a type (already-received messages count). */
  waitFor<T extends BridgeToExt["type"]>(type: T, ms = 3000): Promise<Extract<BridgeToExt, { type: T }>> {
    const hit = this.inbox.find((m) => m.type === type);
    if (hit) {
      this.inbox.splice(this.inbox.indexOf(hit), 1);
      return Promise.resolve(hit as Extract<BridgeToExt, { type: T }>);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(t);
          this.inbox.splice(this.inbox.indexOf(m), 1);
          resolve(m as Extract<BridgeToExt, { type: T }>);
        },
      });
    });
  }

  async pair(code: string): Promise<void> {
    this.send({ type: "hello", protocol: 1, extensionId: this.id, extensionVersion: "test", mode: "pair", pairingCode: code });
    await this.waitFor("ready");
  }

  async auth(secret: string): Promise<void> {
    this.secret = secret;
    this.send({ type: "hello", protocol: 1, extensionId: this.id, extensionVersion: "test", mode: "auth" });
    await this.waitFor("ready");
  }

  async syncTools(defs: ToolDefinition[]): Promise<ToolManifest[]> {
    const tools = await Promise.all(defs.map(toToolManifest));
    this.send({ type: "tools.sync", syncId: `sync_${Math.random()}`, tools });
    await this.waitFor("ack");
    return tools;
  }

  close(): void {
    this.ws.close();
  }
}

export async function pairedExtension(bridge: BridgeHandle, id = EXT_ID): Promise<FakeExtension> {
  const ext = new FakeExtension(bridge, id);
  await ext.open();
  await ext.pair(bridge.pairingCode());
  return ext;
}

export async function mcpClient(bridge: BridgeHandle, token = bridge.token()): Promise<Client> {
  const client = new Client({ name: "mycp-test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(bridge.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

export function okEnvelope(executionId: string, tool: { id: string; version: number }, output: unknown, over: Partial<Parameters<typeof makeEnvelope>[0]> = {}): ResultEnvelope {
  return makeEnvelope({
    executionId,
    tool,
    status: "success",
    reasonCode: "ok",
    message: "Verified.",
    startedAt: new Date(Date.now() - 50).toISOString(),
    source: { origin: "http://127.0.0.1:4173", path: "/orders/A-1042", capturedAt: new Date().toISOString() },
    output,
    untrustedContent: true,
    ...over,
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
