# AnyMCP

[![CI](https://github.com/dilipna/AnyMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/dilipna/AnyMCP/actions/workflows/ci.yml)

*Teach a website task once, review it, and let your AI app run it as an MCP tool.*

**AnyMCP lets your AI app use website tasks that you teach once in your own Chrome and approve: a Chrome extension
records the task, and a small local bridge offers it to your AI app as an MCP tool.**

> **Status: developer beta**, available as a [GitHub pre-release](https://github.com/dilipna/AnyMCP/releases/tag/v0.1.1); not on the Chrome Web Store or npm.
> Verified on Windows 11 with Chromium 158
> and Chrome 157, on a synthetic test site and three public scraping sandboxes, with Claude Code as a real client; the
> automated suites also pass on macOS and Linux in CI. It is not production software, has not
> had a security review, and does not work on every website. See [docs/compatibility.md](docs/compatibility.md).

## The problem

AI apps that speak the [Model Context Protocol](https://modelcontextprotocol.io) (MCP) can call tools, but most
websites offer no API, and letting a model drive your browser freely is unpredictable and hard to review.
AnyMCP sits in between: **you** show the extension a task once on a site you choose, review exactly what the
resulting tool may read and change, test it, and enable it. Your AI app can then call it like any other MCP tool
and gets back a structured result that says whether the task really worked.

## What it is (and is not)

| Part | What it does |
|---|---|
| **AnyMCP extension** (Chrome, MV3) | Where tools are recorded, reviewed, tested, enabled and run, in a tab of your own signed-in browser. It is the source of truth for tools, allowed sites and approvals. |
| **AnyMCP bridge** (Node.js program on your computer) | **The MCP server.** Your AI app connects to it over **HTTP** (127.0.0.1, bearer token) or **stdio** (the app starts it). It relays calls to the extension over an authenticated local WebSocket. Needed because an extension cannot be an MCP server by itself. |
| **Your AI app** (an MCP client, e.g. Claude Code) | Discovers the enabled tools, calls them, and uses the results. **It supplies the model.** AnyMCP calls no AI model and needs no account or API key. |

**Not** included: an "extension only" mode, automatic tool generation by AI, a hosted service, or a promise that any
website becomes a reliable API. A tool is a fixed, reviewed recipe (seven operations: find, fill, click, press Enter,
wait, read, check). If the site changes, the tool stops and says so instead of guessing.

## How a call flows

```
 AI app (MCP client)           e.g. Claude Code: "list the books in the mystery category"
      │  MCP over HTTP (127.0.0.1 + bearer token)  or  stdio (the app starts the bridge)
      ▼
 AnyMCP bridge (MCP server)    checks arguments against the tool's schema, one run at a time
      │  authenticated WebSocket (127.0.0.1, paired with a one-time code)
      ▼
 AnyMCP extension              tool enabled? site still allowed? definition unchanged?
      │  opens/reuses a tab it owns, on that site only
      ▼
 the website you allowed       the steps run; the result is read from the page and verified
      │
      ▼  structured result: status, verification, the values read (marked untrusted), source address
 back to the AI app            (and to its model provider, under that provider's policy)
```

Details: [docs/architecture.md](docs/architecture.md) · data handling: [docs/privacy-policy.md](docs/privacy-policy.md).

## Demonstrated use case

Read-only lookups on public pages, recorded through the real recorder and then called from MCP clients
([report](docs/public-site-report.md), raw results in [eval/results/](eval/results/)):

* **"Books in a category"** on `books.toscrape.com`: the category is part of the address; every result comes back
  as `{ text, url }` with the book's link. Claude Code (HTTP) returned the right titles and exact URLs.
* **"Search hockey team seasons"** on `scrapethissite.com`: a search whose words are in the address; results are
  table rows. Claude Code returned the right rows over **stdio** through the packaged bridge.
* **"Quotes on a page"** on `quotes.toscrape.com/js/`: the page draws its content with JavaScript after loading.

All seven SDK-client runs equalled an independent reading of the same page. That shows these pages work today; it
says nothing about other sites.

## Quick start (from source, about 10 minutes)

Requirements: **Chrome ≥ 116** (Microsoft Edge and Brave also pass the test suites), **Node.js ≥ 20.19**, git. No
account or paid service.

**No build needed:** from the [v0.1.1 pre-release](https://github.com/dilipna/AnyMCP/releases/tag/v0.1.1) download `anymcp-extension-0.1.1.zip` (unzip it and load
that folder in step 1) and `anymcp-bridge-0.1.1.mjs` (run `node anymcp-bridge-0.1.1.mjs` instead of the commands
below). To build from source:

```bash
git clone https://github.com/dilipna/AnyMCP anymcp && cd anymcp
npm ci
npm run build          # builds the extension (packages/extension/dist/prod) and the bridge
npm run bridge         # starts the bridge; prints a pairing code and how to connect your AI app
```

1. **Install the extension:** `chrome://extensions` → *Developer mode* → *Load unpacked* →
   `packages/extension/dist/prod`. Click the AnyMCP toolbar icon to open the side panel.
2. **Pair:** in the side panel enter the 8-digit code the bridge printed.
3. **Connect your AI app:** *Settings → Show the client command*. Claude Code: run the printed
   `claude mcp add --transport http anymcp … --header "Authorization: Bearer …"`. Apps that start MCP servers
   themselves (stdio): paste the printed `mcpServers` entry.
4. **Allow a website:** *Teach → Allow a website* → paste its address (e.g. `https://books.toscrape.com`) →
   confirm Chrome's prompt.
5. **Try a read-only task:** open the site, *Start recording*, *Pick a list* on the results, *Mark a message* on
   something that proves the page loaded, stop, review, test, enable. Then ask your AI app to use the tool.

The home screen's **Getting started** checklist shows which of these steps are done, and its **This site** card
says what AnyMCP may do on the tab you are looking at (or that it cannot see that site at all). Step by step:
[docs/quick-start.md](docs/quick-start.md). Something wrong: [docs/troubleshooting.md](docs/troubleshooting.md).

**Stop / update / uninstall:** Ctrl+C stops the bridge (a stdio bridge stops when its app quits). Update with
`git pull && npm ci && npm run build`, then reload the extension. Uninstall: remove the extension, remove `anymcp`
from your AI app's MCP settings, delete `~/.anymcp` (pairing secret and client token).

## Safety model in one paragraph

You allow sites one at a time (Chrome asks you to confirm); a tool only runs on its own site, only when enabled,
and only the exact version you tested. Tools that change data ask for approval **in the browser on every run**,
bound to the exact action and page values; a write is never repeated automatically, and an uncertain one is
reported as `unknown_outcome`. Password and payment fields are never recorded, read or filled. Page text returned
to your AI app is marked untrusted. Details and the limits of all this: [docs/threat-model.md](docs/threat-model.md).

## Commands

| command | does |
|---|---|
| `npm run build` | build the extension (production) and the bridge |
| `npm run bridge` | run the bridge from source |
| `npm test` | unit and integration tests |
| `npm run test:e2e` | browser tests: real Chromium + built extension + bridge + MCP client (`ANYMCP_E2E_BROWSER=chrome` for branded Chrome) |
| `npm run eval` | frozen evaluation on the synthetic fixture |
| `npm run eval:public` | read-only validation on three public sandboxes (`-- --with-claude` also drives Claude Code) |
| `npm run package` | reproducible extension ZIP + npm package of the bridge in `release/` (nothing is published) |
| `npm run package:check` | install the packed bridge outside the checkout and run it |

## Documentation

[docs/index.md](docs/index.md) lists everything. Most useful: [compatibility](docs/compatibility.md) ·
[known limitations](docs/known-limitations.md) · [architecture](docs/architecture.md) ·
[privacy policy](docs/privacy-policy.md) ([hosted](https://dilipna.github.io/AnyMCP/privacy-policy)) · [security](SECURITY.md) · [naming check](docs/naming-check.md) ·
[changelog](CHANGELOG.md) · [contributing](CONTRIBUTING.md).

## Licence

MIT for the original code ([LICENSE](LICENSE)). Bundled third-party code keeps its own licences; `npm run package`
writes the notices into each artifact. "AnyMCP" was renamed from the pre-release name "MyCP". It is not related to
the npm package named `anymcp`; this project's bridge will be published as `@dilipna/anymcp-bridge`
(see the [naming check](docs/naming-check.md)).
