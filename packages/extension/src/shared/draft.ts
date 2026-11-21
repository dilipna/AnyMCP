// Turns a recording + the user's choices into a ToolDefinition. Pure and deterministic (no chrome.*),
// so it can be unit-tested. Nothing here is "AI": every step in the result is something the user did or chose.
//
// Privacy: typed example values live in `DraftParam.example` ONLY so recorded text can be turned into
// {param} references (e.g. a link named "A-1042" becomes {order_id}). Examples are never copied into the
// definition, and the spec is held in memory (session storage), not written to local storage.

import {
  ToolDefinitionZ,
  describeLocator,
  isCredentialQueryKey,
  validateToolPolicy,
  type Condition,
  type Locator,
  type LocatorLeaf,
  type NamedCondition,
  type Step,
  type TextRef,
  type ToolDefinition,
} from "anymcp-protocol";
import type { ObjectSchema, SchemaSubset } from "anymcp-protocol";

export type FillValue = { mode: "param"; param: string } | { mode: "literal"; text: string } | { mode: "skip" };

export interface DraftParam {
  name: string;
  description: string;
  type: "string" | "integer" | "boolean";
  /** In-memory only. Used to recognise the value inside recorded locators. */
  example: string;
  pattern?: string;
  maxLength: number;
  /** The choices of a recorded dropdown. When present the input only accepts one of them. */
  options?: string[];
  /** This input replaces one whole part of the start address (the part equal to `example`). */
  fromPath?: boolean;
}

/** Characters allowed in an address part that became an input (the value is URL-encoded on use as well). */
export const PATH_PART_PATTERN = "^[A-Za-z0-9._~-]{1,100}$";

export interface DraftStep {
  seq: number;
  kind: "input" | "click" | "press";
  label: string;
  locator: Locator;
  effect: "ui" | "navigate" | "commit";
  fill: FillValue;
  enabled: boolean;
  /** For input steps: what kind of control is set. Absent = a text box. */
  control?: "text" | "select" | "checkbox" | "radio";
  /** For click steps: the sibling choices of a clicked option/menu item (offered as the input's allowed values). */
  options?: string[];
  /** For click steps: the input that decides WHICH element is clicked (its example is this step's label). */
  asParam?: string;
  /** Keep this step's locator text exactly as recorded, even if an input's example appears inside it. */
  keepText?: boolean;
}

/** One key of the start page's query string, and what the user decided to do with it. */
export interface DraftQueryPart {
  key: string;
  /** Decoded value as recorded. Saved in the definition only when mode is "fixed". */
  value: string;
  mode: "fixed" | "param" | "drop";
  /** Name of the input that supplies the value when mode is "param". */
  param?: string;
}

export interface DraftOutput {
  id: string;
  name: string;
  kind: "text" | "table" | "list";
  locator: Locator;
  /** "link" = the text plus the address of the link (provenance for each result). */
  as: "string" | "number" | "link";
  optional: boolean;
  /** result = returned to the AI; approval = shown + bound in the approval but not returned; both = both */
  use: "result" | "approval" | "both";
  description?: string;
  columns?: Record<string, { header: string; as: "string" | "number" }>;
  maxRows?: number;
  /** label shown in the approval sheet */
  approvalLabel?: string;
}

export type SignalKind = "success" | "expired" | "error" | "empty";
export interface DraftSignal {
  id: string;
  kind: SignalKind;
  locator: Locator;
}

export interface DraftSpec {
  id: string;
  title: string;
  description: string;
  origin: string;
  entryPath: string;
  /** Query string of the page the recording started on. Absent/empty = none. */
  entryQuery?: DraftQueryPart[];
  steps: DraftStep[];
  params: DraftParam[];
  outputs: DraftOutput[];
  signals: DraftSignal[];
  approvalText: string;
}

/** A link result: what it says and where it points. */
const LINK_SCHEMA: SchemaSubset = {
  type: "object",
  properties: { text: { type: "string", maxLength: 2000 }, url: { type: "string", maxLength: 2000 } },
  required: ["text", "url"],
  additionalProperties: false,
};

const snake = (s: string, fallback: string): string => {
  const t = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]+/, "");
  return (t || fallback).slice(0, 32);
};

