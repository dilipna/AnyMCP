// PUBLIC-SITE read-only validation: real websites, the REAL recorder, the real extension, the bridge, MCP clients.
//
//   npx tsx packages/eval/src/public-sites.ts [--chrome] [--with-claude]
//   ANYMCP_E2E_BROWSER=msedge|brave npx tsx packages/eval/src/public-sites.ts   (another installed browser)
//
// What it does, per site: opens the start page in a tab, records the way a person would (picks what to return,
// marks what proves it worked), applies only edits the review screen supports, saves, tests, enables, then calls the
// tool from the official MCP SDK client with DIFFERENT inputs and compares every returned item with an independent
// reading of the same page (Node fetch + regular expressions, or the page's own embedded data). It also checks that
// removing the site takes the tool away from the client.
//
// Sites (structurally different on purpose; all are published for scraping or test-automation practice):
//   - books.toscrape.com      static listing; one part of the PATH is the input; results are LINKS
//   - scrapethissite.com      query-string SEARCH; results are TABLE rows (robots.txt allows /pages/)
//   - quotes.toscrape.com/js  the raw HTML has NO quotes: they are drawn by JavaScript after load
//   - webscraper.io test shop another site: product cards, page number in the query string, empty past the end
//   - scrapethissite.com/pages/simple  one long page (250 cards), no input, capped at 25 rows
//   - books.toscrape.com book page  ONE VALUE (the price); a "recommended" strip below repeats the same price style
//   - quotes.toscrape.com/tableful  quotes laid out with a layout TABLE (quote cell, then a tags row), tag in the path
//   - quotes.toscrape.com/js-delayed  quotes drawn 10 s after load: longer than a recorded tool's 5 s step timeout, so
//                                   the first test must stop honestly; then the per-step timeout is raised in a new
//                                   version (as the tool editor does) and the runs must return the right quotes
//   - the-internet.herokuapp.com/tables  another site, built for test-automation practice: a data table with a column
//                                   of action links (robots.txt allows everything)
// Wikipedia was tried first and refused automated browsing (HTTP 429); its robots.txt disallows /w/. It is not used.
//
// Read-only and paced: pages are opened by address and read. AnyMCP submits no form, uses no account, sends no
// message. About 40 page loads in total, with pauses. The test build is pre-granted these hosts because Chrome's own
// "allow this site" prompt cannot be automated (in the product, the person uses the "Allow a website" form).
//
// --with-claude additionally asks Claude Code (`claude -p`) to call tools over HTTP and over stdio. That sends the
// prompts and the tools' results (public sandbox data) to Anthropic through YOUR Claude Code login, as any Claude Code
// session would. Your Claude Code settings are not changed (temporary --mcp-config, --strict-mcp-config).

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import type { ResultEnvelope, ToolDefinition } from "anymcp-protocol";
import { ANYMCP_VERSION } from "anymcp-protocol";
import { PATH_PART_PATTERN, buildDraft, type DraftSpec } from "../../extension/src/shared/draft";
import type { TabCandidate } from "../../extension/src/shared/panel-api";
import { browserLabel, sleep, startStack, waitForState, type Stack } from "../../../e2e/harness";
import { htmlText, normalizeSpace } from "./html-text";
import { gitRevision, sourceTreeHash } from "./revision";

const ROOT = resolve(import.meta.dirname, "../../..");
const WITH_CLAUDE = process.argv.includes("--with-claude");
if (process.argv.includes("--chrome")) process.env.ANYMCP_E2E_BROWSER = "chrome";
const UA = "AnyMCP-readonly-check/0.1 (+https://github.com/dilipna/AnyMCP)";
const PAUSE_MS = 1500;
const BOOKS = "https://books.toscrape.com";
const HOCKEY = "https://www.scrapethissite.com";
const QUOTES = "https://quotes.toscrape.com";
const SHOP = "https://webscraper.io";
const HEROKU = "https://the-internet.herokuapp.com";

const norm = normalizeSpace;
const decode = htmlText; // tags removed until none are left, entities decoded once (see html-text.ts)

async function fetchTruth(url: string, parse: (html: string, url: string) => unknown[]): Promise<unknown[]> {
  await sleep(PAUSE_MS);
  const res = await fetch(url, { headers: { "user-agent": UA } });
  return parse(await res.text(), url);
}

// ---- independent readings of each page --------------------------------------------------------------------
const booksUrl = (cat: string) => `${BOOKS}/catalogue/category/books/${cat}/index.html`;
const parseBooks = (html: string, pageUrl: string) =>
  [...html.matchAll(/<h3><a href="([^"]+)" title="[^"]*">([^<]*)<\/a><\/h3>/g)].map((m) => ({ text: decode(m[2]!), url: new URL(m[1]!, pageUrl).href }));

