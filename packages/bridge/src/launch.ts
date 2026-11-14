// How another app (Claude Desktop, Cursor, ...) should start THIS bridge over stdio. Pure, so it can be tested.

import { dirname, resolve } from "node:path";
import { ANYMCP_VERSION } from "anymcp-protocol";

/** The npm package the bridge is prepared as (not published yet). */
export const NPM_PACKAGE = "@dilipna/anymcp-bridge";

export interface Launch {
  command: string;
  args: string[];
}

/**
 * - Started from an npx cache (`…/_npx/…`): that folder can be cleared at any time, so a path into it would break
 *   the app's settings later. Use `npx -y @dilipna/anymcp-bridge@<this version> --stdio` instead, pinned so the app
 *   never silently starts a different release. On Windows npx is a .cmd script and apps start programs without a
 *   shell, so it goes through `cmd /c`.
 * - Started from a packaged file anywhere else (global install, a downloaded release, a repository build): this Node
 *   plus that file's absolute path.
 * - Started from the TypeScript sources: the repository's built bundle if it exists, otherwise nothing to offer.
 */
export function stdioLaunchFor(
  selfPath: string,
  o: { platform: NodeJS.Platform; execPath: string; passThrough: string[]; exists: (path: string) => boolean },
): Launch | null {
  if (selfPath.endsWith(".mjs") && /[\\/]_npx[\\/]/.test(selfPath)) {
    const args = ["-y", `${NPM_PACKAGE}@${ANYMCP_VERSION}`, "--stdio", ...o.passThrough];
    return o.platform === "win32" ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
  }
  const bundle = selfPath.endsWith(".mjs") ? selfPath : resolve(dirname(selfPath), "../dist/anymcp-bridge.mjs");
  return o.exists(bundle) ? { command: o.execPath, args: [bundle, "--stdio", ...o.passThrough] } : null;
}
