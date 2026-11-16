// End-to-end harness: REAL Chromium + the built AnyMCP Extension (e2e build) + the fixture site +
// the real bridge + the official MCP SDK client over HTTP. Nothing in the path is mocked.

import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startFixture, type Chaos, type FixtureHandle } from "anymcp-fixture";
import { makeDraftNoteTool, makeFindOrderTool } from "anymcp-fixture/tools";
import type { ResultEnvelope, ToolDefinition } from "anymcp-protocol";
import { startBridge, type BridgeHandle } from "../packages/bridge/src/bridge";
import { REQUEST_TAG, type PanelRequest, type PanelResponse } from "../packages/extension/src/shared/panel-api";
import type { PanelState } from "../packages/extension/src/shared/types";

export const EXT_PATH = resolve(import.meta.dirname, "../packages/extension/dist/e2e");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The browser the suites drive, from ANYMCP_E2E_BROWSER: Playwright's bundled Chromium (default) or a real,
 *  installed one. Brave has no Playwright channel; its path can be given in ANYMCP_BRAVE_PATH. */
export type E2EBrowser = "chromium" | "chrome" | "msedge" | "brave";
export const BROWSER_NAMES: Record<E2EBrowser, string> = {
  chromium: "Playwright Chromium",
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  brave: "Brave",
};
/** How results name the browser, e.g. "Microsoft Edge (real, installed) 157.0.4341.60". */
export const browserLabel = (version: string) => {
  const b = e2eBrowser();
  return `${BROWSER_NAMES[b]}${b === "chromium" ? "" : " (real, installed)"} ${version}`;
};
export function e2eBrowser(): E2EBrowser {
  const v = process.env.ANYMCP_E2E_BROWSER || "chromium";
  if (!(v in BROWSER_NAMES)) throw new Error(`ANYMCP_E2E_BROWSER=${v} is not one of ${Object.keys(BROWSER_NAMES).join(", ")}`);
  return v as E2EBrowser;
}
function bravePath(): string {
  const candidates = [
    process.env.ANYMCP_BRAVE_PATH,
    join(process.env.ProgramFiles ?? "C:\\Program Files", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    join(process.env.LOCALAPPDATA ?? "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/brave-browser",
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("Brave not found; set ANYMCP_BRAVE_PATH to its executable");
  return found;
}

export interface Stack {
  browserVersion: string;
  fixture: FixtureHandle;
  bridge: BridgeHandle;
  context: BrowserContext;
  extId: string;
  panel: Page;
  find: ToolDefinition;
  draft: ToolDefinition;
  call<T = unknown>(req: PanelRequest): Promise<PanelResponse<T>>;
  state(): Promise<PanelState>;
  mcp(token?: string): Promise<Client>;
  chaos(patch: Partial<Chaos> & { reset?: boolean }): Promise<void>;
  /** Run an MCP tool call and return the structured envelope. */
  run(client: Client, name: string, args: Record<string, unknown>): Promise<ResultEnvelope>;
  /** Terminate the extension's service worker (true suspension: the extension stays loaded; session storage survives). Returns once a NEW worker answers. */
  killWorker(): Promise<void>;
  approve(): Promise<void>;
  decline(): Promise<void>;
  close(): Promise<void>;
}

export interface StackOptions {
  pair?: boolean;
  tools?: ("find" | "draft")[];
  reconnectGraceMs?: number;
}

export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const { pair = true, tools = ["find", "draft"], reconnectGraceMs = 3000 } = opts;
  const fixture = await startFixture({ port: 0, control: true });
  const home = mkdtempSync(join(tmpdir(), "anymcp-e2e-bridge-"));
  const bridge = await startBridge({
    mcpPort: 0,
    extPort: 0,
    home,
    reconnectGraceMs,
    cancelWaitMs: 1500,
    // what a packaged bridge reports, so the side panel shows its stdio settings entry
    stdioLaunch: { command: process.execPath, args: [resolve(import.meta.dirname, "../packages/bridge/dist/anymcp-bridge.mjs"), "--stdio"] },
  });
  const profile = mkdtempSync(join(tmpdir(), "anymcp-e2e-profile-"));

  // ANYMCP_E2E_BROWSER=chrome|msedge|brave runs the SAME suite in a real browser installed on this machine.
  // Branded Chrome 137+ ignores --load-extension, so in every installed browser the extension is loaded over the
  // DevTools protocol instead.
  const which = e2eBrowser();
  let context: BrowserContext;
  let extId: string;
  if (which !== "chromium") {
    context = await chromium.launchPersistentContext(profile, {
      ...(which === "brave" ? { executablePath: bravePath() } : { channel: which }),
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging"],
    });
    const cdp = await context.browser()!.newBrowserCDPSession();
    extId = ((await cdp.send("Extensions.loadUnpacked" as never, { path: EXT_PATH } as never)) as { id: string }).id;
  } else {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", // Playwright's bundled Chromium
      headless: true,
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
    });
    let sw: Worker | undefined = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker");
    extId = new URL(sw.url()).host;
  }

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

  const find = makeFindOrderTool(fixture.origin);
  const draft = makeDraftNoteTool(fixture.origin);

  const call = async <T,>(req: PanelRequest): Promise<PanelResponse<T>> =>
    (await panel.evaluate(async ({ tag, r }) => chrome.runtime.sendMessage({ [tag]: true, req: r }), { tag: REQUEST_TAG, r: req })) as PanelResponse<T>;

  const stack: Stack = {
    browserVersion: context.browser()?.version() ?? "unknown",
    fixture,
    bridge,
    context,
    extId,
    panel,
    find,
    draft,
    call,
    async state() {
      const r = await call<PanelState>({ type: "__test.state" });
      if (!r.ok || !r.data) throw new Error(`state failed: ${JSON.stringify(r)}`);
      return r.data;
    },
    async mcp(token = bridge.token()) {
      const client = new Client({ name: "anymcp-e2e-client", version: "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(bridge.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      return client;
    },
    async chaos(patch) {
      await fetch(`${fixture.origin}/__control/chaos`, { method: "POST", body: JSON.stringify(patch) });
    },
    async run(client, name, args) {
      const res = await client.callTool({ name, arguments: args });
      return res.structuredContent as unknown as ResultEnvelope;
    },
    async killWorker() {
      const before = (await call<number>({ type: "__test.swStartedAt" })) as { data: number };
      const cdp = await context.browser()!.newBrowserCDPSession();
      const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: { targetId: string; type: string; url: string }[] };
      const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(extId));
      if (!sw) throw new Error("extension service worker target not found");
      await cdp.send("Target.closeTarget", { targetId: sw.targetId });
      const deadline = Date.now() + 10_000;
      for (;;) {
        const now = (await call<number>({ type: "__test.swStartedAt" }).catch(() => null)) as { ok: boolean; data: number } | null; // waking message restarts it
        if (now?.ok && now.data !== before.data) {
          // the panel must also have dropped any approval sheet that belonged to the dead worker
          await panel.waitForFunction(() => !document.querySelector('[role="alertdialog"]'), undefined, { timeout: 5000 });
          return;
        }
        if (Date.now() > deadline) throw new Error("service worker did not restart");
        await sleep(100);
      }
    },
    async approve() {
      await panel.getByRole("button", { name: "Approve once" }).click({ timeout: 20_000 });
    },
    async decline() {
      await panel.getByRole("button", { name: "Decline" }).click({ timeout: 20_000 });
    },
    async close() {
      await context.close().catch(() => undefined);
      await bridge.close().catch(() => undefined);
      await fixture.close().catch(() => undefined);
      rmSync(home, { recursive: true, force: true });
      rmSync(profile, { recursive: true, force: true });
    },
  };

  if (pair) {
    const r = await call({ type: "pair", url: bridge.extUrl, code: bridge.pairingCode() });
    if (!r.ok) throw new Error(`pairing failed: ${r.error}`);
    const defs = [...(tools.includes("find") ? [find] : []), ...(tools.includes("draft") ? [draft] : [])];
    const s = await call({ type: "__test.setup", definitions: defs, origins: [fixture.origin] });
    if (!s.ok) throw new Error(`setup failed: ${s.error}`);
    const deadline = Date.now() + 10_000;
    while (bridge.hub.listTools().length < defs.length && Date.now() < deadline) await sleep(50);
    if (bridge.hub.listTools().length < defs.length) throw new Error("tools did not sync to the bridge");
  }
  return stack;
}

/** Wait until a condition on the extension's state holds. */
export async function waitForState(stack: Stack, pred: (s: PanelState) => boolean, ms = 15_000): Promise<PanelState> {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = await stack.state();
    if (pred(s)) return s;
    if (Date.now() > deadline) throw new Error("timed out waiting for extension state");
    await sleep(100);
  }
}
