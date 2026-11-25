# Public-site validation report

**Scope:** public sites published for scraping or test-automation practice, a few inputs each, Windows 11. Three
pages from 2026-11-14; two more (the Web Scraper test shop and the Scrape This Site countries page) added on
2026-11-18, when all five passed together (11/11 runs, revocation 5/5;
`eval/results/public-sites-2026-11-18T22-32-10.{md,json}`, Playwright Chromium 158). Four more on 2026-11-23 (a single
value, a layout table, a page drawn 10 s late, and a fifth site, the-internet.herokuapp.com): they first exposed three
defects (`public-sites-2026-11-23T19-55-49`), fixed the same day; then all nine pages on five sites passed together
(20/20 runs, the slow-page check, revocation 9/9; `eval/results/public-sites-2026-11-23T20-51-52`, clean tree at 05adf6f).
Two more on 2026-11-25 that need clicks while recording (press Start; click a year), which exposed one more defect
(a picked value found by its own text), fixed the same day; then all eleven pages passed together (24/24 runs, both
slow-page checks, revocation 11/11; `eval/results/public-sites-2026-11-25T01-50-00`, code of 8cceee9: source tree 99e53c98…).
A twelfth the same day, a large page with a 50 x 50 table whose headings are numbers, exposed a false success (one
column of 50 returned, status success), fixed the same day; then all twelve pages passed together (25/25 runs, both
slow-page checks, revocation 12/12; `eval/results/public-sites-2026-11-25T06-19-46`, code of 39f4141: source tree 087ca478…). The first runs used
Playwright Chromium 158 (with Claude Code) and, separately, Google Chrome 157.0.8103.52 (SDK client only). Read-only: pages are opened by address and read; no form is submitted, no account used, no
message sent. About 25 page loads, paced. Raw results: `eval/results/public-sites-2026-11-14T05-49-41.{md,json}` (Chromium + Claude Code) and
`eval/results/public-sites-2026-11-14T06-45-27.{md,json}` (Chrome). Re-runs on 2026-11-16 in Microsoft Edge and Brave
(SDK client only): `eval/results/public-sites-2026-11-16T07-28-57.{md,json}` (Edge) and
`eval/results/public-sites-2026-11-16T07-29-48.{md,json}` (Brave).
Re-run with `npm run eval:public` (add `-- --with-claude` to include Claude Code; `ANYMCP_E2E_BROWSER=msedge` or
`=brave` for another installed browser; `-- --only=<words>` runs just the pages whose label contains them, and the
report says so).

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
| webscraper.io test shop (2026-11-18) | a different site; product cards; page number in the query string; results are links | `laptops_page` | CSS `a.title` | page 3 (6), page 20 (3, the last page), page 999 → stopped safely (no cards, so the recorded precondition is unmet) | yes, 9/9 items with their URLs |
| scrapethissite.com countries (2026-11-18) | one long static page (250 cards), no input; capped at the tool's 25 rows | `countries_list` | CSS `h3.country-name` | the page (25) | yes, 25/25 |
| books.toscrape.com book page (2026-11-23) | ONE value (the price); book in the path; a recommended-books strip repeats the same price style | `book_price` | CSS `div.col-sm-6.product_main p.price_color` | tipping-the-velvet_999, sharp-objects_997, zzqqxx_9999 → stopped safely (404 page) | yes, 2/2 prices |
| quotes.toscrape.com/tableful (2026-11-23) | a table used for layout, no class names: quote cell, tags row, side cell, empty spacer; tag in the path | `quotes_by_tag` | CSS `table > tbody > tr > td[style="padding-top: 2em;"]` | life (10), humor (10), zzqqxx → stopped safely (no quotes) | yes, 20/20 |
| quotes.toscrape.com/js-delayed (2026-11-23) | quotes drawn by a 10-second timer after load; page in the path | `delayed_quotes_page` | CSS `span.text` | first test at the default 5 s step timeout → stopped safely after 5.3 s, nothing returned; version 2 with 15 s: page 3 (10), page 4 (10) | yes, 20/20 |
| the-internet.herokuapp.com/dynamic_loading/2 (2026-11-25) | a click on Start, then text drawn 5 s later (exactly the default step timeout); no input | `loading_message` | CSS `div.example > div > h4` | first test at the default: success after 5.4 s (either outcome counts as honest here); version 2 with 12 s: the message | yes, 1/1 |
| scrapethissite.com films (2026-11-25) | a click on a year link, made an input; the films table is filled by a request and drawn 1.5 s later; the address does not change | `films_of_year` | CSS `table.table` (the click: the link named by the year input) | 2012 (15), 2010 (13), 1999 → stopped safely (no such year link) | yes, 28/28 rows against the page's own JSON |
| the-internet.herokuapp.com/large (2026-11-25) | a large page (about 180 KB, elements nested 50 deep); a 50 x 50 table whose headings are the numbers 1 to 50; every column kept; no input | `large_table` | CSS `#large-table` | the page (50 rows, 50 columns each) | yes, 50/50 rows, all 2,500 cells |
| the-internet.herokuapp.com/tables (2026-11-23) | another site, built for test-automation practice; a data table with a column of action links; no input | `practice_table` | CSS `#table1` | the page (4 rows, 3 columns kept) | yes, 4/4 |

