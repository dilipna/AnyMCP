import { describe, expect, it } from "vitest";
import { decodeEntities, htmlText, stripTags } from "../src/html-text";

describe("plain text for the independent page reading", () => {
  it("decodes entities once (no double unescaping)", () => {
    expect(decodeEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeEntities("Tom &amp; Jerry &quot;live&quot; &#39;99 &#x263A; &apos;")).toBe(`Tom & Jerry "live" '99 ☺ '`);
    expect(decodeEntities("&unknown; &#99999999;")).toBe("&unknown; &#99999999;");
  });
  it("removes nested and broken tags completely", () => {
    expect(stripTags("<scr<b>ipt>alert(1)</script>")).toBe("alert(1)");
    expect(stripTags("a <i>b</i> c")).toBe("a b c");
    expect(stripTags("x < y > z")).toBe("x < y > z"); // not a tag, as in a browser
    expect(stripTags("<<b>i>text")).toBe("text");
  });
  it("gives the visible text of real fragments from the sandboxes", () => {
    expect(htmlText('  <a href="x" title="A Light in the Attic">A Light in the ...</a> ')).toBe("A Light in the ...");
    expect(htmlText("\n  In stock (22 available)\n ")).toBe("In stock (22 available)");
    expect(htmlText("Sharp Objects &amp; Other")).toBe("Sharp Objects & Other");
  });
});
