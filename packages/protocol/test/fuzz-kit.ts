// Shared, dependency-free machinery for the property-based ("fuzz") tests: a seeded generator, a runner that
// reports the seed of a failing case, and JSON text generators. Not a test file itself.
//   ANYMCP_FUZZ_RUNS (default 400) and ANYMCP_FUZZ_SEED (default fixed) set the campaign; CI uses the defaults so a
//   failure can be replayed exactly.

export const RUNS = Number(process.env.ANYMCP_FUZZ_RUNS ?? 400);
export const BASE_SEED = Number(process.env.ANYMCP_FUZZ_SEED ?? 20261116);

export type Rng = { (): number; int(n: number): number; pick<T>(xs: readonly T[]): T; bool(p?: number): boolean };

/** mulberry32: small, fast, good enough for test-case generation. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const r = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  r.int = (n) => Math.floor(r() * n);
  r.pick = (xs) => xs[r.int(xs.length)]!;
  r.bool = (p = 0.5) => r() < p;
  return r;
}

const seedFor = (i: number) => (BASE_SEED + i * 7919) >>> 0;
const failure = (name: string, seed: number, i: number, e: unknown) =>
  new Error(`${name}: failed with seed ${seed} (run ${i}; replay with ANYMCP_FUZZ_SEED=${BASE_SEED}): ${(e as Error).message}`);

/** Run `prop` `runs` times with derived seeds; on failure, report the seed so the case can be replayed. */
export function forAll(name: string, prop: (r: Rng, i: number) => void, runs = RUNS): void {
  for (let i = 0; i < runs; i++) {
    const seed = seedFor(i);
    try {
      prop(rng(seed), i);
    } catch (e) {
      throw failure(name, seed, i, e);
    }
  }
}
export async function forAllAsync(name: string, prop: (r: Rng, i: number) => Promise<void>, runs = RUNS): Promise<void> {
  for (let i = 0; i < runs; i++) {
    const seed = seedFor(i);
    try {
      await prop(rng(seed), i);
    } catch (e) {
      throw failure(name, seed, i, e);
    }
  }
}

// ---- JSON as it really arrives (always through JSON.parse) -----------------------------------------------------
export const TRICKY_KEYS = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "", " ", "a", "A", "1", "01", "-1", "é", "é", "\u0000", "😀", "a\"b", "a\\b", "\n"];
export const TRICKY_STRINGS = ["", " ", "\u0000", " ", "\ud800", "😀", "\"", "\\", "</script>", "{order_id}", "null", "0", "-0", "1e3", "ä", "á"];

export function genWord(r: Rng): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0, n = 1 + r.int(10); i < n; i++) s += alphabet[r.int(alphabet.length)];
  return s;
}
export const genKey = (r: Rng): string => (r.bool(0.4) ? r.pick(TRICKY_KEYS) : genWord(r));
export function genString(r: Rng): string {
  if (r.bool(0.3)) return r.pick(TRICKY_STRINGS);
  let s = "";
  for (let i = 0, n = r.int(12); i < n; i++) s += String.fromCharCode(r.bool(0.85) ? 32 + r.int(95) : r.int(0xffff));
  return s;
}
export function genNumber(r: Rng): number {
  return r.pick([0, -0, 1, -1, 0.1, 1e21, 1e-7, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE, 1.7976931348623157e308, r() * 1000 - 500, r.int(1000)]);
}
/** JSON TEXT written by hand, so keys like "__proto__" survive as own keys once parsed. */
export function genJsonText(r: Rng, depth = 0): string {
  const k = depth > 3 ? r.int(4) : r.int(6);
  switch (k) {
    case 0:
      return "null";
    case 1:
      return r.bool() ? "true" : "false";
    case 2:
      return JSON.stringify(genNumber(r));
    case 3:
      return JSON.stringify(genString(r));
    case 4:
      return `[${Array.from({ length: r.int(4) }, () => genJsonText(r, depth + 1)).join(",")}]`;
    default: {
      const keys = [...new Set(Array.from({ length: r.int(5) }, () => genKey(r)))];
      return `{${keys.map((key) => `${JSON.stringify(key)}:${genJsonText(r, depth + 1)}`).join(",")}}`;
    }
  }
}
export const genJson = (r: Rng): unknown => JSON.parse(genJsonText(r));
