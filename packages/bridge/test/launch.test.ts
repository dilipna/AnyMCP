import { describe, expect, it } from "vitest";
import { ANYMCP_VERSION } from "anymcp-protocol";
import { RELEASE_PACKAGE_URL, stdioLaunchFor } from "../src/launch";

const base = { execPath: "/usr/bin/node", passThrough: [] as string[], exists: () => true };

describe("how an app should start this bridge over stdio", () => {
  it("the release package address names this exact version on the project's GitHub releases", () => {
    expect(RELEASE_PACKAGE_URL).toBe(
      `https://github.com/dilipna/AnyMCP/releases/download/v${ANYMCP_VERSION}/dilipna-anymcp-bridge-${ANYMCP_VERSION}.tgz`,
    );
  });

  it("from an npx cache: npx with this version's release package, never a path into the cache or a registry name", () => {
    // The package is not on the npm registry, so `npx @dilipna/anymcp-bridge@<v>` would fail with E404 (found
    // 2026-11-22 by starting v0.1.1 with `npx --package=<release URL> anymcp-bridge`: it printed exactly that).
    const self = "/home/u/.npm/_npx/1a2b3c/node_modules/@dilipna/anymcp-bridge/anymcp-bridge.mjs";
    const linux = stdioLaunchFor(self, { ...base, platform: "linux" });
    expect(linux).toEqual({ command: "npx", args: ["-y", `--package=${RELEASE_PACKAGE_URL}`, "anymcp-bridge", "--stdio"] });
    expect(JSON.stringify(linux)).not.toContain("@dilipna/anymcp-bridge@");
    const win = String.raw`C:\Users\u\AppData\Local\npm-cache\_npx\1a2b3c\node_modules\@dilipna\anymcp-bridge\anymcp-bridge.mjs`;
    // Windows apps start programs without a shell, and npx is a .cmd script there
    expect(stdioLaunchFor(win, { ...base, platform: "win32", passThrough: ["--mcp-port=1"] })).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", `--package=${RELEASE_PACKAGE_URL}`, "anymcp-bridge", "--stdio", "--mcp-port=1"],
    });
  });

  it("from any other packaged file: this node and the file's absolute path", () => {
    const self = "/opt/anymcp/anymcp-bridge.mjs";
    expect(stdioLaunchFor(self, { ...base, platform: "linux" })).toEqual({ command: "/usr/bin/node", args: [self, "--stdio"] });
    // a global install (`npm install -g <release URL>`) is a packaged file outside any npx cache
    const global = String.raw`C:\Users\u\AppData\Roaming\npm\node_modules\@dilipna\anymcp-bridge\anymcp-bridge.mjs`;
    expect(stdioLaunchFor(global, { ...base, platform: "win32" })).toEqual({ command: "/usr/bin/node", args: [global, "--stdio"] });
  });

  it("from the TypeScript sources: the built bundle if there is one, otherwise nothing to offer", () => {
    expect(stdioLaunchFor("/repo/packages/bridge/src/cli.ts", { ...base, platform: "linux", exists: () => false })).toBeNull();
    const r = stdioLaunchFor("/repo/packages/bridge/src/cli.ts", { ...base, platform: "linux" });
    expect(r?.args[0]).toMatch(/dist[\\/]anymcp-bridge\.mjs$/);
  });
});
