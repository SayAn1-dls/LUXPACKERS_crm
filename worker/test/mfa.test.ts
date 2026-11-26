import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { base32Decode, base32Encode, hotp, stepAt, totpAt, verifyTotp } from "../src/lib/totp";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "login_attempts", "mfa_pending", "mfa_backup_codes", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

/* ---------- helpers ---------- */

const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));
const codeAt = (secret: string, step: number) => totpAt(secret, step * 30_000);

/** Turns two-step sign-in on through the API. Returns the secret, the backup codes and the step that was used. */
async function enrol(cookie: string) {
  const s = await api(cookie, "POST", "/api/auth/mfa/setup");
  expect(s.status).toBe(200);
  const { secret } = (await s.json()) as { secret: string; uri: string };
  const step = stepAt(Date.now());
  const e = await api(cookie, "POST", "/api/auth/mfa/enable", { code: await codeAt(secret, step) });
  expect(e.status).toBe(200);
  const { backupCodes } = (await e.json()) as { backupCodes: string[] };
  return { secret, backupCodes, step };
}

async function passwordStep(email: string, password: string) {
  const r = await api(null, "POST", "/api/auth/login", { email, password });
  return { r, body: (await r.json()) as any };
}

/** Calls the Worker with a changed environment (e.g. no MFA_KEY). */
function apiWithEnv(over: Partial<typeof env>, cookie: string | null, method: string, path: string, body?: unknown) {
  const origin = "https://example.com";
  const headers: Record<string, string> = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  const req = new Request(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return app.fetch(req, { ...env, ...over } as any, { waitUntil() {}, passThroughOnException() {}, props: {} } as any);
}

/* ---------- TOTP primitives ---------- */

describe("TOTP (RFC 6238, SHA-1)", () => {
  // RFC 6238 appendix B, SHA-1 column. Seed "12345678901234567890".
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it("matches the RFC test vectors at 8 digits", async () => {
    const key = new TextEncoder().encode("12345678901234567890");
    for (const [t, want] of vectors) expect(await hotp(key, Math.floor(t / 30), 8)).toBe(want);
  });

  it("truncates to the last 6 digits for the app code", async () => {
    for (const [t, want] of vectors) expect(await totpAt(RFC_SECRET, t * 1000)).toBe(want.slice(-6));
  });

  it("base32 round-trips and rejects junk", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const s = base32Encode(bytes);
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect([...base32Decode(s)!]).toEqual([...bytes]);
    expect([...base32Decode(s.toLowerCase().replace(/(.{4})/g, "$1 "))!]).toEqual([...bytes]);
    expect(base32Decode("not base32!")).toBeNull();
  });

  it("accepts one step either side, not two, and never a step at or before the last one used", async () => {
    const now = 1_700_000_015_000;
    const s = stepAt(now);
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s), now, null)).toBe(s);
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s - 1), now, null)).toBe(s - 1);
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s + 1), now, null)).toBe(s + 1);
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s - 2), now, null)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s + 2), now, null)).toBeNull();
    // replay protection
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s), now, s)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s - 1), now, s - 1)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, await codeAt(RFC_SECRET, s + 1), now, s)).toBe(s + 1);
    // shape
    expect(await verifyTotp(RFC_SECRET, "12345", now, null)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, "abcdef", now, null)).toBeNull();
  });
});

/* ---------- enrolment ---------- */