function uniqueName(base: string, used: Set<string>): string {
  let n = base;
  for (let i = 2; used.has(n); i++) n = `${base}_${i}`.slice(0, 40);
  used.add(n);
  return n;
}

/** Shorter examples ("a", "10") would match by accident inside unrelated text, so they only replace an exact match. */
const MIN_SUBSTRING_EXAMPLE = 3;

/** Replace a recorded example value inside text with a parameter reference. */
export function parameterizeText(text: string, params: DraftParam[]): TextRef {
  const ps = [...params].filter((p) => p.example.length >= 1).sort((a, b) => b.example.length - a.example.length);
  for (const p of ps) if (text === p.example) return { param: p.name };
  let out = text;
  for (const p of ps) if (p.example.length >= MIN_SUBSTRING_EXAMPLE) out = out.split(p.example).join(`{${p.name}}`);
  return out;
}

function pText(t: TextRef, params: DraftParam[]): TextRef {
  return typeof t === "string" ? parameterizeText(t, params) : t;
}

function pLeaf(l: LocatorLeaf, params: DraftParam[]): LocatorLeaf {
  switch (l.by) {
    case "role": return { ...l, ...(l.name !== undefined ? { name: pText(l.name, params) } : {}) };
    case "label": return { ...l, text: pText(l.text, params) };
    case "text": return { ...l, text: pText(l.text, params) };
    case "testid": return l;
    case "css": return l;
    case "field": return { ...l, label: pText(l.label, params) };
  }
}

export function parameterizeLocator(loc: Locator, params: DraftParam[]): Locator {
  const base = pLeaf(loc as LocatorLeaf, params) as Locator;
  return "within" in loc && loc.within ? ({ ...base, within: pLeaf(loc.within, params) } as Locator) : base;
}

export interface BuildResult {
  definition: ToolDefinition | null;
  errors: string[];
  warnings: string[];
}

function toSchemaType(p: DraftParam): SchemaSubset {
  if (p.type === "integer") return { type: "integer", description: p.description || undefined };
  if (p.type === "boolean") return { type: "boolean", description: p.description || undefined };
  return {
    type: "string",
    description: p.description || undefined,
    maxLength: p.maxLength,
    ...(p.pattern ? { pattern: p.pattern } : {}),
    ...(p.options?.length ? { enum: p.options } : {}),
  };
}

/** Keys that only track where a visit came from. Dropped by default: they are not part of the task. */
const TRACKING_KEY_RE = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref_src|igshid)$/i;

/** First guess for the start page's query string. Credentials and tracking keys start out dropped. */
export function queryPartsFromSearch(search: string): DraftQueryPart[] {
  const out: DraftQueryPart[] = [];
  for (const [key, value] of new URLSearchParams(search)) {
    if (!key || out.length >= 12 || out.some((p) => p.key === key)) continue;
    const credential = isCredentialQueryKey(key);
    // a credential's VALUE is never kept, not even in memory
    out.push({ key, value: credential ? "" : value.slice(0, 200), mode: credential || TRACKING_KEY_RE.test(key) ? "drop" : "fixed" });
  }
  return out;
}

/**
 * The start address as a template. Parts chosen as inputs ("fromPath") are replaced as WHOLE parts; other inputs'
 * examples are recognised inside the remaining parts (e.g. a typed order id that appears in the address).
 */
export function buildEntryPath(path: string, params: DraftParam[]): string {
  const pathParams = params.filter((p) => p.fromPath);
  const others = params.filter((p) => !p.fromPath);
  const parts = path.split("/").slice(1).map((seg) => {
    const own = pathParams.find((p) => p.example === seg);
    if (own) return `{${own.name}}`;
    if (!seg) return seg;
    const ref = parameterizeText(seg, others);
    return typeof ref === "string" ? ref : `{${ref.param}}`;
  });
  return `/${parts.join("/")}`;
}

