// Rich text boxes (contenteditable), for real:
//  - an editor that keeps its OWN model and ignores direct DOM edits (as ProseMirror/Lexical/Draft.js do): AnyMCP's
//    fill must reach the model, which the page proves by updating its preview from the model;
//  - a chat box where Enter SENDS: recorded as a data-changing step, so replay needs an approval, and the server log
//    shows exactly one message.

import { expect, test, type Page } from "@playwright/test";
import type { ResultEnvelope } from "anymcp-protocol";
import { buildDraft, type DraftSpec } from "../packages/extension/src/shared/draft";
import type { TabCandidate } from "../packages/extension/src/shared/panel-api";
import { startStack, waitForState, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack({ tools: [] });
});
test.afterAll(async () => {
  await s?.close();
});

async function openTab(path: string): Promise<{ page: Page; tabId: number }> {
  const page = await s.context.newPage();
  await page.goto(`${s.fixture.origin}${path}`);
  const r = await s.call<TabCandidate[]>({ type: "tabs.candidates" });
  const tab = (r.ok ? (r.data ?? []) : []).find((t) => t.url === page.url());
  if (!tab) throw new Error("tab not found among candidates");
  return { page, tabId: tab.tabId };
}

async function pick(page: Page, mode: "text" | "success", selector: string, outputs: number, signals: number) {
  await s.call({ type: "record.pick", mode });
  await waitForState(s, (x) => x.recording?.pick === mode);
  await page.locator(selector).first().click();
  await waitForState(s, (x) => (x.recording?.outputs.length ?? 0) === outputs && (x.recording?.signals.length ?? 0) === signals);
}

test("an editor with its own model: typing is recorded, and replay reaches the model (not just the screen)", async () => {
  const { page, tabId } = await openTab("/compose");
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });

  await page.getByRole("textbox", { name: "Reply" }).click();
  await page.keyboard.type("Thanks for waiting");
  await expect(page.getByTestId("reply-preview")).toHaveText("Thanks for waiting");
  await page.keyboard.press("Tab"); // leaving the box records what was typed

  const rec = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 1);
  expect(rec.recording!.steps[0]).toMatchObject({ kind: "input", label: "Reply", example: "Thanks for waiting", locator: { by: "role", role: "textbox", name: "Reply" } });

  await pick(page, "text", '[data-testid="reply-preview"]', 1, 0);
  await pick(page, "success", "h2:text-is('Reply')", 1, 1);
  await s.call({ type: "record.stop" });

  const spec = ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  await s.call({ type: "record.discard" });
  spec.id = "preview_reply";
  spec.title = "Preview a reply";
  spec.description = "Types a reply into the synthetic inbox editor and returns the preview the page shows. Read-only.";
  spec.outputs[0]!.name = "preview";
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  expect(def.kind).toBe("read");
  expect(JSON.stringify(def)).not.toContain("Thanks for waiting");
  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);

  const text = "Your refund is on its way";
  const r = ((await s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: { reply: text } })) as { data: { envelope: ResultEnvelope } }).data.envelope;
  expect(r.status, r.message).toBe("success");
  // the preview is rendered from the editor's model: it only matches if the model received the text
  expect(r.output).toEqual({ preview: text });
  await page.close();
});

test("Enter in a chat box is treated as sending: approval every run, declined writes nothing, approved writes once", async () => {
  await s.chaos({ reset: true });
  const { page, tabId } = await openTab("/compose");
  expect((await s.call({ type: "record.start", tabId })).ok).toBe(true);
  await page.locator("[data-anymcp-banner]").waitFor({ state: "attached" });

  await page.locator("#chat").click(); // (Playwright follows ARIA: a role-less contenteditable is not a "textbox" there)
  await page.keyboard.type("Deploy done");
  await page.keyboard.press("Enter"); // the page SENDS it (a real message in the server log)
  await expect(page.getByRole("status")).toHaveText("Sent to #support");

  const rec = await waitForState(s, (x) => (x.recording?.steps.length ?? 0) >= 2);
  expect(rec.recording!.steps.map((x) => `${x.kind}:${x.label}:${x.effect ?? ""}`)).toEqual(["input:Message #support:", "press:Message #support:commit"]);
  // the page cleared the box after sending: that is not recorded as something the person did
  expect(rec.recording!.steps).toHaveLength(2);

  await pick(page, "text", '[data-testid="channel"]', 1, 0);
  await pick(page, "text", "#chat-status", 2, 0);
  await pick(page, "success", "#chat-status", 2, 1);
  await s.call({ type: "record.stop" });
  const spec = ((await s.call<DraftSpec>({ type: "record.spec" })) as { data: DraftSpec }).data;
  await s.call({ type: "record.discard" });

  spec.id = "post_to_support_chat";
  spec.title = "Post to the support chat";
  spec.description = "Posts one message to the synthetic #support chat. Asks for approval every time.";
  spec.outputs[0] = { ...spec.outputs[0]!, name: "channel", use: "approval", approvalLabel: "Channel" };
  spec.outputs[1]!.name = "confirmation";
  spec.approvalText = "Post “{message_support}” to the support chat";
  const built = buildDraft(spec, 1);
  expect(built.errors).toEqual([]);
  const def = built.definition!;
  expect(def.kind).toBe("write");
  expect(def.steps.find((x) => x.op === "press")).toMatchObject({ key: "Enter", effect: "commit" });

  await s.chaos({ reset: true }); // forget the message the person sent while recording
  expect((await s.call({ type: "tool.save", definition: def, source: "recorded" })).ok).toBe(true);

  const run = async (message: string, decide: "approve" | "decline") => {
    const p = s.call<{ envelope: ResultEnvelope }>({ type: "tool.test", id: def.id, version: 1, args: { message_support: message } });
    const asked = await waitForState(s, (x) => !!x.approval);
    expect(asked.approval!.actionText).toBe(`Post “${message}” to the support chat`);
    expect(asked.approval!.state).toEqual([{ id: "channel", label: "Channel", value: "#support" }]);
    expect(s.fixture.state.chatLog).toHaveLength(0); // nothing is sent before the decision
    if (decide === "approve") await s.approve();
    else await s.decline();
    return ((await p) as { data: { envelope: ResultEnvelope } }).data.envelope;
  };

  const declined = await run("Not this one", "decline");
  expect(declined.status).toBe("rejected");
  expect(s.fixture.state.chatLog).toHaveLength(0);

  const sent = await run("Release 2 is live", "approve");
  expect(sent.status, sent.message).toBe("success");
  expect(sent.output).toEqual({ confirmation: "Sent to #support" });
  expect(s.fixture.state.chatLog.map((m) => m.text)).toEqual(["Release 2 is live"]);
  await page.close();
});