describe("turning two-step sign-in on", () => {
  it("setup gives a secret and otpauth link; a wrong code is refused; the right one enables it and returns 8 backup codes", async () => {
    const u = await makeUser("employee", "Sales");
    const before = (await (await api(u.cookie, "GET", "/api/me")).json()) as any;
    expect(before.user.mfaEnabled).toBe(false);
    expect(before.user.mfaRequired).toBe(false);

    const s = await api(u.cookie, "POST", "/api/auth/mfa/setup");
    expect(s.status).toBe(200);
    const { secret, uri } = (await s.json()) as { secret: string; uri: string };
    expect(secret).toMatch(/^[A-Z2-7]{32}$/); // 20 bytes
    expect(uri).toBe(
      `otpauth://totp/Luxpackers:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Luxpackers&algorithm=SHA1&digits=6&period=30`,
    );

    // not on yet: still a plain sign-in
    expect((await passwordStep(u.email, u.password)).body.user.id).toBe(u.id);

    const wrong = await api(u.cookie, "POST", "/api/auth/mfa/enable", { code: await codeAt(secret, stepAt(Date.now()) + 5) });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "bad_code" });

    const ok = await api(u.cookie, "POST", "/api/auth/mfa/enable", { code: await totpAt(secret, Date.now()) });
    expect(ok.status).toBe(200);
    const { backupCodes } = (await ok.json()) as { backupCodes: string[] };
    expect(backupCodes).toHaveLength(8);
    expect(new Set(backupCodes).size).toBe(8);
    for (const c of backupCodes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

    const me = (await (await api(u.cookie, "GET", "/api/me")).json()) as any;
    expect(me.user.mfaEnabled).toBe(true);
    const status = (await (await api(u.cookie, "GET", "/api/auth/mfa")).json()) as any;
    expect(status).toMatchObject({ enabled: true, required: false, backupCodesLeft: 8 });

    // a second setup cannot replace a live secret
    expect((await api(u.cookie, "POST", "/api/auth/mfa/setup")).status).toBe(409);

    const audit = await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action = 'mfa_enabled'").all<any>();
    expect(audit.results).toHaveLength(1);
    const allAudit = JSON.stringify((await env.DB.prepare("SELECT * FROM audit_log").all()).results);
    expect(allAudit).not.toContain(secret);
    for (const c of backupCodes) expect(allAudit).not.toContain(c);
  });

  it("stores the secret encrypted and backup codes only as hashes", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, backupCodes } = await enrol(u.cookie);
    const row = await env.DB.prepare("SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = ?").bind(u.id).first<any>();
    expect(row.totp_secret_enc).toBeTruthy();
    expect(row.totp_secret_enc).not.toContain(secret);
    expect(row.totp_secret_enc).not.toBe(secret);
    expect(row.totp_enabled_at).toBeTruthy();
    expect(typeof row.totp_last_step).toBe("number");
    const hashes = await env.DB.prepare("SELECT code_hash FROM mfa_backup_codes WHERE user_id = ?").bind(u.id).all<any>();
    expect(hashes.results).toHaveLength(8);
    const flat = JSON.stringify(hashes.results);
    for (const c of backupCodes) {
      expect(flat).not.toContain(c);
      expect(flat).not.toContain(c.replace("-", ""));
    }
  });

  it("enable without setup is refused; status needs a session", async () => {
    const u = await makeUser("employee", "Sales");
    const r = await api(u.cookie, "POST", "/api/auth/mfa/enable", { code: "123456" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "no_pending_setup" });
    expect((await api(null, "GET", "/api/auth/mfa")).status).toBe(401);
    expect((await api(null, "POST", "/api/auth/mfa/setup")).status).toBe(401);
  });
});

/* ---------- sign-in ---------- */

