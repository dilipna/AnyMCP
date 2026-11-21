import { describe, expect, it } from "vitest";
import { validateToolPolicy, type ToolDefinition } from "../src";

const tool = (outputRequired: string[], successResult?: Record<string, unknown>): ToolDefinition =>
  ({
    schemaVersion: 1, id: "list_items", version: 1, title: "List items", description: "Return the names of the items on the page.",
    kind: "read", origins: ["https://shop.example"], entry: { path: "/items" },
    input: { type: "object", properties: {}, additionalProperties: false },
    output: { type: "object", properties: { names: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["names", ...outputRequired], additionalProperties: false },
    steps: [{ id: "s1", op: "extract", into: "names", source: { type: "list", locator: { by: "testid", id: "name" }, maxItems: 10 } }],
    preconditions: [{ id: "ready", condition: { kind: "exists", locator: { by: "testid", id: "name" } } }],
    sessionExpiredWhen: [], postconditions: [{ id: "shown", condition: { kind: "exists", locator: { by: "testid", id: "name" } } }],
    emptyWhen: [], failureWhen: [],
    approval: { required: false, actionTemplate: "", stateFields: [], ttlSeconds: 120 },
    limits: { stepTimeoutMs: 5000, totalTimeoutMs: 30000, maxAttempts: 2 }, reconcile: false,
    ...(successResult ? { successResult } : {}),
  }) as unknown as ToolDefinition;

describe("policy: required outputs named like Object.prototype members", () => {
  it("the base tool is valid", () => expect(validateToolPolicy(tool([]))).toEqual([]));
  for (const name of ["constructor", "tostring"]) {
    it(`a required output "${name}" that is never produced is refused, even with an empty success result`, () => {
      const codes = validateToolPolicy(tool([name], {})).map((i) => i.code);
      expect(codes).toContain("output_not_extracted");
    });
  }
  it("a required output that is not declared in the output schema is refused", () => {
    const codes = validateToolPolicy(tool(["constructor"])).map((i) => i.code);
    expect(codes).toContain("bad_required_output");
  });
});
