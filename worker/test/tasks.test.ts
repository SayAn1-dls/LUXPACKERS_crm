import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { todayIST } from "../src/lib/dates";
import { api, applyMigrations, makeUser } from "./helpers";

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  for (const t of ["audit_log", "notifications", "task_comments", "tasks", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

type U = Awaited<ReturnType<typeof makeUser>>;
const OPS = "Operations";
const FIN = "Finance";

async function mkTask(u: U, over: Record<string, unknown> = {}, expectStatus = 201) {
  const res = await api(u.cookie, "POST", "/api/tasks", { title: "Book hotel", dept: OPS, priority: "Medium", ...over });
  expect(res.status).toBe(expectStatus);
  return (await res.json()) as any;
}
const notifs = async (userId: string) =>
  (await env.DB.prepare("SELECT kind, link FROM notifications WHERE user_id = ?").bind(userId).all<{ kind: string; link: string }>()).results;
const auditActions = async () =>
  (await env.DB.prepare("SELECT action FROM audit_log").all<{ action: string }>()).results.map((r) => r.action);

describe("todayIST", () => {
  it("uses Asia/Kolkata, not UTC", () => {
    expect(todayIST(new Date("2026-03-01T19:00:00Z"))).toBe("2026-03-02"); // 00:30 IST next day
    expect(todayIST(new Date("2026-03-01T18:29:00Z"))).toBe("2026-03-01");
  });
});

describe("visibility and listing", () => {
  it("employee sees only own and assigned-by-me tasks", async () => {
    const mgr = await makeUser("manager", OPS);
    const e1 = await makeUser("employee", OPS, { managerId: mgr.id });
    const e2 = await makeUser("employee", OPS, { managerId: mgr.id });
    const mine = (await mkTask(e1)).task;
    const given = (await mkTask(e1, { assigneeId: e1.id })).task; // self
    const byMgr = (await mkTask(mgr, { assigneeId: e1.id })).task;
    const other = (await mkTask(e2)).task;
    const toE2 = (await mkTask(e1, { assigneeId: e2.id }, 403));
    expect(toE2.error).toBe("forbidden");
    const res = await api(e1.cookie, "GET", "/api/tasks");
    const ids = ((await res.json()) as any).tasks.map((t: any) => t.id);
    expect(ids.sort()).toEqual([mine.id, given.id, byMgr.id].sort());
    expect(ids).not.toContain(other.id);
    expect((await api(e1.cookie, "GET", `/api/tasks/${other.id}`)).status).toBe(404);
    expect((await api(e1.cookie, "GET", `/api/tasks/${byMgr.id}`)).status).toBe(200);
  });

  it("scope=assigned lists what I assigned; scope=mine what is on me", async () => {
    const mgr = await makeUser("manager", OPS);
    const e1 = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e1.id })).task;
    const a = ((await (await api(mgr.cookie, "GET", "/api/tasks?scope=assigned")).json()) as any).tasks;
    const m = ((await (await api(mgr.cookie, "GET", "/api/tasks?scope=mine")).json()) as any).tasks;
    expect(a.map((x: any) => x.id)).toEqual([t.id]);
    expect(a[0].assigneeName).toContain("employee");
    expect(a[0].assignedByName).toContain("manager");
    expect(m).toEqual([]);
  });

  it("scope=all is admin only; scope=team is manager/admin only", async () => {
    const admin = await makeUser("admin", "Management");
    const mgr = await makeUser("manager", OPS);
    const emp = await makeUser("employee", OPS);
    expect((await api(emp.cookie, "GET", "/api/tasks?scope=all")).status).toBe(403);
    expect((await api(mgr.cookie, "GET", "/api/tasks?scope=all")).status).toBe(403);
    expect((await api(admin.cookie, "GET", "/api/tasks?scope=all")).status).toBe(200);
    expect((await api(emp.cookie, "GET", "/api/tasks?scope=team")).status).toBe(403);
    expect((await api(mgr.cookie, "GET", "/api/tasks?scope=team")).status).toBe(200);
    expect((await api(admin.cookie, "GET", "/api/tasks?scope=team")).status).toBe(200);
    expect((await api(emp.cookie, "GET", "/api/tasks?scope=bogus")).status).toBe(400);
  });

  it("manager team scope = dept tasks plus tasks of direct reports in other depts", async () => {
    const mgr = await makeUser("manager", OPS);
    const rep = await makeUser("employee", FIN, { managerId: mgr.id });
    const opsEmp = await makeUser("employee", OPS);
    const finEmp = await makeUser("employee", FIN);
    const finMgr = await makeUser("manager", FIN);
    const tOps = (await mkTask(opsEmp, { dept: OPS })).task;
    const tRep = (await mkTask(rep, { dept: FIN })).task;
    const tFin = (await mkTask(finEmp, { dept: FIN })).task;
    const ids = ((await (await api(mgr.cookie, "GET", "/api/tasks?scope=team")).json()) as any).tasks.map((t: any) => t.id);
    expect(ids.sort()).toEqual([tOps.id, tRep.id].sort());
    expect(ids).not.toContain(tFin.id);
    expect((await api(mgr.cookie, "GET", `/api/tasks/${tRep.id}`)).status).toBe(200);
    expect((await api(mgr.cookie, "GET", `/api/tasks/${tFin.id}`)).status).toBe(404);
    expect((await api(finMgr.cookie, "GET", `/api/tasks/${tRep.id}`)).status).toBe(200);
  });

  it("filters by status, dept and q (q is literal, not a wildcard)", async () => {
    const e = await makeUser("employee", OPS);
    await mkTask(e, { title: "Pay 100% advance", dept: OPS });
    await mkTask(e, { title: "Plain task", dept: OPS });
    const q = async (s: string) => ((await (await api(e.cookie, "GET", `/api/tasks?${s}`)).json()) as any).tasks;
    expect((await q("q=100%25")).length).toBe(1);
    expect((await q("q=%25")).length).toBe(1);
    expect((await q("status=To%20do")).length).toBe(2);
    expect((await q("status=Done")).length).toBe(0);
    expect((await q("dept=Finance")).length).toBe(0);
    expect((await api(e.cookie, "GET", "/api/tasks?status=Nope")).status).toBe(400);
  });
});

