// Replay engine primitives (content script). The service worker drives it one step at a time.
//
// Hard rules, enforced here regardless of what the tool definition says:
//  - a located element must be exactly one: 0 -> locator_missing, >1 -> locator_ambiguous. No guessing.
//  - bindings are per-document; after navigation they are gone and must be re-located (no silent re-find)
//  - never fill, read or click password/payment/secret fields
//  - never click something that leaves the tool's allowed origins
//  - the consequential click only happens through `commit`, which re-checks the approved binding first

import { isCredentialQueryKey, isSensitiveField, resolveText, type FieldDescriptor } from "anymcp-protocol/light";
import type { Condition, ExtractSource, Locator, NamedCondition, ReasonCode, Step, ValueRef } from "anymcp-protocol";
import { PRIVATE_AREA, accessibleName, composedClosest, isEditableRoot, computeRole, deepQueryAll, fingerprintElement, isVisible, norm, resolveLocator, visibleText, type Args } from "./locator";

export interface Watch {
  sessionExpired: NamedCondition[];
  failure: NamedCondition[];
  empty: NamedCondition[];
}
export const NO_WATCH: Watch = { sessionExpired: [], failure: [], empty: [] };

export type Terminal = "session_expired" | "failure" | "empty";
export type StepResult =
  | { ok: true; value?: unknown; matches?: number; /** a fill that would change nothing: the field already holds the value */ noop?: true }
  | {
      ok: false;
      code: ReasonCode;
      detail: string;
      terminal?: Terminal;
      conditionId?: string;
      matches?: number;
      /** The page may already have been changed (the control was clicked or set, then something went wrong). */
      acted?: true;
    };

/** What the one consequential step does once approved. */
export type CommitAction = { type: "click" } | { type: "press"; key: "Enter" } | { type: "fill"; value: ValueRef };

