// Bridge <-> Extension WebSocket protocol (separate from the MCP transport).
// Every inbound message is parsed with these schemas; anything else is dropped.

import { z } from "zod";
import { ObjectSchemaZ } from "./schema-subset";
import { ResultEnvelopeZ } from "./result";
import { RUN_PHASES } from "./run-record";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_MCP_PORT = 47820;
export const DEFAULT_EXT_PORT = 47821;

export const ToolManifestZ = z.object({
  id: z.string(),
  version: z.number().int(),
  definitionHash: z.string(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(["read", "write"]),
  origins: z.array(z.string()),
  approvalRequired: z.boolean(),
  budgetMs: z.number().int().min(1000).max(900_000),
  input: ObjectSchemaZ,
  output: ObjectSchemaZ,
});

// ---- extension -> bridge ----
export const ExtToBridgeZ = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.literal(PROTOCOL_VERSION),
    extensionId: z.string().min(1).max(64),
    extensionVersion: z.string().max(32),
    mode: z.enum(["pair", "auth"]),
    pairingCode: z.string().max(16).optional(),
  }),
  z.object({ type: z.literal("auth.response"), hmac: z.string().max(128) }),
  z.object({ type: z.literal("tools.sync"), syncId: z.string().max(64), tools: z.array(ToolManifestZ).max(100) }),
  z.object({
    type: z.literal("run.event"),
    executionId: z.string(),
    phase: z.enum(RUN_PHASES),
    at: z.string(),
    detail: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("run.result"), envelope: ResultEnvelopeZ, recovered: z.boolean().optional() }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("credentials.get") }),
  /** Disconnect the AI client only: rotate the MCP token, keep the extension pairing. */
  z.object({ type: z.literal("client.revoke") }),
  /** Full revocation: unpair this extension, rotate the MCP token, forget tools. */
  z.object({ type: z.literal("revoke") }),
  z.object({ type: z.literal("ack"), ref: z.string() }),
]);
export type ExtToBridge = z.infer<typeof ExtToBridgeZ>;

// ---- bridge -> extension ----
export const BridgeToExtZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.challenge"), nonce: z.string() }),
  z.object({ type: z.literal("pair.ok"), secret: z.string() }),
  z.object({ type: z.literal("hello.rejected"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("ready"), bridgeVersion: z.string(), protocol: z.literal(PROTOCOL_VERSION), clientConnected: z.boolean() }),
  z.object({
    type: z.literal("run.request"),
    executionId: z.string(),
    toolId: z.string(),
    version: z.number().int(),
    definitionHash: z.string(),
    args: z.record(z.string(), z.unknown()),
    requestedAt: z.string(),
  }),
  z.object({ type: z.literal("run.cancel"), executionId: z.string(), reason: z.enum(["client_cancelled", "bridge_shutdown"]) }),
  z.object({
    type: z.literal("credentials"),
    mcpUrl: z.string(),
    token: z.string(),
    /** How an app that launches MCP servers as local programs (stdio) starts this bridge. Null when unknown (dev runs). */
    stdio: z.object({ command: z.string().max(1000), args: z.array(z.string().max(1000)).max(10) }).nullable().optional(),
  }),
  z.object({ type: z.literal("client.status"), lastClientName: z.string().nullable(), lastCallAt: z.string().nullable() }),
  z.object({ type: z.literal("revoked") }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("ack"), ref: z.string() }),
]);
export type BridgeToExt = z.infer<typeof BridgeToExtZ>;

export function parseJsonMessage<T>(schema: z.ZodType<T>, raw: unknown): { ok: true; msg: T } | { ok: false; error: string } {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 2_000_000) return { ok: false, error: "message too large" };
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
  }
  const r = schema.safeParse(data);
  return r.success ? { ok: true, msg: r.data } : { ok: false, error: r.error.issues.map((i) => i.message).join("; ").slice(0, 300) };
}
