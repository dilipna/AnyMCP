# Changelog

Versions follow [semantic versioning](https://semver.org) once a version is published. Changes that affect what
data AnyMCP handles or where it goes are marked **Data**, as the [privacy policy](docs/privacy-policy.md) promises.

## Unreleased

Found by extending the public-site evaluation to four more practice pages (2026-11-23,
`eval/results/public-sites-2026-11-23T19-55-49`); each is reproduced on a synthetic fixture page in
`e2e/site-patterns.spec.ts`, which failed before these fixes and passes after.

* **A list read too broadly could report a false success.** On a page laid out with a table and no class names
  (quotes.toscrape.com/tableful), the recorder's "others like it" pattern was `table > tbody > tr > td`: it also took
  in the tags row under each quote and a side cell, so results were wrong, and a tag page with no quotes returned
  "success" with two unrelated cells. The recorder now narrows such a pattern by an attribute of the clicked item, but
  only when two signals agree (everything removed is built differently from the clicked item, everything kept is
  built alike; empty spacer cells, which hold no value, are left out of the comparison); otherwise the pattern and its
  match count are left as they are. A first version of that rule worked on the synthetic copy but not on the real page,
  whose empty `<td></td>` spacer made the two signals disagree (`public-sites-2026-11-23T20-20-42`); the synthetic
  page now has the same spacer.
* When a list found without class names still holds items built differently from the one clicked (nothing on the
  page tells them apart), the recording screen says how many, and the review warns before saving, instead of relying
  on the person to compare the match count with the page.
* **Content drawn after the page loads was read too early.** Reading a value, list or table looked once, right after
  the page's "loaded" check, and stopped with `locator_missing` if the content was not there yet (quotes drawn by a
  10-second timer stopped after 0.4 s). Reading now waits for what it reads, up to the step timeout, as finding an
  element already did. A missing list is therefore reported after the step timeout instead of at once.
* **Raising "Per-step timeout" in the tool editor did not help a slow page**, although the known limitations said it
  would: recorded tools waited for their success check with a fixed 5 seconds. That wait now uses the tool's per-step
  timeout. (Tools recorded before keep their fixed 5-second wait; reading itself follows the per-step timeout.)
* **A picked value could be unique on the recorded page but ambiguous elsewhere.** The price on a book page was
  recorded as `p.price_color`; on books with a "recommended" strip that matched several prices, so the tool stopped
  with `locator_ambiguous` (safely, but uselessly). A picked value whose selector is only its own tag and classes is
  now placed inside its nearest container with an id or a stable class (`div.col-sm-6.product_main p.price_color`).

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
