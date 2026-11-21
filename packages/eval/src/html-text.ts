// Plain text from an HTML fragment, for the evaluations' INDEPENDENT reading of a page (compared with what AnyMCP
// returned). Never rendered as HTML. Two details matter (both flagged by CodeQL):
//  - entities are decoded in ONE pass, so "&amp;lt;" becomes the text "&lt;", not "<";
//  - tags are removed until none are left, so a fragment like "<scr<b>ipt>" cannot leave a tag behind.

/** Common named entities (markup, typography, Latin-1 letters and symbols). An entity not listed stays as written, so
 *  the comparison reports a mismatch rather than hiding one. */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", bull: "•", middot: "·", prime: "′", Prime: "″", dagger: "†",
  copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", iexcl: "¡", iquest: "¿", shy: "­",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", szlig: "ß",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(NAMED, body) ? NAMED[body]! : whole; // case matters: &Eacute; is not &eacute;
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