export interface RunContext {
  runId: string;
  args: Args;
  origins: string[];
  bindings: Map<string, Element>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- descriptors / safety ---------------------------------------------------
export function fieldDescriptor(el: Element): FieldDescriptor {
  const input = el as HTMLInputElement;
  const labels = [...(input.labels ?? [])].map((l) => norm(l.textContent)).join(" ");
  return {
    type: input.type ?? null,
    autocomplete: el.getAttribute("autocomplete"),
    name: el.getAttribute("name"),
    id: el.id || null,
    label: labels || null,
    ariaLabel: el.getAttribute("aria-label"),
    placeholder: el.getAttribute("placeholder") ?? el.getAttribute("aria-placeholder") ?? el.getAttribute("data-placeholder"),
    anymcpIgnore: !!composedClosest(el, PRIVATE_AREA),
  };
}

function isFormField(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function readText(el: Element): string | { blocked: string } {
  if (isEditableRoot(el) && isSensitiveField(fieldDescriptor(el))) return { blocked: "That text box looks like a password or payment field, so AnyMCP will not read it." };
  if (isFormField(el)) {
    if (isSensitiveField(fieldDescriptor(el))) return { blocked: "That field looks like a password or payment field, so AnyMCP will not read it." };
    return norm(el.value);
  }
  if (composedClosest(el, PRIVATE_AREA)) return { blocked: "That part of the page is marked as private." };
  return visibleText(el);
}

/** The link an element is, contains exactly once, or sits inside. */
export function linkOf(el: Element): HTMLAnchorElement | HTMLAreaElement | null {
  if ((el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) && el.hasAttribute("href")) return el;
  const inner = deepQueryAll(el, "a[href],area[href]");
  if (inner.length === 1) return inner[0] as HTMLAnchorElement;
  return composedClosest(el, "a[href]") as HTMLAnchorElement | null;
}

/**
 * The element's text and its link's absolute address. Only http(s) links; user names, passwords and query
 * parameters that look like credentials (session ids, tokens) are removed before the address leaves the page.
 */
export function readLink(el: Element): { text: string; url: string } | { blocked: string } | null {
  const text = readText(el);
  if (typeof text !== "string") return text;
  const a = linkOf(el);
  if (!a) return null;
  let u: URL;
  try {
    u = new URL(a.getAttribute("href") ?? "", location.href);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.username = "";
  u.password = "";
  for (const key of [...new Set(u.searchParams.keys())]) if (isCredentialQueryKey(key)) u.searchParams.delete(key);
  return { text, url: u.href };
}

function sameOriginHref(href: string, origins: string[]): boolean {
  try {
    return origins.includes(new URL(href, location.href).origin);
  } catch {
    return false;
  }
}

/** Returns an error string if AnyMCP must refuse to click this element. */
export function clickRefusal(el: Element, origins: string[]): string | null {
  const role = computeRole(el);
  const allowedRoles = new Set(["button", "link", "tab", "option", "menuitem", "combobox"]);
  const tag = el.tagName.toLowerCase();
  const explicitRole = norm(el.getAttribute("role")).split(" ")[0] ?? "";
  const isControl =
    tag === "button" || tag === "a" || tag === "summary" ||
    (tag === "input" && ["submit", "button", "reset", "image"].includes((el as HTMLInputElement).type)) ||
    ["menuitemradio", "menuitemcheckbox"].includes(explicitRole) ||
    (el.hasAttribute("aria-haspopup") && el.getAttribute("aria-haspopup") !== "false");
  if (!isControl && !(role && allowedRoles.has(role))) return "Only buttons, links, tabs and menu choices can be clicked.";
  if (isFormField(el) && el instanceof HTMLInputElement && isSensitiveField(fieldDescriptor(el))) return "That control looks sensitive.";
  if (el instanceof HTMLAnchorElement && !sameOriginHref(el.href, origins)) return "That link leaves the allowed website.";
  const form = (el as HTMLButtonElement | HTMLInputElement).form;
  if (form && (tag === "button" || tag === "input") && (el as HTMLButtonElement).type !== "button" && form.getAttribute("action") && !sameOriginHref(form.action, origins)) {
    return "That form would send data to a different website.";
  }
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return "That control is disabled.";
  return null;
}

// ---- conditions -------------------------------------------------------------
export function evalCondition(c: Condition, args: Args): { passed: boolean; detail: string } {
  switch (c.kind) {
    case "urlPathEquals":
    case "urlPathPrefix": {
      const want = resolveText(c.value, args);
      if (want === undefined) return { passed: false, detail: "a needed parameter is missing" };
      const path = location.pathname;
      const ok = c.kind === "urlPathEquals" ? path === want : path.startsWith(want);
      return { passed: ok, detail: ok ? "path matches" : "path does not match" };
    }
    default:
      break;
  }
  const r = resolveLocator(c.locator, args);
  if (r.problem) return { passed: false, detail: r.problem.replace(/_/g, " ") };
  const n = r.elements.length;
  switch (c.kind) {
    case "exists": return { passed: n >= 1, detail: `matches=${n}` };
    case "absent": return { passed: n === 0, detail: `matches=${n}` };
    case "countAtLeast": return { passed: n >= c.n, detail: `matches=${n}` };
    case "countEquals": return { passed: n === c.n, detail: `matches=${n}` };
    case "textEquals":
    case "textContains": {
      if (n !== 1) return { passed: false, detail: `matches=${n}` };
      const want = resolveText(c.value, args);
      if (want === undefined) return { passed: false, detail: "a needed parameter is missing" };
      const got = readText(r.elements[0]!);
      if (typeof got !== "string") return { passed: false, detail: "blocked" };
      const ok = c.kind === "textEquals" ? got === norm(want) : got.includes(norm(want));
      return { passed: ok, detail: ok ? "text matches" : "text does not match" };
    }
  }
}

export function evalConditions(list: NamedCondition[], args: Args) {
  return list.map((nc) => ({ id: nc.id, ...evalCondition(nc.condition, args) }));
}

/** Site-declared terminal states, checked in a fixed precedence while we wait. */
export function terminalNow(watch: Watch, args: Args): { terminal: Terminal; id: string } | null {
  for (const [kind, list] of [["session_expired", watch.sessionExpired], ["failure", watch.failure], ["empty", watch.empty]] as const) {
    for (const nc of list) if (evalCondition(nc.condition, args).passed) return { terminal: kind, id: nc.id };
  }
  return null;
}

async function pollUntil<T>(fn: () => T | undefined, timeoutMs: number, intervalMs = 100): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}

function terminalFailure(t: { terminal: Terminal; id: string }): StepResult {
  return {
    ok: false,
    terminal: t.terminal,
    conditionId: t.id,
    code: t.terminal === "session_expired" ? "session_expired" : t.terminal === "failure" ? "site_error" : "no_results",
    detail: `The page reported: ${t.id}`,
  };
}

// ---- steps ------------------------------------------------------------------
function problemCode(problem: string): ReasonCode {
  return problem === "within_ambiguous" ? "locator_ambiguous" : "locator_missing";
}

async function doLocate(ctx: RunContext, step: Extract<Step, { op: "locate" }>, watch: Watch, timeoutMs: number): Promise<StepResult> {
  let ambiguousStreak = 0;
  let last: { n: number; problem?: string } = { n: 0 };
  const hit = await pollUntil<StepResult>(() => {
    const t = terminalNow(watch, ctx.args);
    const r = resolveLocator(step.locator, ctx.args);
    last = { n: r.elements.length, problem: r.problem };
    if (r.problem === "param_missing") return { ok: false, code: "schema_violation", detail: "A needed parameter was not supplied." };
    if (r.elements.length === 1) {
      ctx.bindings.set(step.as, r.elements[0]!);
      return { ok: true, matches: 1 };
    }
    if (r.elements.length > 1) {
      if (++ambiguousStreak >= 3) return { ok: false, code: "locator_ambiguous", detail: `${r.elements.length} elements match; AnyMCP will not guess.`, matches: r.elements.length };
    } else ambiguousStreak = 0;
    if (t) return terminalFailure(t);
    return undefined;
  }, timeoutMs);
  if (hit) return hit;
  return { ok: false, code: last.problem ? problemCode(last.problem) : "locator_missing", detail: last.problem ? last.problem.replace(/_/g, " ") : "No matching element was found.", matches: last.n };
}

function bound(ctx: RunContext, name: string): { el: Element } | { fail: StepResult } {
  const el = ctx.bindings.get(name);
  if (!el) return { fail: { ok: false, code: "stale_element", detail: `“${name}” was not located in this page.` } };
  if (!el.isConnected) return { fail: { ok: false, code: "stale_element", detail: `“${name}” is no longer on the page. The page changed.` } };
  return { el };
}

/** A two-state control AnyMCP can set: a native checkbox/radio, or an ARIA checkbox/switch/radio. */
export function toggleKind(el: Element): "checkbox" | "radio" | null {
  if (el instanceof HTMLInputElement) return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : null;
  const role = computeRole(el);
  return role === "checkbox" || role === "switch" ? "checkbox" : role === "radio" ? "radio" : null;
}

export function isChecked(el: Element): boolean {
  return el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true";
}

const isDisabled = (el: Element) => (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true";

/** The text a person sees for one choice of a dropdown. */
export function optionLabel(o: HTMLOptionElement): string {
  return norm(o.label || o.textContent);
}

function fillSelect(el: HTMLSelectElement, value: string): StepResult {
  if (el.disabled) return { ok: false, code: "precondition_unmet", detail: "That dropdown cannot be changed." };
  if (el.multiple) return { ok: false, code: "precondition_unmet", detail: "Lists that allow several choices at once are not supported." };
  const options = [...el.options];
  // by what the person sees first; the option's internal value is only a fallback
  let hits = options.filter((o) => optionLabel(o) === norm(value));
  if (hits.length === 0) hits = options.filter((o) => o.value === value);
  if (hits.length === 0) return { ok: false, code: "precondition_unmet", detail: "The requested choice is not in that dropdown." };
  if (new Set(hits.map((o) => o.value)).size > 1) return { ok: false, code: "locator_ambiguous", detail: `${hits.length} choices in that dropdown have the same name; AnyMCP will not guess.`, matches: hits.length };
  const option = hits[0]!;
  if (option.disabled) return { ok: false, code: "precondition_unmet", detail: "That choice is disabled." };
  if (el.selectedIndex !== option.index) {
    el.scrollIntoView({ block: "center" });
    el.focus();
    el.selectedIndex = option.index;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (el.selectedIndex !== option.index) return { ok: false, code: "precondition_unmet", detail: "The dropdown did not keep the choice (the site may have changed it).", acted: true };
  return { ok: true };
}

async function fillToggle(el: Element, kind: "checkbox" | "radio", value: string): Promise<StepResult> {
  const want = value === "true" ? true : value === "false" ? false : null;
  if (want === null) return { ok: false, code: "schema_violation", detail: "A checkbox or option needs the value true or false." };
  if (kind === "radio" && !want) return { ok: false, code: "precondition_unmet", detail: "An option in a group can only be chosen, not cleared. Choose a different option instead." };
  if (isChecked(el) === want) return { ok: true }; // already in the requested state: setting is idempotent, never a blind toggle
  if (isDisabled(el)) return { ok: false, code: "precondition_unmet", detail: "That control is disabled." };
  (el as HTMLElement).scrollIntoView({ block: "center" });
  (el as HTMLElement).click();
  // custom (ARIA) controls may update their state a moment after the click
  const settled = await pollUntil(() => (isChecked(el) === want ? true : undefined), 1000, 50);
  if (!settled) return { ok: false, code: "precondition_unmet", detail: "The control did not change state (the site may have blocked it).", acted: true };
  return { ok: true };
}

const NOT_TEXT_INPUT = new Set(["button", "submit", "reset", "image", "file", "hidden", "checkbox", "radio"]);

/** Returns an error string if AnyMCP must refuse to fill this element. */
export function fillRefusal(el: Element): string | null {
  if ((isFormField(el) || isEditableRoot(el)) && isSensitiveField(fieldDescriptor(el))) return "That field looks like a password or payment field, so AnyMCP will not fill it.";
  if (composedClosest(el, PRIVATE_AREA)) return "That part of the page is marked as private.";
  return null;
}

async function doFill(ctx: RunContext, step: Extract<Step, { op: "fill" }>): Promise<StepResult> {
  if (step.effect === "commit") return { ok: false, code: "internal_error", detail: "A fill that changes data must go through the approval path." };
  const b = bound(ctx, step.target);
  if ("fail" in b) return b.fail;
  const refusal = fillRefusal(b.el);
  if (refusal) return { ok: false, code: "sensitive_field", detail: refusal };
  const value = resolveText(step.value, ctx.args);
  if (value === undefined) return { ok: false, code: "schema_violation", detail: "A needed parameter was not supplied." };
  return fillElement(b.el, value);
}

/** Set a text box, dropdown, checkbox or option. A failure says whether the page may already have changed. */
/**
 * Replace the text of a rich text box through the browser's own text insertion, so the site's editor receives the
 * same beforeinput/input events as typing (editors that keep their own model ignore direct DOM changes). Verified by
 * reading the box back.
 */
async function fillEditable(el: HTMLElement, value: string): Promise<StepResult> {
  if (el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-readonly") === "true") return { ok: false, code: "precondition_unmet", detail: "That text box cannot be edited." };
  el.scrollIntoView({ block: "center" });
  el.focus();
  const doc = el.ownerDocument;
  const sel = doc.getSelection();
  if (sel) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // 1. Offer the change to the site's editor first, as typing does. Editors that keep their own model (Lexical, Slate
  //    and others) apply `beforeinput` themselves and cancel it. execCommand alone would NOT reach them: Chrome does not
  //    fire beforeinput for it, so the text would appear on screen while the editor's model stayed empty.
  const inputType = value === "" ? "deleteContentBackward" : "insertText";
  const offered = new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType, data: value === "" ? null : value });
  const handledByEditor = !el.dispatchEvent(offered);
  // 2. Nobody handled it: perform the browser's default action (it also fires `input` for simpler editors).
  if (!handledByEditor) {
    // execCommand is deprecated, but it is still the one way to insert text with the browser's own editing behaviour
    const inserted = value === "" ? doc.execCommand("delete", false) : doc.execCommand("insertText", false, value);
    if (!inserted) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data: value === "" ? null : value }));
    }
  }
  const kept = await pollUntil(() => (norm(el.innerText) === norm(value) ? true : undefined), 1000, 50);
  if (!kept) return { ok: false, code: "precondition_unmet", detail: "The text box did not keep the text (the site's editor may have changed it).", acted: true };
  return { ok: true };
}

