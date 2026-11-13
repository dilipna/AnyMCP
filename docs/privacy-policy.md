# AnyMCP Extension — Privacy Policy (DRAFT)

> **Draft for the owner to review with a lawyer before publication.** Bracketed items are owner tasks.
> It is written to match what the code does today; if behaviour changes, this must change with it.

**Effective date:** [DATE] · **Publisher:** [OWNER NAME / ORGANISATION] · **Contact:** [PRIVACY CONTACT EMAIL]

## Summary

AnyMCP Extension helps you turn website tasks you approve into tools that **your own AI assistant** can run.
**The developer does not receive your data.** The extension does not send anything to any server operated by
the developer, has no analytics or advertising, and does not load or run remotely hosted code.

## What the extension handles, and where it goes

| Data | Why | Where it goes | Stored? |
|---|---|---|---|
| **Content of web pages on sites you allow** (the values a tool you enabled is defined to read) | To run a tool | Returned over the **local** connection (127.0.0.1) to the **bridge program you run on your computer**, which hands it to the **AI assistant you connected** | **Not stored by default.** Optional setting "Keep results in run history" saves returned values locally on your computer. |
| **What you click and type while you record** a workflow | To build a tool you review | Held in the browser's memory-only session storage until you save or discard | Typed values are **not saved**; only the tool definition you approve is kept (typed examples are used to recognise values and are discarded) |
| **Tool definitions** (steps, site, start address, rules) | So tools can run | Local `chrome.storage` only | Yes, on your computer, until you delete them. A definition contains a value you typed only if you chose to make it a fixed value. The start address keeps only the settings after "?" that you chose to keep; settings that look like sign-in or security values (session ids, tokens, keys) are always removed and their values are never held |
| **Run history** (tool name, status, timing, step log) | To show what happened | Local only | Yes (last 100 runs), without values or page paths unless you opt in. Deletable any time |
| **Allowed-site list, settings, pairing secret** | To enforce your choices and connect to the bridge | Local only | Yes, until you revoke or uninstall |

The extension **does not collect** passwords, payment details, one-time codes or other authentication
information: fields that look like these are ignored when recording and refused when running. Your website
sign-ins stay in the browser; cookies and tokens are never sent to the bridge or the assistant.

## The AI assistant you connect

Values a tool returns are passed to the assistant you connected (for example Claude Code). That assistant may
send them to its provider under **that provider's** policy, which AnyMCP does not control. Only connect
assistants you trust with the data your enabled tools read.

## Remote code

None. AnyMCP does not download, fetch or evaluate code or workflows from any server. Tool definitions are data
created on your computer by you, interpreted by a fixed set of operations inside the extension.

## Permissions

See the justification for each permission in `store/listing.md`. The extension asks for access to **one website
at a time**, only when you click *Allow this site*, and you can remove any site at any time (which disables its tools).

## Your controls

* **Revoke everything** (Settings): turns off all tools, removes all site access, unpairs the bridge and rotates its token.
* **Delete run history** (Settings) and **disable / delete any tool**.
* **Uninstalling** the extension removes its stored data. The bridge keeps a small state folder
  (`~/.anymcp`) that you can delete.

## Children, sale of data, advertising

The extension is not directed at children, does not sell or share data, and does not use data for advertising,
creditworthiness or lending. Use of information received is limited to providing the user-facing feature above
(consistent with the Chrome Web Store User Data Policy, including Limited Use).

## Security

Data on your computer is protected by your operating-system account. The bridge listens on 127.0.0.1 only and
requires a token; the extension and bridge pair with a one-time code. No system is perfectly secure; see the
threat model in the project documentation. [Vulnerability disclosure address: OWNER TO ADD.]

## Changes

[Describe how changes are announced.]
