// Where the bridge keeps its state, including the one-time move from the pre-release folder name.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultHome } from "../src/store";

const saved: Record<string, string | undefined> = {};
const KEYS = ["HOME", "USERPROFILE", "ANYMCP_HOME", "MYCP_HOME"] as const;
let fakeHome = "";

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  fakeHome = mkdtempSync(join(tmpdir(), "anymcp-home-"));
  process.env.HOME = fakeHome; // os.homedir() on POSIX
  process.env.USERPROFILE = fakeHome; // os.homedir() on Windows
  delete process.env.ANYMCP_HOME;
  delete process.env.MYCP_HOME;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("bridge state folder", () => {
  it("defaults to ~/.anymcp", () => {
    expect(defaultHome()).toBe(join(fakeHome, ".anymcp"));
  });

  it("copies the pre-release ~/.mycp state once, so an existing pairing keeps working", () => {
    mkdirSync(join(fakeHome, ".mycp"));
    writeFileSync(join(fakeHome, ".mycp", "state.json"), '{"version":1,"mcpToken":"legacy"}');
    const home = defaultHome();
    expect(home).toBe(join(fakeHome, ".anymcp"));
    expect(readFileSync(join(home, "state.json"), "utf8")).toContain('"legacy"');
    // a later change to the new state is never overwritten by the old one
    writeFileSync(join(home, "state.json"), '{"version":1,"mcpToken":"new"}');
    defaultHome();
    expect(readFileSync(join(home, "state.json"), "utf8")).toContain('"new"');
    expect(existsSync(join(fakeHome, ".mycp", "state.json"))).toBe(true); // left for the user to delete
  });

  it("honours ANYMCP_HOME, and the pre-release MYCP_HOME", () => {
    process.env.MYCP_HOME = join(fakeHome, "old-override");
    expect(defaultHome()).toBe(join(fakeHome, "old-override"));
    process.env.ANYMCP_HOME = join(fakeHome, "new-override");
    expect(defaultHome()).toBe(join(fakeHome, "new-override"));
  });
});
