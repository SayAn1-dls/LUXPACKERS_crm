import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leaveDays } from "../src/lib/dates";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "notifications", "leave_requests", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'leave_allowances'")
    .bind('{"Casual":12,"Sick":6,"Earned":15}')
    .run();
  await env.DB.prepare("UPDATE settings SET value = '[]' WHERE key = 'holidays'").run();
});

type U = Awaited<ReturnType<typeof makeUser>>;
const OPS = "Operations";
// 2030-01-04 is a Friday; 01-07 Monday; 01-08 Tuesday. 2030-03-04..08 is Mon..Fri.
const apply = (u: U, body: Record<string, unknown>) =>
  api(u.cookie, "POST", "/api/leave", { kind: "Casual", start: "2030-03-04", end: "2030-03-04", halfDay: false, reason: "r", ...body });
const notifs = async (userId: string) =>
  (await env.DB.prepare("SELECT kind, link FROM notifications WHERE user_id = ?").bind(userId).all<{ kind: string; link: string }>()).results;
const auditActions = async () =>
  (await env.DB.prepare("SELECT action FROM audit_log").all<{ action: string }>()).results.map((r) => r.action);

describe("leaveDays", () => {
  it("Fri to Mon counts 2 weekdays", () => expect(leaveDays("2030-01-04", "2030-01-07", false, [])).toBe(2));
  it("holiday on Tue is excluded", () => expect(leaveDays("2030-01-07", "2030-01-09", false, ["2030-01-08"])).toBe(2));
  it("half day single day is 0.5", () => expect(leaveDays("2030-01-07", "2030-01-07", true, [])).toBe(0.5));
  it("half day on a weekend or holiday is 0", () => {
    expect(leaveDays("2030-01-05", "2030-01-05", true, [])).toBe(0);
    expect(leaveDays("2030-01-07", "2030-01-07", true, ["2030-01-07"])).toBe(0);
  });
  it("half day over two days throws", () => expect(() => leaveDays("2030-01-07", "2030-01-08", true, [])).toThrow());
  it("weekend only is 0", () => expect(leaveDays("2030-01-05", "2030-01-06", false, [])).toBe(0));
});

describe("settings", () => {
  it("any signed-in user reads settings; anonymous gets 401", async () => {
    const e = await makeUser("employee", OPS);
    const res = await api(e.cookie, "GET", "/api/settings");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leaveAllowances: { Casual: 12, Sick: 6, Earned: 15 }, holidays: [] });
    expect((await api(null, "GET", "/api/settings")).status).toBe(401);
  });

  it("only admin patches; audited; persists", async () => {
    const admin = await makeUser("admin", OPS);
    for (const role of ["employee", "manager", "hr"] as const) {
      const u = await makeUser(role, OPS);
      expect((await api(u.cookie, "PATCH", "/api/settings", { holidays: ["2030-01-26"] })).status).toBe(403);
    }
    const res = await api(admin.cookie, "PATCH", "/api/settings", {
      leaveAllowances: { Casual: 10, Sick: 5, Earned: 1.5 },
      holidays: ["2030-01-26", "2030-08-15"],
    });
    expect(res.status).toBe(200);
    const got = (await (await api(admin.cookie, "GET", "/api/settings")).json()) as any;
    expect(got.leaveAllowances).toEqual({ Casual: 10, Sick: 5, Earned: 1.5 });
    expect(got.holidays).toEqual(["2030-01-26", "2030-08-15"]);
    expect(await auditActions()).toContain("settings_updated");
  });

  it("validates allowances and holidays", async () => {
    const admin = await makeUser("admin", OPS);
    const bad: unknown[] = [
      { leaveAllowances: { Casual: -1, Sick: 6, Earned: 15 } },
      { leaveAllowances: { Casual: 12, Sick: 6 } },
      { leaveAllowances: { Casual: 12, Sick: 6, Earned: 15, Unpaid: 3 } },
      { leaveAllowances: { Casual: "12", Sick: 6, Earned: 15 } },
      { holidays: ["2030-01-26", "2030-01-26"] },
      { holidays: ["2030-02-30"] },
      { holidays: ["26/01/2030"] },
    ];
    for (const body of bad) expect((await api(admin.cookie, "PATCH", "/api/settings", body)).status).toBe(400);
  });
});

