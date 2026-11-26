import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

export async function applyMigrations(e: typeof env = env): Promise<void> {
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
}

export function api(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const origin = "https://example.com";
  const headers: Record<string, string> = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  return exports.default.fetch(
    new Request(origin + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

let positionSeq = 0;

type Perms = import("../../shared/schema").Perms;
type RegisterLevel = import("../../shared/schema").RegisterLevel;

/** Register levels of a typical staff position (the starter Employee has none). */
export const STAFF_REGISTERS: Record<string, RegisterLevel> = {
  leads: "edit", bookings: "edit", trips: "edit", partners: "edit", content: "edit",
};

/** A starter position's perms with some keys (and register levels) overridden. */
export async function permsLike(
  role: "manager" | "hr" | "employee",
  over: Partial<Omit<Perms, "registers">> & { registers?: Record<string, RegisterLevel> } = {},
): Promise<Perms> {
  const { STARTER_POSITIONS } = await import("../src/lib/positions");
  const base = STARTER_POSITIONS.find((p) => p.id === `pos_${role}`)!.perms;
  return { ...base, ...over, registers: { ...base.registers, ...(over.registers ?? {}) } };
}

/** Creates a custom (non-admin) position and returns its id. */
export async function makePosition(perms: import("../../shared/schema").Perms, name?: string): Promise<string> {
  const id = `pos_test_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO positions (id, name, is_admin, perms, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(id, name ?? `Test position ${++positionSeq} ${id}`, JSON.stringify(perms), now, now)
    .run();
  return id;
}

/** `role` picks the matching starter position (pos_<role>) unless `positionId` or `perms` is given. */
export async function makeUser(
  role: "admin" | "manager" | "hr" | "employee",
  deptName: string,
  opts: {
    managerId?: string;
    status?: string;
    email?: string;
    /** Already linked to this Google account id. */
    googleSub?: string;
    approval?: "approved" | "pending" | "declined";
    positionId?: string;
    perms?: import("../../shared/schema").Perms;
    /** Mark two-step sign-in as on (with a placeholder, not a usable secret). Defaults to on for admins, so the
        admin two-step guard does not get in the way of unrelated tests. */
    mfa?: boolean;
  } = {},
): Promise<{ id: string; email: string; cookie: string; positionId: string }> {
  const { createSession } = await import("../src/lib/session");
  const id = crypto.randomUUID();
  const email = (opts.email ?? `${role}-${id.slice(0, 8)}@example.com`).trim().toLowerCase();
  const now = new Date().toISOString();
  const positionId = opts.positionId ?? (opts.perms ? await makePosition(opts.perms) : `pos_${role}`);
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, position_id, dept, manager_id, status, approval, google_sub,
                        password_hash, password_salt, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'google-only', '', 0, ?, ?)`,
  )
    .bind(
      id,
      email,
      `${role} ${id.slice(0, 4)}`,
      role,
      positionId,
      deptName,
      opts.managerId ?? null,
      opts.status ?? "active",
      opts.approval ?? "approved",
      opts.googleSub ?? null,
      now,
      now,
    )
    .run();
  if (opts.mfa ?? role === "admin") {
    await env.DB.prepare("UPDATE users SET totp_secret_enc = 'test-placeholder', totp_enabled_at = ? WHERE id = ?").bind(now, id).run();
  }
  const token = await createSession(env.DB, id, "test");
  return { id, email, cookie: `lux_session=${token}`, positionId };
}
