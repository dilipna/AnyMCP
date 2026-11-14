# AnyMCP documentation

Start with the [README](../README.md). Then, by question:

| If you want to know… | Read |
|---|---|
| How do I install it and make a first tool? | [quick-start.md](quick-start.md) · [troubleshooting.md](troubleshooting.md) |
| What has been tested where, and with which AI apps? | [compatibility.md](compatibility.md) (evidence labels) |
| What exactly works, and what doesn't? | [supported-capabilities.md](supported-capabilities.md) · [known-limitations.md](known-limitations.md) |
| How is it built, and why those choices? | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| What data goes where? | [privacy-policy.md](privacy-policy.md) (draft) |
| Is it safe? What isn't it protected against? | [threat-model.md](threat-model.md) · [../SECURITY.md](../SECURITY.md) |
| What was measured, and how? | [public-site-report.md](public-site-report.md) · [evaluation-protocol.md](evaluation-protocol.md) → `eval/results/` |
| How does it differ from existing projects? | [comparison.md](comparison.md) (every cell tagged V-doc / V-code / M / U) |
| What must happen before it's published? | [release-checklist.md](release-checklist.md) · [naming-check.md](naming-check.md) |
| Store submission material | [../store/listing.md](../store/listing.md) · [privacy-policy.md](privacy-policy.md) |
| How do I show it to someone? How do I run a user test? | [demo-script.md](demo-script.md) · [first-time-user-test.md](first-time-user-test.md) |
| What might come next, and why not now? | [backlog.md](backlog.md) |
| Where did the work stop? | [../PROGRESS.md](../PROGRESS.md) |

## Reading evidence correctly

* **Fixture results** (`eval/results/fixture-*`) describe AnyMCP against a *synthetic* site the same author wrote.
  They are a development suite, not a held-out set, and say nothing about real websites.
* **Public-site results** (`eval/results/public-sites-*`) describe three public scraping sandboxes on one day.
* **"0 failures"** always means "0 in N runs". It is never a guarantee.
* **Runs with a real AI app** (Claude Code) are labelled as such; a model's wording varies, so they check that the
  expected values appear, not exact text.
* Every result file records the browser, OS, Node, AnyMCP version, a hash of the source tree and the git revision.
