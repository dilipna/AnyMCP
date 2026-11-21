// EXTERNAL read-only check — kept separate from the fixture evaluation on purpose.
//
//   ANYMCP_E2E_HOSTS="https://books.toscrape.com/*" node packages/extension/scripts/build.mjs --target=e2e
//   npx tsx packages/eval/src/external.ts [--chrome]
//
// SCOPE (recorded in the output): one site, https://books.toscrape.com, a public sandbox whose purpose is to be
// scraped. Read-only: the extension navigates by URL and reads text. NO forms are submitted, NO accounts are
// created or used, NO messages are sent. Sequential, ~15 page loads in total, with a pause between runs.
// Ground truth for the happy path is the same page's raw HTML fetched independently of AnyMCP.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import type { ResultEnvelope, ToolDefinition } from "anymcp-protocol";
import { ANYMCP_VERSION } from "anymcp-protocol";
import { browserLabel, startStack, sleep } from "../../../e2e/harness";
import { htmlText } from "./html-text";
import { gitRevision, sourceTreeHash } from "./revision";

if (process.argv.includes("--chrome")) process.env.ANYMCP_E2E_BROWSER = "chrome";
const ORIGIN = "https://books.toscrape.com";

const base: Omit<ToolDefinition, "id" | "title" | "description" | "entry" | "input" | "output" | "steps" | "preconditions" | "postconditions"> = {
  schemaVersion: 1,
  version: 1,
  kind: "read",
  origins: [ORIGIN],
  sessionExpiredWhen: [],
  emptyWhen: [],
  failureWhen: [],
  approval: { required: false, actionTemplate: "", stateFields: [], ttlSeconds: 120 },
  limits: { stepTimeoutMs: 5000, totalTimeoutMs: 30000, maxAttempts: 2 },
  reconcile: false,
} as never;
const headingIsTitle = { kind: "exists", locator: { by: "role", role: "heading", name: { param: "title" } } } as const;

