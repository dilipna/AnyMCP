// Property-based ("fuzz") tests for the bridge's two network doors, with random but replayable traffic
// (see packages/protocol/test/fuzz-kit.ts):
//  - the MCP HTTP endpoint: random methods, paths, Host/Origin/Authorization headers and bodies. Never a 5xx, never a
//    success without the exact token from a loopback host and origin, and the server stays healthy;
//  - the extension WebSocket: random origins and frames, wrong pairing codes and forged proofs. Nothing ever pairs,
//    nothing crashes, and the real extension can still pair afterwards.

import { request } from "node:http";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAllAsync, genJsonText, genWord, RUNS, type Rng } from "../../protocol/test/fuzz-kit";
import type { BridgeHandle } from "../src/bridge";
import { EXT_ID, mcpClient, pairedExtension, withBridge } from "./helpers";

const HTTP_RUNS = Math.min(RUNS, 2000);
const WS_RUNS = Math.max(20, Math.min(Math.floor(RUNS / 4), 500));

interface Req {
  method: string;
  path: string;
  headers: Record<string, string>;
  setHost: boolean;
  body?: string;
}
function send(port: number, q: Req): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: q.method, path: q.path, headers: q.headers, setHost: q.setHost }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("request timed out")));
    if (q.body !== undefined) req.write(q.body);
    req.end();
  });
}

const rpc = (method: string, params: unknown, id: unknown = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
function genBody(r: Rng): string {
  switch (r.int(9)) {
    case 0:
      return rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: genWord(r), version: "1" } });
    case 1:
      return rpc("tools/list", {});
    case 2:
      return rpc("tools/call", { name: r.pick(["find_order", "anymcp_status", "anymcp_get_run", genWord(r)]), arguments: JSON.parse(genJsonText(r)) }, r.pick([1, "x", null, 1e21, genWord(r)]));
    case 3:
      return JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: r.pick([1, "x", genWord(r)]) } });
    case 4:
      return `[${Array.from({ length: 1 + r.int(3) }, () => rpc(r.pick(["tools/list", "ping", genWord(r)]), {}, r.int(100))).join(",")}]`;
    case 5:
      return genJsonText(r);
    case 6:
      return r.pick(["", "{", "]", "null", "\u0000", "{\"jsonrpc\":\"2.0\""]);
    case 7: {
      // deep nesting, well under the 1 MB body limit; written as text (JSON.stringify itself would overflow here)
      const depth = 1000 + r.int(20000);
      return `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"find_order","arguments":{"order_id":${"[".repeat(depth)}${"]".repeat(depth)}}}}`;
    }
    default:
      return rpc(genWord(r), JSON.parse(genJsonText(r)), r.int(1000));
  }
}

