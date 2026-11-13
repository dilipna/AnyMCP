// ToolDefinition v1: a constrained, versioned, declarative workflow.
//
// This is DATA, not code. There are exactly seven operations (locate, fill, click,
// press, waitFor, extract, assert). No expressions, no loops, no branching, no scripts.
// Anything not in this vocabulary is rejected by the parser.

import { z } from "zod";
import { IDENT, ObjectSchemaZ, type ObjectSchema } from "./schema-subset";
import { hashCanonical } from "./canonical";

export const ROLES = [
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "heading", "table", "row", "cell",
  "columnheader", "list", "listitem", "img", "form", "region", "alert", "status", "dialog", "tab", "main", "navigation",
  "switch", "option", "menuitem",
] as const;
export type Role = (typeof ROLES)[number];

const Ident = z.string().regex(IDENT, "lowercase letters, digits and underscores; must start with a letter");

// ---- references ---------------------------------------------------------
export const ValueRefZ = z.union([z.strictObject({ param: Ident }), z.strictObject({ literal: z.string().max(500) })]);
export type ValueRef = z.infer<typeof ValueRefZ>;

/**
 * Text that may be fixed, contain {param} placeholders (e.g. "Order {order_id}"), or be exactly a parameter.
 * Values only ever come from the validated run arguments — never from page content.
 */
export const TextRefZ = z.union([z.string().min(1).max(200), z.strictObject({ param: Ident })]);
export type TextRef = z.infer<typeof TextRefZ>;

// ---- semantic locators --------------------------------------------------
const roleShape = { by: z.literal("role"), role: z.enum(ROLES), name: TextRefZ.optional(), exact: z.boolean().optional() };
const labelShape = { by: z.literal("label"), text: TextRefZ, exact: z.boolean().optional() };
const testidShape = { by: z.literal("testid"), id: z.string().min(1).max(100) };
const textShape = { by: z.literal("text"), text: TextRefZ, exact: z.boolean().optional() };

/** The value shown next to a label: the <td> after a <th>, or the <dd> after a <dt>. Common on detail pages. */
const fieldShape = { by: z.literal("field"), label: TextRefZ, exact: z.boolean().optional() };
/** Last resort: a CSS selector. Works on pages with no semantic handles, but breaks when the site's markup changes. */
const cssShape = { by: z.literal("css"), selector: z.string().min(1).max(200) };

const LocatorLeafZ = z.discriminatedUnion("by", [
  z.strictObject(roleShape),
  z.strictObject(labelShape),
  z.strictObject(testidShape),
  z.strictObject(textShape),
  z.strictObject(fieldShape),
  z.strictObject(cssShape),
]);
export const LocatorZ = z.discriminatedUnion("by", [
  z.strictObject({ ...roleShape, within: LocatorLeafZ.optional() }),
  z.strictObject({ ...labelShape, within: LocatorLeafZ.optional() }),
  z.strictObject({ ...testidShape, within: LocatorLeafZ.optional() }),
  z.strictObject({ ...textShape, within: LocatorLeafZ.optional() }),
  z.strictObject({ ...fieldShape, within: LocatorLeafZ.optional() }),
  z.strictObject({ ...cssShape, within: LocatorLeafZ.optional() }),
]);
export type Locator = z.infer<typeof LocatorZ>;
export type LocatorLeaf = z.infer<typeof LocatorLeafZ>;

// ---- conditions ---------------------------------------------------------
export const ConditionZ = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exists"), locator: LocatorZ }),
  z.strictObject({ kind: z.literal("absent"), locator: LocatorZ }),
  z.strictObject({ kind: z.literal("textEquals"), locator: LocatorZ, value: ValueRefZ }),
  z.strictObject({ kind: z.literal("textContains"), locator: LocatorZ, value: ValueRefZ }),
  z.strictObject({ kind: z.literal("countAtLeast"), locator: LocatorZ, n: z.int().min(0).max(1000) }),
  z.strictObject({ kind: z.literal("countEquals"), locator: LocatorZ, n: z.int().min(0).max(1000) }),
  z.strictObject({ kind: z.literal("urlPathEquals"), value: TextRefZ }),
  z.strictObject({ kind: z.literal("urlPathPrefix"), value: TextRefZ }),
]);
export type Condition = z.infer<typeof ConditionZ>;

