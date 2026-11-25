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
| macOS 26.7 (arm64), Ubuntu 26.04, Windows Server 2025; Node 24.22 | Verified locally (CI) | [GitHub Actions run 43929412593](https://github.com/dilipna/AnyMCP/actions/runs/43929412593), 2026-11-16 (macOS was also green twice on 2026-11-15): type check, 160/160 unit, integration and property tests, 67/67 browser tests (Chrome for Testing 158.0.8127.18, synthetic fixture), reproducible package, npm tarball installed and run (HTTP + stdio). The extension ZIP, bridge and npm tarball were byte-identical on all four CI jobs and to the Windows 11 build. No public-site run and no real AI app there; nobody has used it by hand on macOS or Linux |
| Node 20.19 and 22 | Verified locally (CI, Ubuntu) | same run: Node 20.19.6 and 22.23.4 pass every step above |
| Node 21, 23 | Prepared but untested | `engines: >=20.19`; odd-numbered lines, not run |
| Playwright Chromium 158 | Verified end to end | 67/67 browser tests, fixture evaluation (170/170, protocol v2), public sites |
| Google Chrome 158.0.8127.37 (branded) | Verified end to end | 2026-11-25 at 23981ab: full browser suite 79/79 (`ANYMCP_E2E_BROWSER=chrome`); twelve practice pages 25/25, both slow-page checks, revocation 12/12, with Claude Code 2.1.207 over HTTP ✓ and stdio ✓ (`eval/results/public-sites-2026-11-25T10-04-22`, source tree 3a706f6a…) |
| Google Chrome 157.0.8103.79 (branded) | Verified end to end | 2026-11-23 at a1c4d85: full browser suite 71/71; nine practice pages 20/20 with Claude Code over HTTP and stdio (`eval/results/public-sites-2026-11-23T22-07-25`). Earlier, 157.0.8103.52: browser suite 67/67 on 2026-11-15 (the production-build test always uses Chromium); public sites 7/7 |
| Microsoft Edge 157.0.4341.60 | Verified end to end | 2026-11-16: full browser suite 67/67 (`ANYMCP_E2E_BROWSER=msedge`); public sites 7/7, revocation 3/3 (SDK client). The extension was loaded unpacked over the DevTools protocol, not from a store |
| Brave 1.99.57 (Chromium 157.0.8103.79) | Verified end to end | 2026-11-16: full browser suite 67/67 (`ANYMCP_E2E_BROWSER=brave`); public sites 7/7, revocation 3/3 (SDK client); default Shields settings in a fresh profile |
| Other Chromium browsers (Opera, Vivaldi, Arc, …) | Prepared but untested | MV3 + side panel should work; not tried |
| Firefox, Safari | Not supported | different extension platforms |
| Docked side panel in a real window | Prepared but untested | tests render the same panel page in a tab |
| Chrome's "allow this site" prompt | Prepared but untested | cannot be automated; the form that requests it is tested |

## Installing the bridge

The bridge package is attached to each GitHub release; it is not on the npm registry.

| How | Status | Evidence |
|---|---|---|
| `npx --package=<release address> anymcp-bridge` | Verified locally (Windows 11, Node 24.11, npm 11.6.1) | 2026-11-23 with the published **v0.1.2** package, empty npm cache outside the checkout: `--version` and `/health` answer 0.1.2; it prints the pairing code and a stdio entry `cmd /c npx -y --package=<v0.1.2 address> anymcp-bridge --stdio`, which `npm run smoke:stdio -- --npx=<v0.1.2 address>` starts exactly that way (official SDK client: tools listed, status answered). Earlier, 2026-11-22 with the published v0.1.1 package, fresh npm cache outside the checkout: `--version` and `/health` answer 0.1.1. The stdio entry v0.1.1 printed when started this way named the npm registry and could not work; fixed in 0.1.2, whose entry form (`npx -y --package=<address> anymcp-bridge --stdio`) passed `npm run smoke:stdio -- --npx=<v0.1.1 address>` (official SDK client: tools listed, status answered) |
| `npm install -g <release address>`, then `anymcp-bridge` | Verified locally (Windows 11) | 2026-11-23 with v0.1.2 into a separate prefix (`--version` 0.1.2); 2026-11-22 with v0.1.1: `--version`, `/health`; the printed stdio entry names Node and the installed file |
| Either way on macOS or Linux | Prepared but untested | CI installs the same tarball from a file (`npm run package:check`), not from the release address |

## MCP clients

| Client | Transport | Status | Evidence |
|---|---|---|---|
| Official MCP TypeScript SDK client | HTTP | Verified end to end | browser suites, evaluation, public sites |
| Official MCP TypeScript SDK client | stdio | Verified locally | spawns the real CLI over stdio against a fake extension (`stdio.integration.test.ts`); packaged bridge and installed npm package smoke-tested (`npm run smoke:stdio`, `npm run package:check`) |
| Claude Code 2.1.207 (`claude -p`) | HTTP | Verified end to end | public-site runs: books.toscrape.com, on 2026-11-14, 2026-11-17 and 2026-11-23 (in Chrome, at a1c4d85) with the current bridge (`eval/results/public-sites-2026-11-17T03-30-27`) |
| Claude Code 2.1.207 (`claude -p`) | stdio | Verified end to end | public-site runs: scrapethissite.com through the packaged bridge, 2026-11-14, 2026-11-17 and 2026-11-23 |
| Claude Desktop | stdio | Blocked | not installed on the test machine. Manual test: [first-time-user-test.md](first-time-user-test.md) |
| Cursor | stdio | Blocked | installed, but its interface cannot be operated from this environment and its settings were not modified |
| Other MCP clients | HTTP or stdio | Prepared but untested | standard Streamable HTTP (stateless) and stdio |

## Websites

| What | Status | Note |
|---|---|---|
| Synthetic fixture (orders, catalog, web app, settings) | Verified locally | written by the same author: a development suite, not a held-out set |
| books.toscrape.com, scrapethissite.com (search and countries), quotes.toscrape.com/js, webscraper.io test shop | Verified end to end | read-only practice sandboxes, a few inputs each; all five together 11/11 on 2026-11-18: [public-site-report.md](public-site-report.md) |
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
