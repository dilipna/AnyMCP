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
- `packages/eval` — frozen fixture evaluation (protocol v2), `public-sites.ts` (12 pages on 5 public practice sites, 2 with clicks; `--only=<label words>`, optional Claude Code).
- `e2e/` — Playwright: real Chromium or branded Chrome + built extension + bridge + MCP SDK client.
- `scripts/` — build-all, package-release (ZIP + npm tarball), verify-npm-package, clean-install-check, stdio-smoke, demo-claude.

## Verified (2026-11-14 unless dated; re-run to confirm)
| Check | Command | Result |
|---|---|---|
| Typecheck / unit + integration + property tests | `npm run typecheck` / `npm test` | clean / 209 pass (2026-11-25, 23981ab) |
| Browser suite | `npm run test:e2e` (Chromium 158); `ANYMCP_E2E_BROWSER=chrome` (157.0.8103.52), `=msedge` (Edge 157.0.4341.60), `=brave` (1.99.57) | 67/67 each (2026-11-16) |
| Fixture evaluation | `npm run eval` | 170/170, 0 false success, 0 unapproved |
| Public sites (12 pages, 5 sites, 2026-11-25, code of 23981ab) | `npm run eval:public` | 25/25, both slow-page checks, revocation 12/12 (`public-sites-2026-11-25T09-55-48`) |
| Public sites (12 pages, 5 sites, 2026-11-25, code of 1943928: new-content rule for recorded changes only) | `npm run eval:public` | 25/25, both slow-page checks, revocation 12/12 (`public-sites-2026-11-25T09-35-46`) |
| Public sites (12 pages, 5 sites, 2026-11-25, code of 17967c9: hidden text, numbers, new content after actions) | `npm run eval:public` | 25/25, both slow-page checks, revocation 12/12 (`public-sites-2026-11-25T09-15-36`) |
| Public sites (12 pages, 5 sites, 2026-11-25, code of b55f22c: merged cells, numbers) | `npm run eval:public` | 25/25, both slow-page checks, revocation 12/12 (`public-sites-2026-11-25T08-42-14`) |
| Public sites (12 pages, 5 sites, 2026-11-25, code of 39f4141) | `npm run eval:public` | 25/25, both slow-page checks, revocation 12/12 |
| Public sites (11 pages, 5 sites, 2026-11-25) | `npm run eval:public` | 24/24, both slow-page checks, revocation 11/11 |
| Public sites (9 pages, 5 sites, 2026-11-23, after fixes) | `npm run eval:public` | 20/20, slow-page check, revocation 9/9 |
| Chrome 158.0.8127.37 + Claude Code 2.1.207 (2026-11-25, 23981ab) | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e`; `npm run eval:public -- --chrome --with-claude` | 79/79; 25/25 + Claude Code HTTP ✓ stdio ✓ (`public-sites-2026-11-25T10-04-22`) |
| Chrome 157.0.8103.79 + Claude Code (2026-11-23, a1c4d85) | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e`; `npm run eval:public -- --chrome --with-claude` | 71/71; 20/20 + Claude Code HTTP ✓ stdio ✓ |
| Public sites (5 pages, 4 sandboxes, 2026-11-18; 2026-11-23 with 0.1.2) | `npm run eval:public` | 11/11, revocation 5/5 |
| Public sites (3 sandboxes) | `npm run eval:public -- --with-claude` (Chromium) and `-- --chrome` | 7/7 equal independent reading in both; Claude Code HTTP + stdio ✓ |
| Packaging | `npm run package -- --verify`, `npm run package:check` | reproducible; tarball installs and runs outside the checkout |
| Clean checkout | `node scripts/clean-install-check.mjs` | PASSED |
| Release v0.1.2 (pre-release, 2026-11-23) | `release.yml` on publication (run 45251293145); `gh attestation verify`; install from the release address | 7/7 files identical to a clean build from the tag (6d0b101); attestations verify (Rekor 4056249726), altered copy rejected; `npx --package=<v0.1.2 address>` and `npm install -g` work with an empty cache; printed stdio entry passes `smoke:stdio --npx` |
| Release v0.1.1 (pre-release) | `release.yml` on publication (run 44156695564); `gh attestation verify` | 7/7 files identical to a clean build from the tag; attestations verify for all 3 artifacts |
| Release v0.1.0 (pre-release) | `release.yml` on publication (run 44007518598); `gh attestation verify` | 7/7 files identical to a clean build from the tag; attestations verify for all 3 artifacts |
| CI 2026-11-23 | GitHub Actions run 45128313242 at 6d0b101 (all 5 jobs) | all green; 169/169, 67/67; artifacts byte-identical on every job and locally |
| CI 2026-11-16 | GitHub Actions run 43929412593 at c4e474b (macOS 26 arm64, Ubuntu 26.04 Node 24 + 22 + 20.19, Windows Server 2025) | all green; artifacts byte-identical on every job and to the local build |

## Next (state on 2026-11-23)
Released: v0.1.0, v0.1.1 and **v0.1.2** (2026-11-23) as GitHub PRE-RELEASES (verified, attested). Each new release
still needs its own go-ahead (draft + release.yml dry run first).
1. npm: DROPPED (owner, 2026-11-22). The bridge installs from the release address:
   `npx --package=https://github.com/dilipna/AnyMCP/releases/download/vX.Y.Z/dilipna-anymcp-bridge-X.Y.Z.tgz anymcp-bridge`
   or `npm install -g <address>`. Docs must never tell people to run `npx @dilipna/anymcp-bridge`.
   Owner should still regenerate the npm recovery codes that were pasted into a chat, if the account is reachable.
2. Chrome Web Store: upload anymcp-extension-0.1.2.zip, Unlisted, fields in store/listing.md, tick Limited Use.
   Owner takes real docked-panel screenshots (list in docs/quick-start.md).
3. 3–5 first-time users (docs/first-time-user-test.md); turn feedback into fixes.
4. Claude Desktop / Cursor manual test if the owner installs them. 5. Later: lawyer review, external security review.

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
ending (flaky on macOS CI; scope panel clicks to `<main>`) · store promo tile clipped its text (no border-box) · bridge started with `npx --package=<release .tgz>` told stdio apps to run `npx @dilipna/anymcp-bridge@v`,
which is not on the registry (2026-11-22; now the release address) · 2026-11-23 on new practice pages: a classless list
pattern took in layout-table neighbours → FALSE SUCCESS on an empty page (narrowed by attribute when shape agrees,
spacer cells ignored) · reading did not wait for late content and the recorded success wait was fixed at 5 s (editor
timeout useless) · a picked value unique on one page was ambiguous on the next (anchored to its container) · 2026-11-25: a picked value shown
in a heading/link was found by its own text, so a tool could only return the recorded value (values never use their
own text now).
