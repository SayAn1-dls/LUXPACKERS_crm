import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Perms } from "../../shared/schema";
import { ADMIN_PERMS, NO_PERMS, STARTER_POSITIONS } from "../src/lib/positions";
import { api, applyMigrations, makeUser, permsLike } from "./helpers";
import { seedLeave, seedTask } from "./seed";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "login_attempts", "notifications", "onboarding", "leave_requests", "task_comments", "tasks", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare("DELETE FROM positions WHERE id NOT IN ('pos_admin', 'pos_manager', 'pos_hr', 'pos_employee')").run();
});

const perms = (over: Partial<Perms> = {}): Perms => ({ ...NO_PERMS, ...over, registers: { ...NO_PERMS.registers, ...(over.registers ?? {}) } });
const json = async (r: Response) => (await r.json()) as any;

describe("migration 0002", () => {
  it("creates exactly the four starter positions as designed", async () => {
    const { results } = await env.DB.prepare("SELECT id, name, is_admin, perms FROM positions ORDER BY id").all<any>();
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    for (const p of STARTER_POSITIONS) {
      expect(byId[p.id]).toBeTruthy();
      expect(byId[p.id].name).toBe(p.name);
      expect(byId[p.id].is_admin).toBe(p.isAdmin ? 1 : 0);
      expect(JSON.parse(byId[p.id].perms)).toEqual(p.perms);
    }
  });

  it("maps existing users to a position by role", async () => {
    const mig = env.TEST_MIGRATIONS.find((m: { name: string }) => m.name.startsWith("0002"))!;
    const update = (mig.queries as string[]).find((q: string) => /^\s*UPDATE users SET position_id/i.test(q))!;
    const now = new Date().toISOString();
    for (const role of ["admin", "manager", "hr", "employee"]) {
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, role, dept, password_hash, password_salt, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Operations', 'h', 's', ?, ?)`,
      ).bind(`legacy-${role}`, `${role}@legacy.test`, role, role, now, now).run();
    }
    await env.DB.prepare(update).run();
    const { results } = await env.DB.prepare("SELECT role, position_id FROM users").all<any>();
    for (const r of results) expect(r.position_id).toBe(`pos_${r.role}`);
  });
});

describe("/api/positions access", () => {
  it("admin only", async () => {
    for (const role of ["manager", "hr", "employee"] as const) {
      const u = await makeUser(role, "Operations");
      expect((await api(u.cookie, "GET", "/api/positions")).status).toBe(403);
      expect((await api(u.cookie, "POST", "/api/positions", { name: "X", perms: perms() })).status).toBe(403);
      expect((await api(u.cookie, "PATCH", "/api/positions/pos_employee", { name: "X" })).status).toBe(403);
      expect((await api(u.cookie, "DELETE", "/api/positions/pos_manager")).status).toBe(403);
    }
    // Even a custom position holding every permission is not an admin.
    const all = await makeUser("employee", "Operations", { perms: { ...ADMIN_PERMS } });
    expect((await api(all.cookie, "GET", "/api/positions")).status).toBe(403);
    expect((await api(null, "GET", "/api/positions")).status).toBe(401);
  });

  it("GET lists positions with member counts and built-in flags", async () => {
    const admin = await makeUser("admin", "Management");
    await makeUser("employee", "Operations");
    await makeUser("employee", "Operations");
    const { positions } = await json(await api(admin.cookie, "GET", "/api/positions"));
    expect(positions[0]).toMatchObject({ id: "pos_admin", name: "Admin", isAdmin: true, builtIn: true, memberCount: 1 });
    const emp = positions.find((p: any) => p.id === "pos_employee");
    expect(emp).toMatchObject({ isAdmin: false, builtIn: true, memberCount: 2 });
    expect(positions.find((p: any) => p.id === "pos_manager")).toMatchObject({ builtIn: false, memberCount: 0 });
    expect(Object.keys(emp).sort()).toEqual(["builtIn", "createdAt", "id", "isAdmin", "memberCount", "name", "perms", "updatedAt"]);
  });
});

