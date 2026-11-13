// The data-changing step can be a click, an Enter key press, or a field that saves by itself. Whatever it is,
// the same rules hold: exactly one per write tool, never in a read tool, nothing typed or pressed after it.

import { describe, expect, it } from "vitest";
import { deriveReviewSummary, describeStep, isCommitStep, parseToolDefinition, validateToolPolicy, type Step, type ToolDefinition } from "../src";

const read = (steps: Step[], over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  schemaVersion: 1,
  id: "search_app",
  version: 1,
  title: "Search the app",
  description: "Search the app and return the first result.",
  kind: "read",
  origins: ["https://app.example"],
  entry: { path: "/" },
  input: { type: "object", properties: { q: { type: "string", maxLength: 50 } }, required: ["q"], additionalProperties: false },
  output: { type: "object", properties: { first: { type: "string", maxLength: 200 } }, required: ["first"], additionalProperties: false },
  steps: [
    { id: "s1", op: "locate", as: "box", locator: { by: "label", text: "Search" } },
    { id: "s2", op: "fill", target: "box", value: { param: "q" } },
    ...steps,
    { id: "s9", op: "extract", into: "first", source: { type: "text", locator: { by: "testid", id: "first" } } },
  ],
  preconditions: [{ id: "ready", condition: { kind: "exists", locator: { by: "label", text: "Search" } } }],
  sessionExpiredWhen: [],
  postconditions: [{ id: "shown", condition: { kind: "exists", locator: { by: "testid", id: "first" } } }],
  emptyWhen: [],
  failureWhen: [],
  approval: { required: false, actionTemplate: "", stateFields: [], ttlSeconds: 120 },
  limits: { stepTimeoutMs: 5000, totalTimeoutMs: 30000, maxAttempts: 2 },
  reconcile: false,
  ...over,
});

const writeOver: Partial<ToolDefinition> = {
  kind: "write",
  approval: { required: true, actionTemplate: "Do it with {q}", stateFields: [{ id: "acct", label: "Account", locator: { by: "testid", id: "acct" } }], ttlSeconds: 120 },
  limits: { stepTimeoutMs: 5000, totalTimeoutMs: 45000, maxAttempts: 1 },
  reconcile: true,
};
const codes = (t: ToolDefinition) => validateToolPolicy(t).map((i) => i.code);

describe("Enter key presses", () => {
  it("a press that only searches is fine in a read tool", () => {
    const t = read([{ id: "s3", op: "press", target: "box", key: "Enter", effect: "ui" }]);
    expect(parseToolDefinition(t).ok).toBe(true);
    expect(validateToolPolicy(t)).toEqual([]);
    expect(describeStep(t.steps[2]!)).toBe("Press Enter in “box”");
    expect(deriveReviewSummary(t).changes.level).toBe("ui_only");
  });

  it("only Enter is allowed, and the target must have been located", () => {
    expect(parseToolDefinition(read([{ id: "s3", op: "press", target: "box", key: "Escape" as "Enter", effect: "ui" }])).ok).toBe(false);
    expect(codes(read([{ id: "s3", op: "press", target: "nope", key: "Enter", effect: "ui" }]))).toContain("unbound_target");
  });

  it("a press that changes data makes it a write tool, with all the write rules", () => {
    const step: Step = { id: "s3", op: "press", target: "box", key: "Enter", effect: "commit" };
    expect(codes(read([step]))).toContain("commit_in_read_tool");
    const w = read([step], writeOver);
    expect(validateToolPolicy(w)).toEqual([]);
    expect(isCommitStep(step)).toBe(true);
    expect(deriveReviewSummary(w).changes.lines.join(" ")).toMatch(/Presses Enter .* CHANGES data/);
  });
});

describe("fields that save by themselves", () => {
  const commitFill: Step = { id: "s3", op: "fill", target: "box", value: { param: "q" }, effect: "commit" };

  it("count as THE data-changing step", () => {
    const t = read([], writeOver);
    t.steps[1] = commitFill;
    expect(validateToolPolicy(t)).toEqual([]);
    expect(describeStep(commitFill)).toMatch(/saves by itself and changes data/);
    const sum = deriveReviewSummary(t);
    expect(sum.changes.level).toBe("commit");
    expect(sum.changes.lines.join(" ")).toMatch(/saves by itself — this CHANGES data/);
  });

  it("are refused in a read tool, and a second data-changing step is refused", () => {
    const r = read([]);
    r.steps[1] = commitFill;
    expect(codes(r)).toContain("commit_in_read_tool");
    const w = read([{ id: "s4", op: "click", target: "box", effect: "commit" }], writeOver);
    w.steps[1] = commitFill;
    expect(codes(w)).toContain("write_needs_one_commit");
  });

  it("nothing may be typed or pressed after the data-changing step", () => {
    const w = read([{ id: "s4", op: "press", target: "box", key: "Enter", effect: "ui" }], writeOver);
    w.steps[1] = commitFill;
    expect(codes(w)).toContain("post_commit_not_read_only");
  });

  it("a plain fill is not a commit", () => {
    expect(isCommitStep({ id: "x", op: "fill", target: "box", value: { param: "q" } })).toBe(false);
    expect(isCommitStep({ id: "x", op: "click", target: "box", effect: "navigate" })).toBe(false);
  });
});
