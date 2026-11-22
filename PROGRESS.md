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
| Typecheck / unit + integration + property tests | `npm run typecheck` / `npm test` | clean / 160 pass (2026-11-16) |
| Browser suite | `npm run test:e2e` (Chromium 158); `ANYMCP_E2E_BROWSER=chrome` (157.0.8103.52), `=msedge` (Edge 157.0.4341.60), `=brave` (1.99.57) | 67/67 each (2026-11-16) |
| Fixture evaluation | `npm run eval` | 170/170, 0 false success, 0 unapproved |
| Public sites (5 sandboxes, 2026-11-18) | `npm run eval:public` | 11/11, revocation 5/5 |
| Public sites (3 sandboxes) | `npm run eval:public -- --with-claude` (Chromium) and `-- --chrome` | 7/7 equal independent reading in both; Claude Code HTTP + stdio ✓ |
| Packaging | `npm run package -- --verify`, `npm run package:check` | reproducible; tarball installs and runs outside the checkout |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED |
| Release v0.1.1 (pre-release) | `release.yml` on publication (run 44156695564); `gh attestation verify` | 7/7 files identical to a clean build from the tag; attestations verify for all 3 artifacts |
| Release v0.1.0 (pre-release) | `release.yml` on publication (run 44007518598); `gh attestation verify` | 7/7 files identical to a clean build from the tag; attestations verify for all 3 artifacts |
| CI 2026-11-16 | GitHub Actions run 43929412593 at c4e474b (macOS 26 arm64, Ubuntu 26.04 Node 24 + 22 + 20.19, Windows Server 2025) | all green; artifacts byte-identical on every job and to the local build |

## Next (state on 2026-11-22)
Released: v0.1.0 and v0.1.1 as GitHub PRE-RELEASES (verified, attested). main has UNRELEASED fixes from a code
review (CHANGELOG "Unreleased"): a v0.1.2 needs the owner's explicit go-ahead (prepare + dry-run as a draft first).
1. npm NOT published. Owner is logged in as `dilipna`, 2FA is on (recovery codes were pasted into a chat: owner must
   regenerate them). Publishing failed: EOTP without a real authenticator code; with a recovery code the PUT returned
   E404. Easiest fix: add a passkey / security key (Windows Hello) as the 2FA method on npmjs.com, then
   `npm publish ./release/dilipna-anymcp-bridge-0.1.1.tgz --access public --auth-type=web` (approve in the browser),
   or use a 6-digit code from Microsoft/Google Authenticator. The leading `./` is required. After publishing:
   verify from the registry and update README/quick start/listing ("not published yet" → npx).
2. Owner tries v0.1.1 from the release with Claude Code; takes real docked-panel screenshots (docs/quick-start.md).
3. 3–5 first-time users (docs/first-time-user-test.md). 4. Chrome Web Store: upload anymcp-extension-0.1.1.zip,
   Unlisted, fields in store/listing.md, tick Limited Use. 5. Later: lawyer review, external security review.

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
