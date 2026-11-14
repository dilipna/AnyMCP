// The draft builder for the wider control set: dropdowns, checkboxes, option buttons, lists of results, and
// start pages that carry a query string. Every case checks both the happy path and what must be refused.

import { describe, expect, it } from "vitest";
import { renderEntry } from "anymcp-protocol";
import { PATH_PART_PATTERN, buildDraft, buildEntryPath, buildEntryQuery, parameterizeText, queryPartsFromSearch, type DraftSpec } from "../src/shared/draft";

const base = (over: Partial<DraftSpec> = {}): DraftSpec => ({
  id: "search_catalog",
  title: "Search catalog",
  description: "Search the product catalog and return the matching product names.",
  origin: "https://shop.example",
  entryPath: "/search",
  params: [{ name: "term", description: "Search words", type: "string", example: "lamp", maxLength: 100 }],
  steps: [
    { seq: 1, kind: "input", label: "Search", locator: { by: "label", text: "Search" }, effect: "ui", fill: { mode: "param", param: "term" }, enabled: true },
    { seq: 2, kind: "click", label: "Go", locator: { by: "role", role: "button", name: "Go" }, effect: "ui", fill: { mode: "skip" }, enabled: true },
  ],
  outputs: [{ id: "o1", name: "products", kind: "list", locator: { by: "testid", id: "product-name" }, as: "string", optional: false, use: "result", maxRows: 20 }],
  signals: [{ id: "g1", kind: "success", locator: { by: "role", role: "heading", name: "Results" } }],
  approvalText: "",
  ...over,
});

describe("list outputs", () => {
  it("become an array-of-strings output with a bounded size, filled by a `list` extract", () => {
    const r = buildDraft(base(), 1);
    expect(r.errors).toEqual([]);
    const def = r.definition!;
    expect(def.output.properties.products).toEqual({ type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 20 });
    expect(def.output.required).toContain("products");
    const ex = def.steps.find((s) => s.op === "extract");
    expect(ex).toMatchObject({ op: "extract", into: "products", source: { type: "list", maxItems: 20 } });
  });

  it("can be numbers", () => {
    const s = base();
    s.outputs[0] = { ...s.outputs[0]!, as: "number" };
    expect(buildDraft(s, 1).definition!.output.properties.products).toMatchObject({ type: "array", items: { type: "number" } });
  });

  it("cannot be shown in an approval (only single values can be bound)", () => {
    const s = base();
    s.outputs[0] = { ...s.outputs[0]!, use: "approval" };
    expect(buildDraft(s, 1).errors.join(" ")).toMatch(/list and cannot be used as an approval value/);
  });
});

describe("dropdowns, checkboxes and option buttons", () => {
  it("a dropdown input only accepts the recorded choices, and the reviewer is warned it might save on change", () => {
    const s = base();
    s.params.push({ name: "category", description: "Category", type: "string", example: "Lighting", maxLength: 200, options: ["All", "Lighting", "Garden"] });
    s.steps.unshift({ seq: 0, kind: "input", control: "select", label: "Category", locator: { by: "label", text: "Category" }, effect: "ui", fill: { mode: "param", param: "category" }, enabled: true });
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    expect(r.definition!.input.properties.category).toMatchObject({ type: "string", enum: ["All", "Lighting", "Garden"] });
    expect(r.warnings.join(" ")).toMatch(/dropdown/);
  });

  it("a checkbox input is a yes/no input", () => {
    const s = base();
    s.params.push({ name: "in_stock", description: "Only in stock", type: "boolean", example: "", maxLength: 200 });
    s.steps.unshift({ seq: 0, kind: "input", control: "checkbox", label: "In stock only", locator: { by: "label", text: "In stock only" }, effect: "ui", fill: { mode: "param", param: "in_stock" }, enabled: true });
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    expect(r.definition!.input.properties.in_stock).toEqual({ type: "boolean", description: "Only in stock" });
    expect(r.definition!.input.required).toContain("in_stock");
  });

  it("a fixed checkbox/option value must be true or false", () => {
    const s = base();
    s.steps.unshift({ seq: 0, kind: "input", control: "radio", label: "Newest first", locator: { by: "label", text: "Newest first" }, effect: "ui", fill: { mode: "literal", text: "maybe" }, enabled: true });
    expect(buildDraft(s, 1).errors.join(" ")).toMatch(/must be true or false/);
    s.steps[0] = { ...s.steps[0]!, fill: { mode: "literal", text: "true" } };
    const ok = buildDraft(s, 1);
    expect(ok.errors).toEqual([]);
    // a fixed true/false is not typed text, so there is no "will be saved" warning for it
    expect(ok.warnings.join(" ")).not.toMatch(/fixed value/);
  });
});

