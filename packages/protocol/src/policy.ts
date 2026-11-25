// Policy: rules a ToolDefinition must satisfy BEFORE it can be tested or enabled,
// origin checks, and plain-language rendering derived from the structure.
//
// The review screen is rendered from `deriveReviewSummary`, never from free text,
// so what the user reads is exactly what the engine enforces.

import { isCommitStep, type Condition, type Locator, type LocatorLeaf, type Step, type TextRef, type ToolDefinition, type ValueRef } from "./tool";
import { argValue, isParamRef } from "./text";
import { looksSensitive } from "./sensitive";
import { declaredProperty, isPatternSafe, type SchemaSubset } from "./schema-subset";

export interface PolicyIssue {
  code: string;
  message: string;
  stepId?: string;
}

export { isSensitiveField, looksSensitive, type FieldDescriptor } from "./sensitive";

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function checkOrigin(tool: Pick<ToolDefinition, "origins">, url: string): { ok: true; origin: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "The tab address could not be read." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "Only http(s) pages are supported." };
  if (!tool.origins.includes(u.origin)) return { ok: false, reason: `This tool may only run on ${tool.origins.join(", ")}, not ${u.origin}.` };
  return { ok: true, origin: u.origin };
}

// ---- parameter helpers ----------------------------------------------------
const PLACEHOLDER_RE = /\{([a-z][a-z0-9_]*)\}/g;

export function templateParams(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

export function renderTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_RE, (_, name: string) => (argValue(args, name) === undefined ? `{${name}}` : String(argValue(args, name))));
}

export function renderEntryPath(path: string, args: Record<string, unknown>): string {
  return path.replace(PLACEHOLDER_RE, (_, name: string) => encodeURIComponent(String(argValue(args, name) ?? "")));
}

/** Path plus optional query of the page a run starts on. Every placeholder value is URL-encoded. */
export function renderEntry(entry: { path: string; query?: string | undefined }, args: Record<string, unknown>): string {
  const path = renderEntryPath(entry.path, args);
  return entry.query ? `${path}?${renderEntryPath(entry.query, args)}` : path;
}

/** Keys of a query template ("a=1&b={x}" -> ["a", "b"]). */
export function queryKeys(query: string): string[] {
  return query.split("&").filter(Boolean).map((pair) => {
    const raw = pair.split("=")[0] ?? "";
    try {
      return decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      return raw;
    }
  });
}

import { isCredentialQueryKey } from "./sensitive";
export { isCredentialQueryKey };

function refsOfText(t: TextRef | ValueRef | undefined, into: Set<string>) {
  if (t === undefined) return;
  if (typeof t === "string") templateParams(t).forEach((p) => into.add(p));
  else if (isParamRef(t)) into.add(t.param);
}
function refsOfLocator(l: Locator | LocatorLeaf | undefined, into: Set<string>) {
  if (!l) return;
  if (l.by === "role") refsOfText(l.name, into);
  else if (l.by === "label" || l.by === "text") refsOfText(l.text, into);
  else if (l.by === "field") refsOfText(l.label, into);
  if ("within" in l && l.within) refsOfLocator(l.within, into);
}
function refsOfCondition(c: Condition, into: Set<string>) {
  if ("locator" in c) refsOfLocator(c.locator, into);
  if ("value" in c) refsOfText(c.value, into);
}
function refsOfStep(s: Step, into: Set<string>) {
  switch (s.op) {
    case "locate": refsOfLocator(s.locator, into); break;
    case "fill": refsOfText(s.value, into); break;
    case "waitFor":
    case "assert": refsOfCondition(s.condition, into); break;
    case "extract": refsOfLocator(s.source.locator, into); break;
    default: break;
  }
}