describe("create", () => {
  it("manager assigns to dept member ok, to other dept non-report 403", async () => {
    const mgr = await makeUser("manager", OPS);
    const mine = await makeUser("employee", OPS);
    const rep = await makeUser("employee", FIN, { managerId: mgr.id });
    const stranger = await makeUser("employee", FIN);
    const ok = await mkTask(mgr, { assigneeId: mine.id });
    expect(ok.task.assigneeId).toBe(mine.id);
    expect(ok.task.assignedById).toBe(mgr.id);
    expect((await notifs(mine.id)).map((n) => n.kind)).toEqual(["assigned"]);
    expect((await notifs(mine.id))[0].link).toBe(`/tasks?open=${ok.task.id}`);
    await mkTask(mgr, { assigneeId: rep.id });
    expect((await mkTask(mgr, { assigneeId: stranger.id }, 403)).error).toBe("forbidden");
    expect(await auditActions()).toContain("task_created");
  });

  it("defaults assignee to self, dept to assignee's dept; assigned_by comes from session not body", async () => {
    const e = await makeUser("employee", FIN);
    const other = await makeUser("employee", OPS);
    const r = await api(e.cookie, "POST", "/api/tasks", {
      title: "T", priority: "Low", assignedById: other.id, version: 9, status: "Done",
    });
    expect(r.status).toBe(201);
    const t = ((await r.json()) as any).task;
    expect(t.assigneeId).toBe(e.id);
    expect(t.assignedById).toBe(e.id);
    expect(t.dept).toBe(FIN);
    expect(t.status).toBe("To do");
    expect(t.version).toBe(1);
    expect((await notifs(e.id)).length).toBe(0);
  });

  it("validates dept, priority, assignee existence and not-left", async () => {
    const mgr = await makeUser("manager", OPS);
    const gone = await makeUser("employee", OPS, { status: "left" });
    expect((await mkTask(mgr, { dept: "Nowhere" }, 400)).error).toBe("invalid");
    expect((await mkTask(mgr, { priority: "Urgent" }, 400)).error).toBe("invalid");
    expect((await mkTask(mgr, { title: "  " }, 400)).error).toBe("invalid");
    expect((await mkTask(mgr, { assigneeId: "nope" }, 400)).error).toBe("invalid_assignee");
    expect((await mkTask(mgr, { assigneeId: gone.id }, 400)).error).toBe("invalid_assignee");
  });
});

