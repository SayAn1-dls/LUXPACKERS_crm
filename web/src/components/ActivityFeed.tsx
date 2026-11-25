import { Link } from "react-router-dom";
import { describe, detailLine, linkFor } from "../lib/audit";
import type { AuditItem } from "../lib/audit";
import { timeAgo } from "./NotificationBell";

/** Latest changes, one line each. */
export function ActivityFeed({ items }: { items: AuditItem[] }) {
  if (items.length === 0) return <p className="muted small" style={{ margin: 0 }}>No changes yet.</p>;
  return (
    <ul className="feed">
      {items.map((a) => {
        const to = linkFor(a);
        const more = detailLine(a);
        return (
          <li key={a.id}>
            <div>
              {to ? <Link className="rowbtn" style={{ fontWeight: 400 }} to={to}>{describe(a)}</Link> : describe(a)}
              {more && <div className="small muted">{more}</div>}
            </div>
            <time dateTime={a.at}>{timeAgo(a.at)}</time>
          </li>
        );
      })}
    </ul>
  );
}
