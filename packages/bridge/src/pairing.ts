// One-time pairing codes. The code proves the person at the terminal is the person
// operating the browser. It is single-use, expires, and is rate-limited by attempts.

import { randomInt } from "node:crypto";
import { timingSafeEqual } from "node:crypto";

export interface PairingOptions {
  ttlMs?: number;
  maxAttempts?: number;
  onNewCode?: (code: string) => void;
}

export class PairingManager {
  private code = "";
  private expiresAt = 0;
  private attempts = 0;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly onNewCode?: (code: string) => void;

  constructor(opts: PairingOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.onNewCode = opts.onNewCode;
    this.issue(false);
  }

  /** Issue a fresh code (invalidates the previous one). */
  issue(announce = true): string {
    this.code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    this.expiresAt = Date.now() + this.ttlMs;
    this.attempts = 0;
    if (announce) this.onNewCode?.(this.code);
    return this.code;
  }

  current(): { code: string; expiresAt: number } {
    return { code: this.code, expiresAt: this.expiresAt };
  }

  /** Returns true exactly once for the correct, unexpired code. */
  consume(candidate: string): { ok: true } | { ok: false; reason: "expired" | "too_many_attempts" | "wrong_code" } {
    if (Date.now() > this.expiresAt) {
      this.issue();
      return { ok: false, reason: "expired" };
    }
    if (this.attempts >= this.maxAttempts) {
      this.issue();
      return { ok: false, reason: "too_many_attempts" };
    }
    this.attempts++;
    const a = Buffer.from(candidate.replace(/\s+/g, ""));
    const b = Buffer.from(this.code);
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) return { ok: false, reason: "wrong_code" };
    this.issue(false); // single use: the used code can never pair again (no announcement needed)
    return { ok: true };
  }
}
