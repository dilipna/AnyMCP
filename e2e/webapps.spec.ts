// Modern web apps, end to end and for real:
//  - a single-page app that draws itself AFTER "load" (start checks must wait), searches on Enter with no form
//    or button, uses a custom (ARIA) dropdown, and changes pages with history.pushState;
//  - settings that SAVE THE MOMENT THEY CHANGE, which therefore need an approval like a Save button does.
// Outputs are compared with the fixture's own ground truth; writes are counted from the server's log.

import { expect, test, type Page } from "@playwright/test";
import { PRODUCTS, searchProducts } from "anymcp-fixture";
import type { ResultEnvelope } from "anymcp-protocol";
import { buildDraft, type DraftSpec } from "../packages/extension/src/shared/draft";
import type { TabCandidate } from "../packages/extension/src/shared/panel-api";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack({ tools: [] });
});
test.afterAll(async () => {
  await s?.close();
});

async function openTab(path: string): Promise<{ page: Page; tabId: number }> {
  const page = await s.context.newPage();
  await page.goto(`${s.fixture.origin}${path}`);
  const r = await s.call<TabCandidate[]>({ type: "tabs.candidates" });
  const tab = (r.ok ? (r.data ?? []) : []).find((t) => t.url === page.url());
  if (!tab) throw new Error("tab not found among candidates");
  return { page, tabId: tab.tabId };
}

async function saveTestEnable(def: NonNullable<ReturnType<typeof buildDraft>["definition"]>, args: Record<string, unknown>): Promise<ResultEnvelope> {
  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);
  const t = (await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: def.version, args })) as { data: { envelope: ResultEnvelope } };
  if (t.data.envelope.status === "success") {
    expect((await s.call({ type: "tool.enable", id: def.id, version: def.version })).ok).toBe(true);
    const deadline = Date.now() + 5000;
    while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);
  }
  return t.data.envelope;
}

const steps = (st: Awaited<ReturnType<Stack["state"]>>) => st.recording!.steps.map((x) => `${x.kind}:${x.label}`);

test("single-page app: custom dropdown + Enter-to-search + list; start checks wait for the app to draw itself", async () => {
  const { page, tabId } = await openTab("/app");
  await page.getByLabel("Find a product").waitFor(); // drawn ~600 ms after load
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });

  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Lighting" }).click();
  await page.getByLabel("Find a product").click();
  await page.keyboard.type("lamp");
  await page.keyboard.press("Enter"); // no form, no button: the app listens for Enter itself
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();

  const rec = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 4);
  expect(steps(rec)).toEqual(["click:Category", "click:Lighting", "input:Find a product", "press:Find a product"]);
  // the choices next to the clicked option were captured, so the choice can become an input
  expect(rec.recording!.steps[1]!.options).toEqual(["All", "Lighting", "Garden", "Kitchen"]);

  await s.call({ type: "record.pick", mode: "list" });
  await waitForState(s, (x) => x.recording?.pick === "list");
  await page.getByRole("link", { name: "Brass desk lamp" }).click(); // swallowed by pick mode: no navigation
  await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === 1);
  expect(page.url()).toMatch(/\/app$/);
  await s.call({ type: "record.pick", mode: "success" });
  await waitForState(s, (x) => x.recording?.pick === "success");
  await page.getByRole("heading", { name: "Results" }).click();
  await waitForState(s, (x) => (x.recording?.signals.length ?? 0) === 1);
  await s.call({ type: "record.stop" });

  const spec = ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  // what the editor's "Make the choice an input" button does
  spec.params.push({ name: "choice", description: "Category", type: "string", example: "Lighting", maxLength: 200, options: spec.steps[1]!.options! });
  spec.steps[1]!.asParam = "choice";
  spec.id = "app_find_products";
  spec.title = "Find products in the app";
  spec.description = "Search the synthetic single-page app by words and category; returns the product names it lists.";
  spec.outputs[0]!.name = "products";

  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  expect(def.steps.some((x) => x.op === "press" && x.key === "Enter" && x.effect === "ui")).toBe(true);
  expect(def.input.properties.choice).toMatchObject({ enum: ["All", "Lighting", "Garden", "Kitchen"] });
  expect(JSON.stringify(def)).not.toContain("Lighting\"}"); // the option is now looked up by the input, not fixed
  expect(def.kind).toBe("read");

  const tested = await saveTestEnable(def, { choice: "Lighting", find_a_product: "lamp" });
  expect(tested.status, tested.message).toBe("success");
  expect(tested.output).toEqual({ products: searchProducts({ term: "lamp", category: "Lighting", sort: "name" }).map((p) => p.name) });

  const client = await s.mcp();
  const env = await s.run(client, def.id, { choice: "Garden", find_a_product: "a" });
  expect(env.status, env.message).toBe("success");
  expect(env.output).toEqual({ products: searchProducts({ term: "a", category: "Garden", sort: "name" }).map((p) => p.name) });
  await client.close();
  await page.close();
});

