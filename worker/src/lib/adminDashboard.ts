/* Admin-only dashboard sections (ported from the legacy overviewPage): figures, attention, next7, departments, latest. */
import { DEPARTMENTS, REGISTERS } from "../../../shared/schema";
import { auditFeed } from "./auditFeed";
import { TASK_SELECT } from "./taskScope";
import type { TaskRow } from "./taskScope";

type Data = Record<string, any>;
interface RecRow { id: string; title: string | null; dept: string | null; owner_name: string | null; data: string }

const parse = (s: string): Data => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const records = async (db: D1Database, collection: string) =>
  (
    await db
      .prepare(
        `SELECT r.id, r.title, r.dept, o.name AS owner_name, r.data FROM records r LEFT JOIN users o ON o.id = r.owner_id
         WHERE r.collection = ? AND r.deleted_at IS NULL ORDER BY r.created_at, r.rowid`,
      )
      .bind(collection)
      .all<RecRow>()
  ).results.map((r) => ({ ...r, d: parse(r.data) }));

export async function adminSections(db: D1Database, today: string) {
  const month = today.slice(0, 7);
  const end = addDays(today, 7);
  const open = (
    await db.prepare(`${TASK_SELECT} WHERE t.status != 'Done' ORDER BY t.due IS NULL, t.due, t.created_at`).all<TaskRow>()
  ).results;
  const late = (t: TaskRow) => !!t.due && t.due < today;

  const [leads, finance, trips] = await Promise.all([records(db, "leads"), records(db, "finance"), records(db, "trips")]);
  const leadsDone = new Set(REGISTERS.find((r) => r.id === "leads")!.doneValues);
  const openLeads = leads.filter((l) => !leadsDone.has(l.d.stage));
  const lateLeads = openLeads.filter((l) => l.d.followUp && l.d.followUp < today);

  const figures = {
    openTasks: open.length,
    late: open.filter(late).length,
    waiting: open.filter((t) => t.status === "Waiting").length,
    openEnquiries: openLeads.length,
    quoted: openLeads.reduce((s, l) => s + (Number(l.d.quote) || 0), 0),
    receivedThisMonth: finance
      .filter((f) => f.d.flow === "In" && f.d.status === "Paid" && typeof f.d.date === "string" && f.d.date.startsWith(month))
      .reduce((s, f) => s + (Number(f.d.amount) || 0), 0),
    tripsLive: trips.filter((t) => t.d.status === "Live").length,
    tripsTotal: trips.length,
  };

  const taskItem = (t: TaskRow, why: string) => ({
    kind: "task" as const, id: t.id, title: t.title, why, owner: t.assignee_name, dept: t.dept, link: `/tasks?open=${t.id}`,
  });
  const attention = [
    ...open.filter(late).map((t) => taskItem(t, `Overdue since ${t.due}`)),
    ...open.filter((t) => t.status === "Blocked" && !late(t)).map((t) => taskItem(t, "Blocked")),
    ...lateLeads.map((l) => ({
      kind: "record" as const, id: l.id, title: l.title ?? "", why: `Follow-up was due ${l.d.followUp}`, owner: l.owner_name,
      dept: l.dept, link: `/registers/leads?open=${l.id}`,
    })),
    ...open.filter((t) => t.priority === "High" && !late(t) && t.status !== "Blocked").map((t) => taskItem(t, `High priority · due ${t.due ?? "not set"}`)),
  ].slice(0, 9);

  const next7: { kind: "task" | "record"; id: string; title: string; label: string; due: string; link: string }[] = open
    .filter((t) => t.due && t.due >= today && t.due <= end)
    .map((t) => ({ kind: "task" as const, id: t.id, title: t.title, label: "Task", due: t.due!, link: `/tasks?open=${t.id}` }));
  for (const reg of REGISTERS.filter((r) => r.dueKey)) {
    const rows = reg.id === "leads" ? leads : reg.id === "finance" ? finance : await records(db, reg.id);
    for (const r of rows) {
      const due = r.d[reg.dueKey!];
      const isOpen = reg.doneValues.length === 0 || !reg.doneValues.includes(r.d[reg.statusKey]);
      if (typeof due === "string" && due >= today && due <= end && isOpen) {
        next7.push({ kind: "record", id: r.id, title: r.title ?? "", label: reg.name, due, link: `/registers/${reg.id}?open=${r.id}` });
      }
    }
  }
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

  return { figures, attention, next7, departments, latest: await auditFeed(db, 7) };
}
