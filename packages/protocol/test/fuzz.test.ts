// Property-based ("fuzz") tests for the protocol code that handles untrusted input: canonical hashing (approval
// binding, tool versions, duplicate detection), sensitive-field detection, argument validation, parameter
// substitution and tool-definition parsing.
//
// Dependency-free and deterministic (see fuzz-kit.ts): a CI failure can be replayed exactly; each failure message
// names the seed and the input. Longer local campaign:
//   ANYMCP_FUZZ_RUNS=20000 ANYMCP_FUZZ_SEED=12345 npx vitest run packages/protocol/test/fuzz.test.ts

import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  hashCanonical,
  parseToolDefinition,
  renderEntryPath,
  renderTemplate,
  toolDefinitionHash,
  validateAgainstSchema,
  validateToolPolicy,
  SchemaSubsetZ,
  type SchemaSubset,
  type ToolDefinition,
} from "../src";
import { isSensitiveField, looksSensitive, resolveText } from "../src/light";
import { forAll, forAllAsync, genJson, genKey, genWord, type Rng } from "./fuzz-kit";

/** Independent reference: every OWN key written out directly, in the order canonicalJson documents: array-index
 *  keys ("0", "1", …) first in numeric order (JSON.stringify always lists them first), then the rest sorted. */
const isIndexKey = (k: string) => String(Number(k) >>> 0) === k && Number(k) >>> 0 !== 4294967295;
function refCanonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(refCanonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const present = Object.keys(o).filter((key) => o[key] !== undefined);
  const keys = [...present.filter(isIndexKey).sort((a, b) => Number(a) - Number(b)), ...present.filter((k) => !isIndexKey(k)).sort()];
  return `{${keys.map((key) => `${JSON.stringify(key)}:${refCanonical(o[key])}`).join(",")}}`;
}
/** Same value, keys inserted in a different order (own properties kept, including "__proto__"). */
function reorder(v: unknown, r: Rng): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => reorder(x, r));
  const entries = Object.entries(v as Record<string, unknown>);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of entries) Object.defineProperty(out, key, { value: reorder(val, r), enumerable: true, writable: true, configurable: true });
  return out;
}

describe("canonical JSON (approval binding, tool versions, duplicate detection)", () => {
  it("equals an independent reference for every JSON value, including keys like __proto__", () => {
    forAll("canonical = reference", (r) => {
      const v = genJson(r);
      expect(canonicalJson(v), JSON.stringify(v)).toBe(refCanonical(v));
    });
  });
  it("does not depend on key order", () => {
    forAll("order independence", (r) => {
      const v = genJson(r);
      expect(canonicalJson(reorder(v, r))).toBe(canonicalJson(v));
    });
  });
  it("round-trips: parsing the canonical text gives the same canonical text", () => {
    forAll("round trip", (r) => {
      const c = canonicalJson(genJson(r));
      expect(canonicalJson(JSON.parse(c))).toBe(c);
    });
  });
  it("hashes values that differ only by a __proto__ key differently", async () => {
    const a = JSON.parse('{"args":{"note":"hi"}}');
    const b = JSON.parse('{"args":{"note":"hi","__proto__":{"note":"bye"}}}');
    expect(await hashCanonical(a)).not.toBe(await hashCanonical(b));
  });
});