/** Every parameter name the definition references. */
export function collectParamRefs(tool: ToolDefinition): Set<string> {
  const refs = new Set<string>();
  templateParams(tool.entry.path).forEach((p) => refs.add(p));
  if (tool.entry.query) templateParams(tool.entry.query).forEach((p) => refs.add(p));
  templateParams(tool.approval.actionTemplate).forEach((p) => refs.add(p));
  tool.steps.forEach((s) => refsOfStep(s, refs));
  for (const list of [tool.preconditions, tool.postconditions, tool.sessionExpiredWhen, tool.emptyWhen, tool.failureWhen]) {
    list.forEach((nc) => refsOfCondition(nc.condition, refs));
  }
  tool.approval.stateFields.forEach((f) => refsOfLocator(f.locator, refs));
  return refs;
}

// ---- rendering -----------------------------------------------------------
function textStr(t: TextRef | ValueRef): string {
  if (typeof t === "string") return `"${t.replace(/\{([a-z][a-z0-9_]*)\}/g, "‹$1›")}"`;
  if ("literal" in t) return `"${t.literal}"`;
  return `‹${t.param}›`;
}

export function describeLocator(l: Locator | LocatorLeaf): string {
  let base: string;
  switch (l.by) {
    case "role": base = l.name !== undefined ? `the ${l.role} named ${textStr(l.name)}` : `a ${l.role}`; break;
    case "label": base = `the field labelled ${textStr(l.text)}`; break;
    case "testid": base = `the element with test id "${l.id}"`; break;
    case "text": base = `the text ${textStr(l.text)}`; break;
    case "field": base = `the value next to the label ${textStr(l.label)}`; break;
    case "css": base = `the element matching CSS "${l.selector}" (fragile: depends on the page's layout)`; break;
  }
  if ("within" in l && l.within) base += ` inside ${describeLocator(l.within)}`;
  return base;
}

export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case "exists": return `${describeLocator(c.locator)} is on the page`;
    case "absent": return `${describeLocator(c.locator)} is not on the page`;
    case "textEquals": return `${describeLocator(c.locator)} reads ${textStr(c.value)}`;
    case "textContains": return `${describeLocator(c.locator)} contains ${textStr(c.value)}`;
    case "countAtLeast": return `there are at least ${c.n} of ${describeLocator(c.locator)}`;
    case "countEquals": return `there are exactly ${c.n} of ${describeLocator(c.locator)}`;
    case "urlPathEquals": return `the page path is ${textStr(c.value)}`;
    case "urlPathPrefix": return `the page path starts with ${textStr(c.value)}`;
  }
}

export function describeStep(s: Step): string {
  switch (s.op) {
    case "locate": return `Find ${describeLocator(s.locator)} (must match exactly one element)`;
    case "fill": return `Fill “${s.target}” with ${textStr(s.value)}${s.effect === "commit" ? " — this saves by itself and changes data on the site" : ""}`;
    case "click": return `Click “${s.target}”${s.effect === "commit" ? " — changes data on the site" : s.effect === "navigate" ? " (opens another page)" : ""}`;
    case "press": return `Press ${s.key} in “${s.target}”${s.effect === "commit" ? " — changes data on the site" : s.effect === "navigate" ? " (opens another page)" : ""}`;
    case "waitFor": return `Wait until ${describeCondition(s.condition)}`;
    case "assert": return `Check that ${describeCondition(s.condition)}`;
    case "extract":
      if (s.source.type === "text") return `Read the ${s.source.as === "link" ? "text and link address" : "text"} of ${describeLocator(s.source.locator)} into “${s.into}”${s.source.optional ? " (optional)" : ""}`;
      if (s.source.type === "count") return `Count ${describeLocator(s.source.locator)} into “${s.into}”`;
      if (s.source.type === "list") return `Read the ${s.source.as === "link" ? "text and link address" : "text"} of every match of ${describeLocator(s.source.locator)} (up to ${s.source.maxItems}) into “${s.into}”`;
      return `Read up to ${s.source.maxRows} rows of ${describeLocator(s.source.locator)} into “${s.into}”`;
  }
}

