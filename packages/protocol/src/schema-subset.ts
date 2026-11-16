// A deliberately small JSON-Schema subset used for tool inputs and outputs.
//
// Why our own validator instead of Ajv: Ajv compiles schemas with `new Function`,
// which the MV3 extension CSP forbids. This subset is valid JSON Schema (so it
// can be advertised over MCP unchanged) and is validated by the same code in the
// bridge, the service worker and the content script.

import { z } from "zod";

export type SchemaSubset =
  | { type: "string"; description?: string; minLength?: number; maxLength?: number; pattern?: string; enum?: string[] }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: SchemaSubset; maxItems?: number }
  | {
      type: "object";
      description?: string;
      properties: Record<string, SchemaSubset>;
      required?: string[];
      additionalProperties: false;
    };

export const IDENT = /^[a-z][a-z0-9_]{0,39}$/;
const description = { description: z.string().max(300).optional() };

export const SchemaSubsetZ: z.ZodType<SchemaSubset> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("string"),
      ...description,
      minLength: z.int().min(0).max(5000).optional(),
      maxLength: z.int().min(1).max(5000).optional(),
      pattern: z.string().max(120).optional(),
      enum: z.array(z.string().max(200)).min(1).max(100).optional(),
    }),
    z.strictObject({ type: z.literal("integer"), ...description, minimum: z.number().optional(), maximum: z.number().optional() }),
    z.strictObject({ type: z.literal("number"), ...description, minimum: z.number().optional(), maximum: z.number().optional() }),
    z.strictObject({ type: z.literal("boolean"), ...description }),
    z.strictObject({ type: z.literal("array"), ...description, items: SchemaSubsetZ, maxItems: z.int().min(0).max(1000).optional() }),
    z.strictObject({
      type: z.literal("object"),
      ...description,
      properties: z.record(z.string().regex(IDENT), SchemaSubsetZ),
      required: z.array(z.string()).optional(),
      additionalProperties: z.literal(false),
    }),
  ]),
);

export type ObjectSchema = Extract<SchemaSubset, { type: "object" }>;
export const ObjectSchemaZ = SchemaSubsetZ.refine((s) => s.type === "object", "must be an object schema") as unknown as z.ZodType<ObjectSchema>;

/** The declared property `key` of an object schema, or undefined. Own entries only, so names such as `constructor`
 *  or `__proto__` are never mistaken for declared fields (found by the fuzz tests). */
export function declaredProperty(schema: ObjectSchema, key: string): SchemaSubset | undefined {
  return Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
}

export interface SchemaIssue {
  path: string;
  message: string;
}

/** Reject patterns with obvious catastrophic-backtracking shapes, e.g. `(a+)+`. */
export function isPatternSafe(pattern: string): boolean {
  if (pattern.length > 120) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  return true;
}

const DEFAULT_MAX_STRING = 2000;

export function validateAgainstSchema(schema: SchemaSubset, value: unknown, path = "$"): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const bad = (message: string) => issues.push({ path, message });

  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        bad("must be a string");
        break;
      }
      const max = schema.maxLength ?? DEFAULT_MAX_STRING;
      if (value.length > max) bad(`must be at most ${max} characters`);
      if (schema.minLength !== undefined && value.length < schema.minLength) bad(`must be at least ${schema.minLength} characters`);
      if (schema.enum && !schema.enum.includes(value)) bad(`must be one of: ${schema.enum.join(", ")}`);
      if (schema.pattern) {
        if (!isPatternSafe(schema.pattern)) bad("schema pattern is not allowed");
        else if (!new RegExp(schema.pattern).test(value)) bad(`does not match the required format (${schema.pattern})`);
      }
      break;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        bad("must be a number");
        break;
      }
      if (schema.type === "integer" && !Number.isInteger(value)) bad("must be an integer");
      if (schema.minimum !== undefined && value < schema.minimum) bad(`must be >= ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) bad(`must be <= ${schema.maximum}`);
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") bad("must be true or false");
      break;
    case "array": {
      if (!Array.isArray(value)) {
        bad("must be an array");
        break;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) bad(`must have at most ${schema.maxItems} items`);
      value.forEach((item, i) => issues.push(...validateAgainstSchema(schema.items, item, `${path}[${i}]`)));
      break;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        bad("must be an object");
        break;
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(obj, key) || obj[key] === undefined) issues.push({ path: `${path}.${key}`, message: "is required" });
      }
      for (const key of Object.keys(obj)) {
        const sub = declaredProperty(schema, key);
        if (!sub) {
          issues.push({ path: `${path}.${key}`, message: "is not an allowed field" });
          continue;
        }
        if (obj[key] !== undefined) issues.push(...validateAgainstSchema(sub, obj[key], `${path}.${key}`));
      }
      break;
    }
  }
  return issues;
}

export function formatIssues(issues: SchemaIssue[]): string {
  return issues.map((i) => `${i.path} ${i.message}`).join("; ");
}
