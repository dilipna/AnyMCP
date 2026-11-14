// Gate 1: "a fresh checkout can build and start the documented components".
//   node scripts/clean-install-check.mjs [--e2e]
//
// Copies the SOURCES (no node_modules, no build output, no .git, no results) into a brand-new temp directory and
// follows the README: npm ci → typecheck → unit tests → build → reproducible package → start the bridge and hit
// /health. With --e2e it also runs the browser suite there. Nothing is run inside the working copy.
import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = mkdtempSync(join(tmpdir(), "anymcp-clean-"));
const SKIP = new Set(["node_modules", "dist", "release", ".git", "test-results", "playwright-report", "results", "raw", ".anymcp-test"]);
cpSync(root, dest, {
  recursive: true,
  filter: (src) => !src.split(sep).some((part) => SKIP.has(part)) || src === root,
});
console.log(`copied sources to ${dest}`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];
function step(name, cmd, args, opts = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { cwd: dest, stdio: "pipe", shell: process.platform === "win32", encoding: "utf8", timeout: 900_000, ...opts });
  const ok = r.status === 0;
  results.push({ name, ok, seconds: Math.round((Date.now() - t) / 1000) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${results.at(-1).seconds}s)`);
  if (!ok) console.log(String(r.stdout).slice(-1500) + String(r.stderr).slice(-1500));
  return ok;
}

let ok =
  step("npm ci", npm, ["ci", "--no-audit", "--no-fund"]) &&
  step("npm run typecheck", npm, ["run", "typecheck"]) &&
  step("npm test", npm, ["test"]) &&
  step("npm run build", npm, ["run", "build"]) &&
  step("npm run package -- --verify (two clean builds, byte-identical)", npm, ["run", "package", "--", "--verify"]) &&
  step("npm run package:check (install the npm tarball outside the checkout and run it)", npm, ["run", "package:check"]);

if (ok) {
  // start the BUNDLED bridge exactly as documented and check it answers
  const home = mkdtempSync(join(tmpdir(), "anymcp-clean-home-"));
  const child = spawn(process.execPath, [join(dest, "release", `anymcp-bridge-0.1.0.mjs`), "--mcp-port=49820", "--ext-port=49821", `--home=${home}`], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  let health = null;
  try {
    health = await (await fetch("http://127.0.0.1:49820/health")).json();
  } catch {
    /* fall through */
  }
  child.kill();
  rmSync(home, { recursive: true, force: true });
  const good = !!health?.ok;
  results.push({ name: "bundled bridge starts and answers /health", ok: good, seconds: 3 });
  console.log(`${good ? "PASS" : "FAIL"}  bundled bridge starts and answers /health`);
  ok = good;
}
if (ok && process.argv.includes("--e2e")) ok = step("npm run test:e2e", npm, ["run", "test:e2e"]);

console.log(`\nClean-install check: ${ok ? "PASSED" : "FAILED"} on ${process.platform} (${process.version}) — ${results.map((r) => `${r.name}: ${r.ok ? "ok" : "FAIL"}`).join("; ")}`);
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
