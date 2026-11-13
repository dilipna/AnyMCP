import { describe, expect, it } from "vitest";
import { isTrustedPanelSender } from "../src/shared/sender";

const ID = "abcdefghijklmnopabcdefghijklmnop";

describe("only the extension's own pages may act as the side panel (approve, revoke, save tools...)", () => {
  it("accepts the side panel and our own pages", () => {
    expect(isTrustedPanelSender({ id: ID, url: `chrome-extension://${ID}/sidepanel.html` }, ID)).toBe(true);
    expect(isTrustedPanelSender({ id: ID, url: `chrome-extension://${ID}/sidepanel.html`, tab: { url: `chrome-extension://${ID}/sidepanel.html` } }, ID)).toBe(true);
  });
  it("refuses a content script (it runs in a web page) even though it carries our extension id", () => {
    expect(isTrustedPanelSender({ id: ID, url: "http://127.0.0.1:4173/orders", tab: { url: "http://127.0.0.1:4173/orders" } }, ID)).toBe(false);
    expect(isTrustedPanelSender({ id: ID, url: "https://evil.example/", tab: { url: "https://evil.example/" } }, ID)).toBe(false);
  });
  it("refuses another extension, a missing id, or a missing url", () => {
    expect(isTrustedPanelSender({ id: "otherotherotherotherotherotherothe", url: `chrome-extension://${ID}/x.html` }, ID)).toBe(false);
    expect(isTrustedPanelSender({ url: `chrome-extension://${ID}/x.html` }, ID)).toBe(false);
    expect(isTrustedPanelSender({ id: ID }, ID)).toBe(false);
  });
  it("refuses a lookalike extension url", () => {
    expect(isTrustedPanelSender({ id: ID, url: `chrome-extension://${ID}evil/x.html` }, ID)).toBe(false);
  });
});
