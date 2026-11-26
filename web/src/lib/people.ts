/* People helpers: the directory row, UI-only permission mirrors (the server checks again) and cache refresh. */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RoleName } from "../../../shared/schema";
import type { User } from "../auth";

export interface PersonRow {
  id: string; name: string; role: RoleName; dept: string; title: string | null; phone: string | null; email: string;
  managerId: string | null; status: "active" | "onboarding" | "left";
  /** Only sent to admin and HR. */
  joinedOn?: string | null; kind?: string | null;
}

export const ROLE_LABEL: Record<RoleName, string> = { admin: "Administrator", manager: "Manager", hr: "People & HR", employee: "Team member" };
export const KINDS = ["Full-time", "Intern", "Freelancer"] as const;
export const STATUS_LABEL = { active: "Active", onboarding: "Onboarding", left: "Left" } as const;
export const STATUS_TONE = { active: "done", onboarding: "wait", left: "muted" } as const;

/** Mirrors canSeePeoplePrivate / canEditProfile. */
export const isStaff = (u: User) => u.role === "admin" || u.role === "hr";
/** Mirrors canManageUser: admin for anyone, HR for team members only. */
export const canManageUser = (u: User, targetRole: RoleName) => u.role === "admin" || (u.role === "hr" && targetRole === "employee");
/** Status, department and manager are never self-service (except for an administrator). */
export const canEditManaged = (u: User, p: PersonRow) => canManageUser(u, p.role) && (p.id !== u.id || u.role === "admin");
/** Role changes: administrator only, never on themselves. */
export const canChangeRole = (u: User, p: PersonRow) => u.role === "admin" && p.id !== u.id;

/** People who can be someone's manager: managers and administrators who are still here. */
export const managerChoices = (people: PersonRow[], selfId: string | null) =>
  people.filter((p) => p.status !== "left" && p.id !== selfId && (p.role === "manager" || p.role === "admin"));

export function useRefreshPeople() {
  const qc = useQueryClient();
  return useCallback(() => Promise.all(["users", "people", "dashboard", "onboarding"].map((k) => qc.invalidateQueries({ queryKey: [k] }))), [qc]);
}