async function fillElement(el: Element, value: string): Promise<StepResult> {
  if (isEditableRoot(el)) return fillEditable(el, value);
  if (el instanceof HTMLSelectElement) return fillSelect(el, value);
  const toggle = toggleKind(el);
  if (toggle) return fillToggle(el, toggle, value);

  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || (el instanceof HTMLInputElement && NOT_TEXT_INPUT.has(el.type))) {
    return { ok: false, code: "precondition_unmet", detail: "Only text boxes, dropdowns, checkboxes and option buttons can be filled." };
  }
  if (el.readOnly || el.disabled) return { ok: false, code: "precondition_unmet", detail: "That field cannot be edited." };
  el.scrollIntoView({ block: "center" });
  el.focus();
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (el.value !== value) return { ok: false, code: "precondition_unmet", detail: "The field did not accept the value (the site may have changed it).", acted: true };
  return { ok: true };
}

// ---- keys -------------------------------------------------------------------
/** Input types for which, with no submit button, more than one of them in a form stops Enter from submitting. */
const BLOCKS_IMPLICIT_SUBMISSION = new Set(["text", "search", "url", "tel", "email", "password", "date", "month", "week", "time", "datetime-local", "number"]);

/** The button the browser would "click" when Enter is pressed in a field of this form (its default button). */
export function defaultButton(form: HTMLFormElement): HTMLElement | null {
  for (const c of form.elements) {
    if (c instanceof HTMLButtonElement && c.type === "submit") return c;
    if (c instanceof HTMLInputElement && (c.type === "submit" || c.type === "image")) return c;
  }
  return null;
}

