/* Two-step sign-in storage: the encrypted TOTP secret, one-time backup codes, code checks with replay protection,
   and the shared sign-in lockout. Never log or audit a secret or a code. */
import type { Env } from "../env";
import { fromB64, sha256Hex, toB64 } from "./crypto";
import { verifyTotp } from "./totp";

/* ---------- sign-in lockout (shared by the password step and every code check) ---------- */

export const MAX_FAILED = 5;
export const WINDOW_MS = 15 * 60_000;

export async function lockedOut(db: D1Database, email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const r = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?").bind(email, since).first<{ n: number }>();
  return (r?.n ?? 0) >= MAX_FAILED;
}

/** Records one failure and drops this email's attempts that fell out of the window. */
export function failedAttemptStmts(db: D1Database, email: string): D1PreparedStatement[] {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  return [
    db.prepare("DELETE FROM login_attempts WHERE email = ? AND at <= ?").bind(email, since),
    db.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind(email, new Date().toISOString()),
  ];
}

/* ---------- MFA_KEY and the encrypted secret ---------- */

export const PENDING_MS = 5 * 60_000;
export const MAX_CODE_TRIES = 5;

const keys = new Map<string, Promise<CryptoKey | null>>();

/** The AES-256-GCM key from the MFA_KEY secret (base64 of 32 bytes). null when missing or malformed: callers fail closed. */
export function mfaKey(env: Pick<Env, "MFA_KEY">): Promise<CryptoKey | null> {
  const raw = (env.MFA_KEY ?? "").trim();
  if (!raw) return Promise.resolve(null);
  let p = keys.get(raw);
  if (!p) {
    p = (async () => {
      try {
        const bytes = fromB64(raw);
        if (bytes.length !== 32) return null;
        return await crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
      } catch {
        return null;
      }
    })();
    keys.set(raw, p);
  }
  return p;
}

// The user id is bound in as associated data, so a ciphertext copied onto another account does not decrypt.
const aad = (userId: string) => new TextEncoder().encode(`luxcrm-totp:${userId}`);

/** `v1.<iv b64>.<ciphertext b64>` */
export async function encryptSecret(key: CryptoKey, userId: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(userId) }, key, new TextEncoder().encode(secret));
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(key: CryptoKey, userId: string, enc: string | null): Promise<string | null> {
  if (!enc) return null;
  const parts = enc.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(parts[1]) as BufferSource, additionalData: aad(userId) },
      key,
      fromB64(parts[2]) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/* ---------- backup codes ---------- */

// No 0/O, 1/I/L. 31 characters.
const BACKUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const BACKUP_COUNT = 8;

function randomChars(n: number): string {
  const limit = 256 - (256 % BACKUP_ALPHABET.length);
  let out = "";
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < n) out += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    }
  }
  return out;
}

/** 8 distinct codes shaped `XXXX-XXXX`. */
export function generateBackupCodes(): string[] {
  const set = new Set<string>();
  while (set.size < BACKUP_COUNT) {
    const s = randomChars(8);
    set.add(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return [...set];
}

/** Upper-case, separators removed. null unless it is 8 characters of the backup alphabet. */
export function normalizeBackupCode(code: string): string | null {
  const s = code.toUpperCase().replace(/[\s-]/g, "");
  return s.length === 8 && [...s].every((ch) => BACKUP_ALPHABET.includes(ch)) ? s : null;
}

const hashBackupCode = (userId: string, normalized: string) => sha256Hex(`${userId}:${normalized}`);

/** Inserts for a fresh set of backup codes. With `when`, each insert only happens while that SQL condition holds. */
export async function backupCodeStmts(
  db: D1Database,
  userId: string,
  codes: string[],
  now: string,
  when?: { sql: string; args: unknown[] },
): Promise<D1PreparedStatement[]> {
  const out: D1PreparedStatement[] = [];
  for (const code of codes) {
    const hash = await hashBackupCode(userId, normalizeBackupCode(code)!);
    out.push(
      when
        ? db
            .prepare(`INSERT INTO mfa_backup_codes (id, user_id, code_hash, used_at, created_at) SELECT ?, ?, ?, NULL, ? WHERE ${when.sql}`)
            .bind(crypto.randomUUID(), userId, hash, now, ...when.args)
        : db
            .prepare("INSERT INTO mfa_backup_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)")
            .bind(crypto.randomUUID(), userId, hash, now),
    );
  }
  return out;
}

/* ---------- checking a code ---------- */

export interface MfaRow {
  id: string;
  totp_secret_enc: string | null;
  totp_enabled_at: string | null;
  totp_last_step: number | null;
}

/** A current authenticator code. On success the step is stored, atomically, so the same code never works twice. */
export async function useTotp(db: D1Database, key: CryptoKey, row: MfaRow, code: string): Promise<boolean> {
  const secret = await decryptSecret(key, row.id, row.totp_secret_enc);
  if (!secret) return false;
  const step = await verifyTotp(secret, code.replace(/\s/g, ""), Date.now(), row.totp_last_step);
  if (step === null) return false;
  const res = await db
    .prepare(
      `UPDATE users SET totp_last_step = ?
        WHERE id = ? AND totp_secret_enc = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    )
    .bind(step, row.id, row.totp_secret_enc, step)
    .run();
  return res.meta.changes === 1;
}

/** Marks an unused backup code as used. True only for the request that used it. */
export async function useBackupCode(db: D1Database, userId: string, code: string): Promise<boolean> {
  const norm = normalizeBackupCode(code);
  if (!norm) return false;
  const res = await db
    .prepare("UPDATE mfa_backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
    .bind(new Date().toISOString(), userId, await hashBackupCode(userId, norm))
    .run();
  return res.meta.changes === 1;
}

/** Six digits are an authenticator code; anything else is tried as a backup code (when allowed). */
export async function useCode(
  db: D1Database,
  key: CryptoKey,
  row: MfaRow,
  code: string,
  allowBackup: boolean,
): Promise<"totp" | "backup" | null> {
  if (!row.totp_enabled_at) return null;
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) return (await useTotp(db, key, row, code)) ? "totp" : null;
  if (allowBackup && (await useBackupCode(db, row.id, code))) return "backup";
  return null;
}
