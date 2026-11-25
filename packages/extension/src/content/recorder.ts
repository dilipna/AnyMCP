// Explicit workflow recorder (content script).
//
// Rules enforced HERE, at capture time:
//  - runs only between an explicit start and stop, and only while the page origin is the approved one
//  - only TRUSTED user events (isTrusted) are recorded; scripts on the page cannot inject steps
//  - password / payment / secret / data-anymcp-ignore fields are never captured: only a COUNT is reported
//  - typed values are sent to the service worker's memory for parameter selection; they are not persisted
//  - picking mode swallows clicks so choosing an output never triggers a page action
//
// Shadow DOM: the real target of an event is taken from its composed path (and, for closed roots, from the
// pointer position or focus), so controls inside web components are recorded like any others. `change` does
// not leave a shadow root, so typed text is ALSO captured when the field loses focus (`focusout` does).

import type { Locator, LocatorLeaf, Role } from "anymcp-protocol";
import { isSensitiveField } from "anymcp-protocol/light";
import { defaultButton, fieldDescriptor, isChecked, linkOf, optionLabel, toggleKind } from "./engine";
import { showBanner, hideBanner } from "./banner";
import { PRIVATE_AREA, accessibleName, composedClosest, isEditableRoot, composedParent, computeRole, deepQueryAll, isVisible, norm, resolveLocator, shadowRootOf, visibleText } from "./locator";

export type PickMode = "text" | "table" | "list" | "success" | null;

/** What kind of control a recorded "input" step sets. */
export type InputControl = "text" | "select" | "checkbox" | "radio";

export interface SuggestedLocator {
  locator: Locator;
  quality: "semantic" | "testid" | "container" | "fragile" | "ambiguous";
}

export type RecordedEvent =
  | { t: "input"; seq: number; locator: Locator; quality: SuggestedLocator["quality"]; fieldLabel: string; example: string; control: InputControl; options?: string[] }
  | { t: "click"; seq: number; locator: Locator; quality: SuggestedLocator["quality"]; targetLabel: string; effectGuess: "ui" | "navigate"; viaEnter?: boolean; options?: string[] }
  | { t: "press"; seq: number; locator: Locator; quality: SuggestedLocator["quality"]; targetLabel: string; key: "Enter"; effectGuess?: "ui" | "commit" }
  | { t: "skipped"; seq: number; reason: "sensitive_field" };

export interface PickResult {
  mode: Exclude<PickMode, null>;
  locator: Locator;
  quality: SuggestedLocator["quality"];
  preview: string;
  headers?: string[];
  rows?: number;
  /** For lists: every item is (or holds exactly one) link, so the default is to return text + address. */
  links?: boolean;
  /** For lists found by a pattern with no class: matched items built differently from the clicked one. */
  unlike?: number;
}

const CONTAINER_ROLES: Role[] = ["form", "table", "region", "dialog", "main", "navigation"];

function sameEl(list: Element[], el: Element): boolean {
  return list.length === 1 && list[0] === el;
}

