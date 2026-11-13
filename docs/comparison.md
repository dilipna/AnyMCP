# How MyCP compares with existing browser-MCP and WebMCP projects

**Method.** A research pass on **2026-11-11** read primary sources (GitHub READMEs, docs, package registries,
selected source files). Each cell below is tagged:

* **V-doc** = verified from the project's own documentation · **V-code** = verified from its source
* **M** = measured locally by us · **U** = unknown (not checked, or not determinable from what was read)

**Limits of this comparison.** It was not run end-to-end against each project; behaviour cells reflect docs and
code that were read, not our own experiments (the only things measured locally are listed under *Measured
locally*). Several of the closest projects are days or weeks old, tiny, and self-reported. An absence below
means "not found in what was read", never "proven absent" — those cells are **U**. Competitor code was **not**
copied; licences are noted only so nobody copies by accident.

## The projects

| # | Project | Version / activity (2026-11-11) | Licence | Source |
|---|---|---|---|---|
| 1 | Playwright MCP (+ extension mode) | 0.0.85, 2026-11-09 | Apache-2.0 | github.com/microsoft/playwright-mcp |
| 2 | Chrome DevTools MCP | 1.12.0, 2026-10-22 | Apache-2.0 | github.com/ChromeDevTools/chrome-devtools-mcp |
| 3 | BrowserMCP | `@browsermcp/mcp` 2.4.0 | Apache-2.0 (+ rename request) | github.com/BrowserMCP/mcp |
| 4 | WebMCP (W3C CG draft; Chrome origin trial) | CG-DRAFT | W3C Software & Document | github.com/webmachinelearning/webmcp |
| 5 | MCP-B / WebMCP-org | polyfill deprecated in favour of `@w3c/webmcp-polyfill` | MIT (packages) | github.com/WebMCP-org |
| 6 | Claude in Chrome (Anthropic) | store 1.0.106 | closed | code.claude.com/docs/en/chrome |
| 7 | hangwin/mcp-chrome | v1.0.0 (2025-12) | MIT | github.com/hangwin/mcp-chrome |
| 8 | browser-use/workflow-use | "very early development" | AGPL-3.0 | github.com/browser-use/workflow-use |
| 9 | Skyvern | v1.0.57 | AGPL-3.0 | github.com/Skyvern-AI/skyvern |
| 10 | **browser-to-mcp** | 0.0.1a1, created 2026-07-23 | Apache-2.0 | github.com/browser-to-mcp/browser-to-mcp |
| 11 | **Workflow-to-MCP** | 0.3.0, created 2026-10-29 | MIT (headed "Copyright Microsoft") | github.com/cassiomc1/Workflow-to-MCP |

Projects **10 and 11 are the real overlap**: both record a workflow into a reviewed, typed, verified MCP tool.
MyCP is *not* the first to do that.

## Comparison