const hockeyUrl = (q: string) => `${HOCKEY}/pages/forms/?${new URLSearchParams({ q })}`;
const parseHockey = (html: string) =>
  [...html.matchAll(/<tr class="team">([\s\S]*?)<\/tr>/g)].map((m) => {
    const cell = (cls: string) => decode((new RegExp(`<td class="${cls}[^"]*">([\\s\\S]*?)<\\/td>`).exec(m[1]!) ?? ["", ""])[1]!);
    return { team_name: cell("name"), year: Number(cell("year")), wins: Number(cell("wins")), losses: Number(cell("losses")) };
  });

const quotesUrl = (page: string) => `${QUOTES}/js/page/${page}/`;
/** The /js/ pages embed their quotes as a JavaScript array and draw them after load: read that array directly. */
const parseQuotes = (html: string) => {
  const m = /var data = (\[[\s\S]*?\]);\s*\n/.exec(html);
  return m ? (JSON.parse(m[1]!) as { text: string }[]).map((q) => norm(q.text)) : [];
};

const shopUrl = (page: string) => `${SHOP}/test-sites/e-commerce/static/computers/laptops?${new URLSearchParams({ page })}`;
/** Product cards: the visible link text (long names are already shortened in the HTML) and the product address. */
const parseShop = (html: string, pageUrl: string) =>
  [...html.matchAll(/<a href="([^"]+)" class="title" title="[^"]*" itemprop="name">([\s\S]*?)<\/a>/g)].map((m) => ({ text: decode(m[2]!), url: new URL(m[1]!, pageUrl).href }));

const COUNTRIES_URL = `${HOCKEY}/pages/simple/`;
/** 250 country cards; each name follows a flag icon inside the heading. */
const parseCountries = (html: string) => [...html.matchAll(/<h3 class="country-name">([\s\S]*?)<\/h3>/g)].map((m) => decode(m[1]!));

const bookUrl = (slug: string) => `${BOOKS}/catalogue/${slug}/index.html`;
/** The book's own price is in the main product box; the "recommended" strip below repeats the same class. */
const parseBookPrice = (html: string) => {
  const m = /class="col-sm-6 product_main">[\s\S]*?<p class="price_color">([^<]*)<\/p>/.exec(html);
  return m ? [norm(decode(m[1]!))] : [];
};

const tablefulUrl = (tag: string) => `${QUOTES}/tableful/tag/${tag}/page/1/`;
/** Layout table: each quote (with "Author: …") is a cell in its own row; the quote's tags are in the next row. */
const parseTableful = (html: string) => [...html.matchAll(/<td style="padding-top: 2em;">([\s\S]*?)<\/td>/g)].map((m) => norm(decode(m[1]!)));

/** Same embedded array as /js/, drawn by a 10-second timer instead of at load. */
const delayedUrl = (page: string) => `${QUOTES}/js-delayed/page/${page}/`;

const HEROKU_TABLES = `${HEROKU}/tables`;
/** Example 1's body rows: last name, first name and amount due (cells 1, 2 and 4). */
const parseHerokuTable = (html: string) => {
  const body = /<table id="table1"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => {
    const c = [...r[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => norm(decode(x[1]!)));
    return { last_name: c[0], first_name: c[1], due: c[3] };
  });
};

// ---- the sites ------------------------------------------------------------------------------------------------
interface Run {
  args: Record<string, unknown>;
  expect: "items" | "stopped";
  truthUrl?: string;
}
interface SiteCase {
  origin: string;
  label: string;
  structure: string;
  recordUrl: string;
  pickMode: "list" | "table" | "text";
  pickSelector: string;
  successSelector: string;
  edit: (spec: DraftSpec) => void;
  outputKey: string;
  max: number;
  links: boolean;
  parse: (html: string, url: string) => unknown[];
  test: Record<string, unknown>;
  runs: Run[];
  /** The page is slower than a recorded tool's default step timeout: the first test must stop honestly; then a new
   * version with this per-step timeout (the tool editor's "Per-step timeout") is tested, enabled and run. */
  slow?: { stepTimeoutMs: number };
  claude?: { transport: "http" | "stdio"; prompt: string; truthUrl: string; mustContain: (truth: unknown[]) => string[] };
}

const pathPart = (name: string, example: string, description: string) => ({ name, description, type: "string" as const, example, maxLength: 100, pattern: PATH_PART_PATTERN, fromPath: true });

