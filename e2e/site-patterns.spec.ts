// Structures that real practice sites exposed on 2026-11-23 (eval/results/public-sites-2026-11-23T19-55-49), rebuilt in
// the synthetic fixture so the browser suite keeps covering them. Each tool is recorded through the REAL recorder.
//  - shelf: a value picked on a page where its style is unique must still be the item's own value on pages that
//    repeat the style in a "You may also like" strip (books.toscrape.com: `p.price_color` was ambiguous there).
//  - layout table: quotes in a table used for layout, with no class names (quotes.toscrape.com/tableful). The list
//    guess must not take in the tags rows and the side cell, and a page without quotes must not "succeed".
//  - slow lists: content drawn by a timer after the page has loaded. Reading must wait for it (up to the step
//    timeout), and the tool editor's per-step timeout must be what decides how long (quotes.toscrape.com/js-delayed).

import { expect, test, type Page } from "@playwright/test";
import { SHELF, SLOWER_LIST_DELAY_MS, layoutQuotesFor, slowListItems } from "anymcp-fixture";
import type { ResultEnvelope, ToolDefinition } from "anymcp-protocol";
import { PATH_PART_PATTERN, buildDraft, type DraftSpec } from "../packages/extension/src/shared/draft";
import type { TabCandidate } from "../packages/extension/src/shared/panel-api";
import { startStack, waitForState, sleep, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack({ tools: [] });
});
test.afterAll(async () => {
  await s?.close();
});

const pathPart = (name: string, example: string) => ({ name, description: name, type: "string" as const, example, maxLength: 100, pattern: PATH_PART_PATTERN, fromPath: true });

/** Opens `path`, waits for `ready`, records one pick (`mode` on `pickSelector`) and a success check, returns the spec. */
async function record(path: string, ready: string, mode: "text" | "list", pickSelector: string, successSelector: string): Promise<DraftSpec> {
  const page: Page = await s.context.newPage();
  try {
    await page.goto(`${s.fixture.origin}${path}`);
    await page.locator(ready).first().waitFor();
    const r = await s.call<TabCandidate[]>({ type: "tabs.candidates" });
    const tab = (r.ok ? (r.data ?? []) : []).find((t) => t.url === page.url());
    if (!tab) throw new Error("tab not found among candidates");
    expect((await s.call({ type: "record.start", tabId: tab.tabId })).ok).toBe(true);
    await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });
    await s.call({ type: "record.pick", mode });
    await waitForState(s, (x) => x.recording?.pick === mode);
    await page.locator(pickSelector).first().click();
    await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === 1);
    await s.call({ type: "record.pick", mode: "success" });
    await waitForState(s, (x) => x.recording?.pick === "success");
    await page.locator(successSelector).first().click();
    await waitForState(s, (x) => (x.recording?.signals.length ?? 0) === 1);
    await s.call({ type: "record.stop" });
    return ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  } finally {
    await s.call({ type: "record.discard" });
    await page.close();
  }
}

async function saveAndTest(def: ToolDefinition, args: Record<string, unknown>, source: "recorded" | "edited" = "recorded"): Promise<ResultEnvelope> {
  expect((await s.call({ type: "tool.save", definition: def, source })).ok).toBe(true);
  const t = (await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: def.version, args })) as { data: { envelope: ResultEnvelope } };
  return t.data.envelope;
}

async function enable(def: ToolDefinition): Promise<void> {
  expect((await s.call({ type: "tool.enable", id: def.id, version: def.version })).ok).toBe(true);
  const deadline = Date.now() + 5000;
  while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);
}

