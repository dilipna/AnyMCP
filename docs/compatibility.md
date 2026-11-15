# Compatibility and limitations

Evidence labels used below:

* **Verified end to end:** the full path (MCP client → bridge → extension → website → result) was run and checked.
* **Verified locally:** run and checked on this machine or in CI (GitHub Actions), but not the full path, or only on
  the synthetic fixture.
* **Mock-tested:** covered by tests that replace a real component (for example a fake extension).
* **Prepared but untested:** built or documented, never run in that setting.
* **Blocked:** could not be run here; the reason is given.

## Environments

| What | Status | Evidence / note |
|---|---|---|
| Windows 11, Node 24.11 | Verified end to end | all suites, public-site run, clean-checkout install |
| macOS 26.7 (arm64), Ubuntu 26.04, Windows Server 2025; Node 24.22 | Verified locally (CI) | [GitHub Actions run 43759300324](https://github.com/dilipna/AnyMCP/actions/runs/43759300324), 2026-11-15: type check, 136/136 unit and integration tests, 67/67 browser tests (Chrome for Testing 158.0.8127.18, synthetic fixture), reproducible package, npm tarball installed and run (HTTP + stdio). The extension ZIP, bridge and npm tarball were byte-identical on all four CI jobs and to the Windows 11 build. No public-site run and no real AI app there; nobody has used it by hand on macOS or Linux |
| Node 20.19 | Verified locally (CI, Ubuntu) | same run: Node 20.19.6 passes every step above |
| Node 21 – 23 | Prepared but untested | `engines: >=20.19`; not run |
| Playwright Chromium 158 | Verified end to end | 67/67 browser tests, fixture evaluation (170/170, protocol v2), public sites |
| Google Chrome 157.0.8103.52 (branded) | Verified end to end | full browser suite 67/67 on 2026-11-15 (the production-build test always uses Chromium); public sites 7/7 in Chrome |
| Edge, Brave, other Chromium browsers | Prepared but untested | MV3 + side panel should work; not tried |
| Firefox, Safari | Not supported | different extension platforms |
| Docked side panel in a real window | Prepared but untested | tests render the same panel page in a tab |
| Chrome's "allow this site" prompt | Prepared but untested | cannot be automated; the form that requests it is tested |

## MCP clients

| Client | Transport | Status | Evidence |
|---|---|---|---|
| Official MCP TypeScript SDK client | HTTP | Verified end to end | browser suites, evaluation, public sites |
| Official MCP TypeScript SDK client | stdio | Verified locally | spawns the real CLI over stdio against a fake extension (`stdio.integration.test.ts`); packaged bridge and installed npm package smoke-tested (`npm run smoke:stdio`, `npm run package:check`) |
| Claude Code 2.1.207 (`claude -p`) | HTTP | Verified end to end | public-site run: books.toscrape.com |
| Claude Code 2.1.207 (`claude -p`) | stdio | Verified end to end | public-site run: scrapethissite.com, packaged bridge |
| Claude Desktop | stdio | Blocked | not installed on the test machine. Manual test: [first-time-user-test.md](first-time-user-test.md) |
| Cursor | stdio | Blocked | installed, but its interface cannot be operated from this environment and its settings were not modified |
| Other MCP clients | HTTP or stdio | Prepared but untested | standard Streamable HTTP (stateless) and stdio |

## Websites

| What | Status | Note |
|---|---|---|
| Synthetic fixture (orders, catalog, web app, settings) | Verified locally | written by the same author: a development suite, not a held-out set |
| books.toscrape.com, scrapethissite.com, quotes.toscrape.com/js | Verified end to end | read-only, a few inputs, one day: [public-site-report.md](public-site-report.md) |
| Wikipedia | Not usable | refuses automated browsing (429); robots.txt disallows `/w/` |
| Sites that need sign-in | Prepared but untested | AnyMCP uses your normal Chrome session and never signs in; no signed-in site was tested |
| Any other site | Unknown | expect some to work and some not; see below |
| Many tools at once | Mock-tested | 40 enabled tools listed with schemas and routed correctly (bridge test with a fake extension) |

## Page features

| Feature | Status |
|---|---|
| Buttons, links, text boxes, dropdowns, checkboxes, switches, option buttons | Verified locally (fixture) |
| Lists of repeated items, tables (with or without `<thead>`), links with addresses | Verified end to end (public sites) |
| Pages drawn by JavaScript after loading; single-page-app navigation (history.pushState) | Verified end to end (quotes/js) / Verified locally (fixture app) |
| Shadow DOM (web components) | Verified locally (open roots); closed roots: replay only, recording unverified |
| Search via the address (query string), parts of the address as inputs | Verified end to end |
| Enter-to-search without a button; custom (ARIA) dropdowns | Verified locally (fixture) |
| Rich text boxes (`contenteditable`): an editor with its own model; a chat box where Enter sends (approval required) | Verified locally (fixture) |
| Changes that need approval (Save buttons, settings that save by themselves) | Verified locally (fixture); **no real-site write was tested** |
| iframes, rich-text formatting, file upload/download, drag-and-drop, canvas apps, CAPTCHAs, sign-in, multi-tab flows, pagination loops | Not supported |

The precise list of operations and refusals is in [supported-capabilities.md](supported-capabilities.md); the plain
list of limits is in [known-limitations.md](known-limitations.md).

## Write actions in this beta

Tools that change data (a Save button, an Enter that submits, a setting that saves by itself) are available, with
approval in the browser on every run, binding to the exact page values, no automatic retry, and `unknown_outcome`
when a result cannot be confirmed. This is **Verified locally on the synthetic fixture only**: no write was run
against a real website. Start with read-only tools; try writes first on a site and account where a mistake is cheap.
