# First-time-user test sheet (blank)

For a person who has **never seen AnyMCP**. The observer reads the task aloud, does not help, and writes down what
happens. One copy per participant. Takes 30–45 minutes. Use only public sandbox sites; nothing signed-in.

**Participant:** ____________ **Date:** ________ **OS / Chrome version:** ______________ **AI app:** ______________

**Has used MCP before?** yes / no **Has installed an unpacked extension before?** yes / no

## Tasks

For each task record: completed (yes / with help / no), time, where they hesitated, what they said, and any error
text exactly as shown.

| # | Task (read aloud) | Expected observation | Completed | Time | Notes |
|---|---|---|---|---|---|
| 1 | "Using only the README, install AnyMCP and open its side panel." | Side panel opens on Tools with **Getting started** | | | |
| 2 | "Start the bridge and connect the browser to it." | Pairing code entered; header shows **Bridge connected** | | | |
| 3 | "Connect your AI app to AnyMCP." | App lists `anymcp_status`; checklist step 2 turns green after a call | | | |
| 4 | "Allow AnyMCP to use books.toscrape.com, and nothing else." | **Allow a website** used; Chrome prompt confirmed; site listed in **Settings → Allowed sites** | | | |
| 5 | "Teach AnyMCP to list the books in a category, so your AI app can ask for any category." | List picked; category made an input; test shows a verified result | | | |
| 6 | "Before enabling it: what can this tool read, and can it change anything?" | Participant finds **What this tool can do**; answers "reads book titles and links; changes nothing" | | | |
| 7 | "Ask your AI app for the books in the mystery_3 category." | App returns titles with links; the run appears under **Runs** as verified | | | |
| 8 | "Ask for a category that does not exist, e.g. nope_999. What happened?" | Run stops safely; participant can explain from the Runs screen | | | |
| 9 | "Make sure your AI app can no longer use AnyMCP on that site." | Site removed (or tool disabled); app no longer lists the tool | | | |

## Manual client test (Claude Desktop or Cursor, stdio)

Not yet run by the project: record the result here.

1. Settings → **Show the client command** → copy the **MCP settings entry for apps that start tools themselves**.
2. Claude Desktop: Settings → Developer → Edit Config → paste under `mcpServers` → restart the app.
   Cursor: Settings → MCP → add the same entry.
3. Expected: the app lists `anymcp_status`, `anymcp_get_run` and every enabled tool; calling `anymcp_status` reports
   `connected`; calling `books_in_category` with `mystery_3` returns 20 books with links; the side panel's Connection
   section names the app with "(via stdio)".
4. Quit the app. Expected: if the app had started the bridge, it stops; another running app takes over within a few
   seconds.

| Step | Observed | Pass / fail |
|---|---|---|
| Tools listed | | |
| `anymcp_status` | | |
| `books_in_category` result | | |
| Shown as "(via stdio)" | | |
| Quit behaviour | | |

## After the session

* Hardest moment, in their words: ________________________________________________
* Anything that looked like it worked but had not: ____________________________
* Would they trust it with a task that changes data? Why / why not: ______________
* Severity of each problem (blocker / slows down / cosmetic) and the screen it happened on.