/** Returns an error string if AnyMCP must refuse to press a key in this element. */
export function pressRefusal(el: Element, origins: string[]): string | null {
  const editable = isEditableRoot(el);
  if (!editable && (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || (el instanceof HTMLInputElement && NOT_TEXT_INPUT.has(el.type)))) return "Keys can only be pressed in a text box.";
  const refusal = fillRefusal(el);
  if (refusal) return refusal;
  if (editable) return el.getAttribute("aria-disabled") === "true" ? "That text box is disabled." : null; // no form: the page handles Enter itself
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  if (field.disabled) return "That field is disabled.";
  const form = field.form;
  if (form) {
    const def = defaultButton(form);
    if (def) {
      const r = clickRefusal(def, origins);
      if (r && r.includes("website")) return r; // a disabled default button simply means "Enter does nothing", like in the browser
    } else if (form.getAttribute("action") && !sameOriginHref(form.action, origins)) return "That form would send data to a different website.";
  }
  return null;
}

/**
 * Press Enter in a field. Synthetic key events never trigger the browser's own "Enter submits the form", so after
 * the key events AnyMCP does exactly what the browser would have done: click the form's default button, or submit a
 * form that has no button and at most one text field. Nothing happens if the page cancelled the key.
 */
function pressEnter(el: HTMLElement): StepResult {
  el.scrollIntoView({ block: "center" });
  el.focus();
  const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true } as KeyboardEventInit;
  let proceed = el.dispatchEvent(new KeyboardEvent("keydown", init));
  if (proceed) proceed = el.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: 13 } as KeyboardEventInit));
  if (proceed && el instanceof HTMLInputElement && el.form) {
    const form = el.form;
    const def = defaultButton(form);
    if (def) {
      if (!(def as HTMLButtonElement).disabled) def.click();
    } else if ([...form.elements].filter((c) => c instanceof HTMLInputElement && BLOCKS_IMPLICIT_SUBMISSION.has(c.type)).length <= 1) {
      form.requestSubmit();
    }
  }
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return { ok: true };
}

