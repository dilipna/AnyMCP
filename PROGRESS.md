# AnyMCP — progress file (for resuming)

Product: **AnyMCP** (extension display name "AnyMCP Extension", formerly "MyCP"). "Teach a website task once, review
it, and let your AI app run it as an MCP tool." Chrome MV3 extension + local bridge (the MCP server). Developer beta.
Priorities: honest execution > permission boundaries > recovery > simple install > evaluation > polish > extras.

Repository: https://github.com/dilipna/AnyMCP (public; `main` pushed 2026-11-15, after one history rewrite that dropped
pre-rename panel images, so commit ids before that date changed: map in `docs/evaluation-protocol.md`). Do not rewrite
public history. Commits use the owner's GitHub no-reply identity. Private vulnerability reporting is on. GitHub Pages
serves `docs/` at https://dilipna.github.io/AnyMCP/ (privacy policy: `/privacy-policy`).

## Layout
- `packages/protocol` — zod schemas (ToolDefinition: 7 ops locate/fill/click/press/waitFor/extract/assert), policy,
  result envelope, approval binding, messages. `anymcp-protocol/light` = zod-free subset for the content script.
- `packages/bridge` — MCP server (SDK v2, stateless Streamable HTTP on 127.0.0.1 + bearer token; `--stdio` in
  `src/stdio.ts` becomes / forwards to / takes over the one bridge) + authenticated WebSocket to the extension.
  State in `~/.anymcp` (pre-release `~/.mycp` copied once).
- `packages/extension` — service worker (orchestrator, approvals, bridge client, recording), content script (locator,
  engine, recorder, banner), React side panel. `scripts/build.mjs --target=prod|e2e`.
- `packages/fixture` — synthetic sites (orders portal, catalog, single-page app, self-saving settings, header-less table,
  rich text inbox with a model-keeping editor and an Enter-to-send chat).
- `packages/eval` — frozen fixture evaluation (protocol v2), `public-sites.ts` (3 public sandboxes, optional Claude Code).
- `e2e/` — Playwright: real Chromium or branded Chrome + built extension + bridge + MCP SDK client.
- `scripts/` — build-all, package-release (ZIP + npm tarball), verify-npm-package, clean-install-check, stdio-smoke, demo-claude.

## Verified (2026-11-14 unless dated; re-run to confirm)
| Check | Command | Result |
|---|---|---|
| Typecheck / unit + integration + property tests | `npm run typecheck` / `npm test` | clean / 153 pass (2026-11-16) |
| Browser suite | `npm run test:e2e` (Chromium 158); `ANYMCP_E2E_BROWSER=chrome` (157.0.8103.52), `=msedge` (Edge 157.0.4341.60), `=brave` (1.99.57) | 67/67 each (2026-11-16) |
| Fixture evaluation | `npm run eval` | 170/170, 0 false success, 0 unapproved |
| Public sites | `npm run eval:public -- --with-claude` (Chromium) and `-- --chrome` | 7/7 equal independent reading in both; Claude Code HTTP + stdio ✓ |
| Packaging | `npm run package -- --verify`, `npm run package:check` | reproducible; tarball installs and runs outside the checkout |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED |
| CI 2026-11-16 | GitHub Actions run 43824366060 (macOS 26 arm64, Ubuntu 26.04 Node 24 + 22 + 20.19, Windows Server 2025) | all green; artifacts byte-identical on every job and to the local build |

## Next (needs the owner — see docs/release-checklist.md)
Done 2026-11-15/16: naming, security contact (private reporting), push + green CI, hosted privacy policy, fuzzing,
Edge/Brave, CodeQL, release workflow, DRAFT release v0.1.0 (owner publishes it).
1. `npm login` (owner), then publish `release/dilipna-anymcp-bridge-0.1.0.tgz` (identical to the draft's file), publish
   the draft release, and update quick-start/README/listing ("not published yet"; add the release download path).
   CodeQL alerts 5 and 6 (intended report writes in dev scripts): owner may dismiss. 2. First-time-user test incl. Claude Desktop/Cursor. 3. Real docked-panel screenshots; a
   lawyer's look at the policy. 4. Chrome Web Store submission (owner's developer account).

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
shutdown · mechanical rename turned facts about "MyCP" into false claims about "AnyMCP" in two docs (fixed) · lockfile
from npm 11.6 lacked entries npm 11.19 requires (CI `npm ci` failed everywhere) · ArrowDown on a `<select>` opens the
menu on macOS (3 tests) · fuzz tests (2026-11-16): `__proto__` vanished from canonical JSON (hash collisions),
inherited `constructor`/`toString` passed argument validation or were substituted as values, autocomplete token lists
and `cvv2`/"Security code" fields were not recognised as sensitive · `getByText(tool).first()` clicked the header's `Running “tool”` pill while a run was
ending (flaky on macOS CI; scope panel clicks to `<main>`) · store promo tile clipped its text (no border-box).
