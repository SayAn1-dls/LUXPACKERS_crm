import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, applyMigrations, makeUser } from "./helpers";
import { addDays, clearAll, seedLeave, seedRecord, seedTask, today } from "./seed";

beforeAll(async () => {
  await applyMigrations();
});
beforeEach(clearAll);

const get = async (u: { cookie: string }) => {
  const res = await api(u.cookie, "GET", "/api/dashboard");
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};
const ids = (list: any[]) => list.map((t) => t.id).sort();
const OPS = "Operations";

describe("employee dashboard", () => {
  it("has no manager/hr/admin keys", async () => {
    const e = await makeUser("employee", OPS);
    const d = await get(e);
    for (const k of ["overdue", "today", "week", "sentBack", "waitingOnMe", "submitted", "leaveBalance", "unread"]) expect(d).toHaveProperty(k);
    for (const k of ["reviewQueue", "workload", "pendingLeave", "registers", "onboarding", "joiningSoon", "figures", "attention", "next7", "departments", "latest"]) {
      expect(d).not.toHaveProperty(k);
    }
  });

  it("buckets overdue / today / week / submitted from my own open tasks only", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS, { managerId: mgr.id });
    const o = await makeUser("employee", OPS, { managerId: mgr.id });
    const t = today();
    const over = await seedTask({ assignee: e.id, by: mgr.id, due: addDays(t, -2) });
    const tod = await seedTask({ assignee: e.id, by: mgr.id, due: t });
    const wk = await seedTask({ assignee: e.id, by: mgr.id, due: addDays(t, 7) });
    await seedTask({ assignee: e.id, by: mgr.id, due: addDays(t, 8) });
    await seedTask({ assignee: e.id, by: mgr.id, due: addDays(t, -3), status: "Done" });
    const sub = await seedTask({ assignee: e.id, by: mgr.id, status: "Submitted", due: addDays(t, 30) });
    await seedTask({ assignee: o.id, by: mgr.id, due: addDays(t, -2) });
    const d = await get(e);
    expect(ids(d.overdue)).toEqual([over]);
    expect(ids(d.today)).toEqual([tod]);
    expect(ids(d.week)).toEqual([wk]);
    expect(ids(d.submitted)).toEqual([sub]);
    expect(d.overdue[0]).toHaveProperty("assigneeName");
    expect(d.overdue[0].late).toBe(true);
    expect(d.leaveBalance.Casual).toEqual({ allowed: 12, used: 0, left: 12 });
    expect(d.unread).toBe(0);
  });

  it("sentBack: only when the latest comment is sent_back", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS, { managerId: mgr.id });
    const a = await seedTask({ assignee: e.id, by: mgr.id, comment: { userId: mgr.id, kind: "sent_back", at: "2030-01-01T00:00:00.000Z" } });
    const b = await seedTask({ assignee: e.id, by: mgr.id, comment: { userId: mgr.id, kind: "sent_back", at: "2030-01-01T00:00:00.000Z" } });
    await env.DB.prepare("INSERT INTO task_comments (id, task_id, user_id, body, kind, created_at) VALUES (?, ?, ?, 'ok', 'comment', '2030-01-02T00:00:00.000Z')")
      .bind(crypto.randomUUID(), b, e.id).run();
    expect(ids((await get(e)).sentBack)).toEqual([a]);
  });

  it("waitingOnMe: name match is case/space-insensitive and limited to tasks I can see", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS, { managerId: mgr.id });
    const name = (await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(e.id).first<any>()).name as string;
    const finMgr = await makeUser("manager", "Finance");
    const fin = await makeUser("employee", "Finance", { managerId: finMgr.id });
    const visible = await seedTask({ assignee: fin.id, by: e.id, status: "Waiting", waitingOn: `  ${name.toUpperCase()} ` });
    await seedTask({ assignee: fin.id, by: finMgr.id, status: "Waiting", dept: "Finance", waitingOn: name }); // invisible to e
    await seedTask({ assignee: fin.id, by: e.id, status: "To do", waitingOn: name }); // not Waiting
    expect(ids((await get(e)).waitingOnMe)).toEqual([visible]);
  });
});

