import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notify } from "../src/lib/notify";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "login_attempts", "notifications", "onboarding", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

const newUser = (over: Record<string, unknown> = {}) => ({
  name: "Asha Rao",
  email: "Asha@Example.com ",
  role: "employee",
  dept: "Operations",
  kind: "Full-time",
  status: "active",
  ...over,
});

describe("GET /api/users", () => {
  it("employee -> 403, hr/admin -> 200 without secrets", async () => {
    const emp = await makeUser("employee", "Operations");
    const hr = await makeUser("hr", "People & Interns");
    expect((await api(emp.cookie, "GET", "/api/users")).status).toBe(403);
    const res = await api(hr.cookie, "GET", "/api/users");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/password|must_change/i);
    expect(JSON.parse(text).users.length).toBe(2);
    expect(JSON.parse(text).users[0]).toHaveProperty("status");
  });
});

describe("POST /api/users", () => {
  it("hr can create employee, cannot create manager", async () => {
    const hr = await makeUser("hr", "People & Interns");
    const ok = await api(hr.cookie, "POST", "/api/users", newUser());
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as any;
    expect(body.tempPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);
    expect(body.user.email).toBe("asha@example.com");
    expect(JSON.stringify(body.user)).not.toMatch(/password|must_change/i);
    const row = await env.DB.prepare("SELECT must_change_password FROM users WHERE id = ?").bind(body.user.id).first<any>();
    expect(row.must_change_password).toBe(1);
    const bad = await api(hr.cookie, "POST", "/api/users", newUser({ email: "m@example.com", role: "manager" }));
    expect(bad.status).toBe(403);
    expect((await api(null, "POST", "/api/users", newUser())).status).toBe(401);
  });

  it("temp password can log in, forces change, and is never in audit", async () => {
    const admin = await makeUser("admin", "Management");
    const body = (await (await api(admin.cookie, "POST", "/api/users", newUser({ role: "manager" }))).json()) as any;
    const login = await api(null, "POST", "/api/auth/login", { email: "asha@example.com", password: body.tempPassword });
    expect(login.status).toBe(200);
    const audits = await env.DB.prepare("SELECT * FROM audit_log WHERE action = 'user_created'").all<any>();
    expect(audits.results.length).toBe(1);
    expect(JSON.stringify(audits.results)).not.toContain(body.tempPassword);
  });

  it("duplicate email -> 409 email_taken (case-insensitive)", async () => {
    const admin = await makeUser("admin", "Management");
    expect((await api(admin.cookie, "POST", "/api/users", newUser())).status).toBe(201);
    const dup = await api(admin.cookie, "POST", "/api/users", newUser({ email: "ASHA@example.com" }));
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "email_taken" });
  });

  it("validates dept, role and managerId", async () => {
    const admin = await makeUser("admin", "Management");
    const left = await makeUser("manager", "Operations", { status: "left" });
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ dept: "Nowhere" }))).status).toBe(400);
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ role: "boss" }))).status).toBe(400);
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ managerId: "nope" }))).status).toBe(400);
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ managerId: left.id }))).status).toBe(400);
    const mgr = await makeUser("manager", "Operations");
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ managerId: mgr.id }))).status).toBe(201);
  });

  it("onboarding user gets 6 steps, 1 done; HR is notified; audit written", async () => {
    const admin = await makeUser("admin", "Management");
    const hr1 = await makeUser("hr", "People & Interns");
    const hr2 = await makeUser("hr", "People & Interns");
    const body = (await (await api(admin.cookie, "POST", "/api/users", newUser({ status: "onboarding" }))).json()) as any;
    const steps = await env.DB.prepare("SELECT step, done FROM onboarding WHERE user_id = ?").bind(body.user.id).all<any>();
    expect(steps.results.length).toBe(6);
    expect(steps.results.filter((s) => s.done === 1).map((s) => s.step)).toEqual(["Account created"]);
    const notes = await env.DB.prepare("SELECT user_id, kind, link FROM notifications").all<any>();
    expect(notes.results.map((n) => n.user_id).sort()).toEqual([hr1.id, hr2.id].sort());
    expect(notes.results[0]).toMatchObject({ kind: "user_created", link: "/people" });
  });

  it("active user gets no onboarding rows", async () => {
    const admin = await makeUser("admin", "Management");
    const body = (await (await api(admin.cookie, "POST", "/api/users", newUser())).json()) as any;
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM onboarding WHERE user_id = ?").bind(body.user.id).first<any>();
    expect(n.n).toBe(0);
  });
});

