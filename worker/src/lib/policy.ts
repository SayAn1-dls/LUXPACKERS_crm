/* Permission policy: the single source of truth for who may see and do what.
   Decisions come from the caller's position (isAdmin + perms), never from the role label or department name alone.
   Pure and synchronous: no DB, no I/O. Every route calls these; never re-implement a rule inline. */
import { EMPLOYEE_POSITION_ID, REGISTERS, TASK_STATUSES } from "../../../shared/schema";
import type { LeaveLevel, RegisterLevel, TaskLevel } from "../../../shared/schema";
import type { SessionUser } from "../env";

export type PolicyUser = Pick<SessionUser, "id" | "dept" | "isAdmin" | "perms">;

export interface TaskRef { assigneeId: string | null; assignedById: string; dept: string }
export interface AssigneeRef { managerId: string | null }

const KNOWN_REGISTERS: ReadonlySet<string> = new Set(REGISTERS.map((r) => r.id));
const ASSIGNEE_STATUSES: ReadonlySet<string> = new Set(["To do", "In progress", "Waiting", "Blocked", "Submitted"]);
const ALL_STATUSES: ReadonlySet<string> = new Set(TASK_STATUSES);

/* ---------- admin-only areas ---------- */

const admin = (u: PolicyUser) => u.isAdmin === true;
/** Positions CRUD and changing anyone's position. */
export const canManagePositions = admin;
/** Editing people (email, password, position, dept, manager, status, profile) and resetting passwords. */
export const canEditUsers = admin;
export const canImport = admin;
export const canSeeAudit = admin;
/** Listing the Trash and restoring from it. */
export const canUseTrash = admin;
export const canEditSettings = admin;
/** The admin-only dashboard sections (figures, attention, departments, latest). */
export const canSeeAdminDashboard = admin;

/* ---------- registers ---------- */

/** The caller's level on a register. Unknown ids are "none" for everyone, admin included. */
export function registerLevel(u: PolicyUser, registerId: string): RegisterLevel {
  if (!KNOWN_REGISTERS.has(registerId)) return "none";
  if (admin(u)) return "manage";
  const regs = u.perms.registers;
  return Object.prototype.hasOwnProperty.call(regs, registerId) ? regs[registerId] : "none";
}

export function canReadRegister(u: PolicyUser, registerId: string): boolean {
  return registerLevel(u, registerId) !== "none";
}

/** Create and edit. */
export function canWriteRegister(u: PolicyUser, registerId: string): boolean {
  const l = registerLevel(u, registerId);
  return l === "edit" || l === "manage";
}

/** Move to Trash. */
export function canDeleteRecord(u: PolicyUser, registerId: string): boolean {
  return registerLevel(u, registerId) === "manage";
}

/* ---------- tasks ---------- */

export function taskLevel(u: PolicyUser): TaskLevel {
  return admin(u) ? "all" : u.perms.tasks;
}

/** "Team" = same department, or reports to me. */
const inTeam = (u: PolicyUser, dept: string | null | undefined, managerId: string | null | undefined) =>
  (!!dept && dept === u.dept) || (!!managerId && managerId === u.id);

/** own: only myself. team: myself, my department and my reports. all: anyone. */
export function canAssignTo(u: PolicyUser, target: { id: string; dept: string; managerId: string | null }): boolean {
  if (target.id === u.id) return true;
  const level = taskLevel(u);
  if (level === "all") return true;
  return level === "team" && inTeam(u, target.dept, target.managerId);
}

const teamCovers = (u: PolicyUser, t: TaskRef, assignee?: AssigneeRef | null) =>
  taskLevel(u) === "team" && inTeam(u, t.dept, assignee?.managerId ?? null);

export function canSeeTask(u: PolicyUser, t: TaskRef, assignee?: AssigneeRef | null): boolean {
  if (taskLevel(u) === "all") return true;
  if (t.assigneeId !== null && u.id === t.assigneeId) return true;
  if (u.id === t.assignedById) return true;
  return teamCovers(u, t, assignee);
}

/** The assignee never approves their own task. */
export function canApproveTask(u: PolicyUser, t: TaskRef, assignee?: AssigneeRef | null): boolean {
  if (t.assigneeId !== null && u.id === t.assigneeId) return false;
  return taskLevel(u) === "all" || u.id === t.assignedById || teamCovers(u, t, assignee);
}

export function canEditTaskStatus(u: PolicyUser, t: TaskRef, next: string, assignee?: AssigneeRef | null): boolean {
  if (!ALL_STATUSES.has(next)) return false;
  if (canApproveTask(u, t, assignee)) return true;
  if (t.assigneeId === null || u.id !== t.assigneeId) return false;
  if (ASSIGNEE_STATUSES.has(next)) return true;
  return next === "Done" && t.assignedById === t.assigneeId;
}

/* ---------- leave ---------- */

export function leaveLevel(u: PolicyUser): LeaveLevel {
  return admin(u) ? "all" : u.perms.leave;
}

/** Nobody decides their own leave. */
export function canDecideLeave(u: PolicyUser, requester: { id: string; managerId: string | null; dept?: string | null }): boolean {
  if (u.id === requester.id) return false;
  const level = leaveLevel(u);
  if (level === "all") return true;
  return level === "team" && inTeam(u, requester.dept, requester.managerId);
}

/** Leave list tabs: "team" for team or all, "all" for all. */
export function canListLeave(u: PolicyUser, scope: "mine" | "team" | "all"): boolean {
  if (scope === "mine") return true;
  const level = leaveLevel(u);
  return scope === "team" ? level !== "own" : level === "all";
}

/* ---------- people ---------- */

/** Private fields (joined on, kind, people who left), the user list and onboarding. */
export function canSeePeoplePrivate(u: PolicyUser): boolean {
  return admin(u) || u.perms.people === "full";
}

export const canManageOnboarding = canSeePeoplePrivate;

/** May open POST /api/users at all. */
export function canAddPeople(u: PolicyUser): boolean {
  return admin(u) || u.perms.addPeople === true;
}

/** Creating an account with this position: admin any, addPeople the Employee starter position only. */
export function canCreateUserWithPosition(u: PolicyUser, positionId: string): boolean {
  if (admin(u)) return true;
  return u.perms.addPeople === true && positionId === EMPLOYEE_POSITION_ID;
}