export const NamedConditionZ = z.strictObject({ id: Ident, condition: ConditionZ });
export type NamedCondition = z.infer<typeof NamedConditionZ>;

// ---- operations ---------------------------------------------------------
const TableColumnZ = z.strictObject({ header: z.string().min(1).max(100), as: z.enum(["string", "number"]).optional() });

export const ExtractSourceZ = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    locator: LocatorZ,
    as: z.enum(["string", "number"]).optional(),
    /** If true, a missing element omits the field instead of stopping the run. Not allowed for required outputs. */
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("table"),
    locator: LocatorZ,
    columns: z.record(Ident, TableColumnZ),
    maxRows: z.int().min(1).max(200),
  }),
  z.strictObject({ type: z.literal("count"), locator: LocatorZ }),
  /**
   * The text of EVERY visible element the locator matches, in page order (search results, cards, list rows).
   * Unlike `text`, many matches are expected; zero matches stops the run (declare an empty state with `emptyWhen`).
   */
  z.strictObject({
    type: z.literal("list"),
    locator: LocatorZ,
    as: z.enum(["string", "number"]).optional(),
    maxItems: z.int().min(1).max(200),
  }),
]);
export type ExtractSource = z.infer<typeof ExtractSourceZ>;

export const CLICK_EFFECTS = ["ui", "navigate", "commit"] as const;
export type ClickEffect = (typeof CLICK_EFFECTS)[number];

/** A fill is normally just typing. "commit" marks a field that SAVES by itself when it changes (no Save button). */
export const FILL_EFFECTS = ["ui", "commit"] as const;
export const PRESS_KEYS = ["Enter"] as const;

export const StepZ = z.discriminatedUnion("op", [
  z.strictObject({ id: Ident, op: z.literal("locate"), as: Ident, locator: LocatorZ }),
  z.strictObject({ id: Ident, op: z.literal("fill"), target: Ident, value: ValueRefZ, effect: z.enum(FILL_EFFECTS).optional() }),
  z.strictObject({ id: Ident, op: z.literal("click"), target: Ident, effect: z.enum(CLICK_EFFECTS) }),
  /** Press a key in a located field (search boxes that submit on Enter). Same effect levels as a click. */
  z.strictObject({ id: Ident, op: z.literal("press"), target: Ident, key: z.enum(PRESS_KEYS), effect: z.enum(CLICK_EFFECTS) }),
  z.strictObject({ id: Ident, op: z.literal("waitFor"), condition: ConditionZ, timeoutMs: z.int().min(100).max(30000).optional() }),
  z.strictObject({ id: Ident, op: z.literal("extract"), into: Ident, source: ExtractSourceZ }),
  z.strictObject({ id: Ident, op: z.literal("assert"), condition: ConditionZ }),
]);
export type Step = z.infer<typeof StepZ>;

/** The step that changes data: a click, a key press, or a fill marked as saving by itself. */
export type CommitStep = Extract<Step, { op: "click" | "press" | "fill" }> & { effect: "commit" };
export function isCommitStep(s: Step): s is CommitStep {
  return (s.op === "click" || s.op === "press" || s.op === "fill") && s.effect === "commit";
}

// ---- tool ---------------------------------------------------------------
export const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