describe("POST /api/positions", () => {
  it("creates a position; audited", async () => {
    const admin = await makeUser("admin", "Management");
    const p = perms({ tasks: "team", registers: { finance: "manage" }, leave: "team" });
    const res = await api(admin.cookie, "POST", "/api/positions", { name: "  Finance Head ", perms: p });
    expect(res.status).toBe(201);
    const { position } = await json(res);
    expect(position).toMatchObject({ name: "Finance Head", isAdmin: false, builtIn: false, memberCount: 0, perms: p });
    expect(position.id).toMatch(/^pos_/);
    const a = await env.DB.prepare("SELECT action, entity_id FROM audit_log WHERE action = 'position_created'").first<any>();
    expect(a.entity_id).toBe(position.id);
  });

  it("validates: every key and every register required, nothing extra, known levels only", async () => {
    const admin = await makeUser("admin", "Management");
    const post = (body: unknown) => api(admin.cookie, "POST", "/api/positions", body);
    const { addPeople: _a, ...noAddPeople } = perms();
    const { finance: _f, ...regsNoFinance } = perms().registers;
    for (const body of [
      { name: "A", perms: noAddPeople },
      { name: "A", perms: { ...perms(), registers: regsNoFinance } },
      { name: "A", perms: { ...perms(), registers: { ...perms().registers, payroll: "view" } } },
      { name: "A", perms: { ...perms(), registers: { ...perms().registers, leads: "delete" } } },
      { name: "A", perms: { ...perms(), tasks: "company" } },
      { name: "A", perms: { ...perms(), leave: "none" } },
      { name: "A", perms: { ...perms(), people: "private" } },
      { name: "A", perms: { ...perms(), addPeople: "yes" } },
      { name: "A", perms: { ...perms(), extra: 1 } },
      { name: "", perms: perms() },
      { name: "A" },
      { name: "A", perms: perms(), isAdmin: true },
      { name: "A", perms: perms(), isAdmin: false },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM positions").first<any>()).toEqual({ n: 4 });
  });

  it("names are unique, case-insensitively -> 409 name_taken", async () => {
    const admin = await makeUser("admin", "Management");
    const dup = await api(admin.cookie, "POST", "/api/positions", { name: "manager", perms: perms() });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "name_taken" });
  });
});

