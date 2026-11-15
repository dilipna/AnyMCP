// Semantic locator resolution. Used by BOTH the replay engine and the recorder so that
// "what the recorder saw" and "what the engine finds" can never drift apart.
//
// Rules that matter for safety:
//  - only VISIBLE elements match
//  - parameters come from validated run arguments, never from page text
//  - a `within` container must itself resolve to exactly one element
//  - callers decide what 0 or >1 matches mean; this module never guesses a "best" match
//
// Shadow DOM: every query here is "deep" — it also looks inside shadow roots (open ones, and closed ones on
// custom elements via chrome.dom), because component-based sites keep most of their controls there.
// iframes are NOT entered: a frame is a different document with its own origin and permission question.

import { resolveText } from "anymcp-protocol/light";
import type { Locator, LocatorLeaf, Role } from "anymcp-protocol";

export type Args = Record<string, unknown>;

/**
 * Parts of a page the site author marked as private: AnyMCP never records, reads or fills inside them.
 * `data-mycp-ignore` is the attribute's pre-release name and is still honoured.
 */
export const PRIVATE_AREA = "[data-anymcp-ignore],[data-mycp-ignore]";

/** The root of a rich text box: an editable element (contenteditable) that is not inside another editable one. */
export function isEditableRoot(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.isContentEditable && !(el.parentElement?.isContentEditable ?? false);
}

export const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

// ---- shadow-aware DOM helpers -----------------------------------------------
/** The element's shadow root, if any. Closed roots are only looked up on custom elements (the only common case). */
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.hasAttribute("data-anymcp-banner")) return null; // AnyMCP's own indicator is never part of the page
  if (el.shadowRoot) return el.shadowRoot;
  if (!el.localName.includes("-")) return null;
  try {
    return (globalThis.chrome?.dom?.openOrClosedShadowRoot(el as HTMLElement) as ShadowRoot | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Parent in the composed tree: the DOM parent, or the shadow host when `el` is at the top of a shadow tree. */
export function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** `Element.closest`, but it keeps going up through shadow hosts. */
export function composedClosest(el: Element, selector: string): Element | null {
  for (let cur: Element | null = el; cur; ) {
    const hit = cur.closest(selector);
    if (hit) return hit;
    const root: Node = cur.getRootNode();
    cur = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/**
 * `querySelectorAll` that also searches inside shadow roots, in page order (a host's shadow content comes
 * right after the host). Throws on an invalid selector, like the native call.
 */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [];
  const walk = (scope: ParentNode) => {
    const all = scope.querySelectorAll("*");
    let hasHost = false;
    for (const el of all) {
      if (shadowRootOf(el)) {
        hasHost = true;
        break;
      }
    }
    if (!hasHost) {
      for (const el of scope.querySelectorAll(selector)) out.push(el); // the common case: native speed
      return;
    }
    const matches = new Set(scope.querySelectorAll(selector));
    for (const el of all) {
      if (matches.has(el)) out.push(el);
      const sr = shadowRootOf(el);
      if (sr) walk(sr);
    }
  };
  if (root instanceof Element) {
    const own = shadowRootOf(root);
    if (own) walk(own);
  }
  walk(root);
  return out;
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
  if ((el as HTMLElement).hidden) return false;
  if (composedClosest(el, '[aria-hidden="true"], [hidden]')) return false;
  const cv = (el as HTMLElement).checkVisibility?.({ visibilityProperty: true, checkVisibilityCSS: true });
  if (cv === false) return false;
  const rects = el.getClientRects();
  return rects.length > 0 && (rects[0]!.width > 0 || rects[0]!.height > 0 || getComputedStyle(el).display === "contents");
}

// ---- roles -----------------------------------------------------------------
const ROLE_SET = new Set<string>([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "heading", "table", "row", "cell",
  "columnheader", "list", "listitem", "img", "form", "region", "alert", "status", "dialog", "tab", "main", "navigation",
  "switch", "option", "menuitem",
]);

const IMPLICIT_SELECTOR: Record<Role, string> = {
  button: "button,input[type=button],input[type=submit],input[type=reset],input[type=image]",
  link: "a[href],area[href]",
  textbox: 'input,textarea,[contenteditable]:not([contenteditable="false"])',
  searchbox: "input[type=search]",
  checkbox: "input[type=checkbox]",
  radio: "input[type=radio]",
  combobox: "select,input[list]",
  heading: "h1,h2,h3,h4,h5,h6",
  table: "table",
  row: "tr",
  cell: "td",
  columnheader: "th",
  list: "ul,ol",
  listitem: "li",
  img: "img",
  form: "form",
  region: "section",
  alert: "",
  status: "",
  dialog: "dialog",
  tab: "",
  main: "main",
  navigation: "nav",
  switch: "",
  option: "",
  menuitem: "",
};

export function roleSelector(role: Role): string {
  const implicit = IMPLICIT_SELECTOR[role];
  return implicit ? `[role="${role}"],${implicit}` : `[role="${role}"]`;
}

export function computeRole(el: Element): Role | null {
  const explicit = norm(el.getAttribute("role")).split(" ")[0];
  if (explicit && ROLE_SET.has(explicit)) return explicit as Role;
  if (isEditableRoot(el)) return "textbox"; // a rich text box behaves as a text box
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "search") return "searchbox";
    if (["hidden", "file", "range", "color", "date", "datetime-local", "month", "time", "week"].includes(type)) return null;
    return el.hasAttribute("list") ? "combobox" : "textbox";
  }
  switch (tag) {
    case "a": case "area": return el.hasAttribute("href") ? "link" : null;
    case "button": return "button";
    case "textarea": return "textbox";
    case "select": return "combobox";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
    case "table": return "table";
    case "tr": return "row";
    case "td": return "cell";
    case "th": return "columnheader";
    case "ul": case "ol": return "list";
    case "li": return "listitem";
    case "img": return el.hasAttribute("alt") ? "img" : null;
    case "form": return hasAriaName(el) ? "form" : null; // a form is a landmark only when it has a name
    case "section": return hasAriaName(el) ? "region" : null;
    case "main": return "main";
    case "nav": return "navigation";
    case "dialog": return "dialog";
    default: return null;
  }
}

function hasAriaName(el: Element): boolean {
  return !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title"));
}

// roles whose name comes from their visible content (AnyMCP also treats alert/status this way, which
// the ARIA spec does not — documented in docs/supported-capabilities.md)
const NAME_FROM_CONTENT = new Set<Role>([
  "button", "link", "heading", "cell", "columnheader", "listitem", "tab", "alert", "status", "row",
  "checkbox", "radio", "switch", "option", "menuitem",
]);

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** Rendered text gathered through shadow roots and slots. Only used when `innerText` (which stops at shadow hosts) is empty. */
function composedText(node: Node, depth = 0): string {
  if (depth > 12) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (!(node instanceof Element) && !(node instanceof ShadowRoot)) return "";
  if (node instanceof Element) {
    if (SKIP_TAGS.has(node.tagName)) return "";
    // display:contents elements (every <slot> by default) have no box, so checkVisibility() says false for them
    if (node instanceof HTMLElement && node.checkVisibility?.({ visibilityProperty: true }) === false && getComputedStyle(node).display !== "contents") return "";
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) return assigned.map((n) => composedText(n, depth + 1)).join(" ");
    }
    const sr = shadowRootOf(node);
    if (sr) return composedText(sr, depth + 1); // light children only render through slots
  }
  return [...node.childNodes].map((n) => composedText(n, depth + 1)).join(" ");
}

