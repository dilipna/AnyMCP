import { describe, expect, it } from "vitest";
import { deriveReviewSummary, parseToolDefinition, validateToolPolicy, type ToolDefinition } from "mycp-protocol";
import { makeDraftNoteTool, makeFindOrderTool } from "../src/tools";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const codes = (t: ToolDefinition) => validateToolPolicy(t).map((i) => i.code);

describe("fixture tool definitions", () => {
  it("find_order parses and passes policy", () => {
    const parsed = parseToolDefinition(makeFindOrderTool());
    expect(parsed.ok).toBe(true);
    expect(validateToolPolicy(makeFindOrderTool())).toEqual([]);
  });

  it("draft_customer_note parses and passes policy", () => {
    expect(parseToolDefinition(makeDraftNoteTool()).ok).toBe(true);
    expect(validateToolPolicy(makeDraftNoteTool())).toEqual([]);
  });

  it("derived review summary reports reads, changes and approval from structure", () => {
    const read = deriveReviewSummary(makeFindOrderTool());
    expect(read.changes.level).toBe("ui_only");
    expect(read.approval.required).toBe(false);
    expect(read.reads.map((r) => r.field)).toContain("status");

    const write = deriveReviewSummary(makeDraftNoteTool());
    expect(write.changes.level).toBe("commit");
    expect(write.approval.required).toBe(true);
    expect(write.verification.after.length).toBeGreaterThan(0);
  });
});

describe("policy rejects unsafe definitions", () => {
  it("a read tool may not contain a data-changing click", () => {
    const t = clone(makeFindOrderTool());
    const click = t.steps.find((s) => s.op === "click")!;
    if (click.op === "click") click.effect = "commit";
    expect(codes(t)).toContain("commit_in_read_tool");
  });

  it("a write tool must require approval", () => {
    const t = clone(makeDraftNoteTool());
    t.approval.required = false;
    expect(codes(t)).toContain("write_needs_approval");
  });

  it("a write tool may not be auto-retried", () => {
    const t = clone(makeDraftNoteTool());
    t.limits.maxAttempts = 2;
    expect(codes(t)).toContain("write_no_retry");
  });

  it("every tool needs a postcondition and a precondition", () => {
    const t = clone(makeFindOrderTool());
    t.postconditions = [];
    t.preconditions = [];
    expect(codes(t)).toEqual(expect.arrayContaining(["needs_postcondition", "needs_precondition"]));
  });

  it("rejects a step that uses a target that was never located", () => {
    const t = clone(makeFindOrderTool());
    t.steps = t.steps.filter((s) => !(s.op === "locate" && s.as === "search_input"));
    expect(codes(t)).toContain("unbound_target");
  });

  it("rejects non-loopback http origins and wildcard origins", () => {
    const t = clone(makeFindOrderTool());
    t.origins = ["http://example.com"];
    expect(codes(t)).toContain("origin_insecure");
    const w = makeFindOrderTool();
    w.origins = ["https://*.example.com"];
    expect(parseToolDefinition(w).ok).toBe(false); // wildcards cannot even parse
  });

  it("refuses to fill a field whose binding name or locator looks like a password", () => {
    // by binding name (snake_case — the case a plain \b regex misses)
    const a = clone(makeFindOrderTool());
    for (const s of a.steps) {
      if (s.op === "locate" && s.as === "search_input") s.as = "password_field";
      if (s.op === "fill") s.target = "password_field";
    }
    expect(codes(a)).toContain("sensitive_target");
    // by what the locator actually points at
    const b = clone(makeFindOrderTool());
    const loc = b.steps.find((s) => s.op === "locate" && s.as === "search_input")!;
    if (loc.op === "locate") loc.locator = { by: "label", text: "Password" };
    expect(codes(b)).toContain("sensitive_target");
  });

  it("requires a path parameter to be constrained", () => {
    const t = clone(makeDraftNoteTool());
    delete (t.input.properties.order_id as { pattern?: string }).pattern;
    expect(codes(t)).toContain("path_param_unconstrained");
  });

  it("rejects a required output that nothing produces on the SUCCESS path (the empty result does not count)", () => {
    const t = clone(makeFindOrderTool());
    delete t.successResult; // `found` is required, only emptyResult provides it
    expect(codes(t)).toContain("output_not_extracted");
  });

  it("rejects a fixed success value of the wrong type", () => {
    const t = clone(makeFindOrderTool());
    t.successResult = { found: "yes" };
    expect(codes(t)).toContain("const_bad_type");
  });

  it("rejects unknown operations and extra keys (no hidden scripting)", () => {
    const t = clone(makeFindOrderTool()) as unknown as { steps: unknown[] };
    t.steps.push({ id: "x1", op: "evaluate", script: "alert(1)" });
    expect(parseToolDefinition(t).ok).toBe(false);
    const u = clone(makeFindOrderTool()) as unknown as Record<string, unknown>;
    u.onLoad = "fetch('http://evil.example')";
    expect(parseToolDefinition(u).ok).toBe(false);
  });
});
