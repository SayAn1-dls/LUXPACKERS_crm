/* Admin-only dashboard sections (ported from the legacy overviewPage): figures, attention, next7, departments, latest.
   Everything is computed with SQL aggregates / bounded queries so one request stays cheap. */
import { DEPARTMENTS, REGISTERS } from "../../../shared/schema";
import type { RegisterDef } from "../../../shared/schema";
import { auditFeed } from "./auditFeed";
import { TASK_SELECT } from "./taskScope";
import type { TaskRow } from "./taskScope";

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const reg = (id: string) => REGISTERS.find((r) => r.id === id)!;
// Keys below come from the shared schema constants only, never from user input.
const field = (key: string) => `json_extract(r.data, '$.${key}')`;
const openSql = (def: RegisterDef) =>
  def.doneValues.length ? `COALESCE(${field(def.statusKey)}, '') NOT IN (${def.doneValues.map(() => "?").join(",")})` : "1 = 1";

interface RecRow { id: string; title: string | null; dept: string | null; owner_name: string | null; due: string | null; stage?: string }

const LIMIT = 9;

/** Open tasks with no assignee, and live records with no owner in each register (the admin's "Needs an owner" list). */
async function needsOwner(db: D1Database) {
  const [tasks, recs] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id IS NULL AND status != 'Done'").first<{ n: number }>(),
    db
      .prepare("SELECT collection, COUNT(*) AS n FROM records WHERE owner_id IS NULL AND deleted_at IS NULL GROUP BY collection")
      .all<{ collection: string; n: number }>(),
  ]);
  const byCollection = new Map(recs.results.map((r) => [r.collection, r.n]));
  return {
    tasks: tasks!.n,
    records: REGISTERS.map((r) => ({ id: r.id, name: r.name, count: byCollection.get(r.id) ?? 0 })),
  };
}

