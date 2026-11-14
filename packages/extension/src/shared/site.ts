// Turning what a person types or pastes ("books.toscrape.com", a full page URL, ...) into the exact site origin
// AnyMCP asks Chrome for. Pure, so it can be unit-tested.

import { isLoopbackHost } from "anymcp-protocol";

export type SiteParse = { ok: true; origin: string } | { ok: false; error: string };

export function siteOrigin(input: string): SiteParse {
  let s = input.trim();
  if (!s) return { ok: false, error: "Enter the website’s address." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`; // "example.com" means the secure site
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "That is not a web address. Example: https://books.toscrape.com" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Only web pages (https://) can be allowed." };
  if (u.username || u.password) return { ok: false, error: "Leave out any user name or password from the address." };
  if (!u.hostname || u.hostname.includes("*")) return { ok: false, error: "Enter one exact website (no wildcards)." };
  if (u.protocol === "http:" && !isLoopbackHost(u.hostname)) {
    return { ok: false, error: "AnyMCP only works on secure sites (https://), or on this computer (localhost)." };
  }
  return { ok: true, origin: u.origin };
}
