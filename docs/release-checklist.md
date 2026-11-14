# Release checklist — AnyMCP 0.1.0 (developer beta)

**Overall: developer beta, committed locally. NOT pushed, NOT published to npm, NOT submitted to the Chrome Web
Store.** Labels: **Verified end to end** · **Verified locally** · **Mock-tested** · **Prepared but untested** ·
**Blocked** · **Owner** (needs a decision, an account or someone else). Re-run the command to re-check.

## Gates

| # | Gate | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Clean installation: a fresh copy installs, tests, builds, packages and starts | **Verified locally** (Windows 11, Node 24.11) | `node scripts/clean-install-check.mjs`: npm ci, typecheck, tests, build, reproducible package, npm install-and-run check, bridge `/health`, all PASS on 2026-11-14. macOS/Linux: **Prepared but untested** (CI workflow never ran; nothing pushed). |
| 2 | Core workflow: an MCP client calls an approved tool and gets a verified result | **Verified end to end** | Claude Code 2.1.207 over HTTP and over stdio on public sandboxes (`eval/results/public-sites-*`); SDK client in 64 browser tests. Claude Desktop: **Blocked** (not installed). Cursor: **Blocked** (interface not operable here). |
| 3 | Tool creation: authorize a site, record, review, test, enable, revoke | **Verified end to end** (recording on public sites) / **Verified locally** (UI-only journey) | `eval:public`; `e2e/ui-journey.spec.ts`, `recording.spec.ts`, `capabilities.spec.ts`, `webapps.spec.ts`, `authorize-site.spec.ts`. Chrome's own permission prompt: **Prepared but untested** (cannot be automated). |
| 4 | Permission enforcement | **Verified locally** | `permissions.spec.ts` (ungranted site, mid-run redirect, tampered or policy-violating definition, revocation); bridge integration tests (401, Host/Origin, pairing, oversized/malformed/misrouted input); production-build test proves site authorization is reachable. |
| 5 | Failure handling without false success | **Verified locally** (fixture) | fixture evaluation protocol v2: 170/170 correct, 0 false success, 0 unapproved, 105/105 recovered (`eval/results/fixture-chromium-2026-11-14T06-10-35.*`). Real-site writes: none tested. |
| 6 | Usability | **Owner** | Getting-started checklist, plain-language errors, axe WCAG A/AA clean (light and dark, 420 px). **No person outside development has used it.** Sheet: `docs/first-time-user-test.md`. |
| 7 | Packaging | **Verified locally** | `npm run package -- --verify`: extension ZIP, bridge file and npm tarball byte-identical across two clean builds; `npm run package:check`: tarball installs outside the checkout with no dependencies and runs (HTTP + stdio). |
| 8 | Store preparation | **Prepared but untested** | `store/listing.md` (permission justifications), `docs/privacy-policy.md` (draft). Missing: screenshots (list in `docs/quick-start.md`), hosted policy URL, contact, naming decision. |
| 9 | Evidence: claims link to reproducible results and state limits | **Verified locally** | README → `docs/public-site-report.md`, `docs/compatibility.md`, `eval/results/`; `docs/known-limitations.md`. |
| 10 | Licence and attribution | **Verified locally** | MIT `LICENSE`; each artifact carries LICENSE + third-party notices for what it bundles. |

## Verified commands (2026-11-14)

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | clean |
| Unit + integration | `npm test` | 129/129 |
| Browser suite, Playwright Chromium 158 | `npm run test:e2e` | 64/64 |
| Browser suite, Google Chrome 157.0.8103.52 | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e` | 64/64 |
| Fixture evaluation (protocol v2) | `npm run eval` | 170/170 correct |
| Public sandboxes + Claude Code | `npm run eval:public -- --with-claude` | 7/7 SDK runs equal an independent reading; revocation 3/3; Claude Code HTTP ✓, stdio ✓ |
| Reproducible package | `npm run package -- --verify` | byte-identical |
| npm tarball outside the checkout | `npm run package:check` | 7/7 checks |
| Packaged bridge over stdio | `npm run smoke:stdio` | PASS |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED |

## Not verified (honest list)

* macOS, Linux, Node 20–23, other Chromium browsers; CI has never run.
* Claude Desktop, Cursor and other MCP clients.
* Chrome's "allow this site" prompt and the docked side panel in a real window.
* Any signed-in website, any write on a real website, any site beyond the three sandboxes.
* Long-running stability, many tools, very large pages; screen readers; non-English UI.
* Security: no external review, no fuzzing.

## Owner actions (shortest first)

1. **Naming decision.** An unrelated npm package `anymcp` (similar purpose, first published 2026-06) already exists.
   No trademark search has been done for "AnyMCP". Decide whether to keep the name before publishing anything.
2. **Security contact:** add an address or enable GitHub private vulnerability reporting (`SECURITY.md`).
3. **Push** the local commits to `github.com/dilipna/AnyMCP` so CI runs on macOS/Linux/Windows.
4. **Run the first-time-user test** with 3–5 people; try Claude Desktop or Cursor with the manual test in the sheet.
5. **Screenshots** (list in `docs/quick-start.md`), host the privacy policy, review it.
6. **Publish** `@dilipna/anymcp-bridge` (needs an npm account) and, later, submit the extension (developer account).

## Not done on purpose

Pushing, publishing, deploying, buying anything, contacting anyone, uploading private data, signing in to sites,
submitting forms, sending messages, importing tools from outside the extension, autonomous repair.
