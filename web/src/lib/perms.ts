/* UI-only mirrors of worker/src/lib/policy.ts. They decide what the screen offers; the server checks every call again. */
import type { LeaveLevel, Me, RegisterLevel, TaskLevel } from "../../../shared/schema";

type U = Pick<Me, "id" | "dept" | "isAdmin" | "perms">;

export function registerLevel(u: U, id: string): RegisterLevel {
  if (u.isAdmin) return "manage";
  return Object.prototype.hasOwnProperty.call(u.perms.registers, id) ? u.perms.registers[id] : "none";
}
export const canReadRegister = (u: U, id: string) => registerLevel(u, id) !== "none";
/** Create and edit. */
export const canWriteRegister = (u: U, id: string) => ["edit", "manage"].includes(registerLevel(u, id));
/** Move to Trash. */
export const canDeleteRecord = (u: U, id: string) => registerLevel(u, id) === "manage";

export const taskLevel = (u: U): TaskLevel => (u.isAdmin ? "all" : u.perms.tasks);
export const leaveLevel = (u: U): LeaveLevel => (u.isAdmin ? "all" : u.perms.leave);

/** Private people fields (joining date, type, people who left) and onboarding. */
export const canSeePeoplePrivate = (u: U) => u.isAdmin || u.perms.people === "full";
/** May create accounts (non-admins always create Employees). */
export const canAddPeople = (u: U) => u.isAdmin || u.perms.addPeople;

/** "Team" = same department, or reports to me. */
export const inTeam = (u: U, dept: string | null | undefined, managerId: string | null | undefined) =>
  (!!dept && dept === u.dept) || (!!managerId && managerId === u.id);