describe("PATCH /api/positions/:id", () => {
  it("renames and changes perms; members feel it on their next request; label follows", async () => {
    const admin = await makeUser("admin", "Management");
    const id = (await json(await api(admin.cookie, "POST", "/api/positions", { name: "Analyst", perms: perms() }))).position.id;
    const u = await makeUser("employee", "Sales & Reservations", { positionId: id });
    expect((await api(u.cookie, "GET", "/api/records/finance")).status).toBe(403);
    const res = await api(admin.cookie, "PATCH", `/api/positions/${id}`, {
      name: "Finance analyst", perms: perms({ registers: { finance: "view" }, tasks: "team" }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).position).toMatchObject({ name: "Finance analyst", memberCount: 1 });
    expect((await api(u.cookie, "GET", "/api/records/finance")).status).toBe(200);
    expect((await api(u.cookie, "POST", "/api/records/finance", { data: { entry: "x", flow: "In", amount: 1 } })).status).toBe(403);
    const me = (await json(await api(u.cookie, "GET", "/api/me"))).user;
    expect(me).toMatchObject({ positionName: "Finance analyst", role: "manager" });
    expect((await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(u.id).first<any>()).role).toBe("manager");
  });

  it("built-in Admin: perms not editable, isAdmin never toggled; rename allowed", async () => {
    const admin = await makeUser("admin", "Management");
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_admin", { perms: perms() })).status).toBe(409);
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_admin", { isAdmin: false })).status).toBe(400);
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_employee", { isAdmin: true })).status).toBe(400);
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_admin", { name: "Owner" })).status).toBe(200);
    const me = (await json(await api(admin.cookie, "GET", "/api/me"))).user;
    expect(me).toMatchObject({ isAdmin: true, positionName: "Owner", perms: ADMIN_PERMS });
  });

  it("404 unknown, 400 invalid perms, 409 duplicate name", async () => {
    const admin = await makeUser("admin", "Management");
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_nope", { name: "X" })).status).toBe(404);
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_hr", { perms: { tasks: "all" } })).status).toBe(400);
    expect((await api(admin.cookie, "PATCH", "/api/positions/pos_hr", { name: "EMPLOYEE" })).status).toBe(409);
  });
});

describe("DELETE /api/positions/:id", () => {
  it("built-in Admin and Employee are undeletable; in use -> 409 in_use; unused deletes", async () => {
    const admin = await makeUser("admin", "Management");
    for (const id of ["pos_admin", "pos_employee"]) {
      const r = await api(admin.cookie, "DELETE", `/api/positions/${id}`);
      expect(r.status).toBe(409);
      expect((await json(r)).error).toBe("builtin");
    }
    await makeUser("manager", "Operations");
    const inUse = await api(admin.cookie, "DELETE", "/api/positions/pos_manager");
    expect(inUse.status).toBe(409);
    expect((await json(inUse)).error).toBe("in_use");
    // A person who left still holds the position.
    await makeUser("hr", "People & Interns", { status: "left" });
    expect((await api(admin.cookie, "DELETE", "/api/positions/pos_hr")).status).toBe(409);
    const id = (await json(await api(admin.cookie, "POST", "/api/positions", { name: "Temp", perms: perms() }))).position.id;
    expect((await api(admin.cookie, "DELETE", `/api/positions/${id}`)).status).toBe(200);
    expect((await api(admin.cookie, "DELETE", `/api/positions/${id}`)).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'position_deleted'").first<any>()).toEqual({ n: 1 });
  });
});

describe("task scopes from the position", () => {
  it("own: only on-me/by-me; team: department and reports; all: everything", async () => {
    const own = await makeUser("employee", "Operations");
    const team = await makeUser("manager", "Operations");
    const all = await makeUser("employee", "Marketing", { perms: await permsLike("employee", { tasks: "all" }) });
    const report = await makeUser("employee", "Finance", { managerId: team.id });
    const stranger = await makeUser("employee", "Finance");
    const opsTask = await seedTask({ title: "ops", dept: "Operations", assignee: stranger.id, by: stranger.id });
    const reportTask = await seedTask({ title: "report", dept: "Finance", assignee: report.id, by: report.id });
    const farTask = await seedTask({ title: "far", dept: "Finance", assignee: stranger.id, by: stranger.id });

    expect((await api(own.cookie, "GET", "/api/tasks?scope=team")).status).toBe(403);
    expect((await api(own.cookie, "GET", "/api/tasks?scope=all")).status).toBe(403);
    expect((await api(own.cookie, "GET", `/api/tasks/${opsTask}`)).status).toBe(404);

    expect((await api(team.cookie, "GET", "/api/tasks?scope=all")).status).toBe(403);
    const t = await json(await api(team.cookie, "GET", "/api/tasks?scope=team"));
    expect(t.tasks.map((x: any) => x.id).sort()).toEqual([opsTask, reportTask].sort());
    expect((await api(team.cookie, "GET", `/api/tasks/${farTask}`)).status).toBe(404);

    const a = await json(await api(all.cookie, "GET", "/api/tasks?scope=all"));
    expect(a.tasks.map((x: any) => x.id).sort()).toEqual([opsTask, reportTask, farTask].sort());
    expect((await api(all.cookie, "GET", `/api/tasks/${farTask}`)).status).toBe(200);
  });

  it("assignment: own -> self only; team -> department or reports; all -> anyone", async () => {
    const own = await makeUser("employee", "Operations");
    const team = await makeUser("manager", "Operations");
    const all = await makeUser("employee", "Marketing", { perms: await permsLike("employee", { tasks: "all" }) });
    const sameDept = await makeUser("employee", "Operations");
    const report = await makeUser("employee", "Finance", { managerId: team.id });
    const stranger = await makeUser("employee", "Finance");
    const post = (u: { cookie: string }, assigneeId: string) =>
      api(u.cookie, "POST", "/api/tasks", { title: "t", priority: "Low", assigneeId }).then((r) => r.status);
    expect(await post(own, own.id)).toBe(201);
    expect(await post(own, sameDept.id)).toBe(403);
    expect(await post(team, sameDept.id)).toBe(201);
    expect(await post(team, report.id)).toBe(201);
    expect(await post(team, stranger.id)).toBe(403);
    expect(await post(all, stranger.id)).toBe(201);
  });

  it("tasks=all approves a submitted task but never their own", async () => {
    const all = await makeUser("employee", "Marketing", { perms: await permsLike("employee", { tasks: "all" }) });
    const a = await makeUser("employee", "Finance");
    const id = await seedTask({ dept: "Finance", assignee: a.id, by: a.id, status: "Submitted" });
    expect((await api(all.cookie, "POST", `/api/tasks/${id}/approve`, {})).status).toBe(200);
    const mine = await seedTask({ dept: "Finance", assignee: all.id, by: a.id, status: "Submitted" });
    expect((await api(all.cookie, "POST", `/api/tasks/${mine}/approve`, {})).status).toBe(403);
  });
});

describe("leave from the position", () => {
  it("all approves anyone; team approves department or reports; own approves nobody; nobody decides own", async () => {
    const all = await makeUser("employee", "Marketing", { perms: await permsLike("employee", { leave: "all" }) });
    const team = await makeUser("employee", "Operations", { perms: await permsLike("employee", { leave: "team" }) });
    const own = await makeUser("manager", "Operations", { perms: await permsLike("manager", { leave: "own" }) });
    const opsEmp = await makeUser("employee", "Operations", { managerId: own.id });
    const finEmp = await makeUser("employee", "Finance");
    const l1 = await seedLeave(opsEmp.id);
    const l2 = await seedLeave(finEmp.id);
    const l3 = await seedLeave(all.id);
    expect((await api(own.cookie, "POST", `/api/leave/${l1}/approve`, {})).status).toBe(403);
    expect((await api(own.cookie, "GET", "/api/leave?scope=team")).status).toBe(403);
    expect((await api(team.cookie, "POST", `/api/leave/${l2}/approve`, {})).status).toBe(403);
    expect((await api(team.cookie, "GET", "/api/leave?scope=all")).status).toBe(403);
    expect((await api(team.cookie, "POST", `/api/leave/${l1}/approve`, {})).status).toBe(200);
    expect((await api(all.cookie, "POST", `/api/leave/${l2}/approve`, {})).status).toBe(200);
    expect((await api(all.cookie, "POST", `/api/leave/${l3}/approve`, {})).status).toBe(403);
    const list = await json(await api(all.cookie, "GET", "/api/leave?scope=all"));
    expect(list.requests.length).toBe(3);
  });

  it("a new request notifies team approvers (department or manager) and all approvers", async () => {
    const all = await makeUser("employee", "Marketing", { perms: await permsLike("employee", { leave: "all" }) });
    const mgr = await makeUser("manager", "Finance");
    const sameDept = await makeUser("manager", "Operations");
    const otherDept = await makeUser("manager", "Marketing");
    const emp = await makeUser("employee", "Operations", { managerId: mgr.id });
    const res = await api(emp.cookie, "POST", "/api/leave", { kind: "Casual", start: "2030-01-07", end: "2030-01-07" });
    expect(res.status).toBe(201);
    const { results } = await env.DB.prepare("SELECT user_id, link FROM notifications").all<any>();
    const got = Object.fromEntries(results.map((r) => [r.user_id, r.link]));
    expect(got).toEqual({ [mgr.id]: "/leave?tab=team", [sameDept.id]: "/leave?tab=team", [all.id]: "/leave?tab=all" });
    expect(got[otherDept.id]).toBeUndefined();
  });
});

describe("people: addPeople and private fields", () => {
  const newUser = (over: Record<string, unknown> = {}) => ({
    name: "Asha Rao", email: `asha-${crypto.randomUUID().slice(0, 6)}@example.com`, dept: "Operations", kind: "Full-time", status: "active", ...over,
  });

  it("addPeople creates Employee-position accounts only, with a generated password", async () => {
    const hr = await makeUser("hr", "People & Interns");
    const ok = await api(hr.cookie, "POST", "/api/users", newUser());
    expect(ok.status).toBe(201);
    const body = await json(ok);
    expect(body.user).toMatchObject({ positionId: "pos_employee", positionName: "Employee", role: "employee", isAdmin: false });
    expect(body.tempPassword).toBeTruthy();
    expect((await api(hr.cookie, "POST", "/api/users", newUser({ positionId: "pos_employee" }))).status).toBe(201);
    for (const positionId of ["pos_manager", "pos_hr", "pos_admin"]) {
      expect((await api(hr.cookie, "POST", "/api/users", newUser({ positionId }))).status).toBe(403);
    }
    // Choosing the password, or waiving the change at first sign-in, is admin-only.
    expect((await api(hr.cookie, "POST", "/api/users", newUser({ password: "a-long-password" }))).status).toBe(403);
    expect((await api(hr.cookie, "POST", "/api/users", newUser({ mustChangePassword: false }))).status).toBe(403);
  });

  it("a custom addPeople position with people=basic can add but cannot list users or see private fields", async () => {
    const adder = await makeUser("employee", "Operations", { perms: await permsLike("employee", { addPeople: true }) });
    expect((await api(adder.cookie, "POST", "/api/users", newUser())).status).toBe(201);
    expect((await api(adder.cookie, "GET", "/api/users")).status).toBe(403);
    expect(await (await api(adder.cookie, "GET", "/api/people")).text()).not.toMatch(/joinedOn/);
    const mgr = await makeUser("manager", "Operations");
    expect((await api(mgr.cookie, "POST", "/api/users", newUser())).status).toBe(403);
  });

  it("people=full sees private fields and manages onboarding; basic does not", async () => {
    const full = await makeUser("employee", "Operations", { perms: await permsLike("employee", { people: "full" }) });
    const basic = await makeUser("employee", "Operations");
    expect((await api(full.cookie, "GET", "/api/users")).status).toBe(200);
    expect(await (await api(full.cookie, "GET", "/api/people")).text()).toMatch(/joinedOn/);
    expect((await api(full.cookie, "GET", `/api/onboarding/${basic.id}`)).status).toBe(200);
    expect((await api(basic.cookie, "GET", `/api/onboarding/${full.id}`)).status).toBe(403);
    expect((await api(basic.cookie, "PATCH", `/api/onboarding/${basic.id}`, { step: "Policies read", done: true })).status).toBe(403);
  });

  it("admin creates with any position and a typed password; no temp password returned", async () => {
    const admin = await makeUser("admin", "Management");
    const id = (await json(await api(admin.cookie, "POST", "/api/positions", { name: "Finance Head", perms: perms({ registers: { finance: "manage" } }) }))).position.id;
    const res = await api(admin.cookie, "POST", "/api/users", newUser({ email: "fh@example.com", positionId: id, password: "typed-by-admin", mustChangePassword: false }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.tempPassword).toBeUndefined();
    expect(body.user).toMatchObject({ positionId: id, positionName: "Finance Head" });
    expect(JSON.stringify(body)).not.toMatch(/hash|salt|typed-by-admin/);
    const login = await api(null, "POST", "/api/auth/login", { email: "fh@example.com", password: "typed-by-admin" });
    expect(login.status).toBe(200);
    expect((await json(login)).user).toMatchObject({ mustChangePassword: false, positionId: id });
    expect(JSON.stringify(await env.DB.prepare("SELECT * FROM audit_log").all())).not.toContain("typed-by-admin");
    // Default is must-change; too-short password and unknown position are rejected.
    await api(admin.cookie, "POST", "/api/users", newUser({ email: "mc@example.com", password: "typed-by-admin" }));
    expect((await env.DB.prepare("SELECT must_change_password AS m FROM users WHERE email = 'mc@example.com'").first<any>()).m).toBe(1);
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ password: "short" }))).status).toBe(400);
    expect((await api(admin.cookie, "POST", "/api/users", newUser({ positionId: "pos_nope" }))).status).toBe(400);
  });
});

