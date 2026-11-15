// `anymcp-bridge` — start the local AnyMCP bridge and print copyable setup steps.
// `anymcp-bridge --stdio` — the same bridge for apps that launch MCP servers as local programs (see stdio.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_EXT_PORT, DEFAULT_MCP_PORT, ANYMCP_VERSION } from "anymcp-protocol";
import { PAIRING_FILE, startBridge, type BridgeHandle } from "./bridge";
import { listening, runStdio } from "./stdio";
import { explainListenError } from "./errors";
import { stdioLaunchFor, type Launch } from "./launch";
import { defaultHome } from "./store";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

/**
 * How another app should start THIS bridge over stdio: the packaged single file run by this same Node.js.
 * Null in a development run from TypeScript sources when no packaged bridge has been built.
 */
function stdioLaunch(passThrough: string[]): Launch | null {
  return stdioLaunchFor(fileURLToPath(import.meta.url), { platform: process.platform, execPath: process.execPath, passThrough, exists: existsSync });
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Another bridge already owns the ports (often one an app started in the background): show how to use it. */
function explainRunningBridge(home: string, mcpPort: number, launch: { command: string; args: string[] } | null) {
  const state = readJson(join(home, "state.json"));
  const pairing = readJson(join(home, PAIRING_FILE));
  const url = `http://127.0.0.1:${mcpPort}/mcp`;
  console.log(`
An AnyMCP bridge is already running on this computer (perhaps started by an app such as Claude Desktop or Cursor).
You do not need a second one.
`);
  const expires = typeof pairing?.expiresAt === "string" ? Date.parse(pairing.expiresAt) : 0;
  if (state?.extension) console.log(`  Pairing: already paired with a browser.\n`);
  else if (typeof pairing?.code === "string" && expires > Date.now()) {
    console.log(`  Pair the extension: in the AnyMCP side panel choose “Connect” and enter`);
    console.log(`           ${pairing.code.slice(0, 4)} ${pairing.code.slice(4)}      (single use, expires at ${new Date(expires).toLocaleTimeString()})\n`);
  } else {
    console.log(`  Pairing: no code is available right now. Wait a minute and run this command again.\n`);
  }
  if (typeof state?.mcpToken === "string") {
    console.log(`  Claude Code (HTTP):\n  claude mcp add --transport http anymcp ${url} --header "Authorization: Bearer ${state.mcpToken}"\n`);
  }
  if (launch) {
    console.log(`  Apps that start MCP servers themselves — add this to their MCP settings:\n`);
    console.log(JSON.stringify({ mcpServers: { anymcp: { command: launch.command, args: launch.args } } }, null, 2).replace(/^/gm, "  ") + "\n");
  }
  console.log(`  If this is unexpected, another program is using port ${mcpPort}: choose others with --mcp-port / --ext-port.`);
}

async function main() {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(ANYMCP_VERSION);
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`AnyMCP bridge ${ANYMCP_VERSION}
Usage: anymcp-bridge [--stdio] [--mcp-port=${DEFAULT_MCP_PORT}] [--ext-port=${DEFAULT_EXT_PORT}] [--home=<dir>]
  Starts the local bridge. It listens on 127.0.0.1 only.
  --stdio   Serve MCP over stdin/stdout, for apps that start MCP servers themselves (Claude Desktop, Cursor, ...).
            If a bridge is already running it forwards to it; otherwise it becomes the bridge.
  --version Print the version.`);
    return;
  }
  const home = arg("home") ?? defaultHome();
  const mcpPort = Number(arg("mcp-port") ?? DEFAULT_MCP_PORT);
  const extPort = Number(arg("ext-port") ?? DEFAULT_EXT_PORT);
  const passThrough = [
    ...(arg("home") ? [`--home=${home}`] : []),
    ...(arg("mcp-port") ? [`--mcp-port=${mcpPort}`] : []),
    ...(arg("ext-port") ? [`--ext-port=${extPort}`] : []),
  ];

  if (process.argv.includes("--stdio")) {
    // stdout belongs to the protocol: every human-readable line goes to stderr
    const log = (l: string) => process.stderr.write(`[anymcp] ${l}\n`);
    const { close } = await runStdio({ home, mcpPort, extPort, log, bridge: { stdioLaunch: stdioLaunch(passThrough) } });
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void close().finally(() => process.exit(0));
    };
    // the app closed the connection (or quit): stop, releasing the ports for another bridge
    process.stdin.on("end", stop);
    process.stdin.on("close", stop);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  const launch = stdioLaunch(passThrough);
  if (await listening(mcpPort)) {
    explainRunningBridge(home, mcpPort, launch); // do not even open the state of a bridge that is running
    return;
  }
  let bridge: BridgeHandle;
  try {
    bridge = await startBridge({ home, mcpPort, extPort, log: (l) => console.log(`[anymcp] ${l}`), stdioLaunch: launch });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    explainRunningBridge(home, mcpPort, launch);
    process.exitCode = 0;
    return;
  }
  const code = bridge.pairingCode();
  const paired = bridge.store.state.extension;

  console.log(`
AnyMCP bridge ${ANYMCP_VERSION} is running. It listens on 127.0.0.1 only.

  What this is: a small local program that lets your AI assistant (an MCP client) call the
  tools you approved in the AnyMCP Extension. It never sees your cookies or passwords.

  AI client endpoint : ${bridge.mcpUrl}
  Extension channel  : ${bridge.extUrl}
  State directory    : ${home}
`);
  if (paired) {
    console.log(`Step 1 — Pairing: this bridge is already paired with an extension (id ${paired.id}).`);
    console.log(`         To pair a different browser profile, delete ${home} and restart.\n`);
  } else {
    console.log(`Step 1 — Pair the extension. In the AnyMCP side panel choose “Connect” and enter this code:`);
    console.log(`           ${code.slice(0, 4)} ${code.slice(4)}      (single use, expires in 10 minutes)\n`);
  }
  console.log(`Step 2 — Connect your AI app.\n`);
  console.log(`  Claude Code (HTTP) — copy this command:\n`);
  console.log(`  claude mcp add --transport http anymcp ${bridge.mcpUrl} --header "Authorization: Bearer ${bridge.token()}"\n`);
  console.log(`  (The token is a password for this bridge. Do not share it. Revoke it any time from AnyMCP → Settings.)\n`);
  if (launch) {
    console.log(`  Claude Desktop, Cursor and other apps that start MCP servers themselves — add this to their MCP settings:\n`);
    console.log(JSON.stringify({ mcpServers: { anymcp: { command: launch.command, args: launch.args } } }, null, 2).replace(/^/gm, "  "));
    console.log(`\n  (No password needed: the app starts AnyMCP on this computer and shares this browser connection.)\n`);
  }

  const stop = async () => {
    console.log("\n[anymcp] shutting down…");
    await bridge.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  const ports = { mcpPort: Number(arg("mcp-port") ?? DEFAULT_MCP_PORT), extPort: Number(arg("ext-port") ?? DEFAULT_EXT_PORT) };
  console.error(`AnyMCP bridge could not start: ${explainListenError(e, ports) ?? String(e)}`);
  process.exit(1);
});