describe("status changes", () => {
  it("self-created task can go to Done directly", async () => {
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(e)).task;
    const r = await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, status: "Done" });
    expect(r.status).toBe(200);
    const done = ((await r.json()) as any).task;
    expect(done.status).toBe("Done");
    expect(done.completedAt).toBeTruthy();
    expect(done.version).toBe(2);
    // self task may be reopened
    const re = await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 2, status: "In progress" });
    expect(re.status).toBe(200);
    expect(((await re.json()) as any).task.completedAt).toBeNull();
  });

  it("assigned task: assignee PATCH status Done -> 403, submit -> Submitted", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS, { managerId: mgr.id });
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, status: "Done" })).status).toBe(403);
    const ip = await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, status: "In progress" });
    expect(ip.status).toBe(200);
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 2, status: "Submitted" })).status).toBe(400);
    const s = await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, { version: 2 });
    expect(s.status).toBe(200);
    expect(((await s.json()) as any).task.status).toBe("Submitted");
    expect((await notifs(mgr.id)).map((n) => n.kind)).toContain("submitted");
    expect((await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {})).status).toBe(409);
    expect(await auditActions()).toContain("task_submitted");
  });

  it("only the assignee can submit; submit on self-assigned task -> 400 self_task", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    expect((await api(mgr.cookie, "POST", `/api/tasks/${t.id}/submit`, {})).status).toBe(403);
    const self = (await mkTask(e)).task;
    const r = await api(e.cookie, "POST", `/api/tasks/${self.id}/submit`, {});
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBe("self_task");
  });

  it("assignee cannot reopen a Done task assigned by someone else; approver can", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    await api(mgr.cookie, "POST", `/api/tasks/${t.id}/approve`, {});
    const cur = ((await (await api(e.cookie, "GET", `/api/tasks/${t.id}`)).json()) as any).task;
    expect(cur.status).toBe("Done");
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: cur.version, status: "In progress" })).status).toBe(403);
    const r = await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: cur.version, status: "In progress" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).task.completedAt).toBeNull();
  });
});

