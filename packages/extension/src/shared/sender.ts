// Who may talk to the service worker as "the side panel". Only a page served by THIS extension.
// A content script runs inside a web page: its sender.url is the web page and sender.tab is set, so it is refused.
// This is what stops a hostile web page (or anything running in one) from approving an action.

export interface SenderLike {
  id?: string;
  url?: string;
  tab?: { url?: string } | undefined;
  frameId?: number;
}

export function isTrustedPanelSender(sender: SenderLike, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  if (!sender.url?.startsWith(`chrome-extension://${extensionId}/`)) return false;
  // our own pages opened as a TAB (e.g. in tests) have a chrome-extension:// tab url; a web page never does
  return !sender.tab?.url || sender.tab.url.startsWith(`chrome-extension://${extensionId}/`);
}
