/* The one place that knows how a task row is selected, shaped, and scoped to a caller.
   tasks.ts, the dashboard and search all build their task queries from here. */
import type { Task } from "../../../shared/schema";
import type { SessionUser } from "../env";
import type { AssigneeRef, TaskRef } from "./policy";

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  dept: string | null;
  assignee_id: string | null;
  assigned_by_id: string | null;
  priority: string | null;
  status: string;
  due: string | null;
  waiting_on: string | null;
  links: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  assignee_name: string | null;
  assigned_by_name: string | null;
  assignee_manager_id: string | null;
}

export const TASK_SELECT = `SELECT t.*, a.name AS assignee_name, a.manager_id AS assignee_manager_id, b.name AS assigned_by_name
  FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users b ON b.id = t.assigned_by_id`;

export const parseLinks = (s: string | null): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const taskToApi = (r: TaskRow, today: string): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dept: r.dept,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name,
  assignedById: r.assigned_by_id,
  assignedByName: r.assigned_by_name,
  priority: r.priority as Task["priority"],
  status: r.status as Task["status"],
  due: r.due,
  waitingOn: r.waiting_on,
  links: parseLinks(r.links),
  version: r.version,
  late: !!r.due && r.due < today && r.status !== "Done",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});

// DB dept / assigned_by_id are nullable. "" never matches a real user's dept or id.
export const taskRefOf = (r: TaskRow): TaskRef => ({ assigneeId: r.assignee_id, assignedById: r.assigned_by_id ?? "", dept: r.dept ?? "" });
export const taskAssigneeOf = (r: TaskRow): AssigneeRef | null => (r.assignee_id ? { managerId: r.assignee_manager_id } : null);

/** "default" = on me or assigned by me. "visible" = everything canSeeTask allows (SQL mirror of policy). */
export type TaskScope = "mine" | "assigned" | "team" | "all" | "default" | "visible";

/** Where-clauses (AND-ed) and bind args for a scope. Callers enforce who may ask for which scope. */
export function taskScopeWhere(u: Pick<SessionUser, "id" | "dept" | "role">, scope: TaskScope): { where: string[]; args: unknown[] } {
  switch (scope) {
    case "mine":
      return { where: ["t.assignee_id = ?"], args: [u.id] };
    case "assigned":
      return { where: ["t.assigned_by_id = ?"], args: [u.id] };
    case "team":
      return { where: ["(t.dept = ? OR a.manager_id = ?)"], args: [u.dept, u.id] };
    case "all":
      return { where: [], args: [] };
    case "visible":
      if (u.role === "admin") return { where: [], args: [] };
      if (u.role === "manager") {
        return {
          where: ["(t.assignee_id = ? OR t.assigned_by_id = ? OR t.dept = ? OR a.manager_id = ?)"],
          args: [u.id, u.id, u.dept, u.id],
        };
      }
      return taskScopeWhere(u, "default");
    default:
      // Everything on me or assigned by me.
      return { where: ["(t.assignee_id = ? OR t.assigned_by_id = ?)"], args: [u.id, u.id] };
  }
}
