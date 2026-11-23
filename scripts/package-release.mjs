// Reproducible release artifacts. Nothing is published.
//   node scripts/package-release.mjs [--verify]
//
// Produces release/:
//   anymcp-extension-<version>.zip        Chrome Web Store upload: the production build + LICENSE + notices
//   dilipna-anymcp-bridge-<version>.tgz   npm package of the bridge (`npm pack`), dependency-free single file
//   anymcp-bridge-<version>.mjs           the same bridge as one file (run with `node`)
//   THIRD_PARTY_NOTICES-extension.md      licences of what the extension bundles
//   THIRD_PARTY_NOTICES-bridge.md         licences of what the bridge bundles
//   extension-contents.txt, npm-package-contents.txt   exact packaged files and sizes
//   permissions-summary.json, SHA256SUMS.txt
//
// The ZIP is deterministic: entries sorted, fixed 1980-01-01 timestamps, no extra attributes, maximum deflate.
// `--verify` builds a second time from scratch and fails unless the ZIP, the bridge and the npm tarball are
// byte-identical.

import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = resolve(root, "packages/extension/dist/prod");
const version = /ANYMCP_VERSION = "([^"]+)"/.exec(readFileSync(resolve(root, "packages/protocol/src/version.ts"), "utf8"))[1];
const releaseDir = resolve(root, "release");
export const NPM_NAME = "@dilipna/anymcp-bridge";
// The npm package is attached to each GitHub release; it is not on the npm registry (same address as the bridge's
// RELEASE_PACKAGE_URL in packages/bridge/src/launch.ts).
const RELEASE_TGZ = `https://github.com/dilipna/AnyMCP/releases/download/v${version}/dilipna-anymcp-bridge-${version}.tgz`;

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

// ---------------------------------------------------------------- licences of what each artifact bundles
function collectLicences(packages, what) {
  const queue = [];
  for (const pkg of packages) {
    const j = JSON.parse(readFileSync(resolve(root, `packages/${pkg}/package.json`), "utf8"));
    for (const d of Object.keys(j.dependencies ?? {})) if (!d.startsWith("anymcp-")) queue.push(d);
  }
  const seen = new Set();
  const lines = ["# Third-party notices", "", `The AnyMCP ${what} bundles the following open-source packages. Each is used under its own licence.`, ""];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = resolve(root, "node_modules", name);
    if (!existsSync(join(dir, "package.json"))) continue;
    const j = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const d of Object.keys(j.dependencies ?? {})) queue.push(d);
    const licFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"].map((f) => join(dir, f)).find(existsSync);
    lines.push(`## ${name} ${j.version}`, "", `Licence: ${typeof j.license === "string" ? j.license : JSON.stringify(j.license ?? "see package")}`, "");
    if (licFile) lines.push("```", readFileSync(licFile, "utf8").replace(/\r\n/g, "\n").trim(), "```", "");
  }
  return lines.join("\n");
}

const NPM_README = `# ${NPM_NAME}

The local bridge for **AnyMCP**, a Chrome extension that turns website tasks you teach and approve in your own
browser into MCP tools for your AI app (an MCP client such as Claude Code).

The bridge is the MCP server: your AI app connects to it over HTTP or stdio, and it relays calls to the AnyMCP
extension over an authenticated local WebSocket. It listens on 127.0.0.1 only. It calls no AI model and needs no
account. It does nothing useful without the AnyMCP extension.

**Status: developer beta, not production software.** See https://github.com/dilipna/AnyMCP for what is supported.

## Use

Requires Node.js 20.19 or newer. This package is attached to AnyMCP's GitHub releases; it is **not** on the npm
registry, so install it from its release address (the release workflow proves this file is identical to a clean build
of the tagged source and signs it: \`gh attestation verify <file> --repo dilipna/AnyMCP\`).

\`\`\`bash
npx --package=${RELEASE_TGZ} anymcp-bridge
\`\`\`

That starts the bridge and prints a pairing code and setup commands. To install it once instead, so that the
command \`anymcp-bridge\` works from any terminal:

\`\`\`bash
npm install -g ${RELEASE_TGZ}
\`\`\`

* Pair: in the AnyMCP side panel choose *Connect* and enter the 8-digit code.
* Claude Code (HTTP): run the \`claude mcp add …\` command the bridge prints (it contains a local token).
* Apps that start MCP servers themselves (stdio), such as Claude Desktop or Cursor: add the \`mcpServers\` entry the
  bridge prints. It starts this same version again (through npx from the release address, or from the installed copy).
* Stop: Ctrl+C in its terminal. A stdio bridge stops when the app that started it quits.
* Update: run the newer release's command; pairing and token are kept in \`~/.anymcp\`.
* Uninstall: \`npm uninstall -g ${NPM_NAME}\` (if installed globally), remove \`anymcp\` from your AI app's settings,
  and delete \`~/.anymcp\` (it holds the pairing secret and the client token).

## Privacy and security

Nothing is sent to the AnyMCP developer; results go only to the AI app you connect. Details:
https://dilipna.github.io/AnyMCP/privacy-policy. Report vulnerabilities privately:
https://github.com/dilipna/AnyMCP/security/advisories/new (never include your token or pairing code).

## Licence

MIT. Bundled third-party code keeps its own licences: see THIRD_PARTY_NOTICES.md.
`;