/** Prefer semantic locators; add a named container if needed; fall back to test id; never a DOM path. */
export function suggestLocator(el: Element, purpose: "action" | "value" | "static-text" = "action"): SuggestedLocator {
  const role = computeRole(el);
  const name = accessibleName(el, role);
  const candidates: { loc: Locator; q: SuggestedLocator["quality"] }[] = [];

  const labelText = (el as HTMLInputElement).labels?.[0]?.textContent;
  if (labelText && norm(labelText)) candidates.push({ loc: { by: "label", text: norm(labelText) }, q: "semantic" });
  // A picked value is what the tool READS, so it must not be found by its own text: on another page (another product,
  // another order) that text differs, and the tool could only ever return the recorded value, or stop. A name that
  // comes from aria-label or similar, not from the element's text, still identifies it.
  const nameIsItsText = !!name && norm(el.textContent).includes(name);
  if (role && name && !(purpose === "value" && nameIsItsText)) candidates.push({ loc: { by: "role", role, name }, q: "semantic" });
  if (purpose === "static-text") {
    const t = visibleText(el);
    if (t && t.length <= 80) candidates.push({ loc: { by: "text", text: t }, q: "semantic" });
  }
  const testid = el.getAttribute("data-testid");
  // test ids are stable and uniquely scoped; for values (read-only extraction) they beat role+name
  if (testid) candidates.splice(purpose === "value" ? 0 : candidates.length, 0, { loc: { by: "testid", id: testid }, q: "testid" });

  // a value next to a label (<th>Availability</th><td>…</td>, <dt>…</dt><dd>…</dd>)
  const prev = el.previousElementSibling;
  if (prev && ((el.tagName === "TD" && prev.tagName === "TH") || (el.tagName === "DD" && prev.tagName === "DT"))) {
    const label = norm(prev.textContent).replace(/:$/, "");
    if (label && label.length <= 80) candidates.push({ loc: { by: "field", label }, q: "semantic" });
  }

  for (const c of candidates) if (sameEl(resolveLocator(c.loc, {}).elements, el)) return { locator: c.loc, quality: c.q };

  // try inside the nearest NAMED container
  for (let p = composedParent(el); p; p = composedParent(p)) {
    const prole = computeRole(p);
    const pname = prole ? accessibleName(p, prole) : "";
    if (!prole || !CONTAINER_ROLES.includes(prole) || !pname) continue;
    const within: LocatorLeaf = { by: "role", role: prole, name: pname };
    for (const c of candidates) {
      if (c.loc.by === "testid" && purpose !== "value") continue;
      const withLoc = { ...c.loc, within } as Locator;
      if (sameEl(resolveLocator(withLoc, {}).elements, el)) return { locator: withLoc, quality: "container" };
    }
  }
  // last resort: a CSS selector that matches exactly this element. Flagged as fragile in the review.
  const css = cssFor(el, purpose === "value");
  if (css) return { locator: { by: "css", selector: css }, quality: "fragile" };
  const best = candidates[0]?.loc ?? ({ by: "role", role: role ?? "button", name: name || "unnamed" } as Locator);
  return { locator: best, quality: "ambiguous" };
}

const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_-]{0,40}$/;
/**
 * An id a page makes up on each load or build ("ember1234", "e0779f31-7d18-4a0b-…" on the-internet.herokuapp.com's
 * challenging_dom page): a selector built on it finds nothing on the next visit.
 */
const madeUp = (s: string) => /\d{3,}/.test(s) || /[0-9a-f]{8}-[0-9a-f]{4}/i.test(s);
const stableId = (e: Element) => !!e.id && SAFE_IDENT.test(e.id) && !madeUp(e.id);
const stableClasses = (e: Element) => [...e.classList].filter((c) => SAFE_IDENT.test(c) && !madeUp(c)).slice(0, 2);
/** One selector step for an element: tag + up to two stable-looking classes (+ position, if asked). */
function cssPart(e: Element, nth: boolean): string {
  let s = e.localName + stableClasses(e).map((c) => `.${c}`).join("");
  if (nth && e.parentElement) {
    const same = [...e.parentElement.children].filter((x) => x.tagName === e.tagName);
    if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`;
  }
  return s;
}

/** The tag names of an element's children: a rough picture of what an item is made of. */
const shapeOf = (e: Element) => [...e.children].map((c) => c.localName).join(",");

/**
 * A pattern with no class ("table > tbody > tr > td") also takes in neighbours that merely share the tag: on a table
 * used for layout, the tags row under each quote and a side cell (quotes.toscrape.com/tableful, 2026-11-23). Narrow it
 * by one of the clicked item's own attributes, but only when two independent signals agree: every item the attribute
 * removes is built differently from the clicked one, and every item it keeps is built alike. Removed items with no
 * text (spacer cells) are left out of that comparison: they carry no value and are skipped when reading. Otherwise keep the
 * pattern (and its count, shown to the user) as it is, so a list of genuinely similar items never silently shrinks.
 */
function narrowByAttribute(sel: string, items: Element[], el: Element, many: (loc: Locator) => Element[] | null): { sel: string; items: Element[] } | null {
  const mine = shapeOf(el);
  for (const a of [...el.attributes]) {
    if (a.name === "id" || a.name === "class" || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(a.name) || !a.value || a.value.length > 80) continue;
    const narrowed = `${sel}[${a.name}="${a.value.replace(/["\\]/g, "\\$&")}"]`;
    let kept: Element[] | null;
    try {
      kept = many({ by: "css", selector: narrowed });
    } catch {
      continue;
    }
    if (!kept || kept.length === items.length) continue;
    const removed = items.filter((x) => !kept!.includes(x) && norm(x.textContent) !== "");
    if (kept.every((x) => shapeOf(x) === mine) && removed.length > 0 && removed.every((x) => shapeOf(x) !== mine)) return { sel: narrowed, items: kept };
  }
  return null;
}