test("single-page app: a result link that changes the address without reloading, turned into an input", async () => {
  const { page, tabId } = await openTab("/app");
  await page.getByLabel("Find a product").waitFor();
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });

  await page.getByLabel("Find a product").click();
  await page.keyboard.type("lamp");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Brass desk lamp" }).click();
  await page.waitForURL(/\/app\/p\/brass-desk-lamp$/); // pushState: same document
  await expect(page.getByTestId("app-detail-name")).toHaveText("Brass desk lamp");
  const rec = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 3);
  expect(steps(rec)).toEqual(["input:Find a product", "press:Find a product", "click:Brass desk lamp"]);

  await s.call({ type: "record.pick", mode: "text" });
  await waitForState(s, (x) => x.recording?.pick === "text");
  await page.locator("dd").first().click(); // the price, next to "Price"
  await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === 1);
  await s.call({ type: "record.pick", mode: "success" });
  await waitForState(s, (x) => x.recording?.pick === "success");
  await page.getByTestId("app-detail-name").click();
  await waitForState(s, (x) => (x.recording?.signals.length ?? 0) === 1);
  await s.call({ type: "record.stop" });

  const spec = ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  spec.id = "app_product_price";
  spec.title = "Product price in the app";
  spec.description = "Search the synthetic app, open one product from the results, and return its price.";
  spec.outputs[0]!.name = "price";
  spec.outputs[0]!.as = "number";

  // the typed word "lamp" is INSIDE the link text: AnyMCP says so instead of silently changing what it clicks
  const first = buildDraft(spec, 1);
  expect(first.warnings.join(" ")).toMatch(/“Brass desk lamp” will change with the input “find_a_product”/);
  // "keep this text as recorded" makes it the same link every time, with no warning
  const kept = buildDraft({ ...spec, steps: spec.steps.map((x, i) => (i === 2 ? { ...x, keepText: true } : x)) }, 1);
  expect(kept.warnings.join(" ")).not.toMatch(/will change with the input/);

  // what the editor's "Make “Brass desk lamp” an input" button does
  spec.params.push({ name: "item", description: "Which product to open", type: "string", example: "Brass desk lamp", maxLength: 200 });
  spec.steps[2]!.asParam = "item";
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  expect(built.warnings.join(" ")).not.toMatch(/will change with the input/);
  const def = built.definition!;
  expect(JSON.stringify(def)).not.toContain("Brass desk lamp");

  const lamp = PRODUCTS.find((p) => p.name === "Brass desk lamp")!;
  const tested = await saveTestEnable(def, { find_a_product: "lamp", item: "Brass desk lamp" });
  expect(tested.status, tested.message).toBe("success");
  expect(tested.output).toEqual({ price: lamp.price });

  const client = await s.mcp();
  const env = await s.run(client, def.id, { find_a_product: "pan", item: "Cast iron pan" });
  expect(env.status, env.message).toBe("success");
  expect(env.output).toEqual({ price: PRODUCTS.find((p) => p.name === "Cast iron pan")!.price });

  // an item that is not among the results: stops without guessing another link
  const miss = await s.run(client, def.id, { find_a_product: "lamp", item: "Cast iron pan" });
  expect(miss.status).toBe("precondition_failed");
  expect(miss.reasonCode).toBe("locator_missing");
  expect(miss.actionMayHaveOccurred).toBe(false);
  await client.close();
  await page.close();
});