* Removing each site removed its tool from the client (3/3 on 2026-11-14; 5/5 on 2026-11-18; 9/9 on 2026-11-23;
  11/11, then 12/12, on 2026-11-25).
* Empty pages: the hockey search shows its table even with no matches, so "zzqqxx" is a valid empty result. The shop
  shows nothing at all past its last page (no "no products" message), so AnyMCP cannot tell that from a wrong page
  and stops. On a site that does show such a message, marking it while recording with **Mark a message → "Means:
  nothing found"** makes those runs return a valid empty result instead.
* The same 7 runs and 3 revocations also passed in branded Google Chrome 157.0.8103.52 and, on 2026-11-16, in
  Microsoft Edge 157.0.4341.60 and Brave 1.99.57 (Chromium 157.0.8103.79), with the same item counts.
* **Claude Code** (`claude -p`, version 2.1.207; re-run on 2026-11-17 with the current bridge, same results:
  `eval/results/public-sites-2026-11-17T03-30-27.{md,json}`): `books_in_category` over **HTTP** returned the right two titles
  with their exact URLs; `hockey_team_search` over **stdio** (packaged bridge, forwarding) returned the right rows.
  The bridge recorded the callers as "claude-code" and "claude-code (via stdio)".

## What we learned (and fixed)

* **Wikipedia was tried first and refused automated browsing** (HTTP 429). Its robots.txt disallows `/w/`, where
  search lives. We stopped using it; no workaround was attempted.
* **A success check contained a live count.** On scrapethissite the page heading ends with "21 items", so a check
  on it only matched one search. The review screen now warns when a check contains a number.
* **Tables without `<thead>`** returned their header row as the first record. Fixed and covered by a test.
* **A list guess took in neighbouring cells, and that produced a false success** (2026-11-23). On the layout
  table the recorder's "others like it" pattern was `table > tbody > tr > td`: results mixed quotes with tags rows,
  and a tag with no quotes returned "success" with two unrelated cells. The recorder now narrows a pattern with no
  class by an attribute of the clicked item when that removes exactly the items built differently from it (empty
  spacer cells aside). A first version missed the real page's empty `<td></td>` spacer; the synthetic copy in
  `e2e/site-patterns.spec.ts` now has one. Known limitation 30 says what is still a guess.
* **Content drawn after load was read too early, and the editor's timeout did not help** (2026-11-23). Reading
  looked once after the page's "loaded" check; quotes drawn 10 s late stopped after 0.4 s, even with a 15 s per-step
  timeout, because the recorded wait was fixed at 5 s. Reading now waits for what it reads up to the per-step
  timeout, and the recorded wait follows that timeout.
* **A value unique on one page was ambiguous on the next** (2026-11-23): `p.price_color` also matched the
  recommended-books strip on other books (AnyMCP stopped with `locator_ambiguous`, never a wrong price). Picked
  values are now anchored to their container.
* **A picked value was found by its own text** (2026-11-25). The message on the Start page was recorded as "the
  heading named Hello World!". Harmless there, but the same rule turns a product name picked on one page into "the
  heading named <that product>", which no other product's page has. Reproduced on the synthetic shelf page (item name
  in a heading), fixed: picked values are never found by their own text.
* **A table with numbered headings returned one column, as a success** (2026-11-25). Column headings became field
  names by dropping symbols and leading digits, so the large page's headings 1 to 50 all became `col` and overwrote
  each other: every row came back as `{"col": "1.50"}` with status success (`public-sites-2026-11-25T06-03-17`, on
  the code before the fix). Headings that are years ("2023", "2024") would have done the same. Reproduced in a unit
  test, fixed: digits are kept behind a prefix (`col_1` … `col_50`) and two headings never share a field.
* **Ids a page makes up on every load** (2026-11-25). the-internet.herokuapp.com/challenging_dom gives its buttons a
  fresh UUID on each load. The recorder skipped such ids on containers but not on the picked element itself, so a
  value with such an id was recorded by it and the tool stopped on its first test. Reproduced on a synthetic page
  (`/made-ids/<item>`), fixed: ids and class names with three digits in a row or a UUID shape are never used.
* **Every tool here relies on CSS selectors**, because these practice pages have no labels, roles or test ids on
  their results. The review screen flags such tools ("may break if the site changes"); if the markup changes, the tool
  stops with `locator_missing` instead of guessing.

## Separate script

`npm run eval:external` (`packages/eval/src/external.ts`) is an older, separate check of one hand-written tool on
books.toscrape.com (book availability, plus a deliberately ambiguous tool that must stop). Its results are not
included here.
