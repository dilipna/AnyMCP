# Public naming check for "MyCP"

**This is not legal clearance.** It is a read-only search on 2026-11-11 so nobody assumes the name,
package identifiers or domains are free. Nothing was registered, purchased or contacted.

| Area | Result | What was checked |
|---|---|---|
| npm `mycp` | **Conflict** — exists (v1.0.3, 2021, an unrelated `cp` command) | registry |
| npm `@mycp/*` scope | **Unverified** — `@mycp/bridge|extension|test` return 404 and a scope search found nothing, but a 404 does not prove the org is free; npmjs.com returned 403 for the org page | registry |
| npm `mycp-extension`, `mycp-bridge`, `mycp-mcp` | No conflict found | registry |
| PyPI `mycp` | No conflict found | registry |
| GitHub | **Minor conflict** — user `mycp` (1 repo, 2010); `MCPTech/mycp` ("mycloudportal", AGPL, last pushed 2014); unrelated "MyCPTrainer" etc. | search |
| Chrome Web Store | No extension named "MyCP" found | web search only — not an exhaustive store query |
| Other products/companies | **Conflicts** (different industries): CloudBlue/Odin "MyCP" control-panel component; Superb.net customer portal "myCP"; Cerebral Palsy Research Network "MyCP" (mycp.org); a legacy iOS app | web search |
| Trademark | **Possible conflict, unverified at the USPTO** — aggregators list **MYCP, Reg. 2686680, Class 42 (software/IT services), CherryRoad Technologies Inc., 2003**, renewed. Class 42 overlaps this product. The government database could not be opened. | third-party aggregators |
| Domains | mycp.com in use (since 2004); mycp.app parked (registered 2026-03); mycp.net for sale; mycp.dev registered 2026-10; mycp.ai registered; mycp.org = CP Research Network; **mycp.io appeared unregistered — unverified** (no RDAP) | DNS/RDAP/HTTP |

## What this means

* The user-facing name "MyCP Extension" and product name "MyCP" are the owner's decision and are used throughout.
* **Do not publish** a store listing, an npm package or a website under this name until a proper trademark
  search/clearance is done. The Class 42 finding is the most serious.
* All workspace packages in this repository are `private` and named `mycp-*` (`mycp-protocol`, `mycp-bridge`,
  `mycp-extension`, `mycp-fixture`, `mycp-eval`). `mycp-extension` and `mycp-bridge` had no npm conflict, but
  they are not reserved.
* If the owner keeps the name, consider a distinctive scope the owner controls for any future npm publication,
  and an MCP server key and extension id that are not the bare acronym.
* The Chrome Web Store assigns the extension id and shows the listing name; check the store for lookalikes
  again at submission time.