const availability: ToolDefinition = {
  ...base,
  id: "book_availability",
  title: "Book availability",
  description: "Read whether one book on the Books to Scrape sandbox is in stock. Read-only; verifies the page is the book that was asked for.",
  entry: { path: "/catalogue/{slug}/index.html" },
  input: {
    type: "object",
    properties: { slug: { type: "string", pattern: "^[a-z0-9-]+_[0-9]{1,5}$", maxLength: 80 }, title: { type: "string", maxLength: 120 } },
    required: ["slug", "title"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { availability: { type: "string", maxLength: 200 }, price: { type: "string", maxLength: 20 } }, required: ["availability", "price"], additionalProperties: false },
  // History (all attempts are kept in eval/results): attempt 1 located the text "In stock", attempt 2 "available)".
  // Both were correctly STOPPED as ambiguous (the same text also appears in the product-information table), which
  // exposed a real gap. Attempt 3 uses the `field` and `css` locators that were added because of it.
  steps: [
    { id: "s1", op: "extract", into: "availability", source: { type: "text", locator: { by: "field", label: "Availability" } } },
    { id: "s2", op: "extract", into: "price", source: { type: "text", locator: { by: "css", selector: ".product_main .price_color" } } },
  ],
  preconditions: [{ id: "right_book_page", condition: headingIsTitle }],
  postconditions: [{ id: "page_is_the_requested_book", condition: headingIsTitle }],
} as ToolDefinition;

// A deliberately naive tool: "£" appears in several places on a product page. A safe tool must STOP, not pick one.
const probe: ToolDefinition = {
  ...base,
  id: "book_price_probe",
  title: "Book price (naive probe)",
  description: "NEGATIVE CONTROL: a deliberately ambiguous locator on a real page. Expected to stop with locator_ambiguous.",
  entry: { path: "/catalogue/{slug}/index.html" },
  input: {
    type: "object",
    properties: { slug: { type: "string", pattern: "^[a-z0-9-]+_[0-9]{1,5}$", maxLength: 80 }, title: { type: "string", maxLength: 120 } },
    required: ["slug", "title"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { price: { type: "string", maxLength: 50 } }, required: ["price"], additionalProperties: false },
  steps: [{ id: "s1", op: "extract", into: "price", source: { type: "text", locator: { by: "text", text: "£", exact: false } } }],
  preconditions: [{ id: "right_book_page", condition: headingIsTitle }],
  postconditions: [{ id: "page_is_the_requested_book", condition: headingIsTitle }],
} as ToolDefinition;

const BOOKS = [
  { slug: "a-light-in-the-attic_1000", title: "A Light in the Attic" },
  { slug: "tipping-the-velvet_999", title: "Tipping the Velvet" },
  { slug: "soumission_998", title: "Soumission" },
  { slug: "sharp-objects_997", title: "Sharp Objects" },
  { slug: "sapiens-a-brief-history-of-humankind_996", title: "Sapiens: A Brief History of Humankind" },
];

/** Independent oracle: the page's own HTML, fetched without AnyMCP. */
async function truthFor(slug: string): Promise<string | null> {
  const res = await fetch(`${ORIGIN}/catalogue/${slug}/index.html`);
  if (!res.ok) return null;
  const html = await res.text();
  const m = /class="instock availability">([\s\S]*?)<\/p>/.exec(html);
  const pr = /class="price_color">([^<]+)</.exec(html);
  return m && pr ? `${htmlText(m[1]!)} | ${pr[1]!.trim()}` : null;
}

interface Row {
  case: string;
  expected: string;
  status: string;
  reason: string | undefined;
  ok: boolean;
  detail: string;
  ms: number;
}

const s = await startStack({ tools: [] });
const rows: Row[] = [];
try {
  const d = await s.call({ type: "__test.setup", definitions: [availability, probe], origins: [ORIGIN] });
  if (!d.ok) throw new Error(`setup failed: ${d.error}`);
  const deadline = Date.now() + 8000;
  while (s.bridge.hub.listTools().length < 2 && Date.now() < deadline) await sleep(50);
  const c = await s.mcp();
  const run = async (name: string, args: Record<string, unknown>): Promise<{ env: ResultEnvelope; ms: number }> => {
    const t = performance.now();
    const env = await s.run(c, name, args);
    await sleep(800); // be polite to a shared sandbox
    return { env, ms: performance.now() - t };
  };

  // ---- happy path: every book twice, compared with independent ground truth ----
  for (const b of BOOKS) {
    const truth = await truthFor(b.slug);
    for (let i = 1; i <= 2; i++) {
      const { env, ms } = await run("book_availability", b);
      const o = env.output as { availability?: string; price?: string } | undefined;
      const got = o ? `${o.availability?.replace(/\s+/g, " ").trim()} | ${o.price?.trim()}` : undefined;
      const ok = env.status === "success" && !!truth && got === truth;
      rows.push({ case: `happy: ${b.title} (#${i})`, expected: `success, "availability | price" == "${truth}"`, status: env.status, reason: env.reasonCode, ok, detail: ok ? `"${got}"` : `got "${got ?? "(none)"}" vs truth "${truth}"; ${env.message}`, ms });
    }
  }
  // ---- negative controls ----
  {
    const { env, ms } = await run("book_availability", { slug: BOOKS[0]!.slug, title: "Tipping the Velvet" }); // right page, wrong title
    rows.push({ case: "wrong title for the page", expected: "precondition_failed (never success)", status: env.status, reason: env.reasonCode, ok: env.status === "precondition_failed", detail: env.message, ms });
  }
  {
    const { env, ms } = await run("book_availability", { slug: "no-such-book_1", title: "Anything" }); // the site returns 404
    rows.push({ case: "page does not exist (HTTP 404)", expected: "precondition_failed (never success)", status: env.status, reason: env.reasonCode, ok: env.status === "precondition_failed", detail: env.message, ms });
  }
  {
    const { env, ms } = await run("book_price_probe", BOOKS[0]!);
    rows.push({ case: "ambiguous locator on a real page (£ appears several times)", expected: "precondition_failed / locator_ambiguous (stops, does not guess)", status: env.status, reason: env.reasonCode, ok: env.status === "precondition_failed" && env.reasonCode === "locator_ambiguous", detail: env.message, ms });
  }
  await c.close();
} finally {
  const rev = sourceTreeHash();
  const git = gitRevision();
  const env = { anymcpVersion: ANYMCP_VERSION, browser: browserLabel(s.browserVersion), os: `${os.type()} ${os.release()}`, node: process.version, sourceTreeSha256: rev.sha256, gitHead: git.head, startedAt: new Date().toISOString() };
  await s.close();
  const okN = rows.filter((r) => r.ok).length;
  const dir = resolve(import.meta.dirname, "../../../eval/results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  writeFileSync(join(dir, `external-books-toscrape-${stamp}.json`), JSON.stringify({ scope: { site: ORIGIN, access: "read-only GET navigation by URL; reads text; no forms, accounts or messages", pageLoadsApprox: rows.length, authorisation: "public sandbox whose stated purpose is to be scraped; no robots.txt restriction found (404)" }, env, summary: { runs: rows.length, asExpected: okN }, rows }, null, 2));
  const md = [
    "# External read-only check — books.toscrape.com (attempt 3: `field` + `css` locators)",
    "",
    "> **Separate from the fixture evaluation.** One public sandbox site. This shows what happened on this site on this day with two tiny tools; it is not a compatibility claim for any other site.",
    "",
    "**Scope.** `https://books.toscrape.com` (a sandbox whose purpose is to be scraped). Read-only: navigation by URL and reading text. **No forms submitted, no accounts, no messages.** Sequential, one page load per run, 0.8 s pause between runs.",
    "",
    "**Ground truth.** For the happy path, the page's own HTML fetched independently of AnyMCP.",
    "",
    `**Environment.** AnyMCP ${env.anymcpVersion}; ${env.browser}; ${env.os}; Node ${env.node}; source ${env.sourceTreeSha256.slice(0, 16)}…`,
    "",
    `## Result: ${okN} of ${rows.length} runs behaved as expected`,
    "",
    "| case | expected | observed | as expected | ms |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.case} | ${r.expected} | \`${r.status}\`${r.reason ? ` / ${r.reason}` : ""} | ${r.ok ? "yes" : "**NO**"} | ${r.ms.toFixed(0)} |`),
    "",
    ...(rows.some((r) => !r.ok) ? ["## Unexpected", "", ...rows.filter((r) => !r.ok).map((r) => `* ${r.case}: ${r.detail}`), ""] : []),
    "## What this does and does not show",
    "",
    "* It shows the read path, the precondition guard (right page?) and the ambiguity guard working on a real third-party page.",
    "* Attempts 1 and 2 (purely text-based locators) were stopped as ambiguous on every happy-path run: 3 of 13 as expected. That gap led to the `field` (value next to a label) and `css` (fragile fallback) locators used here.",
    "* It says nothing about login-protected sites, JavaScript-heavy apps, or any write workflow.",
    "",
  ].join("\n");
  writeFileSync(join(dir, `external-books-toscrape-${stamp}.md`), md);
  console.log(md);
}