// ---- sensitive fields ------------------------------------------------------------------------------------------
const SENSITIVE_AUTOCOMPLETE = ["cc-name", "cc-given-name", "cc-family-name", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-type", "one-time-code", "current-password", "new-password"];
const BENIGN_AUTOCOMPLETE = ["email", "name", "given-name", "street-address", "address-line1", "postal-code", "country", "tel", "username", "organization", "off", "on", "bday"];
const randomCase = (s: string, r: Rng) => [...s].map((ch) => (r.bool(0.3) ? ch.toUpperCase() : ch)).join("");
const ws = (r: Rng) => r.pick([" ", "  ", "\t", " \n "]);

/** A valid autocomplete token list: [section-*] [shipping|billing] field [webauthn], in random case and spacing. */
function autocompleteList(field: string, r: Rng): string {
  const tokens: string[] = [];
  if (r.bool()) tokens.push(`section-${genWord(r).toLowerCase()}`);
  if (r.bool()) tokens.push(r.pick(["shipping", "billing"]));
  tokens.push(field);
  if (field.endsWith("password") && r.bool(0.3)) tokens.push("webauthn");
  return (r.bool(0.3) ? ws(r) : "") + tokens.map((t) => randomCase(t, r)).join(ws(r)) + (r.bool(0.3) ? ws(r) : "");
}

const SENSITIVE_WORDS = ["password", "passcode", "passwd", "pwd", "otp", "one time", "token", "secret", "api key", "ssn", "social security", "card number", "credit card", "cvv", "cvc", "csc", "iban", "routing number", "security code", "verification code"];
const NEUTRAL_WORDS = ["user", "new", "confirm", "your", "customer", "field", "input", "account", "billing", "main"];
/** Join words the ways real field names do: camelCase, PascalCase, snake, kebab, dotted, spaced, and an acronym
 *  for a short sensitive word (userSSN, OTPCode, CVVNumber). `sensitive` is the sensitive word in `words`. */
function joinName(words: string[], r: Rng, sensitive: string): string {
  const parts = words.flatMap((w) => w.split(" "));
  switch (r.int(7)) {
    case 0:
      return parts.map((p, i) => (i ? p[0]!.toUpperCase() + p.slice(1) : p)).join("");
    case 1:
      return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
    case 2:
      return parts.join("_");
    case 3:
      return parts.join("-");
    case 4:
      return parts.join(".");
    case 5:
      return parts.map((p) => (p === sensitive && p.length <= 4 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1))).join("");
    default:
      return parts.join(" ");
  }
}

describe("sensitive fields are always recognised", () => {
  it("any valid autocomplete list naming a payment, one-time-code or password field", () => {
    forAll("autocomplete", (r) => {
      const ac = autocompleteList(r.pick(SENSITIVE_AUTOCOMPLETE), r);
      expect(isSensitiveField({ type: "text", autocomplete: ac, name: "f" }), JSON.stringify(ac)).toBe(true);
    });
  });
  it("password, hidden and file inputs in any letter case", () => {
    forAll("type", (r) => {
      const t = randomCase(r.pick(["password", "hidden", "file"]), r);
      expect(isSensitiveField({ type: t, name: "x" }), t).toBe(true);
    });
  });
  it("names, ids and labels built from a sensitive word, however they are joined, with or without a digit", () => {
    forAll("names", (r) => {
      const sensitive = r.pick(SENSITIVE_WORDS);
      const words = [sensitive];
      if (r.bool()) words.unshift(r.pick(NEUTRAL_WORDS));
      if (r.bool(0.3)) words.push(r.pick(NEUTRAL_WORDS));
      let name = joinName(words, r, sensitive);
      if (r.bool(0.3)) name += String(1 + r.int(9));
      expect(looksSensitive(name), JSON.stringify(name)).toBe(true);
      expect(isSensitiveField({ type: "text", name }), JSON.stringify(name)).toBe(true);
    });
  });
  it("leaves ordinary fields alone", () => {
    const benignNames = ["email", "firstName", "last_name", "search", "q", "quantity", "order_id", "orderId", "postcode", "zip", "city", "passenger", "passengerName", "compass", "bypassCache", "passage", "passport_country", "tokenizer", "secretary", "keyword", "cardholder_note", "promo_code", "coupon", "address2", "line1", "phone", "notes", "title", "date_from", "amount", "constructor", "category", "sort", "page2"];
    for (const name of benignNames) expect(isSensitiveField({ type: "text", name, label: name }), name).toBe(false);
    forAll("benign autocomplete", (r) => {
      const ac = autocompleteList(r.pick(BENIGN_AUTOCOMPLETE), r);
      expect(isSensitiveField({ type: "text", autocomplete: ac, name: "f" }), JSON.stringify(ac)).toBe(false);
    });
  });
});

