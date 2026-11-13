// Evaluation runner (protocol v1). Real browser + real extension + real bridge + official MCP client.
//   npm run eval                       run the frozen catalogue, write eval/results/*.json|md
//   npm run eval -- --freeze           (re)write scenarios.lock.json (only before a headline run!)
//   npm run eval -- --only=read.empty  development run: NOT a headline result, labelled as partial
//   ANYMCP_E2E_BROWSER=chrome npm run eval   use the real branded Chrome instead of Playwright's Chromium

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import type { ResultEnvelope } from "anymcp-protocol";
import { ANYMCP_VERSION, isSuccessStatus } from "anymcp-protocol";
import { buildDraft, type DraftSpec } from "../../extension/src/shared/draft";
import type { TabCandidate } from "../../extension/src/shared/panel-api";
import { startStack, waitForState, sleep } from "../../../e2e/harness";
import { fileSha256, gitRevision, sourceTreeHash } from "./revision";
import { PROTOCOL_VERSION, SCENARIOS, type Ctx, type Observation } from "./scenarios";

const ROOT = resolve(import.meta.dirname, "../../..");
const SCEN_FILE = resolve(import.meta.dirname, "scenarios.ts");
const LOCK_FILE = resolve(import.meta.dirname, "../scenarios.lock.json");
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const dev = process.argv.includes("--dev"); // develop the runner itself: skips the lock check; results are labelled PARTIAL

// ------------------------------------------------------------------ freeze / verify
const scenariosSha = fileSha256(SCEN_FILE);
if (process.argv.includes("--freeze")) {
  writeFileSync(LOCK_FILE, JSON.stringify({ protocolVersion: PROTOCOL_VERSION, scenariosSha256: scenariosSha, scenarios: SCENARIOS.length, frozenAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`froze protocol v${PROTOCOL_VERSION}: ${SCENARIOS.length} scenarios, sha256 ${scenariosSha.slice(0, 16)}…`);
  process.exit(0);
}
if (!dev && !existsSync(LOCK_FILE)) throw new Error("No scenarios.lock.json. Freeze the protocol first: npm run eval -- --freeze");
const lock = dev && !existsSync(LOCK_FILE) ? { protocolVersion: PROTOCOL_VERSION, scenariosSha256: scenariosSha } : (JSON.parse(readFileSync(LOCK_FILE, "utf8")) as { protocolVersion: number; scenariosSha256: string });
if (!dev && (lock.scenariosSha256 !== scenariosSha || lock.protocolVersion !== PROTOCOL_VERSION)) {
  throw new Error("The scenario catalogue changed after it was frozen. Results from a modified catalogue are not comparable. Bump PROTOCOL_VERSION in scenarios.ts and re-freeze, and report it as a new protocol version.");
}

// ------------------------------------------------------------------ helpers
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)]! : NaN);
const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)]! : NaN);
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "n/a");

interface RunResult {
  scenario: string;
  run: number;
  status: string;
  reason: string | undefined;
  correct: boolean;
  falseSuccess: boolean;
  unapproved: number;
  overClaim: boolean;
  recovered: boolean | null;
  latencyMs: number | null;
  failures: string[];
}

