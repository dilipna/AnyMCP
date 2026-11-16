# Contributing to AnyMCP

Thank you for helping. AnyMCP is a developer beta maintained by one person, so reviews are best effort.

* **Security problems:** do not open an issue. Report privately, as described in [SECURITY.md](SECURITY.md).
* **Bugs and site reports:** open an issue with the form. Never paste your bridge token, pairing code or pairing
  secret, and remove private page content.
* **Larger changes:** open an issue first, so we can agree on the approach before you write code.

## Set up

Node.js 20.19 or newer and git. The browser tests use Playwright's Chromium (installed below); an installed Chrome,
Edge or Brave is optional, for running the same suite in that browser.

```bash
git clone https://github.com/dilipna/AnyMCP && cd AnyMCP
npm ci
npx playwright install chromium   # once, for the browser tests
```

Layout and design: [docs/architecture.md](docs/architecture.md) and [docs/decisions.md](docs/decisions.md).

## Before you open a pull request

| Check | Command |
|---|---|
| Types | `npm run typecheck` |
| Unit, integration and property tests | `npm test` |
| Browser suite (real Chromium + built extension + bridge + MCP client) | `npm run test:e2e` |
| Same suite in an installed browser | `ANYMCP_E2E_BROWSER=chrome npm run test:e2e` (or `msedge`, `brave`) |
| Packaging is reproducible, and the npm package installs and runs | `npm run package -- --verify` then `npm run package:check` |
| Longer fuzzing campaign (optional) | `ANYMCP_FUZZ_RUNS=20000 ANYMCP_FUZZ_SEED=<any number> npm test` |

CI runs the same checks on macOS, Linux and Windows. A failing fuzz test prints its seed: re-run with that
`ANYMCP_FUZZ_SEED` to reproduce it exactly.

## Rules this project keeps

* **Docs must match the code.** A change in what AnyMCP can do also updates `docs/supported-capabilities.md`,
  `docs/known-limitations.md` and `docs/compatibility.md`. A change in what data it handles or where data goes also
  updates `docs/privacy-policy.md` (and its effective date) and `store/listing.md`, and is marked **Data** in
  `CHANGELOG.md`.
* **Claims carry evidence labels** (Verified end to end, Verified locally, Mock-tested, Prepared but untested,
  Blocked) and link to a reproducible test or result. "0 failures" means "0 in N runs".
* **Reproduce a defect before fixing it**, and keep the test that showed it.
* **No remote code.** Tools are data interpreted by a fixed set of operations bundled in the extension; nothing is
  fetched or evaluated at run time.
* **Privacy first.** Password, payment, token and one-time-code fields are never recorded, read or filled; stored
  history never holds tool output or page paths unless the user opts in. New code must keep both true.
* **Every data-changing step needs the user's approval in the browser**, bound to the exact action and page values,
  and an uncertain outcome is reported as `unknown_outcome`, never retried automatically.
* The frozen evaluation catalogue (`packages/eval/scenarios.lock.json`) changes only with a new protocol version
  ([docs/evaluation-protocol.md](docs/evaluation-protocol.md)).

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE) of this repository.