export interface SuggestedList extends SuggestedLocator {
  /** The elements the locator matches right now, in page order. */
  items: Element[];
  /** For a pattern with no class: how many matched items with text are built differently from the clicked one. */
  unlike?: number;
}

/** Items with text whose make-up differs from the clicked item's (only asked for patterns without a class). */
const countUnlike = (items: Element[], el: Element): number => items.filter((x) => norm(x.textContent) !== "" && shapeOf(x) !== shapeOf(el)).length;

/**
 * A locator for "this item and the others like it" (search results, cards, rows of a list).
 * Preference: a repeated test id, then a role inside a named container, then a CSS pattern (flagged fragile).
 * The user is shown how many items it matches and the first few, so a wrong guess is visible before saving.
 */
export function suggestListLocator(clicked: Element): SuggestedList | null {
  const many = (loc: Locator): Element[] | null => {
    const els = resolveLocator(loc, {}).elements;
    return els.length >= 2 && els.length <= 500 && els.includes(el) && els.every((x) => x.localName === el.localName) ? els : null;
  };
  let el = clicked;
  // the click may land on a detail inside the repeated item (a <b> in a row): climb a little until something repeats
  for (let depth = 0; depth < 4 && el && el !== document.body; depth++, el = composedParent(el) as Element) {
    const testid = el.getAttribute("data-testid");
    if (testid) {
      const loc: Locator = { by: "testid", id: testid };
      const items = many(loc);
      if (items) return { locator: loc, quality: "testid", items };
    }
    const role = computeRole(el);
    if (role) {
      for (let p = composedParent(el); p; p = composedParent(p)) {
        const prole = computeRole(p);
        const pname = prole ? accessibleName(p, prole) : "";
        if (!prole || ![...CONTAINER_ROLES, "list" as Role].includes(prole) || !pname || pname.length > 80) continue;
        const loc: Locator = { by: "role", role, within: { by: "role", role: prole, name: pname } };
        const items = many(loc);
        if (items) return { locator: loc, quality: "container", items };
      }
    }
    // CSS pattern: shortest chain that contains at least one class (a bare "li" or "div > a" says too little)
    let sel = "";
    let fallback: { sel: string; items: Element[] } | null = null;
    for (let cur: Element | null = el, d = 0; cur && cur !== document.body && d < 4; d++, cur = cur.parentElement) {
      sel = sel ? `${cssPart(cur, false)} > ${sel}` : cssPart(cur, false);
      if (sel.length > 200) break;
      const loc: Locator = { by: "css", selector: sel };
      const items = many(loc);
      if (!items) continue;
      if (sel.includes(".")) return { locator: loc, quality: "fragile", items };
      fallback = { sel, items };
    }
    if (fallback) {
      const narrowed = narrowByAttribute(fallback.sel, fallback.items, el, many);
      if (narrowed) return { locator: { by: "css", selector: narrowed.sel }, quality: "fragile", items: narrowed.items, unlike: countUnlike(narrowed.items, el) };
      return { locator: { by: "css", selector: fallback.sel }, quality: "fragile", items: fallback.items, unlike: countUnlike(fallback.items, el) };
    }
  }
  return null;
}
/**
 * Shortest selector (tag, stable-looking classes, nth-of-type) that matches exactly `el`. Null if none within 5 levels.
 * With `anchor` (values the user picks): a selector made only of the element's own tag and classes is placed inside
 * its nearest ancestor with an id or a stable class, up to 4 levels up. A value's style is often repeated on other
 * pages of the same site (a "you may also like" strip under a product), while the box it sits in is not: unanchored,
 * the value is unique on the recorded page and ambiguous elsewhere (books.toscrape.com, 2026-11-23).
 */
