// The complete user journey driven ONLY through the interface (clicks and typing), the way a person would do it:
//   pair → teach a workflow → review → save → test → enable → an MCP client uses it → disconnect → revoke.
// No panel API calls are used for the steps themselves; if a visible primary control does not work, this fails.

import { expect, test } from "@playwright/test";
import { startStack, sleep, waitForState, type Stack } from "./harness";

let s: Stack;
test.afterEach(async () => {
  await s?.close();
});

test("connect and pair using the on-screen steps only", async () => {
  s = await startStack({ pair: false });
  const p = s.panel;
  await p.reload();
  await expect(p.getByRole("heading", { name: "Connect AnyMCP to your AI assistant" })).toBeVisible();
  await expect(p.getByText("npm run bridge")).toBeVisible();
  // the Advanced box lets a person target a non-default bridge port (the test bridge uses a random one)
  await p.getByRole("button", { name: /advanced/i }).click();
  await p.getByLabel("Bridge address").fill(s.bridge.extUrl);
  // a wrong code is refused with a plain-language message
  await p.getByLabel("Pairing code").fill("00000000");
  await p.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(p.getByRole("alert")).toContainText(/not correct/i);
  // the right code (spaces allowed) pairs
  await p.getByLabel("Pairing code").fill(`${s.bridge.pairingCode().slice(0, 4)} ${s.bridge.pairingCode().slice(4)}`);
  await p.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(p.getByText("Bridge connected", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  expect((await s.state()).conn.paired).toBe(true);
});

test("teach → review → save → test → enable → use via MCP → disconnect → revoke, all through the UI", async () => {
  s = await startStack({ tools: [] });
  const p = s.panel;
  await p.setViewportSize({ width: 420, height: 900 });
  const page = await s.context.newPage();
  await page.goto(`${s.fixture.origin}/orders`);
  await p.bringToFront();
  await p.reload();

  // ---- 1. start recording from the tab list ----
  await p.getByRole("button", { name: "Teach", exact: true }).click();
  const row = p.locator("li", { hasText: s.fixture.origin.replace("http://", "") });
  await row.getByRole("button", { name: "Start recording" }).click();
  await expect(p.getByRole("heading", { name: "Recording…" })).toBeVisible();

  // ---- 2. the person does the task, and picks what matters ----
  await page.getByLabel("Order ID").click();
  await page.keyboard.type("A-1012");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "A-1012" }).click();
  await page.waitForURL(/\/orders\/A-1012$/);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });
  await expect(p.getByText("Typed into “Order ID”")).toBeVisible();

  await p.getByRole("button", { name: "Pick a value to return" }).click();
  await waitForState(s, (x) => x.recording?.pick === "text");
  await page.locator('[data-testid="order-status"]').click();
  await expect(p.getByText("What you picked")).toBeVisible();
  await p.getByRole("button", { name: "Mark a message" }).click();
  await waitForState(s, (x) => x.recording?.pick === "success");
  await page.locator('[data-testid="order-id"]').click();
  await expect(p.getByText(/Success check:/)).toBeVisible();

  // ---- 3. stop and review ----
  await p.getByRole("button", { name: "Stop recording" }).click();
  await p.getByRole("button", { name: "Review the tool →" }).click();
  await expect(p.getByRole("heading", { name: "Review your tool" })).toBeVisible();
  // saving is blocked until the tool is valid... it is valid already, but the review must be readable first:
  await expect(p.getByText("What this tool can do")).toBeVisible();
  await expect(p.getByText("Runs only on")).toBeVisible();

  await p.locator("label.field", { hasText: /^Name/ }).first().locator("input").fill("UI journey find order");
  await p.getByLabel(/Required format/).fill("^A-\\d{4}$");
  await p.getByLabel(/Max length/).fill("6");
  const returns = p.locator(".card", { has: p.getByRole("heading", { name: "What it returns" }) });
  await returns.getByLabel("Name").first().fill("status");
  await p.getByRole("button", { name: "Save as draft" }).click();

  // ---- 4. the saved draft cannot be enabled until a test passes ----
  await expect(p.getByRole("heading", { name: "UI journey find order" })).toBeVisible();
  await expect(p.getByText("Draft — needs a test").first()).toBeVisible();
  await expect(p.getByRole("button", { name: "Enable for my AI assistant" })).toBeDisabled();

  await p.getByLabel("order_id").fill("A-1013"); // a DIFFERENT order than the one recorded
  await p.getByRole("button", { name: "Run test" }).click();
  await expect(p.getByText("Result returned to the assistant")).toBeVisible({ timeout: 20_000 });
  const other = s.fixture.state.orders.find((o) => o.id === "A-1013")!;
  await expect(p.locator("pre").first()).toContainText(other.status);
  await expect(p.getByText("Tested — not enabled").first()).toBeVisible();

  // ---- 5. enable → an MCP client can now use it ----
  await p.getByRole("button", { name: "Enable for my AI assistant" }).click();
  await expect(p.getByText("Enabled", { exact: true }).first()).toBeVisible();
  const d = Date.now() + 8000;
  while (!s.bridge.hub.getTool("ui_journey_find_order") && Date.now() < d) await sleep(50);
  const c = await s.mcp();
  const env = await s.run(c, "ui_journey_find_order", { order_id: "A-1005" });
  const o5 = s.fixture.state.orders.find((o) => o.id === "A-1005")!;
  expect(env.status).toBe("success");
  expect(env.output).toMatchObject({ status: o5.status });

  // ---- 6. the run is visible in the Runs screen with a timeline ----
  await p.getByRole("button", { name: "Runs" }).click();
  // Scoped to <main>: until the panel hears the run ended, the header shows `Running “<tool>”`, and an unscoped
  // getByText(...).first() clicks that pill instead of the run (seen on a slow macOS CI runner; reproduced locally).
  await p.getByRole("main").getByText("UI journey find order").first().click();
  await expect(p.getByRole("list", { name: "Run timeline" })).toContainText("Outcome verified");

  // ---- 7. edit creates a NEW version that must be tested again; the enabled one keeps running ----
  await p.getByRole("button", { name: "Tools", exact: true }).click();
  await p.getByRole("main").getByText("UI journey find order").first().click();
  await p.getByRole("button", { name: "Edit…" }).click();
  await p.getByLabel("Description for the AI assistant").fill("Look up an order by id and return its status (edited by a person).");
  await p.getByRole("button", { name: "Save as new version" }).click();
  await expect(p.getByRole("combobox")).toBeVisible(); // back on the tool, which now offers a version picker
  const row2 = (await s.state()).tools.find((t) => t.id === "ui_journey_find_order")!;
  expect(row2.enabledVersion).toBe(1);
  expect(row2.latest.version).toBe(2);
  expect(row2.latest.tested).toBe(false);

  // ---- 8. disconnect the assistant, then revoke everything ----
  await p.getByRole("button", { name: "Settings" }).click();
  await p.getByRole("button", { name: "Show the client command" }).click();
  await expect(p.locator("code").filter({ hasText: "claude mcp add --transport http anymcp" })).toBeVisible();
  const oldToken = s.bridge.token();
  await p.getByRole("button", { name: "Disconnect the AI client" }).click();
  await expect.poll(() => s.bridge.token()).not.toBe(oldToken);
  await expect(s.mcp(oldToken)).rejects.toBeTruthy();

  await p.getByRole("button", { name: "Revoke all access…" }).click();
  await p.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(p.getByText(/AnyMCP has no access to any site/)).toBeVisible();
  const final = await s.state();
  expect(final.conn.paired).toBe(false);
  expect(final.grants).toHaveLength(0);
  expect(final.tools.every((t) => t.enabledVersion === null)).toBe(true);
  await c.close();
});

test("Settings: privacy toggles work, and deleting history empties the Runs screen", async () => {
  s = await startStack();
  const p = s.panel;
  const c = await s.mcp();
  await s.run(c, "find_order", { order_id: "A-1012" });
  await p.reload();

  // default: results are NOT kept
  await p.getByRole("button", { name: "Runs" }).click();
  await p.getByRole("main").getByText("Find order").first().click();
  await expect(p.getByText("Result returned to the assistant")).toHaveCount(0);

  // opt in, run again: the returned values now appear in history
  await p.getByRole("button", { name: "Settings" }).click();
  await p.getByLabel(/Keep results in run history/).click();
  await expect(p.getByLabel(/Keep results in run history/)).toBeChecked(); // responds immediately, does not snap back
  await s.run(c, "find_order", { order_id: "A-1013" });
  await p.getByRole("button", { name: "Runs" }).click();
  await p.getByRole("main").getByText("Find order").first().click();
  await expect(p.getByText("Result returned to the assistant")).toBeVisible();

  // delete history
  await p.getByRole("button", { name: "← All runs" }).click();
  await p.getByRole("button", { name: "Delete run history" }).click();
  await expect(p.getByText("No runs yet")).toBeVisible();
  await c.close();
});
