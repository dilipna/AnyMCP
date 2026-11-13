# AnyMCP documentation

Start with the [README](../README.md). Then, by question:

| If you want to know… | Read |
|---|---|
| How do I install and run it? Something broke. | [README](../README.md) · [troubleshooting.md](troubleshooting.md) |
| What exactly works, and what doesn't? | [supported-capabilities.md](supported-capabilities.md) · [known-limitations.md](known-limitations.md) |
| How is it built, and why those choices? | [architecture.md](architecture.md) · [decisions.md](decisions.md) |
| Is it safe? What isn't it protected against? | [threat-model.md](threat-model.md) · [../SECURITY.md](../SECURITY.md) (template) |
| How does it differ from existing projects? | [comparison.md](comparison.md) (every cell tagged V-doc / V-code / M / U) |
| What was measured, and how? | [evaluation-protocol.md](evaluation-protocol.md) → `eval/results/` · [external-site-report.md](external-site-report.md) |
| What must happen before it's published? | [release-checklist.md](release-checklist.md) · [naming-check.md](naming-check.md) |
| Store submission material | [../store/listing.md](../store/listing.md) · [privacy-policy.md](privacy-policy.md) (draft) |
| How do I show it to someone in 3 minutes? | [demo-script.md](demo-script.md) |
| What might come next, and why not now? | [backlog.md](backlog.md) |
| Where did the work stop? | [../PROGRESS.md](../PROGRESS.md) |

## Reading evidence correctly

* **Fixture results** (`eval/results/fixture-*`) describe AnyMCP against a *synthetic* site the same author wrote.
  They are a development suite, not a held-out set, and say nothing about real websites.
* **External results** (`eval/results/external-*`) describe one public sandbox on one day. They are kept apart.
* **"0 failures"** always means "0 in N runs". It is never a guarantee.
* **Demonstrations with a real assistant** (`eval/results/demo-claude-*`) are labelled demonstrations; a model's
  wording varies and they are not part of the numbers.
* Every result file records the browser version, OS, Node, AnyMCP version, protocol version, scenario-catalogue
  hash and a hash of the source tree (there are no git commits yet, so the hash is the revision).
