// Reading a number out of page text ("£1,234.56", "12,50 €", "₹12,34,567") for outputs marked as numbers. A wrong
// number would be returned as a success, so an unclear format gives null (the tool then reports that it could not
// read a number) instead of a guess. 2026-11-25: the previous reader removed every space and comma, so "12,50 €" was
// 1250, "1.234,56" was 1.234 and "10 20" was 1020.
//
// Ambiguities kept on purpose (docs/known-limitations.md): "1,234" is one thousand two hundred and thirty-four and
// "1.234" is one point two three four, as in English; the first number in the text is read ("3–5 days" is 3); a
// suffix such as "k" or "M" is not applied.

const MINUS = /[\u2212\uFE63\uFF0D]/g; // minus sign, small and full-width hyphen-minus
const SPACES = /[\u00a0\u2007\u2009\u202f]/g; // no-break, figure, thin and narrow no-break spaces

/** Thousands grouping: "1,234,567" (groups of three) or Indian "12,34,567" (twos, then a final three). */
function grouped(groups: string[]): boolean {
  const [first, ...rest] = groups;
  if (!first || rest.length === 0) return true;
  if (first.length <= 3 && rest.every((g) => g.length === 3)) return true;
  return rest.length >= 2 && first.length <= 2 && rest.at(-1)!.length === 3 && rest.slice(0, -1).every((g) => g.length === 2);
}

/** Digits and at most one decimal separator ("." or ","), any other separator being thousands grouping. */
function digitsValue(token: string): number | null {
  const seps = token.match(/[.,]/g) ?? [];
  if (seps.length === 0) return Number(token);
  const kinds = [...new Set(seps)];
  let decimal: string | null;
  if (kinds.length === 2) {
    decimal = seps.at(-1)!; // "1,234.56" and "1.234,56": the last kind is the decimal point, once
    if (seps.filter((x) => x === decimal).length !== 1) return null;
  } else if (seps.length > 1) {
    decimal = null; // "1,234,567", "1.234.567": grouping only
  } else if (kinds[0] === ".") {
    decimal = ".";
  } else {
    const [int, frac] = token.split(",") as [string, string];
    decimal = frac.length === 3 && int !== "0" && int.length <= 3 ? null : ","; // "1,250" grouping; "12,50", "0,250" decimal
  }
  const [intPart, fracPart] = decimal ? (token.split(decimal) as [string, string?]) : [token, undefined];
  const group = kinds.find((k) => k !== decimal);
  const intGroups = group ? intPart.split(group) : [intPart];
  if (!grouped(intGroups)) return null;
  return Number(`${intGroups.join("")}${fracPart !== undefined ? `.${fracPart}` : ""}`);
}

export function parseNumber(text: string): number | null {
  const t = text.replace(MINUS, "-").replace(SPACES, " ");
  const m = /\d+(?:[.,' ]\d+)*/.exec(t);
  if (!m) return null;
  let token = m[0];
  // spaces and apostrophes only group thousands ("1 234 567", "1'234.50"); otherwise they separate two numbers
  if (/[' ]/.test(token)) {
    const chunks = token.split(/[' ]/);
    const ok = /^\d{1,3}$/.test(chunks[0]!) && chunks.slice(1, -1).every((c) => /^\d{3}$/.test(c)) && /^\d{3}(?:[.,]\d+)?$/.test(chunks.at(-1)!);
    token = ok ? chunks.join("") : chunks[0]!;
  }
  const value = digitsValue(token);
  if (value === null || !Number.isFinite(value)) return null;
  // a minus right before the digits, not part of a code such as "A-12"
  const negative = t[m.index - 1] === "-" && !/[\p{L}\p{N}]/u.test(t[m.index - 2] ?? "");
  return negative ? -value : value;
}
