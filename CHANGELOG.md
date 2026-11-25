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
* **A table whose headings are numbers returned one column and called it success.** Column headings became field
  names by dropping symbols and leading digits, so "2023" and "2024" (or "Price (£)" and "Price ($)") became the same
  name and overwrote each other: the review listed every column, the tool returned one. On
  the-internet.herokuapp.com/large (headings 1 to 50) every row came back as `{"col": "1.50"}` with status success
  (`eval/results/public-sites-2026-11-25T06-03-17`, run on the old code). A heading that starts with a digit now keeps
  it behind a prefix (`col_2023`), and two headings that would give the same name get `_2`, `_3`. Tools recorded
  before keep their (wrong) names; re-record a table tool whose headings are numbers.
* **A table with merged cells put values under the wrong heading, as a success.** Cells were matched to headings by
  their position among a row's own cells, so after any cell spanning two columns or rows every later value moved
  one heading over: on a synthetic scores table with "Score" two columns wide, "Rank" returned the second-round score;
  on a table with two heading rows, a region spanning two rows and a totals row, a town came back as the region and
  the totals row as a town. A table is now read as the grid it shows (merged cells cover every place they span), by
  the recorder and the engine alike; a column under a wider heading is named with both ("Population 2020"), headings
  that still repeat get " (2)", and `<tfoot>` rows are not records. Tools recorded before keep finding their columns
  (now in the right place); a heading that was offered once for two columns is now offered twice.
* **Numbers were misread, and returned as a success.** An output marked as a number had every space and comma removed
  before the first run of digits was read: "12,50 €" became 1250, "1.234,56 €" 1.234, "0,25" 25, "−5 °C" 5 and
  "10 20" 1020. Numbers are now read as written: a decimal comma, thousands grouped by dots, commas, spaces or
  apostrophes, Indian grouping (12,34,567) and the minus sign "−"; a minus inside a code ("A-12") is not a sign. A
  format that cannot be read unambiguously ("1,2,3") makes the tool report that it could not read a number instead of
  guessing. "1,250" is still 1250 and "1.234" still 1.234, as in English (known limitation 31).
* **An id the page makes up on every load could be recorded**, so the tool stopped on its first test. The recorder
  already ignored such ids on the containers it anchors to, but not on the picked element itself:
  the-internet.herokuapp.com/challenging_dom gives its buttons a fresh UUID each load, and frameworks number elements
  (`ember1234`). Ids and class names with three digits in a row or a UUID shape are now never used in a selector.
* **A picked value shown in a heading, link or button was found by its own text**, so a tool could only ever return
  the value it was recorded with: picking the item name on one product's page recorded "the heading named Quiet
  Harbour", which another product's page does not have (the tool stopped). Found on 2026-11-25 when a new practice
  page recorded "the heading named Hello World!". Picked values are no longer found by their own text; a name from
  `aria-label` and similar still counts, and success checks, which are meant to be fixed text, are unchanged.
* The public-site evaluation adds the-internet.herokuapp.com/large: a 180 KB page with elements nested 50 deep and a
  50 x 50 table, read whole (all 2,500 cells).
* The public-site evaluation adds two pages that need CLICKS while recording, both read-only: pressing Start on
  the-internet.herokuapp.com/dynamic_loading/2 (text drawn 5 s later), and clicking a year on the Scrape This Site
  films page (made an input; the films table is filled by a request without the address changing).
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
