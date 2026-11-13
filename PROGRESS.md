# AnyMCP — progress file (for resuming)

Product: **AnyMCP** / user-facing **AnyMCP Extension** — "Turn approved website workflows into reusable AI tools."
Chrome MV3 extension + local MCP bridge. Priorities: honest execution > permission boundaries > recovery > simple install > evaluation > polish > extras.

## Layout
- `packages/protocol` — zod schemas (ToolDefinition, 7 ops only: locate/fill/click/press/waitFor/extract/assert), policy validator, result envelope + outcome statuses, approval binding, bridge↔extension messages. `anymcp-protocol/light` = zod-free subset for the content script (23 KB).
- `packages/bridge` — Node MCP server (official SDK v2, stateless Streamable HTTP, loopback, bearer token; `--stdio` mode in `src/stdio.ts` becomes/forwards to/takes over the one bridge) + separate authenticated WebSocket to the extension (pairing code → HMAC). Run manager: dedupe, busy, disconnect rules. `dist/anymcp-bridge.mjs` = single-file bundle.
- `packages/extension` — MV3: service worker (orchestrator, approvals, bridge client, recording), content script (locator, engine, recorder, banner), React side panel (8 screens). `scripts/build.mjs --target=prod|e2e`.
- `packages/fixture` — "Acme Support Portal (SYNTHETIC)" + chaos controls + ground-truth write log; hand-authored `find_order` / `draft_customer_note`.
- `packages/eval` — frozen scenario catalogue (`src/scenarios.ts`), runner (`src/run.ts`), external check (`src/external.ts`), `scenarios.lock.json` (written by `npm run eval:freeze`).
- `e2e/` — Playwright: real Chromium (or real Chrome via `ANYMCP_E2E_BROWSER=chrome`) + built extension + bridge + MCP SDK client.
- `docs/`, `store/`, `scripts/` (build-all, dev, package-release, screenshots, store-assets, demo-claude, lna-spike).

## Verified so far (re-run to confirm)
| Check | Command | Last result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Unit + integration | `npm test` | 113 pass (incl. policy for press/self-saving fills, draft builder, bridge shutdown-mid-run, stdio forwarding/takeover/exit, pairing file) |
| E2E (Chromium 158) | `npm run test:e2e` | 61/61 pass (incl. `capabilities.spec.ts`, `webapps.spec.ts`, a11y on recording, review editor and client setup) |
| E2E (real Chrome 157) | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e` | 61/61 pass, full suite (2026-11-13) |
| Evaluation (fixture) | `npm run eval` | 170/170 correct, 0 false success, 0 unapproved, 105/105 recovered (`eval/results/fixture-chromium-2026-11-13T18-37-14.*`) |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED (npm ci, typecheck, tests, build, reproducible package, bridge /health) |
| Packaged bridge over stdio | `npm run build && npm run smoke:stdio` | PASS |
| E2E (real Chrome 157.0.8103.50) | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e` | 45/46 once, 1 intermittent failure not reproduced in 6 reruns (see docs/known-limitations.md #17) |
| a11y | `e2e/a11y.spec.ts` | axe WCAG A/AA: 0 violations, all core screens, light + dark; found+fixed a real dark-mode contrast bug |
| LNA risk | `npm run spike:lna` | works in real Chrome 157, headless + headed, no prompt |
| Bundled bridge | `node packages/bridge/dist/anymcp-bridge.mjs` | serves; 401 w/o token, 403 bad Host |

## Capabilities added (2026-11-13)
- Fill `<select>` (by visible option text; refuses duplicates/disabled/multi), checkbox/switch/radio (native + ARIA; sets state, never blind-toggles).
- `extract` source `list` (every match, page order, bounded) + recorder "Pick a list" (`suggestListLocator`: repeated testid → role in named container → CSS, flagged fragile).
- Shadow DOM: `deepQueryAll`/`composedClosest`/`composedParent` in `content/locator.ts`; closed roots via `chrome.dom.openOrClosedShadowRoot`; slot text.
- Start page query string: `entry.query` template; credential-looking keys refused by policy (`isCredentialQueryKey`), their values never held; tracking keys dropped by default; editor "Start page" card.
- Recorder: event order numbers are monotonic across pages (`nextSeq`), steps inserted in order; sensitive fields counted once, values never held; substrings < 3 chars never parameterised.
- Fixture `/catalog?lang=en` (dropdown, checkbox, radios, `<acme-button>` in shadow DOM, result list) + ground truth `searchProducts`.

## Capabilities added (2026-11-13, second round)
- Single-page apps: preconditions are polled (bounded by the step timeout) — apps that draw themselves after "load" no longer fail at the start check. Proven by fixture `/app` (renders 600 ms after load).
- `press` op (Enter): recorder records it when Enter is pressed outside a form with a submit button; engine replays key events, then does the browser's implicit submission unless cancelled.
- Self-saving fields: `fill.effect: "commit"` → approval path (`CommitAction` click|press|fill), `acted` flag ⇒ unknown_outcome, `no_change_needed` when already set (no prompt, no write).
- Custom dropdowns/menus: openers (`role=combobox`, `aria-haspopup`, `summary`) recorded; clicked options carry sibling choices; editor "Make the choice an input" (`asParam`), "Keep this text as recorded" (`keepText`), warning when a typed value partly rewrites a clicked text.
- AnyMCP-owned run tabs are not offered / accepted for recording.
- Bridge: `anymcp_status` tool; `--stdio`; pairing code published to `~/.anymcp/pairing.json` while unpaired (only by the owner); `anymcp-bridge` explains a running bridge instead of failing; half-started bridge cleans up.
- Eval harness builds the current e2e extension itself.

## Remaining (see docs/release-checklist.md for the authoritative list)
1. Freeze protocol + headline eval run (fixture) on Chromium and real Chrome; external read-only check (books.toscrape.com); real-client demo with `claude -p`.
2. `npm run screenshots` → `scripts/store-assets.ts`; `npm run package -- --verify`; clean-checkout install check.
3. Fill the release checklist with real statuses. **Repo has no commits** (git-init'd only) — results are stamped with a source-tree hash instead; commit when the owner wants.

## Decisions that matter (docs/decisions.md)
- Extension is source of truth for tool definitions; bridge only gets manifests. Definitions never fetched remotely (Web Store remote-code rule).
- `commitStarted` journaled BEFORE the consequential click; later uncertainty ⇒ `unknown_outcome`; writes never auto-replayed.
- Stored history never contains tool output or URL path unless opted in (`redactEnvelopeForStorage`).
- Playwright's Chromium needed for e2e; real branded Chrome via DevTools `Extensions.loadUnpacked` (+ `--enable-unsafe-extension-debugging`).
- Name: bare `anymcp` is taken on npm; possible Class 42 trademark (unverified). All packages `private`. Do a real clearance before publishing.

## Bugs found by the tests (worth remembering)
AnyMCP's own run tab offered for recording (next run hijacked it) · failed second bridge start overwrote the real pairing code (caught in review, regression-tested) · eval silently used a missing/stale build · slot text invisible to `checkVisibility()` (display:contents) → web-component button had no name · checkbox step recorded after the following click (async state read) · bridge run timer fired after shutdown and wrote to a deleted state dir (would crash the bridge) · bridge dropped authenticated sockets after 5 s (hello timer never cleared) · tool with required output never produced on success path · stored history leaked URL path (arg value) · pick not re-armed after navigation · stale approval sheet after worker death · dark-mode danger button contrast · eval harness race counted an approved write as unapproved · browser re-sent a POST 3× on a reset connection (not a bug; documented limitation).
