# Three-minute demonstration

Audience: someone who has never seen AnyMCP. Everything uses the **synthetic** Acme Support Portal. Say so out loud.

## Setup (before the audience arrives)

```bash
npm ci && npm run build
npm run dev            # builds the extension, starts the fixture site (4173) and the bridge; prints a pairing code
```
In Chrome: `chrome://extensions` → Developer mode → *Load unpacked* → `packages/extension/dist/prod`.
Open `http://127.0.0.1:4173/orders` in a tab and open the AnyMCP side panel (toolbar icon).
Have an MCP client ready: `claude mcp add --transport http anymcp http://127.0.0.1:47820/mcp --header "Authorization: Bearer <token>"`.

## 0:00 — The idea (20 s)

"AnyMCP turns a website task I approve into a tool my AI assistant can call. The point isn't that it can click —
it's that I review what it's allowed to do, and it tells me honestly whether it worked."

## 0:20 — Connect (20 s)

Side panel → type the pairing code → **Bridge connected**; the **Getting started** checklist ticks step 1. "Two separate links: the assistant talks to a local bridge,
the bridge talks to this extension, and everything stays on this computer."

## 0:40 — Teach a workflow (45 s)

*Teach* → **Allow a website** → `http://127.0.0.1:4173` → **Allow this site** (Chrome's own prompt; Chrome only
lets AnyMCP see a tab's address once its site is allowed) → the portal tab appears → **Start recording**.
In the page: click *Order ID*, type `A-1012`, click *Search*, click the order link.
Panel: **Pick a value** on the *status*, **Pick a value** on the *customer*, **Mark a message** on the order id.
**Stop recording → Review the tool.**
Say: "Everything I typed became an input, so no typed value is saved."

## 1:25 — Review, test, enable (40 s)

Show the **At a glance** grid: *runs only on* the portal, *reads* 2 values, *may change* "Fills in fields only", *approval* not needed.
Open **How success is verified**: "It must see the order id on the page equal to the one asked for — a click isn't proof."
Name it, **Save**, open it, **Run test** with `A-1013`. Point at the verified result. **Enable for my AI assistant.**

## 2:05 — The assistant uses it (25 s)

In the MCP client: "Look up order A-1013 with AnyMCP." Show the structured result: status `success`, source, capture
time, execution id. In the panel: **Runs** → the timeline.

## 2:30 — The part that matters: a change needs me (30 s)

Ask: "Save a draft note on order A-1012: *Called the customer*." The **approval sheet** appears in the panel:
exact action, the customer and status read from the page, "this one run only".
1. Change the order status in the page (DevTools console, or run the fixture control call) → the prompt **withdraws itself**.
2. Ask again and **Decline** → the assistant is told `rejected`; the portal shows no draft.
3. Ask again, **Approve once** → `success`, one draft, verified by re-reading the page.

Close: "If AnyMCP can't tell what happened it says **unknown outcome** and never repeats the action. Revoke everything is one button."

## Variant on a public site (read-only, no fixture)

Allow `https://books.toscrape.com`, open a category page, **Start recording**, **Pick a list** on one title (it
matches all 20, as links), **Mark a message** on the yellow demo-site warning, stop, and in review press the
`travel_2` part of **Start page** to make the category an input. Test, enable, then ask the AI app: "List the books
in the mystery_3 category with links." Each result has its URL. Say: "This shows these pages work today. It does not
mean every site will."

## Automated variant (real client, no human)

`npx tsx scripts/demo-claude.ts [--chrome]` drives Claude Code (`claude -p`) against the bridge and the fixture
with a temporary `--mcp-config` (your Claude Code config is untouched). It clicks Approve/Decline in the panel for
you and writes a transcript to `eval/results/demo-claude-*.json`. Synthetic prompts and results go to Anthropic
through your own Claude Code login; nothing else leaves the machine. The model's wording varies — this is a
demonstration, not part of the evaluation numbers.

## If something goes wrong on stage

* Panel says **Bridge offline** → the bridge isn't running (see troubleshooting.md).
* The prompt didn't appear → the tool is not enabled, or the site isn't allowed (Settings → Allowed sites).
* Chrome shows nothing after **Allow this site** → click the button again; the prompt needs a click inside the panel.
* The tab is not listed under **Teach** → its site is not allowed yet: use **Allow a website** first.