const SITES: SiteCase[] = [
  {
    origin: BOOKS,
    label: "Books to Scrape (category listing)",
    structure: "static HTML; part of the path is the input; results are links",
    recordUrl: booksUrl("travel_2"),
    pickMode: "list",
    pickSelector: "article.product_pod h3 a",
    successSelector: "div.alert-warning",
    edit: (spec) => {
      spec.id = "books_in_category";
      spec.title = "Books in a category";
      spec.description = "Lists the books on one category page of the Books to Scrape sandbox (books.toscrape.com), each with its link. Read-only.";
      spec.outputs[0]!.name = "books";
      spec.outputs[0]!.maxRows = 20;
      // review screen: "Parts of the start address" → travel_2, then rename the input
      spec.params.push(pathPart("category", "travel_2", "Category part of the address, e.g. travel_2 or mystery_3"));
    },
    outputKey: "books",
    max: 20,
    links: true,
    parse: parseBooks,
    test: { category: "travel_2" },
    runs: [
      { args: { category: "mystery_3" }, expect: "items", truthUrl: booksUrl("mystery_3") },
      { args: { category: "poetry_23" }, expect: "items", truthUrl: booksUrl("poetry_23") },
      { args: { category: "nope_999" }, expect: "stopped" }, // no such category: must stop, not invent
    ],
    claude: {
      transport: "http",
      prompt: 'Use the anymcp books_in_category tool with the category "mystery_3". Reply with only the first two books, one per line, formatted as: title — URL. Copy the URLs exactly as the tool returned them.',
      truthUrl: booksUrl("mystery_3"),
      mustContain: (t) => (t as { url: string }[]).slice(0, 2).map((x) => x.url),
    },
  },
  {
    origin: HOCKEY,
    label: "Scrape This Site (hockey team search)",
    structure: "query-string search form results; results are table rows",
    recordUrl: hockeyUrl("boston"),
    pickMode: "table",
    pickSelector: "table.table",
    // not the page heading: it contains a live result count ("21 items") and would only match one search
    successSelector: "table.table th",
    edit: (spec) => {
      spec.id = "hockey_team_search";
      spec.title = "Search hockey team seasons";
      spec.description = "Searches the Scrape This Site hockey sandbox by team name and returns season rows (team, year, wins, losses). Read-only.";
      const t = spec.outputs[0]!;
      t.name = "seasons";
      t.maxRows = 25;
      // review screen: keep four columns ("Drop" the rest), mark the numeric ones as numbers
      t.columns = {
        "Team Name": { header: "Team Name", as: "string" },
        Year: { header: "Year", as: "number" },
        Wins: { header: "Wins", as: "number" },
        Losses: { header: "Losses", as: "number" },
      };
      // review screen: "Make it an input" on the start address setting `q`
      const qi = spec.entryQuery!.findIndex((q) => q.key === "q");
      spec.params.push({ name: "team", description: "Part of a team name, e.g. rangers", type: "string", example: spec.entryQuery![qi]!.value, maxLength: 60 });
      spec.entryQuery![qi] = { ...spec.entryQuery![qi]!, mode: "param", param: "team" };
    },
    outputKey: "seasons",
    max: 25,
    links: false,
    parse: (h) => parseHockey(h),
    test: { team: "boston" },
    runs: [
      { args: { team: "rangers" }, expect: "items", truthUrl: hockeyUrl("rangers") },
      { args: { team: "zzqqxx" }, expect: "items", truthUrl: hockeyUrl("zzqqxx") }, // no match: an empty table, honestly
    ],
    claude: {
      transport: "stdio",
      prompt: 'Use the anymcp hockey_team_search tool with team "rangers". Reply with only the first two rows, one per line, formatted as: team name, year, wins. Use the values exactly as returned.',
      truthUrl: hockeyUrl("rangers"),
      mustContain: (t) => (t as { team_name: string; year: number }[]).slice(0, 2).flatMap((r) => [r.team_name, String(r.year)]),
    },
  },
  {
    origin: QUOTES,
    label: "Quotes to Scrape (JavaScript-drawn page)",
    structure: "the raw HTML has no quotes; they are drawn by JavaScript after load; part of the path is the input",
    recordUrl: quotesUrl("2"),
    pickMode: "list",
    pickSelector: ".quote .text",
    successSelector: "h1 a",
    edit: (spec) => {
      spec.id = "quotes_page";
      spec.title = "Quotes on a page";
      spec.description = "Returns the quotes on one page of the JavaScript version of the Quotes to Scrape sandbox. Read-only.";
      spec.outputs[0]!.name = "quotes";
      spec.outputs[0]!.maxRows = 10;
      spec.params.push(pathPart("page", "2", "Page number, e.g. 3"));
    },
    outputKey: "quotes",
    max: 10,
    links: false,
    parse: (h) => parseQuotes(h),
    test: { page: "2" },
    runs: [
      { args: { page: "3" }, expect: "items", truthUrl: quotesUrl("3") },
      { args: { page: "5" }, expect: "items", truthUrl: quotesUrl("5") },
    ],
  },
  {
    origin: SHOP,
    label: "Web Scraper test shop (laptop listing)",
    structure: "a different site: product cards; the page number is in the query string; results are links; past the last page there are no cards and the run must stop",
    recordUrl: shopUrl("2"),
    pickMode: "list",
    pickSelector: "a.title",
    successSelector: "h1.page-header",
    edit: (spec) => {
      spec.id = "laptops_page";
      spec.title = "Laptops on a shop page";
      spec.description = "Lists the laptops on one page of the Web Scraper e-commerce test site (webscraper.io/test-sites), each with its link. Read-only.";
      spec.outputs[0]!.name = "laptops";
      spec.outputs[0]!.maxRows = 10;
      // review screen: "Make it an input" on the start address setting `page`
      const pi = spec.entryQuery!.findIndex((q) => q.key === "page");
      spec.params.push({ name: "page", description: "Page number, 1 to 20", type: "string", example: spec.entryQuery![pi]!.value, maxLength: 4 });
      spec.entryQuery![pi] = { ...spec.entryQuery![pi]!, mode: "param", param: "page" };
    },
    outputKey: "laptops",
    max: 10,
    links: true,
    parse: parseShop,
    test: { page: "2" },
    runs: [
      { args: { page: "3" }, expect: "items", truthUrl: shopUrl("3") },
      { args: { page: "20" }, expect: "items", truthUrl: shopUrl("20") }, // the last page
      // past the end the page has no product cards at all, so the recorded precondition (the list is there) is unmet:
      // AnyMCP must stop rather than claim an empty success it cannot tell from a wrong page
      { args: { page: "999" }, expect: "stopped" },
    ],
  },
  {
    origin: HOCKEY,
    label: "Scrape This Site (countries, a long page with no input)",
    structure: "one static page with 250 cards and no input; the tool returns the first 25 (its row cap)",
    recordUrl: COUNTRIES_URL,
    pickMode: "list",
    pickSelector: ".country-name",
    successSelector: "h1",
    edit: (spec) => {
      spec.id = "countries_list";
      spec.title = "Countries (first 25)";
      spec.description = "Returns the first 25 country names from the Scrape This Site countries page. Read-only.";
      spec.outputs[0]!.name = "countries";
      spec.outputs[0]!.maxRows = 25;
    },
    outputKey: "countries",
    max: 25,
    links: false,
    parse: (h) => parseCountries(h),
    test: {},
    runs: [{ args: {}, expect: "items", truthUrl: COUNTRIES_URL }],
  },
  {
    origin: BOOKS,
    label: "Books to Scrape (one book's price)",
    structure: "one value, not a list; part of the path is the input; a recommended-books strip below repeats the same price style, so the tool must return the book's own price",
    recordUrl: bookUrl("a-light-in-the-attic_1000"),
    pickMode: "text",
    pickSelector: ".product_main .price_color",
    successSelector: "div.alert-warning",
    edit: (spec) => {
      spec.id = "book_price";
      spec.title = "Price of a book";
      spec.description = "Returns the price shown on one book's page of the Books to Scrape sandbox (books.toscrape.com). Read-only.";
      spec.outputs[0]!.name = "price";
      spec.params.push(pathPart("book", "a-light-in-the-attic_1000", "Book part of the address, e.g. tipping-the-velvet_999"));
    },
    outputKey: "price",
    max: 1,
    links: false,
    parse: (h) => parseBookPrice(h),
    test: { book: "a-light-in-the-attic_1000" },
    runs: [
      { args: { book: "tipping-the-velvet_999" }, expect: "items", truthUrl: bookUrl("tipping-the-velvet_999") },
      { args: { book: "sharp-objects_997" }, expect: "items", truthUrl: bookUrl("sharp-objects_997") },
      { args: { book: "zzqqxx_9999" }, expect: "stopped" }, // no such book (HTTP 404 page): must stop, not invent a price
    ],
  },
  {
    origin: QUOTES,
    label: "Quotes to Scrape (layout table, by tag)",
    structure: "quotes laid out with an HTML table used for layout: each quote is a cell in its own row and its tags are in the next row; part of the path is the input",
    recordUrl: tablefulUrl("love"),
    pickMode: "list",
    pickSelector: 'td[style="padding-top: 2em;"]',
    successSelector: "h1 a",
    edit: (spec) => {
      spec.id = "quotes_by_tag";
      spec.title = "Quotes with a tag";
      spec.description = "Returns the quotes (with their authors) on the first page of one tag in the table version of the Quotes to Scrape sandbox. Read-only.";
      spec.outputs[0]!.name = "quotes";
      spec.outputs[0]!.maxRows = 10;
      spec.params.push(pathPart("tag", "love", "A tag, e.g. life or humor"));
    },
    outputKey: "quotes",
    max: 10,
    links: false,
    parse: (h) => parseTableful(h),
    test: { tag: "love" },
    runs: [
      { args: { tag: "life" }, expect: "items", truthUrl: tablefulUrl("life") },
      { args: { tag: "humor" }, expect: "items", truthUrl: tablefulUrl("humor") },
      { args: { tag: "zzqqxx" }, expect: "stopped" }, // a tag page with no quotes: the recorded list is not there
    ],
  },
  {
    origin: QUOTES,
    label: "Quotes to Scrape (drawn 10 seconds after load)",
    structure: "the quotes are drawn by a 10-second timer after the page loads, longer than a recorded tool's 5-second step timeout; part of the path is the input",
    recordUrl: delayedUrl("2"),
    pickMode: "list",
    pickSelector: ".quote .text",
    successSelector: "h1 a",
    slow: { stepTimeoutMs: 15000 },
    edit: (spec) => {
      spec.id = "delayed_quotes_page";
      spec.title = "Quotes on a slow page";
      spec.description = "Returns the quotes on one page of the delayed JavaScript version of the Quotes to Scrape sandbox. Read-only.";
      spec.outputs[0]!.name = "quotes";
      spec.outputs[0]!.maxRows = 10;
      spec.params.push(pathPart("page", "2", "Page number, e.g. 3"));
    },
    outputKey: "quotes",
    max: 10,
    links: false,
    parse: (h) => parseQuotes(h),
    test: { page: "2" },
    runs: [
      { args: { page: "3" }, expect: "items", truthUrl: delayedUrl("3") },
      { args: { page: "4" }, expect: "items", truthUrl: delayedUrl("4") },
    ],
  },
  {
    origin: HEROKU,
    label: "The Internet (test-automation practice site, data table)",
    structure: "another site, built for test-automation practice: a data table whose last column holds action links; no input",
    recordUrl: HEROKU_TABLES,
    pickMode: "table",
    pickSelector: "#table1",
    successSelector: "h3",
    edit: (spec) => {
      spec.id = "practice_table";
      spec.title = "Example data table";
      spec.description = "Returns the rows of the first example table on the-internet.herokuapp.com/tables (last name, first name, amount due). Read-only.";
      const t = spec.outputs[0]!;
      t.name = "people";
      t.maxRows = 10;
      // review screen: keep three columns ("Drop" the rest)
      t.columns = {
        "Last Name": { header: "Last Name", as: "string" },
        "First Name": { header: "First Name", as: "string" },
        Due: { header: "Due", as: "string" },
      };
    },
    outputKey: "people",
    max: 10,
    links: false,
    parse: (h) => parseHerokuTable(h),
    test: {},
    runs: [{ args: {}, expect: "items", truthUrl: HEROKU_TABLES }],
  },
];