describe("MCP HTTP endpoint under random traffic", () => {
  let bridge: BridgeHandle;
  let cleanup: () => Promise<void>;
  beforeAll(async () => ({ bridge, cleanup } = await withBridge()));
  afterAll(async () => cleanup());

  it("never fails with a 5xx, never succeeds without the exact token from a loopback host and origin, and stays healthy", async () => {
    const port = bridge.mcpPort;
    const token = bridge.token();
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, "evil.example", `evil.example:${port}`, `127.0.0.1.nip.io:${port}`, null] as const;
    const loopbackHost = (h: string | null) => h === `127.0.0.1:${port}` || h === `localhost:${port}`;
    const origins = [undefined, `http://127.0.0.1:${port}`, "http://localhost", "https://evil.example", "null", "http://127.0.0.1.evil.example"] as const;
    const hostileOrigin = (o: string | undefined) => o === "https://evil.example" || o === "null" || o === "http://127.0.0.1.evil.example";
    const auths = [undefined, `Bearer ${token}`, "Bearer wrong", `bearer ${token}`, `Bearer ${token} `, `Bearer  ${token}`, `Basic ${token}`, `Bearer ${token.slice(0, -1)}`, `Bearer ${token}x`, `Bearer ${token},Bearer ${token}`] as const;
    const exactAuth = `Bearer ${token}`;

    const seen = new Map<number, number>();
    let previous = "(none)";
    await forAllAsync(
      "http",
      async (r) => {
        const method = r.pick(["GET", "POST", "POST", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"]);
        const path = r.pick(["/mcp", "/mcp", "/mcp?x=1", "/health", "/", "/MCP", "/mcp/", "/../mcp", "/health?x"]);
        const host = r.pick(hosts);
        const origin = r.pick(origins);
        const auth = r.pick(auths);
        // HTTP strips whitespace around a header value (RFC 9110), so "Bearer <token> " arrives as the exact token
        const exact = auth?.trim() === exactAuth;
        const headers: Record<string, string> = {};
        if (host) headers.host = host;
        if (origin !== undefined) headers.origin = origin;
        if (auth !== undefined) headers.authorization = auth;
        if (r.bool(0.8)) headers.accept = r.pick(["application/json, text/event-stream", "application/json", "*/*", "text/html"]);
        if (r.bool(0.8)) headers["content-type"] = r.pick(["application/json", "text/plain", "application/x-www-form-urlencoded"]);
        const body = method === "POST" || r.bool(0.1) ? genBody(r) : undefined;
        // Always frame a body. Node sends a GET/DELETE body with no length at all, which is invalid HTTP: the server
        // then rightly reads the stray bytes as a broken next request and closes the connection (checked by hand).
        if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
        const sent = `${method} ${path} host=${host} origin=${origin} auth=${exact ? "exact" : auth} accept=${headers.accept} body=${body === undefined ? "-" : `${body.length} bytes: ${body.slice(0, 100)}`}`;
        const res = await send(port, { method, path, headers, setHost: false, body }).catch((e: Error) => {
          throw new Error(`${sent} → no answer (${e.message}); previous request on this agent: ${previous}`);
        });
        seen.set(res.status, (seen.get(res.status) ?? 0) + 1);
        const what = `${sent} → ${res.status} ${res.body.slice(0, 120)}`;
        previous = what;

        expect(res.status, what).toBeLessThan(500);
        const isEndpoint = path === "/mcp" || path === "/mcp?x=1";
        if (isEndpoint && res.status < 300) {
          expect(exact, what).toBe(true);
          expect(loopbackHost(host), what).toBe(true);
          expect(hostileOrigin(origin), what).toBe(false);
        }
        if (isEndpoint && (host === "evil.example" || host === `evil.example:${port}` || host === `127.0.0.1.nip.io:${port}`)) expect(res.status, what).toBe(403);
        if (isEndpoint && loopbackHost(host) && hostileOrigin(origin)) expect(res.status, what).toBe(403);
        if (isEndpoint && loopbackHost(host) && origin === undefined && !exact) expect(res.status, what).toBe(401);
      },
      HTTP_RUNS,
    );

    // the generator really reached the authenticated handler, not only the guards
    expect([...seen.keys()].some((s) => s >= 200 && s < 300), JSON.stringify([...seen])).toBe(true);
    expect(seen.get(401) ?? 0).toBeGreaterThan(0);
    expect(seen.get(403) ?? 0).toBeGreaterThan(0);

    // still healthy, and a real client still works
    expect((await send(port, { method: "GET", path: "/health", headers: {}, setHost: true })).status).toBe(200);
    const client = await mcpClient(bridge);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("anymcp_status");
    await client.close();
  });

  it("answers an over-limit body with 413, even with a valid token", async () => {
    const res = await send(bridge.mcpPort, {
      method: "POST",
      path: "/mcp",
      headers: { authorization: `Bearer ${bridge.token()}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      setHost: true,
      body: rpc("tools/call", { name: "find_order", arguments: { order_id: "x".repeat(1_100_000) } }),
    });
    expect(res.status).toBe(413);
  });

  it("answers a body nested more than 64 levels deep with 400, not a 500 from the SDK", async () => {
    const at = async (depth: number) => {
      const body = `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"find_order","arguments":{"order_id":${"[".repeat(depth)}${"]".repeat(depth)}}}}`;
      return send(bridge.mcpPort, {
        method: "POST",
        path: "/mcp",
        headers: { authorization: `Bearer ${bridge.token()}`, "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": String(Buffer.byteLength(body)) },
        setHost: true,
        body,
      });
    };
    // the envelope itself is 3 levels ({…}, params, arguments), so 61 array levels reach 64 in total
    expect((await at(61)).status).toBe(200);
    for (const depth of [62, 5000, 14000]) {
      const res = await at(depth);
      expect(res.status, `depth ${depth}`).toBe(400);
      expect(res.body, `depth ${depth}`).toContain("nested more than 64 levels");
    }
  });
});

describe("extension WebSocket under random traffic", () => {
  let bridge: BridgeHandle;
  let cleanup: () => Promise<void>;
  beforeAll(async () => ({ bridge, cleanup } = await withBridge({ helloTimeoutMs: 2000 })));
  afterAll(async () => cleanup());

  function genFrame(r: Rng): string | Buffer {
    switch (r.int(7)) {
      case 0:
        return Buffer.from(Array.from({ length: r.int(64) }, () => r.int(256)));
      case 1:
        return genJsonText(r);
      case 2:
        return JSON.stringify({ type: "hello", protocol: r.pick([1, 0, 2, "1", null]), extensionId: r.pick([EXT_ID, genWord(r), ""]), extensionVersion: "x", mode: "pair", pairingCode: r.pick([String(r.int(1e8)).padStart(8, "0"), "", genWord(r), "1234 5678"]) });
      case 3:
        return JSON.stringify({ type: "hello", protocol: 1, extensionId: EXT_ID, extensionVersion: "x", mode: r.pick(["auth", "resume", genWord(r)]) });
      case 4:
        return JSON.stringify({ type: r.pick(["auth", "auth.proof", "tools.sync", "run.result", "pong"]), proof: genWord(r), nonce: genWord(r), tools: [], executionId: genWord(r) });
      case 5:
        return r.pick(["", "null", "[]", "{}", "{\"type\":null}", "\"hello\""]);
      default:
        return JSON.stringify({ ...JSON.parse(`{"x":${genJsonText(r)}}`), type: "hello", extensionId: EXT_ID });
    }
  }

  it("never pairs, never crashes, and the real extension can pair afterwards", async () => {
    const origins = [undefined, "http://evil.example", "https://127.0.0.1", "null", `chrome-extension://${EXT_ID}`, "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "chrome-extension://"];
    let opened = 0;
    await forAllAsync(
      "ws",
      async (r) => {
        const origin = r.pick(origins);
        const ws = new WebSocket(bridge.extUrl, origin === undefined ? {} : { origin });
        const done = new Promise<void>((resolve) => {
          ws.on("close", () => resolve());
          ws.on("error", () => resolve());
          ws.on("unexpected-response", () => resolve());
        });
        await new Promise<void>((resolve) => {
          ws.on("open", () => {
            opened++;
            for (let i = 0, n = 1 + r.int(4); i < n; i++) ws.send(genFrame(r));
            setTimeout(resolve, 20);
          });
          ws.on("error", () => resolve());
          ws.on("unexpected-response", () => resolve());
          ws.on("close", () => resolve());
        });
        ws.terminate();
        await done;
        expect(bridge.store.state.extension ?? null, `origin=${origin}`).toBeNull();
        expect(bridge.hub.connected, `origin=${origin}`).toBe(false);
      },
      WS_RUNS,
    );
    expect(opened).toBeGreaterThan(0); // some connections got past the origin check and reached the protocol

    const ext = await pairedExtension(bridge);
    expect(bridge.hub.connected).toBe(true);
    expect(bridge.store.state.extension?.id).toBe(EXT_ID);
    ext.ws.close();
  });
});
