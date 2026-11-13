// Store-readiness guards on the PRODUCTION build: what ships must be exactly what the listing and privacy
// policy describe. Builds the prod target, then inspects the output.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const dist = resolve(root, "packages/extension/dist/prod");
const read = (f: string) => readFileSync(resolve(dist, f), "utf8");

beforeAll(() => {
  execFileSync(process.execPath, [resolve(root, "packages/extension/scripts/build.mjs"), "--target=prod"], { stdio: "ignore" });
});

describe("production extension bundle", () => {
  it("manifest permissions are exactly the reviewed list — nothing fixed, everything per-site and optional", () => {
    const m = JSON.parse(read("manifest.json"));
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe("MyCP Extension");
    expect(m.permissions.sort()).toEqual(["alarms", "scripting", "sidePanel", "storage"]);
    expect(m.host_permissions).toEqual([]); // no host access at install
    expect(m.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]); // granted one origin at a time at runtime
    expect(m.content_scripts).toBeUndefined(); // injected on demand, never declared on all sites
    expect(m.externally_connectable).toBeUndefined(); // no web page can message the extension
    expect(m.web_accessible_resources).toBeUndefined();
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
    expect(m.description.length).toBeLessThanOrEqual(132);
    expect(m.minimum_chrome_version).toBe("116");
  });

  it("contains no test hooks (they are compiled out, not merely disabled)", () => {
    for (const f of ["background.js", "content.js", "sidepanel.js"]) {
      const src = read(f);
      expect(src, f).not.toContain("__test");
      expect(src, f).not.toContain("swStartedAt");
      expect(src, f).not.toContain("127.0.0.1:4173"); // no fixture address baked in
    }
  });

  it("uses no eval / new Function (forbidden by the MV3 content security policy)", () => {
    for (const f of ["background.js", "content.js", "sidepanel.js"]) {
      expect(read(f), f).not.toMatch(/new Function\(|[^a-zA-Z.$_]eval\(/);
    }
  });

  it("loads no remote code: no remote script or import URLs in the shipped files", () => {
    const html = read("sidepanel.html");
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:/);
    for (const f of ["background.js", "content.js", "sidepanel.js"]) {
      expect(read(f), f).not.toMatch(/import\(\s*["']https?:|importScripts\(\s*["']https?:|<script[^>]+src=["']https?:/);
    }
  });

  it("the content script stays small (it is injected into web pages)", () => {
    expect(Buffer.byteLength(read("content.js"))).toBeLessThan(60_000);
  });

  it("ships the icons the manifest names, and nothing unexpected", () => {
    for (const s of [16, 32, 48, 128]) expect(existsSync(resolve(dist, `icons/icon-${s}.png`))).toBe(true);
    expect(readdirSync(dist).sort()).toEqual(["background.js", "content.js", "icons", "manifest.json", "sidepanel.css", "sidepanel.html", "sidepanel.js"]);
  });

  it("no source maps ship in production", () => {
    for (const f of ["background.js", "content.js", "sidepanel.js"]) expect(read(f), f).not.toContain("sourceMappingURL");
  });
});
