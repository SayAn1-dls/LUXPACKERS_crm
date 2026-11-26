import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppContext, AppEnv, SessionUser } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { ADMIN_PERMS, NO_PERMS, parsePerms, roleLabel } from "./positions";

export const COOKIE = "lux_session";
const DAY = 86_400_000;
const LIFETIME_DAYS = 14;
const SLIDE_BELOW_DAYS = 13;

export async function createSession(db: D1Database, userId: string, ua: string | null): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(
      await sha256Hex(token),
      userId,
      new Date(now + LIFETIME_DAYS * DAY).toISOString(),
      new Date(now).toISOString(),
      ua ? ua.slice(0, 300) : null,
    )
    .run();
  return token;
}

export function setSessionCookie(c: AppContext, token: string): void {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: LIFETIME_DAYS * 86400,
  });
}

export function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

export async function sessionTokenHash(c: AppContext): Promise<string | null> {
  const token = getCookie(c, COOKIE);
  return token ? sha256Hex(token) : null;
}

/** Columns needed to build a SessionUser; select FROM users u LEFT JOIN positions p ON p.id = u.position_id. */
export const SESSION_USER_COLS = `u.id, u.name, u.email, u.dept, u.manager_id, u.status, u.approval, u.totp_enabled_at,
  p.id AS position_id, p.name AS position_name, p.is_admin AS position_is_admin, p.perms AS position_perms`;

export interface SessionUserRow {
  id: string;
  name: string;
  email: string;
  dept: string;
  manager_id: string | null;
  status: string;
  approval: string;
  totp_enabled_at: string | null;
  position_id: string | null;
  position_name: string | null;
  position_is_admin: number | null;
  position_perms: string | null;
}

export function toSessionUser(r: SessionUserRow): SessionUser {
  const isAdmin = r.position_is_admin === 1;
  const perms = isAdmin ? ADMIN_PERMS : r.position_id ? parsePerms(r.position_perms) : NO_PERMS;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: roleLabel(isAdmin, perms),
    dept: r.dept,
    managerId: r.manager_id,
    approval: r.approval === "approved" ? "approved" : "pending",
    positionId: r.position_id,
    positionName: r.position_name,
    isAdmin,
    perms,
    mfaEnabled: !!r.totp_enabled_at,
    mfaRequired: isAdmin,
  };
}

export async function loadSessionUser(db: D1Database, userId: string): Promise<SessionUser | null> {
  const row = await db
    .prepare(`SELECT ${SESSION_USER_COLS} FROM users u LEFT JOIN positions p ON p.id = u.position_id WHERE u.id = ?`)
    .bind(userId)
    .first<SessionUserRow>();
  return row ? toSessionUser(row) : null;
}

/** People who have left, or whose access request was declined, never keep a session. */
export const mayHaveSession = (r: { status: string; approval: string }) => r.status !== "left" && r.approval !== "declined";

/** A sign-in within the last 10 minutes: needed before changing how this account signs in. */
export const FRESH_MS = 10 * 60_000;
export const isFreshSignIn = (c: AppContext) => {
  const at = Date.parse(c.var.sessionCreatedAt ?? "");
  return at > Date.now() - FRESH_MS && at <= Date.now() + 60_000;
};

export const readSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  c.set("sessionCreatedAt", null);
  const token = getCookie(c, COOKIE);
  if (token) {
    const sid = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT s.id AS session_id, s.expires_at, s.created_at AS session_created_at, ${SESSION_USER_COLS}
         FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN positions p ON p.id = u.position_id WHERE s.id = ?`,
    )
      .bind(sid)
      .first<SessionUserRow & { session_id: string; expires_at: string; session_created_at: string }>();
    if (row) {
      const exp = Date.parse(row.expires_at);
      if (!(exp > Date.now()) || !mayHaveSession(row)) {
        await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
      } else {
        if (exp - Date.now() < SLIDE_BELOW_DAYS * DAY) {
          await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
            .bind(new Date(Date.now() + LIFETIME_DAYS * DAY).toISOString(), sid)
            .run();
          setSessionCookie(c, token);
        }
        c.set("user", toSessionUser(row));
        c.set("sessionCreatedAt", row.session_created_at);
      }
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) return c.json({ error: "signed_out" }, 401);
  await next();
};

/** Same-origin, JSON-only guard for state-changing requests. */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    const origin = c.req.header("origin");
    const ct = c.req.header("content-type") ?? "";
    if (!origin || origin !== new URL(c.req.url).origin || !/^application\/json\b/i.test(ct)) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  await next();
};

/** The Google sign-in steps. Reachable by anyone, signed in or not. */
const SIGN_IN_PATHS = new Set([
  "/api/auth/google",
  "/api/auth/google/start",
  "/api/auth/google/callback",
  "/api/auth/login/mfa",
]);

/** What someone waiting for approval may reach: who am I, sign out, and the sign-in steps. */
const OPEN_WHEN_PENDING = (p: string) =>
  p === "/api/me" || p === "/api/health" || p === "/api/setup" || p === "/api/auth/logout" || SIGN_IN_PATHS.has(p);

/** Signed in with Google but not let in yet: nothing beyond /api/me and sign-out. */
export const approvalGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.var.user;
  if (u && u.approval !== "approved" && !OPEN_WHEN_PENDING(new URL(c.req.url).pathname)) {
    return c.json({ error: "approval_pending" }, 403);
  }
  await next();
};

/** What an admin who has not turned on two-step sign-in may still reach: who am I, sign out, sign-in steps, enrolment. */
const OPEN_WHEN_MFA_SETUP = (p: string) =>
  p === "/api/me" ||
  p === "/api/health" ||
  p === "/api/setup" ||
  p === "/api/auth/logout" ||
  SIGN_IN_PATHS.has(p) ||
  p === "/api/auth/mfa" ||
  p.startsWith("/api/auth/mfa/");

/** Admins must have two-step sign-in on before they can do anything else. Holds even when MFA_KEY is missing. */
export const mfaGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.var.user;
  if (u?.mfaRequired && !u.mfaEnabled && !OPEN_WHEN_MFA_SETUP(new URL(c.req.url).pathname)) {
    return c.json({ error: "mfa_setup_required" }, 403);
  }
  await next();
};
