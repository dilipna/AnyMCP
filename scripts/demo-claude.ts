// A REAL MCP client demonstration: Claude Code (`claude -p`) calls MyCP tools through the bridge, against the
// SYNTHETIC fixture, in a browser with the extension loaded. A person's approval is simulated by clicking
// "Approve once" / "Decline" in the panel so the run can finish unattended.
//
//   npx tsx scripts/demo-claude.ts [--chrome]
//
// What leaves this computer: the prompts below and the tool results (synthetic data only) go to Anthropic through
// your own Claude Code login, exactly as any Claude Code session would. Nothing else. Your Claude Code
// configuration is not modified: we pass a temporary --mcp-config with --strict-mcp-config.
//
// This is a labelled demonstration, NOT part of the evaluation numbers (the model's wording is not deterministic).

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStack, waitForState } from "../e2e/harness";

if (process.argv.includes("--chrome")) process.env.MYCP_E2E_BROWSER = "chrome";

const tmp = mkdtempSync(join(tmpdir(), "mycp-demo-"));
const out = resolve(import.meta.dirname, "../eval/results");
mkdirSync(out, { recursive: true });

function claude(prompt: string, allowed: string[], cfg: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const args = ["-p", prompt, "--mcp-config", cfg, "--strict-mcp-config", "--allowedTools", allowed.join(","), "--output-format", "json", "--max-turns", "6"];
    const p = execFile("claude", args, { timeout: 240_000, maxBuffer: 20_000_000, env: { ...process.env, MCP_TIMEOUT: "60000" } }, (err, stdout, stderr) => {
      res({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
    p.stdin?.end();
  });
}

const s = await startStack();
const record: Record<string, unknown> = { when: new Date().toISOString(), browser: s.browserVersion, site: "synthetic fixture", client: "claude -p (Claude Code)" };
try {
  const cfg = join(tmp, "mcp.json");
  writeFileSync(cfg, JSON.stringify({ mcpServers: { mycp: { type: "http", url: s.bridge.mcpUrl, headers: { Authorization: `Bearer ${s.bridge.token()}` } } } }));
  const order = s.fixture.state.orders.find((o) => o.id === "A-1012")!;

  // ---- 1. read tool ----
  console.log("1/3  read: asking Claude Code to look up order A-1012 …");
  const r1 = await claude("Use the MyCP find_order tool to look up order A-1012. Reply with one line: the customer name and the order status exactly as returned.", ["mcp__mycp__find_order"], cfg);
  record.read = { exit: r1.code, output: r1.stdout.slice(0, 4000), expect: { customer: order.customer, status: order.status } };
  console.log("     →", (JSON.parse(r1.stdout || "{}") as { result?: string }).result ?? r1.stderr.slice(0, 300));

  // ---- 2. write tool, approved by the "user" in the panel ----
  console.log("2/3  write: asking Claude Code to save a DRAFT note (approval is granted in the panel) …");
  const note = "Customer called; will follow up tomorrow.";
  const w = claude(`Use the MyCP draft_customer_note tool to save the draft note "${note}" on order A-1012. Then tell me the status MyCP reported and whether it was verified.`, ["mcp__mycp__draft_customer_note"], cfg);
  await waitForState(s, (st) => !!st.approval, 120_000);
  const shown = await s.panel.getByRole("alertdialog").innerText();
  await s.approve();
  const r2 = await w;
  record.write = { exit: r2.code, approvalSheetText: shown, output: r2.stdout.slice(0, 4000), siteWriteLog: s.fixture.state.writeLog };
  console.log("     approval sheet showed:", shown.replace(/\s+/g, " ").slice(0, 160), "…");
  console.log("     →", (JSON.parse(r2.stdout || "{}") as { result?: string }).result ?? r2.stderr.slice(0, 300));

  // ---- 3. write tool, declined ----
  console.log("3/3  write: the user DECLINES …");
  const before = s.fixture.state.writeLog.length;
  const d = claude(`Use the MyCP draft_customer_note tool to save the draft note "Second note, to be declined." on order A-1013. Report exactly what MyCP said.`, ["mcp__mycp__draft_customer_note"], cfg);
  await waitForState(s, (st) => !!st.approval, 120_000);
  await s.decline();
  const r3 = await d;
  record.declined = { exit: r3.code, output: r3.stdout.slice(0, 4000), writesBefore: before, writesAfter: s.fixture.state.writeLog.length };
  console.log("     →", (JSON.parse(r3.stdout || "{}") as { result?: string }).result ?? r3.stderr.slice(0, 300));
  console.log(`\nSite ground truth: ${s.fixture.state.writeLog.length} draft saved in total (expected 1); the declined one wrote ${s.fixture.state.writeLog.length - before === 0 ? "nothing" : "SOMETHING — investigate"}.`);
} catch (e) {
  record.error = String(e);
  console.error("demo failed:", e);
} finally {
  writeFileSync(join(out, `demo-claude-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`), JSON.stringify(record, null, 2));
  await s.close();
  rmSync(tmp, { recursive: true, force: true });
}