async function main() {
  // Always evaluate the CURRENT sources, like the browser tests' global setup: never a stale or missing build.
  execFileSync(process.execPath, [resolve(import.meta.dirname, "../../extension/scripts/build.mjs"), "--target=e2e"], { stdio: "inherit" });
  const stack = await startStack({ reconnectGraceMs: 8000 });
  const browserVersion = stack.browserVersion;
  const useChrome = process.env.ANYMCP_E2E_BROWSER === "chrome";
  let n = 0;
  const idle = async () => {
    const d = Date.now() + 15_000;
    while (!stack.bridge.hub.connected && Date.now() < d) await sleep(100);
    await waitForState(stack, (st) => !st.active && !st.approval, 20_000);
  };
  // Count approvals INDEPENDENTLY of what a scenario reports: (a) every Approve click the harness makes, and
  // (b) the extension's own `approval_granted` events. The smaller of the two is used (conservative for "unapproved").
  let approveClicks = 0;
  const realApprove = stack.approve.bind(stack);
  stack.approve = async () => {
    approveClicks++;
    await realApprove();
  };
  const client = await stack.mcp();
  const ctx: Ctx = {
    s: stack,
    c: client,
    run: (name, args) => stack.run(client, name, args),
    note: () => `Evaluation note ${++n}.`,
    taskPage: () => stack.context.pages().find((p) => p.url().startsWith(stack.fixture.origin)),
  };

  const results: RunResult[] = [];
  const list = SCENARIOS.filter((s) => !only || s.id === only);
  const t0 = Date.now();

  for (const sc of list) {
    for (let i = 0; i < sc.runs; i++) {
      await stack.chaos({ reset: true });
      await idle();
      let partial: Partial<Observation> = {};
      let error: string | null = null;
      approveClicks = 0;
      const runStartIso = new Date().toISOString();
      try {
        partial = await sc.act(ctx, i);
      } catch (e) {
        error = String((e as Error).message ?? e);
        // snapshot for diagnosis: never let a thrown scenario hide what the site actually received
        try {
          const st = await stack.state();
          error += ` | active=${JSON.stringify(st.active)} approval=${st.approval ? st.approval.executionId : null} lastRequests=${stack.fixture.state.requestLog.slice(-5).map((r) => `${r.method} ${r.path}`).join(", ")} writes=${stack.fixture.state.writeLog.length}`;
        } catch {
          /* ignore */
        }
      }
      let grantedEvents = 0;
      try {
        const st = await stack.state();
        grantedEvents = st.runs.filter((r) => r.startedAt >= runStartIso).flatMap((r) => r.events).filter((e) => e.phase === "approval_granted").length;
      } catch {
        /* ignore */
      }
      const log = stack.fixture.state.requestLog;
      const obs: Observation = {
        envs: [],
        writes: stack.fixture.state.writeLog.length,
        posts: log.filter((r) => r.method === "POST" && r.path.includes("/drafts")).length,
        searches: log.filter((r) => r.path === "/api/orders").length,
        requests: log.filter((r) => !r.path.startsWith("/__control") && r.path !== "/favicon.ico").length,
        approvalsGranted: 0,
        promptsShown: 0,
        ...partial,
      };
      obs.approvalsGranted = Math.min(approveClicks, grantedEvents); // overrides anything the scenario reported
      const chk = error ? { failures: [`scenario threw: ${error}`] } : sc.check(obs, i);
      const failures = [...chk.failures];

      const ok = obs.envs.some((e) => isSuccessStatus(e.status as never));
      const falseSuccess = (obs.envs.some((e) => isSuccessStatus(e.status as never) && !sc.accepted.includes(e.status)) || !!(chk as { outputMismatch?: boolean }).outputMismatch) && ok;
      const unapproved = Math.max(0, obs.writes - obs.approvalsGranted);
      // Only results of runs that actually executed in the browser can over-claim. A refused request (denied /
      // invalid_input) truthfully says it did nothing, even if an EARLIER request in the same scenario wrote.
      const overClaim = obs.envs.some((e) => e.tool?.id === "draft_customer_note" && e.status !== "denied" && e.status !== "invalid_input" && e.actionMayHaveOccurred === false && obs.writes > 0);

      // recovery: after the injected failure the NEXT normal call must succeed, with nothing restarted by hand
      let recovered: boolean | null = null;
      if (sc.recovery) {
        await stack.chaos({ reset: true });
        await idle();
        try {
          recovered = (await ctx.run("find_order", { order_id: "A-1012" })).status === "success";
        } catch {
          recovered = false;
        }
        if (!recovered) failures.push("the next normal call did not succeed");
      }
      results.push({
        scenario: sc.id,
        run: i + 1,
        status: obs.envs.map((e) => e.status).join("+") || "(none)",
        reason: obs.envs[0]?.reasonCode,
        correct: failures.length === 0 && obs.envs.every((e) => sc.accepted.includes(e.status)),
        falseSuccess,
        unapproved,
        overClaim,
        recovered,
        latencyMs: obs.latencyMs ?? null,
        failures,
      });
      process.stdout.write(failures.length ? "x" : ".");
    }
    process.stdout.write(` ${sc.id}\n`);
  }

  // ------------------------------------------------------------------ write-path latency (approval wait excluded)
  const writeLat: number[] = [];
  if (!only) {
    for (let i = 0; i < 10; i++) {
      await stack.chaos({ reset: true });
      await idle();
      const p = ctx.run("draft_customer_note", { order_id: "A-1012", note: ctx.note() });
      await waitForState(stack, (st) => !!st.approval);
      const t = performance.now();
      await stack.approve();
      await p;
      writeLat.push(performance.now() - t);
    }
  }

  // ------------------------------------------------------------------ tool-creation effort (scripted, n = 1)
  let creation: Record<string, number | string> | null = null;
  if (!only) {
    await stack.chaos({ reset: true });
    await idle();
    const t = performance.now();
    const page = await stack.context.newPage();
    await page.goto(`${stack.fixture.origin}/orders`);
    const tabs = (await stack.call<TabCandidate[]>({ type: "tabs.candidates" })) as { data: TabCandidate[] };
    const tab = tabs.data.find((x) => x.url === page.url())!;
    await stack.call({ type: "record.start", tabId: tab.tabId });
    await page.getByLabel("Order ID").click();
    await page.keyboard.type("A-1012");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: "A-1012" }).click();
    await page.waitForURL(/\/orders\/A-1012$/);
    await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });
    const pick = async (mode: "text" | "success", sel: string, o: number, g: number) => {
      await stack.call({ type: "record.pick", mode });
      await waitForState(stack, (x) => x.recording?.pick === mode);
      await page.locator(sel).click();
      await waitForState(stack, (x) => (x.recording?.outputs.length ?? 0) === o && (x.recording?.signals.length ?? 0) === g);
    };
    await pick("text", '[data-testid="order-status"]', 1, 0);
    await pick("text", '[data-testid="customer-name"]', 2, 0);
    await pick("success", '[data-testid="order-id"]', 2, 1);
    await stack.call({ type: "record.stop" });
    const spec = ((await stack.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
    // the review edits a person would make
    spec.id = "eval_recorded_find_order";
    spec.title = "Evaluation: recorded find order";
    spec.description = "Look up an order by its ID and return its status and customer (taught by recording).";
    spec.params[0]!.pattern = "^A-\\d{4}$";
    spec.params[0]!.maxLength = 6;
    spec.outputs[0]!.name = "status";
    spec.outputs[1]!.name = "customer";
    const reviewEdits = 7;
    const built = buildDraft(spec, 1);
    await stack.call({ type: "tool.save", definition: built.definition!, source: "recorded" });
    const tested = (await stack.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: spec.id, version: 1, args: { order_id: "A-1012" } })) as { data: { envelope: ResultEnvelope } };
    await stack.call({ type: "tool.enable", id: spec.id, version: 1 });
    creation = {
      recordedSteps: spec.steps.length,
      picks: 3,
      reviewEdits,
      userActionsTotal: spec.steps.length + 3 + reviewEdits + 3, // + stop, save, enable
      testStatus: tested.data.envelope.status,
      scriptedWallClockMs: Math.round(performance.now() - t),
      note: "scripted by Playwright, one operator, n = 1. Not a usability study.",
    };
    await page.close();
  }

  await client.close();
  const finished = Date.now();
  await stack.close();

  // ------------------------------------------------------------------ aggregate
  const per = list.map((sc) => {
    const rs = results.filter((r) => r.scenario === sc.id);
    const lat = rs.map((r) => r.latencyMs).filter((x): x is number => x !== null);
    const rec = rs.filter((r) => r.recovered !== null);
    return {
      id: sc.id,
      category: sc.category,
      accepted: sc.accepted.join(" | "),
      runs: rs.length,
      correct: rs.filter((r) => r.correct).length,
      falseSuccess: rs.filter((r) => r.falseSuccess).length,
      unapproved: rs.reduce((a, r) => a + r.unapproved, 0),
      overClaim: rs.filter((r) => r.overClaim).length,
      recovered: rec.length ? `${rec.filter((r) => r.recovered).length}/${rec.length}` : "—",
      lat,
    };
  });
  const total = results.length;
  const sum = (k: "correct" | "falseSuccess" | "unapproved" | "overClaim") => per.reduce((a, p) => a + p[k], 0);
  const failures = results.filter((r) => r.failures.length || !r.correct);
  const readLat = per.find((p) => p.id === "read.success")?.lat ?? [];

  const rev = sourceTreeHash();
  const git = gitRevision();
  const env = {
    protocolVersion: PROTOCOL_VERSION,
    anymcpVersion: ANYMCP_VERSION,
    scenariosSha256: scenariosSha,
    sourceTreeSha256: rev.sha256,
    sourceFiles: rev.files,
    gitHead: git.head,
    gitDirty: git.dirty,
    browser: `${useChrome ? "Google Chrome (real, branded)" : "Playwright Chromium"} ${browserVersion}`,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    cpu: os.cpus()[0]?.model ?? "unknown",
    startedAt: new Date(t0).toISOString(),
    durationSeconds: Math.round((finished - t0) / 1000),
    partial: !!only || dev,
    site: "synthetic fixture (Acme Support Portal)",
  };
  const stamp = new Date(t0).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tag = `${useChrome ? "chrome" : "chromium"}-${stamp}${only ? `-only-${only}` : ""}${dev ? "-DEV" : ""}`;
  const dir = resolve(ROOT, "eval/results");
  mkdirSync(dir, { recursive: true });
  const json = { env, totals: { runs: total, correct: sum("correct"), falseSuccess: sum("falseSuccess"), unapprovedActions: sum("unapproved"), overClaimsOfSafety: sum("overClaim") }, perScenario: per.map(({ lat, ...p }) => ({ ...p, latencyMs: lat.length ? { n: lat.length, min: Math.min(...lat), median: median(lat), p95: pct(lat, 95), max: Math.max(...lat) } : null })), writeLatencyMs: writeLat.length ? { n: writeLat.length, min: Math.min(...writeLat), median: median(writeLat), p95: pct(writeLat, 95), max: Math.max(...writeLat) } : null, toolCreation: creation, failures, runs: results };
  writeFileSync(resolve(dir, `fixture-${tag}.json`), JSON.stringify(json, null, 2) + "\n");

  const md = [
    `# AnyMCP evaluation results — synthetic fixture${only || dev ? " (PARTIAL development run — not a headline result)" : ""}`,
    "",
    "> Fixture only. These numbers say nothing about compatibility with any real website. The fixture is a development suite, not a held-out set. See `docs/evaluation-protocol.md`.",
    "",
    "## Environment",
    "",
    ...Object.entries(env).map(([k, v]) => `* **${k}**: \`${String(v)}\``),
    "",
    "## Headline (exact denominators)",
    "",
    `| Metric | Result |`,
    `|---|---|`,
    `| Runs | ${total} across ${per.length} scenarios |`,
    `| Correct completion | **${sum("correct")} / ${total}** |`,
    `| Incorrect success reports (false success) | **${sum("falseSuccess")} / ${total}** |`,
    `| Unapproved actions (writes without an approval in that run) | **${sum("unapproved")}** over ${total} runs |`,
    `| Over-claims of safety ("nothing changed" when a write happened) | **${sum("overClaim")} / ${total}** |`,
    `| Recovery (next normal call succeeds after an injected failure) | ${per.filter((p) => p.recovered !== "—").reduce((a, p) => a + Number(p.recovered.split("/")[0]), 0)} / ${per.filter((p) => p.recovered !== "—").reduce((a, p) => a + Number(p.recovered.split("/")[1]), 0)} |`,
    "",
    failures.length === 0
      ? `No failing run was observed in ${total} runs. That is an observation about these ${total} runs, **not** a guarantee of safety.`
      : `**${failures.length} run(s) did not behave as expected — listed below.**`,
    "",
    "## Per scenario",
    "",
    "| scenario | category | accepted outcome | runs | correct | false success | unapproved | over-claim | recovered |",
    "|---|---|---|---|---|---|---|---|---|",
    ...per.map((p) => `| \`${p.id}\` | ${p.category} | ${p.accepted} | ${p.runs} | ${p.correct}/${p.runs} | ${p.falseSuccess} | ${p.unapproved} | ${p.overClaim} | ${p.recovered} |`),
    "",
    "## Latency (this machine, trivial local fixture; approval wait excluded)",
    "",
    "| path | n | min ms | median ms | p95 ms | max ms |",
    "|---|---|---|---|---|---|",
    readLat.length ? `| read: \`find_order\` (MCP call → result) | ${readLat.length} | ${f1(Math.min(...readLat))} | ${f1(median(readLat))} | ${f1(pct(readLat, 95))} | ${f1(Math.max(...readLat))} |` : "| read | — | | | | |",
    writeLat.length ? `| write: approve click → result | ${writeLat.length} | ${f1(Math.min(...writeLat))} | ${f1(median(writeLat))} | ${f1(pct(writeLat, 95))} | ${f1(Math.max(...writeLat))} |` : "| write | — | | | | |",
    "",
    "## Tool-creation effort",
    "",
    creation ? Object.entries(creation).map(([k, v]) => `* **${k}**: ${v}`).join("\n") : "_not measured in a partial run_",
    "",
    "## Failures",
    "",
    failures.length ? failures.map((r) => `* \`${r.scenario}\` run ${r.run}: status \`${r.status}\`${r.reason ? ` (${r.reason})` : ""} — ${r.failures.join("; ") || "status not in the accepted set"}`).join("\n") : "None observed.",
    "",
  ].join("\n");
  writeFileSync(resolve(dir, `fixture-${tag}.md`), md);
  console.log(`\n${md.split("\n").slice(0, 22).join("\n")}\n\n→ eval/results/fixture-${tag}.{json,md}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