/** Render the kept query parts as a template: fixed values URL-encoded, inputs as {placeholders}. */
export function buildEntryQuery(parts: DraftQueryPart[] | undefined, params: DraftParam[], errors: string[]): string | undefined {
  const pairs: string[] = [];
  for (const p of parts ?? []) {
    if (p.mode === "drop") continue;
    const key = encodeURIComponent(p.key);
    if (p.mode === "param") {
      if (!p.param || !params.some((x) => x.name === p.param)) errors.push(`The start address uses “${p.key}” as an input, but that input is not defined.`);
      else pairs.push(`${key}={${p.param}}`);
      continue;
    }
    // a fixed value may still contain something the user typed later (an input's example): keep it as an input
    const ref = parameterizeText(p.value, params);
    if (typeof ref !== "string") pairs.push(`${key}={${ref.param}}`);
    else pairs.push(`${key}=${ref.split(/(\{[a-z][a-z0-9_]*\})/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join("")}`);
  }
  return pairs.length ? pairs.join("&") : undefined;
}

export function buildDraft(spec: DraftSpec, version: number): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const params = spec.params;
  const steps: Step[] = [];
  const usedIds = new Set<string>();
  const usedBindings = new Set<string>();
  const nextId = () => uniqueName(`s${steps.length + 1}`, usedIds);
  let commitFound = false;
  let firstLocator: Locator | null = null;

  for (const s of spec.steps.filter((x) => x.enabled)) {
    if (s.kind === "input" && s.fill.mode === "skip") continue;
    const loc = s.keepText ? s.locator : parameterizeLocator(s.locator, params);
    firstLocator ??= loc;
    const as = uniqueName(snake(s.label, s.kind === "click" ? "button" : "field"), usedBindings);
    steps.push({ id: nextId(), op: "locate", as, locator: loc });
    const partial = s.keepText ? null : partlyParameterized(s.locator, loc, params);
    if (partial) warnings.push(`“${s.label}” will change with the input “${partial}”: AnyMCP will look for ${describeLocator(loc)}. If it should be the same element on every run, choose “Keep this text as recorded” on that step.`);
    if (s.kind === "input" && s.effect !== "commit" && s.control && s.control !== "text") {
      const what = s.control === "select" ? "a dropdown" : s.control === "radio" ? "an option button" : "a checkbox";
      warnings.push(`“${s.label}” is ${what}. If this site saves the moment it changes (with no Save button), the tool would change data without asking you. Keep this step only if it just fills in a form.`);
    }
    if (s.kind === "input") {
      if (s.fill.mode === "param") {
        const paramName = s.fill.param;
        if (!params.some((p) => p.name === paramName)) errors.push(`Step “${s.label}” uses parameter “${paramName}” which is not defined.`);
        steps.push({ id: nextId(), op: "fill", target: as, value: { param: paramName }, ...(s.effect === "commit" ? { effect: "commit" as const } : {}) });
        if (s.effect === "commit") commitFound = true;
      } else if (s.fill.mode === "literal") {
        const control = s.control ?? "text";
        if ((control === "checkbox" || control === "radio") && s.fill.text !== "true" && s.fill.text !== "false") {
          errors.push(`“${s.label}” is a ${control === "radio" ? "option button" : "checkbox"}: its fixed value must be true or false.`);
        }
        steps.push({ id: nextId(), op: "fill", target: as, value: { literal: s.fill.text }, ...(s.effect === "commit" ? { effect: "commit" as const } : {}) });
        if (s.effect === "commit") commitFound = true;
        if (control === "text" || control === "select") warnings.push(`“${s.label}” always gets the fixed value “${s.fill.text.slice(0, 20)}”. It will be saved in the tool definition.`);
      }
    } else if (s.kind === "press") {
      if (s.effect === "commit") commitFound = true;
      steps.push({ id: nextId(), op: "press", target: as, key: "Enter", effect: s.effect });
    } else {
      if (s.effect === "commit") commitFound = true;
      steps.push({ id: nextId(), op: "click", target: as, effect: s.effect });
    }
  }
  // No recorded action is fine: a tool may simply read the page it starts on (for example a search address with
  // the query in it). It still needs something to return and a success check (both enforced below).

  // ---- outputs ----
  const kind: "read" | "write" = commitFound ? "write" : "read";
  const outProps: Record<string, SchemaSubset> = {};
  const outRequired: string[] = [];
  const stateFields: ToolDefinition["approval"]["stateFields"] = [];
  const extracts: Step[] = [];
  for (const o of spec.outputs) {
    const loc = parameterizeLocator(o.locator, params);
    const returned = o.use === "result" || o.use === "both";
    const approvalUse = o.use === "approval" || o.use === "both";
    if (approvalUse && o.kind === "text") stateFields.push({ id: snake(o.name, "value"), label: (o.approvalLabel ?? o.name).slice(0, 60), locator: loc });
    if (approvalUse && o.kind !== "text") errors.push(`“${o.name}” is a ${o.kind} and cannot be used as an approval value.`);
    if (!returned) continue;
    const name = snake(o.name, "value");
    if (Object.hasOwn(outProps, name)) { // own keys only: "constructor" is not a duplicate
      errors.push(`Two outputs are named “${name}”.`);
      continue;
    }
    if (o.kind === "text") {
      outProps[name] = o.as === "number" ? { type: "number", description: o.description } : o.as === "link" ? { ...LINK_SCHEMA, description: o.description } : ({ type: "string", description: o.description, maxLength: 2000 } as SchemaSubset);
      extracts.push({ id: nextId(), op: "extract", into: name, source: { type: "text", locator: loc, as: o.as, ...(o.optional ? { optional: true } : {}) } });
      if (!o.optional) outRequired.push(name);
    } else if (o.kind === "list") {
      const maxItems = o.maxRows ?? 50;
      outProps[name] = { type: "array", description: o.description, items: o.as === "number" ? { type: "number" } : o.as === "link" ? LINK_SCHEMA : { type: "string", maxLength: 2000 }, maxItems };
      extracts.push({ id: nextId(), op: "extract", into: name, source: { type: "list", locator: loc, as: o.as, maxItems } });
      outRequired.push(name);
    } else {
      const columns = o.columns ?? {};
      const cols: Record<string, { header: string; as: "string" | "number" }> = {};
      const itemProps: Record<string, SchemaSubset> = {};
      for (const [k, c] of Object.entries(columns)) {
        const f = snake(k, "col");
        cols[f] = { header: c.header, as: c.as };
        itemProps[f] = c.as === "number" ? { type: "number" } : { type: "string", maxLength: 500 };
      }
      if (Object.keys(cols).length === 0) errors.push(`Table “${o.name}” has no columns selected.`);
      outProps[name] = { type: "array", items: { type: "object", properties: itemProps, additionalProperties: false }, maxItems: o.maxRows ?? 50 };
      extracts.push({ id: nextId(), op: "extract", into: name, source: { type: "table", locator: loc, columns: cols, maxRows: o.maxRows ?? 50 } });
      outRequired.push(name);
    }
  }
  if (Object.keys(outProps).length === 0) errors.push("Choose at least one value to return, so the result is something the assistant can use.");

  // ---- signals -> conditions ----
  const cond = (id: string, loc: Locator): NamedCondition => ({ id, condition: { kind: "exists", locator: parameterizeLocator(loc, params) } as Condition });
  const bySignal = (k: SignalKind) => spec.signals.filter((s) => s.kind === k).map((s) => cond(snake(`${k}_${s.id}`, k), s.locator));
  const postconditions = bySignal("success");
  // A check that contains a number (a result count, a date, a price) usually fails as soon as the number changes.
  for (const sig of spec.signals) {
    const text = locatorTexts(parameterizeLocator(sig.locator, params)).find((t) => /\d/.test(t));
    if (text) {
      const shown = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      warnings.push(`The check “${shown}” contains a number. If that number changes between runs (a count, a date, a price), the check fails and the tool stops. If so, mark a part of the page without it.`);
    }
  }
  if (postconditions.length === 0) errors.push("Add a success check: pick something on the page that appears only when the task worked.");
  const emptyWhen = bySignal("empty");
  const failureWhen = bySignal("error");
  const sessionExpiredWhen = bySignal("expired");
  if (kind === "write" && failureWhen.length === 0) warnings.push("No error message was picked. AnyMCP will verify by re-reading the page if the result is unclear.");

  // Read barrier: pages often fill in results asynchronously. Wait for the success indicator, then read values.
  if (postconditions[0]) steps.push({ id: nextId(), op: "waitFor", condition: postconditions[0].condition, timeoutMs: 5000 });
  steps.push(...extracts);

  const startCheck: Locator | null = firstLocator ?? (postconditions[0]?.condition.kind === "exists" ? postconditions[0].condition.locator : null);
  const preconditions: NamedCondition[] = startCheck ? [{ id: "start_page_ready", condition: { kind: "exists", locator: startCheck } }] : [];

  // ---- input schema ----
  const inProps: Record<string, SchemaSubset> = {};
  for (const p of params) inProps[p.name] = toSchemaType(p);
  const input: ObjectSchema = { type: "object", properties: inProps, required: params.map((p) => p.name), additionalProperties: false };
  const output: ObjectSchema = { type: "object", properties: outProps, ...(outRequired.length ? { required: outRequired } : {}), additionalProperties: false };

  const entry = buildEntryPath(spec.entryPath, params);
  const entryQuery = buildEntryQuery(spec.entryQuery, params, errors);

  const definition = {
    schemaVersion: 1 as const,
    id: spec.id,
    version,
    title: spec.title,
    description: spec.description,
    kind,
    origins: [spec.origin],
    entry: { path: entry, ...(entryQuery ? { query: entryQuery } : {}) },
    input,
    output,
    steps,
    preconditions,
    sessionExpiredWhen,
    postconditions,
    emptyWhen,
    ...(emptyWhen.length ? { emptyResult: {} } : {}),
    failureWhen,
    approval:
      kind === "write"
        ? { required: true, actionTemplate: spec.approvalText || defaultApprovalText(spec), stateFields, ttlSeconds: 120 }
        : { required: false, actionTemplate: "", stateFields: [], ttlSeconds: 120 },
    limits: { stepTimeoutMs: 5000, totalTimeoutMs: kind === "write" ? 45000 : 30000, maxAttempts: kind === "write" ? 1 : 2 },
    reconcile: kind === "write",
  };

  const parsed = ToolDefinitionZ.safeParse(definition);
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.push(`${i.path.join(".") || "tool"}: ${i.message}`);
    return { definition: null, errors, warnings };
  }
  for (const issue of validateToolPolicy(parsed.data)) errors.push(issue.message);
  return { definition: errors.length ? null : parsed.data, errors, warnings };
}

