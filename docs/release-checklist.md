# Release checklist — AnyMCP 0.1.0 (release candidate)

**Overall: release candidate for local use. NOT published, NOT submitted to the Chrome Web Store, NOT approved.**
Each line is one of: **VERIFIED** (we ran it; evidence given) · **UNVERIFIED** (written/not run, or only partly) ·
**OWNER** (needs a decision, an account, a payment or someone else). Re-run the evidence command to re-check.

## The ten gates

| # | Gate | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | **Clean installation** — a fresh checkout builds and starts the documented components | **VERIFIED on this Windows machine** (see *Clean-install result* below) | `scripts/clean-install-check.mjs`. **Not** verified on macOS/Linux locally; CI workflow exists but has **never run** (no remote). |
| 2 | **Core workflow** — a supported MCP client invokes an approved tool and gets a verified structured result | **VERIFIED** with the official SDK client over HTTP (61 e2e tests, both browsers) and over **stdio** (`stdio.integration.test.ts`, `npm run smoke:stdio` on the packaged bridge), **and** with Claude Code via `scripts/demo-claude.ts` — see `eval/results/demo-claude-*.json` for exactly what happened. Claude Desktop / Cursor: **not tested** | The demo's model wording is non-deterministic; it is a labelled demonstration, not part of the evaluation numbers. |
| 3 | **Tool creation** — record, review, test, enable, revoke | **VERIFIED**, UI-driven end to end | `e2e/ui-journey.spec.ts` (only clicks/typing), `e2e/recording.spec.ts`, `e2e/capabilities.spec.ts` (dropdown, checkbox, radio, shadow-DOM button, list, query-string start page; replayed via MCP with different inputs against fixture ground truth; also passes in real Chrome 157) |
| 4 | **Permission enforcement** — disallowed origins, tools, unapproved actions rejected by code | **VERIFIED** | `e2e/permissions.spec.ts` (ungranted origin, mid-run redirect, tampered definition, policy-violating write, revocation paths); `packages/bridge` integration tests (401/403/pairing/WS origin); `sender.test.ts` |
| 5 | **Failure handling** — scenarios give appropriate outcomes without false success | **VERIFIED on the synthetic fixture** | `e2e/failures.spec.ts`, `e2e/resilience.spec.ts`; frozen evaluation in `eval/results/` with exact denominators. Fixture-only: says nothing about real sites. |
| 6 | **Usability** — onboarding, errors, recovery understandable without MCP knowledge | **PARTLY VERIFIED** | Plain-language copy reviewed by the author from screenshots; axe WCAG A/AA clean (light+dark); keyboard tests. **No user test was run** — no real person outside the author has used it. **OWNER:** a small usability session (5 people) before any public release. |
| 7 | **Packaging** — production extension and bridge versioned, reproducible, documented | **VERIFIED** | `npm run package -- --verify` builds twice from scratch and requires byte-identical ZIP + bridge (see result below). |
| 8 | **Store preparation** — manifest permissions, privacy disclosures, screenshots, listing match actual behaviour | **PARTLY VERIFIED** | `store/listing.md`, `docs/privacy-policy.md` drafted from the code; permission list generated into `release/permissions-summary.json` from the real manifest. Screenshots are **renders** of the panel page, not window captures. **OWNER:** legal review of the policy, hosting URL, contact, dashboard answers, real window screenshots, name clearance. |
| 9 | **Evidence** — public claims link to reproducible artifacts and state limitations | **VERIFIED** | README claims → tests/results; `docs/known-limitations.md`; `docs/comparison.md` tags every cell V-doc/V-code/M/U. |
| 10 | **Ownership** — docs explain the important decisions well enough to defend them | **VERIFIED by existence**, not by an interview | `docs/decisions.md`, `docs/architecture.md`, `docs/threat-model.md`, and "five questions" in the handoff. |

## Verified (with command)

| Claim | Command |
|---|---|
| Types check | `npm run typecheck` |
| Unit + integration tests pass | `npm test` |
| Browser tests pass in Playwright Chromium | `npm run test:e2e` |
| Browser tests pass in the real, branded Chrome on this machine | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e` |
| Extension reaches the loopback bridge in real Chrome 157 (no Local Network Access block) | `npm run spike:lna` (and `-- --headed`) |
| Frozen evaluation, fixture | `npm run eval` → `eval/results/fixture-*.md` |
| External read-only check | `npm run eval:external` → `eval/results/external-books-toscrape-*.md` |
| Reproducible build | `npm run package -- --verify` |
| Single-page apps, Enter-to-search, custom dropdowns, self-saving settings with approval | `e2e/webapps.spec.ts` (both browsers) |
| stdio transport: forwarding, tool-list updates, takeover, clean exit, pairing file | `packages/bridge/test/stdio.integration.test.ts`; `npm run smoke:stdio` |
| Accessibility (automated), incl. live recording and review editor | `e2e/a11y.spec.ts` |

## Unverified (honest list)

* CI on GitHub (never run). macOS and Linux locally. Edge/Firefox. Chrome versions other than 157/158.
* Any real website beyond one read-only sandbox. Any login-protected site. Any real write workflow.
* Recording inside **closed** shadow roots; custom (ARIA) dropdowns beyond "two clicks"; sites whose dropdowns/checkboxes save on change (warned, not approval-gated — known-limitations 9a).
* The Chrome **permission prompt** for "Allow this site" (cannot be automated; test builds pre-grant loopback hosts).
* The docked **side panel** in a real window (tests render the same page in a tab).
* Behaviour with Chrome enterprise policies (`LocalNetworkAccessBlockedForUrls`, extension allow/block lists).
* MCP clients other than the SDK client (HTTP + stdio) and Claude Code — in particular Claude Desktop and Cursor have not been tried.
* Long-running stability, memory use, many tools (>20), large pages.
* Screen-reader behaviour; right-to-left or non-English UI.
* One intermittent browser-test failure seen once (docs/known-limitations.md #17), cause unproven.
* Security: no external review, no fuzzing.

## Owner-required (shortest list first)

1. **Decide the name.** Do a proper trademark search — a Class 42 "ANYMCP" registration was reported by third-party sites and **not** verified at the USPTO (`docs/naming-check.md`). Nothing may be published under the name until resolved.
2. **Choose a licence** (none chosen) and a vulnerability-disclosure address; add `SECURITY.md`.
3. **Chrome Web Store:** developer account (fee, 2-step verification), host the privacy policy, fill the privacy-practices tab, upload `release/anymcp-extension-0.1.0.zip`, add real screenshots. Expect review questions about the localhost companion and optional broad host permissions.
4. **Legal review** of `docs/privacy-policy.md`.
5. **Commit the work** (the repo was initialised but has **no commits**; evaluation results are stamped with a source-tree hash instead of a git revision until then).
6. **Run it yourself once on your own sites** (read-only first) before anyone else uses it; add the first real-site entry to `docs/supported-capabilities.md`.
7. Push to a remote so CI runs; fix whatever it finds on a clean machine.
8. A small **usability session** and, ideally, an independent security review.

## Not done on purpose

Publishing, deploying, buying anything, contacting anyone, uploading private data, creating accounts on external
sites, submitting forms, sending messages, importing tools from outside the extension, autonomous repair.