function doPress(ctx: RunContext, step: Extract<Step, { op: "press" }>): StepResult {
  if (step.effect === "commit") return { ok: false, code: "internal_error", detail: "A key press that changes data must go through the approval path." };
  const b = bound(ctx, step.target);
  if ("fail" in b) return b.fail;
  const refusal = pressRefusal(b.el, ctx.origins);
  if (refusal) return { ok: false, code: refusal.includes("website") ? "wrong_origin" : "precondition_unmet", detail: refusal };
  return pressEnter(b.el as HTMLElement);
}

/** Plain click for ui/navigate effects. Commit clicks go through `commit` only. */
function doClick(ctx: RunContext, step: Extract<Step, { op: "click" }>): StepResult {
  if (step.effect === "commit") return { ok: false, code: "internal_error", detail: "Commit clicks must go through the approval path." };
  const b = bound(ctx, step.target);
  if ("fail" in b) return b.fail;
  const refusal = clickRefusal(b.el, ctx.origins);
  if (refusal) return { ok: false, code: refusal.includes("leaves") || refusal.includes("different website") ? "wrong_origin" : "precondition_unmet", detail: refusal };
  (b.el as HTMLElement).scrollIntoView({ block: "center" });
  (b.el as HTMLElement).click();
  return { ok: true };
}

