/* People helpers: the directory row, labels, password helpers and cache refresh. Permission mirrors live in ./perms. */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RoleName } from "../../../shared/schema";

export interface PersonRow {
  id: string; name: string; role: RoleName; dept: string; title: string | null; phone: string | null; email: string;
  positionId: string | null; positionName: string | null;
  managerId: string | null; status: "active" | "onboarding" | "left";
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

export const MIN_PASSWORD = 10;

/** A readable random password (no look-alike characters), made in the browser. */
export function generatePassword(length = 14): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out.replace(/(.{4})(?=.)/g, "$1-");
}

export function useRefreshPeople() {
  const qc = useQueryClient();
  return useCallback(
    () => Promise.all(["users", "people", "positions", "dashboard", "onboarding"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
    [qc],
  );
}