function claude(prompt: string, allowed: string[], cfg: string): Promise<{ code: number | null; result: string; stderr: string }> {
  return new Promise((res) => {
    const args = ["-p", prompt, "--mcp-config", cfg, "--strict-mcp-config", "--allowedTools", allowed.join(","), "--output-format", "json", "--max-turns", "6"];
    const p = execFile("claude", args, { timeout: 300_000, maxBuffer: 20_000_000, env: { ...process.env, MCP_TIMEOUT: "60000" } }, (err, stdout, stderr) => {
      let result = "";
      try {
        result = String((JSON.parse(String(stdout)) as { result?: string }).result ?? "");
      } catch {
        result = String(stdout).slice(0, 2000);
      }
      res({ code: err ? ((err as { code?: number }).code ?? 1) : 0, result, stderr: String(stderr).slice(0, 1000) });
    });
    p.stdin?.end();
  });
}

async function record(s: Stack, c: SiteCase): Promise<DraftSpec> {
  const page = await s.context.newPage();
  try {
    await page.goto(c.recordUrl, { waitUntil: "load" });
    await page.locator(c.pickSelector).first().waitFor(); // what the person waits for before acting (JS-drawn pages)
    const listed = await s.call<TabCandidate[]>({ type: "tabs.candidates" });
    const tabs = listed.ok ? (listed.data ?? []) : [];
    const tab = tabs.find((t) => t.url === page.url()) ?? tabs.find((t) => t.origin === c.origin);
    if (!tab) throw new Error(`no tab for ${c.origin}`);
    const started = await s.call({ type: "record.start", tabId: tab.tabId });
    if (!started.ok) throw new Error(`record.start: ${started.error}`);
    await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });

    const pick = async (mode: "list" | "table" | "text" | "success", selector: string, outputs: number, signals: number) => {
      await s.call({ type: "record.pick", mode });
      await waitForState(s, (x) => x.recording?.pick === mode);
      await page.locator(selector).first().click();
      await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === outputs && (x.recording?.signals.length ?? 0) === signals);
    };
    await pick(c.pickMode, c.pickSelector, 1, 0);
    await pick("success", c.successSelector, 1, 1);
    await s.call({ type: "record.stop" });
    return ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  } finally {
    await s.call({ type: "record.discard" }); // never leave a recording open, even after a failure
    await page.close();
  }
}

