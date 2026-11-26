/* People helpers: the directory row, labels and cache refresh. Permission mirrors live in ./perms. */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RoleName } from "../../../shared/schema";

export interface PersonRow {
  id: string; name: string; role: RoleName; dept: string; title: string | null; phone: string | null; email: string;
  positionId: string | null; positionName: string | null;
  managerId: string | null; status: "active" | "onboarding" | "left";
  /** Only in the admin's People & logins list. */
  mfaEnabled?: boolean;
  /** Only in the admin's People & logins list. */
  isAdmin?: boolean;
  /** Only in People & logins: "pending" / "declined" people asked to join with Google. */
  approval?: "approved" | "pending" | "declined";
  /** Only in People & logins: when the account was made (for a request, when they asked). */
  createdAt?: string;
  /** Only sent to people who may see private fields (admin, people = full). */
  joinedOn?: string | null; kind?: string | null;
}

export const KINDS = ["Full-time", "Intern", "Freelancer"] as const;
export const STATUS_LABEL = { active: "Active", onboarding: "Onboarding", left: "Left" } as const;
export const STATUS_TONE = { active: "done", onboarding: "wait", left: "muted" } as const;

export const positionLabel = (p: { positionName: string | null }) => p.positionName ?? "No position";

/** Anyone still here (except the person themselves) can be someone's manager. */
export const managerChoices = (people: PersonRow[], selfId: string | null) =>
  people.filter((p) => p.status !== "left" && p.id !== selfId);

export function useRefreshPeople() {
  const qc = useQueryClient();
  return useCallback(
    () => Promise.all(["users", "people", "positions", "dashboard", "onboarding"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
    [qc],
  );
}
