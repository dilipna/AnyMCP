import { describe, expect, it } from "vitest";
import { siteOrigin } from "../src/shared/site";

describe("siteOrigin: what a person types becomes ONE exact origin", () => {
  it("accepts a bare host, a full page address, and reduces both to the origin", () => {
    expect(siteOrigin("books.toscrape.com")).toEqual({ ok: true, origin: "https://books.toscrape.com" });
    expect(siteOrigin("  https://en.wikipedia.org/wiki/Special:Search?search=x#top ")).toEqual({ ok: true, origin: "https://en.wikipedia.org" });
    expect(siteOrigin("https://example.com:8443/a")).toEqual({ ok: true, origin: "https://example.com:8443" });
  });

  it("allows plain http only on this computer", () => {
    expect(siteOrigin("http://localhost:4173/orders")).toEqual({ ok: true, origin: "http://localhost:4173" });
    expect(siteOrigin("http://127.0.0.1:4173")).toEqual({ ok: true, origin: "http://127.0.0.1:4173" });
    expect(siteOrigin("http://example.com")).toMatchObject({ ok: false });
  });

  it("refuses anything that is not one exact website", () => {
    for (const bad of ["", "   ", "chrome://extensions", "file:///etc/passwd", "javascript:alert(1)", "https://*.example.com", "https://user:pw@example.com", "not a url"]) {
      expect(siteOrigin(bad), bad).toMatchObject({ ok: false });
    }
  });
});
