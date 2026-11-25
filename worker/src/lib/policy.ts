/* Role policy: the single source of truth for who may see and do what.
   Pure and synchronous: no DB, no I/O. Every route calls these; never re-implement a rule inline. */
import { REGISTERS, ROLES, TASK_STATUSES, registerDepts } from "../../../shared/schema";
import type { Role, SessionUser } from "../env";

export interface TaskRef { assigneeId: string | null; assignedById: string; dept: string }
export interface AssigneeRef { managerId: string | null }

const KNOWN_REGISTERS = new Set(REGISTERS.map((r) => r.id));
const ASSIGNEE_STATUSES: ReadonlySet<string> = new Set(["To do", "In progress", "Waiting", "Blocked", "Submitted"]);
const ALL_STATUSES: ReadonlySet<string> = new Set(TASK_STATUSES);

const isManagerOfDept = (u: SessionUser, dept: string) => u.role === "manager" && u.dept === dept;
const isManagerOf = (u: SessionUser, assignee?: AssigneeRef | null) =>
  u.role === "manager" && !!assignee && assignee.managerId !== null && assignee.managerId === u.id;

/** Registers are open to admin and to the departments that list them. Unknown ids are denied for everyone. */
export function canReadRegister(u: SessionUser, registerId: string): boolean {
  if (!KNOWN_REGISTERS.has(registerId)) return false;
  return u.role === "admin" || registerDepts(registerId).includes(u.dept);
}

export function canWriteRegister(u: SessionUser, registerId: string): boolean {
  return canReadRegister(u, registerId);
}

export function canDeleteRecord(u: SessionUser, registerId: string): boolean {
  if (!canWriteRegister(u, registerId)) return false;
  return u.role === "admin" || u.role === "manager";
}

export function canAssignTo(u: SessionUser, target: { id: string; dept: string; managerId: string | null }): boolean {
  if (target.id === u.id) return true;
  if (u.role === "admin" || u.role === "hr") return true;
  if (u.role === "manager") return target.dept === u.dept || target.managerId === u.id;
  return false;
}

export function canSeeTask(u: SessionUser, t: TaskRef, assignee?: AssigneeRef | null): boolean {
  if (u.role === "admin") return true;
  if (t.assigneeId !== null && u.id === t.assigneeId) return true;
  if (u.id === t.assignedById) return true;
  return isManagerOfDept(u, t.dept) || isManagerOf(u, assignee);
}

export function canApproveTask(u: SessionUser, t: TaskRef, assignee?: AssigneeRef | null): boolean {
  if (t.assigneeId !== null && u.id === t.assigneeId) return false;
  return u.role === "admin" || u.id === t.assignedById || isManagerOfDept(u, t.dept) || isManagerOf(u, assignee);
}

export function canEditTaskStatus(u: SessionUser, t: TaskRef, next: string, assignee?: AssigneeRef | null): boolean {
  if (!ALL_STATUSES.has(next)) return false;
  if (canApproveTask(u, t, assignee)) return true;
  if (t.assigneeId === null || u.id !== t.assigneeId) return false;
  if (ASSIGNEE_STATUSES.has(next)) return true;
  return next === "Done" && t.assignedById === t.assigneeId;
}

/** Governs create / disable / reset-password by the target's role. Role changes must use canChangeRole. */
export function canManageUser(u: SessionUser, targetRole: Role): boolean {
  if (!(ROLES as readonly string[]).includes(targetRole)) return false;
  if (u.role === "admin") return true;
  return u.role === "hr" && targetRole === "employee";
}

export function canDecideLeave(u: SessionUser, requester: { id: string; managerId: string | null }): boolean {
  if (u.id === requester.id) return false;
  if (u.role === "admin" || u.role === "hr") return true;
  return u.role === "manager" && requester.managerId !== null && requester.managerId === u.id;
}

const isKnownRole = (r: string) => (ROLES as readonly string[]).includes(r);

/** Changing someone's role: admin only (HR cannot escalate or demote). */
export function canChangeRole(u: SessionUser, fromRole: string, toRole: string): boolean {
  return u.role === "admin" && isKnownRole(fromRole) && isKnownRole(toRole);
}

/** Profile fields only (name, title, phone, dept, managerId, kind, joinedOn, status); never role. */
export function canEditProfile(u: SessionUser, targetRole: string): boolean {
  return (u.role === "admin" || u.role === "hr") && isKnownRole(targetRole);
}

export function canSeePeoplePrivate(u: SessionUser): boolean {
  return u.role === "admin" || u.role === "hr";
}
