import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { audit } from "../lib/audit";
import { failedAttemptStmts, lockedOut, MAX_CODE_TRIES, mfaKey, PENDING_MS, useCode } from "../lib/mfa";
import {
  clearSessionCookie,
  createSession,
  destroySessions,
  loadSessionUser,
  requireUser,
  sessionTokenHash,
  setSessionCookie,
} from "../lib/session";
import { mfa } from "./mfa";

// A real PBKDF2 hash of a throwaway value, so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(500),
});
const PasswordBody = z.object({
  current: z.string().min(1).max(500),
  next: z.string().min(10).max(500),
});

const MfaLoginBody = z.object({
  mfaToken: z.string().min(16).max(200),
  code: z.string().trim().min(1).max(40),
});

interface UserRow {
  id: string;
  name: string;
  status: string;
  password_hash: string;
  totp_enabled_at: string | null;
}

export const auth = new Hono<AppEnv>();

auth.post("/login", async (c) => {
  const parsed = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_credentials" }, 401);
  const { email, password } = parsed.data;
  const db = c.env.DB;

  if (await lockedOut(db, email)) return c.json({ error: "locked" }, 429);

  const row = await db
    .prepare("SELECT id, name, status, password_hash, totp_enabled_at FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : (await verifyPassword(password, DUMMY_HASH), false);

  if (!row || !ok || row.status === "left") {
    // Record the failure and drop this email's attempts that fell out of the window, in one batch.
    await db.batch(failedAttemptStmts(db, email));
    return c.json({ error: "bad_credentials" }, 401);
  }

  if (row.totp_enabled_at) {
    // Password is right but a code is still owed: no session yet. Failures so far are kept until the code is right.
    const mfaToken = randomToken();
    const now = Date.now();
    await db.batch([
      db.prepare("DELETE FROM mfa_pending WHERE expires_at <= ?").bind(new Date(now).toISOString()),
      db
        .prepare("INSERT INTO mfa_pending (id, user_id, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)")
        .bind(await sha256Hex(mfaToken), row.id, new Date(now + PENDING_MS).toISOString(), new Date(now).toISOString()),
    ]);
    return c.json({ mfaRequired: true, mfaToken });
  }

  await db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
  const token = await createSession(db, row.id, c.req.header("user-agent") ?? null);
  setSessionCookie(c, token);
  await audit(db, { id: row.id }, "login", "user", row.id, row.name);
  return c.json({ user: await loadSessionUser(db, row.id) });
});

/** Second sign-in step: the mfaToken from /login plus an authenticator code or a backup code. */
auth.post("/login/mfa", async (c) => {
  const parsed = MfaLoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "mfa_expired" }, 401);
  const key = await mfaKey(c.env);
  if (!key) return c.json({ error: "mfa_not_configured" }, 500);
  const db = c.env.DB;
  const id = await sha256Hex(parsed.data.mfaToken);
  const now = new Date().toISOString();
  const p = await db
    .prepare(
      `SELECT p.expires_at, p.attempts, u.id, u.name, u.email, u.status, u.totp_secret_enc, u.totp_enabled_at, u.totp_last_step
         FROM mfa_pending p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    )
    .bind(id)
    .first<{
      expires_at: string; attempts: number; id: string; name: string; email: string; status: string;
      totp_secret_enc: string | null; totp_enabled_at: string | null; totp_last_step: number | null;
    }>();
  if (!p || !(Date.parse(p.expires_at) > Date.now()) || p.attempts >= MAX_CODE_TRIES || p.status === "left" || !p.totp_enabled_at) {
    if (p) await db.prepare("DELETE FROM mfa_pending WHERE id = ?").bind(id).run();
    return c.json({ error: "mfa_expired" }, 401);
  }
  if (await lockedOut(db, p.email)) return c.json({ error: "locked" }, 429);

  // Take a try before checking, so parallel guesses cannot exceed the limit.
  const took = await db
    .prepare("UPDATE mfa_pending SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND expires_at > ?")
    .bind(id, MAX_CODE_TRIES, now)
    .run();
  if (took.meta.changes !== 1) return c.json({ error: "mfa_expired" }, 401);

  const kind = await useCode(db, key, p, parsed.data.code, true);
  if (!kind) {
    await db.batch([
      ...failedAttemptStmts(db, p.email),
      db.prepare("DELETE FROM mfa_pending WHERE id = ? AND attempts >= ?").bind(id, MAX_CODE_TRIES),
    ]);
    return c.json({ error: "bad_code" }, 401);
  }
  const used = await db.prepare("DELETE FROM mfa_pending WHERE id = ?").bind(id).run();
  if (used.meta.changes !== 1) return c.json({ error: "mfa_expired" }, 401);

  await db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(p.email).run();
  const token = await createSession(db, p.id, c.req.header("user-agent") ?? null);
  setSessionCookie(c, token);
  await audit(db, { id: p.id }, "login", "user", p.id, p.name, { mfa: kind });
  return c.json({ user: await loadSessionUser(db, p.id) });
});

auth.route("/mfa", mfa);

auth.post("/logout", requireUser, async (c) => {
  const user = c.var.user!;
  const sid = await sessionTokenHash(c);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  clearSessionCookie(c);
  await audit(c.env.DB, user, "logout", "user", user.id, user.name);
  return c.json({ ok: true });
});

auth.post("/password", requireUser, async (c) => {
  const user = c.var.user!;
  const parsed = PasswordBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { current, next } = parsed.data;
  if (next === current) return c.json({ error: "same_password" }, 400);
  const db = c.env.DB;
  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<UserRow>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return c.json({ error: "wrong_current_password" }, 400);
  }
  const { hash, salt } = await hashPassword(next);
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .bind(hash, salt, new Date().toISOString(), user.id)
    .run();
  // Sign out every other device; keep this one.
  const sid = await sessionTokenHash(c);
  await destroySessions(db, user.id, sid ?? undefined);
  await audit(db, user, "password_change", "user", user.id, user.name);
  return c.json({ ok: true });
});