describe("signing in with two-step on", () => {
  it("password step returns an mfaToken and no cookie; the code step creates the session", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const { r, body } = await passwordStep(u.email, u.password);
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.mfaToken).toBe("string");
    expect(body.user).toBeUndefined();
    // the token is stored hashed
    const pending = await env.DB.prepare("SELECT id FROM mfa_pending").all<any>();
    expect(pending.results).toHaveLength(1);
    expect(pending.results[0].id).not.toBe(body.mfaToken);

    // the code used to enable it cannot be replayed
    const replay = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: body.mfaToken, code: await codeAt(secret, step) });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "bad_code" });

    const wrong = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: body.mfaToken, code: await codeAt(secret, step + 7) });
    expect(wrong.status).toBe(401);

    const ok = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: body.mfaToken, code: await codeAt(secret, step + 1) });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect(cookie).toContain("lux_session=");
    expect(((await ok.json()) as any).user.id).toBe(u.id);
    expect((await api(cookie, "GET", "/api/me")).status).toBe(200);

    // the token is single use
    const again = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: body.mfaToken, code: await codeAt(secret, step + 1) });
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "mfa_expired" });
    // successful sign-in clears the failures
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("the same time-step cannot be used for two sign-ins", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const a = (await passwordStep(u.email, u.password)).body.mfaToken;
    const b = (await passwordStep(u.email, u.password)).body.mfaToken;
    const code = await codeAt(secret, step + 1);
    expect((await api(null, "POST", "/api/auth/login/mfa", { mfaToken: a, code })).status).toBe(200);
    expect((await api(null, "POST", "/api/auth/login/mfa", { mfaToken: b, code })).status).toBe(401);
  });

  it("a backup code works once", async () => {
    const u = await makeUser("employee", "Sales");
    const { backupCodes } = await enrol(u.cookie);
    const t1 = (await passwordStep(u.email, u.password)).body.mfaToken;
    const ok = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t1, code: backupCodes[0].toLowerCase().replace("-", " ") });
    expect(ok.status).toBe(200);
    const t2 = (await passwordStep(u.email, u.password)).body.mfaToken;
    const again = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t2, code: backupCodes[0] });
    expect(again.status).toBe(401);
    const other = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t2, code: backupCodes[1] });
    expect(other.status).toBe(200);
    const status = (await (await api(u.cookie, "GET", "/api/auth/mfa")).json()) as any;
    expect(status.backupCodesLeft).toBe(6);
  });

  it("an expired mfaToken is refused", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const t = (await passwordStep(u.email, u.password)).body.mfaToken;
    await env.DB.prepare("UPDATE mfa_pending SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    const r = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t, code: await codeAt(secret, step + 1) });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "mfa_expired" });
  });

  it("the token expires five minutes after the password step", async () => {
    const u = await makeUser("employee", "Sales");
    await enrol(u.cookie);
    await passwordStep(u.email, u.password);
    const row = await env.DB.prepare("SELECT expires_at FROM mfa_pending").first<{ expires_at: string }>();
    const left = Date.parse(row!.expires_at) - Date.now();
    expect(left).toBeGreaterThan(4 * 60_000);
    expect(left).toBeLessThanOrEqual(5 * 60_000);
  });

  it("five wrong codes kill the token, and count toward the email's lockout", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const t = (await passwordStep(u.email, u.password)).body.mfaToken;
    for (let i = 0; i < 5; i++) {
      const r = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t, code: await codeAt(secret, step + 10 + i) });
      expect(r.status).toBe(401);
    }
    const good = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t, code: await codeAt(secret, step + 1) });
    expect(good.status).toBe(401);
    expect(await good.json()).toEqual({ error: "mfa_expired" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?").bind(u.email).first<{ n: number }>();
    expect(n?.n).toBe(5);
    // the password step is now locked too
    expect((await passwordStep(u.email, u.password)).r.status).toBe(429);
  });

  it("the code step is refused while the email is locked out", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const t = (await passwordStep(u.email, u.password)).body.mfaToken;
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind(u.email, new Date().toISOString()).run();
    }
    const r = await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t, code: await codeAt(secret, step + 1) });
    expect(r.status).toBe(429);
  });
});

/* ---------- admins ---------- */

