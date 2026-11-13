import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Always test the CURRENT sources: rebuild the e2e extension before the run.
export default function globalSetup() {
  execFileSync(process.execPath, [resolve(import.meta.dirname, "../packages/extension/scripts/build.mjs"), "--target=e2e"], { stdio: "inherit" });
}