describe("review loop", () => {
  it("assignee-manager cannot approve own task (403)", async () => {
    const admin = await makeUser("admin", "Management");
    const mgr = await makeUser("manager", OPS);
    const t = (await mkTask(admin, { assigneeId: mgr.id })).task;
    expect((await api(mgr.cookie, "POST", `/api/tasks/${t.id}/submit`, {})).status).toBe(200);
    expect((await api(mgr.cookie, "POST", `/api/tasks/${t.id}/approve`, {})).status).toBe(403);
    expect((await api(mgr.cookie, "POST", `/api/tasks/${t.id}/send-back`, { comment: "x" })).status).toBe(403);
    expect((await api(admin.cookie, "POST", `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
  });

  it("approve sets completed_at and notifies assignee", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    const r = await api(mgr.cookie, "POST", `/api/tasks/${t.id}/approve`, { comment: "Nice work" });
    expect(r.status).toBe(200);
    const done = ((await r.json()) as any).task;
    expect(done.status).toBe("Done");
    expect(done.completedAt).toBeTruthy();
    expect((await notifs(e.id)).map((n) => n.kind)).toContain("approved");
    const comments = ((await (await api(e.cookie, "GET", `/api/tasks/${t.id}/comments`)).json()) as any).comments;
    expect(comments.map((c: any) => [c.kind, c.body])).toEqual([["approved", "Nice work"]]);
    expect(await auditActions()).toContain("task_approved");
  });

  it("send-back without comment -> 400; with comment -> To do, comment stored, assignee notified", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    expect((await api(mgr.cookie, "POST", `/api/tasks/${t.id}/send-back`, {})).status).toBe(400);
    expect((await api(mgr.cookie, "POST", `/api/tasks/${t.id}/send-back`, { comment: "   " })).status).toBe(400);
    const r = await api(mgr.cookie, "POST", `/api/tasks/${t.id}/send-back`, { comment: "Add the voucher" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).task.status).toBe("To do");
    expect((await notifs(e.id)).map((n) => n.kind)).toContain("sent_back");
    const comments = ((await (await api(e.cookie, "GET", `/api/tasks/${t.id}/comments`)).json()) as any).comments;
    expect(comments[0].kind).toBe("sent_back");
    expect(comments[0].body).toBe("Add the voucher");
  });

  it("approve and send-back require status Submitted -> 409 not_submitted", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    for (const [p, b] of [["approve", {}], ["send-back", { comment: "no" }]] as const) {
      const r = await api(mgr.cookie, "POST", `/api/tasks/${t.id}/${p}`, b);
      expect(r.status).toBe(409);
      expect(((await r.json()) as any).error).toBe("not_submitted");
    }
  });

  it("approve/send-back with a stale version -> 409 conflict", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    const r = await api(mgr.cookie, "POST", `/api/tasks/${t.id}/approve`, { version: 1 });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error).toBe("conflict");
  });

  it("people who cannot approve get 403, people who cannot see get 404", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const peer = await makeUser("employee", OPS);
    const finMgr = await makeUser("manager", FIN);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    expect((await api(e.cookie, "POST", `/api/tasks/${t.id}/approve`, {})).status).toBe(403);
    expect((await api(peer.cookie, "POST", `/api/tasks/${t.id}/approve`, {})).status).toBe(404);
    expect((await api(finMgr.cookie, "POST", `/api/tasks/${t.id}/approve`, {})).status).toBe(404);
  });
});

describe("PATCH fields", () => {
  it("PATCH with stale version -> 409", async () => {
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(e)).task;
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, title: "A" })).status).toBe(200);
    const r = await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, title: "B" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error).toBe("conflict");
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { title: "C" })).status).toBe(400);
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 2 })).status).toBe(200); // no-op
  });

  it("assignee of someone else's task cannot edit its fields; assigner can", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, title: "Mine now" })).status).toBe(403);
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, waitingOn: "Hotel" })).status).toBe(200);
    const r = await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 2, title: "Retitled", due: "2030-01-01", links: ["https://a.example"] });
    expect(r.status).toBe(200);
    const u = ((await r.json()) as any).task;
    expect([u.title, u.due, u.links, u.version]).toEqual(["Retitled", "2030-01-01", ["https://a.example"], 3]);
    expect(await auditActions()).toContain("task_updated");
  });

  it("reassign: needs assigner/approver and canAssignTo; new assignee must be active; notified", async () => {
    const mgr = await makeUser("manager", OPS);
    const mgr2 = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const e2 = await makeUser("employee", OPS);
    const fin = await makeUser("employee", FIN);
    const gone = await makeUser("employee", OPS, { status: "left" });
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    // assignee cannot reassign
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, assigneeId: e2.id })).status).toBe(403);
    // target outside caller's reach
    expect((await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, assigneeId: fin.id })).status).toBe(403);
    expect((await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, assigneeId: gone.id })).status).toBe(400);
    expect((await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, assigneeId: "nope" })).status).toBe(400);
    // another dept manager (an approver) can reassign
    const r = await api(mgr2.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, assigneeId: e2.id });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).task.assigneeId).toBe(e2.id);
    expect((await notifs(e2.id)).map((n) => n.kind)).toEqual(["assigned"]);
    // the previous assignee can no longer see it
    expect((await api(e.cookie, "GET", `/api/tasks/${t.id}`)).status).toBe(404);
  });

  it("rejects invalid dept on patch", async () => {
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(e)).task;
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, dept: "Nowhere" })).status).toBe(400);
  });

  it("invisible task PATCH -> 404", async () => {
    const e = await makeUser("employee", OPS);
    const o = await makeUser("employee", OPS);
    const t = (await mkTask(o)).task;
    expect((await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, title: "x" })).status).toBe(404);
  });
});

describe("late flag", () => {
  it("late flag true when due < todayIST and not Done", async () => {
    const e = await makeUser("employee", OPS);
    const past = (await mkTask(e, { due: "2000-01-01" })).task;
    const future = (await mkTask(e, { due: "2999-01-01" })).task;
    const today = (await mkTask(e, { due: todayIST() })).task;
    const none = (await mkTask(e)).task;
    expect([past.late, future.late, today.late, none.late]).toEqual([true, false, false, false]);
    const list = ((await (await api(e.cookie, "GET", "/api/tasks")).json()) as any).tasks;
    expect(list.find((t: any) => t.id === past.id).late).toBe(true);
    const r = await api(e.cookie, "PATCH", `/api/tasks/${past.id}`, { version: 1, status: "Done" });
    expect(((await r.json()) as any).task.late).toBe(false);
  });
});

describe("comments", () => {
  it("comment notifies assignee and assigner except the commenter; stranger gets 404", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const stranger = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await env.DB.prepare("DELETE FROM notifications").run();
    const r = await api(e.cookie, "POST", `/api/tasks/${t.id}/comments`, { body: "  On it  " });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).comment.body).toBe("On it");
    expect((await notifs(mgr.id)).map((n) => n.kind)).toEqual(["commented"]);
    expect((await notifs(e.id)).length).toBe(0);
    expect((await api(e.cookie, "POST", `/api/tasks/${t.id}/comments`, { body: "" })).status).toBe(400);
    expect((await api(stranger.cookie, "POST", `/api/tasks/${t.id}/comments`, { body: "hi" })).status).toBe(404);
    expect((await api(stranger.cookie, "GET", `/api/tasks/${t.id}/comments`)).status).toBe(404);
    const list = ((await (await api(mgr.cookie, "GET", `/api/tasks/${t.id}/comments`)).json()) as any).comments;
    expect(list.length).toBe(1);
    expect(list[0].userName).toContain("employee");
    expect(await auditActions()).toContain("task_commented");
  });
});

describe("review loop cannot be bypassed via PATCH", () => {
  it("PATCH on a Submitted task to Done / To do -> 400 use_approve / use_send_back", async () => {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    const d = await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 2, status: "Done" });
    expect(d.status).toBe(400);
    expect(((await d.json()) as any).error).toBe("use_approve");
    const b = await api(mgr.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 2, status: "To do" });
    expect(b.status).toBe(400);
    expect(((await b.json()) as any).error).toBe("use_send_back");
    const cur = ((await (await api(mgr.cookie, "GET", `/api/tasks/${t.id}`)).json()) as any).task;
    expect([cur.status, cur.version]).toEqual(["Submitted", 2]);
  });
});

describe("task links are http(s) only", () => {
  it("rejects javascript: and data: links on create and patch", async () => {
    const e = await makeUser("employee", OPS);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "not a url"]) {
      const r = await api(e.cookie, "POST", "/api/tasks", { title: "T", dept: OPS, priority: "Low", links: [bad] });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid", field: "links" });
    }
    const t = (await mkTask(e)).task;
    const r = await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, links: ["https://ok.example", "javascript:alert(1)"] });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid", field: "links" });
  });

  it("accepts http and https links", async () => {
    const e = await makeUser("employee", OPS);
    const t = (await mkTask(e, { links: ["http://a.example/x", "https://b.example/y?z=1"] })).task;
    expect(t.links).toEqual(["http://a.example/x", "https://b.example/y?z=1"]);
    const r = await api(e.cookie, "PATCH", `/api/tasks/${t.id}`, { version: 1, links: ["https://c.example"] });
    expect(r.status).toBe(200);
  });
});

describe("every review-loop bypass from Submitted is blocked", () => {
  async function submitted() {
    const mgr = await makeUser("manager", OPS);
    const e = await makeUser("employee", OPS);
    const peer = await makeUser("employee", OPS);
    const t = (await mkTask(mgr, { assigneeId: e.id })).task;
    await api(e.cookie, "POST", `/api/tasks/${t.id}/submit`, {});
    return { mgr, e, peer, t };
  }
  const patch = (u: U, id: string, status: string) => api(u.cookie, "PATCH", `/api/tasks/${id}`, { version: 2, status });

  it("approver: In progress / Waiting / Blocked -> 400 use_send_back", async () => {
    const { mgr, t } = await submitted();
    for (const st of ["In progress", "Waiting", "Blocked"]) {
      const r = await patch(mgr, t.id, st);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).error).toBe("use_send_back");
    }
  });

  it("assignee may withdraw Submitted -> In progress, nothing else", async () => {
    const { e, t } = await submitted();
    for (const st of ["To do", "Waiting", "Blocked", "Done"]) {
      const r = await patch(e, t.id, st);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).error).toBe("use_send_back");
    }
    const ok = await patch(e, t.id, "In progress");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).task.status).toBe("In progress");
  });

  it("non-approver non-assignee still gets 403 (or 404 if they cannot see it)", async () => {
    const { peer, t } = await submitted();
    expect((await patch(peer, t.id, "In progress")).status).toBe(404);
  });
});