// ---- policy validation ----------------------------------------------------
export function validateToolPolicy(tool: ToolDefinition): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const err = (code: string, message: string, stepId?: string) => issues.push({ code, message, ...(stepId ? { stepId } : {}) });

  // origins
  for (const o of tool.origins) {
    const u = new URL(o);
    if (u.protocol === "http:" && !isLoopbackHost(u.hostname)) err("origin_insecure", `${o} uses http. Only https (or localhost) origins are allowed.`);
    if (u.hostname.includes("*")) err("origin_wildcard", "Wildcard origins are not allowed.");
  }

  // start page: a saved query string must never carry credentials
  if (tool.entry.query) {
    for (const key of queryKeys(tool.entry.query)) {
      if (isCredentialQueryKey(key)) err("entry_query_sensitive", `The start address contains “${key}”, which looks like a sign-in or security value. Remove it: AnyMCP uses your normal signed-in session instead.`);
    }
  }

  // steps: unique ids, bindings declared before use
  const ids = new Set<string>();
  const bindings = new Set<string>();
  const locatorByBinding = new Map<string, Locator>();
  let commitCount = 0;
  for (const s of tool.steps) {
    if (ids.has(s.id)) err("duplicate_step_id", `Step id "${s.id}" is used twice.`, s.id);
    ids.add(s.id);
    const uses = (name: string) => {
      if (!bindings.has(name)) err("unbound_target", `Step "${s.id}" uses “${name}”, which is not located by an earlier step.`, s.id);
    };
    if (s.op === "locate") {
      if (bindings.has(s.as)) err("duplicate_binding", `“${s.as}” is located twice.`, s.id);
      bindings.add(s.as);
      locatorByBinding.set(s.as, s.locator);
      if (s.locator.by === "role" && s.locator.name === undefined && s.locator.within === undefined) {
        err("locator_too_broad", `Step "${s.id}": a role-only locator with no name or container is too broad.`, s.id);
      }
    }
    if (s.op === "fill") {
      uses(s.target);
      if (looksSensitive(s.target)) err("sensitive_target", `Step "${s.id}": filling a field named “${s.target}” is not allowed.`, s.id);
      const located = locatorByBinding.get(s.target);
      if (located && locatorLooksSensitive(located)) err("sensitive_target", `Step "${s.id}": the field it fills looks like a password or payment field.`, s.id);
      if ("literal" in s.value && looksSensitive(s.value.literal)) err("sensitive_literal", `Step "${s.id}": the typed value looks like a secret.`, s.id);
    }
    if (s.op === "click" || s.op === "press") uses(s.target);
    if (isCommitStep(s)) {
      commitCount++;
      if (tool.kind !== "write") err("commit_in_read_tool", `Step "${s.id}" changes data, but the tool is marked read-only.`, s.id);
    }
    if (s.op === "extract") {
      const declared = declaredProperty(tool.output, s.into);
      const wantsArray = s.source.type === "table" || s.source.type === "list";
      if (declared && wantsArray !== (declared.type === "array")) {
        err("output_shape_mismatch", `Step "${s.id}": “${s.into}” is ${wantsArray ? "a list of values" : "a single value"}, but the output schema says otherwise.`, s.id);
      }
      if (!declared) err("unknown_output", `Step "${s.id}" extracts into “${s.into}”, which is not in the output schema.`, s.id);
      if (s.source.type === "text" && s.source.optional && tool.output.required?.includes(s.into)) {
        err("optional_required_output", `Step "${s.id}": “${s.into}” is a required output, so it cannot be optional.`, s.id);
      }
    }
  }

  // site-declared terminal states
  if (tool.emptyWhen.length > 0) {
    if (tool.kind !== "read") err("empty_read_only", "Only read tools can declare a valid empty result.");
    if (!tool.emptyResult) err("empty_needs_result", "An empty-result condition needs a constant empty result.");
  }
  for (const [label, consts] of [["Empty", tool.emptyResult], ["Success", tool.successResult]] as const) {
    if (!consts) continue;
    for (const [k, v] of Object.entries(consts)) {
      const sub = declaredProperty(tool.output, k);
      if (!sub) {
        err("const_unknown_field", `${label} result field “${k}” is not in the output schema.`);
        continue;
      }
      const typeOk =
        (sub.type === "string" && typeof v === "string") ||
        ((sub.type === "number" || sub.type === "integer") && typeof v === "number") ||
        (sub.type === "boolean" && typeof v === "boolean") ||
        (sub.type === "array" && Array.isArray(v)) ||
        (sub.type === "object" && !!v && typeof v === "object" && !Array.isArray(v));
      if (!typeOk) err("const_bad_type", `${label} result field “${k}” has the wrong type.`);
    }
  }

  // After the consequential click only read-only steps are allowed, so a read-back (reconcile) can never repeat the write.
  const commitIndex = tool.steps.findIndex(isCommitStep);
  if (commitIndex >= 0) {
    for (const s of tool.steps.slice(commitIndex + 1)) {
      if (s.op === "fill" || s.op === "click" || s.op === "press") err("post_commit_not_read_only", `“${describeStep(s)}” comes after the step that changes data. Nothing may be typed or clicked after that step — move the data-changing click to be last.`, s.id);
    }
  }

  if (tool.kind === "write") {
    if (commitCount !== 1) err("write_needs_one_commit", "A write tool must have exactly one step that changes data.");
    if (!tool.approval.required) err("write_needs_approval", "Write tools must require approval for every execution.");
    if (tool.approval.stateFields.length < 1) err("approval_needs_state", "Approval must be bound to at least one page value the user can see.");
    if (!tool.approval.actionTemplate.trim()) err("approval_needs_text", "Approval needs an action description.");
    if (tool.limits.maxAttempts !== 1) err("write_no_retry", "Write tools may not be retried automatically (maxAttempts must be 1).");
    if (tool.failureWhen.length < 1 && !tool.reconcile) err("write_needs_failure_signal", "Write tools need a way to detect rejection or a reconcile read-back.");
  } else {
    if (tool.reconcile) err("reconcile_write_only", "Reconcile applies only to write tools.");
    if (tool.approval.required) err("read_no_approval", "Read-only tools do not use per-run approval.");
  }

  // verification is mandatory
  if (tool.preconditions.length < 1) err("needs_precondition", "Every tool needs at least one precondition.");
  if (tool.postconditions.length < 1) err("needs_postcondition", "Every tool needs at least one observable postcondition.");

  // parameters
  const props = tool.input.properties;
  const refs = collectParamRefs(tool);
  for (const r of refs) if (!declaredProperty(tool.input, r)) err("unknown_param", `“${r}” is used but is not an input parameter.`);
  for (const [name, schema] of Object.entries(props)) {
    if (!refs.has(name)) err("unused_param", `Input “${name}” is never used by the workflow.`);
    checkSchemaPatterns(schema, name, err);
  }
  for (const p of templateParams(tool.entry.path)) {
    const s = declaredProperty(tool.input, p);
    if (s && !(s.type === "string" && (s.pattern || s.enum))) {
      err("path_param_unconstrained", `“${p}” is placed in the start path, so it must be a string with a pattern or fixed list of values.`);
    }
  }
  for (const [name, schema] of Object.entries(props)) {
    if (schema.type === "string" && schema.maxLength === undefined) err("input_unbounded", `Input “${name}” needs a maximum length.`);
  }
  for (const key of tool.input.required ?? []) if (!declaredProperty(tool.input, key)) err("bad_required", `Required input “${key}” is not defined.`);
  for (const key of tool.output.required ?? []) {
    if (!declaredProperty(tool.output, key)) err("bad_required_output", `Required output “${key}” is not defined.`);
    // A required output must be PRODUCED on the success path. (The empty result is a different path.)
    const extracted = tool.steps.some((s) => s.op === "extract" && s.into === key);
    const constant = !!tool.successResult && Object.hasOwn(tool.successResult, key); // own keys only: not "constructor"
    if (!extracted && !constant) err("output_not_extracted", `Required output “${key}” is never produced on a successful run (extract it or give it a fixed success value).`);
  }

  const conds = [...tool.preconditions, ...tool.postconditions, ...tool.sessionExpiredWhen, ...tool.emptyWhen, ...tool.failureWhen];
  const condIds = new Set<string>();
  for (const c of conds) {
    if (condIds.has(c.id)) err("duplicate_condition_id", `Condition id “${c.id}” is used twice.`);
    condIds.add(c.id);
  }
  if (tool.limits.totalTimeoutMs < tool.limits.stepTimeoutMs) err("bad_timeouts", "Total timeout must not be shorter than the step timeout.");
  return issues;
}

