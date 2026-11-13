import { describe, expect, it } from "vitest";
import { isCredentialQueryKey, parseToolDefinition, renderEntry, validateToolPolicy, type ToolDefinition } from "../src";

const tool = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  schemaVersion: 1,
  id: "list_items",
  version: 1,
  title: "List items",
  description: "Return the names of the items on the page.",
  kind: "read",
  origins: ["https://shop.example"],
  entry: { path: "/items" },
  input: { type: "object", properties: {}, additionalProperties: false },
  output: { type: "object", properties: { names: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["names"], additionalProperties: false },
  steps: [{ id: "s1", op: "extract", into: "names", source: { type: "list", locator: { by: "testid", id: "name" }, maxItems: 10 } }],
  preconditions: [{ id: "ready", condition: { kind: "exists", locator: { by: "testid", id: "name" } } }],
  sessionExpiredWhen: [],
  postconditions: [{ id: "shown", condition: { kind: "exists", locator: { by: "testid", id: "name" } } }],
  emptyWhen: [],
  failureWhen: [],
  approval: { required: false, actionTemplate: "", stateFields: [], ttlSeconds: 120 },
  limits: { stepTimeoutMs: 5000, totalTimeoutMs: 30000, maxAttempts: 2 },
  reconcile: false,
  ...over,
});

describe("policy: list extraction and start-page queries", () => {
  it("a list extract into an array output is valid and parses", () => {
    expect(parseToolDefinition(tool()).ok).toBe(true);
    expect(validateToolPolicy(tool())).toEqual([]);
  });

  it("a list extract into a single-value output is refused", () => {
    const t = tool({ output: { type: "object", properties: { names: { type: "string", maxLength: 50 } }, required: ["names"], additionalProperties: false } });
    expect(validateToolPolicy(t).map((i) => i.code)).toContain("output_shape_mismatch");
  });

  it("the start-page query may not contain ?, # or spaces", () => {
    for (const query of ["a=1#x", "?a=1", "a=1 b"]) expect(parseToolDefinition(tool({ entry: { path: "/items", query } })).ok, query).toBe(false);
  });

  it("query parameters count as used, and credential-looking keys are refused", () => {
    const withParam = tool({
      entry: { path: "/items", query: "q={term}" },
      input: { type: "object", properties: { term: { type: "string", maxLength: 50 } }, required: ["term"], additionalProperties: false },
    });
    expect(validateToolPolicy(withParam)).toEqual([]);
    for (const q of ["token=abc", "PHPSESSID=1", "api_key=x", "session_id=1", "auth=1"]) {
      expect(validateToolPolicy(tool({ entry: { path: "/items", query: q } })).map((i) => i.code), q).toContain("entry_query_sensitive");
    }
  });

  it("recognises credential keys but not ordinary ones", () => {
    for (const k of ["sid", "jsessionid", "access_token", "X-Api-Key", "password"]) expect(isCredentialQueryKey(k), k).toBe(true);
    for (const k of ["q", "page", "sort", "category", "id", "lang"]) expect(isCredentialQueryKey(k), k).toBe(false);
  });

  it("renders the start address with every value encoded", () => {
    expect(renderEntry({ path: "/items/{id}", query: "q={term}&n=1" }, { id: "a/b", term: "x y#z" })).toBe("/items/a%2Fb?q=x%20y%23z&n=1");
    expect(renderEntry({ path: "/items" }, {})).toBe("/items");
  });
});