describe("admin sets email and password", () => {
  it("email change: unique (409 email_taken), normalised, new email signs in", async () => {
    const admin = await makeUser("admin", "Management");
    const emp = await makeUser("employee", "Operations");
    const other = await makeUser("employee", "Operations");
    const dup = await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { email: other.email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "email_taken" });
    const ok = await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { email: " New.Address@Example.com " });
    expect(ok.status).toBe(200);
    expect((await json(ok)).user.email).toBe("new.address@example.com");
    expect((await api(null, "POST", "/api/auth/login", { email: "new.address@example.com", password: emp.password })).status).toBe(200);
    const hr = await makeUser("hr", "People & Interns");
    expect((await api(hr.cookie, "PATCH", `/api/users/${emp.id}`, { email: "x@example.com" })).status).toBe(403);
  });

  it("POST /:id/password: old sessions 401, new password signs in, must-change default on, audited without the password", async () => {
    const admin = await makeUser("admin", "Management");
    const emp = await makeUser("employee", "Operations");
    const res = await api(admin.cookie, "POST", `/api/users/${emp.id}/password`, { password: "brand-new-secret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await api(emp.cookie, "GET", "/api/me")).status).toBe(401);
    expect((await api(null, "POST", "/api/auth/login", { email: emp.email, password: emp.password })).status).toBe(401);
    expect((await api(null, "POST", "/api/auth/login", { email: emp.email, password: "brand-new-secret" })).status).toBe(200);
    expect((await env.DB.prepare("SELECT must_change_password AS m FROM users WHERE id = ?").bind(emp.id).first<any>()).m).toBe(1);
    await api(admin.cookie, "POST", `/api/users/${emp.id}/password`, { password: "another-secret!", mustChange: false });
    expect((await env.DB.prepare("SELECT must_change_password AS m FROM users WHERE id = ?").bind(emp.id).first<any>()).m).toBe(0);
    const audits = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'password_set'").all<any>();
    expect(audits.results.length).toBe(2);
    expect(JSON.stringify(audits.results)).not.toMatch(/brand-new-secret|another-secret/);
  });

  it("POST /:id/password: validation and access", async () => {
    const admin = await makeUser("admin", "Management");
    const hr = await makeUser("hr", "People & Interns");
    const emp = await makeUser("employee", "Operations");
    expect((await api(admin.cookie, "POST", `/api/users/${emp.id}/password`, { password: "short" })).status).toBe(400);
    expect((await api(admin.cookie, "POST", `/api/users/nope/password`, { password: "long-enough-1" })).status).toBe(404);
    expect((await api(admin.cookie, "POST", `/api/users/${admin.id}/password`, { password: "long-enough-1" })).status).toBe(403);
    expect((await api(hr.cookie, "POST", `/api/users/${emp.id}/password`, { password: "long-enough-1" })).status).toBe(403);
    expect((await api(emp.cookie, "POST", `/api/users/${emp.id}/password`, { password: "long-enough-1" })).status).toBe(403);
  });

  it("PATCH with password works the same; mustChangePassword alone is invalid", async () => {
    const admin = await makeUser("admin", "Management");
    const emp = await makeUser("employee", "Operations");
    expect((await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { mustChangePassword: false })).status).toBe(400);
    const r = await api(admin.cookie, "PATCH", `/api/users/${emp.id}`, { password: "patched-secret", mustChangePassword: false, title: "Lead" });
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).not.toMatch(/hash|salt|patched-secret/);
    expect((await api(emp.cookie, "GET", "/api/me")).status).toBe(401);
    expect((await api(null, "POST", "/api/auth/login", { email: emp.email, password: "patched-secret" })).status).toBe(200);
    const audits = await env.DB.prepare("SELECT action, detail FROM audit_log ORDER BY action").all<any>();
    expect(audits.results.map((a) => a.action).filter((a) => a !== "login")).toEqual(["password_set", "user_updated"]);
    expect(JSON.parse(audits.results.find((a) => a.action === "user_updated").detail).fields).toEqual(["title"]);
  });
});

