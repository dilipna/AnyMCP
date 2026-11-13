// One-command development startup: the synthetic fixture site + the bridge, with the extension built.
//   npm run dev
// Then: load packages/extension/dist/prod in chrome://extensions (Developer mode → Load unpacked).
import { spawn, execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

console.log("Building the extension (production target)…");
execFileSync(process.execPath, [resolve(root, "packages/extension/scripts/build.mjs"), "--target=prod"], { stdio: "inherit" });

console.log(`
Starting the SYNTHETIC fixture site (http://127.0.0.1:4173) and the bridge.

  1. chrome://extensions → Developer mode → Load unpacked → ${resolve(root, "packages/extension/dist/prod")}
  2. Open http://127.0.0.1:4173/orders in a tab, then open the MyCP side panel (toolbar icon).
  3. Pair with the code printed below, then Teach → choose the tab → Allow this site → Start recording.
`);

const run = (args, label) => {
  const p = spawn(npx, ["tsx", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const tag = `[${label}] `;
  p.stdout.on("data", (d) => process.stdout.write(String(d).replace(/^/gm, tag)));
  p.stderr.on("data", (d) => process.stderr.write(String(d).replace(/^/gm, tag)));
  p.on("exit", (c) => console.log(`${tag}exited (${c})`));
  return p;
};
const children = [run(["packages/fixture/src/server.ts", "--control"], "fixture"), run(["packages/bridge/src/cli.ts"], "bridge")];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
