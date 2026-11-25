import { describe, expect, it } from "vitest";
import { buildDraft, parameterizeLocator, parameterizeText, type DraftSpec } from "../src/shared/draft";

const spec = (over: Partial<DraftSpec> = {}): DraftSpec => ({
  id: "find_order",
  title: "Find order",
  description: "Look up an order by id and return its status.",
  origin: "http://127.0.0.1:4173",
  entryPath: "/orders",
  params: [{ name: "order_id", description: "Order id", type: "string", example: "A-1012", pattern: "^A-\\d{4}$", maxLength: 6 }],
  steps: [
    { seq: 1, kind: "input", label: "Order ID", locator: { by: "label", text: "Order ID" }, effect: "ui", fill: { mode: "param", param: "order_id" }, enabled: true },
    { seq: 2, kind: "click", label: "Search", locator: { by: "role", role: "button", name: "Search" }, effect: "ui", fill: { mode: "skip" }, enabled: true },
    { seq: 3, kind: "click", label: "A-1012", locator: { by: "role", role: "link", name: "A-1012" }, effect: "navigate", fill: { mode: "skip" }, enabled: true },
  ],
  outputs: [{ id: "o1", name: "status", kind: "text", locator: { by: "testid", id: "order-status" }, as: "string", optional: false, use: "result" }],
  signals: [{ id: "g1", kind: "success", locator: { by: "text", text: "A-1012" } }],
  approvalText: "",
  ...over,
});