test("a dropdown that saves the moment it changes: approval every run, written once, 'nothing needed' when already set", async () => {
  const { page, tabId } = await openTab("/settings");
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });
  await page.getByLabel("Reminder frequency").focus();
  await page.keyboard.press("ArrowDown"); // Never -> Daily, and the SITE SAVES IT immediately
  await expect(page.getByRole("status")).toHaveText(/Saved: reminders Daily/);
  const rec = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 1);
  expect(rec.recording!.steps[0]).toMatchObject({ kind: "input", control: "select", label: "Reminder frequency", example: "Daily" });

  const pickText = async (selector: string, n: number) => {
    await s.call({ type: "record.pick", mode: "text" });
    await waitForState(s, (x) => x.recording?.pick === "text");
    await page.locator(selector).click();
    await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === n);
  };
  await pickText('[data-testid="account-email"]', 1);
  await s.call({ type: "record.pick", mode: "success" });
  await waitForState(s, (x) => x.recording?.pick === "success");
  await page.getByRole("status").click();
  await waitForState(s, (x) => (x.recording?.signals.length ?? 0) === 1);
  await s.call({ type: "record.stop" });

  const spec = ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  // without marking it, AnyMCP warns that a dropdown may save on change
  expect(buildDraft({ ...spec, id: "x_settings", title: "Set reminders", description: "Set the reminder frequency on the synthetic settings page." }, 1).warnings.join(" ")).toMatch(/dropdown/);

  spec.id = "set_reminders";
  spec.title = "Set reminder frequency";
  spec.description = "Change how often the synthetic portal sends reminders. The page saves the change immediately.";
  spec.steps[0]!.effect = "commit"; // "Saves by itself: CHANGES DATA"
  spec.outputs[0] = { ...spec.outputs[0]!, name: "account", use: "approval", approvalLabel: "Account" };
  spec.outputs.push({ id: "st", name: "confirmation", kind: "text", locator: { by: "role", role: "status" }, as: "string", optional: false, use: "result" });
  spec.approvalText = "Set reminders to {reminder_frequency}";
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  expect(def.kind).toBe("write");
  expect(def.approval.required).toBe(true);
  expect(def.steps.find((x) => x.op === "fill")).toMatchObject({ effect: "commit" });

  await s.chaos({ reset: true }); // forget the change the person made while recording
  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);

  // test run: the approval shows the bound page value; one approval, one write
  const testing = s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: { reminder_frequency: "Weekly" } });
  const asked = await waitForState(s, (x) => !!x.approval);
  expect(asked.approval!.actionText).toBe("Set reminders to Weekly");
  expect(asked.approval!.state).toEqual([{ id: "account", label: "Account", value: "agent@acme.example" }]);
  expect(s.fixture.state.settingsLog).toHaveLength(0); // nothing happens before approval
  await s.approve();
  const t = ((await testing) as { data: { envelope: ResultEnvelope } }).data.envelope;
  expect(t.status, t.message).toBe("success");
  expect(t.output).toEqual({ confirmation: "Saved: reminders Weekly, weekly digest off" });
  expect(s.fixture.state.settingsLog.map((w) => w.patch)).toEqual([{ frequency: "Weekly" }]);

  expect((await s.call({ type: "tool.enable", id: def.id, version: 1 })).ok).toBe(true);
  const deadline = Date.now() + 5000;
  while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);
  const client = await s.mcp();

  // already "Weekly": nothing to change, so no approval prompt and no write
  const same = await s.run(client, def.id, { reminder_frequency: "Weekly" });
  expect(same.status).toBe("precondition_failed");
  expect(same.reasonCode).toBe("no_change_needed");
  expect(same.actionMayHaveOccurred).toBe(false);
  expect((await s.state()).approval).toBeNull();
  expect(s.fixture.state.settingsLog).toHaveLength(1);

  // declined: nothing written
  const declining = s.run(client, def.id, { reminder_frequency: "Never" });
  await waitForState(s, (x) => !!x.approval);
  await s.decline();
  expect((await declining).status).toBe("rejected");
  expect(s.fixture.state.settings.frequency).toBe("Weekly");
  expect(s.fixture.state.settingsLog).toHaveLength(1);

  // approved through MCP: written exactly once more
  const approving = s.run(client, def.id, { reminder_frequency: "Daily" });
  await waitForState(s, (x) => !!x.approval);
  await s.approve();
  const done = await approving;
  expect(done.status, done.message).toBe("success");
  expect(done.actionMayHaveOccurred).toBe(true);
  expect(s.fixture.state.settingsLog.map((w) => w.patch)).toEqual([{ frequency: "Weekly" }, { frequency: "Daily" }]);
  await client.close();
  await page.close();
});

test("an ARIA switch that saves on click: set to a state (never a blind toggle), approved, idempotent", async () => {
  await s.chaos({ reset: true });
  const spec: DraftSpec = {
    id: "set_digest",
    title: "Weekly digest on or off",
    description: "Turn the weekly digest email on or off on the synthetic settings page (saves immediately).",
    origin: s.fixture.origin,
    entryPath: "/settings",
    params: [{ name: "on", description: "true = on, false = off", type: "boolean", example: "", maxLength: 200 }],
    steps: [{ seq: 1, kind: "input", control: "checkbox", label: "Weekly digest email", locator: { by: "role", role: "switch", name: "Weekly digest email" }, effect: "commit", fill: { mode: "param", param: "on" }, enabled: true }],
    outputs: [
      { id: "a", name: "account", kind: "text", locator: { by: "testid", id: "account-email" }, as: "string", optional: false, use: "approval", approvalLabel: "Account" },
      { id: "c", name: "confirmation", kind: "text", locator: { by: "role", role: "status" }, as: "string", optional: false, use: "result" },
    ],
    signals: [{ id: "ok", kind: "success", locator: { by: "text", text: "Saved:", exact: false } }],
    approvalText: "Turn the weekly digest {on}",
  };
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);

  const run = async (on: boolean, decide: "approve" | "none") => {
    const p = s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: { on } });
    if (decide === "approve") {
      await waitForState(s, (x) => !!x.approval);
      await s.approve();
    }
    return ((await p) as { data: { envelope: ResultEnvelope } }).data.envelope;
  };

  const turnOn = await run(true, "approve");
  expect(turnOn.status, turnOn.message).toBe("success");
  expect(s.fixture.state.settings.digest).toBe(true);
  expect(s.fixture.state.settingsLog).toHaveLength(1);

  const again = await run(true, "none"); // already on: no prompt, no click, no write
  expect(again.reasonCode).toBe("no_change_needed");
  expect(s.fixture.state.settingsLog).toHaveLength(1);

  const turnOff = await run(false, "approve");
  expect(turnOff.status, turnOff.message).toBe("success");
  expect(s.fixture.state.settings.digest).toBe(false);
  expect(s.fixture.state.settingsLog.map((w) => w.patch)).toEqual([{ digest: true }, { digest: false }]);
});