describe("manager dashboard", () => {
  it("reviewQueue contains a submitted task from their dept, not another dept's", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS, { managerId: mgr.id });
    const fin = await makeUser("employee", "Finance");
    const mine = await seedTask({ assignee: e.id, by: mgr.id, status: "Submitted" });
    await seedTask({ assignee: fin.id, by: fin.id, dept: "Finance", status: "Submitted" });
    await seedTask({ assignee: mgr.id, by: mgr.id, status: "Submitted" }); // own work is not theirs to approve
    const d = await get(mgr);
    expect(ids(d.reviewQueue)).toEqual([mine]);
    expect(d).toHaveProperty("overdue");
    expect(d).not.toHaveProperty("figures");
    expect(d).not.toHaveProperty("onboarding");
  });

  it("workload covers dept or direct reports (not left, not other depts); pendingLeave only reports", async () => {
    const mgr = await makeUser("manager", OPS);
    const e1 = await makeUser("employee", OPS, { managerId: mgr.id });
    const rep = await makeUser("employee", "Finance", { managerId: mgr.id });
    await makeUser("employee", OPS, { managerId: mgr.id, status: "left" });
    const stranger = await makeUser("employee", "Finance");
    const t = today();
    await seedTask({ assignee: e1.id, by: mgr.id, due: addDays(t, -1) });
    await seedTask({ assignee: e1.id, by: mgr.id, status: "Submitted" });
    await seedTask({ assignee: e1.id, by: mgr.id, status: "Done" });
    await seedLeave(rep.id);
    await seedLeave(stranger.id);
    await seedLeave(rep.id, "Approved");
    const d = await get(mgr);
    expect(d.workload.map((w: any) => w.userId).sort()).toEqual([e1.id, rep.id].sort());
    const w = d.workload.find((x: any) => x.userId === e1.id);
    expect(w).toMatchObject({ open: 2, late: 1, submitted: 1 });
    expect(d.pendingLeave).toHaveLength(1);
    expect(d.pendingLeave[0].userId).toBe(rep.id);
  });

  it("registers lists readable registers with open counts (empty doneValues counts all)", async () => {
    const sales = await makeUser("manager", "Sales & Reservations");
    await seedRecord("leads", "A", { stage: "New enquiry" });
    await seedRecord("leads", "B", { stage: "Confirmed" });
    await seedRecord("leads", "C", { stage: "Lost" });
    await seedRecord("leads", "D", { stage: "Contacted" }, { deleted: true });
    await seedRecord("finance", "F", { status: "Pending" });
    const d = await get(sales);
    const m = Object.fromEntries(d.registers.map((r: any) => [r.id, r]));
    expect(m.leads).toMatchObject({ name: "Enquiries", open: 1 });
    expect(m.bookings).toBeDefined();
    expect(m.finance).toBeUndefined();
    const ops = await makeUser("manager", OPS);
    await seedRecord("partners", "P", { status: "Active" });
    const o = Object.fromEntries((await get(ops)).registers.map((r: any) => [r.id, r]));
    expect(o.partners.open).toBe(1);
  });
});

describe("hr dashboard", () => {
  it("onboarding lists onboarding user with 1/6; joiningSoon within 30 days; pendingLeave all", async () => {
    const admin = await makeUser("admin", "Management");
    const hr = await makeUser("hr", "People & Interns");
    const created = await api(admin.cookie, "POST", "/api/users", {
      name: "New Joiner", email: "new@example.com", role: "employee", dept: OPS, kind: "Full-time", status: "onboarding", joinedOn: addDays(today(), 10),
    });
    expect(created.status).toBe(201);
    const nu = ((await created.json()) as any).user;
    const e = await makeUser("employee", OPS);
    await seedLeave(e.id);
    const d = await get(hr);
    expect(d.onboarding).toEqual([{ userId: nu.id, name: "New Joiner", done: 1, total: 6, joinedOn: addDays(today(), 10) }]);
    expect(d.joiningSoon).toEqual([{ userId: nu.id, name: "New Joiner", joinedOn: addDays(today(), 10) }]);
    expect(d.pendingLeave).toHaveLength(1);
    expect(d).not.toHaveProperty("figures");
    expect(d).not.toHaveProperty("workload");
  });

  it("joiningSoon excludes past and >30 day dates", async () => {
    const hr = await makeUser("hr", "People & Interns");
    const mk = async (name: string, joined: string) => {
      const u = await makeUser("employee", OPS);
      await env.DB.prepare("UPDATE users SET name = ?, joined_on = ? WHERE id = ?").bind(name, joined, u.id).run();
    };
    await mk("Past", addDays(today(), -1));
    await mk("Far", addDays(today(), 31));
    await mk("Edge", addDays(today(), 30));
    await mk("Todayer", today());
    const d = await get(hr);
    expect(d.joiningSoon.map((j: any) => j.name).sort()).toEqual(["Edge", "Todayer"]);
  });
});