export function cssFor(el: Element, anchor = false): string | null {
  const unique = (sel: string) => {
    try {
      const m = deepQueryAll(document, sel).filter(isVisible);
      return m.length === 1 && m[0] === el;
    } catch {
      return false;
    }
  };
  if (stableId(el) && unique(`#${el.id}`)) return `#${el.id}`;
  const anchored = (sel: string): string => {
    let p = el.parentElement;
    for (let up = 0; p && p !== document.body && up < 4; up++, p = p.parentElement) {
      const part = stableId(p) ? `#${p.id}` : stableClasses(p).length ? cssPart(p, false) : "";
      if (part && `${part} ${sel}`.length <= 200 && unique(`${part} ${sel}`)) return `${part} ${sel}`;
    }
    return sel;
  };
  const part = cssPart;
  for (const nth of [false, true]) {
    let sel = "";
    let cur: Element | null = el;
    for (let depth = 0; cur && cur !== document.body && depth < 5; depth++, cur = cur.parentElement) {
      sel = sel ? `${part(cur, nth)} > ${sel}` : part(cur, nth);
      if (sel.length <= 200 && unique(sel)) return anchor && depth === 0 ? anchored(sel) : sel;
    }
  }
  return null;
}

// ---- state -------------------------------------------------------------------
let active = false;
let allowedOrigin = "";
let seq = 0;
/**
 * Event order numbers. Increasing within a page AND across pages (each new document gets a fresh content script,
 * so a plain counter would restart at 1 after every navigation). The service worker orders steps by this.
 */
function nextSeq(): number {
  seq = Math.max(seq + 1, Date.now() * 1000);
  return seq;
}
let onEventCb: ((e: RecordedEvent) => void) | null = null;
let onPickCb: ((p: PickResult) => void) | null = null;
let pickMode: PickMode = null;
let overlay: HTMLElement | null = null;

export function isRecording(): boolean {
  return active;
}

const insideBanner = (t: EventTarget | null) => t instanceof Element && !!composedClosest(t, "[data-anymcp-banner]");

/**
 * The element the user really acted on. Events that cross a shadow boundary are re-targeted to the host, so we
 * read the composed path; a CLOSED root hides even that, so there we descend by pointer position or focus.
 */
function deepTarget(ev: Event): Element | null {
  let first: unknown = ev.composedPath()[0] ?? ev.target;
  if (first instanceof Text) first = first.parentElement;
  if (!(first instanceof Element)) return null;
  let t: Element = first;
  for (let i = 0; i < 10; i++) {
    const sr = t.shadowRoot ? null : shadowRootOf(t); // open roots are already resolved by composedPath
    if (!sr) break;
    const byPointer = ev instanceof MouseEvent && ev.detail > 0;
    const inner: Element | null = byPointer ? sr.elementFromPoint((ev as MouseEvent).clientX, (ev as MouseEvent).clientY) : sr.activeElement;
    if (!inner || inner === t || inner.getRootNode() !== sr) break;
    t = inner;
  }
  return t;
}

function emit(e: RecordedEvent) {
  if (active && location.origin === allowedOrigin) onEventCb?.(e);
}

const lastValue = new WeakMap<Element, string>();
/** Sensitive fields already reported as skipped. Their values are never held, not even to compare. */
const reportedSensitive = new WeakSet<Element>();
function skipSensitive(el: Element) {
  if (reportedSensitive.has(el)) return;
  reportedSensitive.add(el);
  emit({ t: "skipped", seq: nextSeq(), reason: "sensitive_field" });
}
const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "file", "hidden", "submit", "button", "reset", "image"].includes(el.type));

/** Remember what a field held before the user touched it, so merely tabbing through a pre-filled field records nothing. */
/** A field the person types into: a text box or a rich text box. */
const isTypable = (el: Element): el is HTMLElement => isTextField(el) || isEditableRoot(el);
const valueOf = (el: HTMLElement | HTMLSelectElement): string => (isEditableRoot(el) ? el.innerText.replace(/\n+$/, "") : (el as HTMLInputElement).value);