test("shelf: a price picked where its style is unique stays the item's own price on pages with a related strip", async () => {
  const spec = await record("/shelf/quiet-harbour", ".product_main", "text", ".product_main .price_color", "h1");
  spec.id = "shelf_price";
  spec.title = "Shelf price";
  spec.description = "Price of one synthetic shelf item.";
  spec.outputs[0]!.name = "price";
  spec.params.push(pathPart("item", "quiet-harbour"));
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  const tested = await saveAndTest(def, { item: "quiet-harbour" });
  expect(tested.status, tested.message).toBe("success");
  expect(tested.output).toEqual({ price: "£12.40" });
  await enable(def);

  const client = await s.mcp();
  for (const item of ["north-light", "paper-moons"]) {
    const env = await s.run(client, def.id, { item });
    expect(env.status, `${item}: ${env.message}`).toBe("success");
    expect(env.output).toEqual({ price: SHELF.find((x) => x.slug === item)!.price });
  }
  const miss = await s.run(client, def.id, { item: "no-such-item" });
  expect(miss.status).toBe("precondition_failed");
  expect(miss.actionMayHaveOccurred).toBe(false);
  await client.close();
});

test("a value shown in a heading is read from its place, not found by its own text", async () => {
  // 2026-11-25: the recorder found a picked heading by its own text ("the heading named Quiet Harbour"), so on another
  // item's page the tool looked for that same name: it could only ever return the recorded value, or stop
  const spec = await record("/shelf/quiet-harbour", ".product_main", "text", ".product_main h2", "h1");
  spec.id = "shelf_name";
  spec.title = "Shelf item name";
  spec.description = "Name of one synthetic shelf item.";
  spec.outputs[0]!.name = "name";
  spec.params.push(pathPart("item", "quiet-harbour"));
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  expect(JSON.stringify(built.definition)).not.toContain("Quiet Harbour");
  const def = built.definition!;
  const tested = await saveAndTest(def, { item: "quiet-harbour" });
  expect(tested.status, tested.message).toBe("success");
  expect(tested.output).toEqual({ name: "Quiet Harbour" });
  await enable(def);
  const client = await s.mcp();
  const env = await s.run(client, def.id, { item: "north-light" });
  expect(env.status, env.message).toBe("success");
  expect(env.output).toEqual({ name: "North Light" });
  await client.close();
});

