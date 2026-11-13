# Known limitations

Prototype limitations, listed plainly. None of these is described as an "urgent defect"; they are the
boundaries of what was built and verified.

## Reliability and side effects

1. **Exactly-once is not possible and not promised.** While building the fixture, a server that reset a reused
   keep-alive connection caused Chromium to **re-send the same POST three times** — with one MyCP click.
   MyCP never replays a click or re-submits a form, and verifies by reading the page, but a site without
   idempotency can still record duplicates caused by the browser or network.
2. **`unknown_outcome` needs a person.** When MyCP cannot confirm a write it says so and stops. It will not
   guess. The tool's precondition ("this draft is not already there") makes a *later, deliberate* retry safe
   for the fixture; other tools must define their own.
3. **Reads interrupted by a service-worker restart are reported as `interrupted`**, not resumed. The assistant
   can retry (reads are safe). Resuming mid-run would need to keep argument values across the restart.
4. **One run at a time.** A second concurrent call is refused with `bridge_busy` (retry-safe).
5. **Slow failure detection.** A missing element is only declared missing after the step timeout (default 5 s).
6. **Approval is not a server-side guarantee.** The binding is checked in the page immediately before the click.

## Compatibility

7. Pages must be built from standard, visible, top-document controls (see supported-capabilities.md).
8. Locators can break when a site is redesigned. MyCP then stops with `locator_missing` / `locator_ambiguous`;
   it never rewrites an enabled tool. Fixing means editing/re-recording → a **new version** that must be tested again.
9. DOM events, not OS input. Some sites ignore untrusted events.
9a. **A dropdown or checkbox may save on change.** Some sites save a setting the moment it changes, with no Save
    button. MyCP cannot detect this by itself. The review screen warns on every dropdown, checkbox and option
    step; the person must mark such a step **"Saves by itself"**, which makes it the tool's one data-changing step
    (approval every run). An unmarked step on such a site would change data without approval.
9c. **Enter key.** Enter in a form that has a submit button is recorded as clicking that button. Elsewhere it is
    recorded as an Enter press, even if the page ignored it (uncheck the step if so). Enter in a multi-line text
    box is never recorded (it means "new line").
9d. **Custom dropdowns** are two clicks (open, then the option). The option can be made an input in review; its
    allowed values are the choices that were visible when you clicked. Choices that load later are not known.
9e. **Single-page apps.** Start checks wait up to one step timeout for the page to draw itself; pages slower than
    that stop with `precondition_failed`. Raise the step timeout in the tool editor for such sites.
9b. **Lists are read in page order and bounded** (`maxItems`). Blank items are skipped. If the site paginates, only
    the current page is read (backlog #17).
10. Branded Chrome 137+ cannot load an unpacked extension from the command line; automated tests there use the
    DevTools protocol (`--enable-unsafe-extension-debugging`). Manual *Load unpacked* is unaffected.

## Product

11. **Side panel opens from the toolbar icon.** Chrome's docked side panel cannot be driven by automation, so
    UI tests render the same panel page in a tab; store screenshots are renders of that page, not captures of
    the docked panel.
12. **Chrome's permission prompt cannot be automated.** Tests use a build with loopback host permissions; the
    real "Allow this site" prompt is on the owner's manual checklist.
13. **No tool import/export or sharing**, no cloud, no accounts, no sync.
14. **English only.**
15. **Windows file permissions** for `~/.mycp/state.json` rely on the user-profile ACL (no `chmod`).

## Evidence

16. **Fixture-only evaluation.** One synthetic site written by the same author as the tool definitions. It is a
    development suite, not a held-out set. Small run counts demonstrate that guards work; they do not estimate
    failure *rates*.
17. **One intermittent test failure was observed** (1 of 2 full runs on real Chrome; `failures.spec`, the
    "identical write whose draft already exists" case) and did not reproduce in 6 further runs of that file.
    Diagnostics were added to the assertion. A related stale-approval-prompt race after a worker restart was
    found and fixed (the panel now drops approvals when the worker connection drops). The root cause of the
    one failure is **not proven**.
18. No security audit, no fuzzing, no load testing, no multi-user testing, no accessibility testing with
    assistive technology (automated axe-core checks only — they find a minority of issues).
19. Only the official SDK client (over HTTP and over stdio) and (see demo) Claude Code were used as MCP clients.
    Claude Desktop, Cursor and other stdio apps were not tested with the real apps.

## Naming and publication

20. The name "MyCP" has public conflicts (see naming-check.md). Nothing here has been published.