async function doWaitFor(ctx: RunContext, step: Extract<Step, { op: "waitFor" }>, watch: Watch, timeoutMs: number): Promise<StepResult> {
  let lastDetail = "";
  // A site-declared "nothing found" or "signed out" page wins over a generic page-ready check: a search page often
  // shows the same heading with and without results. (A site-declared FAILURE does not jump ahead: after a change
  // was made, "the site said no" must not override a visible success, or it could wrongly claim nothing happened.)
  const decisive: Watch = { sessionExpired: watch.sessionExpired, failure: [], empty: watch.empty };
  const hit = await pollUntil<StepResult>(() => {
    const early = terminalNow(decisive, ctx.args);
    if (early) return terminalFailure(early);
    const r = evalCondition(step.condition, ctx.args);
    lastDetail = r.detail;
    if (r.passed) return { ok: true };
    const t = terminalNow(watch, ctx.args);
    if (t) return terminalFailure(t);
    return undefined;
  }, timeoutMs);
  return hit ?? { ok: false, code: "timeout", detail: `The expected page state did not appear in time (${lastDetail}).` };
}

function parseNumber(text: string): number | null {
  const m = /-?\d[\d,]*(\.\d+)?/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractTable(source: Extract<ExtractSource, { type: "table" }>, args: Args): StepResult {
  const r = resolveLocator(source.locator, args);
  if (r.problem || r.elements.length === 0) return { ok: false, code: "locator_missing", detail: "The table was not found.", matches: 0 };
  if (r.elements.length > 1) return { ok: false, code: "locator_ambiguous", detail: `${r.elements.length} tables match.`, matches: r.elements.length };
  const table = r.elements[0] as HTMLTableElement;
  const headerRow = table.querySelector("thead tr") ?? table.querySelector("tr");
  if (!headerRow) return { ok: false, code: "locator_missing", detail: "The table has no header row." };
  const headers = [...headerRow.children].map((c) => norm(c.textContent));
  const colIndex: Record<string, number> = {};
  for (const [field, col] of Object.entries(source.columns)) {
    const i = headers.indexOf(col.header);
    if (i < 0) return { ok: false, code: "locator_missing", detail: `Column “${col.header}” was not found. The page may have changed.` };
    colIndex[field] = i;
  }
  // Data rows: every row of THIS table except the header row. (A table written without <thead> gets an automatic
  // <tbody> that also holds the header row, so "all tbody rows" would return the headings as the first record.)
  const bodyRows = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table && tr !== headerRow && !tr.closest("thead"));
  const rows: Record<string, string | number>[] = [];
  for (const tr of bodyRows.slice(0, source.maxRows)) {
    const cells = [...tr.children];
    const rec: Record<string, string | number> = {};
    for (const [field, col] of Object.entries(source.columns)) {
      const raw = norm(cells[colIndex[field]!]?.textContent);
      if (col.as === "number") {
        const n = parseNumber(raw);
        if (n === null) return { ok: false, code: "output_invalid", detail: `Could not read a number for “${field}”.` };
        rec[field] = n;
      } else rec[field] = raw;
    }
    rows.push(rec);
  }
  return { ok: true, value: rows };
}

