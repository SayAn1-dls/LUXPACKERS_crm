/* Positions: the list query and the plain-English words the editor uses. */
import { useQuery } from "@tanstack/react-query";
import { REGISTERS } from "../../../shared/schema";
import type { LeaveLevel, PeopleLevel, Perms, Position, RegisterLevel, TaskLevel } from "../../../shared/schema";
import { api } from "../api";

export type { Position } from "../../../shared/schema";

export function usePositions(enabled = true) {
  return useQuery({
    queryKey: ["positions"],
    queryFn: () => api<{ positions: Position[] }>("GET", "/positions"),
    enabled,
    staleTime: 60_000,
  });
}

export const TASK_WORDS: Record<TaskLevel, { label: string; hint: string }> = {
  own: { label: "Own", hint: "Sees only tasks given to them or by them." },
  team: { label: "Team", hint: "Also sees and checks tasks of their department and the people who report to them." },
  all: { label: "Everyone", hint: "Can see every task in the company." },
};

export const LEAVE_WORDS: Record<LeaveLevel, { label: string; hint: string }> = {
  own: { label: "Own", hint: "Asks for their own leave. Doesn't approve anyone's." },
  team: { label: "Team", hint: "Approves leave for their department and the people who report to them." },
  all: { label: "Everyone", hint: "Approves leave for everyone in the company." },
};

export const PEOPLE_WORDS: Record<PeopleLevel, { label: string; hint: string }> = {
  basic: { label: "Basic", hint: "Sees names, jobs and contact details." },
  full: { label: "Full", hint: "Also sees joining dates, contract type, people who left and onboarding." },
};

export const REGISTER_WORDS: Record<RegisterLevel, { label: string; hint: string }> = {
  none: { label: "Hidden", hint: "Not in their menu." },
  view: { label: "View", hint: "Can look, can't change." },
  edit: { label: "Edit", hint: "Can add and change records." },
  manage: { label: "Edit + delete", hint: "Can also move records to Trash." },
};

/** A new position starts careful: own tasks and leave, basic people details, every register hidden. */
export function blankPerms(): Perms {
  return {
    tasks: "own",
    leave: "own",
    people: "basic",
    addPeople: false,
    registers: Object.fromEntries(REGISTERS.map((r) => [r.id, "none" as RegisterLevel])),
  };
}

/** One short line about what a position opens, for the list. */
export function permsSummary(p: Position): string {
  if (p.isAdmin) return "Everything, including positions, logins and settings.";
  const regs = REGISTERS.filter((r) => (p.perms.registers[r.id] ?? "none") !== "none").length;
  const parts = [
    `Tasks: ${TASK_WORDS[p.perms.tasks].label.toLowerCase()}`,
    `Leave: ${LEAVE_WORDS[p.perms.leave].label.toLowerCase()}`,
    regs ? `${regs} ${regs === 1 ? "register" : "registers"}` : "no registers",
  ];
  if (p.perms.people === "full") parts.push("full people details");
  if (p.perms.addPeople) parts.push("can add people");
  return parts.join(" · ");
}