describe("last admin", () => {
  it("the last active admin cannot be demoted or disabled (409 last_admin)", async () => {
    const admin = await makeUser("admin", "Management");
    const demote = await api(admin.cookie, "PATCH", `/api/users/${admin.id}`, { positionId: "pos_manager" });
    expect(demote.status).toBe(409);
    expect(await demote.json()).toEqual({ error: "last_admin" });
    expect((await api(admin.cookie, "PATCH", `/api/users/${admin.id}`, { status: "left" })).status).toBe(409);
    // A left admin does not count as a remaining admin.
    await makeUser("admin", "Management", { status: "left" });
    expect((await api(admin.cookie, "PATCH", `/api/users/${admin.id}`, { positionId: "pos_manager" })).status).toBe(409);
    expect((await env.DB.prepare("SELECT position_id FROM users WHERE id = ?").bind(admin.id).first<any>()).position_id).toBe("pos_admin");
  });

  it("with two admins, one may demote the other, after which the survivor is the last", async () => {
    const a = await makeUser("admin", "Management");
    const b = await makeUser("admin", "Management");
    const r = await api(a.cookie, "PATCH", `/api/users/${b.id}`, { positionId: "pos_employee" });
    expect(r.status).toBe(200);
    expect((await json(r)).user).toMatchObject({ isAdmin: false, role: "employee", positionName: "Employee" });
    expect((await json(await api(b.cookie, "GET", "/api/me"))).user.isAdmin).toBe(false);
    expect((await api(b.cookie, "GET", "/api/positions")).status).toBe(403);
    expect((await api(a.cookie, "PATCH", `/api/users/${a.id}`, { positionId: "pos_employee" })).status).toBe(409);
  });
});