function npmPackage(stage) {
  return {
    name: NPM_NAME,
    version,
    description: "Local MCP bridge for the AnyMCP Chrome extension: lets an MCP client call website tools you taught and approved in your browser. Loopback only.",
    license: "MIT",
    type: "module",
    bin: { "anymcp-bridge": "anymcp-bridge.mjs" },
    files: ["anymcp-bridge.mjs", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"],
    engines: { node: ">=20.19" },
    repository: { type: "git", url: "git+https://github.com/dilipna/AnyMCP.git" },
    homepage: "https://github.com/dilipna/AnyMCP#readme",
    bugs: { url: "https://github.com/dilipna/AnyMCP/issues" },
    keywords: ["mcp", "model-context-protocol", "chrome-extension", "browser", "local"],
    publishConfig: { access: "public" },
    _stage: stage, // removed below; keeps the shape obvious when reading this script
  };
}

function buildOnce(stageRoot) {
  execFileSync(process.execPath, [resolve(root, "scripts/build-all.mjs")], { stdio: "ignore" });
  // extension: production build + licence + its notices, zipped deterministically
  const extStage = join(stageRoot, "extension");
  rmSync(extStage, { recursive: true, force: true });
  cpSync(extDir, extStage, { recursive: true });
  copyFileSync(resolve(root, "LICENSE"), join(extStage, "LICENSE"));
  const extNotices = collectLicences(["extension", "protocol"], "extension");
  writeFileSync(join(extStage, "THIRD_PARTY_NOTICES.md"), extNotices);
  const zip = zipDir(extStage);
  // bridge: npm package staged and packed
  const npmStage = join(stageRoot, "npm");
  rmSync(npmStage, { recursive: true, force: true });
  mkdirSync(npmStage, { recursive: true });
  const bridge = readFileSync(resolve(root, "packages/bridge/dist/anymcp-bridge.mjs"));
  writeFileSync(join(npmStage, "anymcp-bridge.mjs"), bridge);
  copyFileSync(resolve(root, "LICENSE"), join(npmStage, "LICENSE"));
  const bridgeNotices = collectLicences(["bridge", "protocol"], "bridge");
  writeFileSync(join(npmStage, "THIRD_PARTY_NOTICES.md"), bridgeNotices);
  writeFileSync(join(npmStage, "README.md"), NPM_README);
  const pj = npmPackage();
  delete pj._stage;
  writeFileSync(join(npmStage, "package.json"), JSON.stringify(pj, null, 2) + "\n");
  const packed = JSON.parse(execSync(`npm pack --json --pack-destination "${stageRoot}"`, { cwd: npmStage, encoding: "utf8" }))[0];
  const tgz = readFileSync(join(stageRoot, packed.filename));
  return { zip, bridge, tgz, tgzName: packed.filename, packedFiles: packed.files, extNotices, bridgeNotices, extStage };
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

const stage = resolve(root, "release-stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const a = buildOnce(stage);
if (process.argv.includes("--verify")) {
  rmSync(resolve(root, "packages/extension/dist"), { recursive: true, force: true });
  rmSync(resolve(root, "packages/bridge/dist"), { recursive: true, force: true });
  const stage2 = resolve(root, "release-stage-2");
  rmSync(stage2, { recursive: true, force: true });
  mkdirSync(stage2, { recursive: true });
  const b = buildOnce(stage2);
  rmSync(stage2, { recursive: true, force: true });
  const same = sha(a.zip) === sha(b.zip) && sha(a.bridge) === sha(b.bridge) && sha(a.tgz) === sha(b.tgz);
  console.log(
    same
      ? `REPRODUCIBLE: two clean builds are byte-identical (zip ${sha(a.zip).slice(0, 12)}…, bridge ${sha(a.bridge).slice(0, 12)}…, npm ${sha(a.tgz).slice(0, 12)}…)`
      : `NOT REPRODUCIBLE: zip ${sha(a.zip) === sha(b.zip)}, bridge ${sha(a.bridge) === sha(b.bridge)}, npm ${sha(a.tgz) === sha(b.tgz)}`,
  );
  if (!same) process.exit(1);
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const zipName = `anymcp-extension-${version}.zip`, bridgeName = `anymcp-bridge-${version}.mjs`;
writeFileSync(join(releaseDir, zipName), a.zip);
writeFileSync(join(releaseDir, bridgeName), a.bridge);
writeFileSync(join(releaseDir, a.tgzName), a.tgz);
writeFileSync(join(releaseDir, "THIRD_PARTY_NOTICES-extension.md"), a.extNotices);
writeFileSync(join(releaseDir, "THIRD_PARTY_NOTICES-bridge.md"), a.bridgeNotices);
writeFileSync(
  join(releaseDir, "extension-contents.txt"),
  walk(a.extStage).map((f) => `${String(statSync(f).size).padStart(9)}  ${relative(a.extStage, f).replaceAll("\\", "/")}`).join("\n") + "\n",
);
writeFileSync(join(releaseDir, "npm-package-contents.txt"), a.packedFiles.map((f) => `${String(f.size).padStart(9)}  ${f.path}`).join("\n") + "\n");
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
writeFileSync(
  join(releaseDir, "permissions-summary.json"),
  JSON.stringify({ permissions: manifest.permissions, optional_host_permissions: manifest.optional_host_permissions, host_permissions: manifest.host_permissions, minimum_chrome_version: manifest.minimum_chrome_version }, null, 2) + "\n",
);
const files = [zipName, a.tgzName, bridgeName, "THIRD_PARTY_NOTICES-extension.md", "THIRD_PARTY_NOTICES-bridge.md", "permissions-summary.json"];
const sums = files.map((f) => `${sha(readFileSync(join(releaseDir, f)))}  ${f}`);
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), sums.join("\n") + "\n");
rmSync(stage, { recursive: true, force: true });
console.log(`release/ ready for AnyMCP ${version} (nothing published):\n${sums.map((s) => "  " + s).join("\n")}`);
