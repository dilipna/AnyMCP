// Accessibility evidence: axe-core (WCAG 2.0/2.1 A + AA, including colour contrast) on every core screen in
// light and dark mode, plus keyboard behaviour. axe cannot judge everything (it finds roughly a third of
// issues automatically); this is evidence, not a certification.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startStack, waitForState, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack();
  await s.panel.setViewportSize({ width: 420, height: 900 });
  // put some history in place so the Runs screens are populated
  const c = await s.mcp();
  await s.run(c, "find_order", { order_id: "A-1012" });
  await s.chaos({ ackLost: "opaque" });
  const p = s.run(c, "draft_customer_note", { order_id: "A-1013", note: "Note whose confirmation is lost." });
  await waitForState(s, (st) => !!st.approval);
  await s.approve();
  await p;
  await s.chaos({ reset: true });
  await c.close();
});
test.afterAll(async () => {
  await s?.close();
});

async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `${label}: ${summary.join("\n")}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`no WCAG A/AA violations on any core screen (${scheme})`, async () => {
    await s.panel.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); // our CSS drops all animation here; also avoids measuring contrast mid-fade
    await s.panel.reload();
    const p = s.panel;
    await p.getByRole("button", { name: "Tools", exact: true }).waitFor();
    await audit(p, `${scheme}/tool library`);

    await p.getByRole("main").getByText("Find order").first().click();
    await p.getByRole("button", { name: "Run test" }).waitFor();
    await p.getByLabel("order_id").fill("A-1012");
    await p.getByRole("button", { name: "Run test" }).click();
    await p.getByText("Result returned to the assistant").waitFor();
    await audit(p, `${scheme}/tool review + test result`);
    await p.getByRole("button", { name: "← All tools" }).click();

    await p.getByRole("button", { name: "Runs" }).click();
    await audit(p, `${scheme}/runs list`);
    await p.getByRole("main").getByText("Draft customer note").first().click();
    await p.getByRole("button", { name: "← All runs" }).waitFor();
    await audit(p, `${scheme}/run timeline (unknown outcome)`);

    await p.getByRole("button", { name: "Teach", exact: true }).click();
    await audit(p, `${scheme}/teach: choose a tab`);
    await p.getByRole("button", { name: "Settings" }).click();
    await audit(p, `${scheme}/settings`);
    await p.getByRole("button", { name: "Show the client command" }).click();
    await expect(p.getByLabel("MCP settings entry for apps that start tools themselves", { exact: true })).toContainText('"--stdio"');
    await audit(p, `${scheme}/settings: client setup (HTTP + stdio)`);
  });
}

test("the approval prompt is accessible, and a stray Enter cannot approve it", async () => {
  await s.panel.emulateMedia({ colorScheme: "light" });
  await s.panel.reload();
  const c = await s.mcp();
  const pending = s.run(c, "draft_customer_note", { order_id: "A-1014", note: "Keyboard safety check." });
  await waitForState(s, (st) => !!st.approval);
  const sheet = s.panel.getByRole("alertdialog");
  await expect(sheet).toBeVisible();
  await audit(s.panel, "approval prompt");

  // focus starts on the heading, not on "Approve once"
  await expect(s.panel.getByRole("heading", { name: "Approve this action?" })).toBeFocused();
  await s.panel.keyboard.press("Enter");
  await s.panel.keyboard.press("Space");
  expect((await s.state()).approval).not.toBeNull(); // nothing was approved
  expect(s.fixture.state.writeLog).toHaveLength(0);

  // the controls are reachable by keyboard in a sensible order
  const reached: string[] = [];
  for (let i = 0; i < 12 && reached.length < 3; i++) {
    await s.panel.keyboard.press("Tab");
    const name = await s.panel.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
    if (["Decline", "Approve once", "Show the page"].includes(name)) reached.push(name);
  }
  expect(reached).toEqual(["Decline", "Approve once", "Show the page"]);
  await s.decline();
  expect((await pending).status).toBe("rejected");
  await c.close();
});

test("the navigation is a labelled landmark and every section tab is keyboard-operable", async () => {
  await s.panel.reload();
  const nav = s.panel.getByRole("navigation", { name: "AnyMCP sections" });
  await expect(nav).toBeVisible();
  await s.panel.getByRole("button", { name: "Runs" }).focus();
  await s.panel.keyboard.press("Enter");
  await expect(s.panel.getByRole("button", { name: "Runs" })).toHaveAttribute("aria-current", "page");
});

for (const scheme of ["light", "dark"] as const) {
  test(`no WCAG A/AA violations while recording and in the review editor (${scheme})`, async () => {
    await s.panel.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await s.panel.reload();
    const p = s.panel;
    await p.getByRole("button", { name: "Teach", exact: true }).click();

    // a recording with every kind of step and pick, on a start address that has a query string
    const site = await s.context.newPage();
    await site.goto(`${s.fixture.origin}/catalog?lang=en&sid=abc`);
    const tabs = await s.call<{ tabId: number; url: string }[]>({ type: "tabs.candidates" });
    const tabId = (tabs.ok ? (tabs.data ?? []) : []).find((t) => t.url === site.url())!.tabId;
    expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
    await site.getByLabel("Search products").click();
    await site.keyboard.type("lamp");
    await site.keyboard.press("Tab");
    await site.keyboard.press("l"); // type-ahead: Category All -> Lighting (an arrow key opens the menu on macOS)
    await site.getByLabel("In stock only").click();
    await site.getByLabel("Lowest price").click();
    await site.getByRole("button", { name: "Find products" }).click();
    await waitForState(s, (st) => (st.recording?.steps.length ?? 0) >= 5);
    await s.call({ type: "record.pick", mode: "list" });
    await waitForState(s, (st) => st.recording?.pick === "list");
    await site.getByText("Brass desk lamp").click();
    await waitForState(s, (st) => (st.recording?.outputs.length ?? 0) === 1);
    await p.getByRole("heading", { name: "Recording…" }).waitFor();
    await audit(p, `${scheme}/live recording`);

    await p.getByRole("button", { name: "Stop recording" }).click();
    await p.getByRole("button", { name: "Review the tool →" }).click();
    await p.getByRole("heading", { name: "Start page" }).waitFor();
    await audit(p, `${scheme}/review editor`);

    await p.getByRole("button", { name: "Back" }).click();
    await s.call({ type: "record.discard" });
    await site.close();
  });
}