describe("admin dashboard", () => {
  it("figures follow legacy rules", async () => {
    const admin = await makeUser("admin", "Management");
    const e = await makeUser("employee", OPS);
    const t = today();
    await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, -1) });
    await seedTask({ assignee: e.id, by: admin.id, status: "Waiting" });
    await seedTask({ assignee: e.id, by: admin.id, status: "Done", due: addDays(t, -9) });
    await seedRecord("leads", "L1", { stage: "New enquiry", quote: 1000 });
    await seedRecord("leads", "L2", { stage: "Quote sent", quote: 2500 });
    await seedRecord("leads", "L3", { stage: "Confirmed", quote: 9999 });
    await seedRecord("leads", "L4", { stage: "Lost", quote: 9999 });
    await seedRecord("finance", "in-now", { flow: "In", status: "Paid", date: `${t.slice(0, 7)}-01`, amount: 500 });
    await seedRecord("finance", "in-now2", { flow: "In", status: "Paid", date: t, amount: 700 });
    await seedRecord("finance", "in-pending", { flow: "In", status: "Pending", date: t, amount: 900 });
    await seedRecord("finance", "out", { flow: "Out", status: "Paid", date: t, amount: 900 });
    await seedRecord("finance", "in-old", { flow: "In", status: "Paid", date: "2001-01-01", amount: 900 });
    await seedRecord("trips", "T1", { status: "Live" });
    await seedRecord("trips", "T2", { status: "Paused" });
    await seedRecord("trips", "T3", { status: "Live" }, { deleted: true });
    const d = await get(admin);
    expect(d.figures).toEqual({
      openTasks: 2, late: 1, waiting: 1, openEnquiries: 2, quoted: 3500, receivedThisMonth: 1200, tripsLive: 1, tripsTotal: 2,
    });
    for (const k of ["overdue", "reviewQueue", "workload", "pendingLeave", "registers", "onboarding", "joiningSoon", "attention", "next7", "departments", "latest"]) {
      expect(d).toHaveProperty(k);
    }
  });

  it("attention order: late tasks, Blocked, late lead follow-ups, High priority; max 9", async () => {
    const admin = await makeUser("admin", "Management");
    const e = await makeUser("employee", OPS);
    const t = today();
    const late = await seedTask({ title: "late", assignee: e.id, by: admin.id, due: addDays(t, -1), priority: "High" });
    const blocked = await seedTask({ title: "blocked", assignee: e.id, by: admin.id, status: "Blocked" });
    const lead = await seedRecord("leads", "overdue lead", { stage: "Contacted", followUp: addDays(t, -2) }, { dept: "Sales & Reservations" });
    const high = await seedTask({ title: "high", assignee: e.id, by: admin.id, priority: "High", due: addDays(t, 3) });
    await seedRecord("leads", "future lead", { stage: "Contacted", followUp: addDays(t, 2) });
    await seedRecord("leads", "closed lead", { stage: "Lost", followUp: addDays(t, -2) });
    const d = await get(admin);
    expect(d.attention.map((a: any) => a.id)).toEqual([late, blocked, lead, high]);
    expect(d.attention[0]).toMatchObject({ kind: "task", title: "late", dept: OPS, link: `/tasks?open=${late}` });
    expect(d.attention[0].owner).toBe((await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(e.id).first<any>()).name);
    expect(d.attention[2]).toMatchObject({ kind: "record", link: `/registers/leads?open=${lead}` });
    for (let i = 0; i < 12; i++) await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, -5) });
    expect((await get(admin)).attention).toHaveLength(9);
  });

  it("next7 merges tasks and register dates in [today, today+7], open only, sorted", async () => {
    const admin = await makeUser("admin", "Management");
    const e = await makeUser("employee", OPS);
    const t = today();
    const t1 = await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, 5) });
    await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, 8) });
    await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, 1), status: "Done" });
    await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, -1) });
    const l1 = await seedRecord("leads", "follow", { stage: "Contacted", followUp: addDays(t, 2) });
    await seedRecord("leads", "closed", { stage: "Lost", followUp: addDays(t, 2) });
    const b = await seedRecord("bookings", "trip start", { payStatus: "Part paid", start: t });
    const d = await get(admin);
    expect(d.next7.map((x: any) => x.id)).toEqual([b, l1, t1]);
    expect(d.next7[0]).toMatchObject({ kind: "record", due: t, link: `/registers/bookings?open=${b}` });
  });

  it("departments counts tasks per department; latest is 7 newest audit rows with names", async () => {
    const admin = await makeUser("admin", "Management");
    const e = await makeUser("employee", OPS);
    const t = today();
    await seedTask({ assignee: e.id, by: admin.id, due: addDays(t, -1) });
    await seedTask({ assignee: e.id, by: admin.id, status: "Done" });
    await seedTask({ assignee: e.id, by: admin.id, dept: "Finance" });
    for (let i = 0; i < 9; i++) {
      await env.DB.prepare("INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, title) VALUES (?, ?, ?, 'x', 'task', ?, ?)")
        .bind(crypto.randomUUID(), `2030-01-0${i + 1}T00:00:00.000Z`, admin.id, `e${i}`, `T${i}`).run();
    }
    const d = await get(admin);
    expect(d.departments).toHaveLength(8);
    expect(d.departments.find((x: any) => x.name === OPS)).toEqual({ name: OPS, open: 1, late: 1, done: 1, total: 2 });
    expect(d.departments.find((x: any) => x.name === "Finance")).toMatchObject({ open: 1, total: 1 });
    expect(d.latest).toHaveLength(7);
    expect(d.latest[0].title).toBe("T8");
    expect(d.latest[0].userName).toContain("admin");
  });

  it("non-admin roles never get admin keys even with data present", async () => {
    const hr = await makeUser("hr", "People & Interns");
    expect(await get(hr)).not.toHaveProperty("latest");
  });
});

it("dashboard requires sign-in", async () => {
  expect((await api(null, "GET", "/api/dashboard")).status).toBe(401);
});