describe("POST /api/leave", () => {
  it("creates a pending request with computed days; notifies manager + HR; audited", async () => {
    const mgr = await makeUser("manager", OPS);
    const hr = await makeUser("hr", "HR");
    const hr2 = await makeUser("hr", "HR");
    const emp = await makeUser("employee", OPS, { managerId: mgr.id });
    const res = await apply(emp, { start: "2030-01-04", end: "2030-01-07" });
    expect(res.status).toBe(201);
    const { request } = (await res.json()) as any;
    expect(request).toMatchObject({ days: 2, status: "Pending", kind: "Casual", halfDay: false, userId: emp.id });
    expect(await notifs(mgr.id)).toEqual([{ kind: "leave_requested", link: "/leave?tab=team" }]);
    for (const u of [hr, hr2]) expect(await notifs(u.id)).toEqual([{ kind: "leave_requested", link: "/leave?tab=all" }]);
    expect(await notifs(emp.id)).toEqual([]);
    expect(await auditActions()).toContain("leave_requested");
  });

  it("does not notify a manager_id that is not a manager role", async () => {
    const boss = await makeUser("employee", OPS);
    const emp = await makeUser("employee", OPS, { managerId: boss.id });
    expect((await apply(emp, {})).status).toBe(201);
    expect(await notifs(boss.id)).toEqual([]);
  });

  it("half day single day = 0.5; half day over two days -> 400", async () => {
    const emp = await makeUser("employee", OPS);
    const ok = await apply(emp, { halfDay: true });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as any).request).toMatchObject({ days: 0.5, halfDay: true });
    const bad = await apply(emp, { halfDay: true, start: "2030-04-01", end: "2030-04-02" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toBe("invalid");
  });

  it("rejects start after end, bad dates, bad kind", async () => {
    const emp = await makeUser("employee", OPS);
    expect((await apply(emp, { start: "2030-03-05", end: "2030-03-04" })).status).toBe(400);
    expect((await apply(emp, { start: "2030-02-30", end: "2030-03-04" })).status).toBe(400);
    expect((await apply(emp, { kind: "Bogus" })).status).toBe(400);
  });

  it("rejects ranges that cross a calendar year", async () => {
    const emp = await makeUser("employee", OPS);
    const res = await apply(emp, { start: "2030-12-30", end: "2031-01-02" });
    expect(res.status).toBe(400);
    const b = (await res.json()) as any;
    expect(b.error).toBe("invalid");
    expect(b.message).toBe("Leave can't cross into a new year. Split it into two requests.");
  });

  it("rejects zero working days", async () => {
    const emp = await makeUser("employee", OPS);
    const wk = await apply(emp, { start: "2030-01-05", end: "2030-01-06" });
    expect(wk.status).toBe(400);
    expect(((await wk.json()) as any).message).toBe("Those dates are all weekends or holidays.");
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'holidays'").bind('["2030-03-04"]').run();
    expect((await apply(emp, {})).status).toBe(400);
  });

  it("exceeding Casual balance -> 400 with exact message", async () => {
    const emp = await makeUser("employee", OPS);
    // 2030-03-04..2030-03-15 = 10 weekdays
    expect((await apply(emp, { start: "2030-03-04", end: "2030-03-15" })).status).toBe(201);
    const res = await apply(emp, { start: "2030-03-18", end: "2030-03-20" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "insufficient", message: "Not enough Casual leave left (2 days)." });
  });

  it("Unpaid leave is unlimited", async () => {
    const emp = await makeUser("employee", OPS);
    expect((await apply(emp, { kind: "Unpaid", start: "2030-03-04", end: "2030-05-31" })).status).toBe(201);
  });

  it("balance year is the year of start", async () => {
    const emp = await makeUser("employee", OPS);
    // 2030-03-04..03-12 = 7 weekdays > 6 Sick.
    const over = await apply(emp, { kind: "Sick", start: "2030-03-04", end: "2030-03-12" });
    expect(over.status).toBe(400);
    expect(((await over.json()) as any).message).toBe("Not enough Sick leave left (6 days).");
    expect((await apply(emp, { kind: "Sick", start: "2030-03-04", end: "2030-03-11" })).status).toBe(201);
    // 2030 Sick is now used up, 2031 is a fresh year.
    expect((await apply(emp, { kind: "Sick", start: "2030-06-03", end: "2030-06-03" })).status).toBe(400);
    expect((await apply(emp, { kind: "Sick", start: "2031-03-03", end: "2031-03-10" })).status).toBe(201);
  });

  it("overlap with own Pending or Approved -> 409; Rejected/Cancelled do not block", async () => {
    const emp = await makeUser("employee", OPS);
    const first = (await (await apply(emp, { start: "2030-03-04", end: "2030-03-06" })).json()) as any;
    const clash = await apply(emp, { start: "2030-03-06", end: "2030-03-08" });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as any).error).toBe("overlap");
    expect((await api(emp.cookie, "POST", `/api/leave/${first.request.id}/cancel`, {})).status).toBe(200);
    expect((await apply(emp, { start: "2030-03-06", end: "2030-03-08" })).status).toBe(201);
  });

  it("someone else's overlapping leave does not block", async () => {
    const a = await makeUser("employee", OPS);
    const b = await makeUser("employee", OPS);
    expect((await apply(a, {})).status).toBe(201);
    expect((await apply(b, {})).status).toBe(201);
  });

  it("requires sign-in", async () => {
    expect((await api(null, "POST", "/api/leave", {})).status).toBe(401);
  });
});