// ---- argument validation and parameter substitution -----------------------------------------------------------
const PARAM_NAMES = ["constructor", "order_id", "note", "q", "value", "category", "a1", "x_y_z"];
function genSchema(r: Rng, depth = 0): SchemaSubset {
  const k = depth >= 2 ? r.int(4) : r.int(6);
  switch (k) {
    case 0:
      return r.bool(0.3) ? { type: "string", enum: ["a", "b", "constructor"] } : { type: "string", maxLength: 1 + r.int(50) };
    case 1:
      return { type: "integer", minimum: -5, maximum: 5 };
    case 2:
      return { type: "number" };
    case 3:
      return { type: "boolean" };
    case 4:
      return { type: "array", items: genSchema(r, depth + 1), maxItems: 3 };
    default: {
      const names = [...new Set(Array.from({ length: 1 + r.int(3) }, () => r.pick(PARAM_NAMES)))];
      const properties = Object.fromEntries(names.map((n) => [n, genSchema(r, depth + 1)]));
      return { type: "object", properties, required: names.filter(() => r.bool()), additionalProperties: false };
    }
  }
}
/** A value that satisfies `s`, as JSON text parsed like real arguments. */
function conforming(s: SchemaSubset, r: Rng): unknown {
  switch (s.type) {
    case "string":
      return s.enum ? r.pick(s.enum) : "x".repeat(r.int((s.maxLength ?? 5) + 1));
    case "integer":
      return r.int(11) - 5;
    case "number":
      return r() * 10;
    case "boolean":
      return r.bool();
    case "array":
      return Array.from({ length: r.int((s.maxItems ?? 2) + 1) }, () => conforming(s.items, r));
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(s.properties)) if ((s.required ?? []).includes(k) || r.bool()) out[k] = conforming(sub, r);
      return JSON.parse(JSON.stringify(out));
    }
  }
}