describe("PATCH /api/users/:id", () => {
  it("setting status left kills that user's sessions", async () => {
    const admin = await makeUser("admin", "Management");
    const emp = await makeUser("employee", "Operations");
    expect((await api(emp.cookie, "GET", "/api/me")).status).toBe(200);
    const res = await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { status: "left" });
    expect(res.status).toBe(200);
    expect((await api(emp.cookie, "GET", "/api/me")).status).toBe(401);
    const a = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'user_disabled'").all();
    expect(a.results.length).toBe(1);
  });

  it("position change: admin only; self-change and self-leave forbidden (or last_admin when alone)", async () => {
    const admin = await makeUser("admin", "Management");
    const hr = await makeUser("hr", "People & Interns");
    const emp = await makeUser("employee", "Operations");
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { positionId: "pos_manager" })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { role: "manager" })).status).toBe(403);
    // Deprecated `role` still maps onto the starter position.
    const r = await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { role: "manager" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).user).toMatchObject({ positionId: "pos_manager", positionName: "Manager", role: "manager" });
    expect((await api(admin.cookie, "PATCH", `/api/users/${admin.id}`, { positionId: "pos_employee" })).status).toBe(409);
    await makeUser("admin", "Management");
    expect((await api(admin.cookie, "PATCH", `/api/users/${admin.id}`, { positionId: "pos_employee" })).status).toBe(403);
    expect((await api(admin.cookie, "PATCH", `/api/users/${admin.id}`, { status: "left" })).status).toBe(403);
  });
  it("only admin edits people; HR (people full) cannot edit anyone; audit lists field names only", async () => {
    const admin = await makeUser("admin", "Management");
    const hr = await makeUser("hr", "People & Interns");
    const mgr = await makeUser("manager", "Operations");
    const emp = await makeUser("employee", "Operations");
    expect((await api(hr.cookie, "PATCH", `/api/users/${mgr.id}`, { title: "Lead" })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { title: "Lead" })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { status: "left" })).status).toBe(403);
    const ok = await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { title: "Executive", phone: "99999", managerId: mgr.id });
    expect(ok.status).toBe(200);
    const a = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'user_updated' AND entity_id = ?").bind(emp.id).first<any>();
    expect(JSON.parse(a.detail).fields.sort()).toEqual(["managerId", "phone", "title"]);
    expect(a.detail).not.toContain("99999");
  });
  it("employee -> 403; unknown id -> 404; bad manager -> 400; self as manager -> 400", async () => {
    const hr = await makeUser("admin", "People & Interns");
    const emp = await makeUser("employee", "Operations");
    expect((await api(emp.cookie, "PATCH", `/api/users/${emp.id}`, { title: "x" })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/users/nope`, { title: "x" })).status).toBe(404);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { managerId: "ghost" })).status).toBe(400);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { managerId: emp.id })).status).toBe(400);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { dept: "Nowhere" })).status).toBe(400);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { positionId: "pos_nope" })).status).toBe(400);
  });
});

describe("POST /api/users/:id/reset-password", () => {
  it("admin resets (hr cannot); new password works, old sessions die, must change", async () => {
    const admin = await makeUser("admin", "Management");
    const hr = await makeUser("hr", "People & Interns");
    const emp = await makeUser("employee", "Operations");
    expect((await api(hr.cookie, "POST", `/api/users/${emp.id}/reset-password`, {})).status).toBe(403);
    const res = await api(admin.cookie, "POST", `/api/users/${emp.id}/reset-password`, {});
    expect(res.status).toBe(200);
    const { tempPassword } = (await res.json()) as any;
    expect(tempPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);
    expect((await api(emp.cookie, "GET", "/api/me")).status).toBe(401);
    expect((await api(null, "POST", "/api/auth/login", { email: emp.email, password: tempPassword })).status).toBe(200);
    const row = await env.DB.prepare("SELECT must_change_password FROM users WHERE id = ?").bind(emp.id).first<any>();
    expect(row.must_change_password).toBe(1);
    const a = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'password_reset'").all<any>();
    expect(a.results.length).toBe(1);
    expect(JSON.stringify(a.results)).not.toContain(tempPassword);
  });
});

describe("GET /api/people", () => {
  it("signed out -> 401; hides joinedOn/kind from employee, shows to hr; no secrets", async () => {
    const hr = await makeUser("hr", "People & Interns");
    const emp = await makeUser("employee", "Operations");
    await env.DB.prepare("UPDATE users SET joined_on = '2025-01-02', kind = 'Intern' WHERE id = ?").bind(emp.id).run();
    expect((await api(null, "GET", "/api/people")).status).toBe(401);
    const e = await (await api(emp.cookie, "GET", "/api/people")).text();
    expect(e).not.toMatch(/joinedOn|kind|password|must_change/);
    const h = (await (await api(hr.cookie, "GET", "/api/people")).json()) as any;
    const row = h.people.find((p: any) => p.id === emp.id);
    expect(row).toMatchObject({ joinedOn: "2025-01-02", kind: "Intern", dept: "Operations" });
    expect(JSON.stringify(h)).not.toMatch(/password|must_change/);
  });
});

describe("notify", () => {
  it("de-duplicates, skips empty", async () => {
    const u = await makeUser("hr", "People & Interns");
    await notify(env.DB, [], "k", "t", "/x");
    await notify(env.DB, [u.id, u.id], "k", "t", "/x");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications").first<any>();
    expect(n.n).toBe(1);
  });
});

const auditCount = async (action?: string) =>
  (
    await env.DB.prepare(action ? "SELECT COUNT(*) AS n FROM audit_log WHERE action = ?" : "SELECT COUNT(*) AS n FROM audit_log")
      .bind(...(action ? [action] : []))
      .first<any>()
  ).n as number;

describe("fix round 1: escalation paths", () => {
  it("HR cannot create hr or admin accounts", async () => {
    const hr = await makeUser("hr", "People & Interns");
    expect((await api(hr.cookie, "POST", "/api/users", newUser({ email: "h@example.com", role: "hr" }))).status).toBe(403);
    expect((await api(hr.cookie, "POST", "/api/users", newUser({ email: "a@example.com", role: "admin" }))).status).toBe(403);
  });

  it("manager-role caller is refused everywhere", async () => {
    const mgr = await makeUser("manager", "Operations");
    const emp = await makeUser("employee", "Operations");
    expect((await api(mgr.cookie, "GET", "/api/users")).status).toBe(403);
    expect((await api(mgr.cookie, "POST", "/api/users", newUser())).status).toBe(403);
    expect((await api(mgr.cookie, "PATCH", `/api/users/${emp.id}`, { title: "x" })).status).toBe(403);
    expect((await api(mgr.cookie, "POST", `/api/users/${emp.id}/reset-password`, {})).status).toBe(403);
  });

  it("employee cannot reset a password; unknown id is 404 for admin", async () => {
    const emp = await makeUser("employee", "Operations");
    const other = await makeUser("employee", "Operations");
    const admin = await makeUser("admin", "Management");
    expect((await api(emp.cookie, "POST", `/api/users/${other.id}/reset-password`, {})).status).toBe(403);
    expect((await api(admin.cookie, "POST", `/api/users/nope/reset-password`, {})).status).toBe(404);
  });

  it("HR cannot re-activate a left manager; admin can", async () => {
    const hr = await makeUser("hr", "People & Interns");
    const admin = await makeUser("admin", "Management");
    const gone = await makeUser("manager", "Operations", { status: "left" });
    expect((await api(hr.cookie, "PATCH", `/api/users/${gone.id}`, { status: "active" })).status).toBe(403);
    expect((await api(admin.cookie, "PATCH", `/api/users/${gone.id}`, { status: "active" })).status).toBe(200);
  });

  it("HR cannot change anyone's dept or manager, own included", async () => {
    const hr = await makeUser("hr", "People & Interns");
    const emp = await makeUser("employee", "Operations");
    expect((await api(hr.cookie, "PATCH", `/api/users/${hr.id}`, { dept: "Finance" })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/users/${hr.id}`, { managerId: emp.id })).status).toBe(403);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { dept: "Finance" })).status).toBe(403);
    const row = await env.DB.prepare("SELECT dept FROM users WHERE id = ?").bind(hr.id).first<any>();
    expect(row.dept).toBe("People & Interns");
  });
  it("unchanged values do not trip the checks or write audit", async () => {
    const admin = await makeUser("admin", "Management");
    const mgr = await makeUser("manager", "Operations");
    // same dept/status/position as current: not a change, so allowed and silent
    const res = await api(admin.cookie, "PATCH", `/api/users/${mgr.id}`, { dept: "Operations", status: "active", positionId: "pos_manager" });
    expect(res.status).toBe(200);
    expect(await auditCount("user_updated")).toBe(0);
  });

  it("role equal to current is a no-op 200 with no audit", async () => {
    const admin = await makeUser("admin", "Management");
    const emp = await makeUser("employee", "Operations");
    expect((await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { role: "employee" })).status).toBe(200);
    expect(await auditCount()).toBe(0);
  });

  it("only changed fields are audited", async () => {
    const hr = await makeUser("admin", "Management");
    const emp = await makeUser("employee", "Operations");
    await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { title: "Exec" });
    await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { title: "Exec", phone: "123" });
    const rows = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'user_updated' ORDER BY at").all<any>();
    expect(rows.results.map((r) => JSON.parse(r.detail).fields)).toEqual([["title"], ["phone"]]);
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { title: "Exec" })).status).toBe(200);
    expect(await auditCount("user_updated")).toBe(2);
  });

  it("/api/people hides left users from employees, shows them to hr", async () => {
    const emp = await makeUser("employee", "Operations");
    const hr = await makeUser("hr", "People & Interns");
    const gone = await makeUser("employee", "Operations", { status: "left" });
    const e = (await (await api(emp.cookie, "GET", "/api/people")).json()) as any;
    expect(e.people.some((p: any) => p.id === gone.id)).toBe(false);
    const h = (await (await api(hr.cookie, "GET", "/api/people")).json()) as any;
    expect(h.people.some((p: any) => p.id === gone.id)).toBe(true);
  });

  it("create is atomic: a failing notification rolls back the user and audit", async () => {
    const admin = await makeUser("admin", "Management");
    await makeUser("hr", "People & Interns");
    await env.DB.prepare("DROP TRIGGER IF EXISTS boom").run();
    await env.DB.prepare(
      "CREATE TRIGGER boom BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'boom'); END",
    ).run();
    try {
      const res = await api(admin.cookie, "POST", "/api/users", newUser({ email: "atomic@example.com" }));
      expect(res.status).toBe(500);
    } finally {
      await env.DB.prepare("DROP TRIGGER boom").run();
    }
    const u = await env.DB.prepare("SELECT 1 AS x FROM users WHERE email = 'atomic@example.com'").first();
    expect(u).toBeNull();
    expect(await auditCount("user_created")).toBe(0);
  });
});