export function visibleText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
  const t = norm(raw);
  if (t) return t;
  // innerText does not see into shadow roots: a web-component button would otherwise have no text at all
  // a <slot> renders content innerText does not report; so do shadow roots below this element
  if (!shadowRootOf(el) && !el.querySelector("slot") && ![...el.querySelectorAll("*")].some((d) => shadowRootOf(d))) return t;
  return norm(composedText(el));
}

export function accessibleName(el: Element, role: Role | null = computeRole(el)): string {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => (el.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? document.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => visibleText(n) || norm(n.textContent))
      .join(" ");
    if (norm(t)) return norm(t);
  }
  const aria = norm(el.getAttribute("aria-label"));
  if (aria) return aria;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = [...(el.labels ?? [])].map((l) => norm(l.textContent)).filter(Boolean);
    if (labels.length) return labels.join(" ");
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) return norm(el.value) || (el.type === "submit" ? "Submit" : "");
    if (el instanceof HTMLInputElement && el.type === "image") return norm(el.alt);
    const ph = norm(el.getAttribute("placeholder"));
    if (ph) return ph;
  }
  if (isEditableRoot(el)) {
    const ph = norm(el.getAttribute("aria-placeholder") ?? el.getAttribute("data-placeholder"));
    if (ph) return ph;
  }
  if (el instanceof HTMLImageElement) return norm(el.alt);
  if (role && NAME_FROM_CONTENT.has(role)) {
    const t = visibleText(el);
    if (t) return t;
  }
  if (role === "table") {
    const cap = el.querySelector("caption");
    if (cap) return norm(cap.textContent);
  }
  return norm(el.getAttribute("title"));
}

export function nameMatches(actual: string, wanted: string, exact: boolean | undefined): boolean {
  if (exact === false) return actual.toLowerCase().includes(norm(wanted).toLowerCase());
  return actual === norm(wanted);
}