describe("arguments from the AI app", () => {
  it("every generated schema is a valid schema", () => {
    forAll("schema validity", (r) => {
      const s = genSchema(r);
      expect(SchemaSubsetZ.safeParse(s).success, JSON.stringify(s)).toBe(true);
    });
  });
  it("a conforming value has no issues; removing a required field (even one named 'constructor') is reported", () => {
    forAll("required fields", (r) => {
      const props = Object.fromEntries([...new Set(["constructor", r.pick(PARAM_NAMES)])].map((n) => [n, genSchema(r, 1)]));
      const s: SchemaSubset = { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
      const v = conforming(s, r) as Record<string, unknown>;
      expect(validateAgainstSchema(s, v), JSON.stringify(v)).toEqual([]);
      const missing = r.pick(Object.keys(props));
      const without = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
      delete without[missing];
      const issues = validateAgainstSchema(s, without);
      expect(issues.some((i) => i.path === `$.${missing}` && i.message === "is required"), `${missing}: ${JSON.stringify(issues)}`).toBe(true);
    });
  });
  it("never throws on any value, and rejects keys that are not declared (including __proto__)", () => {
    forAll("arbitrary values", (r) => {
      const s = genSchema(r);
      const v = genJson(r);
      const issues = validateAgainstSchema(s, v);
      if (s.type === "object" && v && typeof v === "object" && !Array.isArray(v)) {
        for (const key of Object.keys(v)) if (!Object.hasOwn(s.properties, key)) expect(issues.some((i) => i.path === `$.${key}`), key).toBe(true);
      }
    });
    const s: SchemaSubset = { type: "object", properties: { note: { type: "string" } }, additionalProperties: false };
    expect(validateAgainstSchema(s, JSON.parse('{"note":"a","__proto__":{"x":1}}'))).toEqual([{ path: "$.__proto__", message: "is not an allowed field" }]);
  });
  it("a missing argument is never filled in from Object.prototype (parameter named 'constructor')", () => {
    forAll("substitution", (r) => {
      const name = r.pick(PARAM_NAMES);
      const args = JSON.parse(r.bool() ? "{}" : '{"other":"1"}') as Record<string, unknown>;
      expect(resolveText({ param: name }, args), name).toBeUndefined();
      expect(resolveText(`a{${name}}b`, args), name).toBeUndefined();
      expect(renderTemplate(`Save {${name}}`, args), name).toBe(`Save {${name}}`);
      expect(renderEntryPath(`/x/{${name}}`, args), name).toBe("/x/");
    });
  });
});

// ---- tool definitions ------------------------------------------------------------------------------------------
const BASE_TOOL: ToolDefinition = {
  schemaVersion: 1,
  id: "list_items",
  version: 1,
  title: "List items",
  description: "Return the names of the items in one category.",
  kind: "read",
  origins: ["https://shop.example"],
  entry: { path: "/items", query: "cat={category}" },
  input: { type: "object", properties: { category: { type: "string", maxLength: 40 }, q: { type: "string", maxLength: 40 } }, required: ["category"], additionalProperties: false },
  output: { type: "object", properties: { names: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["names"], additionalProperties: false },
  steps: [
    { id: "s0", op: "locate", as: "box", locator: { by: "label", text: "Search" } },
    { id: "s1", op: "fill", target: "box", value: { param: "q" } },
    { id: "s2", op: "extract", into: "names", source: { type: "list", locator: { by: "testid", id: "name" }, maxItems: 10 } },
  ],
  preconditions: [{ id: "ready", condition: { kind: "exists", locator: { by: "testid", id: "name" } } }],
  sessionExpiredWhen: [],
  postconditions: [{ id: "shown", condition: { kind: "exists", locator: { by: "testid", id: "name" } } }],
  emptyWhen: [],
  failureWhen: [],
  approval: { required: false, actionTemplate: "", stateFields: [], ttlSeconds: 120 },
  limits: { stepTimeoutMs: 5000, totalTimeoutMs: 30000, maxAttempts: 2 },
  reconcile: false,
} as unknown as ToolDefinition;

/** Random structural mutation: drop, replace or add a key somewhere in the definition. */
function mutate(v: unknown, r: Rng, depth = 0): unknown {
  if (v === null || typeof v !== "object" || (depth > 0 && r.bool(0.25))) return r.bool(0.5) ? genJson(r) : v;
  if (Array.isArray(v)) {
    const a = v.map((x) => (r.bool(0.3) ? mutate(x, r, depth + 1) : x));
    if (r.bool(0.2)) a.splice(r.int(a.length + 1), 0, genJson(r));
    if (r.bool(0.2) && a.length) a.splice(r.int(a.length), 1);
    return a;
  }
  const o = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  const keys = Object.keys(o);
  const action = r.int(3);
  if (action === 0 && keys.length) delete o[r.pick(keys)];
  else if (action === 1 && keys.length) {
    const key = r.pick(keys);
    o[key] = mutate(o[key], r, depth + 1);
  } else Object.defineProperty(o, genKey(r), { value: genJson(r), enumerable: true, writable: true, configurable: true });
  return o;
}

describe("tool definitions from storage or the editor", () => {
  it("the base definition is valid (so mutations start from something real)", () => {
    const p = parseToolDefinition(BASE_TOOL);
    expect(p.ok, p.ok ? "" : p.error).toBe(true);
    if (p.ok) expect(validateToolPolicy(p.tool)).toEqual([]);
  });
  it("parsing and policy checks never throw on a mutated definition, and any change changes the version hash", async () => {
    const baseHash = await toolDefinitionHash(BASE_TOOL);
    await forAllAsync("mutated definitions", async (r) => {
      const text = JSON.stringify(mutate(BASE_TOOL, r));
      const m = JSON.parse(text) as unknown;
      const p = parseToolDefinition(m);
      if (!p.ok) return;
      validateToolPolicy(p.tool); // must not throw
      if (canonicalJson(p.tool) !== canonicalJson(BASE_TOOL)) expect(await toolDefinitionHash(p.tool), text).not.toBe(baseHash);
    });
  });
});
