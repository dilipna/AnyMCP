# Security policy

AnyMCP is a **developer beta** and has **not had an independent security review**. `docs/threat-model.md` lists what
it defends against and, just as important, what it does not.

## Reporting a vulnerability

**Report privately through GitHub: https://github.com/dilipna/AnyMCP/security/advisories/new** (the repository's
Security tab → "Report a vulnerability"). Only the maintainer can see the report. Please do not open a public issue,
pull request or discussion with vulnerability details.

Include: what you did, what you expected, what happened, and the AnyMCP version (side panel → Settings → About AnyMCP,
or `anymcp-bridge --help`). **Never include your bridge token, pairing secret or pairing code.**

## Supported versions

Only the latest commit on the default branch. There are no releases yet.

## In scope

* The AnyMCP extension and bridge in this repository (HTTP and stdio modes).
* Bypassing a permission boundary: a site the user did not allow, a disabled tool, a tool version that was not
  tested, an approval the user did not give, a stale or forged approval, or reading a password/payment field.
* Reaching the bridge without its token or a paired extension, or from a web page.
* Making AnyMCP repeat a data-changing action, or report a result as verified when it was not.
* Data reaching the AI app that the user's enabled tools were not defined to read.

## Out of scope

* Anything that needs control of the user's OS account or browser profile (it can read the stored secrets in
  Chrome's extension storage and in `~/.anymcp`).
* Prompt injection that only changes what an AI app *says*. AnyMCP marks page text as untrusted and limits what
  tools can do, but cannot control a model.
* What an AI app or its model provider does with results it receives.
* Websites that record duplicate requests when a browser or network re-sends one (documented limitation).

## Response

AnyMCP is maintained by one person on a best-effort basis. There is no guaranteed response or fix time. Reports are
handled in the private advisory, and a fix is published with credit to the reporter unless they ask not to be named.
