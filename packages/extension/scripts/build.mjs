// Builds the AnyMCP Extension.  node packages/extension/scripts/build.mjs [--target=prod|e2e] [--watch]
//
//   prod : the build that is zipped for the Chrome Web Store. No fixed host permissions (sites are granted
//          one at a time at runtime), no test hooks, minified, no source maps.
//   e2e  : for automated browser tests ONLY. Adds loopback host permissions (Chrome cannot show its
//          permission prompt to a test) and compiles in the test hook. Never zipped or published.
//
// Deterministic: same sources -> same bytes (no timestamps, sorted inputs).

import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const target = arg("target", "prod");
if (!["prod", "e2e"].includes(target)) throw new Error(`unknown target ${target}`);
const watch = process.argv.includes("--watch");
const out = resolve(root, "dist", target);

const versionSrc = readFileSync(resolve(root, "../protocol/src/version.ts"), "utf8");
const version = /ANYMCP_VERSION = "([^"]+)"/.exec(versionSrc)?.[1];
if (!version) throw new Error("could not read ANYMCP_VERSION");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

// ---------------------------------------------------------------- icons (pure-JS PNG, supersampled)
function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
/** A rounded blue square with a white check: "verified". Works at 16px and 128px. */
function icon(size) {
  const S = 4; // supersample
  const rad = 0.22, thick = 0.075;
  const seg = [[0.27, 0.53], [0.44, 0.69], [0.74, 0.33]];
  const dist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  };
  return png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      const cx = Math.abs(u - 0.5) - (0.5 - rad), cy = Math.abs(v - 0.5) - (0.5 - rad);
      const inside = Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) <= rad;
      if (!inside) continue;
      const onCheck = Math.min(dist(u, v, seg[0], seg[1]), dist(u, v, seg[1], seg[2])) <= thick;
      const c = onCheck ? [255, 255, 255] : [11, 87, 208];
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = S * S;
    const cov = a / 255;
    return cov === 0 ? [0, 0, 0, 0] : [Math.round(r / cov), Math.round(g / cov), Math.round(b / cov), Math.round(a / n)];
  });
}
for (const s of [16, 32, 48, 128]) writeFileSync(join(out, "icons", `icon-${s}.png`), icon(s));

// ---------------------------------------------------------------- manifest
const manifest = {
  manifest_version: 3,
  name: target === "e2e" ? "AnyMCP Extension (test build)" : "AnyMCP Extension",
  short_name: "AnyMCP",
  version,
  description: "Teach a website task once, review it, and let your AI app run it as an MCP tool. Needs the local AnyMCP bridge.",
  minimum_chrome_version: "116",
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  action: { default_title: "AnyMCP", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
  side_panel: { default_path: "sidepanel.html" },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["storage", "sidePanel", "scripting", "alarms"],
  // Sites are granted ONE AT A TIME at runtime (chrome.permissions.request from a user click).
  optional_host_permissions: ["http://*/*", "https://*/*"],
  // e2e only: loopback, plus (optionally) specific hosts for an authorised external read-only check, e.g.
  // ANYMCP_E2E_HOSTS="https://books.toscrape.com/*". Never present in the prod build.
  host_permissions: target === "e2e" ? ["http://127.0.0.1/*", "http://localhost/*", ...(process.env.ANYMCP_E2E_HOSTS ? process.env.ANYMCP_E2E_HOSTS.split(",").map((h) => h.trim()).filter(Boolean) : [])] : [],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};
if (manifest.description.length > 132) throw new Error("manifest description exceeds the 132-character Web Store limit");
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
copyFileSync(resolve(root, "src/sidepanel/sidepanel.html"), join(out, "sidepanel.html"));

// ---------------------------------------------------------------- bundles
const common = {
  bundle: true,
  platform: "browser",
  target: "chrome116",
  minify: target === "prod",
  sourcemap: target === "e2e" ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
  define: { __ANYMCP_TEST__: String(target === "e2e"), "process.env.NODE_ENV": '"production"' },
};
const jobs = [
  { ...common, entryPoints: { background: resolve(root, "src/background/index.ts") }, format: "esm", outdir: out },
  { ...common, entryPoints: { content: resolve(root, "src/content/index.ts") }, format: "iife", outdir: out },
  { ...common, entryPoints: { sidepanel: resolve(root, "src/sidepanel/main.tsx") }, format: "esm", outdir: out, jsx: "automatic", loader: { ".css": "css" } },
];

if (watch) {
  for (const j of jobs) await (await context(j)).watch();
  console.log(`watching → ${out}`);
} else {
  await Promise.all(jobs.map((j) => build(j)));
  console.log(`built AnyMCP Extension ${version} (${target}) → ${out}`);
}