| # | Install complexity | Generic actions vs workflow tools | Tool creation & review | Permission enforcement | Result verification | Failure recovery | Execution visibility | Compatibility limits |
|---|---|---|---|---|---|---|---|---|
| 1 | Node 18+, one `npx`; extension mode adds a store extension + tab picker (V-doc) | Generic: 60+ `browser_*` tools, plus a "run code" tool described as RCE-equivalent (V-doc) | Opt-in recording that returns Playwright code; no review/publish flow in README (V-doc; rest U) | Docs say "not a security boundary" for origin limits; per-connection approval (V-doc) | `browser_verify_*` tools called by the agent (V-doc); structured outputs U | Configurable timeouts (V-doc); self-heal U | Per-client tab group + status page (V-doc) | Chrome/Edge extension (V-doc) |
| 2 | Node 20.19+/22.12+, Chrome, one `npx`; attach to own Chrome needs Chrome 144+ and a toggle (V-doc) | Generic + `evaluate_script`; WebMCP opt-in (V-doc) | None found (V-doc) | Allow dialog; per-category toggles; no per-origin option seen (V-doc; incomplete) | None documented (V-doc) | "self-healing errors" principle (V-doc); behaviour U | U | Chrome / Chrome for Testing (V-doc) |
| 3 | Store extension + `npx`, one-time Allow with 6-digit code (V-doc) | One generic `browser` tool taking commands, incl. `eval` (V-code) | None (V-doc/V-code) | One-time pairing Allow; refuses incognito and everything while "Stop" is on; no per-origin/per-tool control found (V-code; rest U) | Prints a ✓ per action, stops at first error; no postconditions found (V-code) | Waits ≤10 s for reconnect (V-doc) | Badge, tab group, Stop (V-code) | No Firefox (V-doc) |
| 4 | Page-side API; Chrome origin trial from 149 / flag (V-doc) | **Site-authored, workflow-specific tools** (V-doc) | Developer-written `registerTool`; no user recording (V-doc) | Permissions-Policy `tools`, `exposedTo` origins; annotations are hints (V-doc) | `outputSchema` added 2026-11-02 (V-code) | Authors told to return actionable errors (V-doc) | Tools run visibly in the page (V-doc) | Declarative form API "not part of the specification" (V-doc) |
| 5 | `npx` relay; page must opt in (V-doc) | Relay for sites that publish tools; userscripts add site tools (V-doc) | Userscripts AI/developer-authored (V-doc); user recording U | Relay: none documented (U) | U | U | U | Userscripts repo last pushed 2026-02 (V-doc) |
| 6 | Store extension + paid plan (V-doc) | Generic; "record a workflow → shortcut" in classic panel (V-doc); typed tools U | Recording yes (V-doc); review-before-enable U | Per-site approval, 3 modes, always-ask list, admin lists (V-doc) | None beyond advice to add checks to prompts (V-doc) | Pauses for login/CAPTCHA (V-doc) | Visible window + tab group; Stop control U | Chrome; paid plans (V-doc) |
| 7 | Node 20+, global npm bridge + native-messaging registration, unpacked extension (V-doc) | ~20 generic tools + `flow.<slug>` typed tools from recorded flows (V-code) | Recorder, builder UI, publish/unpublish (V-code); mandatory review U | Manifest requests `<all_urls>` and `debugger`; per-origin/per-tool enforcement not found (V-code; U) | `assert` step; JSON run result (V-code) | Per-node timeout/retry/backoff/onError (V-code) | U | ~10 months without commits (V-doc) |
| 8 | Clone, build, uv, Playwright, LLM key (V-doc) | Recorded workflow with variables (V-doc) | Recording yes; review U | U | U | Falls back to an agent per failed step (V-doc) | U | "Not for production"; MCP exposure U (V-doc) |
| 9 | pip/Docker + LLM config (V-doc) | LLM/vision tasks; workflow blocks (V-doc) | No-code builder; extension is not a recorder (V-doc) | Chosen tabs in a "controlled" group (V-doc) | Validation block (V-doc) | Does not re-attach dropped tabs (V-doc) | Banner on controlled tab (V-doc) | Extension: no JS eval/downloads/incognito (V-doc) |
| 10 | Python 3.11, uv, Playwright Chromium; **no Chrome extension** (V-doc) | **Workflow-specific, read-only typed tools** (V-doc) | Recording → unreviewed draft → `author` review → publish/rollback; local review UI (V-doc) | Domain allow-list; GET/HEAD/OPTIONS only; per-step risk/confirmation declared; V0 has **no approval UI and no writes** (V-doc) | Typed outputs, success check, draft evaluation vs independent expected answers, traces (V-doc) | No retries; stops at first failure (V-doc) | Redacted trace per run; live stop U (V-doc) | No login or sessions; public sites only (V-doc) |
| 11 | Node 24, pnpm, Playwright browser, unpacked MV3 extension (V-doc) | **Workflow-specific typed tools** `wf_*` (V-doc) | MV3 recorder, review editor, SHA-256 hash trust, verify suite, publish (V-doc) | Origin grants and hash trust separate; **writes need a single-use 60 s approval in a local terminal**, enforced in code; MCP callers cannot grant it (V-doc) | Schema-validated outputs; verify-suite; `OUTCOME_UNKNOWN` after a failed mutating step (V-doc) | No retries or auto-repair (V-doc) | Audit log, `run inspect`; in-browser live indicator/stop U (V-doc) | **Runs in an isolated Chromium, never the primary profile**; auth profiles POSIX-only; no frames/popups/uploads (V-doc) |
| — | **MyCP** (this repo) | Workflow-specific typed tools; generic browser actions are *not* exposed at all | Record → pick params/outputs/success → derived review → test exact version → enable (**M**: e2e) | Per-origin grant (Chrome permission), per-tool enable, code-enforced; approval in the browser bound to tool version + target + args + page values (**M**: e2e) | Mandatory pre/postconditions, schema-validated output, distinct `unknown_outcome`/`empty` (**M**: e2e + eval) | Never auto-replays a write; read-only re-check; interrupted ≠ unknown (**M**: e2e) | Run timeline, in-page banner, toolbar badge, Stop (**M**: e2e) | Standard top-document controls (incl. dropdowns, checkboxes, lists, shadow DOM) on one site per tool; fixture-verified only |

