import { Hono } from "hono";
import { REGISTERS } from "../../../shared/schema";
import type { AppEnv } from "../env";
import { canReadRegister, canSeePeoplePrivate } from "../lib/policy";
import { requireUser } from "../lib/session";
import { TASK_SELECT, taskScopeWhere } from "../lib/taskScope";

const MAX = 12;
interface Hit { kind: "task" | "record" | "person"; id: string; title: string; sub: string; link: string }

export const search = new Hono<AppEnv>();
search.use("*", requireUser);

search.get("/", async (c) => {
  const u = c.var.user!;
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ error: "invalid", message: "Type at least two letters." }, 400);
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const hits: Hit[] = [];

  const scope = taskScopeWhere(u, "visible");
  const tasks = await db
    .prepare(`${TASK_SELECT} WHERE ${[...scope.where, "t.title LIKE ? ESCAPE '\\'"].join(" AND ")} ORDER BY t.updated_at DESC LIMIT ${MAX}`)
    .bind(...scope.args, like)
    .all<{ id: string; title: string; status: string; assignee_name: string | null }>();
  for (const t of tasks.results) {
    hits.push({ kind: "task", id: t.id, title: t.title, sub: `Task · ${t.status}${t.assignee_name ? ` · ${t.assignee_name}` : ""}`, link: `/tasks?open=${t.id}` });
  }

  const readable = REGISTERS.filter((r) => canReadRegister(u, r.id));
  if (readable.length > 0) {
    const recs = await db
      .prepare(
        `SELECT id, collection, title FROM records WHERE deleted_at IS NULL AND title LIKE ? ESCAPE '\\'
         AND collection IN (${readable.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT ${MAX}`,
      )
      .bind(like, ...readable.map((r) => r.id))
      .all<{ id: string; collection: string; title: string | null }>();
    for (const r of recs.results) {
      const reg = readable.find((x) => x.id === r.collection)!;
      hits.push({ kind: "record", id: r.id, title: r.title ?? "", sub: reg.name, link: `/registers/${r.collection}?open=${r.id}` });
    }
  }

  const people = await db
    .prepare(
      `SELECT u.id, u.name, COALESCE(p.name, u.role) AS role, u.dept FROM users u LEFT JOIN positions p ON p.id = u.position_id
       WHERE u.name LIKE ? ESCAPE '\\' ${canSeePeoplePrivate(u) ? "" : "AND u.status != 'left'"}
       ORDER BY u.name COLLATE NOCASE LIMIT ${MAX}`,
    )
    .bind(like)
    .all<{ id: string; name: string; role: string; dept: string }>();
  for (const p of people.results) hits.push({ kind: "person", id: p.id, title: p.name, sub: `${p.dept} · ${p.role}`, link: `/people?open=${p.id}` });

  return c.json({ results: hits.slice(0, MAX) });
});
