# AnyMCP — Privacy Policy (DRAFT)

> **Draft, not legal advice.** It is written from what the code does today and must change if the code changes.
> Bracketed items are for the owner to complete. Have it reviewed before publishing it.

**Effective date:** [DATE] · **Publisher:** dilipna (GitHub) · **Contact:** [PRIVACY CONTACT — to be added]

## Summary

AnyMCP is a Chrome extension plus a small program (the "bridge") that runs on your computer. Together they let an AI
app you choose (an MCP client) run website tasks you taught and approved.

* **The AnyMCP developer receives none of your data.** Neither the extension nor the bridge sends anything to a
  server run by the developer. There is no analytics, telemetry or advertising, and no remotely hosted code.
* **Data does leave your computer through the AI app you connect.** When your AI app calls an AnyMCP tool, the values
  the tool reads from the web page are given to that app, and AI apps normally send them to their model provider.
  That part is governed by your AI app's and its provider's policies, not by this one.

## Where data goes, step by step

| Step | What | Where it goes | Stored? |
|---|---|---|---|
| **1. In your browser** (extension) | The page content of sites **you allowed**, read only while a tool runs or while you record. Your normal sign-ins and cookies are used by the browser as on any visit. | Nowhere by itself. | Tool definitions, allowed sites, settings and run history are kept in Chrome's local extension storage on your computer. |
| **2. Extension → bridge** (your computer only) | Tool manifests (name, description, input and output format: no steps, no page content) and, for each run, its result: status, the values read, and the page's origin and path. | A WebSocket to `127.0.0.1`, authenticated with a secret set up by pairing. | The bridge keeps run records **without the values read** (`~/.anymcp/state.json`, which also holds the pairing secret and the client token). While no browser is paired it also keeps the current one-time pairing code in `~/.anymcp/pairing.json`. |
| **3. Bridge → your AI app** (MCP client) | The list of tools you enabled, and each run's result, including the values read from the page and, for link results, the link addresses (with session or token parameters removed). | Your AI app, over `127.0.0.1` (HTTP with a token) or through a program the app starts (stdio). | Not by AnyMCP. Your AI app may keep it in its conversation history. |
| **4. Your AI app → its model provider** | Whatever your AI app sends, usually including tool results. | Decided by your AI app (for example, Claude Code sends conversations to Anthropic). | Under that provider's policy. AnyMCP cannot see or control this. |
| **Websites** | Ordinary page requests from your browser. | The website you allowed. | The website may log visits as usual. |

**Never collected or forwarded:** passwords, payment-card details, one-time codes and similar fields (ignored when
recording, refused when running), fields a site marks private (`data-anymcp-ignore`), and your cookies or tokens
(they stay in the browser; they are never sent to the bridge or the AI app).

## Recording a task

While you record, your clicks and what you type on the allowed site are held in Chrome's **memory-only** session
storage so you can review them. Typed values are used only to recognise them in the recording; they are not saved
unless you deliberately make one a fixed value in the tool. Start-page settings that look like sign-in or security
values (session ids, tokens, keys) are always removed and never held. Closing the browser clears unsaved recordings.

## Run history and diagnostics

Run history (tool, status, timing, step-by-step log) is kept on your computer **without** the values read and without
page paths, unless you turn on **Keep results in run history** (off by default). Optional developer diagnostics (off
by default) keep a short outline of control names on a failed page, with numbers masked and no field values. You can
delete history at any time in Settings.

## Permissions

The extension asks Chrome for access to **one website at a time**, when you enter its address under **Allow a
website** and confirm Chrome's prompt. It has no website access at install. Each permission is explained in
`store/listing.md`.

## Your controls

* **Remove a site** (Settings → Allowed sites): its tools are disabled at once.
* **Disconnect the AI client** (Settings): replaces the bridge's client token. Apps that start AnyMCP themselves
  (stdio) are disconnected by removing AnyMCP from that app's settings.
* **Revoke all access** (Settings): all tools off, all sites removed, bridge unpaired, token replaced.
* **Delete run history**, **disable or delete any tool**.
* **Uninstall:** removing the extension deletes its stored data. Delete the `~/.anymcp` folder to remove the bridge's.

## Children, sale of data, advertising

AnyMCP is not directed at children. The developer does not sell, share or use your data for advertising,
creditworthiness or lending; use of data is limited to providing the feature described above (Chrome Web Store User
Data Policy, including Limited Use).

## Security

Data on your computer is protected by your operating-system account; anything that can read your browser profile or
`~/.anymcp` can read the stored secrets. The bridge listens on 127.0.0.1 only and requires a token or a paired
extension. AnyMCP has not had an independent security review; see `docs/threat-model.md`. Report vulnerabilities as
described in `SECURITY.md`.

## Changes

[Describe how changes to this policy are announced, for example in the repository's release notes.]
