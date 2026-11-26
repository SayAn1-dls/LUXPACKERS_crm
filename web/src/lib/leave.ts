/* Leave helpers shared by the Leave page and the dashboards. */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useToast } from "../components/Toast";
import { errorText } from "./errors";

export const LEAVE_KINDS = ["Casual", "Sick", "Earned", "Unpaid"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export interface LeaveRequest {
  id: string; userId: string; userName: string; kind: LeaveKind; start: string; end: string; days: number;
  halfDay: boolean; reason: string | null; status: "Pending" | "Approved" | "Rejected" | "Cancelled";
  decidedBy: string | null; decidedAt: string | null; note: string | null;
}
export type Balance = Record<string, { allowed: number; used: number; left: number }>;

export const daysText = (n: number, half: boolean) => (half ? "half day" : `${n} ${n === 1 ? "day" : "days"}`);

export function useRefreshLeave() {
  const qc = useQueryClient();
  return useCallback(() => Promise.all(["leave", "dashboard", "notifications"].map((k) => qc.invalidateQueries({ queryKey: [k] }))), [qc]);
}

/** Approve / reject / cancel a leave request, with the toast and the refresh. */
export function useLeaveActions() {
  const notify = useToast();
  const refresh = useRefreshLeave();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (id: string, verb: "approve" | "reject" | "cancel") => {
      setBusy(id);
      try {
        await api("POST", `/leave/${id}/${verb}`);
        notify(verb === "approve" ? "Leave approved." : verb === "reject" ? "Leave rejected." : "Request cancelled.");
      } catch (e) {
        notify(e instanceof ApiError && e.code === "not_pending" ? "That request was already decided." : errorText(e), true);
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [notify, refresh],
  );
  return { busy, run };
}