test("ids a page makes up on every load are never used to find a value", async () => {
  // 2026-11-25: the recorder used a picked element's own id whatever it looked like, so a value whose id the page
  // regenerates on each load (the-internet.herokuapp.com/challenging_dom: UUIDs; frameworks: "ember1234") was found
  // by an id that no longer exists on the next visit
  for (const [pick, output, id] of [
    [".product_main .price_color", "price", "made_id_price"],
    [".product_main h2", "name", "made_id_name"],
  ] as const) {
    const spec = await record("/made-ids/quiet-harbour", ".product_main", "text", pick, "h1");
    spec.id = id;
    spec.title = `Shelf ${output} (made-up ids)`;
    spec.description = `The ${output} of one synthetic shelf item on a page with made-up ids.`;
    spec.outputs[0]!.name = output;
    spec.params.push(pathPart("item", "quiet-harbour"));
    const built = buildDraft(spec, 1);
    expect(built.errors).toEqual([]);
    expect(JSON.stringify(built.definition), "a made-up id is in the definition").not.toMatch(/#(ember\d|e[0-9a-f]{7}-)/);
    const def = built.definition!;
    const tested = await saveAndTest(def, { item: "quiet-harbour" }); // a fresh load: every id has changed
    expect(tested.status, tested.message).toBe("success");
    await enable(def);
    const client = await s.mcp();
    const item = SHELF.find((x) => x.slug === "north-light")!;
    const env = await s.run(client, def.id, { item: item.slug });
    expect(env.status, env.message).toBe("success");
    expect(env.output).toEqual({ [output]: output === "price" ? item.price : item.name });
    await client.close();
  }
});

test("layout table without classes: the list holds only the quotes, and a page without quotes stops", async () => {
  const spec = await record("/layout-quotes/light", 'td[style="padding-top: 2em;"]', "list", 'td[style="padding-top: 2em;"]', "h1");
  spec.id = "layout_quotes";
  spec.title = "Quotes with a tag";
  spec.description = "Quotes with one tag on the synthetic layout-table page.";
  spec.outputs[0]!.name = "quotes";
  spec.params.push(pathPart("tag", "light"));
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  expect(built.warnings.join(" ")).not.toMatch(/look different/); // narrowed: every item is a quote
  const def = built.definition!;
  const tested = await saveAndTest(def, { tag: "light" });
  expect(tested.status, tested.message).toBe("success");
  expect(tested.output).toEqual({ quotes: layoutQuotesFor("light") });
  await enable(def);

  const client = await s.mcp();
  const sea = await s.run(client, def.id, { tag: "sea" });
  expect(sea.status, sea.message).toBe("success");
  expect(sea.output).toEqual({ quotes: layoutQuotesFor("sea") });
  // no quotes for this tag: the page still has a table, a side cell and an empty quote cell, none of them a quote
  const none = await s.run(client, def.id, { tag: "nothing" });
  expect(none.status, JSON.stringify(none.output)).not.toBe("success");
  expect(none.actionMayHaveOccurred).toBe(false);
  await client.close();
});

test("layout table with nothing to tell cells apart: the review warns that items look different", async () => {
  // no attribute narrows this pattern, so the person must be told before saving, not left to notice the count
  const spec = await record("/plain-quotes/light", "td", "list", 'td:has-text("Author:")', "h1");
  expect(spec.outputs[0]!.unlike).toBeGreaterThan(0);
  spec.id = "plain_quotes";
  spec.title = "Plain quotes";
  spec.description = "Quotes on the synthetic page whose cells have no attributes.";
  spec.outputs[0]!.name = "quotes";
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  expect(built.warnings.join(" ")).toMatch(/“quotes”: \d+ of the items it matched look different from the one you clicked/);
});

test("a list drawn 1.5 s after load: reading waits for it instead of stopping at once", async () => {
  const spec = await record("/slow-list/1", "li.slow-item", "list", "li.slow-item", "h1");
  spec.id = "slow_list";
  spec.title = "Slow list";
  spec.description = "Items on a synthetic page that draws its list after a delay.";
  spec.outputs[0]!.name = "items";
  spec.params.push(pathPart("page", "1"));
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  const tested = await saveAndTest(def, { page: "1" });
  expect(tested.status, tested.message).toBe("success");
  expect(tested.output).toEqual({ items: slowListItems("1") });
  await enable(def);
  const client = await s.mcp();
  const env = await s.run(client, def.id, { page: "2" });
  expect(env.status, env.message).toBe("success");
  expect(env.output).toEqual({ items: slowListItems("2") });
  await client.close();
});

test("a list drawn 6.5 s after load: stops honestly at the default step timeout; the editor's per-step timeout fixes it", async () => {
  test.setTimeout(120_000);
  const spec = await record("/slower-list/1", "li.slow-item", "list", "li.slow-item", "h1");
  spec.id = "slower_list";
  spec.title = "Slower list";
  spec.description = "Items on a synthetic page that draws its list after a long delay.";
  spec.outputs[0]!.name = "items";
  spec.params.push(pathPart("page", "1"));
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const v1 = built.definition!;
  expect(v1.limits.stepTimeoutMs).toBeLessThan(SLOWER_LIST_DELAY_MS);
  const first = await saveAndTest(v1, { page: "1" });
  expect(first.status).toBe("precondition_failed");
  expect(first.output ?? {}).toEqual({});
  expect(first.actionMayHaveOccurred).toBe(false);

  // what the tool editor's "Per-step timeout (ms)" does: a new version with the larger timeout, tested before use
  const v2: ToolDefinition = { ...v1, version: 2, limits: { ...v1.limits, stepTimeoutMs: 10_000 } };
  const second = await saveAndTest(v2, { page: "1" }, "edited");
  expect(second.status, second.message).toBe("success");
  expect(second.output).toEqual({ items: slowListItems("1") });
});
