# Changelog

Versions follow [semantic versioning](https://semver.org) once a version is published. Changes that affect what
data AnyMCP handles or where it goes are marked **Data**, as the [privacy policy](docs/privacy-policy.md) promises.

## 0.1.2 — 2026-11-23 (developer beta, GitHub pre-release)

Published as a [GitHub pre-release](https://github.com/dilipna/AnyMCP/releases/tag/v0.1.2); not on the Chrome Web
Store. **The bridge is not published to the npm registry**: install it from the release address,
`npx --package=https://github.com/dilipna/AnyMCP/releases/download/v0.1.2/dilipna-anymcp-bridge-0.1.2.tgz anymcp-bridge`
(README, quick start). The build to submit to the Chrome Web Store (instead of 0.1.1). Extension and bridge 0.1.1
and 0.1.2 work together (same protocol version).

* **Data:** Bridge: started with npx from a release package (`npx --package=<release .tgz address> anymcp-bridge`), it
  told Claude Desktop, Cursor and other stdio apps to run `npx -y @dilipna/anymcp-bridge@<version>`, which fails
  because the package is not on the npm registry. It now prints `npx -y --package=<this version's GitHub release
  package> anymcp-bridge --stdio`, so such an app downloads the bridge from GitHub (the privacy policy now lists that
  download). Found 2026-11-22 by running v0.1.1 that way; `npm run smoke:stdio -- --npx=<address>` checks the printed
  form end to end. Bridges started any other way (a global install, the release's .mjs file) were not affected.
* The bridge package's README, the project README, quick start, troubleshooting and store listing give the release
  address instead of an npm package name; SECURITY.md says that a registry package claiming to be the bridge is not
  from this project.

Also, found by a code review of the changes since 2026-11-15 (the first is the most important):

* Release workflow: run by hand for an already-published release, it built the release's target branch instead of its
  tag before signing. It now always builds the tag of a published release, and records the commit it built.
* More names that every object inherits (`constructor`) are handled as ordinary names: a single output named
  "Constructor" is no longer reported as a duplicate in the tool editor; a blank `constructor` input in the test form
  stays blank; a required output named `constructor` that is never produced, or not declared, is refused by the policy.
* The evaluations' page reader decodes common named entities (`&eacute;`, `&rsquo;`, `&hellip;`, …) case-sensitively,
  so a correct result is not scored as a mismatch; unknown entities stay as written.
* Evaluation results from `external.ts` and the Claude demo name the browser; the test harness rejects an unknown
  `ANYMCP_E2E_BROWSER` such as `toString` and no longer probes a relative Brave path when `LOCALAPPDATA` is unset.

## 0.1.1 — 2026-11-17 (developer beta, GitHub pre-release)

Published as a [GitHub pre-release](https://github.com/dilipna/AnyMCP/releases/tag/v0.1.1); not on the Chrome Web Store or npm yet. The build to submit to the store.

* The side panel now says, before you connect an AI app (first-run step 3 and Settings) and next to each tool's
  Enable button, what that app will receive (the enabled tools and each run's values read from the page) and that it
  may pass them to its model provider; nothing reaches the developer. Chrome Web Store disclosure rules ask for this
  inside the product, not only in the listing and privacy policy. The privacy policy now states Limited Use
  compliance explicitly. No change in what data AnyMCP handles or where it goes.
* Claude Code re-verified over HTTP and stdio with the current bridge; the clean-install check reads the version
  instead of a hard-coded file name.

## 0.1.0 — 2026-11-16 (developer beta, GitHub pre-release)

The first version: the AnyMCP extension for Chrome (MV3) and the AnyMCP bridge (`@dilipna/anymcp-bridge`, the MCP
server). Published as a [GitHub pre-release](https://github.com/dilipna/AnyMCP/releases/tag/v0.1.0) whose files can be checked (SECURITY.md, "Checking a
download"); not on the Chrome Web Store or npm yet.

### What it does

* Teach a website task once in your own Chrome, review what the resulting tool may read and change, test it and
  enable it; your AI app (an MCP client) then calls it over HTTP (127.0.0.1 + bearer token) or stdio.
* Seven fixed operations (find, fill, click, press Enter, wait, read, check); no code from the page or the AI app is
  ever run. Standard controls, lists and tables, JavaScript-drawn pages, open shadow DOM, rich text as plain text.
* Sites are allowed one at a time; every data-changing step asks for your approval in the browser, bound to the
  exact action and page values; uncertain outcomes are reported as `unknown_outcome` and never repeated.
* Password, payment, token and one-time-code fields are never recorded, read or filled.

Limits and evidence: [compatibility](docs/compatibility.md), [known limitations](docs/known-limitations.md),
[release checklist](docs/release-checklist.md).

### Changes since the source was first published (2026-11-15)

* **Data:** more payment and one-time-code fields are recognised and skipped. Any `autocomplete` token now counts,
  so `section-pay billing cc-exp` is treated like `cc-exp`, and field names such as `cvv2`, `securityCode` or
  `OTPCode` and labels such as "Security code" or "Verification code" are recognised. Before, such a field could
  be recorded if nothing else about it looked sensitive.
* Arguments named `constructor`, `toString` or `__proto__` can no longer slip past the "no undeclared fields" check;
  a required parameter named `constructor` is enforced; a missing `constructor` argument is no longer filled in as
  `function Object() { [native code] }`; values that differ only by a `__proto__` key no longer hash the same
  (approval binding, duplicate detection, tool versions). All found by new property-based tests.
* The bridge refuses a request nested more than 64 levels deep with a clear 400. Before, a body nested a few
  thousand levels deep made the MCP SDK fail while re-serialising it and answer 500 (found by the network fuzz
  tests; it needed the bridge token and the bridge kept running).
* New property-based ("fuzz") tests for the protocol code and both bridge network endpoints, seeded and replayable.
* The browser suite also runs in Microsoft Edge and Brave (`ANYMCP_E2E_BROWSER=msedge|brave`); CI adds Node 22.
* CI on macOS, Linux and Windows; a lockfile fix for newer npm; macOS-safe dropdown handling in three tests; a test
  locator that could click the header's "Running" label instead of a run.
* The store promo tile no longer cuts off its text; the npm README links the privacy policy and private
  vulnerability reporting.
* Release integrity: a release workflow rebuilds each published release, proves the attached files are byte-identical
  to that clean build, and signs build-provenance attestations (`gh attestation verify`). CodeQL analyses every
  push; CI runs with a read-only token.
* The evaluations' independent page reading decodes HTML entities once (`&amp;lt;` stays `&lt;`) and removes
  tags completely (found by CodeQL; no past result changes).