// ---- resolution --------------------------------------------------------------
export type ResolveProblem = "param_missing" | "within_missing" | "within_ambiguous";
export interface ResolveResult {
  elements: Element[];
  problem?: ResolveProblem;
}

function textMatches(el: Element, wanted: string, exact: boolean | undefined): boolean {
  const t = visibleText(el);
  return exact === false ? t.toLowerCase().includes(norm(wanted).toLowerCase()) : t === norm(wanted);
}

function resolveLeaf(leaf: LocatorLeaf, args: Args, root: ParentNode): ResolveResult {
  switch (leaf.by) {
    case "role": {
      let name: string | undefined;
      if (leaf.name !== undefined) {
        name = resolveText(leaf.name, args);
        if (name === undefined) return { elements: [], problem: "param_missing" };
      }
      const els = deepQueryAll(root, roleSelector(leaf.role)).filter(
        (el) => computeRole(el) === leaf.role && isVisible(el) && (name === undefined || nameMatches(accessibleName(el, leaf.role), name, leaf.exact)),
      );
      return { elements: els };
    }
    case "label": {
      const text = resolveText(leaf.text, args);
      if (text === undefined) return { elements: [], problem: "param_missing" };
      const controls = deepQueryAll(root, "input,textarea,select,[contenteditable]").filter((el) => {
        if (!isVisible(el)) return false;
        if (el.hasAttribute("contenteditable") && !isEditableRoot(el)) return false;
        const labels = [...((el as HTMLInputElement).labels ?? [])].map((l) => norm(l.textContent));
        const aria = norm(el.getAttribute("aria-label"));
        return [...labels, aria].some((l) => l && nameMatches(l, text, leaf.exact));
      });
      return { elements: controls };
    }
    case "testid": {
      const els = deepQueryAll(root, `[data-testid="${CSS.escape(leaf.id)}"]`).filter(isVisible);
      return { elements: els };
    }
    case "field": {
      const label = resolveText(leaf.label, args);
      if (label === undefined) return { elements: [], problem: "param_missing" };
      const out: Element[] = [];
      for (const h of deepQueryAll(root, "th,dt")) {
        if (!isVisible(h) || !nameMatches(norm(h.textContent).replace(/:$/, ""), label.replace(/:$/, ""), leaf.exact)) continue;
        const v = h.nextElementSibling;
        if (v && isVisible(v) && ((h.tagName === "TH" && v.tagName === "TD") || (h.tagName === "DT" && v.tagName === "DD"))) out.push(v);
      }
      return { elements: out };
    }
    case "css": {
      try {
        return { elements: deepQueryAll(root, leaf.selector).filter(isVisible) };
      } catch {
        return { elements: [] }; // invalid selector: treated as "not found", never executed as anything else
      }
    }
    case "text": {
      const text = resolveText(leaf.text, args);
      if (text === undefined) return { elements: [], problem: "param_missing" };
      const matched: Element[] = [];
      for (const el of deepQueryAll(root, "*")) {
        if (SKIP_TAGS.has(el.tagName) || el === document.documentElement || el.tagName === "HEAD" || !isVisible(el)) continue;
        if (textMatches(el, text, leaf.exact)) matched.push(el);
      }
      // keep only the deepest matches: drop an element if one of its (composed) descendants also matched
      const set = new Set(matched);
      const hasMatchedDescendant = new Set<Element>();
      for (const el of matched) {
        for (let p = composedParent(el); p; p = composedParent(p)) if (set.has(p)) hasMatchedDescendant.add(p);
      }
      return { elements: matched.filter((el) => !hasMatchedDescendant.has(el) && el !== root) };
    }
  }
}

export function resolveLocator(loc: Locator | LocatorLeaf, args: Args, root: ParentNode = document): ResolveResult {
  const within = "within" in loc ? loc.within : undefined;
  let scope: ParentNode = root;
  if (within) {
    const container = resolveLeaf(within, args, root);
    if (container.problem) return { elements: [], problem: container.problem };
    if (container.elements.length === 0) return { elements: [], problem: "within_missing" };
    if (container.elements.length > 1) return { elements: [], problem: "within_ambiguous" };
    scope = container.elements[0]!;
  }
  return resolveLeaf(loc as LocatorLeaf, args, scope);
}

/** Stable fingerprint of one element for approval binding: what it is, what it says, and which one of its kind it is. */
export function fingerprintElement(el: Element, role: Role | null = computeRole(el)): string {
  const name = accessibleName(el, role);
  const same = deepQueryAll(document, el.localName).filter((e) => computeRole(e) === role && accessibleName(e, role) === name);
  return [role ?? "none", el.tagName.toLowerCase(), name, String(same.indexOf(el)), String(same.length)].join("|");
}