describe("GET /api/leave", () => {
  it("mine: own requests + balance counting pending", async () => {
    const emp = await makeUser("employee", OPS);
    const other = await makeUser("employee", OPS);
    const year = new Date().getFullYear();
    const first = new Date(Date.UTC(year, 1, 1));
    const mon = new Date(Date.UTC(year, 1, 1 + ((8 - first.getUTCDay()) % 7)));
    const ymd = mon.toISOString().slice(0, 10);
    expect((await apply(emp, { start: ymd, end: ymd })).status).toBe(201);
    expect((await apply(other, { start: ymd, end: ymd })).status).toBe(201);
    const res = await api(emp.cookie, "GET", "/api/leave");
    const body = (await res.json()) as any;
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({ userId: emp.id, userName: expect.any(String) });
    expect(body.balance.Casual).toEqual({ allowed: 12, used: 1, left: 11 });
    expect(body.balance.Sick).toEqual({ allowed: 6, used: 0, left: 6 });
    expect(body.balance.Earned).toEqual({ allowed: 15, used: 0, left: 15 });
    expect(body.balance.Unpaid).toBeUndefined();
  });

  it("rejected and cancelled requests do not count as used", async () => {
    const hr = await makeUser("hr", "HR");
    const emp = await makeUser("employee", OPS);
    const year = new Date().getFullYear();
    const first = new Date(Date.UTC(year, 1, 1));
    const mon = new Date(Date.UTC(year, 1, 1 + ((8 - first.getUTCDay()) % 7)));
    const ymd = mon.toISOString().slice(0, 10);
    const { request } = (await (await apply(emp, { start: ymd, end: ymd })).json()) as any;
    await api(hr.cookie, "POST", `/api/leave/${request.id}/reject`, {});
    const body = (await (await api(emp.cookie, "GET", "/api/leave?scope=mine")).json()) as any;
    expect(body.balance.Casual.used).toBe(0);
  });

  it("team: manager sees reports only; others 403", async () => {
    const mgr = await makeUser("manager", OPS);
    const mgr2 = await makeUser("manager", OPS);
    const mine = await makeUser("employee", OPS, { managerId: mgr.id });
    const theirs = await makeUser("employee", OPS, { managerId: mgr2.id });
    await apply(mine, {});
    await apply(theirs, {});
    const res = await api(mgr.cookie, "GET", "/api/leave?scope=team");
    expect(res.status).toBe(200);
    const { requests } = (await res.json()) as any;
    expect(requests.map((r: any) => r.userId)).toEqual([mine.id]);
    expect(requests[0].userName).toBeTruthy();
    for (const role of ["employee", "hr", "admin"] as const) {
      const u = await makeUser(role, OPS);
      expect((await api(u.cookie, "GET", "/api/leave?scope=team")).status).toBe(403);
    }
  });

  it("all: hr and admin only", async () => {
    const hr = await makeUser("hr", "HR");
    const admin = await makeUser("admin", OPS);
    const mgr = await makeUser("manager", OPS);
    const emp = await makeUser("employee", OPS);
    await apply(emp, {});
    for (const u of [hr, admin]) {
      const res = await api(u.cookie, "GET", "/api/leave?scope=all");
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).requests).toHaveLength(1);
    }
    for (const u of [mgr, emp]) expect((await api(u.cookie, "GET", "/api/leave?scope=all")).status).toBe(403);
  });

  it("rejects unknown scope", async () => {
    const emp = await makeUser("employee", OPS);
    expect((await api(emp.cookie, "GET", "/api/leave?scope=zzz")).status).toBe(400);
  });
});