describe("start page query strings", () => {
  it("first guess: ordinary keys kept, tracking keys dropped, credential keys dropped AND their values never held", () => {
    const parts = queryPartsFromSearch("?category=lamps&utm_source=news&sid=SECRET123&page=2&access_token=abc");
    expect(parts).toEqual([
      { key: "category", value: "lamps", mode: "fixed" },
      { key: "utm_source", value: "news", mode: "drop" },
      { key: "sid", value: "", mode: "drop" },
      { key: "page", value: "2", mode: "fixed" },
      { key: "access_token", value: "", mode: "drop" },
    ]);
    expect(JSON.stringify(parts)).not.toContain("SECRET123");
  });

  it("kept keys become a URL-encoded template; inputs become placeholders", () => {
    const params = [{ name: "term", description: "", type: "string" as const, example: "red lamp", maxLength: 50 }];
    const errors: string[] = [];
    const q = buildEntryQuery(
      [
        { key: "q", value: "red lamp", mode: "fixed" }, // equals an input's example -> becomes that input
        { key: "sort", value: "price asc", mode: "fixed" },
        { key: "x", value: "1", mode: "drop" },
      ],
      params,
      errors,
    );
    expect(errors).toEqual([]);
    expect(q).toBe("q={term}&sort=price%20asc");
    expect(renderEntry({ path: "/search", query: q }, { term: "a&b=c" })).toBe("/search?q=a%26b%3Dc&sort=price%20asc");
  });

  it("is carried into the definition", () => {
    const def = buildDraft(base({ entryQuery: [{ key: "lang", value: "en", mode: "fixed" }] }), 1).definition!;
    expect(def.entry).toEqual({ path: "/search", query: "lang=en" });
  });

  it("a key that looks like a credential is refused even if the user tries to keep it", () => {
    const r = buildDraft(base({ entryQuery: [{ key: "session_id", value: "abc", mode: "fixed" }] }), 1);
    expect(r.definition).toBeNull();
    expect(r.errors.join(" ")).toMatch(/sign-in or security value/);
  });

  it("an input used only in the query string counts as used", () => {
    const s = base({ entryQuery: [{ key: "page", value: "1", mode: "param", param: "page" }] });
    s.params.push({ name: "page", description: "Page", type: "string", example: "1", maxLength: 3 });
    expect(buildDraft(s, 1).errors).toEqual([]);
  });

  it("an input chosen for a query key must exist", () => {
    const r = buildDraft(base({ entryQuery: [{ key: "page", value: "1", mode: "param", param: "nope" }] }), 1);
    expect(r.errors.join(" ")).toMatch(/not defined/);
  });
});

describe("Enter key presses, self-saving fields and clicked choices", () => {
  it("a recorded Enter becomes a press step", () => {
    const s = base();
    s.steps[1] = { seq: 2, kind: "press", label: "Search", locator: { by: "label", text: "Search" }, effect: "ui", fill: { mode: "skip" }, enabled: true };
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    expect(r.definition!.steps.filter((x) => x.op === "press")).toEqual([{ id: expect.any(String), op: "press", target: expect.any(String), key: "Enter", effect: "ui" }]);
    expect(r.definition!.kind).toBe("read");
  });

  it("a field marked 'saves by itself' makes a write tool with an approval sentence naming the value", () => {
    const s = base();
    s.params = [{ name: "frequency", description: "", type: "string", example: "Daily", maxLength: 20, options: ["Never", "Daily"] }];
    s.steps = [{ seq: 1, kind: "input", control: "select", label: "Reminder frequency", locator: { by: "label", text: "Reminder frequency" }, effect: "commit", fill: { mode: "param", param: "frequency" }, enabled: true }];
    s.outputs = [
      { id: "a", name: "account", kind: "text", locator: { by: "testid", id: "acct" }, as: "string", optional: false, use: "approval" },
      { id: "c", name: "confirmation", kind: "text", locator: { by: "role", role: "status" }, as: "string", optional: false, use: "result" },
    ];
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    const d = r.definition!;
    expect(d.kind).toBe("write");
    expect(d.steps.find((x) => x.op === "fill")).toMatchObject({ effect: "commit" });
    expect(d.approval.actionTemplate).toBe("Set “Reminder frequency” to {frequency} with frequency={frequency}");
    // once it is marked, the "may save on change" warning is no longer needed
    expect(r.warnings.join(" ")).not.toMatch(/save[sd]? the moment|saves the moment/);
  });

  it("warns when a typed value only PARTLY replaces a clicked text, and 'keep as recorded' stops it", () => {
    const s = base();
    s.steps.push({ seq: 3, kind: "click", label: "Brass desk lamp", locator: { by: "role", role: "link", name: "Brass desk lamp" }, effect: "navigate", fill: { mode: "skip" }, enabled: true });
    const r = buildDraft(s, 1);
    expect(r.warnings.join(" ")).toMatch(/“Brass desk lamp” will change with the input “term”/);
    const link = r.definition!.steps.find((x) => x.op === "locate" && x.locator.by === "role" && x.locator.role === "link");
    expect(link).toMatchObject({ locator: { name: "Brass desk {term}" } });

    s.steps[2] = { ...s.steps[2]!, keepText: true };
    const kept = buildDraft(s, 1);
    expect(kept.warnings.join(" ")).not.toMatch(/will change with the input/);
    expect(kept.definition!.steps.find((x) => x.op === "locate" && x.locator.by === "role" && x.locator.role === "link")).toMatchObject({ locator: { name: "Brass desk lamp" } });
  });

  it("a clicked option made into an input only accepts the choices that were next to it", () => {
    const s = base();
    s.steps.unshift({ seq: 0, kind: "click", label: "Garden", locator: { by: "role", role: "option", name: "Garden" }, effect: "ui", fill: { mode: "skip" }, enabled: true, options: ["All", "Garden", "Kitchen"], asParam: "choice" });
    s.params.push({ name: "choice", description: "", type: "string", example: "Garden", maxLength: 200, options: ["All", "Garden", "Kitchen"] });
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    expect(r.definition!.input.properties.choice).toMatchObject({ enum: ["All", "Garden", "Kitchen"] });
    expect(r.definition!.steps.find((x) => x.op === "locate" && x.locator.by === "role" && x.locator.role === "option")).toMatchObject({ locator: { name: { param: "choice" } } });
  });
});

