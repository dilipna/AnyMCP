# Supported capabilities (precise list)

AnyMCP does **not** claim to work on every website. This is what is implemented and tested, and what is not.

## Tested

* **Where:** `http://127.0.0.1:<port>` — the synthetic *Acme Support Portal* fixture (this repository).
* **Browsers:** Playwright Chromium 158 and branded Google Chrome 157.0.8103.52 on Windows 11, via the DevTools
  protocol (Chrome 137+ ignores `--load-extension`; manual "Load unpacked" works).
* **MCP clients:** the official TypeScript SDK client over HTTP (tests/evaluation) and over **stdio**
  (`anymcp-bridge --stdio`, spawned as a separate process); Claude Code 2.1.207 — see
  [demo-script.md](demo-script.md) for what was and was not exercised. Claude Desktop and Cursor were **not** tested.
* **External sites:** read-only checks recorded in [public-site-report.md](public-site-report.md). Nothing else.

## What a tool can do

| capability | supported |
|---|---|
| Find an element | by role + accessible name, form label, `data-testid`, a label/value pair (`th`/`td`, `dt`/`dd`), exact/partial text, or (last resort, flagged fragile) a CSS selector; optionally inside one named container. Must match exactly one **visible** element. Searches inside **shadow DOM** (open roots, and closed roots of custom elements via `chrome.dom.openOrClosedShadowRoot`), including text passed through `<slot>`. |
| Fill | text `<input>` and `<textarea>` (sets the value, fires `input`/`change`, verifies it stuck); **`<select>`** (by the visible option text, falling back to the option value; refuses duplicate names, disabled options and multi-selects); **checkbox / switch / radio**, native or ARIA (`true`/`false`; sets the *state*: already correct is a no-op, never a blind toggle; verifies the state changed); **rich text boxes** (`contenteditable`): the text is offered to the site's editor first (a `beforeinput` event, which editors that keep their own model apply themselves), otherwise inserted with the browser's own editing command; replaced as plain text and verified by reading the box back |
| Click | `<button>`, `<a href>`, `<summary>`, `input[type=submit/button]`, role button/link/tab/option/menuitem, custom dropdown openers (`role=combobox`, `aria-haspopup`); same-origin only. A clicked item can be made an **input** ("which result/choice to click"); for options, its allowed values are the neighbouring choices |
| Press Enter | in a text box; does what the browser would (default button / one-field form submit) unless the page cancels the key; for search boxes in web apps that have no button |
| Changes that save by themselves | a dropdown, checkbox, switch, option or text field can be marked "saves by itself": it becomes the tool's one data-changing step, with approval every run; if it already has the requested value nothing is done (`no_change_needed`) |
| Wait | for an element to appear / disappear / have text / the URL path to match; also watches site-declared empty / error / expired states. Every reading also waits, up to the per-step timeout (default 5 s, editable), for what it reads, so content drawn after the page loads is read once it is there |
| Extract | one element's text (string or number), a **list** (the text of every match, in page order, up to a bound, e.g. search results), a table (named columns), or a count |
| Assert | exists / absent / text equals / text contains / count / URL path |
| Inputs | string (length, pattern, enum: a recorded dropdown becomes an enum of its choices), integer, number, boolean (a recorded checkbox) |
| Outputs | the same, plus arrays of strings/numbers (lists) and arrays of objects (tables) |
| Navigation | within the tool's origin, via link clicks (including single-page apps that change the address without reloading); start checks wait for pages that draw themselves after loading; the tool starts at a declared path **plus an optional query string** (each key is kept, turned into an input, or dropped; keys that look like credentials, such as `sid`, `token`, `api_key`, are refused by policy and their values are never held) |
| Writes | exactly one consequential click per tool, with per-run approval and read-back verification |
| Recording | clicks, text input, dropdown choices and checkbox/radio state on the approved site, including controls inside open shadow roots; picking a value, a **list** (click one item and AnyMCP finds the others like it, showing the match count before you save), a table, or a success message; no passwords etc. A picked value is never found by its own text (on another page that text differs); one that only a CSS selector can find is anchored to its nearest container with an id or a stable class, so the same style elsewhere on other pages (a "you may also like" strip) does not make it ambiguous. A list of items with no class names is narrowed by an attribute of the clicked item only when that removes exactly the items built differently from it; if items that look different remain, the recording screen and the review say how many |

## Not supported (will not work, or is refused)

* **iframes**, **popups / new windows**, **file uploads/downloads**, **drag-and-drop**, **canvas/WebGL-only UIs**,
  **rich-text formatting** (bold, lists, links: text goes in as plain text), editors that only accept trusted
  (real) key events, **multi-select lists**, **hover-only menus**, **date/colour/range pickers**.
* **Recording inside CLOSED shadow roots is not verified.** Replay finds elements there, but whether the recorder sees
  typed text inside a closed root depends on how the component forwards events. Open roots are tested end to end.
* **Custom (non-native) dropdowns** are recorded as two clicks (open, then the option). The option can be made an
  input in review; choices that load later (search-as-you-type lists) are not known in advance.
* **CAPTCHAs, MFA prompts, sign-in.** AnyMCP never signs in for you and never handles passwords or payment fields.
* **Sites that require OS-level (trusted) input events.** AnyMCP dispatches DOM events (`isTrusted` is false).
* **Multiple tabs / multi-site workflows**, **wildcard origins**, **non-HTTP(S)** pages, **incognito** (extensions are off by default there).
* **Branching, loops, scripting.** By design.
* **Purchases, payments, deleting accounts, sending messages.** Out of scope for this release. The only write
  exercised is saving a *draft* note in the fixture.
* **Importing tools** from the assistant, the bridge or the web. Tools are created only by recording/review in the browser.
* **AI-drafted tools.** The extension point exists conceptually (a draft would still have to pass the same
  schema and policy checks and the same human review), but no model is called and nothing is implemented.

## Accessible-name differences from the ARIA spec

AnyMCP computes a simplified accessible name: `aria-labelledby`, `aria-label`, associated `<label>`, `placeholder`
(inputs only), `alt`, then visible text for roles whose name comes from content. It also treats `alert` and
`status` text as their name (ARIA does not), treats the root of a rich text box (`contenteditable`) as a `textbox`
even without a role, and uses its `aria-placeholder` / `data-placeholder` as a name. A locator that works in AnyMCP
may not match another tool's idea of the same role/name.
