// Reproducible check: can the AnyMCP Extension's service worker open a WebSocket to the local bridge on 127.0.0.1
// in a REAL Chrome? Chrome 147+ gates some localhost access behind "Local Network Access"; Chrome's docs do not say
// whether extension origins are exempt, so we measure instead of assuming.
//
//   npx tsx scripts/lna-spike.ts [--channel=chrome|chromium] [--headed]
//
// Uses a TEMPORARY profile (never yours). Branded Chrome ignores --load-extension (137+), so the extension is
// loaded through the DevTools protocol (Extensions.loadUnpacked), which needs --enable-unsafe-extension-debugging.

import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBridge } from "../packages/bridge/src/bridge";
import { REQUEST_TAG } from "../packages/extension/src/shared/panel-api";

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const channel = arg("channel", "chrome");
const headed = process.argv.includes("--headed");
const EXT = resolve(import.meta.dirname, "../packages/extension/dist/e2e");

const home = mkdtempSync(join(tmpdir(), "anymcp-lna-bridge-"));
const bridge = await startBridge({ mcpPort: 0, extPort: 0, home });
const profile = mkdtempSync(join(tmpdir(), "anymcp-lna-profile-"));
// A persistent context behaves like a normal profile (a plain newContext() is incognito-like: extensions are off there).
const ctx = await chromium.launchPersistentContext(profile, {
  channel,
  headless: !headed,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: ["--enable-unsafe-extension-debugging"],
});
const browser = ctx.browser()!;
const version = browser.version();
const out: Record<string, unknown> = { channel, headed, browserVersion: version, bridgeExt: bridge.extUrl };

try {
  const cdp = await browser.newBrowserCDPSession();
  const loaded = (await cdp.send("Extensions.loadUnpacked" as never, { path: EXT } as never)) as { id: string };
  out.extensionId = loaded.id;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${loaded.id}/sidepanel.html`);
  const call = (req: unknown) => page.evaluate(async ({ tag, r }) => chrome.runtime.sendMessage({ [tag]: true, req: r }), { tag: REQUEST_TAG, r: req });

  const t0 = Date.now();
  const res = await call({ type: "pair", url: bridge.extUrl, code: bridge.pairingCode() });
  out.pairResult = res;
  out.pairMs = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));
  const state = (await call({ type: "__test.state" })) as { ok: boolean; data?: { conn: { state: string; error: string | null } } };
  out.connection = state.data?.conn;
  out.bridgeSeesExtension = bridge.hub.connected;
  out.verdict = bridge.hub.connected ? "WORKS: extension service worker reached the loopback bridge" : "BLOCKED or failed: see pairResult/connection.error";
} catch (e) {
  out.error = String(e);
  out.verdict = "spike could not complete (see error)";
} finally {
  console.log(JSON.stringify(out, null, 2));
  await ctx.close().catch(() => undefined);
  await bridge.close().catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