function doExtract(ctx: RunContext, step: Extract<Step, { op: "extract" }>): StepResult {
  const src = step.source;
  if (src.type === "table") return extractTable(src, ctx.args);
  const r = resolveLocator(src.locator, ctx.args);
  if (r.problem === "param_missing") return { ok: false, code: "schema_violation", detail: "A needed parameter was not supplied." };
  if (src.type === "count") return r.problem ? { ok: true, value: 0 } : { ok: true, value: r.elements.length };
  if (src.type === "list") {
    if (r.problem || r.elements.length === 0) return { ok: false, code: "locator_missing", detail: "No list items were found.", matches: 0 };
    const items: (string | number | { text: string; url: string })[] = [];
    for (const el of r.elements) {
      if (items.length >= src.maxItems) break;
      if (src.as === "link") {
        const link = readLink(el);
        if (link && "blocked" in link) return { ok: false, code: "sensitive_field", detail: link.blocked };
        if (!link) return { ok: false, code: "output_invalid", detail: `An item of “${step.into}” is not a link.` };
        if (link.text) items.push(link);
        continue;
      }
      const text = readText(el);
      if (typeof text !== "string") return { ok: false, code: "sensitive_field", detail: text.blocked };
      if (!text) continue; // spacer / decorative items carry no value
      if (src.as === "number") {
        const n = parseNumber(text);
        if (n === null) return { ok: false, code: "output_invalid", detail: `Expected a number for every item of “${step.into}”.` };
        items.push(n);
      } else items.push(text);
    }
    if (items.length === 0) return { ok: false, code: "locator_missing", detail: "The list items were found but all of them are blank.", matches: r.elements.length };
    return { ok: true, value: items, matches: r.elements.length };
  }
  if (r.problem || r.elements.length === 0) {
    if (src.optional) return { ok: true, value: undefined };
    return { ok: false, code: "locator_missing", detail: "The expected element was not found.", matches: 0 };
  }
  if (r.elements.length > 1) return { ok: false, code: "locator_ambiguous", detail: `${r.elements.length} elements match.`, matches: r.elements.length };
  if (src.as === "link") {
    const link = readLink(r.elements[0]!);
    if (link && "blocked" in link) return { ok: false, code: "sensitive_field", detail: link.blocked };
    return link ? { ok: true, value: link } : { ok: false, code: "output_invalid", detail: `Expected a link for “${step.into}”.` };
  }
  const text = readText(r.elements[0]!);
  if (typeof text !== "string") return { ok: false, code: "sensitive_field", detail: text.blocked };
  if (src.as === "number") {
    const n = parseNumber(text);
    return n === null ? { ok: false, code: "output_invalid", detail: `Expected a number for “${step.into}”.` } : { ok: true, value: n };
  }
  return { ok: true, value: text };
}

export async function runStep(ctx: RunContext, step: Step, watch: Watch, timeoutMs: number): Promise<StepResult> {
  switch (step.op) {
    case "locate": return doLocate(ctx, step, watch, timeoutMs);
    case "fill": return doFill(ctx, step);
    case "click": return doClick(ctx, step);
    case "press": return doPress(ctx, step);
    case "waitFor": return doWaitFor(ctx, step, watch, step.timeoutMs ?? timeoutMs);
    case "extract": return doExtract(ctx, step);
    case "assert": {
      const r = evalCondition(step.condition, ctx.args);
      return r.passed ? { ok: true } : { ok: false, code: "precondition_unmet", detail: `A check failed (${r.detail}).` };
    }
  }
}

// ---- approval binding / commit ---------------------------------------------------
export interface Binding {
  fingerprint: string;
  state: Record<string, string>;
}

