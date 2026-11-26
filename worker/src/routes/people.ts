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
  position_id: string | null;
  position_name: string | null;
}

export const people = new Hono<AppEnv>();

people.get("/", requireUser, async (c) => {
  const priv = canSeePeoplePrivate(c.var.user!);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.dept, u.title, u.phone, u.email, u.manager_id, u.status, u.joined_on, u.kind,
            u.position_id, p.name AS position_name
       FROM users u LEFT JOIN positions p ON p.id = u.position_id
       ${priv ? "" : "WHERE u.status != 'left'"} ORDER BY u.name COLLATE NOCASE`,
  ).all<Row>();
  return c.json({
    people: results.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      positionId: r.position_id,
      positionName: r.position_name,
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
