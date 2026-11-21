import { describe, expect, it } from "vitest";
import { buildDraft, type DraftSpec } from "../src/shared/draft";

// Names such as "Constructor" become the identifier "constructor", which every plain object inherits. They must be
// treated like any other name (found by code review after the protocol fuzz tests fixed the same class of bug).
const spec = (outputName: string): DraftSpec => ({
  id: "f1_standings",
  title: "Standings",
  description: "Read one value from the page.",
  origin: "http://127.0.0.1:4173",
  entryPath: "/orders",
  params: [],
  steps: [],
  outputs: [{ id: "o1", name: outputName, kind: "text", locator: { by: "testid", id: "x" }, as: "string", optional: false, use: "result" }],
  signals: [{ id: "g1", kind: "success", locator: { by: "text", text: "Orders" } }],
  approvalText: "",
});

describe("buildDraft with names that collide with Object.prototype", () => {
  for (const name of ["Constructor", "toString", "hasOwnProperty", "valueOf"]) {
    it(`a single output named "${name}" is not reported as a duplicate`, () => {
      const r = buildDraft(spec(name), 1);
      expect(r.errors.filter((e) => e.startsWith("Two outputs"))).toEqual([]);
    });
  }
});
