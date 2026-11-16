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
// Sites (structurally different on purpose; all three are sandboxes published for scraping practice):
//   - books.toscrape.com      static listing; one part of the PATH is the input; results are LINKS
//   - scrapethissite.com      query-string SEARCH; results are TABLE rows (robots.txt allows /pages/)
//   - quotes.toscrape.com/js  the raw HTML has NO quotes: they are drawn by JavaScript after load
// Wikipedia was tried first and refused automated browsing (HTTP 429); its robots.txt disallows /w/. It is not used.
//
// Read-only and paced: pages are opened by address and read. AnyMCP submits no form, uses no account, sends no
// message. About 25 page loads in total, with pauses. The test build is pre-granted these hosts because Chrome's own
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
  pickMode: "list" | "table";
  pickSelector: string;
  successSelector: string;
  edit: (spec: DraftSpec) => void;
  outputKey: string;
  max: number;
  links: boolean;
  parse: (html: string, url: string) => unknown[];
  test: Record<string, unknown>;
  runs: Run[];
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

    const pick = async (mode: "list" | "table" | "success", selector: string, outputs: number, signals: number) => {
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
        await sleep(PAUSE_MS);
        const tested = ((await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: c.test })) as { data: { envelope: ResultEnvelope } }).data.envelope;
        site.test = { status: tested.status, message: tested.message };
        if (tested.status !== "success") throw new Error(`test run: ${tested.status} ${tested.message}`);
        await s.call({ type: "tool.enable", id: def.id, version: 1 });
        const deadline = Date.now() + 5000;
        while (!s.bridge.hub.getTool(def.id) && Date.now() < deadline) await sleep(50);

        const client = await s.mcp();
        site.listedByClient = (await client.listTools()).tools.some((t) => t.name === def.id);
        const runs: Record<string, unknown>[] = [];
        for (const r of c.runs) {
          await sleep(PAUSE_MS);
          const env = await s.run(client, def.id, r.args);
          const out = ((env.output as Record<string, unknown[]> | undefined)?.[c.outputKey] ?? []) as unknown[];
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
    "> Three public scraping sandboxes, a handful of inputs each. This shows the workflow works on these pages today; it says nothing about other sites.",
    "",
    "## Environment",
    "",
    ...Object.entries(env).map(([k, v]) => `* **${k}**: \`${typeof v === "string" ? v : JSON.stringify(v)}\``),
    "",
    "## Tools, recorded through the real recorder",
    "",
    ...results.map((r) => `* ${r.site} — ${r.structure}. Tool \`${(r.tool as { id?: string } | undefined)?.id ?? "—"}\`, recorder picked \`${JSON.stringify((r.recorded as { locator?: unknown } | undefined)?.locator ?? null)}\`${r.error ? ` — **error: ${r.error}**` : ""}`),
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
  lines.push("", "## Revocation", "");
  for (const r of results) if (r.afterRevoke) lines.push(`* ${r.site}: after removing the site, the client still lists the tool: **${(r.afterRevoke as { listedByClient: boolean }).listedByClient}**`);
  if (WITH_CLAUDE) {
    lines.push("", "## Real MCP client: Claude Code (`claude -p`)", "", "| site | transport | exit | expected values in the reply | pass |", "|---|---|---|---|---|");
    for (const c of claudeRuns) lines.push(`| ${c.site} | ${c.transport} | ${c.exit} | ${c.pass ? "yes" : "no"} | ${c.pass ? "✓" : "✗"} |`);
  }
  writeFileSync(join(out, `public-sites-${stamp}.md`), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`→ eval/results/public-sites-${stamp}.{json,md}`);
  const allPass =
    results.every((r) => !r.error && ((r.runs as { pass: boolean }[] | undefined) ?? []).every((x) => x.pass) && (r.afterRevoke as { listedByClient: boolean } | undefined)?.listedByClient === false) &&
    claudeRuns.every((c) => c.pass);
  process.exitCode = allPass ? 0 : 1;
}

await main();
