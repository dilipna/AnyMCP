# AnyMCP evaluation protocol (v1)

**Status: frozen before the first headline run.** The scenario catalogue is hashed into
`packages/eval/scenarios.lock.json`. The runner refuses to produce results if the catalogue no longer
matches that hash, so scenarios cannot be quietly added, removed or edited after seeing results. Changing
the catalogue means bumping `protocolVersion`, re-freezing, and reporting the new version separately.

## What this evaluation can and cannot show

* It measures AnyMCP's **behaviour at its own boundaries** (permission checks, approvals, failure handling,
  honest outcome reporting) against a **synthetic fixture website** that this project controls.
* It does **not** show that AnyMCP works on any real website. External sites are reported in a *separate*
  document with their own scope (`docs/public-site-report.md`). Fixture results are never mixed into it.
* The fixture is a **development suite**, not a held-out test set. It was used while building AnyMCP, so
  results on it must not be described as held-out or as generalisation evidence. No held-out set exists yet.
* "Zero failures observed" means exactly that — zero in the stated number of runs — never "guaranteed safe".

## Ground truth (the oracle)

The fixture records its own state independently of AnyMCP: every received request, and every draft actually
saved (`/__control/state` → `writeLog`). Correctness is judged against that log and against the fixture's
seed data — **never against AnyMCP's own report**.

## Definitions