/** The approval sentence used when the author wrote none. Names the action and every input. */
function defaultApprovalText(spec: DraftSpec): string {
  const c = spec.steps.find((s) => s.enabled && s.effect === "commit");
  const label = c?.label ?? "the button";
  const what = c?.kind === "input"
    ? `Set “${label}” to ${c.fill.mode === "param" ? `{${c.fill.param}}` : c.fill.mode === "literal" ? `“${c.fill.text}”` : "its value"}`
    : c?.kind === "press"
      ? `Press Enter in “${label}”`
      : `Click “${label}”`;
  const inputs = spec.params.map((p) => `${p.name}={${p.name}}`).join(", ");
  return (inputs ? `${what} with ${inputs}` : what).slice(0, 300);
}

/** The fixed texts a locator looks for (names, labels, texts; inputs excluded). */
export function locatorTexts(l: Locator | LocatorLeaf): string[] {
  const leaf = l as LocatorLeaf;
  const own = leaf.by === "role" ? leaf.name : leaf.by === "label" || leaf.by === "text" ? leaf.text : leaf.by === "field" ? leaf.label : undefined;
  const mine = typeof own === "string" ? [own.replace(/\{[a-z][a-z0-9_]*\}/g, "")] : [];
  return "within" in l && l.within ? [...mine, ...locatorTexts(l.within)] : mine;
}

/** If a recorded locator was only PARTLY replaced by an input (the input's example is inside a longer text), its name. */
export function partlyParameterized(original: Locator, result: Locator, params: DraftParam[]): string | null {
  const texts = (l: Locator | LocatorLeaf): unknown[] => {
    const leaf = l as LocatorLeaf;
    const own = leaf.by === "role" ? leaf.name : leaf.by === "label" || leaf.by === "text" ? leaf.text : leaf.by === "field" ? leaf.label : undefined;
    return "within" in l && l.within ? [own, ...texts(l.within)] : [own];
  };
  const before = texts(original);
  const after = texts(result);
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    if (typeof a === "string" && a !== before[i]) {
      const m = /\{([a-z][a-z0-9_]*)\}/.exec(a);
      if (m && params.some((p) => p.name === m[1])) return m[1]!;
    }
  }
  return null;
}

/** First guess for a spec from raw recorder output. The user edits everything afterwards. */
export function paramNameFor(label: string, taken: Set<string>): string {
  return uniqueName(snake(label, "value"), taken);
}