function readBinding(ctx: RunContext, target: string, fields: { id: string; locator: Locator }[]): { ok: true; binding: Binding; el: Element } | { ok: false; result: StepResult } {
  const b = bound(ctx, target);
  if ("fail" in b) return { ok: false, result: b.fail };
  // re-resolve the located target; it must still be the very same element
  const state: Record<string, string> = {};
  for (const f of fields) {
    const r = resolveLocator(f.locator, ctx.args);
    if (r.problem || r.elements.length !== 1) return { ok: false, result: { ok: false, code: "approval_binding_changed", detail: `A page value shown in the approval (“${f.id}”) is no longer present once.` } };
    const t = readText(r.elements[0]!);
    if (typeof t !== "string") return { ok: false, result: { ok: false, code: "sensitive_field", detail: t.blocked } };
    state[f.id] = t;
  }
  return { ok: true, binding: { fingerprint: fingerprintElement(b.el), state }, el: b.el };
}

function actionRefusal(el: Element, origins: string[], action: CommitAction): string | null {
  if (action.type === "click") return clickRefusal(el, origins);
  if (action.type === "press") return pressRefusal(el, origins);
  return fillRefusal(el);
}

/** True if setting `value` would change nothing (so a field that saves by itself would not save). */
function alreadySet(el: Element, value: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const o = el.selectedOptions[0];
    return !!o && (optionLabel(o) === norm(value) || (o.value === value && ![...el.options].some((x) => optionLabel(x) === norm(value))));
  }
  const toggle = toggleKind(el);
  if (toggle) return (value === "true" || value === "false") && isChecked(el) === (value === "true");
  if (isEditableRoot(el)) return norm(el.innerText) === norm(value);
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value === value;
}

export function prepareCommit(ctx: RunContext, target: string, fields: { id: string; locator: Locator }[], action: CommitAction): StepResult {
  const b = bound(ctx, target);
  if ("fail" in b) return b.fail;
  const refusal = actionRefusal(b.el, ctx.origins, action);
  if (refusal) return { ok: false, code: "precondition_unmet", detail: refusal };
  const r = readBinding(ctx, target, fields);
  if (!r.ok) return r.result;
  if (action.type === "fill") {
    const value = resolveText(action.value, ctx.args);
    if (value === undefined) return { ok: false, code: "schema_violation", detail: "A needed parameter was not supplied." };
    if (alreadySet(b.el, value)) return { ok: true, value: r.binding, noop: true };
  }
  return { ok: true, value: r.binding };
}

export function peekBinding(ctx: RunContext, target: string, fields: { id: string; locator: Locator }[]): StepResult {
  const r = readBinding(ctx, target, fields);
  return r.ok ? { ok: true, value: r.binding } : r.result;
}

/** The one consequential action. Re-checks the approved binding against the live page IMMEDIATELY before acting. */
export async function commit(ctx: RunContext, target: string, fields: { id: string; locator: Locator }[], expected: Binding, action: CommitAction): Promise<StepResult> {
  const r = readBinding(ctx, target, fields);
  if (!r.ok) return r.result;
  const changed: string[] = [];
  if (r.binding.fingerprint !== expected.fingerprint) changed.push("target");
  for (const f of fields) if (r.binding.state[f.id] !== expected.state[f.id]) changed.push(f.id);
  if (changed.length) return { ok: false, code: "approval_binding_changed", detail: `The page changed after you approved (${changed.join(", ")}). Nothing was done.` };
  const refusal = actionRefusal(r.el, ctx.origins, action);
  if (refusal) return { ok: false, code: "precondition_unmet", detail: refusal };
  if (action.type === "click") {
    (r.el as HTMLElement).click();
    return { ok: true };
  }
  if (action.type === "press") return pressEnter(r.el as HTMLElement);
  const value = resolveText(action.value, ctx.args);
  if (value === undefined) return { ok: false, code: "schema_violation", detail: "A needed parameter was not supplied." };
  return fillElement(r.el, value);
}

/** Optional, explicit diagnostic: roles and short names of visible controls. No values; long digit runs masked. */
export function captureOutline(): string[] {
  const out: string[] = [];
  for (const el of deepQueryAll(document, "a[href],button,input,textarea,select,h1,h2,h3,[role]")) {
    if (out.length >= 40) break;
    if (!isVisible(el)) continue;
    if (isFormField(el) && isSensitiveField(fieldDescriptor(el))) continue;
    const role = computeRole(el);
    if (!role) continue;
    out.push(`${role}: ${accessibleName(el, role).replace(/\d{4,}/g, "#").slice(0, 40)}`);
  }
  return out;
}
