import { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { REGISTERS } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Placeholder } from "../components/Placeholder";
import { useToast } from "../components/Toast";
import type { RegisterRecord } from "../lib/registers";
import { fmtDay } from "../lib/tasks";
import { useTitle } from "../lib/useTitle";

export function Trash() {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Placeholder title="Trash" eyebrow="Administrator" note="You don't have access to this page." />;
  return <TrashList />;
}

function TrashList() {
  const notify = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  useTitle("Trash");

  const results = useQueries({
    queries: REGISTERS.map((r) => ({
      queryKey: ["records", r.id, "trash"],
      queryFn: () => api<{ rows: RegisterRecord[] }>("GET", `/records/${r.id}?trash=1`),
    })),
  });
  const loading = results.some((r) => r.isPending);
  const failed = results.find((r) => r.isError);
  const sections = REGISTERS.map((reg, i) => ({ reg, rows: results[i].data?.rows ?? [] })).filter((s) => s.rows.length > 0);

  async function restore(regId: string, row: RegisterRecord) {
    setBusy(row.id);
    try {
      await api("POST", `/records/${regId}/${row.id}/restore`);
      await Promise.all(["records", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      notify("Restored.");
    } catch (e) {
      notify(e instanceof ApiError ? (e.status === 404 ? "That record is no longer in the Trash." : e.message) : "Something went wrong. Please try again.", true);
      await qc.invalidateQueries({ queryKey: ["records"] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administrator</div>
          <h1>Trash</h1>
          <p>Things the team has deleted. Restore one and it goes back to its register.</p>
        </div>
      </div>
      {loading ? (
        <div className="empty">Loading…</div>
      ) : failed ? (
        <div className="empty"><h3>Could not load the Trash</h3><p>Refresh the page to try again.</p></div>
      ) : sections.length === 0 ? (
        <div className="card"><div className="empty"><h3>The Trash is empty</h3><p>Deleted records will wait here until you restore them.</p></div></div>
      ) : (
        sections.map(({ reg, rows }) => (
          <section className="section" key={reg.id}>
            <div className="section-head"><h2>{reg.name}</h2></div>
            <div className="card table-wrap">
              <table className="stack">
                <thead><tr><th>Name</th><th>Deleted</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: "default" }}>
                      <td data-l="Name"><div className="t-title">{r.title || "Untitled"}</div></td>
                      <td data-l="Deleted" className="nowrap">{fmtDay(r.updatedAt.slice(0, 10))}{r.updatedByName ? ` · ${r.updatedByName}` : ""}</td>
                      <td><button type="button" className="btn quiet" disabled={busy === r.id} onClick={() => void restore(reg.id, r)}>Restore</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}
