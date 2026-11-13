// Typed access to chrome.storage. All read-modify-write goes through `lock` so concurrent
// handlers in the single service-worker thread cannot lose each other's updates.
//
// local   : tools (reviewed definitions), origin grants, settings, pairing secret, run history (no entered values)
// session : in-memory only (survives worker suspension, cleared when the browser closes): owned tabs, in-flight run
//           arguments, un-acknowledged results. Entered values are NEVER written to local storage by default.

import { ANYMCP_VERSION, toolDefinitionHash, validateToolPolicy, type RunRecord } from "anymcp-protocol";
import { DEFAULT_SETTINGS, type Pairing, type Settings, type StoredToolVersion, type ToolRow, type ToolStatus } from "../shared/types";

const MAX_RUNS = 100;

let chain: Promise<unknown> = Promise.resolve();
export function lock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}
const setLocal = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

export async function getSession<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.session.get(key);
  return (r[key] as T | undefined) ?? fallback;
}
export const setSession = (key: string, value: unknown) => chrome.storage.session.set({ [key]: value });

// ---- settings / pairing / grants ----
export const getSettings = async (): Promise<Settings> => ({ ...DEFAULT_SETTINGS, ...(await getLocal<Partial<Settings>>("settings", {})) });
export const saveSettings = (s: Settings) => setLocal("settings", s);

export const getPairing = () => getLocal<Pairing | null>("pairing", null);
export const savePairing = (p: Pairing | null) => (p ? setLocal("pairing", p) : chrome.storage.local.remove("pairing"));

export const getGrants = () => getLocal<Record<string, { grantedAt: string }>>("grants", {});
export const addGrant = (origin: string) =>
  lock(async () => {
    const g = await getGrants();
    g[origin] = { grantedAt: new Date().toISOString() };
    await setLocal("grants", g);
  });
export const removeGrant = (origin: string) =>
  lock(async () => {
    const g = await getGrants();
    delete g[origin];
    await setLocal("grants", g);
  });
export const clearGrants = () => setLocal("grants", {});

// ---- tools ----
type ToolTable = Record<string, StoredToolVersion[]>;
const getTable = () => getLocal<ToolTable>("tools", {});

export async function listToolRows(): Promise<ToolRow[]> {
  const table = await getTable();
  return Object.entries(table)
    .filter(([, versions]) => versions.length > 0)
    .map(([id, versions]) => {
      const latest = versions[versions.length - 1]!;
      const view = (v: StoredToolVersion) => ({
        version: v.definition.version,
        status: v.status,
        tested: v.testedHash === v.definitionHash,
        createdAt: v.createdAt,
      });
      const enabled = versions.find((v) => v.status === "enabled");
      return {
        id,
        title: latest.definition.title,
        kind: latest.definition.kind,
        origins: latest.definition.origins,
        latest: view(latest),
        enabledVersion: enabled?.definition.version ?? null,
        versions: versions.map(view),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getToolVersion(id: string, version: number): Promise<StoredToolVersion | null> {
  const table = await getTable();
  return table[id]?.find((v) => v.definition.version === version) ?? null;
}

export async function getEnabledTools(): Promise<StoredToolVersion[]> {
  const table = await getTable();
  return Object.values(table).flatMap((vs) => vs.filter((v) => v.status === "enabled"));
}

export async function getVersions(id: string): Promise<StoredToolVersion[]> {
  return (await getTable())[id] ?? [];
}

/** Save a definition as a NEW draft version. Definitions are immutable once saved; edits create version N+1. */
export function saveDraft(def: StoredToolVersion["definition"], source: StoredToolVersion["source"]) {
  return lock(async () => {
    const issues = validateToolPolicy(def);
    if (issues.length) throw new Error(`Policy: ${issues.map((i) => i.message).join(" ")}`);
    const table = await getTable();
    const list = (table[def.id] ??= []);
    if (list.some((v) => v.definition.version === def.version)) throw new Error(`Version ${def.version} of ${def.id} already exists.`);
    const hash = await toolDefinitionHash(def);
    list.push({ definition: def, definitionHash: hash, status: "draft", testedHash: null, testedAt: null, createdAt: new Date().toISOString(), source });
    await setLocal("tools", table);
    return hash;
  });
}

export function nextVersion(id: string): Promise<number> {
  return getVersions(id).then((vs) => (vs.length ? Math.max(...vs.map((v) => v.definition.version)) + 1 : 1));
}

/** Record a passing test for exactly this definition hash. */
export function markTested(id: string, version: number, hash: string) {
  return lock(async () => {
    const table = await getTable();
    const v = table[id]?.find((x) => x.definition.version === version);
    if (!v || v.definitionHash !== hash) return;
    v.testedHash = hash;
    v.testedAt = new Date().toISOString();
    if (v.status === "draft") v.status = "tested";
    await setLocal("tools", table);
  });
}

export function setStatus(id: string, version: number, status: ToolStatus) {
  return lock(async () => {
    const table = await getTable();
    const list = table[id];
    const v = list?.find((x) => x.definition.version === version);
    if (!list || !v) throw new Error("Tool version not found.");
    if (status === "enabled") {
      if (v.testedHash !== v.definitionHash) throw new Error("Run a successful test of this exact version before enabling it.");
      for (const other of list) if (other !== v && other.status === "enabled") other.status = "superseded";
    }
    v.status = status;
    await setLocal("tools", table);
  });
}

export function disableTool(id: string) {
  return lock(async () => {
    const table = await getTable();
    for (const v of table[id] ?? []) if (v.status === "enabled") v.status = "disabled";
    await setLocal("tools", table);
  });
}

export function disableAllTools() {
  return lock(async () => {
    const table = await getTable();
    for (const list of Object.values(table)) for (const v of list) if (v.status === "enabled") v.status = "disabled";
    await setLocal("tools", table);
  });
}

export function deleteTool(id: string) {
  return lock(async () => {
    const table = await getTable();
    delete table[id];
    await setLocal("tools", table);
  });
}

// ---- run history (no entered values, no page content) ----
export const getRuns = () => getLocal<RunRecord[]>("runs", []);
export function upsertRun(record: RunRecord) {
  return lock(async () => {
    const runs = await getRuns();
    const i = runs.findIndex((r) => r.executionId === record.executionId);
    if (i >= 0) runs[i] = record;
    else runs.push(record);
    if (runs.length > MAX_RUNS) runs.splice(0, runs.length - MAX_RUNS);
    await setLocal("runs", runs);
  });
}
export const clearRuns = () => setLocal("runs", []);

export const EXTENSION_VERSION = ANYMCP_VERSION;