| Metric | Definition |
|---|---|
| **Correct completion** | The status is one of the scenario's *accepted* statuses **and** all oracle checks hold (e.g. the returned values equal the fixture's seed data; the number of saved drafts equals what the scenario allows). |
| **Incorrect success report (false success)** | AnyMCP returned `success` or `empty` but the oracle says the intended result did not occur: output differs from ground truth, a write is claimed that was not saved, or a result is claimed after a condition that should have stopped the run. |
| **Unapproved action** | A write reached the site in a run where no approval was granted for that run. Counted as `max(0, writes_on_site − approvals_granted)`. Approvals are counted **independently of what a scenario reports**: the smaller of (a) the Approve clicks the harness performed and (b) the `approval_granted` events the extension recorded for runs started in that iteration (the smaller number is the conservative one). Writes come from the fixture's own log. |
| **Over-claim of safety** | A result of a run that **executed in the browser** that says "nothing was changed" (`actionMayHaveOccurred: false`) while the oracle shows a write. Refused requests (`denied`, `invalid_input`) are excluded: they truthfully report that *that request* did nothing, even if an earlier request in the same scenario wrote. Must be 0. |
| **Recovery** | After an injected failure: (a) the status is the honest one for that failure, (b) the oracle shows no replay (request/write counts ≤ the scenario's limit), and (c) the **next normal call succeeds** without restarting anything. |
| **Latency** | Wall-clock time from the MCP `tools/call` request to the response, measured on the client. Approval wait time is excluded (the approval is granted programmatically through the panel immediately). Reported as min / median / p95 / max over *n* runs. |
| **Tool-creation effort** | Counts of *user actions* needed to teach `find_order` by recording (clicks, typed fields, picks, review edits) from the scripted flow, plus the scripted wall-clock. This is **not** a usability study: one scripted operator, `n = 1`. |

## Scenarios

Every scenario is run `runs` times from a freshly reset fixture. Denominators are the number of runs.

| id | category | what is injected | accepted status | oracle limit |
|---|---|---|---|---|
| `read.success` | successful read | none (5 different orders) | `success` | output == seed data; 0 writes |
| `read.empty` | empty result | well-formed id that does not exist | `empty` | output `{found:false}`; 0 writes |
| `read.invalid_input` | incorrect input | malformed id / extra field / missing field | `invalid_input` | **0 requests reach the site** |
| `read.ambiguous` | ambiguous element | duplicate result rows | `precondition_failed` | 0 writes |
| `read.layout_changed` | changed layout | labels and button renamed | `precondition_failed` | 0 writes |
| `read.session_expired` | expired session | session already expired | `precondition_failed` (`session_expired`) | 0 writes |
| `read.session_expires_midrun` | expired session | session expires during the search | `precondition_failed` (`session_expired`) | 0 writes |
| `read.site_error` | site failure | search API returns 500 | `failed` | 0 writes |
| `read.tab_closed` | tab closure | tab closed mid-run | `interrupted` | 0 writes |
| `read.bridge_drop` | bridge disconnection | WebSocket dropped mid-read | `success` (result delivered after reconnect) | **search requests ≤ 1** (no replay) |
| `read.worker_suspended` | worker suspension | extension service worker terminated mid-read | `interrupted` | search requests ≤ 1 |
| `read.duplicate` | duplicate requests | two identical concurrent calls | `success` (one run) | search requests == 1 |
| `read.hostile_content` | hostile page text | order note contains instructions | `success` | **0 writes, 0 approval prompts, tool set unchanged** |
| `write.approved` | approved write | none | `success` | writes == 1 |
| `write.rejected` | approval rejection | user declines | `rejected` | writes == 0 |
| `write.invalidated_state` | approval invalidation | a shown page value changes | `approval_invalidated` | writes == 0 |
| `write.invalidated_target` | approval invalidation | the button changes | `approval_invalidated` | writes == 0 |
| `write.ambiguous` | ambiguous element | two save buttons | `precondition_failed`, **before** approval | writes == 0; no prompt |
| `write.layout_changed` | changed layout | controls renamed | `precondition_failed` | writes == 0 |
| `write.session_expired` | expired session | session expired | `precondition_failed` | writes == 0 |
| `write.site_rejects` | site rejection | site refuses the draft | `failed` | writes == 0 |
| `write.ack_lost_resolvable` | write with unknown outcome | acknowledgement lost, page readable | `success` (verified by read-back) | writes == 1; **POSTs == 1** |
| `write.ack_lost_opaque` | write with unknown outcome | acknowledgement lost, page cannot confirm | `unknown_outcome` | writes == 1; POSTs == 1; `retry.safe == false` |
| `write.tab_closed_after_commit` | tab closure | tab closed after the click | `unknown_outcome` | `retry.safe == false` |
| `write.stop_after_commit` | cancellation | Stop pressed after the click | `unknown_outcome` | must not claim "nothing changed" |
| `write.stop_before_commit` | cancellation | Stop pressed at the approval prompt | `cancelled_before_action` | writes == 0 |
| `write.worker_suspended_after_commit` | worker suspension | worker terminated after the click | `unknown_outcome` | `retry.safe == false` |
| `write.duplicate_after_success` | duplicate requests | identical write repeated | `denied` (`duplicate_request`) | writes == 1 total |

## Run counts

* Failure and safety scenarios: **5 runs each**.
* `read.success`: **30 runs** (latency sample); `write.approved`: **10 runs**.
* Totals and per-scenario denominators are printed in every report.

## Environment recorded with every result

Browser name + exact version, OS, Node version, AnyMCP version, protocol version, scenario-catalogue hash,
source-tree hash (and git revision when commits exist), start time, and whether the run used Playwright's
bundled Chromium or the real branded Chrome (`ANYMCP_E2E_BROWSER=chrome`).

## Reporting rules

1. Report `k / n` for every metric, with failures listed individually (scenario, run index, observed status, why).
2. Do not round a small `n` into a percentage that sounds larger than the evidence.
3. Latency numbers are for this machine and this fixture; they describe AnyMCP's overhead on a trivial local site and say nothing about real sites.
4. Any change to scenarios, oracle logic or definitions after the first headline run requires a new `protocolVersion`.
5. Results are committed under `eval/results/` together with the protocol version and hashes.

## Protocol versions

| Version | Change | Comparable with |
|---|---|---|
| 1 | first frozen catalogue (28 scenarios) | — |
| 2 | product renamed MyCP → AnyMCP: the catalogue's only change is its import line (`mycp-protocol` → `anymcp-protocol`). Scenarios, oracles and run counts are identical. Bumped because rule 4 requires it for any change to the file. | v1, in substance |

## Instrument corrections made before the freeze

The runner was developed against the scenarios in a *development run* (`--dev`, labelled partial, never a headline
result). That run found two defects in **the instrument, not the product**, which were fixed before freezing:

1. **Harness race.** Each write scenario had two concurrent pollers waiting for the approval prompt. One could
   miss a prompt that lives ~250 ms after Approve is clicked, time out after 15 s, and leave `approvalsGranted`
   unrecorded — so a *correctly approved* write was counted as unapproved. Fix: one explicit wait per scenario,
   and approvals are now counted independently of scenario code (see *Unapproved action*).
2. **Over-claim false positive.** A refused duplicate request was charged with the earlier write in the same
   scenario. Fix: see *Over-claim of safety*.

If the first diagnosis was wrong, the post-fix runs would show `unapproved > 0` again; the reports state the count.

## Known weaknesses of this evaluation (stated up front)

* One fixture site, written by the same author as the tool definitions; it can only expose the failure modes its author thought of.
* Chaos modes are deterministic. Real sites fail in messier ways.
* Run counts are small; they demonstrate that each guard works, not a failure *rate*.
* The browser's own network retries are outside AnyMCP's control (a lost acknowledgement can make Chromium re-send a POST — observed during development). The fixture models loss in a way that avoids that, and `docs/known-limitations.md` records it.
* The MCP client in these runs is the official SDK client. A run with a real assistant is a separate, labelled demonstration (`docs/demo-script.md`), not part of these numbers.
