# Threat model

Scope: AnyMCP Extension + bridge on one user's computer. Not audited. This lists what AnyMCP defends against,
how, where the test is, and — equally important — what it does **not** defend against.

## Assets

1. The user's logged-in website sessions (cookies, tokens). **Never exported**: the browser keeps them; the
   assistant only ever receives the declared output values.
2. The ability to read or change data on sites the user is signed in to.
3. The AnyMCP credentials: extension pairing secret, MCP bearer token.
4. The user's local run history and tool definitions.

## Actors

* **The user** — trusted, but can be rushed or confused → explicit review, plain-language prompts, per-run approval.
* **The AI assistant / MCP client** — semi-trusted: it can be wrong or manipulated → it can only call enabled
  tools with schema-valid arguments; it cannot approve, create, edit or enable tools.
* **Web page content** — untrusted: may contain instructions, spoofed UI, redirects, duplicate controls.
* **Other local processes / other web pages** — may probe the loopback ports.
* **A malicious or compromised website the user visits** — may try to reach the bridge or extension.

## Threats, mitigations, evidence

| # | Threat | Mitigation (in code) | Evidence |
|---|---|---|---|
| T1 | A web page tells the assistant to misuse a tool ("ignore previous instructions…") | Page text is returned as data, flagged `untrustedContent`; AnyMCP's permission boundaries do not depend on model behaviour; writes need a human click | `failures.spec` hostile content: 0 writes, 0 prompts, tool set unchanged |
| T2 | Prompt injection makes the assistant call a write tool | Every write needs a per-run approval in the browser that the assistant cannot give; approval shows exact action + values | `approval.spec`; sender check unit tests |
| T3 | Page changes between approval and click (bait-and-switch) | Approval bound to a hash of tool version, target, args, page values; page polled; re-checked in the content script right before the click | invalidation e2e (state, target, last-moment race) |
| T4 | Web page or content script forges an approval/revoke/save-tool message | Only senders whose URL is the extension's own origin are accepted; a content script's sender is the web page and is refused | `sender.test.ts` |
| T5 | Another local process or web page uses the bridge | Loopback bind; Host + Origin validation; bearer token; no CORS headers; WS needs `chrome-extension://` Origin, matching id, pairing code then HMAC | bridge integration tests (401/403/handshake); `network.fuzz.test.ts` (random methods, paths, Host/Origin/Authorization and bodies: never a 5xx, never a success without the exact token from a loopback host and origin; random WebSocket origins and frames never pair) |
| T6 | DNS rebinding | Host header allow-list, Origin validation | bridge tests |
| T7 | Brute-forcing the pairing code | single use, 10-minute expiry, 5 attempts then rotates | bridge tests |
| T8 | A tool acts on the wrong site (redirect, lookalike) | Exact origins only; origin checked on every `ensureContent`; links/forms that leave the origin are refused | permissions e2e (mid-run redirect to another origin) |
| T9 | Stored tool tampered with / edited to skip approval | Definition hash re-checked at every run; policy re-validated at every run | permissions e2e (tampered, policy-violating); `fuzz.test.ts` (randomly mutated definitions never crash parsing or policy, and every change changes the hash) |
| T10 | Recording captures secrets | Sensitive-field detection (type; every `autocomplete` token, e.g. `billing cc-number`; name/id/label words in any casing or with a digit, e.g. `cvv2`, `securityCode`; `data-anymcp-ignore`) at capture; only trusted user events; only the approved origin; values kept in memory only | recording e2e (7 sensitive fields skipped, including one known only from its autocomplete tokens and one only from its label; storage scanned for the secrets); `fuzz.test.ts` (generated field names and autocomplete lists) |
| T11 | Duplicate or replayed writes | Bridge dedupes in-flight identical calls and refuses an identical completed/unknown write for 10 min; extension never auto-replays a click; write tools have `maxAttempts = 1` | e2e duplicate + ack-lost tests (POST count) |
| T12 | A false "success" | Success needs every postcondition observed and a schema-valid output; uncertain ⇒ `unknown_outcome` | evaluation: false-success count |
| T13 | Stale approval prompt after the worker dies | Prompt held in memory only; panel drops it when the worker connection drops; `decide` verifies execution id + hash | resilience e2e |
| T14 | Leakage into history/logs | Records exclude outputs and URL paths; diagnostics opt-in, redacted | recording + slice e2e privacy assertions |
| T15 | A forwarded stdio call runs twice | The stdio forwarder retries only when the request certainly never ran (connection refused, or 401 after a token rotation); any other failure is reported as "outcome unknown — do not retry" | `stdio.integration.test.ts` |
| T16 | A field that saves by itself changes data without approval | Fills can be marked `commit` (approval path, binding re-checked, write-ahead intent); unmarked dropdown/checkbox steps are flagged in review; a commit fill that would change nothing is not performed and is reported as `no_change_needed` | `webapps.spec` (settings dropdown + ARIA switch, server write log) |
| T17 | The pairing code is read from disk | While unpaired, the running bridge writes its current single-use code to `pairing.json` (owner-only on POSIX) next to `state.json`, which already holds stronger secrets; removed once paired and on exit; only the bridge that owns the ports writes it | `stdio.integration.test.ts` (pairing file) |
| T18 | Arguments named like built-in object properties (`constructor`, `__proto__`, `toString`) slip past validation, are read from `Object.prototype`, or make two different argument sets hash the same | Arguments and schema fields are looked up as own properties only; canonical JSON keeps every own key (null-prototype objects) | `fuzz.test.ts` (found and fixed four such defects on 2026-11-16) |

## Residual risks — what AnyMCP does not protect against

* **The assistant being fooled.** AnyMCP cannot stop a model from *believing* text it read in a result. It marks
  the data untrusted and limits what a tool can do, but a read tool's output can still influence the model.
* **Malicious or buggy tool definitions the user approves.** The review shows what a tool can read and change,
  derived from its structure. A user who approves a harmful workflow can run it. Definitions cannot be imported
  from the assistant or the web in this release, which removes the main supply-chain path.
* **A compromised browser profile or OS account.** Anything that can read `chrome.storage` or `~/.anymcp` can
  steal the pairing secret/token (and, while unpaired, the current pairing code). Apps launched with `--stdio`
  read the token from `~/.anymcp` themselves, which is the same trust boundary: any program running as the user. Both are stored unencrypted under the user's account (OS permissions apply).
* **Other extensions** with broad permissions can see the same pages.
* **Browser/network retries.** A browser can re-send a request on its own. AnyMCP never re-clicks, but the
  *site* may see more than one request; sites without idempotency can then record duplicates.
* **Sites that detect automation**, or pages whose behaviour depends on trusted (OS-level) input events: AnyMCP
  uses DOM events, not OS input.
* **Timing (TOCTOU) at the site.** The binding is checked immediately before the click, not at the server.
* **No independent security review and no penetration test** has been done. In-house property-based fuzzing
  (seeded and replayable: `packages/protocol/test/fuzz.test.ts`, `packages/bridge/test/network.fuzz.test.ts`) covers
  canonical hashing, sensitive-field detection, argument validation, parameter substitution, tool-definition parsing
  and both bridge network endpoints. It is not a substitute for a review, and the locator and engine inside web
  pages are covered only by the browser suites.
* **Local Network Access.** Chrome 147+ may prompt for loopback access. Measured on Chrome 157 with default
  settings: no prompt, WebSocket connected (see `scripts/lna-spike.ts`). Enterprise policies can change this.

## Reporting

There is no public disclosure address yet — an owner task before publication (see release checklist).