describe("/api/me", () => {
  it("returns { user } with position, isAdmin and effective perms; never secrets", async () => {
    const emp = await makeUser("employee", "Operations");
    const res = await api(emp.cookie, "GET", "/api/me");
    const text = await res.text();
    expect(text).not.toMatch(/hash|salt|password_/);
    const { user } = JSON.parse(text);
    expect(Object.keys(user).sort()).toEqual(
      ["dept", "email", "id", "isAdmin", "managerId", "mustChangePassword", "name", "perms", "positionId", "positionName", "role"].sort(),
    );
    expect(user).toMatchObject({ isAdmin: false, positionId: "pos_employee", positionName: "Employee", role: "employee" });
    expect(user.perms).toEqual(STARTER_POSITIONS.find((p) => p.id === "pos_employee")!.perms);
    const admin = await makeUser("admin", "Management");
    expect((await json(await api(admin.cookie, "GET", "/api/me"))).user).toMatchObject({ isAdmin: true, perms: ADMIN_PERMS, role: "admin" });
  });

  it("a user with no position fails closed", async () => {
    const u = await makeUser("employee", "Operations");
    await env.DB.prepare("UPDATE users SET position_id = NULL WHERE id = ?").bind(u.id).run();
    const { user } = await json(await api(u.cookie, "GET", "/api/me"));
    expect(user).toMatchObject({ isAdmin: false, positionId: null, positionName: null, perms: NO_PERMS });
    expect((await api(u.cookie, "GET", "/api/records/leads")).status).toBe(403);
  });
});
