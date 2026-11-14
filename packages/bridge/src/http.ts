// HTTP front door for the MCP endpoint.
//
//  - binds to loopback only (caller passes 127.0.0.1)
//  - Host and Origin validation (DNS-rebinding defence) BEFORE anything else
//  - bearer token (constant-time compare). No CORS headers are ever sent, so web pages cannot read responses.
//  - request body capped at 1 MB
//  - /health is the only unauthenticated route and reveals nothing sensitive

import { createServer, type IncomingMessage, type Server } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { ANYMCP_VERSION } from "anymcp-protocol";

export interface McpHttpOptions {
  handler: McpHttpHandler;
  getToken: () => string;
  /** Called with the client's self-reported name (from initialize or request _meta) and the time of a tool call. */
  onClientSeen: (name: string | null, calledAt: string | null) => void;
}

const MAX_BODY = 1_000_000;

/**
 * Aborts when the AI client drops the HTTP connection before the response finished. On stateless
 * Streamable HTTP the connection closing IS the cancellation signal (a separate cancelled
 * notification would land on a fresh, stateless server instance that knows nothing of the run).
 * Carried with AsyncLocalStorage so tool handlers can observe it without depending on SDK internals.
 */
export const connectionAbort = new AsyncLocalStorage<AbortSignal>();

/** Past this, an over-limit upload is cut off instead of being read and discarded. */
const DISCARD_LIMIT = 8 * MAX_BODY;

/**
 * Read a request body, or null if it is over MAX_BODY. An over-limit body is read and DISCARDED (up to a hard cap)
 * rather than cut off at once: destroying the socket mid-upload makes the client see a bare connection reset and
 * never the 413 that explains it.
 */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    let over = false;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (over) {
        if (size > DISCARD_LIMIT) req.destroy();
        return;
      }
      if (size > MAX_BODY) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!over) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => resolve(null));
  });
}

function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function peekClient(body: unknown): { name: string | null; isCall: boolean } {
  const msgs = Array.isArray(body) ? body : [body];
  let name: string | null = null;
  let isCall = false;
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const rec = m as { method?: string; params?: { clientInfo?: { name?: string }; _meta?: Record<string, unknown> } };
    if (rec.method === "tools/call") isCall = true;
    const info = rec.params?.clientInfo ?? (rec.params?._meta?.["io.modelcontextprotocol/clientInfo"] as { name?: string } | undefined);
    if (info?.name && typeof info.name === "string") name = info.name.slice(0, 60);
  }
  return { name, isCall };
}

/** JSON-RPC id of a single `tools/call` request, if the body is one. */
function toolCallId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as { method?: string; id?: string | number };
  return rec.method === "tools/call" && rec.id !== undefined ? String(rec.id) : null;
}

/** requestId of a `notifications/cancelled` notification, if the body is one. */
function cancelledRequestId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as { method?: string; params?: { requestId?: string | number } };
  return rec.method === "notifications/cancelled" && rec.params?.requestId !== undefined ? String(rec.params.requestId) : null;
}

export function createMcpHttpServer(o: McpHttpOptions): Server {
  const node = toNodeHandler(o.handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  // Stateless transport: the SDK cannot connect a later `notifications/cancelled` to the earlier
  // request, so we do. Keyed by JSON-RPC id; one bearer token means one client, so ids are unique enough.
  const inflight = new Map<string, AbortController>();

  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, name: "anymcp-bridge", version: ANYMCP_VERSION }));
        return;
      }
      if (path !== "/mcp") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (!validateHost(req, res) || !validateOrigin(req, res)) return; // they write the 403 themselves
      if (!tokenOk(req.headers.authorization, o.getToken())) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": 'Bearer realm="anymcp"' });
        res.end(JSON.stringify({ error: "unauthorized", hint: "Use the Authorization header printed by the AnyMCP bridge." }));
        return;
      }

      let parsed: unknown;
      if (req.method === "POST") {
        const raw = await readBody(req);
        if (raw === null) {
          res.writeHead(413, { "content-type": "application/json", connection: "close" });
          res.end(JSON.stringify({ error: "request too large" }));
          return;
        }
        try {
          parsed = JSON.parse(raw);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
          return;
        }
        const seen = peekClient(parsed);
        if (seen.name || seen.isCall) o.onClientSeen(seen.name, seen.isCall ? new Date().toISOString() : null);
      }
      const cancelled = cancelledRequestId(parsed);
      if (cancelled !== null) {
        inflight.get(cancelled)?.abort();
        res.writeHead(202);
        res.end();
        return;
      }

      const aborter = new AbortController();
      const callId = toolCallId(parsed);
      if (callId !== null) inflight.set(callId, aborter);
      res.on("close", () => {
        if (callId !== null && inflight.get(callId) === aborter) inflight.delete(callId);
        if (!res.writableFinished) aborter.abort();
      });
      try {
        await connectionAbort.run(aborter.signal, () => node(req, res, parsed));
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
        }
        void e;
      }
    })();
  });
}
