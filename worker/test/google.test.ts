import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { stepAt, totpAt } from "../src/lib/totp";
import { applyMigrations, makeUser } from "./helpers";
import {
  call, claimsFor, CLIENT_ID, cookiesOf, finishFlow, googleSignIn, installGoogle, KID, redirectOf, sessionOf, startFlow, tokenRequests,
} from "./google";

beforeAll(async () => {
  await applyMigrations();
  await installGoogle();
});

beforeEach(async () => {
  for (const t of ["audit_log", "login_attempts", "mfa_pending", "mfa_backup_codes", "notifications", "oauth_states", "sessions", "onboarding", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  tokenRequests.length = 0;
});

const json = async (r: Response) => (await r.json()) as any;
const count = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
const userBy = (email: string) => env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();

/** An existing admin so new Google sign-ins are not the first-ever setup. */
const seedAdmin = () => makeUser("admin", "Management", { email: "boss@luxpackers.com" });

/* ---------- start ---------- */

describe("start", () => {
  it("redirects to Google with code + PKCE S256 + state + nonce, and binds the flow to this browser", async () => {
    const r = await call(null, "GET", "/api/auth/google/start");
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = loc.searchParams;
    expect(q.get("client_id")).toBe(CLIENT_ID);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe("https://example.com/api/auth/google/callback");
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(43);
    expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(43);
    const c = cookiesOf(r).lux_oauth.raw;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Max-Age=600/);
    // Stored hashed only: neither the state, the nonce nor the cookie secret appear in the database.
    const rows = await env.DB.prepare("SELECT * FROM oauth_states").all<any>();
    expect(rows.results).toHaveLength(1);
    const dump = JSON.stringify(rows.results);
    expect(dump).not.toContain(q.get("state"));
    expect(dump).not.toContain(q.get("nonce"));
    expect(dump).not.toContain(cookiesOf(r).lux_oauth.value);
    expect(Date.parse(rows.results[0].expires_at) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("the redirect URI follows the request origin (local dev)", async () => {
    const r = await env.DB.prepare("SELECT 1").first(); // keep the DB warm
    expect(r).toBeTruthy();
    const { default: app } = await import("../src/index");
    const res = await app.fetch(new Request("http://localhost:5173/api/auth/google/start", { redirect: "manual" }), env as any, {} as any);
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/google/callback");
  });

  it("fails closed without the secrets", async () => {
    for (const over of [{ GOOGLE_CLIENT_ID: undefined }, { GOOGLE_CLIENT_SECRET: "" }]) {
      const r = await call(null, "GET", "/api/auth/google/start", undefined, over);
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "google_not_configured" });
      expect((await json(await call(null, "GET", "/api/auth/google", undefined, over))).configured).toBe(false);
    }
    expect((await json(await call(null, "GET", "/api/auth/google"))).configured).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM oauth_states")).toBe(0);
  });
});

/* ---------- state, PKCE, nonce ---------- */

describe("callback: state is checked before anything else", () => {
  it("wrong state, no cookie, another flow's cookie, expired, reused: all refused before Google is called", async () => {
    await seedAdmin();
    const a = await startFlow();
    const b = await startFlow();
    const cases: [string, Promise<Response>][] = [
      ["wrong state", finishFlow(a, claimsFor(a, "s1", "x@example.com"), { state: "not-a-state-we-issued-0000000000000000000000" })],
      ["no cookie", finishFlow(a, claimsFor(a, "s1", "x@example.com"), { cookie: null })],
      ["other flow's cookie", finishFlow(a, claimsFor(a, "s1", "x@example.com"), { cookie: b.cookie })],
    ];
    for (const [name, p] of cases) {
      const r = await p;
      expect(redirectOf(r), name).toBe("/login?error=state");
      expect(sessionOf(r), name).toBeNull();
    }
    // A failed attempt with the wrong browser used the state up: single use.
    expect(redirectOf(await finishFlow(a, claimsFor(a, "s1", "x@example.com")))).toBe("/login?error=state");

    const c = await startFlow();
    await env.DB.prepare("UPDATE oauth_states SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect(redirectOf(await finishFlow(c, claimsFor(c, "s1", "x@example.com")))).toBe("/login?error=state");
    expect(tokenRequests).toHaveLength(0);

    const d = await startFlow();
    const ok = await finishFlow(d, claimsFor(d, "s1", "x@example.com"));
    expect(redirectOf(ok)).toBe("/");
    expect(redirectOf(await finishFlow(d, claimsFor(d, "s1", "x@example.com")))).toBe("/login?error=state");
    // The flow cookie is cleared on the way back.
    expect(cookiesOf(ok).lux_oauth.value).toBe("");
  });

  it("Google saying no (cancelled) is a friendly error once state checks out", async () => {
    const f = await startFlow();
    const r = await finishFlow(f, claimsFor(f, "s1", "x@example.com"), { extraQuery: "&error=access_denied" });
    expect(redirectOf(r)).toBe("/login?error=cancelled");
    expect(tokenRequests).toHaveLength(0);
  });

  it("the code is exchanged server-side with the secret and the PKCE verifier that matches the challenge", async () => {
    await seedAdmin();
    const f = await startFlow();
    const r = await finishFlow(f, claimsFor(f, "s1", "x@example.com"));
    expect(redirectOf(r)).toBe("/");
    expect(tokenRequests).toHaveLength(1);
    const t = tokenRequests[0];
    expect(t.get("client_secret")).toBe("test-only-client-secret");
    expect(t.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(t.get("redirect_uri")).toBe("https://example.com/api/auth/google/callback");
    // The verifier was never sent to the browser.
    expect(f.location.toString()).not.toContain(t.get("code_verifier"));
  });

  it("a token endpoint refusal is a friendly error", async () => {
    const f = await startFlow();
    // Tamper with the challenge so the mock Google rejects the verifier.
    const r = await finishFlow({ ...f, challenge: "x".repeat(43) }, claimsFor(f, "s1", "x@example.com"));
    expect(redirectOf(r)).toBe("/login?error=google");
    expect(sessionOf(r)).toBeNull();
  });
});

describe("callback: the ID token is verified", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const bad: [string, (f: any) => { claims?: Record<string, unknown>; header?: Record<string, unknown>; key?: "other" }][] = [
    ["bad signature", () => ({ key: "other" })],
    ["alg none", () => ({ header: { alg: "none", kid: KID } })],
    ["HS256", () => ({ header: { alg: "HS256", kid: KID } })],
    ["unknown kid", () => ({ header: { alg: "RS256", kid: "nope" } })],
    ["wrong aud", () => ({ claims: { aud: "someone-else.apps.googleusercontent.com" } })],
    ["wrong azp", () => ({ claims: { azp: "someone-else.apps.googleusercontent.com" } })],
    ["wrong iss", () => ({ claims: { iss: "https://evil.example" } })],
    ["expired", () => ({ claims: { exp: now() - 120, iat: now() - 3720 } })],
    ["issued in the future", () => ({ claims: { iat: now() + 600 } })],
    ["nonce mismatch", () => ({ claims: { nonce: "another-nonce" } })],
    ["no nonce", () => ({ claims: { nonce: undefined } })],
    ["unverified email", () => ({ claims: { email_verified: false } })],
    ["email_verified as a string", () => ({ claims: { email_verified: "true" } })],
    ["no sub", () => ({ claims: { sub: "" } })],
  ];
  for (const [name, mk] of bad) {
    it(`refuses: ${name}`, async () => {
      const admin = await seedAdmin();
      const f = await startFlow();
      const m = mk(f);
      const claims = { ...claimsFor(f, "sub-new", admin.email), ...(m.claims ?? {}) };
      const r = await finishFlow(f, claims, { header: m.header, key: m.key });
      expect(redirectOf(r)).toBe("/login?error=token");
      expect(sessionOf(r)).toBeNull();
      // Nothing linked or created.
      expect((await userBy(admin.email)).google_sub).toBeNull();
      expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(1);
    });
  }
});

/* ---------- accounts ---------- */

describe("someone new asks to join", () => {
  it("gets a pending account and a session that only reaches /api/me and sign-out; every admin is told", async () => {
    const a1 = await seedAdmin();
    const a2 = await makeUser("admin", "Management");
    const r = await googleSignIn("sub-new", "New.Person@Gmail.com", { name: "New Person" });
    expect(redirectOf(r)).toBe("/");
    const cookie = sessionOf(r)!;
    const row = await userBy("new.person@gmail.com");
    expect(row).toMatchObject({ approval: "pending", google_sub: "sub-new", name: "New Person", position_id: null });
    const me = await json(await call(cookie, "GET", "/api/me"));
    expect(me.user).toMatchObject({ approval: "pending", isAdmin: false });
    for (const path of ["/api/tasks", "/api/people", "/api/notifications", "/api/dashboard", "/api/auth/mfa"]) {
      const b = await call(cookie, "GET", path);
      expect(b.status, path).toBe(403);
      expect(await b.json()).toEqual({ error: "approval_pending" });
    }
    const n = await env.DB.prepare("SELECT user_id, kind, link FROM notifications").all<any>();
    expect(n.results.map((x) => x.user_id).sort()).toEqual([a1.id, a2.id].sort());
    for (const x of n.results) expect(x).toMatchObject({ kind: "access_request", link: "/users?tab=waiting" });
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access_requested' AND entity_id = ?", row.id)).toBe(1);
    // Not in the directory, search or manager choices.
    const people = await json(await call(a1.cookie, "GET", "/api/people"));
    expect(people.people.some((p: any) => p.id === row.id)).toBe(false);
    expect((await call(a1.cookie, "PATCH", `/api/users/${a2.id}`, { managerId: row.id })).status).toBe(400);
    // Signing in again does not make a second request.
    await googleSignIn("sub-new", "new.person@gmail.com");
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'sub-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access_requested'")).toBe(1);
    expect((await call(cookie, "POST", "/api/auth/logout")).status).toBe(200);
  });

  it("approve (any position, department required, manager optional) gives full access and tells them", async () => {
    const admin = await seedAdmin();
    const hr = await makeUser("hr", "People & Interns");
    const r = await googleSignIn("sub-a", "asha@gmail.com");
    const cookie = sessionOf(r)!;
    const { id } = await userBy("asha@gmail.com");
    expect((await call(hr.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_manager", dept: "Sales & Reservations" })).status).toBe(403);
    expect((await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_manager" })).status).toBe(400);
    expect((await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_nope", dept: "Sales & Reservations" })).status).toBe(400);
    const ok = await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_manager", dept: "Sales & Reservations", managerId: admin.id });
    expect(ok.status).toBe(200);
    expect((await json(ok)).user).toMatchObject({ approval: "approved", positionId: "pos_manager", dept: "Sales & Reservations", managerId: admin.id, status: "active" });
    // Same session, now let in.
    expect((await call(cookie, "GET", "/api/tasks")).status).toBe(200);
    expect((await json(await call(cookie, "GET", "/api/me"))).user).toMatchObject({ approval: "approved", positionName: "Manager" });
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'access_approved'", id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access_approved' AND entity_id = ?", id)).toBe(1);
    // Twice is a conflict, not a second approval.
    expect((await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_hr", dept: "Sales & Reservations" })).status).toBe(409);
  });

  it("approving as Admin works, and they then must set up two-step sign-in", async () => {
    const admin = await seedAdmin();
    const r = await googleSignIn("sub-b", "bo@gmail.com");
    const { id } = await userBy("bo@gmail.com");
    expect((await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_admin", dept: "Management" })).status).toBe(200);
    const b = await call(sessionOf(r)!, "GET", "/api/tasks");
    expect(await b.json()).toEqual({ error: "mfa_setup_required" });
  });

  it("decline: signed out, cannot get back in; the admin can undo it", async () => {
    const admin = await seedAdmin();
    const r = await googleSignIn("sub-c", "cy@gmail.com");
    const cookie = sessionOf(r)!;
    const { id } = await userBy("cy@gmail.com");
    // Any half-finished sign-in row goes too.
    await env.DB.prepare("INSERT INTO mfa_pending (id, user_id, expires_at, attempts, created_at) VALUES ('x', ?, ?, 0, ?)")
      .bind(id, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString()).run();
    expect((await call(admin.cookie, "POST", `/api/users/${id}/decline`)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM mfa_pending WHERE user_id = ?", id)).toBe(0);
    expect((await call(cookie, "GET", "/api/me")).status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access_declined'")).toBe(1);
    const again = await googleSignIn("sub-c", "cy@gmail.com");
    expect(redirectOf(again)).toBe("/login?error=declined");
    expect(sessionOf(again)).toBeNull();
    // A declined session row planted directly is still refused.
    expect((await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_employee", dept: "Sales & Reservations" })).status).toBe(409);
    expect((await call(admin.cookie, "POST", `/api/users/${id}/undecline`)).status).toBe(200);
    expect((await userBy("cy@gmail.com")).approval).toBe("pending");
    expect(redirectOf(await googleSignIn("sub-c", "cy@gmail.com"))).toBe("/");
    expect((await call(admin.cookie, "POST", `/api/users/${id}/approve`, { positionId: "pos_employee", dept: "Sales & Reservations" })).status).toBe(200);
  });

  it("people who have left cannot sign in", async () => {
    await seedAdmin();
    const u = await makeUser("employee", "Sales", { email: "gone@luxpackers.com", status: "left" });
    const r = await googleSignIn("sub-gone", u.email);
    expect(redirectOf(r)).toBe("/login?error=disabled");
    expect(sessionOf(r)).toBeNull();
  });
});

describe("linking existing accounts", () => {
  it("a pre-added email is linked on first sign-in and goes straight in", async () => {
    const admin = await seedAdmin();
    const add = await call(admin.cookie, "POST", "/api/users", { name: "Dee", email: "Dee@Luxpackers.com", positionId: "pos_hr", dept: "People & Interns", kind: "Full-time", status: "active" });
    expect(add.status).toBe(201);
    expect(JSON.stringify(await add.json())).not.toMatch(/password|tempPassword/i);
    const r = await googleSignIn("sub-dee", "dee@luxpackers.com");
    expect(redirectOf(r)).toBe("/");
    const me = await json(await call(sessionOf(r)!, "GET", "/api/me"));
    expect(me.user).toMatchObject({ email: "dee@luxpackers.com", approval: "approved", positionName: "HR" });
    expect((await userBy("dee@luxpackers.com")).google_sub).toBe("sub-dee");
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'google_linked'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'access_request'")).toBe(0);
  });

  it("an existing account links by verified email, then is matched by sub even after the Google email changes", async () => {
    await seedAdmin();
    const admin = await makeUser("employee", "Sales", { email: "sayan@luxpackers.com" });
    await makeUser("employee", "Sales", { email: "other@luxpackers.com" });
    expect(redirectOf(await googleSignIn("sub-boss", admin.email))).toBe("/");
    // Google-side email changes to someone else's address: still the same account, nobody else's.
    const r = await googleSignIn("sub-boss", "other@luxpackers.com");
    expect(redirectOf(r)).toBe("/");
    const me = await json(await call(sessionOf(r)!, "GET", "/api/me"));
    expect(me.user.id).toBe(admin.id);
    expect((await userBy("other@luxpackers.com")).google_sub).toBeNull();
    expect((await userBy(admin.email)).google_sub).toBe("sub-boss");
  });

  it("a second Google account that now has a linked account's email cannot take it over", async () => {
    const admin = await seedAdmin();
    await googleSignIn("sub-original", admin.email);
    const r = await googleSignIn("sub-attacker", admin.email);
    expect(redirectOf(r)).toBe("/login?error=account_conflict");
    expect(sessionOf(r)).toBeNull();
    expect((await userBy(admin.email)).google_sub).toBe("sub-original");
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(1);
  });
});

describe("first-ever sign-in", () => {
  it("with no accounts, the first person becomes the Admin, once", async () => {
    expect((await json(await call(null, "GET", "/api/setup"))).needed).toBe(true);
    const r = await googleSignIn("sub-first", "founder@luxpackers.com");
    expect(redirectOf(r)).toBe("/");
    const me = await json(await call(sessionOf(r)!, "GET", "/api/me"));
    expect(me.user).toMatchObject({ isAdmin: true, approval: "approved", mfaEnabled: false });
    expect((await json(await call(null, "GET", "/api/setup"))).needed).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'setup'")).toBe(1);
    const second = await googleSignIn("sub-second", "second@gmail.com");
    expect((await userBy("second@gmail.com")).approval).toBe("pending");
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'access_request'")).toBe(1);
    expect(sessionOf(second)).toBeTruthy();
  });

  it("two people racing: exactly one Admin", async () => {
    const flows = await Promise.all(Array.from({ length: 4 }, () => startFlow()));
    const res = await Promise.all(flows.map((f, i) => finishFlow(f, claimsFor(f, `race-${i}`, `racer${i}@gmail.com`))));
    for (const r of res) expect(redirectOf(r)).toBe("/");
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE position_id = 'pos_admin'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE approval = 'pending'")).toBe(3);
  });

  it("the old password setup is gone", async () => {
    const r = await call(null, "POST", "/api/setup", { name: "X", email: "x@example.com", password: "long-enough-pw" });
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ error: "google_only" });
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(0);
  });
});

/* ---------- two-step sign-in after Google ---------- */

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const codeAt = (step: number) => totpAt(RFC_SECRET, step * 30_000);

/** Marks a user enrolled with a known secret (encrypted the way the Worker does). */
async function enrolled(role: "admin" | "employee", email: string) {
  const u = await makeUser(role, role === "admin" ? "Management" : "Sales", { email, mfa: false });
  const { mfaKey, encryptSecret } = await import("../src/lib/mfa");
  const key = (await mfaKey(env))!;
  await env.DB.prepare("UPDATE users SET totp_secret_enc = ?, totp_enabled_at = ?, totp_last_step = NULL WHERE id = ?")
    .bind(await encryptSecret(key, u.id, RFC_SECRET), new Date().toISOString(), u.id)
    .run();
  return u;
}

async function toCodeStep(sub: string, email: string) {
  const r = await googleSignIn(sub, email);
  expect(redirectOf(r)).toBe("/login/code");
  expect(sessionOf(r)).toBeNull();
  const c = cookiesOf(r).lux_mfa;
  expect(c.raw).toMatch(/HttpOnly/i);
  expect(c.raw).toMatch(/Secure/i);
  expect(c.raw).toMatch(/SameSite=Lax/i);
  return `lux_mfa=${c.value}`;
}

describe("two-step sign-in after Google", () => {
  it("an enrolled admin gets no session from Google alone; the cookie-bound code step creates it", async () => {
    const a = await enrolled("admin", "boss@luxpackers.com");
    const mfaCookie = await toCodeStep("sub-boss", a.email);
    const pending = await env.DB.prepare("SELECT id FROM mfa_pending").all<any>();
    expect(pending.results).toHaveLength(1);
    expect(pending.results[0].id).not.toBe(mfaCookie.split("=")[1]);
    const step = stepAt(Date.now());
    // Without the cookie the code is useless, even the right one.
    const noCookie = await call(null, "POST", "/api/auth/login/mfa", { code: await codeAt(step) });
    expect(noCookie.status).toBe(401);
    expect(await noCookie.json()).toEqual({ error: "mfa_expired" });
    // The old body-token form is not accepted.
    expect((await call(null, "POST", "/api/auth/login/mfa", { mfaToken: mfaCookie.split("=")[1], code: await codeAt(step) })).status).toBe(401);
    const wrong = await call(mfaCookie, "POST", "/api/auth/login/mfa", { code: await codeAt(step + 9) });
    expect(await wrong.json()).toEqual({ error: "bad_code" });
    const ok = await call(mfaCookie, "POST", "/api/auth/login/mfa", { code: await codeAt(step) });
    expect(ok.status).toBe(200);
    const cookie = sessionOf(ok)!;
    expect((await json(await call(cookie, "GET", "/api/me"))).user.id).toBe(a.id);
    expect((await call(cookie, "GET", "/api/users")).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM login_attempts")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login'")).toBe(1);
    // Single use.
    expect((await call(mfaCookie, "POST", "/api/auth/login/mfa", { code: await codeAt(step + 1) })).status).toBe(401);
  });

  it("a backup code works at the code step", async () => {
    const u = await enrolled("employee", "e@luxpackers.com");
    const { backupCodeStmts } = await import("../src/lib/mfa");
    await env.DB.batch(await backupCodeStmts(env.DB, u.id, ["ABCD-EFGH"], new Date().toISOString()));
    const mfaCookie = await toCodeStep("sub-e", u.email);
    expect((await call(mfaCookie, "POST", "/api/auth/login/mfa", { code: "abcd efgh" })).status).toBe(200);
  });

  it("a new Google sign-in drops that person's other half-finished sign-ins", async () => {
    const u = await enrolled("employee", "e@luxpackers.com");
    const first = await toCodeStep("sub-e", u.email);
    const second = await toCodeStep("sub-e", u.email);
    expect(await count("SELECT COUNT(*) AS n FROM mfa_pending")).toBe(1);
    expect((await call(first, "POST", "/api/auth/login/mfa", { code: await codeAt(stepAt(Date.now())) })).status).toBe(401);
    expect((await call(second, "POST", "/api/auth/login/mfa", { code: await codeAt(stepAt(Date.now())) })).status).toBe(200);
  });

  it("20 parallel wrong codes: at most 5 are checked", async () => {
    const u = await enrolled("employee", "e@luxpackers.com");
    const mfaCookie = await toCodeStep("sub-e", u.email);
    const step = stepAt(Date.now());
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => call(mfaCookie, "POST", "/api/auth/login/mfa", { code: String(100000 + i) })));
    const bodies = await Promise.all(res.map(json));
    expect(bodies.filter((b) => b.error === "bad_code").length).toBeLessThanOrEqual(5);
    expect(res.every((r) => r.status !== 200)).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?", u.email)).toBeLessThanOrEqual(5);
    void step;
  });

  it("the 5-per-15-minutes account limit holds across new sign-ins, in parallel", async () => {
    const u = await enrolled("employee", "e@luxpackers.com");
    const t1 = await toCodeStep("sub-e", u.email);
    for (let i = 0; i < 3; i++) await call(t1, "POST", "/api/auth/login/mfa", { code: String(200000 + i) });
    const t2 = await toCodeStep("sub-e", u.email);
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => call(t2, "POST", "/api/auth/login/mfa", { code: String(300000 + i) })));
    const bodies = await Promise.all(res.map(json));
    expect(bodies.filter((b) => b.error === "bad_code").length).toBeLessThanOrEqual(2);
    expect(await count("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?", u.email)).toBe(5);
    // Locked: even the right code on a fresh sign-in is not checked.
    const t3 = await toCodeStep("sub-e", u.email);
    const r = await call(t3, "POST", "/api/auth/login/mfa", { code: await codeAt(stepAt(Date.now())) });
    expect(r.status).toBe(429);
  });

  it("access changes drop half-finished sign-ins: decline-free paths (left, position change, 2-step reset)", async () => {
    const admin = await seedAdmin();
    for (const change of [
      (id: string) => call(admin.cookie, "PATCH", `/api/users/${id}`, { status: "left" }),
      (id: string) => call(admin.cookie, "PATCH", `/api/users/${id}`, { positionId: "pos_hr" }),
      (id: string) => call(admin.cookie, "POST", `/api/users/${id}/mfa/reset`),
    ]) {
      const u = await enrolled("employee", `e-${crypto.randomUUID().slice(0, 6)}@luxpackers.com`);
      const t = await toCodeStep(`sub-${u.id}`, u.email);
      expect((await change(u.id)).status).toBe(200);
      expect(await count("SELECT COUNT(*) AS n FROM mfa_pending WHERE user_id = ?", u.id)).toBe(0);
      expect((await call(t, "POST", "/api/auth/login/mfa", { code: await codeAt(stepAt(Date.now())) })).status).toBe(401);
    }
  });

  it("an unenrolled admin is sent to the enrolment guard after Google, and can still use the sign-in routes", async () => {
    await seedAdmin();
    const a = await makeUser("admin", "Management", { email: "new-admin@luxpackers.com", mfa: false });
    const r = await googleSignIn("sub-na", a.email);
    expect(redirectOf(r)).toBe("/");
    const cookie = sessionOf(r)!;
    expect(await (await call(cookie, "GET", "/api/tasks")).json()).toEqual({ error: "mfa_setup_required" });
    expect((await call(cookie, "GET", "/api/auth/google/start")).status).toBe(302);
    expect((await call(cookie, "GET", "/api/auth/google")).status).toBe(200);
    expect((await call(cookie, "GET", "/api/auth/mfa")).status).toBe(200);
  });
});

describe("enrolment needs a fresh Google sign-in", () => {
  it("a session older than 10 minutes gets reauth_required; a fresh one can enrol and signs out the others", async () => {
    await seedAdmin();
    const u = await makeUser("employee", "Sales", { email: "e@luxpackers.com" });
    await env.DB.prepare("UPDATE sessions SET created_at = ? WHERE user_id = ?").bind(new Date(Date.now() - 11 * 60_000).toISOString(), u.id).run();
    for (const path of ["/api/auth/mfa/setup", "/api/auth/mfa/enable"]) {
      const r = await call(u.cookie, "POST", path, { code: "123456" });
      expect(r.status, path).toBe(403);
      expect(await r.json()).toEqual({ error: "reauth_required" });
    }
    // Back through Google, landing on the enrolment page (a fixed target, chosen by name).
    const f = await startFlow("?next=two-step");
    const r = await finishFlow(f, claimsFor(f, "sub-e", u.email));
    expect(redirectOf(r)).toBe("/account/two-step");
    const fresh = sessionOf(r)!;
    const s = await json(await call(fresh, "POST", "/api/auth/mfa/setup"));
    const { totpAt: at } = await import("../src/lib/totp");
    const e = await call(fresh, "POST", "/api/auth/mfa/enable", { code: await at(s.secret, Date.now()) });
    expect(e.status).toBe(200);
    expect((await call(u.cookie, "GET", "/api/me")).status).toBe(401);
    expect((await call(fresh, "GET", "/api/me")).status).toBe(200);
  });

  it("any other next= value lands on the home page", async () => {
    await seedAdmin();
    for (const q of ["?next=https://evil.example", "?next=//evil.example", "?next=/users"]) {
      const f = await startFlow(q);
      const r = await finishFlow(f, claimsFor(f, `sub-${q.length}`, `n${q.length}@luxpackers.com`));
      expect(redirectOf(r)).toBe("/");
    }
  });
});

/* ---------- passwords are gone ---------- */

describe("password routes return 410 google_only", () => {
  it("sign-in, change, admin set and create/patch with a password", async () => {
    const admin = await seedAdmin();
    const emp = await makeUser("employee", "Sales");
    const cases: [string | null, string, string, unknown][] = [
      [null, "POST", "/api/auth/login", { email: emp.email, password: "whatever-long" }],
      [emp.cookie, "POST", "/api/auth/password", { current: "a", next: "long-enough-pw" }],
      [admin.cookie, "POST", `/api/users/${emp.id}/password`, { password: "long-enough-pw" }],
      [admin.cookie, "POST", "/api/users", { name: "Z", email: "z@x.com", dept: "Sales & Reservations", kind: "Full-time", status: "active", password: "long-enough-pw" }],
      [admin.cookie, "PATCH", `/api/users/${emp.id}`, { password: "long-enough-pw" }],
      [admin.cookie, "PATCH", `/api/users/${emp.id}`, { mustChangePassword: false }],
    ];
    for (const [cookie, method, path, body] of cases) {
      const r = await call(cookie, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(410);
      expect(await r.json()).toEqual({ error: "google_only" });
    }
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", emp.id)).toBe(1);
  });

  it("a leftover must-change-password flag is harmless", async () => {
    const u = await makeUser("employee", "Sales");
    await env.DB.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").bind(u.id).run();
    expect((await call(u.cookie, "GET", "/api/tasks")).status).toBe(200);
    expect(JSON.stringify(await json(await call(u.cookie, "GET", "/api/me")))).not.toMatch(/mustChange/);
  });
});
