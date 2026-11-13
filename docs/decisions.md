# Engineering decisions (and how to defend them)

Each entry: the decision, the alternatives rejected, the reason, and the cost.

### D1. Workflows are a closed, declarative vocabulary — not scripts
* **Rejected:** generated JavaScript; a small DSL with expressions/loops/branches; "just let the model drive the browser".
* **Why:** (a) the thing a person reviews must be the thing that runs — a closed set of seven operations can be
  summarised exhaustively and enforced; (b) the Chrome Web Store forbids remotely hosted code and says
  building "an interpreter to run complex commands fetched from a remote source, even as data" is a violation,
  so execution paths must be predetermined in the extension package; (c) no `eval`/`new Function` is possible
  under the MV3 CSP anyway.
* **Cost:** fewer sites are supported (no branching, no loops). Branching is handled narrowly by
  *site-declared terminal states* (`emptyWhen`, `failureWhen`, `sessionExpiredWhen`) checked while waiting.

### D2. The extension is the source of truth; the bridge only gets manifests
* **Rejected:** storing tools in the bridge; letting the assistant create or edit tools.
* **Why:** definitions are created and stored only where the user reviews them. The bridge never receives
  steps, so a compromised bridge or assistant cannot push a new workflow into the browser. Both sides still
  enforce independently (args, enabled, origin, approval) — defence in depth.
* **Cost:** the bridge cannot run anything while the browser is closed.

### D3. Two separate transports: MCP over HTTP, and an authenticated WebSocket to the extension
* **Rejected:** stdio MCP *as the only transport* (each app spawns its own process, which cannot all hold the
  browser's one long-lived socket); one shared endpoint.
* **Why:** one long-lived loopback process serves both; compromising one credential does not grant the other.
  MCP side: loopback bind, Host/Origin validation (DNS-rebinding defence), bearer token (constant-time compare),
  no CORS headers. Extension side: Origin must be `chrome-extension://<id>` **and** equal the id the extension
  claims; first contact needs a one-time pairing code (single-use, expiring, attempt-limited); later contact
  proves possession of the pairing secret with an HMAC over a fresh nonce (the secret is never re-sent).
* **Cost:** the user runs a local process. **Update:** `anymcp-bridge --stdio` now lets apps that start MCP servers
  themselves launch it. It becomes the one bridge if none is running, otherwise forwards to the running one over
  the same authenticated HTTP endpoint, and takes over if that one stops. So there is still exactly one owner of
  the browser socket, and every tool is served by the same handler. A forwarded call is retried only when it
  certainly did not run (connection refused, or 401 after a token change).

### D4. Approval is bound, single-use, and re-checked at the last moment
* **Why:** "approve once" is meaningless if the page can change underneath it. The binding hash covers the
  execution id, tool id + version + definition hash, origin, the element that will be clicked, the arguments
  and the page values the user was shown. The page is polled while the prompt is open; the content script
  re-computes the binding **immediately before the click** and refuses on any mismatch. Only the side panel
  (verified by sender origin — a content script's sender is the web page and is refused) can decide.
* **Verified by:** unit tests on the approval center and sender check; e2e tests that change a shown value,
  rename the target button, and race the approval against a page change.

### D5. Write-ahead intent, and "unknown" is a first-class result
* **Rejected:** retrying a write "because it probably failed"; reporting failure when unsure.
* **Why:** after the click, the only honest answers are *verified success*, *site-reported rejection* or
  *unknown*. See architecture.md.
* **Evidence:** during development the Chromium network stack **re-sent a POST three times** when the server
  reset a reused connection. AnyMCP clicked once. This is why "exactly once" is never promised and why results
  are verified by reading the page, not inferred from the click.

### D6. Mandatory preconditions and postconditions
* **Why:** a tool without an observable postcondition cannot distinguish "worked" from "clicked". The policy
  rejects it. Read tools must also prove the page they read is the page they were asked about (e.g. the
  order id on the page equals the requested id).

### D7. Own tiny schema validator, not Ajv
* **Why:** Ajv compiles schemas with `new Function`, which the extension CSP forbids. The subset used
  (string/number/integer/boolean/array/object, enum, pattern, length, range) is valid JSON Schema, so the same
  schemas are advertised over MCP unchanged. Patterns with catastrophic-backtracking shapes are refused.

### D8. Content script injected on demand, with optional per-site host permissions
* **Rejected:** declared content scripts on `<all_urls>`.
* **Why:** smaller permission surface and faster store review; the user grants one site at a time with
  Chrome's own prompt (`chrome.permissions.request`, from a click). Revoking a site disables its tools.

### D9. AnyMCP works in a tab it owns
* **Why:** it never navigates or acts in a tab the user is working in. The in-page banner and the toolbar
  badge show when it is running; Stop works from the panel and from the page.

### D10. Stored history never contains outputs or URL paths unless opted in
* **Why:** a path like `/orders/A-1012` embeds a value the caller supplied. A privacy test caught this during
  development (the first version stored it); `redactEnvelopeForStorage` is the single rule used by both the
  extension and the bridge.

### D11. Official MCP SDK v2, stateless Streamable HTTP
* v2 (`@modelcontextprotocol/server`) is the current stable line. The handler serves both 2025-era clients
  (what Claude Code 2.1.207 speaks) and the 2026-07-28 revision. Stateless means cancellation cannot rely on
  sessions, so the HTTP layer maps `notifications/cancelled` (and a dropped connection) to the in-flight call.

### D12. Evaluation protocol frozen before results
* See [evaluation-protocol.md](evaluation-protocol.md): scenario catalogue hashed, runner refuses a changed
  catalogue, oracle is the fixture's own log, fixture and external results are kept apart.

### D13. Defaults that favour doing less
* One run at a time; busy ⇒ refuse. Reads may retry (declared, bounded, pre-commit); writes never.
  Tools disabled on any edit until re-tested. Unknown things are reported as unknown.