describe("buildDraft: recording → reviewed tool definition", () => {
  it("builds a valid read tool and never copies the typed example into the definition", () => {
    const r = buildDraft(spec(), 1);
    expect(r.errors).toEqual([]);
    const def = r.definition!;
    expect(def.kind).toBe("read");
    expect(def.approval.required).toBe(false);
    expect(JSON.stringify(def)).not.toContain("A-1012");
    expect(JSON.stringify(def)).toContain('"param":"order_id"');
    // reads are followed by a read barrier: wait for the success indicator, THEN extract
    const ops = def.steps.map((s) => s.op);
    expect(ops.indexOf("waitFor")).toBeLessThan(ops.indexOf("extract"));
  });

  it("every table column keeps its own field, even when headers are numbers or differ only in symbols", () => {
    // 2026-11-25: column names became field names by dropping symbols and leading digits, so "2023" and "2024" (and
    // the-internet.herokuapp.com/large's headers 1 to 50) all became "col" and overwrote each other: the review listed
    // every column, the tool returned one
    const headers = ["2023", "2024", "Price (£)", "Price ($)", "1st place", "Total"];
    const columns = Object.fromEntries(headers.map((h) => [h, { header: h, as: "string" as const }]));
    const r = buildDraft(spec({ outputs: [{ id: "o1", name: "figures", kind: "table", locator: { by: "css", selector: "table" }, columns, optional: false, use: "result" }] }), 1);
    expect(r.errors).toEqual([]);
    const ex = r.definition!.steps.find((x) => x.op === "extract")!;
    const cols = (ex as { source: { columns: Record<string, { header: string }> } }).source.columns;
    expect(Object.values(cols).map((c) => c.header).sort()).toEqual([...headers].sort());
    for (const k of Object.keys(cols)) expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
    const items = (r.definition!.output.properties!.figures as { items: { properties: Record<string, unknown> } }).items.properties;
    expect(Object.keys(items).sort()).toEqual(Object.keys(cols).sort());
    expect(cols.col_2023?.header).toBe("2023"); // a number keeps its digits, behind a prefix
  });

  it("the read barrier has no fixed timeout, so the tool's per-step timeout (editable in the tool editor) applies", () => {
    // 2026-11-23: it was fixed at 5000 ms, so raising "Per-step timeout" in the editor did not help a slow page
    const def = buildDraft(spec(), 1).definition!;
    const barrier = def.steps.find((x) => x.op === "waitFor");
    expect(barrier).toBeDefined();
    expect(barrier).not.toHaveProperty("timeoutMs");
    expect(def.limits.stepTimeoutMs).toBe(5000);
  });

  it("warns in review when a list matched items that look different from the one clicked", () => {
    const list = (unlike?: number) =>
      spec({ outputs: [{ id: "o1", name: "quotes", kind: "list", locator: { by: "css", selector: "table > tbody > tr > td" }, as: "string", optional: false, use: "result", ...(unlike ? { unlike } : {}) }] });
    expect(buildDraft(list(3), 1).warnings.join(" ")).toMatch(/“quotes”: 3 of the items it matched look different from the one you clicked/);
    expect(buildDraft(list(), 1).warnings.join(" ")).not.toMatch(/look different/);
    // the count is recording information only: it never reaches the saved tool definition
    expect(JSON.stringify(buildDraft(list(3), 1).definition)).not.toContain("unlike");
  });

  it("recognises the example value inside locator text and the start path", () => {
    const params = spec().params;
    expect(parameterizeText("A-1012", params)).toEqual({ param: "order_id" });
    expect(parameterizeText("Order A-1012 details", params)).toBe("Order {order_id} details");
    expect(parameterizeLocator({ by: "role", role: "link", name: "A-1012" }, params)).toEqual({ by: "role", role: "link", name: { param: "order_id" } });
    const r = buildDraft(spec({ entryPath: "/orders/A-1012" }), 1);
    expect(r.definition!.entry.path).toBe("/orders/{order_id}");
  });

  it("a commit click makes it a WRITE tool: approval required, never auto-retried, read-back on", () => {
    const s = spec();
    s.steps = [s.steps[0]!, { ...s.steps[1]!, effect: "ui" }, { ...s.steps[2]!, label: "Save", locator: { by: "role", role: "button", name: "Save" }, effect: "commit" }];
    s.outputs.push({ id: "o2", name: "customer", kind: "text", locator: { by: "testid", id: "customer-name" }, as: "string", optional: false, use: "approval", approvalLabel: "Customer" });
    const r = buildDraft(s, 1);
    expect(r.errors).toEqual([]);
    const d = r.definition!;
    expect(d.kind).toBe("write");
    expect(d.approval.required).toBe(true);
    expect(d.approval.stateFields.map((f) => f.label)).toEqual(["Customer"]);
    expect(d.limits.maxAttempts).toBe(1);
    expect(d.reconcile).toBe(true);
    // approval-only values are shown and bound, but not returned to the assistant
    expect(Object.keys(d.output.properties)).toEqual(["status"]);
  });

  it("refuses a write with nothing visible to bind the approval to", () => {
    const s = spec();
    s.steps = [s.steps[0]!, { ...s.steps[2]!, label: "Save", locator: { by: "role", role: "button", name: "Save" }, effect: "commit" }];
    const r = buildDraft(s, 1);
    expect(r.definition).toBeNull();
    expect(r.errors.join(" ")).toMatch(/approval must be bound/i);
  });

  it("refuses a tool with no success check or nothing to return", () => {
    expect(buildDraft(spec({ signals: [] }), 1).errors.join(" ")).toMatch(/success check/i);
    expect(buildDraft(spec({ outputs: [] }), 1).errors.join(" ")).toMatch(/return something|at least one value/i);
  });

  it("refuses to fill a field that looks like a password, even if the user recorded it", () => {
    const s = spec();
    s.steps[0] = { ...s.steps[0]!, label: "Password", locator: { by: "label", text: "Password" } };
    const r = buildDraft(s, 1);
    expect(r.definition).toBeNull();
    expect(r.errors.join(" ")).toMatch(/password|payment/i);
  });

  it("a fixed (literal) typed value is allowed but warned about, because it WILL be saved", () => {
    const s = spec();
    s.steps[0] = { ...s.steps[0]!, fill: { mode: "literal", text: "A-1000" } };
    s.params = [];
    const r = buildDraft(s, 1);
    expect(r.warnings.join(" ")).toMatch(/saved in the tool definition/i);
  });

  it("unchecked steps are left out", () => {
    const s = spec();
    s.steps[1] = { ...s.steps[1]!, enabled: false };
    const r = buildDraft(s, 1);
    expect(r.definition!.steps.some((x) => x.op === "locate" && x.locator.by === "role" && x.locator.name === "Search")).toBe(false);
  });

  it("refuses to click or type AFTER the data-changing step, and says so in words (not internal step ids)", () => {
    const s = spec();
    s.steps[1] = { ...s.steps[1]!, effect: "commit" }; // commit in the middle: the next click comes after it
    const r = buildDraft(s, 1);
    expect(r.definition).toBeNull();
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/after the step that changes data/i);
    expect(msg).not.toMatch(/s\d+/); // no internal step id like "s6"
  });

  it("an unconstrained parameter placed in the start path is refused", () => {
    const s = spec({ entryPath: "/orders/A-1012" });
    delete s.params[0]!.pattern;
    expect(buildDraft(s, 1).errors.join(" ")).toMatch(/pattern or fixed list/i);
  });
});
