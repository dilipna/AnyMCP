# Chrome Web Store listing — DRAFT (not submitted, not approved)

> Nothing here has been submitted. Approval is not claimed and does not exist. **Do not submit under the name
> "AnyMCP" before the naming check (`docs/naming-check.md`) is resolved.** Items in [BRACKETS] are owner tasks.

## Item

* **Name:** AnyMCP Extension  *(pending naming clearance)*
* **Summary (≤ 132 chars, equals the manifest `description`):**
  `Turn approved website workflows into reusable AI tools. You review permissions and approve every change.`
* **Category:** Developer Tools
* **Language:** English
* **Visibility:** [OWNER: Unlisted for first submission is recommended]

## Detailed description

> **Turn approved website workflows into reusable AI tools.**
> Teach a workflow, review its permissions, and let your AI assistant run it with verified results.
>
> AnyMCP Extension lets you teach your browser a website task once — like "find an order" — and turn it into a
> tool your own AI assistant can call. You decide what a tool can read and change, test it, and only then
> enable it.
>
> **How it works**
> 1. Run the small AnyMCP bridge on your computer (free, open instructions included).
> 2. Pair it with the extension using a one-time code.
> 3. Open a website you allow, press *Teach*, and do the task once.
> 4. Review a plain-language summary: where it may run, what it reads, what it may change, when it asks for
>    approval, and how success is checked. Test it. Enable it.
> 5. Connect your AI assistant (any MCP client).
>
> **You stay in control**
> * Sites are allowed one at a time, and you can remove any site.
> * Tools that change data ask for your approval **every time**, showing the exact action and values. The
>   approval applies to that one run only and is cancelled if the page changes.
> * A visible indicator and a Stop button are always available while AnyMCP is working.
> * Results say honestly whether the task worked. If AnyMCP can't be sure, it says **"unknown outcome"** and does
>   not repeat the action for you.
> * Password and payment fields are never recorded or read. Your sign-ins never leave your browser.
>
> **What AnyMCP does not do**
> AnyMCP does not work on every website. It handles pages built from standard buttons, links, text fields,
> dropdowns, checkboxes, lists and tables, including web components. It does not support iframes, rich-text
> editors, file uploads or CAPTCHAs and never signs in for you.
> It cannot guarantee that a website will not record a request twice. It has not had an independent security audit.
>
> **Requires** the free AnyMCP bridge program on your computer (Node.js 20+). Your AI app connects to it over
> MCP: over HTTP, or by starting it itself (stdio). The extension does nothing useful without it.
>
> AnyMCP is independent software and is not affiliated with Google or Anthropic.

## Single purpose

"Let the user teach, review and run approved website workflows as tools for their own AI assistant."

## Permission justifications (for the dashboard "Privacy practices" tab)

| Permission | Justification |
|---|---|
| `storage` | Saves the tools you create, your allowed-site list, settings, and run history on your computer. |
| `sidePanel` | The whole interface (tool library, review, approval prompt, run timeline, settings) lives in the side panel. |
| `scripting` | Injects the small content script that performs a tool's steps — **only** into sites you explicitly allowed, and only while a tool runs or you record. |
| `alarms` | Wakes the extension every 30 seconds so it can reconnect to the bridge on your computer after the browser suspends it. |
| Optional host permissions (`http://*/*`, `https://*/*`) | **Not granted at install.** Requested for **one origin at a time** when you click "Allow this site". Needed to read/act on the page of a site you chose. |
| Host permissions | **None.** |
| Remote code | **No.** Tools are data interpreted by a fixed set of operations bundled in the extension. |

**Data usage disclosures (to tick in the dashboard):** *Website content* — handled to provide the feature, passed
only to the local bridge and the user's chosen assistant, not collected by the publisher. *Authentication
information* — not collected. *Personally identifiable information, health, financial, location, web
history, user activity, personal communications* — not collected. Certify: not sold, not used for unrelated
purposes, not used for creditworthiness. [OWNER: confirm each answer in the dashboard.]

**Local companion disclosure.** The extension connects to a program the user runs on the same computer
(`ws://127.0.0.1`). This is stated in the description and the privacy policy.

**Why not `activeTab`/declared content scripts:** declared scripts would need broad host access; per-site
optional permissions keep the surface minimal.

## Assets

| Asset | File | Status |
|---|---|---|
| Icon 128×128 | in the ZIP (`icons/icon-128.png`) | generated, included |
| Screenshots 1280×800 | `store/screenshots/*.png` | generated from the real extension's side-panel page; see `store/screenshots/README.md` |
| Small promo tile 440×280 | `store/screenshots/promo-small-440x280.png` | generated |
| Marquee 1400×560 | — | optional, not produced |
| Privacy policy URL | [OWNER: host `docs/privacy-policy.md` once reviewed] | needed before submission |
| Support / contact | [OWNER] | needed |

## Honest expectations for review

Likely reviewer questions: broad optional host permissions (reviewer may take longer — Google says broad host
patterns slow review; whether *optional* patterns are treated the same is unverified), a localhost companion,
and the "interpreter" rule for remote code (answered: nothing is fetched). Prepare a short test script
(`docs/demo-script.md`) and a screencast.
