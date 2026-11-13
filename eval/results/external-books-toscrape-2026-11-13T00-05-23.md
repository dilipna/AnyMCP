# External read-only check — books.toscrape.com (attempt 3: `field` + `css` locators)

> **Separate from the fixture evaluation.** One public sandbox site. This shows what happened on this site on this day with two tiny tools; it is not a compatibility claim for any other site.

**Scope.** `https://books.toscrape.com` (a sandbox whose purpose is to be scraped). Read-only: navigation by URL and reading text. **No forms submitted, no accounts, no messages.** Sequential, one page load per run, 0.8 s pause between runs.

**Ground truth.** For the happy path, the page's own HTML fetched independently of MyCP.

**Environment.** MyCP 0.1.0; 158.0.8127.18; Windows_NT 10.0.26300; Node v24.11.0; source 226032b9895102e5…

## Result: 13 of 13 runs behaved as expected

| case | expected | observed | as expected | ms |
|---|---|---|---|---|
| happy: A Light in the Attic (#1) | success, "availability | price" == "In stock (22 available) | £51.77" | `success` / ok | yes | 2339 |
| happy: A Light in the Attic (#2) | success, "availability | price" == "In stock (22 available) | £51.77" | `success` / ok | yes | 1263 |
| happy: Tipping the Velvet (#1) | success, "availability | price" == "In stock (20 available) | £53.74" | `success` / ok | yes | 1564 |
| happy: Tipping the Velvet (#2) | success, "availability | price" == "In stock (20 available) | £53.74" | `success` / ok | yes | 1015 |
| happy: Soumission (#1) | success, "availability | price" == "In stock (20 available) | £50.10" | `success` / ok | yes | 1567 |
| happy: Soumission (#2) | success, "availability | price" == "In stock (20 available) | £50.10" | `success` / ok | yes | 1024 |
| happy: Sharp Objects (#1) | success, "availability | price" == "In stock (20 available) | £47.82" | `success` / ok | yes | 1588 |
| happy: Sharp Objects (#2) | success, "availability | price" == "In stock (20 available) | £47.82" | `success` / ok | yes | 1031 |
| happy: Sapiens: A Brief History of Humankind (#1) | success, "availability | price" == "In stock (20 available) | £54.23" | `success` / ok | yes | 1560 |
| happy: Sapiens: A Brief History of Humankind (#2) | success, "availability | price" == "In stock (20 available) | £54.23" | `success` / ok | yes | 1027 |
| wrong title for the page | precondition_failed (never success) | `precondition_failed` / precondition_unmet | yes | 1025 |
| page does not exist (HTTP 404) | precondition_failed (never success) | `precondition_failed` / precondition_unmet | yes | 1244 |
| ambiguous locator on a real page (£ appears several times) | precondition_failed / locator_ambiguous (stops, does not guess) | `precondition_failed` / locator_ambiguous | yes | 1034 |

## What this does and does not show

* It shows the read path, the precondition guard (right page?) and the ambiguity guard working on a real third-party page.
* Attempts 1 and 2 (purely text-based locators) were stopped as ambiguous on every happy-path run: 3 of 13 as expected. That gap led to the `field` (value next to a label) and `css` (fragile fallback) locators used here.
* It says nothing about login-protected sites, JavaScript-heavy apps, or any write workflow.
