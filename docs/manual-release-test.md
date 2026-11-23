# Manual release test (a person, in a real Chrome window)

Run this before every Chrome Web Store submission, on the exact build that will be submitted. It covers what the
automated suites cannot: Chrome's own "allow this site" prompt, the side panel docked in a real window, and a real AI
app set up by hand. About 40 minutes. Write the result of each step in the table at the end (OK, or what you saw).

**Never share** the bridge token (the long value after `Bearer`) or a pairing code in a screenshot, issue or chat.

## Before you start

* Chrome 116 or newer, Node.js 20.19 or newer, and (for part 3) Claude Code or another MCP client.
* The build to test, unzipped into a folder (a release ZIP, or `packages/extension/dist/prod` after `npm run build`).
* A fresh Chrome profile: profile picture (top right) → **Add** → **Continue without an account** → name it
  `AnyMCP test`. It behaves like a new user's browser and keeps your normal browsing separate.

## Part 1: install, connect, pair

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose the build folder.
   *Expected:* a card "AnyMCP Extension" with the right version and no red **Errors** button.
2. Puzzle-piece icon → pin **AnyMCP** → click its icon.
   *Expected:* the side panel opens docked on the right, on **Tools**, with a **Getting started** checklist.
   Screenshot: store shot 1 ("Getting started").
3. In a terminal (on Windows, Command Prompt), start the bridge with the release's command from the quick start,
   for example `npx --package=https://github.com/dilipna/AnyMCP/releases/download/v<version>/dilipna-anymcp-bridge-<version>.tgz anymcp-bridge`
   (type `y` if asked). *Expected:* "AnyMCP bridge … is running" and an 8-digit pairing code. Leave it open.
4. Panel → **Pair this browser** → type the code → **Pair**. *Expected:* the header says **Bridge connected** and the
   checklist ticks its first step.

## Part 2: allow a website, teach a tool

5. **Teach → Allow a website** → type `https://books.toscrape.com` → **Allow this site**.
   *Expected:* **Chrome's own prompt** appears, naming books.toscrape.com only. Accept it; the site appears under
   **Settings → Allowed sites**. Screenshot: store shot 2 (the prompt open).
6. Open `https://books.toscrape.com/catalogue/category/books/travel_2/index.html` in a tab.
   *Expected:* the panel's **This site** card names books.toscrape.com and says "AnyMCP may use this site, only
   through tools you enabled".
7. **Teach** → **Start recording** next to that tab. *Expected:* a red "AnyMCP is recording" banner on the page.
8. **Pick a list** → click one book title. *Expected:* the panel says it found **11** items (the travel category).
   Then **Mark a message** → click the yellow "Warning! This is a demo website…" box. Screenshot: store shot 3.
9. **Stop recording** → **Review the tool →**. Name it `books_in_category`, give it a short description. Under
   **Start page**, press the `travel_2` button to make it an input and rename the input to `category`.
   *Expected:* **What this tool can do** says it reads a list and changes nothing. Screenshot: store shot 4.
10. **Save as draft** → **Run test** with `category` = `mystery_3`. *Expected:* a verified result listing 20 books,
    each with a link on books.toscrape.com.
11. **Enable for my AI assistant**. Read the notice next to the button: it says what your AI app will receive.

## Part 3: use it from an AI app

12. Panel → **Settings → Show the client command** → copy the `claude mcp add …` command. Run it in a new terminal.
13. In that terminal, run `claude` and ask: *"Use the AnyMCP books_in_category tool with the category poetry_23 and
    list the first three titles with their links."* *Expected:* the right titles with links on books.toscrape.com
    (check one in the browser).
14. Panel → **Runs**. *Expected:* the run, with **What happened** step by step. Screenshot: store shot 5.

## Part 4: the safety controls

15. **Settings → Allowed sites** → remove books.toscrape.com. *Expected:* the tool shows as disabled. Ask Claude
    Code to use it again: it must not run (the tool is gone or refused).
16. **Settings → Revoke all access…** → confirm. *Expected:* all tools off, no allowed sites, bridge unpaired
    (the header no longer says connected).
17. Clean up: in a terminal `claude mcp remove anymcp`; stop the bridge with **Ctrl+C**; remove the test profile
    if you like (profile menu → **Manage profiles**), which also removes the extension and its data.

## Part 5 (optional): approval for a change, on the synthetic site

Needs the repository: in its folder run `npx tsx packages/fixture/src/server.ts` (the synthetic support portal at
`http://127.0.0.1:4173`; it says SYNTHETIC DATA on every page) and keep the bridge from part 1 running.

18. Allow `http://127.0.0.1:4173` (part 2, step 5), open `http://127.0.0.1:4173/orders`, sign in with the button.
19. Record: search order `A-1012`, open it, type a note in **Customer note**, click **Save draft note**. **Pick a
    value** on the status and on the customer, **Mark a message** on the "Draft saved." confirmation. Stop, review
    (the note and the order id become inputs; the review says the tool **changes data** and **asks every time**),
    save, test, enable.
20. Ask your AI app to save a draft note on order A-1012. *Expected:* the **approval sheet** appears in the docked
    panel with the exact action and values. **Decline** once (*expected:* the app is told `rejected`, nothing
    saved), then ask again and **Approve once** (*expected:* `success`, one draft on the order page).

## Results

Copy this table into the release notes or an issue (no tokens or codes).

| Step | Result (OK / what you saw) |
|---|---|
| 1 install | |
| 2 docked panel | |
| 3 bridge | |
| 4 pair | |
| 5 Chrome's prompt | |
| 6 This site card | |
| 7 banner | |
| 8 list count 11 | |
| 9 review | |
| 10 test: 20 books | |
| 11 enable notice | |
| 12–13 AI app result | |
| 14 Runs | |
| 15 remove site | |
| 16 revoke all | |
| 17 clean up | |
| 18–20 approval (optional) | |

Tester, date, Chrome version, Windows/macOS/Linux, build (version and where it came from):
