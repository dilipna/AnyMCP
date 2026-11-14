import { describe, expect, it } from "vitest";
import { ANYMCP_VERSION } from "anymcp-protocol";
import { NPM_PACKAGE, stdioLaunchFor } from "../src/launch";

const base = { execPath: "/usr/bin/node", passThrough: [] as string[], exists: () => true };

describe("how an app should start this bridge over stdio", () => {
  it("from an npx cache: npx with the pinned package version, never a path into the cache", () => {
    const self = "/home/u/.npm/_npx/1a2b3c/node_modules/@dilipna/anymcp-bridge/anymcp-bridge.mjs";
    expect(stdioLaunchFor(self, { ...base, platform: "linux" })).toEqual({ command: "npx", args: ["-y", `${NPM_PACKAGE}@${ANYMCP_VERSION}`, "--stdio"] });
    const win = String.raw`C:\Users\u\AppData\Local\npm-cache\_npx\1a2b3c\node_modules\@dilipna\anymcp-bridge\anymcp-bridge.mjs`;
    // Windows apps start programs without a shell, and npx is a .cmd script there
    expect(stdioLaunchFor(win, { ...base, platform: "win32", passThrough: ["--mcp-port=1"] })).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", `${NPM_PACKAGE}@${ANYMCP_VERSION}`, "--stdio", "--mcp-port=1"],
    });
  });

  it("from any other packaged file: this node and the file's absolute path", () => {
    const self = "/opt/anymcp/anymcp-bridge.mjs";
    expect(stdioLaunchFor(self, { ...base, platform: "linux" })).toEqual({ command: "/usr/bin/node", args: [self, "--stdio"] });
  });

  it("from the TypeScript sources: the built bundle if there is one, otherwise nothing to offer", () => {
    expect(stdioLaunchFor("/repo/packages/bridge/src/cli.ts", { ...base, platform: "linux", exists: () => false })).toBeNull();
    const r = stdioLaunchFor("/repo/packages/bridge/src/cli.ts", { ...base, platform: "linux" });
    expect(r?.args[0]).toMatch(/dist[\\/]anymcp-bridge\.mjs$/);
  });
});
