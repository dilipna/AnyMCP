// Integration tests at the bridge boundaries: pairing, MCP authentication, routing, structured
// responses, duplicate handling, disconnection and revocation. A FakeExtension stands in for the
// browser; the MCP side uses the official SDK client over real HTTP.

import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { makeDraftNoteTool, makeFindOrderTool } from "anymcp-fixture/tools";
import type { ResultEnvelope } from "anymcp-protocol";
import { EXT_ID, FakeExtension, mcpClient, okEnvelope, pairedExtension, sleep, withBridge } from "./helpers";
import type { BridgeHandle } from "../src/bridge";

let bridge: BridgeHandle;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ bridge, cleanup } = await withBridge());
});
afterEach(async () => {
  await cleanup();
});

function rawMcp(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: bridge.mcpPort, path: "/mcp", method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  });
}

describe("pairing (extension -> bridge)", () => {
  it("pairs with the correct one-time code, and the code cannot be reused", async () => {
    const code = bridge.pairingCode();
    const a = new FakeExtension(bridge);
    await a.open();
    await a.pair(code);
    expect(a.secret).toHaveLength(64);
    expect(bridge.store.state.extension?.id).toBe(EXT_ID);

    const b = new FakeExtension(bridge, "ponmlkjihgfedcbaponmlkjihgfedcba");
    await b.open();
    b.send({ type: "hello", protocol: 1, extensionId: b.id, extensionVersion: "t", mode: "pair", pairingCode: code });
    const rej = await b.waitFor("hello.rejected");
    expect(rej.code).toBe("pairing_wrong_code");
    expect(bridge.store.state.extension?.id).toBe(EXT_ID); // unchanged
  });

  it("rejects a wrong code and rotates the code after too many attempts", async () => {
    const original = bridge.pairingCode();
    for (let i = 0; i < 5; i++) {
      const e = new FakeExtension(bridge);
      await e.open();
      e.send({ type: "hello", protocol: 1, extensionId: e.id, extensionVersion: "t", mode: "pair", pairingCode: "00000000" });
      expect((await e.waitFor("hello.rejected")).code).toBe("pairing_wrong_code");
    }
    const e = new FakeExtension(bridge);
    await e.open();
    e.send({ type: "hello", protocol: 1, extensionId: e.id, extensionVersion: "t", mode: "pair", pairingCode: original });
    expect((await e.waitFor("hello.rejected")).code).toBe("pairing_too_many_attempts");
    expect(bridge.pairingCode()).not.toBe(original);
  });

  it("reconnects with an HMAC proof and rejects a wrong secret", async () => {
    const first = await pairedExtension(bridge);
    const secret = first.secret;
    first.close();
    await sleep(50);

    const again = new FakeExtension(bridge);
    await again.open();
    await again.auth(secret);

    const bad = new FakeExtension(bridge);
    await bad.open();
    bad.secret = "f".repeat(64);
    bad.send({ type: "hello", protocol: 1, extensionId: bad.id, extensionVersion: "t", mode: "auth" });
    expect((await bad.waitFor("hello.rejected")).code).toBe("bad_credentials");
  });

  it("refuses WebSocket upgrades that are not from a browser extension origin", async () => {
    for (const origin of ["http://evil.example", "https://127.0.0.1:1234", ""]) {
      const ws = new WebSocket(bridge.extUrl, origin ? { origin } : {});
      const outcome = await new Promise<string>((resolve) => {
        ws.on("open", () => resolve("opened"));
        ws.on("error", () => resolve("refused"));
        ws.on("unexpected-response", () => resolve("refused"));
      });
      expect(outcome, `origin "${origin}"`).toBe("refused");
    }
  });

  it("keeps an authenticated connection open past the handshake timeout (regression: it used to be dropped)", async () => {
    await cleanup();
    ({ bridge, cleanup } = await withBridge({ helloTimeoutMs: 250 }));
    const ext = await pairedExtension(bridge);
    await sleep(700); // well past the handshake timeout
    expect(bridge.hub.connected).toBe(true);
    ext.send({ type: "ping" });
    await ext.waitFor("pong");
  });

  it("drops a connection that never completes the handshake", async () => {
    await cleanup();
    ({ bridge, cleanup } = await withBridge({ helloTimeoutMs: 250 }));
    const idle = new FakeExtension(bridge);
    await idle.open();
    await sleep(600);
    expect(idle.closed).toBe(true);
  });

  it("rejects an extension whose claimed id does not match its Origin", async () => {
    const liar = new FakeExtension(bridge, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", `chrome-extension://${EXT_ID}`);
    await liar.open();
    liar.send({ type: "hello", protocol: 1, extensionId: liar.id, extensionVersion: "t", mode: "pair", pairingCode: bridge.pairingCode() });
    expect((await liar.waitFor("hello.rejected")).code).toBe("origin_mismatch");
  });
});

describe("MCP endpoint protection", () => {
  it("requires the bearer token", async () => {
    expect(await rawMcp({})).toBe(401);
    expect(await rawMcp({ authorization: "Bearer wrong" })).toBe(401);
    expect(await rawMcp({ authorization: `Bearer ${bridge.token()}` })).toBe(200);
  });
  it("rejects requests from web-page origins and non-loopback Host headers (DNS rebinding)", async () => {
    const auth = { authorization: `Bearer ${bridge.token()}` };
    expect(await rawMcp({ ...auth, origin: "https://evil.example" })).toBe(403);
    expect(await rawMcp({ ...auth, host: "evil.example" })).toBe(403);
  });
  it("sends no CORS headers", async () => {
    const res = await fetch(`http://127.0.0.1:${bridge.mcpPort}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("routing and structured results", () => {
  it("lists enabled tools with typed schemas and returns a structured, validated result", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);

    const { tools } = await client.listTools();
    const find = tools.find((t) => t.name === "find_order");
    expect(find).toBeTruthy();
    expect(find!.outputSchema).toBeTruthy();
    expect(find!.annotations?.readOnlyHint).toBe(true);
    expect(tools.map((t) => t.name)).toContain("anymcp_get_run");

    const pending = client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } });
    const req = await ext.waitFor("run.request");
    expect(req.toolId).toBe("find_order");
    expect(req.args).toEqual({ order_id: "A-1042" });
    ext.send({
      type: "run.result",
      envelope: okEnvelope(req.executionId, { id: "find_order", version: 1 }, { found: true, order_id: "A-1042", customer: "Test Customer 42", status: "Shipped", total: 128.4, placed: "2026-10-03" }),
    });
    const res = await pending;
    expect(res.isError).toBeFalsy();
    const env = res.structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("success");
    expect(env.executionId).toBe(req.executionId);
    expect(env.tool).toEqual({ id: "find_order", version: 1 });
    expect(env.source?.origin).toBe("http://127.0.0.1:4173");
    expect(env.untrustedContent).toBe(true);
  });

  it("rejects invalid arguments in the bridge and never contacts the extension", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);
    const res = await client.callTool({ name: "find_order", arguments: { order_id: "XYZ" } });
    // The SDK may reject at the schema layer or our validator may; either way: an error, and no run.
    expect(res.isError).toBe(true);
    await sleep(100);
    expect(ext.inbox.filter((m) => m.type === "run.request")).toHaveLength(0);
  });

  it("answers `extension_disconnected` instead of hanging when no extension is connected", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    ext.close();
    await sleep(100);
    const client = await mcpClient(bridge);
    const res = await client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } });
    const env = res.structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("precondition_failed");
    expect(env.reasonCode).toBe("extension_disconnected");
    expect(env.retry.safe).toBe(true);
  });

  it("coalesces an identical in-flight request into ONE run", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);
    const args = { order_id: "A-1042" };
    const p1 = client.callTool({ name: "find_order", arguments: args });
    const p2 = client.callTool({ name: "find_order", arguments: args });
    const req = await ext.waitFor("run.request");
    await sleep(150);
    expect(ext.inbox.filter((m) => m.type === "run.request")).toHaveLength(0); // no second dispatch
    ext.send({ type: "run.result", envelope: okEnvelope(req.executionId, { id: "find_order", version: 1 }, { found: false }, { status: "empty", reasonCode: "no_results" }) });
    const [r1, r2] = await Promise.all([p1, p2]);
    const e1 = r1.structuredContent as unknown as ResultEnvelope;
    const e2 = r2.structuredContent as unknown as ResultEnvelope;
    expect(e1.executionId).toBe(e2.executionId);
    expect([e1.deduplicated, e2.deduplicated].filter(Boolean)).toHaveLength(1);
  });

  it("refuses a second, different run while one is in progress", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);
    const p1 = client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } });
    const req = await ext.waitFor("run.request");
    const r2 = await client.callTool({ name: "find_order", arguments: { order_id: "A-1043" } });
    expect((r2.structuredContent as unknown as ResultEnvelope).reasonCode).toBe("bridge_busy");
    ext.send({ type: "run.result", envelope: okEnvelope(req.executionId, { id: "find_order", version: 1 }, { found: false }, { status: "empty", reasonCode: "no_results" }) });
    await p1;
  });

  it("never repeats a completed write: an identical request is denied as a duplicate", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeDraftNoteTool()]);
    const client = await mcpClient(bridge);
    const args = { order_id: "A-1042", note: "Call the customer back" };
    const p1 = client.callTool({ name: "draft_customer_note", arguments: args });
    const req = await ext.waitFor("run.request");
    ext.send({ type: "run.result", envelope: okEnvelope(req.executionId, { id: "draft_customer_note", version: 1 }, { order_id: "A-1042", draft_count: 1 }) });
    expect(((await p1).structuredContent as unknown as ResultEnvelope).status).toBe("success");

    const again = await client.callTool({ name: "draft_customer_note", arguments: args });
    const env = again.structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("denied");
    expect(env.reasonCode).toBe("duplicate_request");
    await sleep(100);
    expect(ext.inbox.filter((m) => m.type === "run.request")).toHaveLength(0);
  });
});

describe("disconnection and interruption", () => {
  it("a READ interrupted by disconnection is reported as interrupted and safe to retry", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);
    const pending = client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } });
    await ext.waitFor("run.request");
    ext.close();
    const env = (await pending).structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("interrupted");
    expect(env.actionMayHaveOccurred).toBe(false);
    expect(env.retry.safe).toBe(true);
  });

  it("a WRITE that had reached the approval step becomes unknown_outcome, never 'safe to retry'", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeDraftNoteTool()]);
    const client = await mcpClient(bridge);
    const pending = client.callTool({ name: "draft_customer_note", arguments: { order_id: "A-1042", note: "hello" } });
    const req = await ext.waitFor("run.request");
    ext.send({ type: "run.event", executionId: req.executionId, phase: "approval_requested", at: new Date().toISOString() });
    await sleep(50);
    ext.close();
    const env = (await pending).structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("unknown_outcome");
    expect(env.actionMayHaveOccurred).toBe("unknown");
    expect(env.retry.safe).toBe(false);
  });

  it("a WRITE interrupted before approval was requested is still safe to retry", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeDraftNoteTool()]);
    const client = await mcpClient(bridge);
    const pending = client.callTool({ name: "draft_customer_note", arguments: { order_id: "A-1042", note: "hello" } });
    await ext.waitFor("run.request");
    ext.close();
    const env = (await pending).structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("interrupted");
    expect(env.retry.safe).toBe(true);
  });

  it("a late authoritative result from the reconnected extension updates what anymcp_get_run reports", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeDraftNoteTool()]);
    const secret = ext.secret;
    const client = await mcpClient(bridge);
    const pending = client.callTool({ name: "draft_customer_note", arguments: { order_id: "A-1042", note: "hello" } });
    const req = await ext.waitFor("run.request");
    ext.send({ type: "run.event", executionId: req.executionId, phase: "approval_requested", at: new Date().toISOString() });
    await sleep(50);
    ext.close();
    const first = (await pending).structuredContent as unknown as ResultEnvelope;
    expect(first.status).toBe("unknown_outcome");

    const back = new FakeExtension(bridge);
    await back.open();
    await back.auth(secret);
    back.send({
      type: "run.result",
      recovered: true,
      envelope: okEnvelope(req.executionId, { id: "draft_customer_note", version: 1 }, undefined, {
        status: "cancelled_before_action",
        reasonCode: "bridge_disconnected",
        message: "Approval was cancelled when the bridge connection dropped. Nothing was changed.",
      }),
    });
    await back.waitFor("ack");
    const lookup = await client.callTool({ name: "anymcp_get_run", arguments: { execution_id: req.executionId } });
    const info = lookup.structuredContent as unknown as { state: string; envelope: ResultEnvelope };
    expect(info.state).toBe("finished");
    expect(info.envelope.status).toBe("cancelled_before_action");
    expect(info.envelope.output).toBeUndefined();
  });

  it("shutting the bridge down mid-run answers the waiting client and leaves no timer behind (regression)", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);
    const pending = client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } });
    await ext.waitFor("run.request");
    bridge.runs.close();
    const env = (await pending).structuredContent as unknown as ResultEnvelope;
    expect(env.status).toBe("interrupted");
    expect(env.reasonCode).toBe("bridge_disconnected");
    expect(bridge.runs.inFlightId).toBeNull();
  });

  it("forwards a client cancellation to the extension", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const client = await mcpClient(bridge);
    const ctrl = new AbortController();
    const pending = client.callTool({ name: "find_order", arguments: { order_id: "A-1042" } }, { signal: ctrl.signal }).catch((e) => e);
    await ext.waitFor("run.request");
    ctrl.abort();
    const cancel = await ext.waitFor("run.cancel");
    expect(cancel.reason).toBe("client_cancelled");
    await pending;
  });
});

describe("revocation", () => {
  it("full revocation unpairs the extension, rotates the MCP token and forgets tools", async () => {
    const ext = await pairedExtension(bridge);
    await ext.syncTools([makeFindOrderTool()]);
    const oldToken = bridge.token();
    ext.send({ type: "revoke" });
    await ext.waitFor("revoked");
    await sleep(100);

    expect(bridge.store.state.extension).toBeNull();
    expect(bridge.token()).not.toBe(oldToken);
    expect(await rawMcp({ authorization: `Bearer ${oldToken}` })).toBe(401);
    expect(bridge.hub.listTools()).toHaveLength(0);

    const retry = new FakeExtension(bridge);
    await retry.open();
    retry.secret = ext.secret;
    retry.send({ type: "hello", protocol: 1, extensionId: retry.id, extensionVersion: "t", mode: "auth" });
    expect((await retry.waitFor("hello.rejected")).code).toBe("not_paired");
  });

  it("disconnecting only the AI client rotates its token but keeps the pairing", async () => {
    const ext = await pairedExtension(bridge);
    const oldToken = bridge.token();
    ext.send({ type: "client.revoke" });
    const creds = await ext.waitFor("credentials");
    expect(creds.token).not.toBe(oldToken);
    expect(await rawMcp({ authorization: `Bearer ${oldToken}` })).toBe(401);
    expect(await rawMcp({ authorization: `Bearer ${creds.token}` })).toBe(200);
    expect(bridge.store.state.extension?.id).toBe(EXT_ID);
  });
});