function locatorLooksSensitive(l: Locator | LocatorLeaf): boolean {
  const texts: (string | undefined)[] = [];
  if (l.by === "role") texts.push(typeof l.name === "string" ? l.name : undefined);
  else if (l.by === "label" || l.by === "text") texts.push(typeof l.text === "string" ? l.text : undefined);
  else if (l.by === "testid") texts.push(l.id);
  else if (l.by === "field") texts.push(typeof l.label === "string" ? l.label : undefined);
  else if (l.by === "css") texts.push(l.selector);
  return texts.some((t) => looksSensitive(t));
}

function checkSchemaPatterns(s: SchemaSubset, name: string, err: (c: string, m: string) => void) {
  if (s.type === "string" && s.pattern && !isPatternSafe(s.pattern)) err("unsafe_pattern", `Input “${name}” has a pattern that is not allowed.`);
  if (s.type === "object") for (const [k, v] of Object.entries(s.properties)) checkSchemaPatterns(v, `${name}.${k}`, err);
  if (s.type === "array") checkSchemaPatterns(s.items, name, err);
}

// ---- review summary (derived, never free text) ---------------------------------
export interface ReviewSummary {
  title: string;
  /** Author-written purpose. Shown, but labelled as the author's words. */
  authorDescription: string;
  runsOn: string[];
  startsAt: string;
  inputs: { name: string; type: string; required: boolean; constraint?: string }[];
  reads: { field: string; from: string }[];
  changes: { level: "none" | "ui_only" | "commit"; headline: string; lines: string[] };
  approval: { required: boolean; headline: string; detail: string };
  verification: { before: string[]; after: string[]; siteFailure: string[]; emptyResult: string[]; sessionExpired: string[] };
  /** Number of places that rely on a CSS selector (may break when the site's markup changes). */
  fragile: number;
  guarantees: string[];
}

