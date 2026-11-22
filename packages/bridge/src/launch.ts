// How another app (Claude Desktop, Cursor, ...) should start THIS bridge over stdio. Pure, so it can be tested.

import { dirname, resolve } from "node:path";
import { ANYMCP_VERSION } from "anymcp-protocol";

/**
 * This version's npm package as attached to its GitHub release (and checked by release.yml: identical to a clean
 * build, with a signed build-provenance attestation). The package is not on the npm registry, so apps are pointed here.
 */
export const RELEASE_PACKAGE_URL = `https://github.com/dilipna/AnyMCP/releases/download/v${ANYMCP_VERSION}/dilipna-anymcp-bridge-${ANYMCP_VERSION}.tgz`;

export interface Launch {
  command: string;
  args: string[];
}

/**
 * - Started from an npx cache (`…/_npx/…`): that folder can be cleared at any time, so a path into it would break
 *   the app's settings later. Use `npx -y --package=<this version's release package> anymcp-bridge --stdio` instead,
 *   pinned so the app never silently starts a different release. (A registry name would fail: the package is not on
 *   the npm registry.) On Windows npx is a .cmd script and apps start programs without a shell, so it goes through
 *   `cmd /c`. A build of an unreleased version points at a release that does not exist yet.
 * - Started from a packaged file anywhere else (global install, a downloaded release, a repository build): this Node
 *   plus that file's absolute path.
 * - Started from the TypeScript sources: the repository's built bundle if it exists, otherwise nothing to offer.
 */
export function stdioLaunchFor(
  selfPath: string,
  o: { platform: NodeJS.Platform; execPath: string; passThrough: string[]; exists: (path: string) => boolean },
): Launch | null {
  if (selfPath.endsWith(".mjs") && /[\\/]_npx[\\/]/.test(selfPath)) {
    const args = ["-y", `--package=${RELEASE_PACKAGE_URL}`, "anymcp-bridge", "--stdio", ...o.passThrough];
    return o.platform === "win32" ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
  }
  const bundle = selfPath.endsWith(".mjs") ? selfPath : resolve(dirname(selfPath), "../dist/anymcp-bridge.mjs");
  return o.exists(bundle) ? { command: o.execPath, args: [bundle, "--stdio", ...o.passThrough] } : null;
}
