# Troubleshooting

## The side panel says "Bridge offline" / "Not connected to the bridge"

1. Is the bridge running? In the MyCP folder run `npm run bridge` (or `node mycp-bridge-<version>.mjs`). It must stay open.
2. Did it print *"A MyCP bridge is already running on this computer"*? Then one is already there, often started
   by an app such as Claude Desktop (`--stdio`). You do not need a second one; the message shows the pairing code
   and the setup commands for it. If something else uses 47820/47821, choose other ports:
   `npm run bridge -- --mcp-port=48820 --ext-port=48821`, then in the panel *Settings → Connection → advanced*
   use `ws://127.0.0.1:48821/ext` when pairing.
3. Click **Reconnect now**. MyCP also retries by itself (1 s, 2 s, 4 s … up to 15 s).
4. If Chrome asks about **local network access**, choose **Allow**. (Chrome 147+ can gate loopback access; on
   Chrome 157 with default settings we measured no prompt — see `scripts/lna-spike.ts`.) An enterprise policy
   (`LocalNetworkAccessBlockedForUrls`) can block it; ask your administrator.

## Pairing fails

* *"That pairing code is not correct."* Enter the 8 digits exactly as the bridge printed them (spaces are fine).
* *"…expired" / "Too many wrong attempts."* The bridge issued a **new** code. Its terminal shows it; if an app
  started the bridge in the background, run `mycp-bridge` (or `npm run bridge`) in a terminal to see it.
* *"The bridge no longer recognises this browser."* The bridge's state was reset or you ran *Revoke*. Pair again.
* To pair a different browser profile, stop the bridge and delete its state folder (`%USERPROFILE%\.mycp` on
  Windows, `~/.mycp` elsewhere), then start it again.

## My assistant can't see the tools

* Tools appear only after you **enable** them (*Tools → open a tool → Enable*), which requires a successful test.
* The assistant must be connected with the bridge's current token. After *Disconnect the AI client* or
  *Revoke everything* the token changes — run the client command again (*Settings → Show the client command*).
* Claude Code: `claude mcp list` should show `mycp` as connected. Remove and re-add if the token changed:
  `claude mcp remove mycp` then the new `claude mcp add …`.
* Apps that start MyCP themselves (`--stdio`) need no token. Ask the assistant to call **`mycp_status`**: it says
  whether the browser is paired and connected and how many tools are enabled. The app's MCP log shows the bridge's
  messages (they go to stderr). To disconnect such an app, remove `mycp` from its MCP settings: *Disconnect the AI
  client* rotates the HTTP token, which these apps do not use.

## A run says "Stopped safely" / `precondition_failed`

Read the message: it names what did not match.
* **"expired session"** — sign in to the website in Chrome, then ask again. MyCP never signs in for you.
* **"could not find / matches more than one"** — the page changed or the locator is too loose. Open the tool →
  *Test it*. If it fails, *Edit…* (creates a new version) or re-record. MyCP never rewrites an enabled tool.
* **"wrong site"** — the page redirected to a different website; MyCP stopped on purpose.

## "Unknown outcome"

The action was started but MyCP could not confirm it. **Open the website and check.** MyCP will not repeat
it. If the change is not there and you still want it, ask your assistant again (for tools with the
"this draft is not already there" precondition, a repeat is safe).

## Recording does not capture something I typed

Password, payment, token and one-time-code fields — and anything marked `data-mycp-ignore` — are skipped on
purpose (the panel counts them). Everything else is recorded only while the tab is on the approved site.

## "Allow this site" does nothing

Chrome shows its own permission prompt near the address bar; it needs a click inside the side panel. If you
dismissed it, click **Allow this site** again.

## Extension won't load

* Choose `packages/extension/dist/prod` (the folder with `manifest.json`), after `npm run build`.
* Chrome must be 116 or newer (side panel + WebSocket keep-alive).
* Branded Chrome 137+ ignores `--load-extension` on the command line; use *Load unpacked* in `chrome://extensions`.

## Windows notes

* Use PowerShell or Git Bash. Paths with spaces are fine; keep the repository out of OneDrive-synced folders if
  `npm ci` is slow or hits locked files (`node_modules` is large).
* Bridge state: `%USERPROFILE%\.mycp\state.json` (the user-profile ACL protects it; there is no `chmod`).

## Collecting diagnostics for a bug report

*Settings → Privacy → Capture developer diagnostics on failures* (off by default) stores a short outline of
visible control names (digits masked, no field values, no passwords). Run details also show *Developer
details* with step ids and reason codes. Never paste your bridge token into a bug report.
