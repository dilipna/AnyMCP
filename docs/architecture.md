# Architecture

## Components

| Component | Where | Responsibility | Trusted with |
|---|---|---|---|
| **AnyMCP Extension — service worker** | `packages/extension/src/background` | Source of truth for tool definitions, grants, approvals. Orchestrates runs. Talks to the bridge. | Everything the user approved |
| **Content script** | `packages/extension/src/content` | Executes one step at a time in a page; records when asked. Shows the in-page "AnyMCP is running — Stop" banner. | Only the origin it was injected into |
| **Side panel (React)** | `packages/extension/src/sidepanel` | The only place a person can approve, enable, revoke. | Runs on the extension's origin |
| **Bridge** | `packages/bridge` | MCP server for the assistant + authenticated WebSocket to the extension. Validates arguments, serialises runs, dedupes, answers honestly when the extension goes silent. | Tool *manifests* only — never workflow steps, cookies, or page content |
| **Protocol** | `packages/protocol` | Shared schemas: tool definition, policy, result envelope, approval binding, messages. | — |
| **Fixture** | `packages/fixture` | Synthetic "Acme Support Portal" with failure injection and a ground-truth write log. | — |

The two connections are separate on purpose: **MCP (assistant ⇄ bridge)** is HTTP on 127.0.0.1 with a
bearer token; **extension ⇄ bridge** is an authenticated WebSocket. A compromise or mistake on one does
not grant the other.

## The tool definition (data, not code)

`ToolDefinition` v1 (`packages/protocol/src/tool.ts`) is parsed with a strict schema: unknown keys and
unknown operations are rejected. There are seven operations:

