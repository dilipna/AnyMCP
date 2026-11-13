# Security policy (TEMPLATE — owner must complete before any public release)

AnyMCP has **not had an independent security review**. See `docs/threat-model.md` for what it defends against and,
just as important, what it does not.

## Reporting a vulnerability

**[OWNER: add a monitored private contact — an email address or a private advisory link. None exists yet.]**

Please do not file public issues for vulnerabilities. Include: what you did, what you expected, what happened,
and the AnyMCP version (side panel → Settings → About). **Never include your bridge token** or pairing secret.

## What is in scope

* The AnyMCP Extension and the bridge in this repository.
* Bypassing a permission boundary: an origin the user did not allow, a disabled tool, an approval the user did
  not give, a stale/forged approval, or reading a password/payment field.
* Reaching the bridge without its token or without a paired extension.
* A result reported as verified/successful when it was not.

## What is out of scope

* Anything that needs control of the user's OS account or browser profile (it can read the stored secrets).
* Prompt injection that merely changes what an AI assistant *says* (AnyMCP labels page text as untrusted data and
  limits what tools can do, but cannot control a model).
* Websites that record duplicate requests when a browser or network re-sends one (documented limitation).

## Response commitments

**[OWNER: state what you can honestly promise — e.g. acknowledgement within N days.]**
