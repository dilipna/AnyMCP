// Install the PACKED bridge (release/dilipna-anymcp-bridge-<version>.tgz) into an empty folder OUTSIDE the repository
// and start it from there, the way a user of the npm package would. Nothing is published or downloaded: the package
// has no dependencies, so the install needs only the local .tgz.
//   node scripts/package-release.mjs && node scripts/verify-npm-package.mjs

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(root, "release");
const tgzName = readdirSync(releaseDir).find((f) => /^dilipna-anymcp-bridge-.*\.tgz$/.test(f));
if (!tgzName) throw new Error("run `node scripts/package-release.mjs` first");
const tgz = join(releaseDir, tgzName);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

const dir = mkdtempSync(join(tmpdir(), "anymcp-npm-check-"));
const home = mkdtempSync(join(tmpdir(), "anymcp-npm-home-"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

try {
  execSync("npm init -y", { cwd: dir, stdio: "ignore" });
  execSync(`npm install "${tgz}" --no-audit --no-fund`, { cwd: dir, stdio: "ignore" });
  const installed = join(dir, "node_modules", "@dilipna", "anymcp-bridge", "anymcp-bridge.mjs");
  check("installs from the .tgz into an empty folder outside the repository", existsSync(installed));
  const extra = readdirSync(join(dir, "node_modules")).filter((n) => n !== "@dilipna" && n !== ".bin" && n !== ".package-lock.json");
  check("pulls in no dependencies", extra.length === 0, extra.join(", "));
  check("ships the licence, notices and readme", ["LICENSE", "THIRD_PARTY_NOTICES.md", "README.md"].every((f) => existsSync(join(dirname(installed), f))));

  const help = execSync("npx --no-install anymcp-bridge --help", { cwd: dir, encoding: "utf8" });
  check("the anymcp-bridge command runs (npx --no-install)", /AnyMCP bridge \d+\.\d+\.\d+/.test(help), help.split("\n")[0]);

  // HTTP mode: start, answer /health, stop
  const mcpPort = await freePort();
  const extPort = await freePort();
  const p = spawn(process.execPath, [installed, `--home=${home}`, `--mcp-port=${mcpPort}`, `--ext-port=${extPort}`], { cwd: dir, stdio: "pipe" });
  let health = null;
  for (let i = 0; i < 50 && !health; i++) {
    await sleep(100);
    health = await fetch(`http://127.0.0.1:${mcpPort}/health`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  check("starts and answers /health on loopback", !!health, health ? JSON.stringify(health).slice(0, 80) : "no answer");
  const unauth = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status).catch(() => 0);
  check("refuses MCP requests without the token", unauth === 401, `status ${unauth}`);
  p.kill();
  await new Promise((r) => p.once("exit", r));

  // stdio mode, as an app that launches MCP servers would start it
  const client = new Client({ name: "npm-package-check", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [installed, "--stdio", `--home=${home}`, `--mcp-port=${await freePort()}`, `--ext-port=${await freePort()}`], cwd: dir, env: getDefaultEnvironment(), stderr: "pipe" }),
  );
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  await client.close();
  check("serves MCP over stdio from the installed package", JSON.stringify(names) === JSON.stringify(["anymcp_get_run", "anymcp_status"]), names.join(", "));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
writeFileSync(join(releaseDir, "npm-install-check.txt"), results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`).join("\n") + `\nnode ${process.version} on ${process.platform}\n`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