describe("admins must use two-step sign-in", () => {
  it("an admin without it is blocked everywhere except me, sign-out and enrolment", async () => {
    const a = await makeUser("admin", "Management", { mfa: false });
    const blocked = await api(a.cookie, "GET", "/api/tasks");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "mfa_setup_required" });
    expect((await api(a.cookie, "GET", "/api/users")).status).toBe(403);
    expect((await api(a.cookie, "GET", "/api/audit")).status).toBe(403);

    const me = (await (await api(a.cookie, "GET", "/api/me")).json()) as any;
    expect(me.user.mfaRequired).toBe(true);
    expect(me.user.mfaEnabled).toBe(false);
    expect((await api(a.cookie, "GET", "/api/auth/mfa")).status).toBe(200);

    await enrol(a.cookie);
    expect((await api(a.cookie, "GET", "/api/tasks")).status).toBe(200);
    expect((await api(a.cookie, "GET", "/api/users")).status).toBe(200);
  });

  it("an unenrolled admin can still sign out", async () => {
    const a = await makeUser("admin", "Management", { mfa: false });
    expect((await api(a.cookie, "POST", "/api/auth/logout")).status).toBe(200);
  });

  it("an admin cannot turn their own two-step sign-in off", async () => {
    const a = await makeUser("admin", "Management", { mfa: false });
    const { secret, step } = await enrol(a.cookie);
    const r = await api(a.cookie, "POST", "/api/auth/mfa/disable", { password: a.password, code: await codeAt(secret, step + 1) });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "admin_mfa_required" });
    const row = await env.DB.prepare("SELECT totp_enabled_at FROM users WHERE id = ?").bind(a.id).first<any>();
    expect(row.totp_enabled_at).toBeTruthy();
  });

  it("an admin resets another person's two-step sign-in: enrolment cleared, signed out everywhere, audited", async () => {
    const a = await makeUser("admin", "Management");
    const u = await makeUser("employee", "Sales");
    await enrol(u.cookie);
    const r = await api(a.cookie, "POST", `/api/users/${u.id}/mfa/reset`);
    expect(r.status).toBe(200);
    expect((await api(u.cookie, "GET", "/api/me")).status).toBe(401);
    const row = await env.DB.prepare("SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = ?").bind(u.id).first<any>();
    expect(row).toEqual({ totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null });
    const codes = await env.DB.prepare("SELECT COUNT(*) AS n FROM mfa_backup_codes WHERE user_id = ?").bind(u.id).first<{ n: number }>();
    expect(codes?.n).toBe(0);
    const audit = await env.DB.prepare("SELECT user_id, entity_id FROM audit_log WHERE action = 'mfa_reset'").all<any>();
    expect(audit.results).toEqual([{ user_id: a.id, entity_id: u.id }]);
    // they sign in with just a password again
    expect((await passwordStep(u.email, u.password)).body.user.id).toBe(u.id);
  });

  it("reset another admin works too (lockout recovery)", async () => {
    const a = await makeUser("admin", "Management");
    const b = await makeUser("admin", "Management");
    expect((await api(a.cookie, "POST", `/api/users/${b.id}/mfa/reset`)).status).toBe(200);
  });

  it("nobody resets their own; non-admins cannot reset anyone; unknown id is 404", async () => {
    const a = await makeUser("admin", "Management");
    const hr = await makeUser("hr", "HR");
    const u = await makeUser("employee", "Sales");
    expect((await api(a.cookie, "POST", `/api/users/${a.id}/mfa/reset`)).status).toBe(403);
    expect((await api(hr.cookie, "POST", `/api/users/${u.id}/mfa/reset`)).status).toBe(403);
    expect((await api(a.cookie, "POST", `/api/users/nope/mfa/reset`)).status).toBe(404);
  });

  it("People & logins shows who has it on", async () => {
    const a = await makeUser("admin", "Management");
    const u = await makeUser("employee", "Sales");
    const v = await makeUser("employee", "Sales");
    await enrol(u.cookie);
    const list = (await (await api(a.cookie, "GET", "/api/users")).json()) as any;
    const by = Object.fromEntries(list.users.map((x: any) => [x.id, x.mfaEnabled]));
    expect(by[u.id]).toBe(true);
    expect(by[v.id]).toBe(false);
    expect(by[a.id]).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/totp|secret/i);
  });
});

