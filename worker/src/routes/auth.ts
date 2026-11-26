/* Sign-in is Google only: /google/start -> Google -> /google/callback, then (if two-step sign-in is on) the code step
   at /login/mfa. Password sign-in and password changes are gone (410 google_only). */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { audit, auditStmt, auditStmtWhen } from "../lib/audit";
import { authorizeUrl, exchangeCode, googleConfig, oauthNonce, pkceChallenge, pkceVerifier, redirectUri, verifyIdToken } from "../lib/google";
import type { GoogleIdentity } from "../lib/google";
import { clearAttemptsStmt, MAX_CODE_TRIES, mfaKey, PENDING_MS, takeAttempt, useCode } from "../lib/mfa";
import { notifyStmts } from "../lib/notify";
import { clearSessionCookie, createSession, loadSessionUser, mayHaveSession, requireUser, sessionTokenHash, setSessionCookie } from "../lib/session";
import { mfa } from "./mfa";

/** Binds a Google round trip to the browser that started it. Holds the secret the PKCE verifier and nonce come from. */
const FLOW_COOKIE = "lux_oauth";
const FLOW_PATH = "/api/auth/google";
const FLOW_MS = 10 * 60_000;
/** Google done, authenticator code still owed. Holds the token whose SHA-256 is the mfa_pending id. */
const MFA_COOKIE = "lux_mfa";
const MFA_PATH = "/api/auth/login";

/** The only places a sign-in can land. Chosen from a fixed list, never from a URL. */
const RETURN_TO: Record<string, string> = { "two-step": "/account/two-step" };

const CodeBody = z.object({ code: z.string().trim().min(1).max(40) });

const GOOGLE_ONLY = { error: "google_only" } as const;

interface AccountRow {
  id: string;
  name: string;
  email: string;
  status: string;
  approval: string;
  totp_enabled_at: string | null;
  google_sub: string | null;
}
const ACCOUNT_COLS = "id, name, email, status, approval, totp_enabled_at, google_sub";

const isUnique = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? "") + String((e as Error)?.cause ?? ""));

const hexEqual = (a: string, b: string) => timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));

/**
 * Finds (or makes) the account for a verified Google identity.
 *  1. Google's `sub` already linked: that account. The email Google sends is not used to match again.
 *  2. Otherwise an account with this verified email that has never been linked: link it now.
 *     An account with this email that is linked to a different Google account is refused (no takeover).
 *  3. Otherwise, if there are no accounts at all, this person becomes the first Admin (atomic, once).
 *  4. Otherwise a new account waiting for an admin's approval; every admin is told.
 */