describe("decisions", () => {
  const setup = async () => {
    const mgr = await makeUser("manager", OPS);
    const hr = await makeUser("hr", "HR");
    const admin = await makeUser("admin", OPS);
    const emp = await makeUser("employee", OPS, { managerId: mgr.id });
    const { request } = (await (await apply(emp, {})).json()) as any;
    return { mgr, hr, admin, emp, id: request.id as string };
  };

  it("manager approves report's leave; requester notified; audited; approved by recorded", async () => {
    const { mgr, emp, id } = await setup();
    const res = await api(mgr.cookie, "POST", `/api/leave/${id}/approve`, { note: "enjoy" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).request).toMatchObject({ status: "Approved", note: "enjoy", decidedBy: mgr.id });
    expect(await notifs(emp.id)).toEqual([{ kind: "leave_approved", link: "/leave" }]);
    expect(await auditActions()).toContain("leave_approved");
  });

  it("employee cannot approve own; another employee cannot approve", async () => {
    const { emp, id } = await setup();
    expect((await api(emp.cookie, "POST", `/api/leave/${id}/approve`, {})).status).toBe(403);
    const peer = await makeUser("employee", OPS);
    expect((await api(peer.cookie, "POST", `/api/leave/${id}/approve`, {})).status).toBe(403);
  });

  it("a manager who is not the requester's manager cannot approve", async () => {
    const { id } = await setup();
    const other = await makeUser("manager", OPS);
    expect((await api(other.cookie, "POST", `/api/leave/${id}/approve`, {})).status).toBe(403);
  });

  it("hr and admin approve anyone's; reject notifies with leave_rejected", async () => {
    const { hr, admin, emp, id } = await setup();
    expect((await api(hr.cookie, "POST", `/api/leave/${id}/approve`, {})).status).toBe(200);
    const second = (await (await apply(emp, { start: "2030-04-01", end: "2030-04-01" })).json()) as any;
    expect((await api(admin.cookie, "POST", `/api/leave/${second.request.id}/reject`, { note: "no" })).status).toBe(200);
    const kinds = (await notifs(emp.id)).map((n) => n.kind).sort();
    expect(kinds).toEqual(["leave_approved", "leave_rejected"]);
    expect(await auditActions()).toContain("leave_rejected");
  });

  it("hr cannot approve own request", async () => {
    const hr = await makeUser("hr", "HR");
    const { request } = (await (await apply(hr, {})).json()) as any;
    expect((await api(hr.cookie, "POST", `/api/leave/${request.id}/approve`, {})).status).toBe(403);
  });

  it("decisions only on Pending -> 409 not_pending", async () => {
    const { hr, id } = await setup();
    await api(hr.cookie, "POST", `/api/leave/${id}/approve`, {});
    for (const act of ["approve", "reject"]) {
      const res = await api(hr.cookie, "POST", `/api/leave/${id}/${act}`, {});
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).error).toBe("not_pending");
    }
  });

  it("approving does not re-check balance", async () => {
    const { hr, emp } = await setup();
    // Fill Casual exactly, then lower allowance below used and approve.
    const full = (await (await apply(emp, { start: "2030-05-06", end: "2030-05-17" })).json()) as any;
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'leave_allowances'")
      .bind('{"Casual":1,"Sick":6,"Earned":15}')
      .run();
    expect((await api(hr.cookie, "POST", `/api/leave/${full.request.id}/approve`, {})).status).toBe(200);
  });

  it("unknown id -> 404", async () => {
    const hr = await makeUser("hr", "HR");
    expect((await api(hr.cookie, "POST", "/api/leave/nope/approve", {})).status).toBe(404);
  });
});

describe("cancel", () => {
  it("owner cancels Pending; audited", async () => {
    const emp = await makeUser("employee", OPS);
    const { request } = (await (await apply(emp, {})).json()) as any;
    const res = await api(emp.cookie, "POST", `/api/leave/${request.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).request.status).toBe("Cancelled");
    expect(await auditActions()).toContain("leave_cancelled");
  });

  it("non-owner cannot cancel (403), not even admin", async () => {
    const emp = await makeUser("employee", OPS);
    const admin = await makeUser("admin", OPS);
    const { request } = (await (await apply(emp, {})).json()) as any;
    expect((await api(admin.cookie, "POST", `/api/leave/${request.id}/cancel`, {})).status).toBe(403);
  });

  it("cannot cancel a non-Pending request (409)", async () => {
    const hr = await makeUser("hr", "HR");
    const emp = await makeUser("employee", OPS);
    const { request } = (await (await apply(emp, {})).json()) as any;
    await api(hr.cookie, "POST", `/api/leave/${request.id}/approve`, {});
    const res = await api(emp.cookie, "POST", `/api/leave/${request.id}/cancel`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("not_pending");
  });
});
