// `mycp-bridge --stdio`: MCP over stdin/stdout, for AI apps that launch their tools as a local program
// (Claude Desktop, Cursor and others). Stdout carries ONLY protocol messages; every log line goes to stderr.
//
// One bridge owns the browser connection on this computer. This process:
//   - BECOMES that bridge (MCP over HTTP + the extension WebSocket, loopback only) if none is running, or
//   - FORWARDS to the one that is running (one started in a terminal, or one another app launched), and
//   - takes over if the bridge it forwarded to goes away.
// Either way every tool is served by the SAME HTTP handler, so behaviour cannot drift between transports.
//
// Forwarding never repeats a tool call that may have reached the bridge: a call is retried only when the
// connection was refused outright (nothing was sent) or rejected as unauthorised (nothing ran).

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer, fromJsonSchema, type RegisteredTool } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { MYCP_VERSION } from "mycp-protocol";
import { startBridge, type BridgeHandle, type BridgeOptions } from "./bridge";

/** A tool as `tools/list` returns it. */
interface RemoteTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

type CallResult = { content: unknown[]; structuredContent?: Record<string, unknown>; isError?: boolean };

export interface StdioOptions {
  home: string;
  mcpPort: number;
  extPort: number;
  log: (line: string) => void;
  /** How often to look for tool changes, in ms. */
  pollMs?: number;
  /** Extra options for a bridge this process starts itself (tests). */
  bridge?: Partial<BridgeOptions>;
}

/** Walks an error and its causes. */
function* chain(e: unknown): Generator<Record<string, unknown>> {
  for (let cur = e, i = 0; cur && typeof cur === "object" && i < 8; cur = (cur as { cause?: unknown }).cause, i++) yield cur as Record<string, unknown>;
}
const refused = (e: unknown) => [...chain(e)].some((x) => x.code === "ECONNREFUSED" || /ECONNREFUSED/.test(String(x.message ?? "")));
const unauthorized = (e: unknown) => [...chain(e)].some((x) => x.status === 401 || x.statusCode === 401 || /\b401\b|unauthori[sz]ed/i.test(String(x.message ?? "")));

/** The request certainly never reached a bridge (none could be reached or it refused the connection): nothing ran. */
export class NotSent extends Error {
  constructor(readonly reason: unknown) {
    super(`MyCP bridge not reachable: ${String((reason as Error)?.message ?? reason)}`);
  }
}

/** Read the MCP token of the bridge that owns `home` WITHOUT writing anything (it may be another process's file). */
function readToken(home: string): string {
  try {
    const st = JSON.parse(readFileSync(join(home, "state.json"), "utf8")) as { mcpToken?: unknown };
    return typeof st.mcpToken === "string" ? st.mcpToken : "";
  } catch {
    return "";
  }
}

/** True if something accepts connections on 127.0.0.1:port (a bridge is probably running there). */
export function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = tcpConnect({ host: "127.0.0.1", port });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(1000, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** The connection to whichever bridge currently owns the browser link. */
export class Upstream extends EventEmitter<{ tools: [RemoteTool[]] }> {
  own: BridgeHandle | null = null;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private tools: RemoteTool[] = [];
  private toolsJson = "[]";
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly o: StdioOptions) {
    super();
  }

  get currentTools(): RemoteTool[] {
    return this.tools;
  }

  /** Become the bridge, or (if one is already running) prepare to forward to it. */
  private async acquire(): Promise<{ url: string; token: string }> {
    if (this.own) return { url: this.own.mcpUrl, token: this.own.token() };
    const forward = () => {
      const url = `http://127.0.0.1:${this.o.mcpPort}/mcp`;
      this.o.log(`another MyCP bridge is already running; forwarding to ${url}`);
      return { url, token: readToken(this.o.home) };
    };
    // a bridge is already there: forward without touching its state at all
    if (await listening(this.o.mcpPort)) return forward();
    try {
      this.own = await startBridge({ ...this.o.bridge, home: this.o.home, mcpPort: this.o.mcpPort, extPort: this.o.extPort, log: this.o.log });
      this.own.hub.on("tools", () => void this.refresh());
      this.o.log(`serving as the MyCP bridge (extension channel ${this.own.extUrl})`);
      if (!this.own.store.state.extension) this.o.log(`not paired yet: enter ${this.own.pairingCode().replace(/^(\d{4})/, "$1 ")} in the MyCP side panel (Connect)`);
      return { url: this.own.mcpUrl, token: this.own.token() };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      return forward(); // lost a start-up race with another bridge
    }
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          const { url, token } = await this.acquire();
          const client = new Client({ name: "mycp-stdio", version: MYCP_VERSION });
          try {
            await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
            this.client = client;
            return client;
          } catch (e) {
            await client.close().catch(() => undefined);
            // the bridge we were about to forward to has just gone away: take over (once)
            if (attempt === 0 && refused(e) && !this.own) continue;
            throw e;
          }
        }
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  /** Forget the current connection (the next call reconnects, taking over if needed). */
  private reset(): void {
    const c = this.client;
    this.client = null;
    void c?.close().catch(() => undefined);
  }

  private async connectOrNotSent(): Promise<Client> {
    try {
      return await this.connect();
    } catch (e) {
      throw new NotSent(e);
    }
  }

  /**
   * Run `fn` against the bridge. Retries once, and only when the request certainly did not run (connection refused,
   * or rejected as unauthorised after a token change). Throws NotSent when no bridge could take the request.
   */
  private async withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const first = await this.connectOrNotSent();
    try {
      return await fn(first);
    } catch (e) {
      if (!refused(e) && !unauthorized(e)) throw e;
      this.reset();
      const second = await this.connectOrNotSent();
      try {
        return await fn(second);
      } catch (e2) {
        if (refused(e2) || unauthorized(e2)) throw new NotSent(e2);
        throw e2;
      }
    }
  }

  async refresh(): Promise<void> {
    if (this.closed) return;
    try {
      const { tools } = await this.withClient((c) => c.listTools());
      const json = JSON.stringify(tools);
      if (json !== this.toolsJson) {
        this.toolsJson = json;
        this.tools = tools as RemoteTool[];
        this.emit("tools", this.tools);
      }
    } catch (e) {
      this.o.log(`could not list tools: ${String((e as Error).message ?? e)}`);
    }
  }

  async start(): Promise<void> {
    await this.refresh();
    const tick = () => {
      this.timer = setTimeout(() => void this.refresh().finally(() => !this.closed && tick()), this.o.pollMs ?? 3000);
      this.timer.unref?.();
    };
    tick();
  }

  callTool(name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; onprogress?: (p: { progress: number; total?: number; message?: string }) => void; clientName?: string }): Promise<CallResult> {
    return this.withClient(
      (c) =>
        c.callTool(
          { name, arguments: args, ...(opts.clientName ? { _meta: { "io.modelcontextprotocol/clientInfo": { name: opts.clientName } } } : {}) },
          {
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(opts.onprogress ? { onprogress: opts.onprogress } : {}),
            // a write waits for a person to approve in the browser: allow minutes, and keep waiting while progress arrives
            timeout: 15 * 60_000,
            resetTimeoutOnProgress: true,
          },
        ) as Promise<CallResult>,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.reset();
    await this.own?.close();
    this.own = null;
  }
}

