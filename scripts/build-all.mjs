// Builds everything that ships: the production extension and the single-file bridge.
//   node scripts/build-all.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 1. extension (production target: no test hooks, no fixed host permissions)
execFileSync(process.execPath, [resolve(root, "packages/extension/scripts/build.mjs"), "--target=prod"], { stdio: "inherit" });

// 2. bridge: ONE self-contained file (`node anymcp-bridge.mjs`), dependencies inlined
const version = /ANYMCP_VERSION = "([^"]+)"/.exec(readFileSync(resolve(root, "packages/protocol/src/version.ts"), "utf8"))[1];
const outfile = resolve(root, "packages/bridge/dist/anymcp-bridge.mjs");
mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, "packages/bridge/src/cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false, // keep the bridge readable: it is a security-relevant program people may want to audit
  sourcemap: false,
  legalComments: "none",
  // `ws` has optional native accelerators; it works without them
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
  logLevel: "warning",
});
writeFileSync(resolve(root, "packages/bridge/dist/VERSION"), version + "\n");
console.log(`built bridge ${version} → packages/bridge/dist/anymcp-bridge.mjs`);
