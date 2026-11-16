// Plain text from an HTML fragment, for the evaluations' INDEPENDENT reading of a page (compared with what AnyMCP
// returned). Never rendered as HTML. Two details matter (both flagged by CodeQL):
//  - entities are decoded in ONE pass, so "&amp;lt;" becomes the text "&lt;", not "<";
//  - tags are removed until none are left, so a fragment like "<scr<b>ipt>" cannot leave a tag behind.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Remove tags the way a browser recognises them ("<" then a letter, "/", "!" or "?"), repeatedly until none are
 *  left. A "<" in ordinary text ("x < y") is kept, as a browser shows it. */
export function stripTags(s: string): string {
  let prev: string;
  let out = s;
  do {
    prev = out;
    out = out.replace(/<[a-zA-Z/!?][^<>]*>/g, "");
  } while (out !== prev);
  return out;
}

export const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").trim();

/** Visible text of an HTML fragment: tags removed, entities decoded once, whitespace collapsed. */
export const htmlText = (s: string) => normalizeSpace(decodeEntities(stripTags(s)));