/* ---------- turning it off, new backup codes ---------- */

describe("non-admins can turn it off", () => {
  it("needs the password and a current code", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const badPw = await api(u.cookie, "POST", "/api/auth/mfa/disable", { password: "not-my-password", code: await codeAt(secret, step + 1) });
    expect(badPw.status).toBe(400);
    expect(await badPw.json()).toEqual({ error: "wrong_password" });
    const badCode = await api(u.cookie, "POST", "/api/auth/mfa/disable", { password: u.password, code: await codeAt(secret, step + 9) });
    expect(badCode.status).toBe(400);
    expect(await badCode.json()).toEqual({ error: "bad_code" });
    const ok = await api(u.cookie, "POST", "/api/auth/mfa/disable", { password: u.password, code: await codeAt(secret, step + 1) });
    expect(ok.status).toBe(200);
    const me = (await (await api(u.cookie, "GET", "/api/me")).json()) as any;
    expect(me.user.mfaEnabled).toBe(false);
    const row = await env.DB.prepare("SELECT totp_secret_enc FROM users WHERE id = ?").bind(u.id).first<any>();
    expect(row.totp_secret_enc).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM mfa_backup_codes").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'mfa_disabled'").first<{ n: number }>())?.n).toBe(1);
    expect((await passwordStep(u.email, u.password)).body.user.id).toBe(u.id);
  });
});

describe("new backup codes", () => {
  it("need a current code and replace the old ones", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step, backupCodes: old } = await enrol(u.cookie);
    const bad = await api(u.cookie, "POST", "/api/auth/mfa/backup-codes", { code: await codeAt(secret, step + 9) });
    expect(bad.status).toBe(400);
    const ok = await api(u.cookie, "POST", "/api/auth/mfa/backup-codes", { code: await codeAt(secret, step + 1) });
    expect(ok.status).toBe(200);
    const { backupCodes } = (await ok.json()) as { backupCodes: string[] };
    expect(backupCodes).toHaveLength(8);
    expect(backupCodes.some((c) => old.includes(c))).toBe(false);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backup_codes_regenerated'").first<{ n: number }>())?.n).toBe(1);
    const t = (await passwordStep(u.email, u.password)).body.mfaToken;
    expect((await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t, code: old[0] })).status).toBe(401);
    expect((await api(null, "POST", "/api/auth/login/mfa", { mfaToken: t, code: backupCodes[0] })).status).toBe(200);
  });
});

/* ---------- MFA_KEY missing ---------- */

describe("without MFA_KEY it fails closed", () => {
  it("enrolment and code checks return mfa_not_configured; the admin guard still blocks", async () => {
    const u = await makeUser("employee", "Sales");
    const { secret, step } = await enrol(u.cookie);
    const fresh = await makeUser("employee", "Sales");
    for (const over of [{ MFA_KEY: undefined }, { MFA_KEY: "dG9vIHNob3J0" }]) {
      const s = await apiWithEnv(over, fresh.cookie, "POST", "/api/auth/mfa/setup");
      expect(s.status).toBe(500);
      expect(await s.json()).toEqual({ error: "mfa_not_configured" });

      const p = await apiWithEnv(over, null, "POST", "/api/auth/login", { email: u.email, password: u.password });
      const { mfaToken } = (await p.json()) as any;
      expect(mfaToken).toBeTruthy();
      const c = await apiWithEnv(over, null, "POST", "/api/auth/login/mfa", { mfaToken, code: await codeAt(secret, step + 1) });
      expect(c.status).toBe(500);
      expect(await c.json()).toEqual({ error: "mfa_not_configured" });
      expect(c.headers.get("set-cookie")).toBeNull();
    }
    const a = await makeUser("admin", "Management", { mfa: false });
    const blocked = await apiWithEnv({ MFA_KEY: undefined }, a.cookie, "GET", "/api/tasks");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "mfa_setup_required" });
  });
});
