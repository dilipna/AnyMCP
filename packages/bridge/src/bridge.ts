// Assembles the bridge: MCP listener + extension WebSocket listener + state.

import { rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { DEFAULT_EXT_PORT, DEFAULT_MCP_PORT, ANYMCP_VERSION } from "anymcp-protocol";
import { createMcpHttpServer } from "./http";
import { ExtensionHub } from "./hub";
import { createBridgeMcpHandler } from "./mcp";
import { PairingManager } from "./pairing";
import { RunManager } from "./runs";
import { StateStore } from "./store";

/** File (in the state directory) holding the current pairing code while no browser is paired. */
export const PAIRING_FILE = "pairing.json";

export interface BridgeOptions {
  /** 0 picks a free port (tests). */
  mcpPort?: number;
  extPort?: number;
  /** Only loopback is supported. */
  host?: "127.0.0.1";
  home?: string;
  reconnectGraceMs?: number;
  cancelWaitMs?: number;
  pairingTtlMs?: number;
  helloTimeoutMs?: number;
  log?: (line: string) => void;
  /** How apps that launch MCP servers as local programs start this bridge (shown in the side panel). */
  stdioLaunch?: { command: string; args: string[] } | null;
}

export interface BridgeHandle {
  mcpUrl: string;
  extUrl: string;
  mcpPort: number;
  extPort: number;
  store: StateStore;
  hub: ExtensionHub;
  runs: RunManager;
  pairing: PairingManager;
  token(): string;
  pairingCode(): string;
  close(): Promise<void>;
}

export async function startBridge(opts: BridgeOptions = {}): Promise<BridgeHandle> {
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? (() => undefined);
  const store = new StateStore(opts.home);
  // While no browser is paired, the current single-use code is also written to a private file next to the state
  // (which already holds this bridge's secrets), so `anymcp-bridge` run in a terminal can show it even when an app
  // started this bridge in the background.
  const pairingFile = join(store.dir, PAIRING_FILE);
  let started = false; // only a bridge that really owns the ports may publish (a failed start must not overwrite another's code)
  const publishPairing = () => {
    if (!started) return;
    try {
      if (store.state.extension) rmSync(pairingFile, { force: true });
      else {
        const c = pairing.current();
        writeFileSync(pairingFile, JSON.stringify({ code: c.code, expiresAt: new Date(c.expiresAt).toISOString() }) + "\n", { encoding: "utf8", mode: 0o600 });
      }
    } catch {
      /* best effort: the terminal and the log still show the code */
    }
  };
  const pairing = new PairingManager({
    ttlMs: opts.pairingTtlMs,
    onNewCode: (code) => {
      log(`New pairing code: ${code.slice(0, 4)} ${code.slice(4)}`);
      publishPairing();
    },
  });
  let refreshPairing: NodeJS.Timeout | undefined;

  let mcpUrl = "";
  const hub = new ExtensionHub(store, pairing, () => mcpUrl, { helloTimeoutMs: opts.helloTimeoutMs, stdioLaunch: opts.stdioLaunch ?? null });
  hub.on("log", log);
  hub.on("paired", publishPairing);
  hub.on("revoked", () => (Date.now() > pairing.current().expiresAt ? pairing.issue() : publishPairing()));
  await hub.listen(opts.extPort ?? DEFAULT_EXT_PORT, host);

  const runs = new RunManager(hub, store, { reconnectGraceMs: opts.reconnectGraceMs, cancelWaitMs: opts.cancelWaitMs });
  const handler = createBridgeMcpHandler(hub, runs, () => ({
    extension: hub.connected ? "connected" : store.state.extension ? "paired_not_connected" : "not_paired",
    enabledTools: hub.listTools().length,
    bridgeVersion: ANYMCP_VERSION,
  }));
  const httpServer: Server = createMcpHttpServer({
    handler,
    getToken: () => store.state.mcpToken,
    onClientSeen: (name, at) => hub.noteClient(name, at),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(opts.mcpPort ?? DEFAULT_MCP_PORT, host, () => resolve());
    });
  } catch (e) {
    // only half started (the extension port opened, the MCP port did not): release what we opened
    runs.close();
    await handler.close().catch(() => undefined);
    await hub.close().catch(() => undefined);
    throw e;
  }
  started = true;
  publishPairing();
  // keep a valid code available while unpaired (codes expire after 10 minutes)
  refreshPairing = setInterval(() => {
    if (!store.state.extension && Date.now() > pairing.current().expiresAt) pairing.issue();
  }, 30_000);
  refreshPairing.unref();
  const addr = httpServer.address();
  const mcpPort = typeof addr === "object" && addr ? addr.port : (opts.mcpPort ?? DEFAULT_MCP_PORT);
  mcpUrl = `http://${host}:${mcpPort}/mcp`;

  return {
    mcpUrl,
    extUrl: `ws://${host}:${hub.port}/ext`,
    mcpPort,
    extPort: hub.port,
    store,
    hub,
    runs,
    pairing,
    token: () => store.state.mcpToken,
    pairingCode: () => pairing.current().code,
    async close() {
      runs.close();
      clearInterval(refreshPairing);
      if (started) rmSync(pairingFile, { force: true }); // the code dies with this process
      started = false;
      await handler.close();
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await hub.close();
    },
  };
}
