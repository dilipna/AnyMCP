// Drives the REAL extension (e2e build) through every core screen and saves screenshots of the
// side panel page at side-panel width. Used to inspect the UI and to prepare store assets.
//   npx tsx scripts/screenshots.ts [--dark]
// The panel is the extension's own page (Playwright cannot capture Chrome's docked side-panel chrome).

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { startStack, waitForState, sleep } from "../e2e/harness";
import type { TabCandidate } from "../packages/extension/src/shared/panel-api";

const dark = process.argv.includes("--dark");
const out = resolve(import.meta.dirname, "../store/screenshots/raw", dark ? "dark" : "light");
mkdirSync(out, { recursive: true });

const shot = async (p: Page, name: string, full = true) => {
  await sleep(250);
  await p.screenshot({ path: resolve(out, `${name}.png`), fullPage: full });
  console.log("saved", name);
};

// ---- 1. onboarding (not paired) ----
{
  const s = await startStack({ pair: false });
  await s.panel.setViewportSize({ width: 420, height: 900 });
  if (dark) await s.panel.emulateMedia({ colorScheme: "dark" });
  await s.panel.reload();
  await sleep(500);
  await shot(s.panel, "01-onboarding");
  await s.panel.getByRole("button", { name: "Settings" }).click();
  await shot(s.panel, "08-settings-unpaired");
  await s.close();
}

// ---- 2..7. everything with a paired stack ----
const s = await startStack();
const panel = s.panel;
await panel.setViewportSize({ width: 420, height: 900 });
if (dark) await panel.emulateMedia({ colorScheme: "dark" });
await panel.reload();
await sleep(500);

await shot(panel, "02-tool-library");

await panel.getByText("Find order").first().click();
await sleep(600);
await shot(panel, "03-tool-review");
await panel.getByLabel("order_id").fill("A-1012");
await panel.getByRole("button", { name: "Run test" }).click();
await panel.getByText("Result returned to the assistant").waitFor();
await shot(panel, "04-test-result");
await panel.getByRole("button", { name: "← All tools" }).click();

// approval request
const c = await s.mcp();
const pending = s.run(c, "draft_customer_note", { order_id: "A-1012", note: "Please call the customer back about the delayed shipment." });
await waitForState(s, (st) => !!st.approval);
await sleep(400);
await shot(panel, "05-approval-request", false);
await s.approve();
await pending;

// an honest "unknown outcome" run, for the timeline
await s.chaos({ ackLost: "opaque" });
const p2 = s.run(c, "draft_customer_note", { order_id: "A-1013", note: "Second note whose confirmation gets lost." });
await waitForState(s, (st) => !!st.approval);
await s.approve();
await p2;
await s.chaos({ reset: true });
await panel.getByRole("button", { name: "Runs" }).click();
await sleep(400);
await shot(panel, "06-runs");
await panel.getByText("Draft customer note").first().click();
await sleep(400);
await shot(panel, "07-run-timeline-unknown-outcome");

await panel.getByRole("button", { name: "Settings" }).click();
await shot(panel, "08-settings");

// recording flow
await panel.getByRole("button", { name: "Teach", exact: true }).click();
const page = await s.context.newPage();
await page.goto(`${s.fixture.origin}/orders`);
await sleep(300);
await panel.bringToFront();
await panel.reload();
await panel.getByRole("button", { name: "Teach", exact: true }).click();
await sleep(600);
await shot(panel, "09-record-pick-tab");
const cands = (await s.call<TabCandidate[]>({ type: "tabs.candidates" })) as { data: TabCandidate[] };
const tab = cands.data.find((t) => t.url === page.url())!;
await s.call({ type: "record.start", tabId: tab.tabId });
await page.getByLabel("Order ID").click();
await page.keyboard.type("A-1012");
await page.getByRole("button", { name: "Search" }).click();
await page.getByRole("link", { name: "A-1012" }).click();
await page.waitForURL(/orders\/A-1012$/);
await page.locator("[data-mycp-banner]").waitFor({ state: "attached" });
await s.call({ type: "record.pick", mode: "text" });
await waitForState(s, (x) => x.recording?.pick === "text");
await page.locator('[data-testid="order-status"]').click();
await s.call({ type: "record.pick", mode: "success" });
await waitForState(s, (x) => x.recording?.pick === "success");
await page.locator('[data-testid="order-id"]').click();
await waitForState(s, (x) => (x.recording?.signals.length ?? 0) === 1);
await panel.bringToFront();
await sleep(500);
await shot(panel, "10-recording");
await page.screenshot({ path: resolve(out, "10b-page-with-recording-banner.png") });
await s.call({ type: "record.stop" });
await sleep(300);
await panel.getByRole("button", { name: "Review the tool →" }).click();
await sleep(500);
await shot(panel, "11-tool-editor");
await c.close();
await s.close();
console.log("done →", out);
