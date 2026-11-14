import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_DISPLAY_NAME, ANYMCP_VERSION, PRODUCT_NAME, PRODUCT_STATEMENT } from "../src";

const root = resolve(import.meta.dirname, "../../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8")) as { version?: string; name?: string; private?: boolean };

describe("one version, one name everywhere", () => {
  it("every package.json matches ANYMCP_VERSION and is private (nothing here is published)", () => {
    const files = ["package.json", ...readdirSync(resolve(root, "packages")).map((d) => `packages/${d}/package.json`)];
    for (const f of files) {
      const j = json(f);
      expect(j.version, f).toBe(ANYMCP_VERSION);
      expect(j.private, `${f} must stay private until the naming check is resolved`).toBe(true);
    }
  });

  it("the product names are used consistently", () => {
    expect(PRODUCT_NAME).toBe("AnyMCP");
    expect(EXTENSION_DISPLAY_NAME).toBe("AnyMCP Extension");
    expect(PRODUCT_STATEMENT).toBe("Teach a website task once, review it, and let your AI app run it as an MCP tool.");
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    expect(readme).toContain(PRODUCT_STATEMENT);
    expect(readme).not.toMatch(/SiteTools/i); // the old working name must not survive anywhere user-facing
    expect(readme).not.toMatch(/MyCP Extension/); // the pre-release name may only appear as history
  });

  it("the extension manifest description fits the Web Store limit and states the product", () => {
    const build = readFileSync(resolve(root, "packages/extension/scripts/build.mjs"), "utf8");
    const m = /description: "([^"]+)"/.exec(build);
    expect(m).toBeTruthy();
    expect(m![1]!.length).toBeLessThanOrEqual(132);
    expect(m![1]).toContain(PRODUCT_STATEMENT);
    expect(m![1]).toMatch(/bridge/); // the store summary must say the extension needs the local bridge
  });
});