describe("read-only page tools and link results", () => {
  it("a tool with no recorded action reads the page it starts on; its start check is the success check", () => {
    const s = base({ steps: [], entryQuery: [{ key: "q", value: "lamp", mode: "param", param: "term" }] });
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    const d = r.definition!;
    expect(d.entry).toEqual({ path: "/search", query: "q={term}" });
    expect(d.steps.map((x) => x.op)).toEqual(["waitFor", "extract"]);
    expect(d.preconditions).toEqual([{ id: "start_page_ready", condition: { kind: "exists", locator: { by: "role", role: "heading", name: "Results" } } }]);
  });

  it("still needs something to return and a success check", () => {
    expect(buildDraft(base({ steps: [], outputs: [] }), 1).errors.join(" ")).toMatch(/at least one value/);
    expect(buildDraft(base({ steps: [], signals: [] }), 1).errors.join(" ")).toMatch(/success check/);
  });

  it("link outputs are { text, url } objects, single or as a list", () => {
    const s = base();
    s.outputs = [
      { id: "l", name: "results", kind: "list", locator: { by: "css", selector: "li > a" }, as: "link", optional: false, use: "result", maxRows: 10 },
      { id: "t", name: "top", kind: "text", locator: { by: "testid", id: "top" }, as: "link", optional: false, use: "result" },
    ];
    const d = buildDraft(s, 1).definition!;
    const link = { type: "object", properties: { text: { type: "string", maxLength: 2000 }, url: { type: "string", maxLength: 2000 } }, required: ["text", "url"], additionalProperties: false };
    expect(d.output.properties.results).toMatchObject({ type: "array", items: link, maxItems: 10 });
    expect(d.output.properties.top).toMatchObject(link);
    expect(d.steps.filter((x) => x.op === "extract").map((x) => (x as { source: { as?: string } }).source.as)).toEqual(["link", "link"]);
  });
});

describe("checks that contain numbers", () => {
  it("warns when a success check includes a number that may change between runs", () => {
    const s = base({ signals: [{ id: "g", kind: "success", locator: { by: "role", role: "heading", name: "Hockey Teams: Forms, Searching and Pagination 21 items" } }] });
    expect(buildDraft(s, 1).warnings.join(" ")).toMatch(/contains a number/);
    expect(buildDraft(base(), 1).warnings.join(" ")).not.toMatch(/contains a number/);
  });
});

describe("parts of the start address as inputs", () => {
  it("a chosen part is replaced as a whole part, constrained to URL-safe characters", () => {
    const s = base({ steps: [], entryPath: "/catalogue/category/books/travel_2/index.html" });
    s.params = [{ name: "category", description: "", type: "string", example: "travel_2", maxLength: 100, pattern: PATH_PART_PATTERN, fromPath: true }];
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    expect(r.definition!.entry.path).toBe("/catalogue/category/books/{category}/index.html");
    expect(r.definition!.input.properties.category).toMatchObject({ type: "string", pattern: PATH_PART_PATTERN });
    expect(renderEntry(r.definition!.entry, { category: "mystery_3" })).toBe("/catalogue/category/books/mystery_3/index.html");
  });

  it("even a one-character part can be chosen (whole-part match, unlike text recognition)", () => {
    expect(buildEntryPath("/js/page/2/", [{ name: "page", description: "", type: "string", example: "2", maxLength: 3, fromPath: true }])).toBe("/js/page/{page}/");
    // without choosing it, a short typed value never rewrites the address by accident
    expect(buildEntryPath("/js/page/2/", [{ name: "n", description: "", type: "string", example: "2", maxLength: 3 }])).toBe("/js/page/{n}/");
    expect(buildEntryPath("/items/12/", [{ name: "n", description: "", type: "string", example: "2", maxLength: 3 }])).toBe("/items/12/");
  });
});

describe("parameterising recorded text", () => {
  it("short examples only replace an exact match, never a substring", () => {
    const params = [{ name: "n", description: "", type: "string" as const, example: "a", maxLength: 5 }];
    expect(parameterizeText("a", params)).toEqual({ param: "n" });
    expect(parameterizeText("Add to cart", params)).toBe("Add to cart");
  });
});
