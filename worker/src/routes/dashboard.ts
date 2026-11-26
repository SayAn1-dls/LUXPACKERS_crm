import { Hono } from "hono";
import { ONBOARDING_STEPS, REGISTERS } from "../../../shared/schema";
import type { AppEnv, SessionUser } from "../env";
import { adminSections, addDays } from "../lib/adminDashboard";
import { todayIST } from "../lib/dates";
import {
  canApproveTask, canReadRegister, canSeeAdminDashboard, canSeePeoplePrivate, canSeeTask, leaveLevel, taskLevel,
} from "../lib/policy";
import { requireUser } from "../lib/session";
import { TASK_SELECT, taskAssigneeOf, taskRefOf, taskScopeWhere, taskToApi } from "../lib/taskScope";
import type { TaskRow, TaskScope } from "../lib/taskScope";
import { leaveBalance } from "./leave";
import { unreadCount } from "./notifications";

export const dashboard = new Hono<AppEnv>();
dashboard.use("*", requireUser);

const taskRows = async (db: D1Database, u: SessionUser, scope: TaskScope, extra: string[] = [], args: unknown[] = []) => {
  const s = taskScopeWhere(u, scope);
  const where = [...s.where, ...extra];
  return (
    await db
      .prepare(`${TASK_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY t.due IS NULL, t.due, t.created_at DESC LIMIT 500`)
      .bind(...s.args, ...args)
      .all<TaskRow>()
  ).results;
};

/** Pending leave I can decide: my team (same department or my reports) or everyone. Never my own. */
async function pendingLeave(db: D1Database, u: SessionUser, teamOnly: boolean) {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.user_id, l.kind, l.start, l."end", l.days, l.half_day, l.reason, l.status, p.name AS user_name
       FROM leave_requests l JOIN users p ON p.id = l.user_id
       WHERE l.status = 'Pending' AND l.user_id != ? ${teamOnly ? "AND (p.dept = ? OR p.manager_id = ?)" : ""} ORDER BY l.start, l.id`,
    )
    .bind(...(teamOnly ? [u.id, u.dept, u.id] : [u.id]))
    .all<any>();
  return results.map((r) => ({
    id: r.id, userId: r.user_id, userName: r.user_name, kind: r.kind, start: r.start, end: r.end, days: r.days,
    halfDay: r.half_day === 1, reason: r.reason, status: r.status,
  }));
}

async function workload(db: D1Database, u: SessionUser) {
  const today = todayIST();
  const everyone = taskLevel(u) === "all";
  const team = everyone ? "" : "AND (p.dept = ? OR p.manager_id = ?)";
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name,
         COALESCE(SUM(t.status != 'Done'), 0) AS open,
         COALESCE(SUM(t.status != 'Done' AND t.due IS NOT NULL AND t.due < ?), 0) AS late,
         COALESCE(SUM(t.status = 'Submitted'), 0) AS submitted
       FROM users p LEFT JOIN tasks t ON t.assignee_id = p.id
       WHERE p.status != 'left' AND p.id != ? ${team} GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
    )
    .bind(today, u.id, ...(everyone ? [] : [u.dept, u.id]))
    .all<{ id: string; name: string; open: number; late: number; submitted: number }>();
  return results.map((r) => ({ userId: r.id, name: r.name, open: r.open, late: r.late, submitted: r.submitted }));
}

async function registerCounts(db: D1Database, u: SessionUser) {
  const out: { id: string; name: string; open: number }[] = [];
  for (const reg of REGISTERS.filter((r) => canReadRegister(u, r.id))) {
    const done = reg.doneValues;
    const status = `COALESCE(json_extract(data, '$.${reg.statusKey}'), '')`;
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM records WHERE collection = ? AND deleted_at IS NULL
         ${done.length ? `AND ${status} NOT IN (${done.map(() => "?").join(",")})` : ""}`,
      )
      .bind(reg.id, ...done)
      .first<{ n: number }>();
    out.push({ id: reg.id, name: reg.name, open: row!.n });
  }
  return out;
}

async function hrSections(db: D1Database, today: string) {
  const { results: joiners } = await db
    .prepare(
      `SELECT p.id, p.name, p.joined_on,
         (SELECT COUNT(*) FROM onboarding o WHERE o.user_id = p.id AND o.done = 1) AS done
       FROM users p WHERE p.status = 'onboarding' ORDER BY p.joined_on IS NULL, p.joined_on, p.name COLLATE NOCASE`,
    )
    .all<{ id: string; name: string; joined_on: string | null; done: number }>();
  const { results: soon } = await db
    .prepare(
      `SELECT id, name, joined_on FROM users WHERE status != 'left' AND joined_on >= ? AND joined_on <= ? ORDER BY joined_on, name COLLATE NOCASE`,
    )
    .bind(today, addDays(today, 30))
    .all<{ id: string; name: string; joined_on: string }>();
  return {
    onboarding: joiners.map((j) => ({ userId: j.id, name: j.name, done: j.done, total: ONBOARDING_STEPS.length, joinedOn: j.joined_on })),
    joiningSoon: soon.map((j) => ({ userId: j.id, name: j.name, joinedOn: j.joined_on })),
  };
}

dashboard.get("/", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const today = todayIST();
  const weekEnd = addDays(today, 7);
  const api = (rows: TaskRow[]) => rows.map((r) => taskToApi(r, today));

  const mine = await taskRows(db, u, "mine", ["t.status != 'Done'"]);
  const sentBack = await taskRows(db, u, "mine", [
    "t.status != 'Done'",
    "(SELECT k.kind FROM task_comments k WHERE k.task_id = t.id ORDER BY k.created_at DESC, k.rowid DESC LIMIT 1) = 'sent_back'",
  ]);
  const submitted = await taskRows(db, u, "mine", ["t.status = 'Submitted'"]);
  // Anyone's task waiting on my name, but only if I could open it anyway.
  const waiting = (
    await taskRows(db, u, "all", ["t.status = 'Waiting'", "t.waiting_on IS NOT NULL", "lower(trim(t.waiting_on)) = lower(trim(?))"], [u.name])
  ).filter((r) => canSeeTask(u, taskRefOf(r), taskAssigneeOf(r)));

  const body: Record<string, unknown> = {
    overdue: api(mine.filter((t) => t.due && t.due < today)),
    today: api(mine.filter((t) => t.due === today)),
    week: api(mine.filter((t) => t.due && t.due > today && t.due <= weekEnd)),
    sentBack: api(sentBack),
    waitingOnMe: api(waiting),
    submitted: api(submitted),
    leaveBalance: await leaveBalance(db, u.id),
    unread: await unreadCount(db, u.id),
  };

  // Sections follow the caller's position: tasks team/all -> review queue and workload; leave team/all -> pending
  // leave; any readable register -> register counts; people full -> onboarding; admin -> admin sections.
  if (taskLevel(u) !== "own") {
    const queue = (await taskRows(db, u, "visible", ["t.status = 'Submitted'"])).filter((r) => canApproveTask(u, taskRefOf(r), taskAssigneeOf(r)));
    body.reviewQueue = api(queue);
    body.workload = await workload(db, u);
  }
  if (leaveLevel(u) !== "own") body.pendingLeave = await pendingLeave(db, u, leaveLevel(u) === "team");
  if (REGISTERS.some((r) => canReadRegister(u, r.id))) body.registers = await registerCounts(db, u);
  if (canSeePeoplePrivate(u)) Object.assign(body, await hrSections(db, today));
  if (canSeeAdminDashboard(u)) Object.assign(body, await adminSections(db, today));
  return c.json(body);
});
