// The wider control set, end to end and for real: a person records a search on a page built like a modern
// site — a start address with a query string, a dropdown, a checkbox, option buttons, a web-component button
// inside a shadow root, and a list of results — then an MCP client runs the tool with DIFFERENT choices and
// the output is compared with the fixture's own ground truth.

import { expect, test, type Page } from "@playwright/test";
import { searchProducts } from "anymcp-fixture";
import type { ResultEnvelope } from "anymcp-protocol";
import { buildDraft, type DraftSpec } from "../packages/extension/src/shared/draft";
import type { TabCandidate } from "../packages/extension/src/shared/panel-api";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack({ tools: [] }); // paired, origin allowed, no tools yet
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

const names = (term: string, category: string, inStock: boolean) => searchProducts({ term, category, inStock, sort: "price" }).map((p) => p.name);

test("record dropdown + checkbox + option + shadow-DOM button + list, then run it with different choices", async () => {
  const SECRET = "XYZSECRET42";
  const { page, tabId } = await openTab(`/catalog?lang=en&utm_source=newsletter&sid=${SECRET}`);
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });

  // the person does the task once, with real (trusted) input only
  await page.getByLabel("Search products").click();
  await page.keyboard.type("lamp");
  await page.keyboard.press("Tab"); // focus moves to the Category dropdown
  // type-ahead "l": All -> Lighting. Not ArrowDown: on macOS an arrow key opens the dropdown's menu instead of
  // changing the value, so the change (and the recorded step) never happens there.
  await page.keyboard.press("l");
  await expect(page.getByLabel("Category")).toHaveValue("Lighting");
  await page.getByLabel("In stock only").click();
  await page.getByLabel("Lowest price").click();
  await page.getByRole("button", { name: "Find products" }).click(); // inside <acme-button>'s shadow root
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();

  const rec = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 5);
  const steps = rec.recording!.steps.map((x) => `${x.kind}:${x.control ?? (x.kind === "input" ? "text" : "")}:${x.label}`);
  expect(steps).toEqual(["input:text:Search products", "input:select:Category", "input:checkbox:In stock only", "input:radio:Lowest price", "click::Find products"]);
  const select = rec.recording!.steps[1]!;
  expect(select.example).toBe("Lighting");
  expect(select.options).toEqual(["All", "Lighting", "Garden", "Kitchen"]);
  // the shadow-DOM button was found by role and name, not by layout
  expect(rec.recording!.steps[4]!.quality).toBe("semantic");

  // pick the list of results (one click on one item) and what proves it worked
  await s.call({ type: "record.pick", mode: "list" });
  await waitForState(s, (x) => x.recording?.pick === "list");
  await page.getByText("Clip-on reading lamp").click();
  const picked = await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === 1);
  expect(picked.recording!.outputs[0]!.kind).toBe("list");
  expect(picked.recording!.outputs[0]!.preview).toMatch(/^3 items/);
  await s.call({ type: "record.pick", mode: "success" });
  await waitForState(s, (x) => x.recording?.pick === "success");
  await page.getByRole("heading", { name: "Results" }).click();
  await waitForState(s, (x) => (x.recording?.signals.length ?? 0) === 1);

  await s.call({ type: "record.stop" });
  const spec = ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;

  // start address: language kept, tracking dropped, the session id dropped and its value never held
  expect(spec.entryQuery).toEqual([
    { key: "lang", value: "en", mode: "fixed" },
    { key: "utm_source", value: "newsletter", mode: "drop" },
    { key: "sid", value: "", mode: "drop" },
  ]);
  const everything = await s.panel.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  expect(everything).not.toContain(SECRET);

  // inputs: text, a dropdown limited to its choices, a yes/no; the option button is simply "chosen"
  expect(spec.params.map((p) => [p.name, p.type])).toEqual([["search_products", "string"], ["category", "string"], ["in_stock_only", "boolean"]]);
  expect(spec.params[1]!.options).toEqual(["All", "Lighting", "Garden", "Kitchen"]);
  expect(spec.steps[3]!.fill).toEqual({ mode: "literal", text: "true" });

  spec.id = "search_catalog";
  spec.title = "Search the catalog";
  spec.description = "Search the synthetic catalog by words, category and stock, cheapest first; returns product names.";
  spec.outputs[0]!.name = "products";
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  expect(def.entry).toEqual({ path: "/catalog", query: "lang=en" });
  expect(JSON.stringify(def)).not.toContain(SECRET);
  expect(JSON.stringify(def)).not.toContain("utm_source");
  expect(def.input.properties.category).toMatchObject({ type: "string", enum: ["All", "Lighting", "Garden", "Kitchen"] });
  expect(def.input.properties.in_stock_only).toMatchObject({ type: "boolean" });
  expect(def.kind).toBe("read");

  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);
  const test1 = (await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: { search_products: "lamp", category: "Lighting", in_stock_only: true } })) as { data: { envelope: ResultEnvelope } };
  expect(test1.data.envelope.status, test1.data.envelope.message).toBe("success");
  expect(test1.data.envelope.output).toEqual({ products: names("lamp", "Lighting", true) });

  expect((await s.call({ type: "tool.enable", id: def.id, version: 1 })).ok).toBe(true);
  const deadline = Date.now() + 5000;
  while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);

  const client = await s.mcp();
  const listed = (await client.listTools()).tools.find((t) => t.name === def.id)!;
  expect(listed.inputSchema.properties).toMatchObject({ category: { enum: ["All", "Lighting", "Garden", "Kitchen"] }, in_stock_only: { type: "boolean" } });

  // different words, a different category, and the checkbox UNticked (AnyMCP sets state; it does not toggle blindly)
  const env = await s.run(client, def.id, { search_products: "", category: "Garden", in_stock_only: false });
  expect(env.status, env.message).toBe("success");
  expect(env.output).toEqual({ products: names("", "Garden", false) });
  expect(env.untrustedContent).toBe(true);

  // and ticked again, with the same tab reused
  const env2 = await s.run(client, def.id, { search_products: "a", category: "All", in_stock_only: true });
  expect(env2.status, env2.message).toBe("success");
  expect(env2.output).toEqual({ products: names("a", "All", true) });

  // a choice that is not in the dropdown is refused before anything runs
  // (the MCP SDK may reject at its schema layer before AnyMCP's own validator; either way: an error and no run)
  const runsBefore = (await s.state()).runs.length;
  const bad = await client.callTool({ name: def.id, arguments: { search_products: "x", category: "Toys", in_stock_only: true } });
  expect(bad.isError).toBe(true);
  await sleep(200);
  expect((await s.state()).runs.length).toBe(runsBefore);

  await client.close();
  await page.close();
});

