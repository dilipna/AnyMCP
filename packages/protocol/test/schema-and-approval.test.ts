import { describe, expect, it } from "vitest";
import {
  checkOrigin,
  computeBindingHash,
  isSensitiveField,
  makeEnvelope,
  resolveText,
  validateAgainstSchema,
  type ApprovalBindingInput,
  type ObjectSchema,
} from "../src";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    order_id: { type: "string", pattern: "^A-\\d{4}$", maxLength: 6 },
    qty: { type: "integer", minimum: 1, maximum: 5 },
  },
  required: ["order_id"],
  additionalProperties: false,
};

describe("input schema validation (runs identically in bridge, worker and page)", () => {
  it("accepts valid arguments", () => {
    expect(validateAgainstSchema(schema, { order_id: "A-1042", qty: 2 })).toEqual([]);
  });
  it("rejects wrong format, missing, extra and wrongly typed fields", () => {
    expect(validateAgainstSchema(schema, { order_id: "XYZ" }).length).toBe(1);
    expect(validateAgainstSchema(schema, {}).map((i) => i.message)).toContain("is required");
    expect(validateAgainstSchema(schema, { order_id: "A-1042", sneaky: 1 }).map((i) => i.message)).toContain("is not an allowed field");
    expect(validateAgainstSchema(schema, { order_id: "A-1042", qty: "2" }).length).toBe(1);
    expect(validateAgainstSchema(schema, { order_id: "A-1042", qty: 2.5 }).length).toBe(1);
  });
  it("refuses a catastrophic-backtracking pattern instead of running it", () => {
    const evil: ObjectSchema = { type: "object", properties: { x: { type: "string", pattern: "(a+)+$", maxLength: 40 } }, additionalProperties: false };
    expect(validateAgainstSchema(evil, { x: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!" }).map((i) => i.message).join()).toContain("not allowed");
  });
});

describe("origin enforcement", () => {
  const tool = { origins: ["http://127.0.0.1:4173"] };
  it("allows the exact origin", () => expect(checkOrigin(tool, "http://127.0.0.1:4173/orders?q=1").ok).toBe(true));
  it("rejects a different host, port, scheme or lookalike", () => {
    for (const u of ["http://localhost:4173/", "http://127.0.0.1:4174/", "https://127.0.0.1:4173/", "http://127.0.0.1:4173.evil.example/", "chrome://settings"]) {
      expect(checkOrigin(tool, u).ok, u).toBe(false);
    }
  });
});

describe("approval binding", () => {
  const base: ApprovalBindingInput = {
    executionId: "run_1",
    toolId: "draft_customer_note",
    toolVersion: 1,
    definitionHash: "abc",
    origin: "http://127.0.0.1:4173",
    targetFingerprint: "button|Save draft note|0",
    args: { order_id: "A-1042", note: "hello" },
    state: { customer: "Test Customer 42", status: "Shipped" },
  };
  it("is stable for identical input regardless of key order", async () => {
    const a = await computeBindingHash(base);
    const b = await computeBindingHash({ ...base, args: { note: "hello", order_id: "A-1042" } });
    expect(a).toBe(b);
  });
  it("changes when ANY bound element changes", async () => {
    const a = await computeBindingHash(base);
    const variants: Partial<ApprovalBindingInput>[] = [
      { executionId: "run_2" },
      { toolVersion: 2 },
      { definitionHash: "abd" },
      { origin: "http://localhost:4173" },
      { targetFingerprint: "button|Save draft note|1" },
      { args: { order_id: "A-1042", note: "hello!" } },
      { state: { customer: "Test Customer 42", status: "Cancelled" } },
    ];
    for (const v of variants) expect(await computeBindingHash({ ...base, ...v }), JSON.stringify(v)).not.toBe(a);
  });
});

describe("sensitive fields", () => {
  it("flags password, payment, token and ignored fields", () => {
    expect(isSensitiveField({ type: "password" })).toBe(true);
    expect(isSensitiveField({ type: "text", autocomplete: "cc-number" })).toBe(true);
    expect(isSensitiveField({ type: "text", name: "api_key" })).toBe(true);
    expect(isSensitiveField({ type: "text", label: "One-time code" })).toBe(true);
    expect(isSensitiveField({ type: "text", anymcpIgnore: true })).toBe(true);
    expect(isSensitiveField({ type: "hidden" })).toBe(true);
  });
  it("does not flag ordinary fields", () => {
    expect(isSensitiveField({ type: "search", label: "Order ID" })).toBe(false);
    expect(isSensitiveField({ type: "text", name: "note", label: "Customer note" })).toBe(false);
  });
});

describe("result envelope", () => {
  it("never carries output for a non-success status", () => {
    const env = makeEnvelope({
      executionId: "run_1",
      tool: { id: "t", version: 1 },
      status: "unknown_outcome",
      reasonCode: "tab_closed",
      message: "x",
      startedAt: new Date().toISOString(),
      output: { secret: 1 },
    });
    expect(env.output).toBeUndefined();
    expect(env.retry.safe).toBe(false);
  });
  it("renders templates only from supplied arguments", () => {
    expect(resolveText("Order {order_id}", { order_id: "A-1" })).toBe("Order A-1");
    expect(resolveText("Order {order_id}", {})).toBeUndefined();
    expect(resolveText({ literal: "{order_id}" }, { order_id: "A-1" })).toBe("{order_id}");
  });
});
