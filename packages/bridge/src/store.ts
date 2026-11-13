// Local bridge state. Holds the extension pairing secret and the MCP client token.
// Never contains page content, typed values or tool outputs (outputs are stripped from run records).

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomHex, redactEnvelopeForStorage, type ResultEnvelope } from "anymcp-protocol";

export interface PairedExtension {
  id: string;
  secret: string;
  pairedAt: string;
}

export interface BridgeState {
  version: 1;
  mcpToken: string;
  extension: PairedExtension | null;
  runs: ResultEnvelope[];
}

const MAX_RUNS = 200;

/**
 * Where the bridge keeps its state. `ANYMCP_HOME` overrides it (`MYCP_HOME`, the pre-release name, still works).
 * Pre-release builds kept their state in `~/.mycp`: if only that exists, its state (pairing + client token) is
 * copied to `~/.anymcp` once, so an existing browser pairing keeps working. The old folder is left for the user
 * to delete.
 */
export function defaultHome(): string {
  const fromEnv = process.env.ANYMCP_HOME ?? process.env.MYCP_HOME;
  if (fromEnv) return fromEnv;
  const home = join(homedir(), ".anymcp");
  const legacyState = join(homedir(), ".mycp", "state.json");
  if (!existsSync(join(home, "state.json")) && existsSync(legacyState)) {
    try {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      copyFileSync(legacyState, join(home, "state.json"));
      chmodSync(join(home, "state.json"), 0o600);
    } catch {
      /* fall through: a fresh state is created and the browser simply pairs again */
    }
  }
  return home;
}

export class StateStore {
  readonly dir: string;
  private file: string;
  state: BridgeState;

  constructor(dir: string = defaultHome()) {
    this.dir = dir;
    this.file = join(dir, "state.json");
    mkdirSync(dir, { recursive: true });
    this.state = this.load();
    this.save();
  }

  private load(): BridgeState {
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<BridgeState>;
        if (parsed.version === 1 && typeof parsed.mcpToken === "string" && parsed.mcpToken.length >= 32) {
          return { version: 1, mcpToken: parsed.mcpToken, extension: parsed.extension ?? null, runs: parsed.runs ?? [] };
        }
      } catch {
        /* fall through to a fresh state; a corrupt file must not stop the bridge */
      }
    }
    return { version: 1, mcpToken: randomHex(32), extension: null, runs: [] };
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600); // no-op on Windows; the user profile ACL applies there
    } catch {
      /* ignore */
    }
  }

  rotateToken(): string {
    this.state.mcpToken = randomHex(32);
    this.save();
    return this.state.mcpToken;
  }

  setExtension(ext: PairedExtension): void {
    this.state.extension = ext;
    this.save();
  }

  clearExtension(): void {
    this.state.extension = null;
    this.save();
  }

  /**
   * Insert or replace a run record (matched by executionId). Outputs are never persisted.
   * Run history is a convenience: if it cannot be written (disk full, folder deleted) the result still reaches the
   * client and the bridge keeps running. Pairing and token changes, by contrast, throw — a revoked token that
   * silently comes back after a restart would be a security bug.
   */
  upsertRun(envelope: ResultEnvelope): void {
    const stored = redactEnvelopeForStorage(envelope);
    const i = this.state.runs.findIndex((r) => r.executionId === envelope.executionId);
    if (i >= 0) this.state.runs[i] = stored;
    else this.state.runs.push(stored);
    if (this.state.runs.length > MAX_RUNS) this.state.runs.splice(0, this.state.runs.length - MAX_RUNS);
    try {
      this.save();
    } catch (e) {
      if (!this.warnedHistory) process.stderr.write(`AnyMCP bridge: could not save run history (${(e as Error).message}). Results are still returned.
`);
      this.warnedHistory = true;
    }
  }
  private warnedHistory = false;

  getRun(executionId: string): ResultEnvelope | undefined {
    return this.state.runs.find((r) => r.executionId === executionId);
  }
}
