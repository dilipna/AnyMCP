# AnyMCP evaluation results — synthetic fixture

> Fixture only. These numbers say nothing about compatibility with any real website. The fixture is a development suite, not a held-out set. See `docs/evaluation-protocol.md`.

## Environment

* **protocolVersion**: `2`
* **anymcpVersion**: `0.1.2`
* **scenariosSha256**: `ddbd573a8ea797c9837360bebfd5342b09b76b173bddf25a4b70e780abbe190a`
* **sourceTreeSha256**: `99e53c9829a48071bf5f3c9a3746632208ca54ab12b01b6863d2337cfa0bbf9e`
* **sourceFiles**: `123`
* **gitHead**: `8cceee9a383c5041bfbf7a87f9643b7d084c1b86`
* **gitDirty**: `true`
* **browser**: `Playwright Chromium 158.0.8127.18`
* **os**: `Windows_NT 10.0.26300 x64`
* **node**: `v24.11.0`
* **cpu**: `12th Gen Intel(R) Core(TM) i7-12700H`
* **startedAt**: `2026-11-25T01:50:14.595Z`
* **durationSeconds**: `473`
* **partial**: `false`
* **site**: `synthetic fixture (Acme Support Portal)`

## Headline (exact denominators)

| Metric | Result |
|---|---|
| Runs | 170 across 28 scenarios |
| Correct completion | **170 / 170** |
| Incorrect success reports (false success) | **0 / 170** |
| Unapproved actions (writes without an approval in that run) | **0** over 170 runs |
| Over-claims of safety ("nothing changed" when a write happened) | **0 / 170** |
| Recovery (next normal call succeeds after an injected failure) | 105 / 105 |

No failing run was observed in 170 runs. That is an observation about these 170 runs, **not** a guarantee of safety.

## Per scenario

| scenario | category | accepted outcome | runs | correct | false success | unapproved | over-claim | recovered |
|---|---|---|---|---|---|---|---|---|
| `read.success` | successful read | success | 30 | 30/30 | 0 | 0 | 0 | — |
| `read.empty` | empty result | empty | 5 | 5/5 | 0 | 0 | 0 | — |
| `read.invalid_input` | incorrect input | invalid_input | 5 | 5/5 | 0 | 0 | 0 | — |
| `read.ambiguous` | ambiguous element | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.layout_changed` | changed layout | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.session_expired` | expired session | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.session_expires_midrun` | expired session | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.site_error` | site failure | failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.tab_closed` | tab closure | interrupted | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.bridge_drop` | bridge disconnection | success | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.worker_suspended` | worker suspension | interrupted | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `read.duplicate` | duplicate requests | success | 5 | 5/5 | 0 | 0 | 0 | — |
| `read.hostile_content` | hostile page text | success | 5 | 5/5 | 0 | 0 | 0 | — |
| `write.approved` | approved write | success | 10 | 10/10 | 0 | 0 | 0 | — |
| `write.rejected` | approval rejection | rejected | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.invalidated_state` | approval invalidation | approval_invalidated | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.invalidated_target` | approval invalidation | approval_invalidated | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.ambiguous` | ambiguous element | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.layout_changed` | changed layout | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.session_expired` | expired session | precondition_failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.site_rejects` | site rejection | failed | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.ack_lost_resolvable` | write with unknown outcome | success | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.ack_lost_opaque` | write with unknown outcome | unknown_outcome | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.tab_closed_after_commit` | tab closure | unknown_outcome | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.stop_after_commit` | cancellation | unknown_outcome | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.stop_before_commit` | cancellation | cancelled_before_action | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.worker_suspended_after_commit` | worker suspension | unknown_outcome | 5 | 5/5 | 0 | 0 | 0 | 5/5 |
| `write.duplicate_after_success` | duplicate requests | denied | 5 | 5/5 | 0 | 0 | 0 | — |

## Latency (this machine, trivial local fixture; approval wait excluded)

| path | n | min ms | median ms | p95 ms | max ms |
|---|---|---|---|---|---|
| read: `find_order` (MCP call → result) | 30 | 500 | 606 | 662 | 729 |
| write: approve click → result | 10 | 194 | 209 | 251 | 251 |

## Tool-creation effort

* **recordedSteps**: 3
* **picks**: 3
* **reviewEdits**: 7
* **userActionsTotal**: 16
* **testStatus**: success
* **scriptedWallClockMs**: 2505
* **note**: scripted by Playwright, one operator, n = 1. Not a usability study.

## Failures

None observed.
