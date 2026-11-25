# Known limitations

Prototype limitations, listed plainly. None of these is described as an "urgent defect"; they are the
boundaries of what was built and verified.

## Reliability and side effects

1. **Exactly-once is not possible and not promised.** While building the fixture, a server that reset a reused
   keep-alive connection caused Chromium to **re-send the same POST three times** — with one AnyMCP click.
   AnyMCP never replays a click or re-submits a form, and verifies by reading the page, but a site without
   idempotency can still record duplicates caused by the browser or network.
2. **`unknown_outcome` needs a person.** When AnyMCP cannot confirm a write it says so and stops. It will not
   guess. The tool's precondition ("this draft is not already there") makes a *later, deliberate* retry safe
   for the fixture; other tools must define their own.
3. **Reads interrupted by a service-worker restart are reported as `interrupted`**, not resumed. The assistant
   can retry (reads are safe). Resuming mid-run would need to keep argument values across the restart.
4. **One run at a time.** A second concurrent call is refused with `bridge_busy` (retry-safe).
5. **Slow failure detection.** A missing element, value, list or table is only declared missing after the step
   timeout (default 5 s), and a read tool tries twice, so a page that really lacks it takes about 10 s to stop.
6. **Approval is not a server-side guarantee.** The binding is checked in the page immediately before the click.

## Compatibility

7. Pages must be built from standard, visible, top-document controls (see supported-capabilities.md).
8. Locators can break when a site is redesigned. AnyMCP then stops with `locator_missing` / `locator_ambiguous`;
   it never rewrites an enabled tool. Fixing means editing/re-recording → a **new version** that must be tested again.
9. DOM events, not OS input. Some sites ignore untrusted events.
10. **A dropdown or checkbox may save on change.** Some sites save a setting the moment it changes, with no Save
    button. AnyMCP cannot detect this by itself. The review screen warns on every dropdown, checkbox and option
    step; the person must mark such a step **"Saves by itself"**, which makes it the tool's one data-changing step
    (approval every run). An unmarked step on such a site would change data without approval.
11. **Enter key.** Enter in a form that has a submit button is recorded as clicking that button. Elsewhere it is
    recorded as an Enter press, even if the page ignored it (uncheck the step if so). Enter in a `<textarea>` is
    never recorded (it means "new line"); in a rich text box it is, as changing data (see 19).
12. **Custom dropdowns** are two clicks (open, then the option). The option can be made an input in review; its
    allowed values are the choices that were visible when you clicked. Choices that load later are not known.
13. **Pages that draw content late** (single-page apps, timers, late requests). Start checks, the success check and
    each reading wait up to one step timeout (default 5 s) for what they need; pages slower than that stop with
    `precondition_failed` and return nothing. Raise **Per-step timeout** in the tool editor for such sites (a new
    version, tested before use; checked on a page drawn 10 s after loading). Tools recorded before 2026-11-23 keep a
    fixed 5-second wait for their success check, so a success check that itself appears late needs re-recording.
    Reading stops waiting as soon as what it reads is there: a list that a page draws a few items at a time can be
    read before it is complete. Marking a success check that appears only when the page has finished avoids that.
14. **Lists are read in page order and bounded** (`maxItems`). Blank items are skipped. If the site paginates, only
    the current page is read (backlog #17). Tables, too, are read from the current page only; there is no "next page"
    loop (by design: tools have no loops).
15. Branded Chrome 137+ cannot load an unpacked extension from the command line; automated tests there use the
    DevTools protocol (`--enable-unsafe-extension-debugging`). Manual *Load unpacked* is unaffected.
16. **Many real sites offer no semantic handles.** On all eleven public practice pages tested (five sites), the recorder had to use CSS
    selectors for the results (flagged "may break if the site changes"). Such tools stop when the markup changes.
17. **Some sites refuse automated browsing.** Wikipedia answered HTTP 429 and its robots.txt disallows `/w/`. AnyMCP
    runs in your browser but in a tab it opens itself; respect each site's terms and robots rules.
18. **Link addresses are returned as found** on the page (absolute, http/https only), with user info and
    credential-looking query parameters (session ids, tokens, keys) removed. Other tracking parameters are kept.
19. **Rich text boxes.** Text is entered as plain text (no formatting) and replaces what was there. AnyMCP offers it to
    the site's editor first (`beforeinput`); an editor that ignores that event, accepts only real (trusted) key events,
    or handles the event without cancelling it (which could insert the text twice) is not supported. Enter in a rich
    text box is recorded as **changing data** (it often sends a message), so it needs approval until you mark it as
    "Searches or moves on".

## Product

20. **Side panel opens from the toolbar icon.** Chrome's docked side panel cannot be driven by automation, so
    UI tests render the same panel page in a tab; store screenshots are renders of that page, not captures of
    the docked panel.
21. **Chrome's permission prompt cannot be automated.** Tests use a build with loopback host permissions; the
    real "Allow this site" prompt is on the owner's manual checklist.
22. **No tool import/export or sharing**, no cloud, no accounts, no sync.
23. **English only.**
24. **Windows file permissions** for `~/.anymcp/state.json` rely on the user-profile ACL (no `chmod`).

## Evidence

25. **Fixture-only evaluation.** One synthetic site written by the same author as the tool definitions. It is a
    development suite, not a held-out set. Small run counts demonstrate that guards work; they do not estimate
    failure *rates*.
26. **One intermittent test failure was observed** (1 of 2 full runs on real Chrome; `failures.spec`, the
    "identical write whose draft already exists" case) and did not reproduce in 6 further runs of that file.
    Diagnostics were added to the assertion. A related stale-approval-prompt race after a worker restart was
    found and fixed (the panel now drops approvals when the worker connection drops). The root cause of the
    one failure is **not proven**.
27. No security audit or penetration test (in-house property-based fuzzing only; see `docs/threat-model.md`), no
    load testing, no multi-user testing, no accessibility testing with assistive technology (automated axe-core
    checks only — they find a minority of issues).
28. Only the official SDK client (over HTTP and over stdio) and (see demo) Claude Code were used as MCP clients.
    Claude Desktop, Cursor and other stdio apps were not tested with the real apps.

## Naming and publication

29. The name "AnyMCP" has a live conflict: an unrelated npm package `anymcp` does something similar. The owner kept
    the name; the bridge package is `@dilipna/anymcp-bridge` (see naming-check.md). It is attached to each GitHub release
    and **not published to the npm registry**, so `npx @dilipna/anymcp-bridge` does not work: install it from its
    release address (`npx --package=<address> anymcp-bridge`, or `npm install -g <address>`). Started through npx,
    it may need a connection to GitHub each time (whether npm's cache alone is enough offline was not tested); an
    installed copy (`npm install -g`) does not.

## Recording

30. **"Find the others like it" is a guess; check the count before saving.** When the items have no class names or
    test ids, the recorder falls back to a tag pattern and can take in neighbouring elements that share the tag (on a
    table used for layout: rows of tags, side cells). It narrows the pattern only when an attribute of the clicked
    item removes exactly the items built differently from it (checked on quotes.toscrape.com/tableful and a synthetic
    copy). Otherwise the list may still hold extra items. Then the recording screen says how many of the matched items
    look different from the one clicked, and the review shows a warning before saving. It compares how items are built
    (their child elements), so it also warns about genuine items that differ, for example one with a "new" badge.
    A tool saved despite the warning can return the extra items as results.
