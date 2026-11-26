/* Two-step sign-in for the signed-in person: status, enrol, new backup codes, turn off. Mounted at /api/auth/mfa.
   Admin reset of someone else lives in routes/users.ts. */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditStmt, auditStmtWhen } from "../lib/audit";
import { verifyPassword } from "../lib/crypto";
import {
  backupCodeStmts,
  decryptSecret,
  encryptSecret,
  failedAttemptStmts,
  generateBackupCodes,
  lockedOut,
  mfaKey,
  useCode,
  useTotp,
  type MfaRow,
} from "../lib/mfa";
import { requireUser } from "../lib/session";
import { generateSecret, otpauthUri, verifyTotp } from "../lib/totp";

const CodeBody = z.object({ code: z.string().trim().min(1).max(40) });
const DisableBody = z.object({ password: z.string().min(1).max(500), code: z.string().trim().min(1).max(40) });

interface Row extends MfaRow {
  name: string;
  email: string;
  password_hash: string;
}

const loadRow = (db: D1Database, id: string) =>
  db
    .prepare("SELECT id, name, email, password_hash, totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = ?")
    .bind(id)
    .first<Row>();

const NOT_CONFIGURED = { error: "mfa_not_configured" } as const;

export const mfa = new Hono<AppEnv>();

mfa.use("*", requireUser);

mfa.get("/", async (c) => {
  const user = c.var.user!;
  const db = c.env.DB;
  const row = await loadRow(db, user.id);
  const left = await db
    .prepare("SELECT COUNT(*) AS n FROM mfa_backup_codes WHERE user_id = ? AND used_at IS NULL")
    .bind(user.id)
    .first<{ n: number }>();
  const enabled = !!row?.totp_enabled_at;
  return c.json({
    enabled,
    required: user.mfaRequired,
    enabledAt: row?.totp_enabled_at ?? null,
    backupCodesLeft: enabled ? (left?.n ?? 0) : 0,
  });
});

/** Starts (or restarts) enrolment: a fresh secret, stored encrypted, not active until /enable. */
mfa.post("/setup", async (c) => {
  const user = c.var.user!;
  const key = await mfaKey(c.env);
  if (!key) return c.json(NOT_CONFIGURED, 500);
  const db = c.env.DB;
  const secret = generateSecret();
  const res = await db
    .prepare("UPDATE users SET totp_secret_enc = ?, totp_last_step = NULL WHERE id = ? AND totp_enabled_at IS NULL")
    .bind(await encryptSecret(key, user.id, secret), user.id)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "already_enabled" }, 409);
  return c.json({ secret, uri: otpauthUri(user.email, secret) });
});

/** Confirms enrolment with a current code. Returns the backup codes, shown once. */
mfa.post("/enable", async (c) => {
  const user = c.var.user!;
  const key = await mfaKey(c.env);
  if (!key) return c.json(NOT_CONFIGURED, 500);
  const parsed = CodeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_code" }, 400);
  const db = c.env.DB;
  const row = await loadRow(db, user.id);
  if (!row) return c.json({ error: "signed_out" }, 401);
  if (row.totp_enabled_at) return c.json({ error: "already_enabled" }, 409);
  const secret = await decryptSecret(key, user.id, row.totp_secret_enc);
  if (!secret) return c.json({ error: "no_pending_setup" }, 400);
  const step = await verifyTotp(secret, parsed.data.code.replace(/\s/g, ""), Date.now(), null);
  if (step === null) return c.json({ error: "bad_code" }, 400);

  const now = new Date().toISOString();
  const codes = generateBackupCodes();
  // Everything after the UPDATE only happens if it really switched on (it stamps this request's time).
  const done = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND totp_enabled_at = ?)", args: [user.id, now] };
  const res = await db.batch([
    db
      .prepare(
        `UPDATE users SET totp_enabled_at = ?, totp_last_step = ?, updated_at = ?
          WHERE id = ? AND totp_enabled_at IS NULL AND totp_secret_enc = ?`,
      )
      .bind(now, step, now, user.id, row.totp_secret_enc),
    db.prepare(`DELETE FROM mfa_backup_codes WHERE user_id = ? AND ${done.sql}`).bind(user.id, ...done.args),
    ...(await backupCodeStmts(db, user.id, codes, now, done)),
    auditStmtWhen(db, done, user, "mfa_enabled", "user", user.id, user.name),
  ]);
  if (res[0].meta.changes !== 1) return c.json({ error: "already_enabled" }, 409);
  return c.json({ backupCodes: codes });
});

/** New backup codes (the old ones stop working). Needs a current authenticator code. */
mfa.post("/backup-codes", async (c) => {
  const user = c.var.user!;
  const key = await mfaKey(c.env);
  if (!key) return c.json(NOT_CONFIGURED, 500);
  const parsed = CodeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_code" }, 400);
  const db = c.env.DB;
  const row = await loadRow(db, user.id);
  if (!row?.totp_enabled_at) return c.json({ error: "not_enabled" }, 400);
  if (await lockedOut(db, row.email)) return c.json({ error: "locked" }, 429);
  if (!(await useTotp(db, key, row, parsed.data.code))) {
    await db.batch(failedAttemptStmts(db, row.email));
    return c.json({ error: "bad_code" }, 400);
  }
  const now = new Date().toISOString();
  const codes = generateBackupCodes();
  await db.batch([
    db.prepare("DELETE FROM mfa_backup_codes WHERE user_id = ?").bind(user.id),
    ...(await backupCodeStmts(db, user.id, codes, now)),
    auditStmt(db, user, "backup_codes_regenerated", "user", user.id, user.name),
  ]);
  return c.json({ backupCodes: codes });
});

/** Turn off: password plus a current code (or a backup code). Admins cannot. */
mfa.post("/disable", async (c) => {
  const user = c.var.user!;
  if (user.mfaRequired) return c.json({ error: "admin_mfa_required" }, 403);
  const key = await mfaKey(c.env);
  if (!key) return c.json(NOT_CONFIGURED, 500);
  const parsed = DisableBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const db = c.env.DB;
  const row = await loadRow(db, user.id);
  if (!row?.totp_enabled_at) return c.json({ error: "not_enabled" }, 400);
  if (await lockedOut(db, row.email)) return c.json({ error: "locked" }, 429);
  if (!(await verifyPassword(parsed.data.password, row.password_hash))) {
    await db.batch(failedAttemptStmts(db, row.email));
    return c.json({ error: "wrong_password" }, 400);
  }
  if (!(await useCode(db, key, row, parsed.data.code, true))) {
    await db.batch(failedAttemptStmts(db, row.email));
    return c.json({ error: "bad_code" }, 400);
  }
  await db.batch([
    db
      .prepare("UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), user.id),
    db.prepare("DELETE FROM mfa_backup_codes WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM mfa_pending WHERE user_id = ?").bind(user.id),
    auditStmt(db, user, "mfa_disabled", "user", user.id, user.name),
  ]);
  return c.json({ ok: true });
});
