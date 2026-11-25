/* Task helpers shared by the drawer, the Tasks page and the dashboards. */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TASK_STATUSES } from "../../../shared/schema";
import type { Task, TaskStatus } from "../../../shared/schema";
import { ApiError } from "../api";
import type { User } from "../auth";

export type { Task, TaskComment, TaskStatus } from "../../../shared/schema";

export interface Person { id: string; name: string; role: string; dept: string; managerId: string | null; status: string }

export const CONFLICT_MESSAGE = "Someone else changed this. Reload to see their change.";

/** Mirrors the server's canAssignTo. The server checks again. */
export function canAssignTo(u: User, p: Person): boolean {
  if (p.id === u.id) return true;
  if (u.role === "admin" || u.role === "hr") return true;
  if (u.role === "manager") return p.dept === u.dept || p.managerId === u.id;
  return false;
}

export const assignablePeople = (u: User, people: Person[]) => people.filter((p) => p.status !== "left" && canAssignTo(u, p));

export interface TaskPerms {
  isAssignee: boolean;
  selfTask: boolean;
  approver: boolean;
  /** Title, notes, assignee, department, priority, due, links. */
  canEditFields: boolean;
  canEditWaiting: boolean;
  /** Statuses the status chips may offer (never Submitted). */
  statusOptions: TaskStatus[];
  canSubmit: boolean;
  canWithdraw: boolean;
  canReview: boolean;
  showMarkDone: boolean;
}

/** Mirrors canApproveTask / canEditTaskStatus on the server, so the drawer only offers what will work. */
export function taskPerms(u: User, t: Task, people: Person[]): TaskPerms {
  const isAssignee = t.assigneeId === u.id;
  const assigner = t.assignedById === u.id;
  const selfTask = !!t.assignedById && t.assignedById === t.assigneeId;
  const assigneeManager = people.find((p) => p.id === t.assigneeId)?.managerId ?? null;
  const approver =
    !isAssignee &&
    (u.role === "admin" || assigner || (u.role === "manager" && (t.dept === u.dept || (assigneeManager !== null && assigneeManager === u.id))));

  const allowed = (s: TaskStatus) => approver || (isAssignee && (s !== "Done" || selfTask));
  const lockedDone = t.status === "Done" && !selfTask && !approver;
  const markDone = isAssignee && selfTask && t.status !== "Done";
  const statusOptions =
    t.status === "Submitted" || lockedDone
      ? []
      : TASK_STATUSES.filter((s) => s !== "Submitted" && allowed(s) && !(markDone && s === "Done"));

  return {
    isAssignee,
    selfTask,
    approver,
    canEditFields: approver || assigner,
    canEditWaiting: approver || assigner || isAssignee,
    statusOptions,
    canSubmit: isAssignee && !selfTask && t.status !== "Submitted" && t.status !== "Done",
    canWithdraw: isAssignee && t.status === "Submitted",
    canReview: approver && t.status === "Submitted",
    showMarkDone: markDone,
  };
}

/** Plain-English message for a failed task call. Returns the toast text. */
export function taskErrorMessage(e: unknown, whileAssigning = false): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Please try again.";
  if (e.status === 409) return CONFLICT_MESSAGE;
  if (e.status === 403) return whileAssigning ? "You can't assign work to that person." : "You don't have permission to do that.";
  if (e.code === "comment_required") return "Tell them what to change.";
  if (e.code === "invalid_assignee") return "That person can't be given this task.";
  return e.message;
}

/** The link only if it parses as http(s); otherwise null (never render it as an anchor). */
export function safeHttp(url: string): { href: string; host: string } | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? { href: u.href, host: u.host } : null;
  } catch {
    return null;
  }
}

/** "5 Dec", with the year when it is not this year. Input is YYYY-MM-DD. */
export function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** After any task change, everything that shows tasks is stale. */
export function useRefreshTasks() {
  const qc = useQueryClient();
  return useCallback(
    () => Promise.all(["tasks", "dashboard", "notifications"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
    [qc],
  );
}
