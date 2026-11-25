import { Link } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Placeholder } from "../components/Placeholder";
import { describe, detailLine, linkFor } from "../lib/audit";
import type { AuditItem } from "../lib/audit";
import { useTitle } from "../lib/useTitle";

interface Page { items: AuditItem[]; next: string | null }

export function Audit() {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Placeholder title="Audit log" eyebrow="Administrator" note="You don't have access to this page." />;
  return <AuditLog />;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function AuditLog() {
  useTitle("Audit log");
  const q = useInfiniteQuery({
    queryKey: ["audit"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>("GET", `/audit?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administrator</div>
          <h1>Audit log</h1>
          <p>Every change made in the CRM, newest first.</p>
        </div>
      </div>
      <div className="card">
        {q.isPending ? (
          <div className="empty">Loading…</div>
        ) : q.isError ? (
          <div className="empty"><h3>Could not load the audit log</h3><p>Refresh the page to try again.</p></div>
        ) : items.length === 0 ? (
          <div className="empty">Nothing has been recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="stack">
              <thead><tr><th>When</th><th>What happened</th></tr></thead>
              <tbody>
                {items.map((a) => {
                  const to = linkFor(a);
                  const more = detailLine(a);
                  return (
                    <tr key={a.id} style={{ cursor: "default" }}>
                      <td data-l="When" className="nowrap muted">{when(a.at)}</td>
                      <td data-l="What happened">
                        {to ? <Link className="rowbtn" style={{ fontWeight: 400 }} to={to}>{describe(a)}</Link> : describe(a)}
                        {more && <div className="t-meta">{more}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && (
          <div className="list-foot">
            <span>{items.length} {items.length === 1 ? "entry" : "entries"} shown</span>
            {q.hasNextPage ? (
              <button type="button" className="btn quiet" style={{ minHeight: 36 }} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? "Loading…" : "Load older"}
              </button>
            ) : (
              <span>That is everything.</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
