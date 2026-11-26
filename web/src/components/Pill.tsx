import type { ReactNode } from "react";
import type { TaskStatus, Tone } from "../../../shared/schema";

export const taskTone: Record<TaskStatus, Tone> = {
  "To do": "todo",
  "In progress": "doing",
  Waiting: "wait",
  Blocked: "alert",
  Submitted: "doing",
  Done: "done",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill tone-${tone}`}>{children}</span>;
}
