# Public-site validation report

**Scope:** three public sandboxes published for scraping practice, a few inputs each, on 2026-11-14, Windows 11,
Playwright Chromium 158 (with Claude Code) and, separately, Google Chrome 157.0.8103.52 (SDK client only). Read-only: pages are opened by address and read; no form is submitted, no account used, no
message sent. About 25 page loads, paced. Raw results: `eval/results/public-sites-2026-11-14T05-49-41.{md,json}` (Chromium + Claude Code) and
`eval/results/public-sites-2026-11-14T06-45-27.{md,json}` (Chrome). Re-runs on 2026-11-16 in Microsoft Edge and Brave
(SDK client only): `eval/results/public-sites-2026-11-16T07-28-57.{md,json}` (Edge) and
`eval/results/public-sites-2026-11-16T07-29-48.{md,json}` (Brave).
Re-run with `npm run eval:public` (add `-- --with-claude` to include Claude Code; `ANYMCP_E2E_BROWSER=msedge` or
`=brave` for another installed browser).

**What this shows:** the whole workflow (record → review → test → enable → call from an MCP client) works on these
pages today, and the results equal an independent reading of the same pages. **What it does not show:** that any
other site works, or that these will keep working when their markup changes.

## Method

For each site the script opens the start page in a tab and records through the **real recorder**, the way a person
would: *Pick a list* (or *Pick a table*) on the results, *Mark a message* on something that proves the page loaded.
It applies only edits the review screen supports (names, an address part or address setting made into an input,
columns dropped or marked as numbers), saves, tests, enables, and then calls the tool from the official MCP SDK
client with **different** inputs. Each returned item is compared with an independent reading of the same page (Node
`fetch` plus a regular expression, or the page's own embedded data). Finally the site is removed, and the client
must no longer list the tool.

Authorization: the test build is pre-granted these hosts because Chrome's own "allow this site" prompt cannot be
automated. In the product, the person uses **Allow a website** and confirms Chrome's prompt.

## Results

| Site | Structure | Tool | Recorder's locator | Runs | Equals independent reading |
|---|---|---|---|---|---|
| books.toscrape.com | static listing; category in the path; results are links | `books_in_category` | CSS `article.product_pod > h3 > a` | mystery_3 (20), poetry_23 (19), nope_999 → stopped safely | yes, 39/39 items, every URL on the site |
| scrapethissite.com | search words in the query string; results are a table | `hockey_team_search` | CSS `table.table` | rangers (21 rows), zzqqxx (0 rows) | yes, 21/21 and 0/0 |
| quotes.toscrape.com/js | content drawn by JavaScript after load; page number in the path | `quotes_page` | CSS `span.text` | page 3 (10), page 5 (10) | yes, 20/20 |

* Removing each site removed its tool from the client (3/3).
* The same 7 runs and 3 revocations also passed in branded Google Chrome 157.0.8103.52 and, on 2026-11-16, in
  Microsoft Edge 157.0.4341.60 and Brave 1.99.57 (Chromium 157.0.8103.79), with the same item counts.
* **Claude Code** (`claude -p`, version 2.1.207): `books_in_category` over **HTTP** returned the right two titles
  with their exact URLs; `hockey_team_search` over **stdio** (packaged bridge, forwarding) returned the right rows.
  The bridge recorded the callers as "claude-code" and "claude-code (via stdio)".

## What we learned (and fixed)

* **Wikipedia was tried first and refused automated browsing** (HTTP 429). Its robots.txt disallows `/w/`, where
  search lives. We stopped using it; no workaround was attempted.
* **A success check contained a live count.** On scrapethissite the page heading ends with "21 items", so a check
  on it only matched one search. The review screen now warns when a check contains a number.
* **Tables without `<thead>`** returned their header row as the first record. Fixed and covered by a test.
* **All three tools rely on CSS selectors**, because these sandboxes have no labels, roles or test ids on their
  results. The review screen flags such tools ("may break if the site changes"); if the markup changes, the tool
  stops with `locator_missing` instead of guessing.

## Separate script

`npm run eval:external` (`packages/eval/src/external.ts`) is an older, separate check of one hand-written tool on
books.toscrape.com (book availability, plus a deliberately ambiguous tool that must stop). Its results are not
included here.
