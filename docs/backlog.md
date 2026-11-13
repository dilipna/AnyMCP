# Backlog

Every item states the user problem, the evidence of need, the expected benefit, the implementation cost and
why it is now or later. **Evidence of need is stated honestly: this project has no users yet, so "evidence"
means a gap observed while building or a documented platform fact — not demand.** Nothing here is an "urgent
defect"; these are normal prototype limits.

| # | Item | User problem | Evidence of need | Benefit | Cost | Now / defer |
|---|---|---|---|---|---|---|
| 1 | Real-site validation on 2–3 permitted read-only sites | "Does it work on my site?" is unanswerable from a fixture | Fixture-only evaluation (own limitation #16); one external read-only check exists | Honest compatibility list | S–M (needs owner permission per site) | **Defer — owner-required** |
| 2 | ~~`<select>`, checkbox/radio~~ **done** (record + replay + e2e); contenteditable still open | Many forms use them | contenteditable not supported (documented) | Wider coverage | M | contenteditable: defer until a real site needs it |
| 3 | Read-resume after a service-worker restart | A suspended read is reported `interrupted`; the client must retry | Observed by design (resilience e2e) | Fewer retries | M (needs argument persistence in memory-only storage + resume rules) | Defer: retry-by-client is safe and simple |
| 4 | ~~stdio shim for the bridge~~ **done**: `anymcp-bridge --stdio` (becomes / forwards to / takes over the bridge) | Clients that only spawn stdio servers | — | More clients | — | Verified with the SDK client over stdio; not yet with Claude Desktop or Cursor themselves |
| 5 | Idempotency keys for write tools | Browser/network re-sends can duplicate a write | Observed: Chromium re-sent a POST 3× (docs/known-limitations #1) | Safer writes on sites that support it | M, site-specific | Defer: needs a real site that supports keys |
| 6 | ~~shadow DOM~~ **done** (open, and closed on custom elements; e2e on open); **iframes** still open | Embedded UIs | iframes unsupported (documented) | Coverage | L (locators, binding, permission model across frames) | Defer |
| 7 | Tool export/import with signed hashes | Sharing a reviewed tool | Not requested | Sharing | M **and** a Web Store remote-code risk | **Do not do** without a policy review |
| 8 | AI-assisted tool *drafting* behind an interface | Faster tool creation | Brief allows it as optional | Speed | M | Defer; deterministic path comes first and works alone; any draft must pass the same policy + review |
| 9 | Autonomous workflow repair | Layout changes break tools | Observed (changed-layout scenarios) | Less maintenance | L, risky | **Out of scope.** Any repair must be reviewed, retested, versioned before activation |
| 10 | Locale / translations | Non-English users | none | Reach | M | Defer |
| 11 | Hash-pinned review + signed tool bundles (like Workflow-to-MCP) | Stronger provenance | Comparison doc | Trust | M | Defer |
| 12 | Independent security review + fuzzing of the locator/engine | No audit exists | Threat model residual risks | Confidence | M (external) | **Owner decision** before any public release |
| 13 | Firefox / Edge | Other browsers | none | Reach | L | Defer (Edge likely works; untested) |
| 14 | A11y testing with a screen reader | axe-only today | known-limitations #18 | Real accessibility confidence | S–M | Do before a public release |
| 15 | Vulnerability disclosure address + SECURITY.md | None exists | Release gates | Required for publication | XS | **Owner action** |
| 16 | ~~Mark a fill step as consequential~~ **done** ("Saves by itself" → approval every run; `no_change_needed` when already set) | Some settings save instantly | — | — | — | e2e: settings dropdown + ARIA switch |
| 17 | Pagination for lists ("next page" until N items) | Results spread over pages | known-limitations 9b | Complete lists | M (needs a bounded repeat; today's vocabulary has no loops, by design) | Defer; needs a design that keeps tools bounded |

Explicitly **not** planned for the initial release: cloud hosting, billing, marketplaces, enterprise accounts,
mobile, dozens of site adapters, purchases/payments, unattended messaging.
