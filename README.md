# MyCP

**Turn approved website workflows into reusable AI tools.**
Teach a workflow, review its permissions, and let your AI assistant run it with verified results.

MyCP is a Chrome extension (**MyCP Extension**) plus a small local program (the **bridge**). You teach
the extension a task on a website once — "find an order", "save a draft note" — review exactly what it
can read and change, test it, and enable it. Your AI assistant (any MCP client, such as Claude Code) can
then call it as a typed tool. Every call returns a structured result that says **whether the task really
worked**, and MyCP stops and says so when it is not sure.

> **Status: release candidate for local use.** It is not published, has not been submitted to the Chrome
> Web Store, and has been verified only against a synthetic fixture site plus the read-only checks listed
> in [docs/external-site-report.md](docs/external-site-report.md). See [What MyCP does not do](#what-mycp-does-not-do).

## Why this exists (and what is *not* new)

Browser-automation servers for AI assistants already exist, and some also record workflows into typed
tools — see the checked comparison in [docs/comparison.md](docs/comparison.md). MyCP does not claim to be
the first, the most capable, or "state of the art". What it commits to, and tests, is narrower:

1. **Reviewed tools in your own signed-in Chrome.** A tool is plain data in a closed seven-operation
   vocabulary (find, fill, click, press Enter, wait, extract, assert) — never downloaded or generated code. You review a
   summary *derived from the structure* ("runs only on…", "reads…", "may change…", "needs approval…",
   "success means…"), test the exact version, and only then enable it.
2. **Honest outcomes.** Distinct statuses: `success`, `empty` (a verified empty result), `unknown_outcome`
   ("the action may or may not have happened — check the website"), `interrupted` (safe to retry), and more.
   A click or a successful page load is never proof. An uncertain write is **never** replayed automatically.
3. **Per-run approval for changes**, shown in the browser, bound to that one run — tool version, target
   element, arguments and the page values you were shown. If any of them changes, the approval is withdrawn.

## How it fits together

```
 AI assistant (MCP client)
        │  MCP over HTTP, loopback only, bearer token            ← connection 1
        ▼
  MyCP bridge (Node, 127.0.0.1)  ── validates args, enforces one-run-at-a-time, dedupes, reports honestly
        │  authenticated WebSocket (pairing code → HMAC)         ← connection 2 (separate)
        ▼
  MyCP Extension (Chrome MV3)  ── source of truth for tools, permissions, approvals; runs steps in a tab it owns
        ▼
  the website (your normal, signed-in session — cookies never leave the browser)
```

Details: [docs/architecture.md](docs/architecture.md) · [docs/threat-model.md](docs/threat-model.md) ·
[docs/decisions.md](docs/decisions.md).

## Install and run (Windows, macOS, Linux)

Requirements: **Node.js ≥ 20.19**, **Chrome ≥ 116**. No account, API key or paid service is needed.

```bash
git clone <this repository> mycp && cd mycp
npm ci
npm run build            # builds the extension (packages/extension/dist/prod) and the bridge bundle
npm run bridge           # starts the bridge; prints a pairing code and your client command
```

1. **Load the extension:** open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked*, and
   select `packages/extension/dist/prod`. Click the MyCP toolbar icon to open the side panel.
2. **Pair:** in the side panel enter the 8-digit code the bridge printed. (Single use; expires in 10 minutes.)
3. **Connect your assistant:** the side panel (*Settings → Show the client command*) and the bridge terminal
   both show what to paste:
   * **Claude Code** (and other apps that connect over HTTP):
     `claude mcp add --transport http mycp http://127.0.0.1:47820/mcp --header "Authorization: Bearer <token>"`
   * **Apps that start MCP servers themselves** (stdio): an `mcpServers` entry that runs
     `node <path>/mycp-bridge.mjs --stdio`. No token is needed. The app then starts MyCP for you; if a bridge is
     already running it shares it, so several apps can use one browser connection.
4. **Teach a tool:** open the website, then *Teach → choose the tab → Allow this site → Start recording*.
   Do the task once, use *Pick a value* / *Mark a message*, stop, review, save, test, enable.

Try it without any real website: `npm run dev` starts the synthetic **Acme Support Portal** fixture and the
bridge together (see [docs/demo-script.md](docs/demo-script.md)).

Trouble? [docs/troubleshooting.md](docs/troubleshooting.md).

## Commands

| command | does |
|---|---|
| `npm run build` | build extension (prod) + bridge bundle |
| `npm run bridge` | run the local bridge |
| `npm run dev` | fixture site + bridge + e2e extension build for development |
| `npm test` | unit and integration tests (protocol, policy, bridge, approvals) |
| `npm run test:e2e` | browser tests: real Chromium + built extension + bridge + MCP client |
| `MYCP_E2E_BROWSER=chrome npm run test:e2e` | the same suite in your real, branded Chrome |
| `npm run eval` | frozen evaluation (see [docs/evaluation-protocol.md](docs/evaluation-protocol.md)) |
| `npm run package` | reproducible, versioned extension ZIP + bridge bundle in `release/` |
| `npm run smoke:stdio` | after `npm run build`: drive the packaged bridge over stdio with the official MCP SDK client |

## What MyCP does not do

* **It does not work on every website.** It handles pages built from standard buttons, links, text fields,
  dropdowns, checkboxes, option buttons, lists and tables in the top document, including web components (shadow
  DOM). Not supported: iframes, rich-text editors, file uploads, CAPTCHAs, drag-and-drop, canvas-only apps,
  multi-factor prompts. It never signs in for you. → [docs/supported-capabilities.md](docs/supported-capabilities.md)
* **It cannot promise exactly-once side effects.** Browsers and networks can re-send requests (observed
  during development). MyCP never re-clicks or re-submits on its own and verifies results by re-reading the
  page. → [docs/known-limitations.md](docs/known-limitations.md)
* **It cannot stop an AI model from being fooled by text on a web page.** It returns page text as *data*,
  labelled untrusted, and guarantees only that MyCP's own permission boundaries cannot be widened by it.
* **It is not security-audited, and it makes no claim of perfect reliability or complete security.**
* **It is not on the Chrome Web Store.** A store-ready package and listing draft exist (`store/`); approval
  is not claimed and cannot be until Google grants it.

## Evidence

Every claim above is backed by a test or a measurement you can re-run:
[docs/release-checklist.md](docs/release-checklist.md) separates what is **verified**, **unverified** and
**owner-required**. Evaluation results (with exact denominators, environment and failures) are in `eval/results/`.

## Name

"MyCP" is the product name chosen by the project owner. A public-name check found conflicts (an existing npm
package, a registered-looking Class 42 mark that was not verified at the USPTO, several products using the
acronym). All packages here are `private`. Read [docs/naming-check.md](docs/naming-check.md) before any
publication or store listing.