export async function adminSections(db: D1Database, today: string) {
  const month = today.slice(0, 7);
  const end = addDays(today, 7);
  const leads = reg("leads");
  const leadOpen = openSql(leads);
  const leadArgs = [...leads.doneValues];
  const leadBase = `FROM records r WHERE r.collection = 'leads' AND r.deleted_at IS NULL AND ${leadOpen}`;
  const lateLeadWhere = `${field("followUp")} IS NOT NULL AND ${field("followUp")} < ?`;

  const [t, l, lateLeads, fin, trips] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS open, COALESCE(SUM(due IS NOT NULL AND due < ?), 0) AS late, COALESCE(SUM(status = 'Waiting'), 0) AS waiting
         FROM tasks WHERE status != 'Done'`,
      )
      .bind(today)
      .first<{ open: number; late: number; waiting: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CAST(${field("quote")} AS REAL)), 0) AS quoted ${leadBase}`)
      .bind(...leadArgs)
      .first<{ n: number; quoted: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n ${leadBase} AND ${lateLeadWhere}`)
      .bind(...leadArgs, today)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(CAST(${field("amount")} AS REAL)), 0) AS total FROM records r
         WHERE r.collection = 'finance' AND r.deleted_at IS NULL AND ${field("flow")} = 'In' AND ${field("status")} = 'Paid'
         AND ${field("date")} LIKE ?`,
      )
      .bind(`${month}%`)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(${field("status")} = 'Live'), 0) AS live FROM records r
         WHERE r.collection = 'trips' AND r.deleted_at IS NULL`,
      )
      .first<{ total: number; live: number }>(),
  ]);

  // Legacy "Overdue" figure is tasks and lead follow-ups together.
  const figures = {
    openTasks: t!.open,
    late: t!.late + lateLeads!.n,
    waiting: t!.waiting,
    openEnquiries: l!.n,
    quoted: l!.quoted,
    receivedThisMonth: fin!.total,
    tripsLive: trips!.live,
    tripsTotal: trips!.total,
  };

  const tasks = (where: string, args: unknown[], order = "t.due, t.created_at") =>
    db
      .prepare(`${TASK_SELECT} WHERE t.status != 'Done' AND ${where} ORDER BY ${order} LIMIT ${LIMIT}`)
      .bind(...args)
      .all<TaskRow>()
      .then((r) => r.results);
  const [lateTasks, blocked, lateLeadRows, high] = await Promise.all([
    tasks("t.due IS NOT NULL AND t.due < ?", [today]),
    tasks("t.status = 'Blocked' AND (t.due IS NULL OR t.due >= ?)", [today], "t.created_at"),
    db
      .prepare(
        `SELECT r.id, r.title, r.dept, o.name AS owner_name, ${field("followUp")} AS due ${leadBase.replace("FROM records r", "FROM records r LEFT JOIN users o ON o.id = r.owner_id")}
         AND ${lateLeadWhere} ORDER BY due LIMIT ${LIMIT}`,
      )
      .bind(...leadArgs, today)
      .all<RecRow>()
      .then((r) => r.results),
    tasks("t.priority = 'High' AND t.status != 'Blocked' AND (t.due IS NULL OR t.due >= ?)", [today], "t.due IS NULL, t.due, t.created_at"),
  ]);
  const taskItem = (x: TaskRow, why: string) => ({
    kind: "task" as const, id: x.id, title: x.title, why, owner: x.assignee_name, dept: x.dept, link: `/tasks?open=${x.id}`,
  });
  const attention = [
    ...lateTasks.map((x) => taskItem(x, `Overdue since ${x.due}`)),
    ...blocked.map((x) => taskItem(x, "Blocked")),
    ...lateLeadRows.map((x) => ({
      kind: "record" as const, id: x.id, title: x.title ?? "", why: `Follow-up was due ${x.due}`, owner: x.owner_name, dept: x.dept,
      link: `/registers/leads?open=${x.id}`,
    })),
    ...high.map((x) => taskItem(x, `High priority · due ${x.due ?? "not set"}`)),
  ].slice(0, LIMIT);

  const next7: { kind: "task" | "record"; id: string; title: string; label: string; due: string; link: string }[] = (
    await db
      .prepare(`${TASK_SELECT} WHERE t.status != 'Done' AND t.due >= ? AND t.due <= ? ORDER BY t.due, t.created_at LIMIT 20`)
      .bind(today, end)
      .all<TaskRow>()
  ).results.map((x) => ({ kind: "task" as const, id: x.id, title: x.title, label: "Task", due: x.due!, link: `/tasks?open=${x.id}` }));
  const regRows = await Promise.all(
    REGISTERS.filter((r) => r.dueKey).map(async (def) => {
      // Bookings stay on the list until cancelled (even when fully paid): the trip still has to happen.
      const open = def.id === "bookings" ? `COALESCE(${field(def.statusKey)}, '') != 'Cancelled'` : openSql(def);
      const args = def.id === "bookings" ? [] : def.doneValues;
      const { results } = await db
        .prepare(
          `SELECT r.id, r.title, ${field(def.dueKey!)} AS due FROM records r
           WHERE r.collection = ? AND r.deleted_at IS NULL AND ${field(def.dueKey!)} BETWEEN ? AND ? AND ${open}
           ORDER BY due LIMIT 20`,
        )
        .bind(def.id, today, end, ...args)
        .all<RecRow>();
      return results.map((r) => ({ kind: "record" as const, id: r.id, title: r.title ?? "", label: def.name, due: r.due!, link: `/registers/${def.id}?open=${r.id}` }));
    }),
  );
  next7.push(...regRows.flat());
  next7.sort((a, b) => a.due.localeCompare(b.due));

  const { results: dept } = await db
    .prepare(
      `SELECT dept, COUNT(*) AS total, SUM(status = 'Done') AS done,
              SUM(status != 'Done') AS open, SUM(status != 'Done' AND due IS NOT NULL AND due < ?) AS late
       FROM tasks GROUP BY dept`,
    )
    .bind(today)
    .all<{ dept: string | null; total: number; done: number; open: number; late: number }>();
  const byDept = new Map(dept.map((d) => [d.dept, d]));
  const departments = DEPARTMENTS.map((d) => {
    const s = byDept.get(d.name);
    return { name: d.name, open: s?.open ?? 0, late: s?.late ?? 0, done: s?.done ?? 0, total: s?.total ?? 0 };
  });

  return { figures, attention, next7, departments, needsOwner: await needsOwner(db), latest: await auditFeed(db, 7) };
}
