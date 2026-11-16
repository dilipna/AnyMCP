import { describe, expect, it } from "vitest";
import { MAX_JSON_DEPTH, nestsDeeperThan } from "../src/http";

describe("request nesting limit", () => {
  it("counts array and object levels", () => {
    expect(nestsDeeperThan("{}", 0)).toBe(true);
    expect(nestsDeeperThan("{}", 1)).toBe(false);
    expect(nestsDeeperThan('{"a":[{"b":[1]}]}', 4)).toBe(false);
    expect(nestsDeeperThan('{"a":[{"b":[1]}]}', 3)).toBe(true);
    expect(nestsDeeperThan("[".repeat(MAX_JSON_DEPTH) + "]".repeat(MAX_JSON_DEPTH), MAX_JSON_DEPTH)).toBe(false);
    expect(nestsDeeperThan("[".repeat(MAX_JSON_DEPTH + 1) + "]".repeat(MAX_JSON_DEPTH + 1), MAX_JSON_DEPTH)).toBe(true);
  });
  it("ignores brackets inside strings, including after escaped quotes and backslashes", () => {
    expect(nestsDeeperThan(JSON.stringify({ s: "[[[[[[{{{{{{" }), 1)).toBe(false);
    expect(nestsDeeperThan(JSON.stringify({ s: 'say \\"[[[[\\" and \\' }), 1)).toBe(false);
    expect(nestsDeeperThan(JSON.stringify({ s: "\\", t: [[[1]]] }), 3)).toBe(true);
  });
  it("is iterative: a 500,000-level body is measured without overflowing", () => {
    const n = 500_000;
    expect(nestsDeeperThan("[".repeat(n) + "]".repeat(n), MAX_JSON_DEPTH)).toBe(true);
  });
});
