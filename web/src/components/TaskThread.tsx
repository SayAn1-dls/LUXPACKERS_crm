import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { timeAgo } from "./NotificationBell";
import { useToast } from "./Toast";
import { taskErrorMessage, useRefreshTasks } from "../lib/tasks";
import type { Task, TaskComment } from "../lib/tasks";

const KIND_LABEL: Record<TaskComment["kind"], string> = { comment: "", sent_back: "Sent back", approved: "Approved" };

/** Comments, review decisions and a short history of the task. */
export function TaskThread({ task }: { task: Task }) {
  const notify = useToast();
  const refresh = useRefreshTasks();
  const [text, setText] = useState("");
  const list = useQuery({
    queryKey: ["tasks", task.id, "comments"],
    queryFn: () => api<{ comments: TaskComment[] }>("GET", `/tasks/${task.id}/comments`),
  });
  const add = useMutation({
    mutationFn: (body: string) => api("POST", `/tasks/${task.id}/comments`, { body }),
    onSuccess: () => {
      setText("");
      void refresh();
    },
    onError: (e) => notify(taskErrorMessage(e), true),
  });

  const comments = list.data?.comments ?? [];
  return (
    <section className="history" aria-label="Comments and history">
      <span className="flabel">Comments</span>
      {list.isPending ? (
        <p className="small muted">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="small muted">No comments yet.</p>
      ) : (
        <ul>
          {comments.map((c) => (
            <li key={c.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line-2)" }}>
              <div>
                <b style={{ fontWeight: 500, color: "var(--text)" }}>{c.userName || "Someone"}</b>
                {KIND_LABEL[c.kind] && <span className={c.kind === "sent_back" ? "late" : ""}> · {KIND_LABEL[c.kind]}</span>}
                {" · "}{timeAgo(c.createdAt)}
              </div>
              {c.kind !== "approved" || c.body !== "Approved" ? <div style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{c.body}</div> : null}
            </li>
          ))}
        </ul>
      )}
      <form
        style={{ marginTop: 10, display: "grid", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate(text.trim());
        }}
      >
        <label className="sr-only" htmlFor="newcomment">Add a comment</label>
        <textarea id="newcomment" className="input" style={{ minHeight: 76 }} placeholder="Add a comment" value={text} onChange={(e) => setText(e.target.value)} />
        <div><button type="submit" className="btn quiet" disabled={add.isPending || !text.trim()}>Add comment</button></div>
      </form>
      <ul style={{ marginTop: 14 }}>
        <li>Added{task.assignedByName ? ` by ${task.assignedByName}` : ""} · {timeAgo(task.createdAt)}</li>
        {task.updatedAt !== task.createdAt && <li>Last changed · {timeAgo(task.updatedAt)}</li>}
        {task.completedAt && <li>Completed · {timeAgo(task.completedAt)}</li>}
      </ul>
    </section>
  );
}