Competitor statements are the research pass's reading of the sources above, **not** independent experiments.

## What MyCP can honestly claim from this

**Improvement 1 — approval in the browser, bound to the exact run, with live visibility.** Of what was read:
Workflow-to-MCP approves in a terminal; browser-to-mcp V0 has no approval UI; Playwright MCP and BrowserMCP
approve at the *connection* level; Claude in Chrome approves per action on generic model-driven steps. MyCP
shows the exact action and the page values on screen, binds the approval to tool version + target + arguments
+ page state, withdraws it if any changes, and re-checks right before the click. *This is a design difference,
not proof of better safety*: Workflow-to-MCP's terminal approval may be preferable for some threat models.

**Improvement 2 — reviewed typed tools that run in the user's own signed-in Chrome.** Workflow-to-MCP states it
never uses the primary profile; browser-to-mcp supports no logins; the real-profile bridges expose only generic
or unreviewed actions. MyCP runs in the user's real profile (in a tab it owns), which makes signed-in sites
usable but also means the blast radius is the user's real sessions. That trade-off is stated, not hidden.

**Not claimed.** "First", "best", "most secure", "state of the art", "more reliable". No head-to-head benchmark
was run, so no performance comparison is made. Both overlapping projects ship result verification too — it is
not a MyCP differentiator.

**Where competitors are ahead.** Much broader tool surfaces (Playwright MCP, DevTools MCP), WebMCP integration
(Playwright MCP, DevTools MCP), non-Chrome browsers, vision/LLM-driven recovery (Skyvern, workflow-use), a
verification suite with independent expected answers (browser-to-mcp), hash-pinned review (Workflow-to-MCP),
admin controls (Claude in Chrome).

## Measured locally (M)

* `claude` 2.1.207 supports `mcp add --transport http --header`, `--mcp-config`, `-p`, `--allowedTools`.
* Chrome 157.0.8103.50: a service worker reaches `ws://127.0.0.1` with no prompt (`scripts/lna-spike.ts`), headless and headed, temporary profile, default settings.
* Branded Chrome 157 loads an unpacked extension over the DevTools protocol; `--load-extension` does not (documented 137+).

## Licence notes (so nobody copies by accident)

Apache-2.0 (1, 2, 3, 10): keep licence text/NOTICE, mark changes; BrowserMCP also asks modified builds be renamed.
MIT (5, 7, 11): keep the notice (11 carries a Microsoft copyright header — check provenance before any reference).
AGPL-3.0 (8, 9): strong copyleft incl. network use — do not adapt into a differently licensed product.
Closed (6, Rook): no reuse. MyCP copied no code from any of them.