export const ToolDefinitionZ = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9_]{2,47}$/, "tool ids are snake_case, 3-48 characters"),
  version: z.int().min(1),
  title: z.string().min(3).max(80),
  /** The author's purpose statement. Shown to the AI client; never used as the source of enforcement. */
  description: z.string().min(10).max(500),
  kind: z.enum(["read", "write"]),
  /** Exact origins only (scheme + host + port). No wildcards. */
  origins: z.array(z.string().regex(ORIGIN_RE, "must be an exact origin like https://example.com")).min(1).max(3),
  /** Where the run starts. May contain {param} placeholders (URL-encoded on use). */
  entry: z.strictObject({
    path: z.string().regex(/^\/[^\s?#]*$/, "must start with / and contain no query or fragment").max(200),
    /**
     * Optional query string WITHOUT the leading "?", e.g. "q={term}&page=1". {param} placeholders are URL-encoded
     * on use. Never a fragment. Policy rejects keys that look like credentials (session ids, tokens).
     */
    query: z.string().regex(/^[^\s?#]+$/, "must not contain spaces, ? or #").max(300).optional(),
  }),
  input: ObjectSchemaZ,
  output: ObjectSchemaZ,
  steps: z.array(StepZ).min(1).max(40),
  preconditions: z.array(NamedConditionZ).max(10),
  /** If any of these is true the session is considered expired and the run stops. */
  sessionExpiredWhen: z.array(NamedConditionZ).max(5),
  postconditions: z.array(NamedConditionZ).max(10),
  /** The site itself says "there is nothing to return" (read tools). Ends the run as `empty` using `emptyResult`. */
  emptyWhen: z.array(NamedConditionZ).max(5),
  /** Constant output returned for a valid empty result. Must satisfy the output schema's types. */
  emptyResult: z.record(z.string(), z.unknown()).optional(),
  /** Constant values merged into the output on success (e.g. {found: true}). Data, not code. */
  successResult: z.record(z.string(), z.unknown()).optional(),
  /** The site itself reports an error or rejection. Ends the run as `failed` (no effect, as reported by the site). */
  failureWhen: z.array(NamedConditionZ).max(5),
  approval: z.strictObject({
    required: z.boolean(),
    /** Rendered with the run's arguments, e.g. "Save a draft note on order {order_id}: {note}". */
    actionTemplate: z.string().max(300),
    /** Page values the user is shown and that must not change between approval and action. */
    stateFields: z.array(z.strictObject({ id: Ident, label: z.string().min(1).max(60), locator: LocatorZ })).max(6),
    ttlSeconds: z.int().min(10).max(300),
  }),
  limits: z.strictObject({
    stepTimeoutMs: z.int().min(500).max(30000),
    totalTimeoutMs: z.int().min(2000).max(120000),
    /** Whole-run attempts for READ tools after an interruption. Always 1 for write tools. */
    maxAttempts: z.int().min(1).max(3),
  }),
  /** Write tools: after the action, if inconclusive, reload (read-only) once and re-check postconditions. */
  reconcile: z.boolean(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionZ>;

export function parseToolDefinition(input: unknown): { ok: true; tool: ToolDefinition } | { ok: false; error: string } {
  const r = ToolDefinitionZ.safeParse(input);
  if (r.success) return { ok: true, tool: r.data };
  const msg = r.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).join("; ");
  return { ok: false, error: msg };
}

/** Hash that identifies exactly what was reviewed/tested/enabled. */
export function toolDefinitionHash(tool: ToolDefinition): Promise<string> {
  return hashCanonical(tool);
}

/** What the bridge is told about an enabled tool. Contains no workflow steps. */
export interface ToolManifest {
  id: string;
  version: number;
  definitionHash: string;
  title: string;
  description: string;
  kind: "read" | "write";
  origins: string[];
  approvalRequired: boolean;
  /** Upper bound the bridge waits for a final result (steps + approval window + slack). */
  budgetMs: number;
  input: ObjectSchema;
  /** Advertised output schema. `required` is relaxed to what a valid empty result also contains. */
  output: ObjectSchema;
}

/**
 * The advertised output must accept BOTH a full success and the tool's constant empty result,
 * so `required` is reduced to the keys both shapes contain. MyCP's own validator still checks the
 * full required set on success before a result is ever returned.
 */
export function advertisedOutputSchema(tool: ToolDefinition): ObjectSchema {
  if (!tool.emptyResult) return tool.output;
  const emptyKeys = Object.keys(tool.emptyResult);
  const required = (tool.output.required ?? []).filter((k) => emptyKeys.includes(k));
  const { required: _drop, ...rest } = tool.output;
  return required.length ? { ...rest, required } : rest;
}

export async function toToolManifest(tool: ToolDefinition): Promise<ToolManifest> {
  return {
    id: tool.id,
    version: tool.version,
    definitionHash: await toolDefinitionHash(tool),
    title: tool.title,
    description: tool.description,
    kind: tool.kind,
    origins: tool.origins,
    approvalRequired: tool.approval.required,
    budgetMs: tool.limits.totalTimeoutMs * tool.limits.maxAttempts + (tool.approval.required ? tool.approval.ttlSeconds * 1000 : 0) + 10_000,
    input: tool.input,
    output: advertisedOutputSchema(tool),
  };
}

export { isParamRef, resolveText } from "./text";