function constraintOf(s: SchemaSubset): string | undefined {
  if (s.type === "string") {
    const parts: string[] = [];
    if (s.pattern) parts.push(`format ${s.pattern}`);
    if (s.enum) parts.push(`one of ${s.enum.join(", ")}`);
    if (s.maxLength) parts.push(`max ${s.maxLength} characters`);
    return parts.join(", ") || undefined;
  }
  return undefined;
}

export function deriveReviewSummary(tool: ToolDefinition): ReviewSummary {
  const reads: ReviewSummary["reads"] = [];
  const uiLines: string[] = [];
  let commitLine: string | undefined;
  const locatorOf = new Map<string, Locator>();
  for (const s of tool.steps) {
    if (s.op === "locate") locatorOf.set(s.as, s.locator);
    if (s.op === "extract") {
      const from =
        s.source.type === "text"
          ? describeLocator(s.source.locator)
          : s.source.type === "count"
            ? `count of ${describeLocator(s.source.locator)}`
            : s.source.type === "list"
              ? `every match of ${describeLocator(s.source.locator)}`
              : `rows of ${describeLocator(s.source.locator)}`;
      // the engine enforces this (content/engine.ts armChange), so the review may say it
      reads.push({ field: s.into, from: s.source.fresh ? `${from}, once the page shows the result of the action before it (never what was shown before)` : from });
    }
    if (s.op === "fill" && s.effect === "commit") commitLine = `Sets ${describeLocatorOf(s.target, locatorOf)}, which saves by itself — this CHANGES data on the website`;
    else if (s.op === "fill") uiLines.push(`Fills in ${describeLocatorOf(s.target, locatorOf)} (types text, or sets a dropdown, checkbox or option)`);
    if (s.op === "press" && s.effect === "commit") commitLine = `Presses ${s.key} in ${describeLocatorOf(s.target, locatorOf)} — this CHANGES data on the website`;
    else if (s.op === "press") uiLines.push(`Presses ${s.key} in ${describeLocatorOf(s.target, locatorOf)} (to search or move on, not to save)`);
    if (s.op === "click" && s.effect === "commit") commitLine = `Clicks ${describeLocatorOf(s.target, locatorOf)} — this CHANGES data on the website`;
  }
  const level: ReviewSummary["changes"]["level"] = commitLine ? "commit" : uiLines.length ? "ui_only" : "none";
  const lines = [...uiLines, ...(commitLine ? [commitLine] : [])];
  return {
    title: tool.title,
    authorDescription: tool.description,
    runsOn: tool.origins,
    startsAt: tool.entry.query ? `${tool.entry.path}?${tool.entry.query}` : tool.entry.path,
    inputs: Object.entries(tool.input.properties).map(([name, s]) => {
      const constraint = constraintOf(s);
      return { name, type: s.type, required: !!tool.input.required?.includes(name), ...(constraint ? { constraint } : {}) };
    }),
    reads,
    changes: {
      level,
      headline:
        level === "commit"
          ? "Changes data on the website (after your approval)"
          : level === "ui_only"
            ? "Only fills in page fields and moves around. Nothing it does is marked as changing data."
            : "Changes nothing on the website",
      lines,
    },
    approval: tool.approval.required
      ? {
          required: true,
          headline: "Asks you to approve every run",
          detail: `Before the change you see: “${tool.approval.actionTemplate}” plus ${tool.approval.stateFields.map((f) => f.label).join(", ") || "no page values"}. Approval applies to that one run only.`,
        }
      : { required: false, headline: "Runs without a prompt", detail: "Read-only tools run as soon as the AI assistant calls them. You can still stop any run." },
    verification: {
      before: tool.preconditions.map((c) => describeCondition(c.condition)),
      after: tool.postconditions.map((c) => describeCondition(c.condition)),
      siteFailure: tool.failureWhen.map((c) => describeCondition(c.condition)),
      emptyResult: tool.emptyWhen.map((c) => describeCondition(c.condition)),
      sessionExpired: tool.sessionExpiredWhen.map((c) => describeCondition(c.condition)),
    },
    fragile: collectLocators(tool).filter((l) => l.by === "css").length,
    guarantees: [
      "Stops (does not guess) if an element is missing or matches more than one place.",
      "Only runs on the origins listed above.",
      "Never reads password or payment fields.",
      "Page text is treated as data, never as instructions.",
    ],
  };
}

function collectLocators(tool: ToolDefinition): (Locator | LocatorLeaf)[] {
  const out: (Locator | LocatorLeaf)[] = [];
  const add = (l?: Locator | LocatorLeaf) => {
    if (!l) return;
    out.push(l);
    if ("within" in l && l.within) out.push(l.within);
  };
  for (const s of tool.steps) {
    if (s.op === "locate") add(s.locator);
    if (s.op === "extract") add(s.source.locator);
    if ((s.op === "waitFor" || s.op === "assert") && "locator" in s.condition) add(s.condition.locator);
  }
  // NOTE: keep this list in sync with collectParamRefs when a new place for locators is added.
  for (const list of [tool.preconditions, tool.postconditions, tool.sessionExpiredWhen, tool.emptyWhen, tool.failureWhen]) {
    for (const c of list) if ("locator" in c.condition) add(c.condition.locator);
  }
  tool.approval.stateFields.forEach((f) => add(f.locator));
  return out;
}

function describeLocatorOf(binding: string, map: Map<string, Locator>): string {
  const l = map.get(binding);
  return l ? describeLocator(l) : `“${binding}”`;
}