/** JSON with object keys sorted (AnyMCP returns outputs in canonical key order). */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

function compare(got: unknown[], want: unknown[], max: number) {
  const w = want.slice(0, max);
  const mismatches = w.flatMap((item, i) => (canon(got[i]) === canon(item) ? [] : [{ i, got: got[i] ?? null, want: item }]));
  return { equal: mismatches.length === 0 && got.length === w.length, gotCount: got.length, wantCount: w.length, mismatches: mismatches.slice(0, 3) };
}

async function main() {
  if (WITH_CLAUDE) execFileSync(process.execPath, [resolve(ROOT, "scripts/build-all.mjs")], { stdio: "inherit" }); // packaged bridge for the stdio client
  execFileSync(process.execPath, [resolve(ROOT, "packages/extension/scripts/build.mjs"), "--target=e2e"], {
    stdio: "inherit",
    env: { ...process.env, ANYMCP_E2E_HOSTS: SITES.map((c) => `${c.origin}/*`).join(",") },
  });

  const s = await startStack({ tools: [] });
  const results: Record<string, unknown>[] = [];
  const claudeRuns: Record<string, unknown>[] = [];
  const tmp = mkdtempSync(join(os.tmpdir(), "anymcp-public-"));
  try {
    for (const c of SITES) {
      const site: Record<string, unknown> = { site: c.origin, label: c.label, structure: c.structure };
      results.push(site);
      try {
        const granted = await s.call({ type: "origin.granted", origin: c.origin });
        if (!granted.ok) throw new Error(`grant: ${granted.error}`);

        const spec = await record(s, c);
        site.recorded = { pickedAs: spec.outputs[0]?.as, pickedKind: spec.outputs[0]?.kind, locator: spec.outputs[0]?.locator, entryPath: spec.entryPath, query: (spec.entryQuery ?? []).map((q) => `${q.key}:${q.mode}`) };
        c.edit(spec);
        const built = buildDraft(spec, 1);
        if (!built.definition) throw new Error(`draft errors: ${built.errors.join(" | ")}`);
        const def: ToolDefinition = built.definition;
        site.tool = { id: def.id, entry: def.entry, steps: def.steps.map((x) => x.op), warnings: built.warnings };

        if (!(await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok) throw new Error("save failed");
        const test = async (version: number) => {
          await sleep(PAUSE_MS);
          const t0 = Date.now();
          const env = ((await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version, args: c.test })) as { data: { envelope: ResultEnvelope } }).data.envelope;
          return { env, ms: Date.now() - t0 };
        };
        let version = 1;
        if (c.slow) {
          // the recorded tool keeps the default step timeout: the test must stop, report why, and return nothing
          const first = await test(1);
          site.defaultTimeoutTest = {
            stepTimeoutMs: def.limits.stepTimeoutMs,
            status: first.env.status,
            reason: first.env.reasonCode,
            message: first.env.message,
            ms: first.ms,
            actionMayHaveOccurred: first.env.actionMayHaveOccurred,
            pass: first.env.status !== "success" && first.env.status !== "empty" && first.env.actionMayHaveOccurred === false,
          };
          // the tool editor's "Per-step timeout" saves a new version, which must be tested before it can be enabled
          version = 2;
          const edited: ToolDefinition = { ...def, version, limits: { ...def.limits, stepTimeoutMs: c.slow.stepTimeoutMs } };
          if (!(await s.call({ type: "tool.save", definition: edited, source: "edited" })).ok) throw new Error("saving the edited version failed");
          site.tool = { ...(site.tool as object), editedStepTimeoutMs: c.slow.stepTimeoutMs };
        }
        const tested = (await test(version)).env;
        site.test = { version, status: tested.status, message: tested.message };
        if (tested.status !== "success") throw new Error(`test run: ${tested.status} ${tested.message}`);
        await s.call({ type: "tool.enable", id: def.id, version });
        const deadline = Date.now() + 5000;
        while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);

        const client = await s.mcp();
        site.listedByClient = (await client.listTools()).tools.some((t) => t.name === def.id);
        const runs: Record<string, unknown>[] = [];
        for (const r of c.runs) {
          await sleep(PAUSE_MS);
          const env = await s.run(client, def.id, r.args);
          const raw = (env.output as Record<string, unknown> | undefined)?.[c.outputKey];
          const out = Array.isArray(raw) ? (raw as unknown[]) : raw === undefined || raw === null ? [] : [raw]; // one value = a list of one
          const row: Record<string, unknown> = { args: r.args, expect: r.expect, status: env.status, reason: env.reasonCode, message: env.message, source: env.source ?? null, untrusted: env.untrustedContent, items: out.length, sample: out.slice(0, 2) };
          if (r.expect === "items") {
            const truth = await fetchTruth(r.truthUrl!, c.parse);
            row.groundTruth = compare(out, truth, c.max);
            row.provenance = env.source?.origin === c.origin && (!c.links || (out as { url: string }[]).every((l) => l.url.startsWith(`${c.origin}/`)));
            row.pass = env.status === "success" && (row.groundTruth as { equal: boolean }).equal && row.provenance === true;
          } else {
            row.pass = env.status !== "success" && env.status !== "empty" && env.actionMayHaveOccurred === false;
          }
          runs.push(row);
        }
        site.runs = runs;

        if (WITH_CLAUDE && c.claude) {
          const truth = await fetchTruth(c.claude.truthUrl, c.parse);
          const cfg = join(tmp, `${def.id}.json`);
          if (c.claude.transport === "http") {
            writeFileSync(cfg, JSON.stringify({ mcpServers: { anymcp: { type: "http", url: s.bridge.mcpUrl, headers: { Authorization: `Bearer ${s.bridge.token()}` } } } }));
          } else {
            const bundle = resolve(ROOT, "packages/bridge/dist/anymcp-bridge.mjs");
            if (!existsSync(bundle)) throw new Error("packaged bridge missing");
            writeFileSync(cfg, JSON.stringify({ mcpServers: { anymcp: { command: process.execPath, args: [bundle, "--stdio", `--home=${s.bridge.store.dir}`, `--mcp-port=${s.bridge.mcpPort}`, `--ext-port=${s.bridge.extPort}`] } } }));
          }
          const r = await claude(c.claude.prompt, [`mcp__anymcp__${def.id}`], cfg);
          const need = c.claude.mustContain(truth);
          claudeRuns.push({
            site: c.origin,
            tool: def.id,
            transport: c.claude.transport,
            exit: r.code,
            reply: r.result.slice(0, 1200),
            expectedInReply: need,
            clientSeenByBridge: s.bridge.hub.lastClientName,
            pass: r.code === 0 && need.length > 0 && need.every((u) => r.result.includes(u)),
            ...(r.code === 0 ? {} : { stderr: r.stderr }),
          });
        }

        // removing the site disables its tool and takes it away from the client
        await s.call({ type: "origin.revoke", origin: c.origin });
        const gone = Date.now() + 5000;
        while (s.bridge.hub.getTool(def.id) && Date.now() < gone) await sleep(50);
        site.afterRevoke = { listedByClient: (await client.listTools()).tools.some((t) => t.name === def.id), grantKept: (await s.state()).grants.some((g) => g.origin === c.origin) };
        await client.close();
      } catch (e) {
        site.error = String((e as Error).message ?? e).slice(0, 600);
      }
    }
  } finally {
    await s.close();
    rmSync(tmp, { recursive: true, force: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const env = {
    anymcpVersion: ANYMCP_VERSION,
    sourceTreeSha256: sourceTreeHash().sha256,
    git: gitRevision(),
    browser: browserLabel(s.browserVersion),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    finishedAt: new Date().toISOString(),
    authorization: "host access pre-granted in the test build (Chrome's prompt cannot be automated); AnyMCP's own per-site grant recorded through the panel",
  };
  const out = resolve(ROOT, "eval/results");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `public-sites-${stamp}.json`), JSON.stringify({ env, results, claude: WITH_CLAUDE ? claudeRuns : "not run (pass --with-claude)" }, null, 2) + "\n");

  const lines = [
    "# AnyMCP public-site read-only validation",
    "",
    `> ${SITES.length} practice pages on ${new Set(SITES.map((c) => c.origin)).size} public practice sites (made for scraping or test-automation practice), a handful of inputs each. This shows the workflow works on these pages today; it says nothing about other sites.`,
    "",
    "## Environment",
    "",
    ...Object.entries(env).map(([k, v]) => `* **${k}**: \`${typeof v === "string" ? v : JSON.stringify(v)}\``),
    "",
    "## Tools, recorded through the real recorder",
    "",
    ...results.map((r) => `* ${r.site} (${r.label}) — ${r.structure}. Tool \`${(r.tool as { id?: string } | undefined)?.id ?? "—"}\`, recorder picked \`${JSON.stringify((r.recorded as { locator?: unknown } | undefined)?.locator ?? null)}\`${r.error ? ` — **error: ${r.error}**` : ""}`),
    "",
    "## Runs (official MCP SDK client over HTTP)",
    "",
    "| site | input | expected | status | items | equals independent reading | provenance | pass |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    for (const x of (r.runs as Record<string, unknown>[] | undefined) ?? []) {
      const gt = x.groundTruth as { equal: boolean; gotCount: number; wantCount: number } | undefined;
      lines.push(`| ${r.site} | \`${JSON.stringify(x.args)}\` | ${x.expect} | ${x.status}${x.reason !== "ok" ? ` (${x.reason})` : ""} | ${x.items} | ${gt ? `${gt.equal ? "yes" : "NO"} (${gt.gotCount}/${gt.wantCount})` : "—"} | ${x.provenance === undefined ? "—" : x.provenance ? "yes" : "NO"} | ${x.pass ? "✓" : "✗"} |`);
    }
  }
  const slow = results.filter((r) => r.defaultTimeoutTest);
  if (slow.length) {
    lines.push("", "## Slower than the default step timeout", "", "| site | default step timeout | first test | took | nothing done | pass | after raising it |", "|---|---|---|---|---|---|---|");
    for (const r of slow) {
      const d = r.defaultTimeoutTest as { stepTimeoutMs: number; status: string; reason: string; ms: number; actionMayHaveOccurred: boolean; pass: boolean };
      const t = r.test as { version?: number; status?: string } | undefined;
      const raised = (r.tool as { editedStepTimeoutMs?: number } | undefined)?.editedStepTimeoutMs;
      lines.push(`| ${r.site} (${r.label}) | ${d.stepTimeoutMs} ms | ${d.status} (${d.reason}) | ${(d.ms / 1000).toFixed(1)} s | ${d.actionMayHaveOccurred === false ? "yes" : "NO"} | ${d.pass ? "✓" : "✗"} | version ${t?.version ?? "—"} with ${raised ?? "—"} ms: test ${t?.status ?? "—"} |`);
    }
  }
  lines.push("", "## Revocation", "");
  for (const r of results) if (r.afterRevoke) lines.push(`* ${r.site} (${r.label}): after removing the site, the client still lists the tool: **${(r.afterRevoke as { listedByClient: boolean }).listedByClient}**`);
  if (WITH_CLAUDE) {
    lines.push("", "## Real MCP client: Claude Code (`claude -p`)", "", "| site | transport | exit | expected values in the reply | pass |", "|---|---|---|---|---|");
    for (const c of claudeRuns) lines.push(`| ${c.site} | ${c.transport} | ${c.exit} | ${c.pass ? "yes" : "no"} | ${c.pass ? "✓" : "✗"} |`);
  }
  writeFileSync(join(out, `public-sites-${stamp}.md`), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`→ eval/results/public-sites-${stamp}.{json,md}`);
  const allPass =
    results.every(
      (r) =>
        !r.error &&
        ((r.runs as { pass: boolean }[] | undefined) ?? []).every((x) => x.pass) &&
        (r.afterRevoke as { listedByClient: boolean } | undefined)?.listedByClient === false &&
        (r.defaultTimeoutTest === undefined || (r.defaultTimeoutTest as { pass: boolean }).pass),
    ) &&
    claudeRuns.every((c) => c.pass);
  process.exitCode = allPass ? 0 : 1;
}

await main();
