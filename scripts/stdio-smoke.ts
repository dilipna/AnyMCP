// Smoke test of the PACKAGED bridge over stdio: `node packages/bridge/dist/anymcp-bridge.mjs --stdio`, driven by the
// official MCP SDK client exactly as an app that launches local MCP servers would. Run after `npm run build`.
//   npx tsx scripts/stdio-smoke.ts
// With --npx=<package> it starts the bridge the way the bridge tells apps to when it was itself started with npx:
// `npx -y --package=<package> anymcp-bridge --stdio` (through `cmd /c` on Windows), e.g. a release's .tgz address.
//   npx tsx scripts/stdio-smoke.ts --npx=https://github.com/dilipna/AnyMCP/releases/download/v0.1.1/dilipna-anymcp-bridge-0.1.1.tgz

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

const bundle = resolve(import.meta.dirname, "../packages/bridge/dist/anymcp-bridge.mjs");
const npxPackage = process.argv.find((a) => a.startsWith("--npx="))?.slice("--npx=".length);
const launch = (rest: string[]) => {
  if (!npxPackage) return { command: process.execPath, args: [bundle, ...rest] };
  const args = ["-y", "--no-update-notifier", `--package=${npxPackage}`, "anymcp-bridge", ...rest];
  return process.platform === "win32" ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
};
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

const home = mkdtempSync(join(tmpdir(), "anymcp-stdio-smoke-"));
try {
  const transport = new StdioClientTransport({
    ...launch(["--stdio", `--home=${home}`, `--mcp-port=${await freePort()}`, `--ext-port=${await freePort()}`]),
    env: getDefaultEnvironment(),
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-smoke", version: "0.0.0" });
  await client.connect(transport);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  const status = await client.callTool({ name: "anymcp_status", arguments: {} });
  await client.close();
  const ok = JSON.stringify(names) === JSON.stringify(["anymcp_get_run", "anymcp_status"]) && (status.structuredContent as { extension?: string })?.extension === "not_paired";
  console.log(`${ok ? "PASS" : "FAIL"} ${npxPackage ? `npx --package=${npxPackage}` : "packaged bridge"} over stdio: tools=${JSON.stringify(names)} status=${JSON.stringify(status.structuredContent)}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
