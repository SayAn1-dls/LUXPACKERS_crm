import { Hono } from "hono";
import type { AppEnv } from "../env";
import { canSeePeoplePrivate } from "../lib/policy";
import { requireUser } from "../lib/session";

interface Row {
  id: string;
  name: string;
  role: string;
  dept: string;
  title: string | null;
  phone: string | null;
  email: string;
  manager_id: string | null;
  status: string;
  joined_on: string | null;
  kind: string | null;
}

export const people = new Hono<AppEnv>();

people.get("/", requireUser, async (c) => {
  const priv = canSeePeoplePrivate(c.var.user!);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, role, dept, title, phone, email, manager_id, status, joined_on, kind
       FROM users ${priv ? "" : "WHERE status != 'left'"} ORDER BY name COLLATE NOCASE`,
  ).all<Row>();
  return c.json({
    people: results.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      dept: r.dept,
      title: r.title,
      phone: r.phone,
      email: r.email,
      managerId: r.manager_id,
      status: r.status,
      ...(priv ? { joinedOn: r.joined_on, kind: r.kind } : {}),
    })),
  });
});
