/* Positions: the shape of `perms`, its validation, the starter positions and the derived role label. */
import { z } from "zod";
import {
  ADMIN_POSITION_ID, EMPLOYEE_POSITION_ID, LEAVE_LEVELS, PEOPLE_LEVELS, REGISTERS, REGISTER_LEVELS, TASK_LEVELS,
} from "../../../shared/schema";
import type { Perms, RegisterLevel, RoleName } from "../../../shared/schema";

const REGISTER_IDS = REGISTERS.map((r) => r.id);

/** Every key required, every register id required, nothing extra. */
export const PermsSchema = z
  .object({
    tasks: z.enum(TASK_LEVELS),
    registers: z
      .object(Object.fromEntries(REGISTER_IDS.map((id) => [id, z.enum(REGISTER_LEVELS)])) as Record<string, z.ZodEnum<{ [K in RegisterLevel]: K }>>)
      .strict(),
    leave: z.enum(LEAVE_LEVELS),
    people: z.enum(PEOPLE_LEVELS),
    addPeople: z.boolean(),
  })
  .strict();

const regs = (level: RegisterLevel, over: Record<string, RegisterLevel> = {}): Record<string, RegisterLevel> =>
  Object.fromEntries(REGISTER_IDS.map((id) => [id, over[id] ?? level]));

/** An admin's effective permissions: everything at its highest level. */
export const ADMIN_PERMS: Perms = { tasks: "all", registers: regs("manage"), leave: "all", people: "full", addPeople: true };
/** Fail-closed permissions for a user with no (or an unreadable) position. */
export const NO_PERMS: Perms = { tasks: "own", registers: regs("none"), leave: "own", people: "basic", addPeople: false };

/** The four positions migration 0002 creates. Kept in step with the SQL by a test. */
export const STARTER_POSITIONS: { id: string; name: string; isAdmin: boolean; role: RoleName; perms: Perms }[] = [
  { id: ADMIN_POSITION_ID, name: "Admin", isAdmin: true, role: "admin", perms: ADMIN_PERMS },
  {
    id: "pos_manager", name: "Manager", isAdmin: false, role: "manager",
    perms: { tasks: "team", registers: regs("manage", { finance: "none", access: "none" }), leave: "team", people: "basic", addPeople: false },
  },
  {
    id: "pos_hr", name: "HR", isAdmin: false, role: "hr",
    perms: { tasks: "own", registers: regs("none"), leave: "all", people: "full", addPeople: true },
  },
  {
    id: EMPLOYEE_POSITION_ID, name: "Employee", isAdmin: false, role: "employee",
    // Employees start with no registers; the admin grants them per position.
    perms: { tasks: "own", registers: regs("none"), leave: "own", people: "basic", addPeople: false },
  },
];

/** Positions that can never be deleted: Admin (always exists) and Employee (what addPeople creates). */
export const BUILT_IN = new Set([ADMIN_POSITION_ID, EMPLOYEE_POSITION_ID]);

/** Parses stored perms; anything unreadable fails closed. */
export function parsePerms(raw: string | null | undefined): Perms {
  if (!raw) return NO_PERMS;
  try {
    const r = PermsSchema.safeParse(JSON.parse(raw));
    return r.success ? (r.data as Perms) : NO_PERMS;
  } catch {
    return NO_PERMS;
  }
}

/** Display label kept in users.role. Never used for permission checks. */
export function roleLabel(isAdmin: boolean, perms: Perms): RoleName {
  if (isAdmin) return "admin";
  if (perms.people === "full" || perms.addPeople) return "hr";
  if (perms.tasks !== "own" || perms.leave !== "own") return "manager";
  return "employee";
}
