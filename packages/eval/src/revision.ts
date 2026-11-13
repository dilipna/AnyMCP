// Identify exactly which code produced a result. The repository may have no commits yet, so we ALWAYS
// record a content hash of the sources, and additionally the git revision when one exists.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const INCLUDE = ["packages", "e2e", "scripts", "docs/evaluation-protocol.md", "package.json"];
const SKIP = new Set(["node_modules", "dist", "test-results", "release", ".anymcp-test", "screenshots", "results", ".git"]);

function walk(p: string, out: string[]) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p).sort()) if (!SKIP.has(name)) walk(join(p, name), out);
  } else if (/\.(ts|tsx|mjs|json|css|html|md)$/.test(p) && !p.endsWith("scenarios.lock.json")) out.push(p);
}

export function sourceTreeHash(): { sha256: string; files: number } {
  const files: string[] = [];
  for (const i of INCLUDE) {
    try {
      walk(join(ROOT, i), files);
    } catch {
      /* optional */
    }
  }
  const h = createHash("sha256");
  for (const f of files.sort()) {
    h.update(relative(ROOT, f).replaceAll("\\", "/"));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return { sha256: h.digest("hex"), files: files.length };
}

export function gitRevision(): { head: string | null; dirty: boolean | null } {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
    return { head, dirty };
  } catch {
    return { head: null, dirty: null }; // no commits yet (or no git)
  }
}

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