const textResult = (text: string): CallResult => ({ content: [{ type: "text", text }], isError: true });

/** Turn a failed forward into an honest answer: nothing ran, the bridge said no, or the outcome is unknown. */
export function forwardFailure(name: string, e: unknown): CallResult {
  if (e instanceof NotSent || refused(e)) return textResult("MyCP: the MyCP bridge could not be reached, so nothing ran. It is safe to try again in a moment.");
  const code = (e as { code?: unknown }).code;
  if (typeof code === "number") return textResult(`MyCP: the bridge refused the request (${String((e as Error).message ?? e)}). Nothing ran.`);
  return textResult(
    `MyCP: the connection to the MyCP bridge was lost or timed out while “${name}” was running, so its outcome is unknown. Do NOT retry automatically: the action may already have happened. Ask the user to check the website and the run history in the MyCP side panel.`,
  );
}

/** One MCP server for the stdio connection, mirroring the bridge's current tools and forwarding calls to it. */
export function buildForwardingServer(up: Upstream): McpServer {
  const server = new McpServer({ name: "mycp", version: MYCP_VERSION }, { capabilities: { tools: { listChanged: true } } });
  const registered = new Map<string, { reg: RegisteredTool; json: string }>();

  const sync = (tools: RemoteTool[]) => {
    const wanted = new Map(tools.map((t) => [t.name, t]));
    let changed = false;
    for (const [name, r] of registered) {
      const t = wanted.get(name);
      if (!t || JSON.stringify(t) !== r.json) {
        r.reg.remove();
        registered.delete(name);
        changed = true;
      }
    }
    for (const t of tools) {
      if (registered.has(t.name)) continue;
      const reg = server.registerTool(
        t.name,
        {
          ...(t.title ? { title: t.title } : {}),
          ...(t.description ? { description: t.description } : {}),
          inputSchema: fromJsonSchema(t.inputSchema as never),
          ...(t.outputSchema ? { outputSchema: fromJsonSchema(t.outputSchema as never) } : {}),
          ...(t.annotations ? { annotations: t.annotations } : {}),
        },
        (async (args: unknown, ctx: { mcpReq: { signal?: AbortSignal; _meta?: unknown; notify: (n: unknown) => Promise<void> } }) => {
          const token = (ctx.mcpReq._meta as { progressToken?: string | number } | undefined)?.progressToken;
          const app = server.server.getClientVersion()?.name;
          try {
            return await up.callTool(t.name, (args ?? {}) as Record<string, unknown>, {
              ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
              ...(token === undefined
                ? {}
                : { onprogress: (p) => void ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, ...p } }).catch(() => undefined) }),
              clientName: app ? `${app} (via stdio)` : "an app (via stdio)",
            });
          } catch (e) {
            return forwardFailure(t.name, e);
          }
        }) as never,
      );
      registered.set(t.name, { reg, json: JSON.stringify(t) });
      changed = true;
    }
    if (changed && server.isConnected()) {
      try {
        server.sendToolListChanged();
      } catch {
        /* the client may not support change notifications; it will see the new list next time it asks */
      }
    }
  };
  sync(up.currentTools);
  up.on("tools", sync);
  return server;
}

/** Entry point for `mycp-bridge --stdio`. Resolves once stdio is being served. */
export async function runStdio(o: StdioOptions): Promise<{ upstream: Upstream; close: () => Promise<void> }> {
  const upstream = new Upstream(o);
  await upstream.start();
  const handle = serveStdio(() => buildForwardingServer(upstream), { onerror: (e) => o.log(`stdio error: ${e.message}`) });
  const close = async () => {
    await handle.close().catch(() => undefined);
    await upstream.close();
  };
  return { upstream, close };
}
