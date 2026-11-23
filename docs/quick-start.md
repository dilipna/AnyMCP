# Quick start

From nothing to a working, read-only tool your AI app can call. About 15 minutes the first time.

**You need:** Chrome 116 or newer · Node.js 20.19 or newer · an MCP client (an "AI app" that supports MCP,
for example Claude Code). No account, API key or paid service. Verified end to end on Windows 11. The automated test
suites also pass on macOS and Linux, but nobody has followed this guide there yet (see
[compatibility.md](compatibility.md)).

## 1. Get AnyMCP

**Easiest, no build:** from the [v0.1.2 pre-release](https://github.com/dilipna/AnyMCP/releases/tag/v0.1.2) download
`anymcp-extension-0.1.2.zip` and unzip it. That folder is the extension (step 2). The bridge needs no download: step 3
starts it straight from the same release. To check the files first, see "Checking a download" in
[SECURITY.md](https://github.com/dilipna/AnyMCP/blob/main/SECURITY.md).

**Or build from source** (needs git):

```bash
git clone https://github.com/dilipna/AnyMCP anymcp && cd anymcp
npm ci
npm run build
```

`npm run build` writes the extension to `packages/extension/dist/prod` and the bridge to
`packages/bridge/dist/anymcp-bridge.mjs`.

## 2. Install the extension

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. **Load unpacked** → choose the unzipped `anymcp-extension-0.1.2` folder (from source: `packages/extension/dist/prod`).
3. Click the AnyMCP toolbar icon (pin it from the puzzle-piece menu if you do not see it). The side panel opens on
   **Tools**, with a **Getting started** checklist.

Microsoft Edge and Brave also pass AnyMCP's test suites: open `edge://extensions` or `brave://extensions` instead,
turn on **Developer mode** there, and load the same folder. In every browser the docked side panel itself was
checked only by automation, rendered in a tab.

## 3. Start the bridge and pair

Without a build, run this in a terminal (on Windows, use Command Prompt: PowerShell may refuse to run `npx`, see
[troubleshooting](troubleshooting.md)). npm fetches the bridge from the
release; type `y` if it asks to install:

```bash
npx --package=https://github.com/dilipna/AnyMCP/releases/download/v0.1.2/dilipna-anymcp-bridge-0.1.2.tgz anymcp-bridge
```

The bridge is not on the npm registry, so use this release address rather than a package name. To install it once
instead, run `npm install -g` followed by the same address; afterwards `anymcp-bridge` starts it. From source, in the
`anymcp` folder:

```bash
npm run bridge
```

It prints an 8-digit **pairing code** (single use, valid 10 minutes) and the commands for step 4. Keep this terminal
open; the bridge must keep running while you use AnyMCP over HTTP.

In the side panel, under **2 · Pair this browser**, type the code and press **Pair**. The header pill changes to
**Bridge connected**.

## 4. Connect your AI app

In the side panel: **Settings → Show the client command**.

* **Claude Code (HTTP):** run the printed command in a terminal:
  ```bash
  claude mcp add --transport http anymcp http://127.0.0.1:47820/mcp --header "Authorization: Bearer <token>"
  ```
  The token is a password for your bridge: do not paste it anywhere public. **Disconnect the AI client** in
  Settings replaces it.
* **Apps that start MCP servers themselves (stdio)**, such as Claude Desktop or Cursor: add the printed entry to the
  app's MCP settings. Copy it exactly as printed; its form depends on how you started the bridge. Started with
  `npx --package=…`, it starts the same release again through npx (on Windows through `cmd /c`):
  ```json
  { "mcpServers": { "anymcp": { "command": "npx", "args": ["-y", "--package=https://github.com/dilipna/AnyMCP/releases/download/v0.1.2/dilipna-anymcp-bridge-0.1.2.tgz", "anymcp-bridge", "--stdio"] } } }
  ```
  Installed or built, it names Node and the bridge file:
  ```json
  { "mcpServers": { "anymcp": { "command": "<path to node>", "args": ["<path>/anymcp-bridge.mjs", "--stdio"] } } }
  ```
  The app then starts AnyMCP itself, so the terminal from step 3 is optional. If a bridge is already running, the
  app shares it. *Status: verified with Claude Code over stdio; Claude Desktop and Cursor not yet tested.*

Ask your app to call **`anymcp_status`**: it says whether the browser is paired and connected and how many tools are
enabled. The checklist's "Connect your AI assistant" step turns green after your app's first request.

## 5. Allow a website

AnyMCP can only use sites you allow, one at a time, and Chrome only lets it see the address of a tab once the site
is allowed. The home screen's **This site** card always says where you stand on the tab in front of you.

**Teach → Allow a website** → paste the site's address, for example `https://books.toscrape.com` (a public sandbox
made for scraping practice) → **Allow this site** → confirm Chrome's prompt. It is allowed on every page of that site
and nowhere else. Remove it any time in **Settings → Allowed sites** (its tools are disabled at once).

## 6. Teach a read-only tool

Example: "the books in a category", with links.

1. Open `https://books.toscrape.com/catalogue/category/books/travel_2/index.html` in a tab.
2. **Teach** → under **Tabs on sites you allowed**, press **Start recording** next to that tab. A red "AnyMCP is
   recording" banner appears on the page.
3. **Pick a list** → click one book title. AnyMCP finds the others like it and shows how many it matched.
4. **Mark a message** → click the yellow "Warning! This is a demo website…" box (it is on every page, so it proves
   the page loaded).
5. **Stop recording** → **Review the tool →**.
6. In **Review your tool**: give it a name and a description for the AI. Under **Start page**, press the
   `travel_2` button to make the category an input, and rename the input to `category`. Under **What it returns**,
   the list is already "Each item is a link (text and address)".
7. Read **What this tool can do** (generated from what AnyMCP enforces), then **Save as draft**.
8. **Run test** with `category = travel_2` → you should see a verified result. Then **Enable for my AI assistant**.

## 7. Use it from your AI app

Ask, for example: *"Use the AnyMCP books_in_category tool for the category mystery_3 and list the titles with their
links."* The app receives a structured result: `status: "success"`, the books as `{ text, url }`, the source page,
and `untrustedContent: true` (page text is data, not instructions). Every run appears under **Runs** with what
happened, step by step.

## Stop, disconnect, update, uninstall

* **Stop a run:** the **Stop** button in the side panel header or the page banner.
* **Disconnect your AI app:** Settings → **Disconnect the AI client** (HTTP token replaced). For stdio apps, remove
  `anymcp` from the app's MCP settings.
* **Revoke everything:** Settings → **Revoke all access…** (all tools off, all sites removed, bridge unpaired).
* **Stop the bridge:** Ctrl+C in its terminal.
* **Update:** from a release, unzip the newer ZIP into the **same folder** (replace its files), press the reload
  button on `chrome://extensions`, and start the bridge with the newer release's command. Chrome treats an unpacked
  extension in a different folder as a different extension, whose tools and pairing start empty. From source:
  `git pull && npm ci && npm run build`, then the reload button. Pairing and tools are kept.
* **Uninstall:** remove the extension from `chrome://extensions`, remove `anymcp` from your AI app, delete the
  `~/.anymcp` folder (`%USERPROFILE%\.anymcp` on Windows).

## Screenshots to take for this guide and the store listing

Chrome's docked side panel cannot be captured by automation here, so these are still to be taken by a person, at
1280×800, in a clean profile with only public sandbox data visible:

1. The side panel docked next to `books.toscrape.com`, showing **Getting started** with steps 1–3 done.
2. **Teach → Allow a website** with `https://books.toscrape.com` typed in, and Chrome's permission prompt open.
3. Recording on the category page, with the banner and **What you picked** listing "List: 20 items…".
4. **Review your tool** showing **Start page** (category as an input) and **What this tool can do**.
5. **Runs** showing a verified run called from the AI app, with **What happened** expanded.
6. (Optional) an approval prompt from the synthetic fixture (`npm run dev`), to show "approve every run".
