// Authorizing a website, including the case automated tests used to hide.
//
// Chrome only tells an extension the address of a tab on a site it may access. The test build is pre-granted
// localhost, so it always "saw" the fixture tab; the PRODUCTION build saw nothing and offered no way to allow a
// first site. These tests cover the "Allow a website" form and load the real production build to prove the
// Teach screen is no longer a dead end. (Chrome's own permission prompt cannot be automated: see the manual test.)

import AxeBuilder from "@axe-core/playwright";
import { chromium, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFixture } from "anymcp-fixture";
import { startStack, waitForState, type Stack } from "./harness";

test.describe("test build", () => {
  let s: Stack;
  test.beforeAll(async () => {
    s = await startStack({ pair: false }); // nothing allowed yet
  });
  test.afterAll(async () => {
    await s?.close();
  });

  test("allow a site by typing its address, see the checklist advance, then revoke it", async () => {
    const p = s.panel;
    await p.setViewportSize({ width: 420, height: 900 });
    for (const scheme of ["light", "dark"] as const) {
      await p.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await p.reload();
      // home: the checklist names the next step
      await expect(p.getByRole("heading", { name: "Getting started" })).toBeVisible();
      await expect(p.locator('[aria-current="step"]')).toContainText("Start the bridge and pair this browser");
      const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`), `checklist ${scheme}`).toEqual([]);
    }

    await p.getByRole("button", { name: "Teach", exact: true }).click();
    const form = p.getByRole("form", { name: "Allow a website" });
    const box = form.getByLabel(/Website address/);

    // refused input never reaches Chrome
    await box.fill("http://example.com");
    await expect(form.getByText(/only works on secure sites/)).toBeVisible();
    await expect(form.getByRole("button", { name: "Allow this site" })).toBeDisabled();

    // a pasted page address is reduced to the exact origin
    const origin = s.fixture.origin;
    await box.fill(`${origin}/orders?x=1`);
    await expect(form.getByText(origin, { exact: true })).toBeVisible();
    await form.getByRole("button", { name: "Allow this site" }).click();
    const st = await waitForState(s, (x) => x.grants.some((g) => g.origin === origin));
    expect(st.grants.map((g) => g.origin)).toEqual([origin]);
    await expect(form.getByText(/^Allowed:/)).toBeVisible();

    // revoke in Settings: the grant is gone
    await p.getByRole("button", { name: "Settings" }).click();
    await p.getByRole("button", { name: "Remove" }).click();
    await waitForState(s, (x) => x.grants.length === 0);
  });
});

test("production build: Teach is not a dead end when Chrome hides every tab's address", async () => {
  const root = resolve(import.meta.dirname, "..");
  execFileSync(process.execPath, [resolve(root, "packages/extension/scripts/build.mjs"), "--target=prod"], { stdio: "ignore" });
  const EXT = resolve(root, "packages/extension/dist/prod");
  const profile = mkdtempSync(join(tmpdir(), "anymcp-prod-panel-"));
  const fixture = await startFixture({ port: 0 });
  const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const extId = new URL(sw.url()).host;
    const site = await ctx.newPage();
    await site.goto(`${fixture.origin}/orders`);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.getByRole("button", { name: "Teach", exact: true }).click();

    // the open website tab is invisible to the extension (no host access yet) ...
    await expect(panel.getByText("None yet. Allow the website below, then open it in a tab.")).toBeVisible();
    await expect(panel.getByText(/open on sites you have not allowed/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Start recording" })).toHaveCount(0);
    // ... and the person has a way forward
    const form = panel.getByRole("form", { name: "Allow a website" });
    await form.getByLabel(/Website address/).fill(fixture.origin);
    await expect(form.getByRole("button", { name: "Allow this site" })).toBeEnabled();
  } finally {
    await ctx.close();
    await fixture.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
