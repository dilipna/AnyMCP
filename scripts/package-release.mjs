// Reproducible release artifacts.
//   node scripts/package-release.mjs [--verify]
//
// Produces release/:
//   mycp-extension-<version>.zip   the Chrome Web Store upload (production build only)
//   mycp-bridge-<version>.mjs      the single-file bridge
//   THIRD_PARTY_NOTICES.md         licences of bundled dependencies
//   SHA256SUMS.txt
//
// The ZIP is deterministic: entries sorted, fixed 1980-01-01 timestamps, no extra attributes, maximum deflate.
// `--verify` builds a second time from scratch and fails unless the bytes are identical.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = resolve(root, "packages/extension/dist/prod");
const version = /MYCP_VERSION = "([^"]+)"/.exec(readFileSync(resolve(root, "packages/protocol/src/version.ts"), "utf8"))[1];
const releaseDir = resolve(root, "release");

// ---------------------------------------------------------------- deterministic zip
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
function zipDir(dir) {
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00:00
  const locals = [], central = [];
  let offset = 0;
  for (const file of walk(dir)) {
    const name = Buffer.from(relative(dir, file).replaceAll("\\", "/"), "utf8");
    const data = readFileSync(file);
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------- licences of what is bundled
function collectLicences() {
  const wanted = new Set();
  const queue = [];
  for (const pkg of ["extension", "bridge", "protocol"]) {
    const j = JSON.parse(readFileSync(resolve(root, `packages/${pkg}/package.json`), "utf8"));
    for (const d of Object.keys(j.dependencies ?? {})) if (!d.startsWith("mycp-")) queue.push(d);
  }
  const seen = new Set();
  const lines = ["# Third-party notices", "", "MyCP bundles the following open-source packages. Each is used under its own licence.", ""];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = resolve(root, "node_modules", name);
    if (!existsSync(join(dir, "package.json"))) continue;
    const j = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const d of Object.keys(j.dependencies ?? {})) queue.push(d);
    wanted.add(name);
    const licFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"].map((f) => join(dir, f)).find(existsSync);
    lines.push(`## ${name} ${j.version}`, "", `Licence: ${typeof j.license === "string" ? j.license : JSON.stringify(j.license ?? "see package")}`, "");
    if (licFile) lines.push("```", readFileSync(licFile, "utf8").trim(), "```", "");
  }
  return lines.join("\n");
}

function buildOnce() {
  execFileSync(process.execPath, [resolve(root, "scripts/build-all.mjs")], { stdio: "ignore" });
  const zip = zipDir(extDir);
  const bridge = readFileSync(resolve(root, "packages/bridge/dist/mycp-bridge.mjs"));
  return { zip, bridge };
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

const a = buildOnce();
if (process.argv.includes("--verify")) {
  rmSync(resolve(root, "packages/extension/dist"), { recursive: true, force: true });
  rmSync(resolve(root, "packages/bridge/dist"), { recursive: true, force: true });
  const b = buildOnce();
  const same = sha(a.zip) === sha(b.zip) && sha(a.bridge) === sha(b.bridge);
  console.log(same ? `REPRODUCIBLE: two clean builds are byte-identical (zip ${sha(a.zip).slice(0, 12)}…, bridge ${sha(a.bridge).slice(0, 12)}…)` : "NOT REPRODUCIBLE: two clean builds differ");
  if (!same) process.exit(1);
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const zipName = `mycp-extension-${version}.zip`, bridgeName = `mycp-bridge-${version}.mjs`;
writeFileSync(join(releaseDir, zipName), a.zip);
copyFileSync(resolve(root, "packages/bridge/dist/mycp-bridge.mjs"), join(releaseDir, bridgeName));
writeFileSync(join(releaseDir, "THIRD_PARTY_NOTICES.md"), collectLicences());
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
writeFileSync(join(releaseDir, "permissions-summary.json"), JSON.stringify({ permissions: manifest.permissions, optional_host_permissions: manifest.optional_host_permissions, host_permissions: manifest.host_permissions, minimum_chrome_version: manifest.minimum_chrome_version }, null, 2) + "\n");
const sums = [zipName, bridgeName, "THIRD_PARTY_NOTICES.md", "permissions-summary.json"].map((f) => `${sha(readFileSync(join(releaseDir, f)))}  ${f}`);
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`release/ ready for MyCP ${version}:\n${sums.map((s) => "  " + s).join("\n")}`);