| op | meaning | safety rule enforced in the page |
|---|---|---|
| `locate` | bind a name to **exactly one** visible element via a semantic locator (role+name, label, test id, text; optionally inside a named container) | 0 matches ⇒ `locator_missing`; >1 ⇒ `locator_ambiguous`. Never "best guess". |
| `fill` | put a value into a text box, dropdown, checkbox/switch or option button; `effect: "commit"` marks a field that saves by itself | refuses password / payment / secret / `data-anymcp-ignore` fields; sets a *state* (never a blind toggle); verifies it stuck; a `commit` fill is reachable only through the approval path, and one that would change nothing is reported as `no_change_needed` without asking |
| `click` | `ui` / `navigate` / `commit` | only buttons, links, tabs, menu choices and dropdown openers; refuses links/forms that leave the allowed origins; `commit` is reachable only through the approval path |
| `press` | press Enter in a text box (`ui` / `navigate` / `commit`) | dispatches the key events, then does exactly what the browser would (click the form's default button, or submit a one-field form) unless the page cancelled the key; refuses forms that post to another origin |
| `waitFor` | wait for an observable state | also watches the site-declared *empty*, *error* and *session-expired* states, so those are reported as what they are |
| `extract` | read text / a number / a table / a count | refuses sensitive fields; output validated against the schema |
| `assert` | check a condition | — |

A tool also carries: origins (exact, no wildcards), an entry path, input/output JSON-Schema subsets,
**preconditions**, **postconditions**, `emptyWhen`/`failureWhen`/`sessionExpiredWhen`, an approval policy
(action text + the page values it is bound to), limits and a read-retry count. `validateToolPolicy`
(`policy.ts`) refuses definitions that break the rules (a write tool must have exactly one `commit` step — a click, an Enter press or a self-saving fill —
require approval, never auto-retry, have a postcondition; steps after the commit must be read-only; etc.).

The **review screen is derived from this structure** (`deriveReviewSummary`), not from free text, so it
cannot describe behaviour the engine does not enforce. The author's description is shown but labelled as such.

## A run, step by step (`background/orchestrator.ts`)

```
request ─▶ bridge: args vs reviewed schema · busy? · duplicate? · extension connected?
        ─▶ extension: tool enabled & version matches? · definition hash intact? · policy still satisfied?
                      origin granted by the user? · args validate again
        ─▶ open/reuse a tab AnyMCP owns, go to the entry path (same origin)
        ─▶ session-expired guard · preconditions
        ─▶ steps (locate/fill/click/waitFor/extract/assert) — one message per step
        ─▶ if a `commit` step:
              prepare → fingerprint the target + read the bound page values
              approval request (binding hash = tool, version, definition hash, origin, target, args, page values, execution id)
              ── poll the live page; withdraw if it no longer matches ──
              approved? → WRITE-AHEAD: set commitStarted, persist ── then click (content script re-checks the binding first)
        ─▶ verify postconditions · validate output against the schema
        ─▶ envelope: status, reason, actionMayHaveOccurred, retry guidance, source, verification, output
```

### Outcome statuses and what they promise

| status | promise |
|---|---|
| `success` | every postcondition was observed and the output validated |
| `empty` | the *site itself* showed its "nothing found" state; a valid result |
| `denied` / `invalid_input` | nothing ran |
| `precondition_failed` | stopped before acting (expired session, missing/ambiguous element, wrong site…) |
| `rejected` / `approval_expired` / `approval_invalidated` / `cancelled_before_action` | nothing was changed |
| `interrupted` | stopped before any consequential action; safe to retry |
| `unknown_outcome` | **the action may or may not have happened.** Not retry-safe. Never replayed. |
| `failed` | confirmed failure (the site reported it) or a read that could not complete |

`actionMayHaveOccurred` is `false`, `true` or `"unknown"`; `retry.safe` follows from the status. The only
"no effect" claims AnyMCP makes are ones it can prove: the content script refused *before* clicking, or the
site itself reported a rejection.

## Why writes are never replayed (write-ahead intent)

Just before the consequential click the extension sets `commitStarted` and persists the run record. If
anything fails afterwards — the tab closes, the page navigates, the service worker is suspended, the bridge
drops — the run can no longer claim "nothing happened". After a restart, any run found `running` with
`commitStarted` becomes `unknown_outcome` (`recoverInterrupted`). Before that point the same failures become
`interrupted` (safe to retry). The only automatic action after a click is a **read-only** re-check (a fresh
GET of the entry URL — never a reload, which could resubmit a form), used to upgrade `unknown` to `success`
only on positive observation.

## Resilience: what resumes and what needs a person

| Event | Reads | Writes |
|---|---|---|
| Bridge connection drops | Run continues; result is re-sent after reconnect (transport retry). Not re-executed. | Before approval: prompt withdrawn, run cancelled, truth reported after reconnect. After the click: continues; result re-sent. |
| Extension service worker suspended | `interrupted` (client may retry — reads are safe) | Before the click: `interrupted`. After the click: `unknown_outcome`. |
| Tab closed | `interrupted` | After the click: `unknown_outcome` |
| Page navigates mid-run | read-only steps re-establish context and retry; clicks never retried | same |
| Assistant cancels | forwarded to the extension | before the click: `cancelled_before_action`; after: `unknown_outcome` |
| Duplicate request | coalesced into the running execution | an identical completed/unknown write is refused (`duplicate_request`) for 10 min |

**Transport retries** (reconnect, resend an un-acknowledged *result*) are automatic and idempotent.
**Action retries** (re-executing steps) never happen automatically for writes and are limited to a tool's
declared `maxAttempts` for reads, only before any consequential step.

## Data at rest

* Extension `chrome.storage.local`: tool definitions, allowed origins, settings, the pairing secret, and
  run history **without outputs, typed values or URL paths** (`redactEnvelopeForStorage`).
* Extension `chrome.storage.session` (memory only): the owned tab id, un-acknowledged results, and an
  in-progress recording (which may hold the example values you typed). Cleared when the browser closes.
* Bridge `~/.anymcp/state.json` (owner-only on POSIX; user-profile ACL on Windows): pairing secret, MCP token,
  redacted run records.
* Nothing else is stored. No screenshots, no page contents. Optional diagnostics (off by default) store
  a short outline of control names with digits masked and never field values.

## Why these choices

See [decisions.md](decisions.md).
