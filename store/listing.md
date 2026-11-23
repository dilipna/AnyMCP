# Chrome Web Store listing — DRAFT (not submitted, not approved)

> Nothing here has been submitted, and no approval exists. The owner decided to keep the name "AnyMCP" although an
> unrelated npm package called `anymcp` exists (`docs/naming-check.md`). Items in [BRACKETS] are owner tasks.

## Item

* **Name:** AnyMCP Extension (the manifest name)
* **Summary (≤ 132 characters, equals the manifest `description`, 111 characters):**
  `Teach a website task once, review it, and let your AI app run it as an MCP tool. Needs the local AnyMCP bridge.`
* **Category:** Developer Tools
* **Language:** English
* **Visibility:** [OWNER: Unlisted for the first submission is recommended]

## Detailed description

> **Teach a website task once, review it, and let your AI app run it as an MCP tool.**
>
> AnyMCP is for developers who use AI apps that support the Model Context Protocol (MCP), such as Claude Code. You
> show the extension a task on a website you choose, for example "list the books in a category", review exactly
> what the resulting tool may read and change, test it, and enable it. Your AI app can then call it and gets a
> structured result that says whether the task really worked.
>
> **Requires the AnyMCP bridge**, a small free program you run on your computer (Node.js 20.19 or newer). The bridge
> is the MCP server your AI app connects to; the extension does nothing useful without it. Setup is manual: start the
> bridge with one command from the project's GitHub releases page, pair it with a one-time code, and add it to your AI
> app's settings.
>
> **How it works**
> 1. Start the bridge and pair it with the extension.
> 2. Allow one website: enter its address and confirm Chrome's prompt.
> 3. Open the site, press Teach, and do the task once. Pick what to return (a value, a list, a table).
> 4. Review a summary generated from what AnyMCP enforces: where it runs, what it reads, what it may change, when it
>    asks for approval, how success is checked. Test it, then enable it.
> 5. Ask your AI app to use it. Every run is listed with what happened.
>
> **You stay in control**
> * Sites are allowed one at a time; removing a site disables its tools at once.
> * Tools that change data ask for your approval in the browser **every time**, showing the exact action and values.
> * A visible banner and a Stop button are shown while AnyMCP works.
> * If AnyMCP cannot confirm a result it says so ("unknown outcome") and never repeats an action by itself.
> * Password and payment fields are never recorded, read or filled. Your sign-ins stay in your browser.
>
> **Good to know**
> * AnyMCP calls no AI model and has no account. Results go to the AI app you connect, which may send them to its
>   model provider under its own policy.
> * It does not work on every website. It handles standard pages: buttons, links, text boxes, dropdowns, checkboxes,
>   rich text boxes (as plain text), lists and tables, including pages drawn by JavaScript and web components. It does
>   not support iframes, file uploads, CAPTCHAs or sign-in. If a site changes, a tool stops instead of guessing.
> * Developer beta: not audited, not production software.
>
> AnyMCP is independent, open-source software (MIT) and is not affiliated with Google or Anthropic.

## Single purpose

"Let the user teach, review and run approved website tasks as tools for their own MCP-compatible AI app."

## Permission justifications (dashboard "Privacy practices" tab)

| Permission | Justification |
|---|---|
| `storage` | Saves the tools you create, your allowed-site list, settings, the bridge pairing and run history on your computer. |
| `sidePanel` | The whole interface (tools, teaching, review, approval prompt, run history, settings) is the side panel. |
| `scripting` | Injects the content script that performs a tool's steps or records a task, only into a site you allowed and only while a tool runs or you record. No content script is declared for all sites. |
| `alarms` | Wakes the extension every 30 seconds so it can reconnect to the bridge on your computer after Chrome suspends it. |
| Optional host permissions `http://*/*`, `https://*/*` | **None granted at install.** Requested for **one exact site at a time** when the user enters its address under "Allow a website" and confirms Chrome's prompt. Needed to read and act on pages of the site the user chose. |
| Host permissions (required) | **None.** |
| Remote code | **No.** Tools are data created by the user and interpreted by a fixed set of seven operations bundled in the extension. Nothing is downloaded. |

**Data usage (dashboard):** *Website content*: handled only on sites the user allowed, to provide the feature; passed
to the bridge on the same computer and to the AI app the user connected; not collected by the publisher. *Web
history*: not collected (the extension cannot see the addresses of tabs on sites the user did not allow).
*Authentication information, personally identifiable information, health, financial, location, personal
communications, user activity*: not collected. Not sold, not used for unrelated purposes, not used for
creditworthiness. [OWNER: confirm each answer in the dashboard.]

**In-product disclosure and consent** (Disclosure Requirements policy). Before the user connects an AI app (the
Connect step on first run, and Settings) the side panel states what that app will receive (the enabled tools and each
run's values read from the page), that the app may pass them to its model provider, and that nothing reaches the
developer, with a link to the privacy policy. Next to each tool's Enable button it says the same for that tool; enabling
is the user's affirmative choice, per tool. Site access is requested per site through Chrome's own prompt. Both
notices are checked by `e2e/ui-journey.spec.ts`.

**Limited Use.** The privacy policy carries the affirmative Limited Use statement (section "Children, sale of data,
advertising"); tick the Limited Use certification in the dashboard's Privacy practices tab.

**Local companion.** The extension connects to a program the user runs on the same computer (`ws://127.0.0.1`).
Stated in the description and in the privacy policy.

**Why no `tabs` or `activeTab`:** neither is needed. The user names the site to allow, and Chrome then reveals the
addresses of that site's tabs only. This keeps the extension unable to see browsing history.

## Assets

| Asset | Status |
|---|---|
| Icon 128×128 | in the ZIP (`icons/icon-128.png`), generated by the build |
| Screenshots 1280×800 | 5 images, `store/screenshots/01-…05-*.png`: renders of the real extension's side-panel page with synthetic data, each labelled as a render (`scripts/store-assets.ts`). Real screenshots of the docked panel in a Chrome window are still recommended (automation cannot capture it; shot list in `docs/quick-start.md`) |
| Small promo tile 440×280 | `store/screenshots/promo-small-440x280.png` |
| Privacy policy URL | https://dilipna.github.io/AnyMCP/privacy-policy (GitHub Pages from `docs/privacy-policy.md`; not reviewed by a lawyer) |
| Homepage URL | https://github.com/dilipna/AnyMCP |
| Support URL | https://github.com/dilipna/AnyMCP/issues (security reports: private form linked from `SECURITY.md`) |
| Developer contact email | Set and verified in the developer account, not here. Google requires a verified contact email before publishing |
| Upload | `release/anymcp-extension-<version>.zip` from `npm run package` (includes LICENSE and third-party notices) |

## Likely reviewer questions

Broad *optional* host patterns (requested per site at runtime), the localhost companion program, and the remote-code
rule (answered: nothing is fetched or evaluated). Prepare `docs/demo-script.md` (public-site variant) and a short
screencast.