async function resolveAccount(db: D1Database, who: GoogleIdentity): Promise<{ user: AccountRow } | { error: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const bySub = await db.prepare(`SELECT ${ACCOUNT_COLS} FROM users WHERE google_sub = ?`).bind(who.sub).first<AccountRow>();
    if (bySub) return { user: bySub };

    const now = new Date().toISOString();
    const byEmail = await db.prepare(`SELECT ${ACCOUNT_COLS} FROM users WHERE email = ?`).bind(who.email).first<AccountRow>();
    if (byEmail) {
      if (byEmail.google_sub !== null) return { error: "account_conflict" };
      try {
        const res = await db.batch([
          db.prepare("UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ? AND google_sub IS NULL").bind(who.sub, now, byEmail.id),
          auditStmtWhen(
            db,
            { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND google_sub = ? AND updated_at = ?)", args: [byEmail.id, who.sub, now] },
            { id: byEmail.id }, "google_linked", "user", byEmail.id, byEmail.name, { by: "email" },
          ),
        ]);
        if (res[0].meta.changes === 1) return { user: { ...byEmail, google_sub: who.sub } };
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
      continue; // someone else linked it in the meantime: look again
    }

    const id = crypto.randomUUID();
    // First ever sign-in: the Admin. Only inserts while the users table is empty, so it happens once.
    const first = await db
      .prepare(
        `INSERT INTO users (id, email, name, role, position_id, dept, status, approval, google_sub, password_hash, password_salt,
                            must_change_password, created_at, updated_at)
         SELECT ?, ?, ?, 'admin', 'pos_admin', 'Management', 'active', 'approved', ?, 'google-only', '', 0, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM users)`,
      )
      .bind(id, who.email, who.name, who.sub, now, now)
      .run()
      .catch((e) => {
        if (isUnique(e)) return null;
        throw e;
      });
    if (first === null) continue;
    if (first.meta.changes === 1) {
      await audit(db, { id }, "setup", "user", id, who.name, { role: "admin", via: "google" });
      return { user: { id, name: who.name, email: who.email, status: "active", approval: "approved", totp_enabled_at: null, google_sub: who.sub } };
    }

    const admins = await db
      .prepare("SELECT u.id FROM users u JOIN positions p ON p.id = u.position_id WHERE p.is_admin = 1 AND u.status != 'left' AND u.approval = 'approved'")
      .all<{ id: string }>();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users (id, email, name, role, position_id, dept, status, approval, google_sub, password_hash, password_salt,
                                must_change_password, created_at, updated_at)
             VALUES (?, ?, ?, 'employee', NULL, '', 'active', 'pending', ?, 'google-only', '', 0, ?, ?)`,
          )
          .bind(id, who.email, who.name, who.sub, now, now),
        auditStmt(db, { id }, "access_requested", "user", id, who.name, { email: who.email }),
        ...notifyStmts(db, admins.results.map((r) => r.id), "access_request", `${who.name} is asking to join`, "/users?tab=waiting"),
      ]);
    } catch (e) {
      if (isUnique(e)) continue; // the same person in two tabs, or the email was just taken: look again
      throw e;
    }
    return { user: { id, name: who.name, email: who.email, status: "active", approval: "pending", totp_enabled_at: null, google_sub: who.sub } };
  }
  return { error: "google" };
}

export const auth = new Hono<AppEnv>();

/** Whether Google sign-in is configured (the sign-in page explains it when not). */
auth.get("/google", (c) => c.json({ configured: googleConfig(c.env) !== null }));

auth.get("/google/start", async (c) => {
  const cfg = googleConfig(c.env);
  if (!cfg) return c.json({ error: "google_not_configured" }, 500);
  const db = c.env.DB;
  const state = randomToken();
  const secret = randomToken();
  const nonce = await oauthNonce(secret);
  const returnTo = RETURN_TO[c.req.query("next") ?? ""] ?? "/";
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(new Date(now).toISOString()),
    db
      .prepare("INSERT INTO oauth_states (id, browser_hash, nonce_hash, return_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await sha256Hex(state), await sha256Hex(secret), await sha256Hex(nonce), returnTo, new Date(now + FLOW_MS).toISOString(), new Date(now).toISOString()),
  ]);
  setCookie(c, FLOW_COOKIE, secret, { httpOnly: true, secure: true, sameSite: "Lax", path: FLOW_PATH, maxAge: FLOW_MS / 1000 });
  const url = authorizeUrl(cfg, redirectUri(c.req.url), state, nonce, await pkceChallenge(await pkceVerifier(secret)));
  c.header("cache-control", "no-store");
  return c.redirect(url, 302);
});

auth.get("/google/callback", async (c) => {
  const db = c.env.DB;
  c.header("cache-control", "no-store");
  const fail = (code: string) => c.redirect(`/login?error=${code}`, 302);

  // 1. State first: it must be one we issued, to this browser, in the last 10 minutes, and never used before.
  const state = c.req.query("state") ?? "";
  const secret = getCookie(c, FLOW_COOKIE) ?? "";
  deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH, secure: true });
  if (!state || !secret || state.length > 200 || secret.length > 200) return fail("state");
  const row = await db
    .prepare("DELETE FROM oauth_states WHERE id = ? RETURNING browser_hash, nonce_hash, return_to, expires_at")
    .bind(await sha256Hex(state))
    .first<{ browser_hash: string; nonce_hash: string; return_to: string; expires_at: string }>();
  if (!row || !(Date.parse(row.expires_at) > Date.now()) || !hexEqual(row.browser_hash, await sha256Hex(secret))) return fail("state");
  const nonce = await oauthNonce(secret);
  if (!hexEqual(row.nonce_hash, await sha256Hex(nonce))) return fail("state");

  // 2. Then what Google said.
  if (c.req.query("error")) return fail("cancelled");
  const cfg = googleConfig(c.env);
  if (!cfg) return fail("google_not_configured");
  const code = c.req.query("code") ?? "";
  if (!code || code.length > 2000) return fail("google");
  const idToken = await exchangeCode(cfg, code, redirectUri(c.req.url), await pkceVerifier(secret));
  if (!idToken) return fail("google");
  const who = await verifyIdToken(idToken, cfg.clientId, nonce);
  if (!who) return fail("token");

  // 3. Whose account this is, and whether they may come in.
  const found = await resolveAccount(db, who);
  if ("error" in found) return fail(found.error);
  const u = found.user;
  if (u.status === "left") return fail("disabled");
  if (!mayHaveSession(u)) return fail("declined");

  if (u.approval === "approved" && u.totp_enabled_at) {
    // Google is done but a code is still owed: no session yet. Any older half-finished sign-in for them is dropped.
    const token = randomToken();
    const now = Date.now();
    await db.batch([
      db.prepare("DELETE FROM mfa_pending WHERE user_id = ? OR expires_at <= ?").bind(u.id, new Date(now).toISOString()),
      db
        .prepare("INSERT INTO mfa_pending (id, user_id, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)")
        .bind(await sha256Hex(token), u.id, new Date(now + PENDING_MS).toISOString(), new Date(now).toISOString()),
    ]);
    setCookie(c, MFA_COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: MFA_PATH, maxAge: PENDING_MS / 1000 });
    return c.redirect("/login/code", 302);
  }

  setSessionCookie(c, await createSession(db, u.id, c.req.header("user-agent") ?? null));
  await audit(db, { id: u.id }, "login", "user", u.id, u.name, { method: "google" });
  return c.redirect(u.approval === "approved" ? row.return_to : "/", 302);
});

/** Second sign-in step: the HttpOnly code cookie from the Google callback plus an authenticator code or a backup code. */
auth.post("/login/mfa", async (c) => {
  const token = getCookie(c, MFA_COOKIE);
  if (!token || token.length > 200) return c.json({ error: "mfa_expired" }, 401);
  const parsed = CodeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_code" }, 401);
  const key = await mfaKey(c.env);
  if (!key) return c.json({ error: "mfa_not_configured" }, 500);
  const db = c.env.DB;
  const id = await sha256Hex(token);
  const now = new Date().toISOString();
  const expired = async () => {
    await db.prepare("DELETE FROM mfa_pending WHERE id = ?").bind(id).run();
    deleteCookie(c, MFA_COOKIE, { path: MFA_PATH, secure: true });
    return c.json({ error: "mfa_expired" }, 401);
  };
  const p = await db
    .prepare(
      `SELECT p.expires_at, p.attempts, u.id, u.name, u.email, u.status, u.approval, u.totp_secret_enc, u.totp_enabled_at, u.totp_last_step
         FROM mfa_pending p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    )
    .bind(id)
    .first<{
      expires_at: string; attempts: number; id: string; name: string; email: string; status: string; approval: string;
      totp_secret_enc: string | null; totp_enabled_at: string | null; totp_last_step: number | null;
    }>();
  if (!p || !(Date.parse(p.expires_at) > Date.now()) || p.attempts >= MAX_CODE_TRIES || !mayHaveSession(p) || p.approval !== "approved" || !p.totp_enabled_at) {
    return expired();
  }

  // Take a try on this token, then one on the account, before checking: parallel guesses cannot exceed either limit.
  const took = await db
    .prepare("UPDATE mfa_pending SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND expires_at > ?")
    .bind(id, MAX_CODE_TRIES, now)
    .run();
  if (took.meta.changes !== 1) return expired();
  if (!(await takeAttempt(db, p.email))) return c.json({ error: "locked" }, 429);

  const kind = await useCode(db, key, p, parsed.data.code, true);
  if (!kind) {
    await db.prepare("DELETE FROM mfa_pending WHERE id = ? AND attempts >= ?").bind(id, MAX_CODE_TRIES).run();
    return c.json({ error: "bad_code" }, 401);
  }
  const used = await db.prepare("DELETE FROM mfa_pending WHERE id = ?").bind(id).run();
  deleteCookie(c, MFA_COOKIE, { path: MFA_PATH, secure: true });
  if (used.meta.changes !== 1) return c.json({ error: "mfa_expired" }, 401);

  await clearAttemptsStmt(db, p.email).run();
  setSessionCookie(c, await createSession(db, p.id, c.req.header("user-agent") ?? null));
  await audit(db, { id: p.id }, "login", "user", p.id, p.name, { method: "google", mfa: kind });
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

// Passwords are gone: Google is the only way in.
auth.post("/login", (c) => c.json(GOOGLE_ONLY, 410));
auth.post("/password", (c) => c.json(GOOGLE_ONLY, 410));
