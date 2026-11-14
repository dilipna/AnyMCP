# AnyMCP — progress file (for resuming)

Product: **AnyMCP** (extension display name "AnyMCP Extension", formerly "MyCP"). "Teach a website task once, review
it, and let your AI app run it as an MCP tool." Chrome MV3 extension + local bridge (the MCP server). Developer beta.
Priorities: honest execution > permission boundaries > recovery > simple install > evaluation > polish > extras.

Repository: local commits on `main`; remote `origin` = https://github.com/dilipna/AnyMCP (empty when checked; nothing
pushed). Commits use the owner's GitHub no-reply identity.

## Layout
- `packages/protocol` — zod schemas (ToolDefinition: 7 ops locate/fill/click/press/waitFor/extract/assert), policy,
  result envelope, approval binding, messages. `anymcp-protocol/light` = zod-free subset for the content script.
- `packages/bridge` — MCP server (SDK v2, stateless Streamable HTTP on 127.0.0.1 + bearer token; `--stdio` in
  `src/stdio.ts` becomes / forwards to / takes over the one bridge) + authenticated WebSocket to the extension.
  State in `~/.anymcp` (pre-release `~/.mycp` copied once).
- `packages/extension` — service worker (orchestrator, approvals, bridge client, recording), content script (locator,
  engine, recorder, banner), React side panel. `scripts/build.mjs --target=prod|e2e`.
- `packages/fixture` — synthetic sites (orders portal, catalog, single-page app, self-saving settings, header-less table).
- `packages/eval` — frozen fixture evaluation (protocol v2), `public-sites.ts` (3 public sandboxes, optional Claude Code).
- `e2e/` — Playwright: real Chromium or branded Chrome + built extension + bridge + MCP SDK client.
- `scripts/` — build-all, package-release (ZIP + npm tarball), verify-npm-package, clean-install-check, stdio-smoke, demo-claude.

## Verified (2026-11-14; re-run to confirm)
| Check | Command | Result |
|---|---|---|
| Typecheck / unit + integration | `npm run typecheck` / `npm test` | clean / 133 pass |
| Browser suite | `npm run test:e2e` (Chromium 158) and `ANYMCP_E2E_BROWSER=chrome` (Chrome 157.0.8103.52) | 65/65 each |
| Fixture evaluation | `npm run eval` | 170/170, 0 false success, 0 unapproved |
| Public sites | `npm run eval:public -- --with-claude` (Chromium) and `-- --chrome` | 7/7 equal independent reading in both; Claude Code HTTP + stdio ✓ |
| Packaging | `npm run package -- --verify`, `npm run package:check` | reproducible; tarball installs and runs outside the checkout |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED |

## Next (needs the owner — see docs/release-checklist.md)
1. ~~Naming~~ decided: keep AnyMCP (npm `@dilipna/anymcp-bridge`). 2. Security contact. 3. Push → CI.
4. First-time-user test incl. Claude Desktop/Cursor. 5. Screenshots, hosted privacy policy. 6. Publish npm, then store.

## Decisions that matter (docs/decisions.md)
- Extension is the source of truth for tools; the bridge only gets manifests. Nothing is fetched remotely.
- `commitStarted` journaled before the consequential action; later uncertainty ⇒ `unknown_outcome`; never replayed.
- Site access is requested per exact origin from an address the person types (no `tabs`/`activeTab` permission).
- Stored history never contains tool output or URL paths unless opted in.
- Evaluation catalogue is frozen; any change bumps the protocol version (v2 = rename only).

## Bugs found by tests and checks (worth remembering)
production build could not authorize a first site (tab addresses hidden; tests pre-granted localhost) · over-limit MCP
requests got a bare reset instead of 413 · tables without `<thead>` returned their header row as data · a success check
with a live count matched only one search (now warned) · AnyMCP's own run tab offered for recording · failed second
bridge start overwrote the real pairing code · eval used a missing/stale build · slot text invisible to
`checkVisibility()` · checkbox step recorded after the next click · bridge timer wrote to a deleted state dir after
shutdown · mechanical rename turned facts about "MyCP" into false claims about "AnyMCP" in two docs (fixed).