function handleFocusIn(ev: Event) {
  if (!ev.isTrusted || !active) return;
  const el = deepTarget(ev);
  if (el && (isTypable(el) || el instanceof HTMLSelectElement) && !lastValue.has(el) && !isSensitiveField(fieldDescriptor(el))) lastValue.set(el, valueOf(el));
}

/** Record the current value of a text field or dropdown. Sensitive fields are counted, never captured. */
function captureInput(el: Element | null) {
  if (!el || !(isTypable(el) || el instanceof HTMLSelectElement)) return;
  if (isSensitiveField(fieldDescriptor(el))) return skipSensitive(el);
  const value = valueOf(el);
  if (lastValue.get(el) === value) return; // Enter + change + blur would otherwise record the same value several times
  // the page clearing a box after an action (a sent message, a saved note) is not something the person did
  const was = lastValue.get(el);
  lastValue.set(el, value);
  if (value === "" && was) return;
  const s = suggestLocator(el);
  const fieldLabel = accessibleName(el) || "field";
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) return; // not supported: recording it would produce a step that cannot be replayed
    const chosen = el.selectedOptions[0];
    if (!chosen) return;
    const options = [...el.options].filter((o) => !o.disabled).map(optionLabel).filter((t) => t && t.length <= 200);
    emit({ t: "input", seq: nextSeq(), locator: s.locator, quality: s.quality, fieldLabel, example: optionLabel(chosen).slice(0, 200), control: "select", ...(options.length >= 1 && options.length <= 100 ? { options: [...new Set(options)] } : {}) });
    return;
  }
  emit({ t: "input", seq: nextSeq(), locator: s.locator, quality: s.quality, fieldLabel, example: value.slice(0, 200), control: "text" });
}

function handleChange(ev: Event) {
  if (!ev.isTrusted || !active || pickMode) return;
  captureInput(deepTarget(ev));
}

/** A checkbox, switch or option button was clicked: record the state it ended up in (not "a click"). */
function captureToggle(el: Element, kind: "checkbox" | "radio") {
  if ((el instanceof HTMLInputElement && isSensitiveField(fieldDescriptor(el))) || composedClosest(el, PRIVATE_AREA)) return skipSensitive(el);
  // read the state after the page has handled the click (it may veto it, or update aria-checked a moment later)
  const order = nextSeq(); // the step belongs where the click happened, even though its state is read later
  setTimeout(() => {
    if (!active || !el.isConnected) return;
    const checked = isChecked(el);
    if (kind === "radio" && !checked) return;
    const s = suggestLocator(el);
    emit({ t: "input", seq: order, locator: s.locator, quality: s.quality, fieldLabel: accessibleName(el) || (kind === "radio" ? "option" : "checkbox"), example: String(checked), control: kind });
  }, 60);
}

/** What counts as "a click worth recording". Includes the openers of custom dropdowns and menus. */
const CLICKABLE = [
  "a[href]", "button", "summary", "input[type=submit]", "input[type=button]", "input[type=image]",
  "[role=button]", "[role=link]", "[role=tab]", "[role=option]", "[role=menuitem]", "[role=menuitemradio]", "[role=menuitemcheckbox]",
  "[role=combobox]:not(input):not(textarea)", "[aria-haspopup]:not([aria-haspopup=false]):not(input):not(textarea)",
].join(",");
const CHOICE_ROLES = new Set(["option", "menuitem", "menuitemradio", "menuitemcheckbox"]);

/** The names of the visible choices next to a clicked option (a custom dropdown or menu), so the choice can become an input. */
function siblingChoices(el: Element): string[] | undefined {
  const container = composedClosest(el, "[role=listbox],[role=menu],[role=tree],[role=grid]");
  if (!container) return undefined;
  const names = deepQueryAll(container, "[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]")
    .filter((o) => isVisible(o) && o.getAttribute("aria-disabled") !== "true")
    .map((o) => accessibleName(o))
    .filter((n) => n && n.length <= 200);
  const unique = [...new Set(names)];
  return unique.length >= 2 && unique.length <= 100 ? unique : undefined;
}

/** The default button the browser "clicked" for an Enter press; its trusted click must not be recorded twice. */
let enterSubmit: { el: Element; at: number } | null = null;
const TOGGLE = "input[type=checkbox],input[type=radio],[role=checkbox],[role=switch],[role=radio]";

