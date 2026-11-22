# Release checklist — AnyMCP 0.1.x (developer beta)

**Overall: developer beta. Pushed to https://github.com/dilipna/AnyMCP (public) on 2026-11-15. v0.1.0 (2026-11-16) and
v0.1.1 (2026-11-17, the build for the store: in-product data notice) published as GitHub PRE-RELEASES (https://github.com/dilipna/AnyMCP/releases/tag/v0.1.1). NOT published to npm, NOT submitted to the Chrome Web Store.** Labels: **Verified end to end** · **Verified locally** · **Mock-tested** · **Prepared but untested** ·
**Blocked** · **Owner** (needs a decision, an account or someone else). Re-run the command to re-check.

## Gates

| # | Gate | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Clean installation: a fresh copy installs, tests, builds, packages and starts | **Verified locally** (Windows 11, Node 24.11) | `node scripts/clean-install-check.mjs`: npm ci, typecheck, tests, build, reproducible package, npm install-and-run check, bridge `/health`, all PASS on 2026-11-14. macOS, Ubuntu, Windows Server, Node 20.19 and 22: **Verified locally (CI)**, every step of `npm ci` → package check passes ([run 43929412593](https://github.com/dilipna/AnyMCP/actions/runs/43929412593)). |
| 2 | Core workflow: an MCP client calls an approved tool and gets a verified result | **Verified end to end** | Claude Code 2.1.207 over HTTP and over stdio on public sandboxes (`eval/results/public-sites-*`; re-verified 2026-11-17 with the current bridge); SDK client in 67 browser tests. Claude Desktop: **Blocked** (not installed). Cursor: **Blocked** (interface not operable here). |
| 3 | Tool creation: authorize a site, record, review, test, enable, revoke | **Verified end to end** (recording on public sites) / **Verified locally** (UI-only journey) | `eval:public`; `e2e/ui-journey.spec.ts`, `recording.spec.ts`, `capabilities.spec.ts`, `webapps.spec.ts`, `richtext.spec.ts`, `authorize-site.spec.ts`. Chrome's own permission prompt: **Prepared but untested** (cannot be automated). |
| 4 | Permission enforcement | **Verified locally** | `permissions.spec.ts` (ungranted site, mid-run redirect, tampered or policy-violating definition, revocation); bridge integration tests (401, Host/Origin, pairing, oversized/malformed/misrouted input); production-build test proves site authorization is reachable. |
| 5 | Failure handling without false success | **Verified locally** (fixture) | fixture evaluation protocol v2: 170/170 correct, 0 false success, 0 unapproved, 105/105 recovered (`eval/results/fixture-chromium-2026-11-14T06-10-35.*`). Real-site writes: none tested. |
| 6 | Usability | **Owner** | Getting-started checklist, plain-language errors, axe WCAG A/AA clean (light and dark, 420 px). **No person outside development has used it.** Sheet: `docs/first-time-user-test.md`. |
| 7 | Packaging | **Verified locally** | `npm run package -- --verify`: extension ZIP, bridge file and npm tarball byte-identical across two clean builds, and across all five CI jobs (macOS, Ubuntu with Node 24, 22 and 20.19, Windows) and this Windows 11 machine; `npm run package:check`: tarball installs outside the checkout with no dependencies and runs (HTTP + stdio). |
| 8 | Store preparation | **Prepared but untested** (not submitted) | `store/listing.md`: text, permission justifications, data-usage answers, URLs. Privacy policy hosted at https://dilipna.github.io/AnyMCP/privacy-policy (GitHub Pages from `docs/`; every link checked; **not reviewed by a lawyer**). Security reports: GitHub private vulnerability reporting (enabled). Images: five 1280×800 renders of the panel page and a 440×280 promo tile in `store/screenshots/` (labelled renders; real-window screenshots still recommended). Missing: developer account, dashboard answers confirmed by the owner. |
| 9 | Evidence: claims link to reproducible results and state limits | **Verified locally** | README → `docs/public-site-report.md`, `docs/compatibility.md`, `eval/results/`; `docs/known-limitations.md`. |
| 10 | Licence and attribution | **Verified locally** | MIT `LICENSE`; each artifact carries LICENSE + third-party notices for what it bundles. |
| 11 | Release integrity | **Verified end to end** | **v0.1.1** published 2026-11-17 as a pre-release from commit 7eeea36 (CI green on all five jobs, artifacts identical everywhere): dry run on the draft passed (run 44152874404); on publication all 7 files were identical to a clean build from the tag and attestations were signed for the 3 artifacts (run 44156695564; Rekor log index 3951868767); anonymous downloads match `SHA256SUMS.txt`, `gh attestation verify` succeeds for all three, an altered copy is rejected. **v0.1.0**: v0.1.0 published 2026-11-16 as a pre-release from commit 00b0945 (CI green on all five jobs). `.github/workflows/release.yml` rebuilt it from the tag, found all 7 attached files byte-identical to that clean build and signed SLSA build-provenance attestations for the extension ZIP, bridge file and npm package (run 44007518598; Rekor log index 3940663943). Files downloaded anonymously from the release match `SHA256SUMS.txt`, `gh attestation verify <file> --repo dilipna/AnyMCP` succeeds for all three (signer: release.yml at refs/tags/v0.1.0), and a copy with one byte appended is rejected. Before publishing, dry runs on the draft passed, and a deliberately altered asset was caught and nothing signed (runs 43830492552, 43830621081, 43926730886, 43931968843, 44007419692). The release ZIP, unzipped and loaded unpacked in Chromium, starts and renders the side panel with no page errors. |
| 12 | Static analysis | **Verified locally** | CodeQL (extended security queries) on every push, JavaScript/TypeScript and workflows. First run: 0 alerts in the extension or bridge; 6 in tooling, 4 fixed (evaluation reader's entity decoding and tag removal, CI token permissions), 2 open for the owner to decide (intended report writes in two developer scripts). |

## Verified commands (2026-11-14 unless a row says otherwise)

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | clean |
| Unit + integration, incl. property-based tests (2026-11-16) | `npm test` | 160/160 (fuzz suites at 400 cases per property; 25,000-case protocol runs with three seeds and 2,000-request network runs with nine seeds also passed) |
| Browser suite, Playwright Chromium 158 | `npm run test:e2e` | 67/67 |
| Browser suite, Google Chrome 157.0.8103.52 | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e` | 67/67 |
| Browser suite, Microsoft Edge 157.0.4341.60 (2026-11-16) | `ANYMCP_E2E_BROWSER=msedge npm run test:e2e` | 67/67 |
| Browser suite, Brave 1.99.57 / Chromium 157.0.8103.79 (2026-11-16) | `ANYMCP_E2E_BROWSER=brave npm run test:e2e` | 67/67 |
| Public sandboxes in Edge and Brave (2026-11-16) | `ANYMCP_E2E_BROWSER=msedge\|brave npm run eval:public` | 7/7 and revocation 3/3 in each |
| Fixture evaluation (protocol v2) | `npm run eval` | 170/170 correct |
| Public sandboxes + Claude Code | `npm run eval:public -- --with-claude` | 7/7 SDK runs equal an independent reading; revocation 3/3; Claude Code HTTP ✓, stdio ✓ |
| Public sandboxes in branded Chrome | `npm run eval:public -- --chrome` | 7/7, revocation 3/3 |
| Five public sandboxes, Playwright Chromium (2026-11-18) | `npm run eval:public` | 11/11 runs equal an independent reading or stop safely; revocation 5/5 (`eval/results/public-sites-2026-11-18T22-32-10`) |
| Reproducible package | `npm run package -- --verify` | byte-identical |
| npm tarball outside the checkout | `npm run package:check` | 7/7 checks |
| Packaged bridge over stdio | `npm run smoke:stdio` | PASS |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED |
| CI, 2026-11-16: macOS 26.7 arm64, Ubuntu 26.04 (Node 24.22, 22.23.4 and 20.19.6), Windows Server 2025 | `.github/workflows/ci.yml` ([run 43929412593](https://github.com/dilipna/AnyMCP/actions/runs/43929412593)) | all green: 160/160 unit, 67/67 browser (Chrome for Testing 158), reproducible package, npm tarball 7/7; the three artifacts byte-identical on all five jobs and locally |

## Not verified (honest list)

* macOS and Linux by hand (CI runs the automated suites there, not the public sites or a real AI app), Node 21 and
  23 (odd-numbered lines), Chromium browsers other than Chrome, Edge and Brave.
* Claude Desktop, Cursor and other MCP clients.
* Chrome's "allow this site" prompt and the docked side panel in a real window.
* Any signed-in website, any write on a real website, any site beyond the five practice sandboxes.
* Long-running stability, many tools, very large pages; screen readers; non-English UI.
* Security: no external review or penetration test. In-house property-based fuzzing (protocol code and both bridge
  network endpoints) and automated CodeQL analysis only.

## Owner actions (shortest first)

1. ~~Naming decision~~ **decided 2026-11-14: keep "AnyMCP"** (publish the bridge as `@dilipna/anymcp-bridge`; an
   unrelated npm package `anymcp` exists; a trademark search is still advisable, see `docs/naming-check.md`).
2. ~~Security contact~~ **done 2026-11-15:** GitHub private vulnerability reporting enabled; `SECURITY.md` links it.
3. ~~Push~~ **done 2026-11-15** (history first stripped of pre-rename panel images); CI green on macOS, Ubuntu and
   Windows after three fixes it found (lockfile entries newer npm requires; macOS dropdown keys in three tests; a
   test locator that could click the header's "Running" pill instead of a run).
4. **Run the first-time-user test** with 3–5 people; try Claude Desktop or Cursor with the manual test in the sheet.
5. ~~Host the privacy policy~~ **done 2026-11-15** (GitHub Pages). Still open: a lawyer's review of it, and real
   docked-panel screenshots (list in `docs/quick-start.md`) to supplement the labelled renders.
6. ~~Publish the GitHub release~~ **done 2026-11-16** as a pre-release (owner's decision). Still open: **publish**
   `@dilipna/anymcp-bridge` (needs `npm login`; publish `release/dilipna-anymcp-bridge-0.1.1.tgz`, the file attached
   to the v0.1.1 release) and, later, submit the extension (developer account).
7. **CodeQL alerts 5 and 6** (`js/http-to-file-access` in `packages/eval/src/external.ts` and
   `scripts/verify-npm-package.mjs`): both scripts write their own reports, which is their purpose; dismiss them as
   "won't fix" if you agree (Security tab → Code scanning).

## Not done on purpose

Pushing, publishing, deploying, buying anything, contacting anyone, uploading private data, signing in to sites,
submitting forms, sending messages, importing tools from outside the extension, autonomous repair.