test("a read-only page tool (no recorded action) reads a table written without <thead> correctly", async () => {
  const spec: DraftSpec = {
    id: "league_standings",
    title: "League standings",
    description: "Reads the synthetic standings table. Read-only; nothing is clicked or typed.",
    origin: s.fixture.origin,
    entryPath: "/standings",
    params: [],
    steps: [],
    outputs: [
      {
        id: "t",
        name: "teams",
        kind: "table",
        locator: { by: "css", selector: "table.table" },
        as: "string",
        optional: false,
        use: "result",
        maxRows: 10,
        columns: { "Team Name": { header: "Team Name", as: "string" }, Year: { header: "Year", as: "number" }, Wins: { header: "Wins", as: "number" } },
      },
    ],
    signals: [{ id: "h", kind: "success", locator: { by: "role", role: "heading", name: "League standings" } }],
    approvalText: "",
  };
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  expect(built.definition!.steps.map((x) => x.op)).toEqual(["waitFor", "extract"]);
  expect((await s.call({ type: "tool.save", definition: built.definition!, source: "recorded" })).ok).toBe(true);
  const r = (await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: spec.id, version: 1, args: {} })) as { data: { envelope: ResultEnvelope } };
  expect(r.data.envelope.status, r.data.envelope.message).toBe("success");
  // the header row is NOT returned as data
  expect(r.data.envelope.output).toEqual({
    teams: [
      { team_name: "Alpha Rovers", year: 1990, wins: 44 },
      { team_name: "Beta United", year: 1991, wins: 37 },
      { team_name: "Gamma City", year: 1992, wins: 51 },
    ],
  });
});

test("the start address matters: without its query string the page is different and the run stops safely", async () => {
  // a hand-made tool whose start address has no ?lang=en: the precondition (the search box) is not met
  const spec: DraftSpec = {
    id: "catalog_no_lang",
    title: "Catalog without language",
    description: "Same search, but the start address lacks the required language setting.",
    origin: s.fixture.origin,
    entryPath: "/catalog",
    params: [],
    steps: [{ seq: 1, kind: "click", label: "Find products", locator: { by: "role", role: "button", name: "Find products" }, effect: "ui", fill: { mode: "skip" }, enabled: true }],
    outputs: [{ id: "o", name: "products", kind: "list", locator: { by: "testid", id: "product-name" }, as: "string", optional: false, use: "result", maxRows: 20 }],
    signals: [{ id: "g", kind: "success", locator: { by: "role", role: "heading", name: "Results" } }],
    approvalText: "",
  };
  const def = buildDraft(spec, 1).definition!;
  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);
  const r = (await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: {} })) as { data: { envelope: ResultEnvelope } };
  expect(r.data.envelope.status).toBe("precondition_failed");
  expect(r.data.envelope.actionMayHaveOccurred).toBe(false);

  // with the query string it works
  const fixed = buildDraft({ ...spec, entryQuery: [{ key: "lang", value: "en", mode: "fixed" }] }, 2).definition!;
  expect((await s.call({ type: "tool.save", definition: fixed, source: "edited" })).ok).toBe(true);
  const ok = (await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 2, args: {} })) as { data: { envelope: ResultEnvelope } };
  expect(ok.data.envelope.status, ok.data.envelope.message).toBe("success");
  expect(ok.data.envelope.output).toEqual({ products: searchProducts({ sort: "name" }).map((p) => p.name) });
});