function clickEvent(el: Element, viaEnter = false): RecordedEvent | null {
  const role = computeRole(el);
  const tag = el.tagName.toLowerCase();
  const isControl = el.matches(CLICKABLE) || role === "button" || role === "link" || role === "tab" || role === "option" || role === "menuitem" || role === "combobox";
  if (!isControl || isTextField(el)) return null; // clicking into a text box (even an autocomplete one) is not a step
  if (el instanceof HTMLInputElement && isSensitiveField(fieldDescriptor(el))) return null;
  const s = suggestLocator(el);
  const options = role && CHOICE_ROLES.has(role) ? siblingChoices(el) : undefined;
  return {
    t: "click",
    seq: nextSeq(),
    locator: s.locator,
    quality: s.quality,
    targetLabel: accessibleName(el, role) || tag,
    effectGuess: el instanceof HTMLAnchorElement ? "navigate" : "ui",
    ...(viaEnter ? { viaEnter } : {}),
    ...(options ? { options } : {}),
  };
}

function handleClick(ev: MouseEvent) {
  if (!active) return;
  const target = deepTarget(ev);
  if (!target || insideBanner(target)) return;
  if (pickMode) {
    if (!ev.isTrusted) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    finishPick(target);
    return;
  }
  if (!ev.isTrusted) return;
  const toggle = composedClosest(target, TOGGLE);
  if (toggle) {
    const kind = toggleKind(toggle);
    if (kind) return captureToggle(toggle, kind);
  }
  const control = composedClosest(target, CLICKABLE);
  if (!control) return;
  if (enterSubmit && enterSubmit.el === control && Date.now() - enterSubmit.at < 1000) {
    enterSubmit = null; // the browser's own click for the Enter we already recorded
    return;
  }
  const e = clickEvent(control);
  if (e) emit(e);
}

function handleKeydown(ev: KeyboardEvent) {
  if (!ev.isTrusted || !active || pickMode || ev.key !== "Enter" || ev.isComposing) return;
  const el = deepTarget(ev);
  if (el && isEditableRoot(el)) {
    if (ev.shiftKey) return; // Shift+Enter: a new line
    if (isSensitiveField(fieldDescriptor(el)) || composedClosest(el, PRIVATE_AREA)) return;
    captureInput(el);
    const s = suggestLocator(el);
    // In a rich text box Enter often SENDS (chats, comments). Treat it as changing data until the person says it
    // only adds a new line: that way it needs approval rather than running unasked.
    emit({ t: "press", seq: nextSeq(), locator: s.locator, quality: s.quality, targetLabel: accessibleName(el) || "text box", key: "Enter", effectGuess: "commit" });
    return;
  }
  // in a <textarea> Enter is a new line, not an action
  if (!(el instanceof HTMLInputElement) || !isTextField(el)) return;
  if (isSensitiveField(fieldDescriptor(el)) || composedClosest(el, PRIVATE_AREA)) return;
  captureInput(el); // flush the typed value first
  // Enter in a form with a submit button: record a click on that button, so replay does the same thing
  const def = el.form ? defaultButton(el.form) : null;
  if (def) {
    const e = clickEvent(def, true);
    if (e) {
      enterSubmit = { el: def, at: Date.now() };
      emit(e);
    }
    return;
  }
  // otherwise the page itself listens for Enter (common in search boxes of web apps): record the key press
  const s = suggestLocator(el);
  emit({ t: "press", seq: nextSeq(), locator: s.locator, quality: s.quality, targetLabel: accessibleName(el) || "field", key: "Enter" });
}

// ---- pick mode ------------------------------------------------------------------
function ensureOverlay(): HTMLElement {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.setAttribute("data-anymcp-banner", "");
  overlay.style.cssText = "all:initial;position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #0b57d0;background:rgba(11,87,208,.12);border-radius:4px;display:none;";
  document.documentElement.appendChild(overlay);
  return overlay;
}

function handleMove(ev: MouseEvent) {
  if (!pickMode) return;
  const hovered = deepTarget(ev);
  if (!hovered || insideBanner(hovered)) return;
  const target = pickMode === "table" ? (composedClosest(hovered, "table") ?? hovered) : hovered;
  const r = target.getBoundingClientRect();
  const o = ensureOverlay();
  Object.assign(o.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}

function handleEsc(ev: KeyboardEvent) {
  if (ev.key === "Escape" && pickMode) setPickMode(null);
}

function finishPick(target: Element) {
  const mode = pickMode!;
  if (mode === "table") {
    const table = composedClosest(target, "table");
    if (!table) return; // keep picking; ignore clicks that are not on a table
    const s = suggestLocator(table);
    const headerRow = table.querySelector("thead tr") ?? table.querySelector("tr");
    const headers = [...(headerRow?.children ?? [])].map((c) => norm(c.textContent)).filter(Boolean);
    setPickMode(null);
    onPickCb?.({ mode, locator: s.locator, quality: s.quality, preview: `${headers.length} columns`, headers, rows: table.querySelectorAll("tbody tr").length });
    return;
  }
  if (isFormFieldSensitive(target) || composedClosest(target, PRIVATE_AREA)) return;
  if (mode === "list") {
    const list = suggestListLocator(target);
    if (!list) {
      // nothing repeats here: say so and keep picking, rather than saving a "list" of one
      showBanner("AnyMCP: that item does not repeat on this page — click one of several similar items (Esc to cancel)", "recording", () => stopHandler?.());
      return;
    }
    const first = list.items.slice(0, 3).map((x) => `“${previewOf(x).slice(0, 30)}”`).join(", ");
    setPickMode(null);
    const links = list.items.every((x) => !!linkOf(x));
    const unlike = list.unlike ? ` (${list.unlike} look different from the one you clicked)` : "";
    onPickCb?.({ mode, locator: list.locator, quality: list.quality, preview: `${list.items.length} items${unlike}: ${first}${list.items.length > 3 ? ", …" : ""}`, rows: list.items.length, links, ...(list.unlike ? { unlike: list.unlike } : {}) });
    return;
  }
  const s = suggestLocator(target, mode === "success" ? "static-text" : "value");
  setPickMode(null);
  onPickCb?.({ mode, locator: s.locator, quality: s.quality, preview: previewOf(target) });
}

function isFormFieldSensitive(el: Element): boolean {
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && isSensitiveField(fieldDescriptor(el));
}

/** A short preview for the user; long digit runs masked so account numbers are not echoed around. */
function previewOf(el: Element): string {
  return visibleText(el).replace(/\d{6,}/g, "######").slice(0, 60);
}

export function setPickMode(mode: PickMode): void {
  pickMode = mode;
  if (!mode && overlay) overlay.style.display = "none";
  if (!active) return;
  showBanner(mode ? `AnyMCP: click ${mode === "table" ? "the table" : mode === "list" ? "one of the repeated items" : mode === "success" ? "the message that shows it worked" : "the value"} to capture (Esc to cancel)` : "AnyMCP is recording — nothing is saved until you finish", "recording", () => stopHandler?.());
}

let stopHandler: (() => void) | null = null;

export function startRecording(origin: string, onEvent: (e: RecordedEvent) => void, onPick: (p: PickResult) => void, onStopRequested: () => void): void {
  if (active) stopRecording();
  active = true;
  allowedOrigin = origin;
  onEventCb = onEvent;
  onPickCb = onPick;
  stopHandler = onStopRequested;
  pickMode = null;
  document.addEventListener("change", handleChange, true);
  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("focusout", handleChange, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("keydown", handleEsc, true);
  document.addEventListener("mousemove", handleMove, true);
  showBanner("AnyMCP is recording — nothing is saved until you finish", "recording", onStopRequested);
}

export function stopRecording(): void {
  active = false;
  pickMode = null;
  document.removeEventListener("change", handleChange, true);
  document.removeEventListener("focusin", handleFocusIn, true);
  document.removeEventListener("focusout", handleChange, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("keydown", handleKeydown, true);
  document.removeEventListener("keydown", handleEsc, true);
  document.removeEventListener("mousemove", handleMove, true);
  overlay?.remove();
  overlay = null;
  onEventCb = onPickCb = stopHandler = null;
  hideBanner();
}

// exported for tests
export { isVisible };
