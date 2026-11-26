export interface AuditItem {
  id: string;
  at: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  title: string | null;
  detail: unknown;
}

interface Row {
  id: string; at: string; user_id: string | null; action: string; entity: string;
  entity_id: string | null; title: string | null; detail: string | null; user_name: string | null;
}

const parse = (s: string | null): unknown => {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Cursor is "at|rowid". A bare ISO timestamp is also accepted (everything strictly older). Null when malformed. */
export function parseCursor(c: string): { at: string; rowid: number } | null {
  const [at, rid, extra] = c.split("|");
  if (extra !== undefined || !/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (rid === undefined) return { at, rowid: -1 };
  return /^\d+$/.test(rid) ? { at, rowid: Number(rid) } : null;
}

/** Newest first, ties broken by rowid so rows sharing a timestamp page cleanly. */
export async function auditPage(db: D1Database, limit: number, before?: { at: string; rowid: number }) {
  const { results } = await db
    .prepare(
      `SELECT a.*, a.rowid AS rid, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${before ? "WHERE (a.at < ? OR (a.at = ? AND a.rowid < ?))" : ""} ORDER BY a.at DESC, a.rowid DESC LIMIT ?`,
    )
    .bind(...(before ? [before.at, before.at, before.rowid < 0 ? -1 : before.rowid, limit + 1] : [limit + 1]))
    .all<Row & { rid: number }>();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    next: results.length > limit && last ? `${last.at}|${last.rid}` : null,
  };
}

const toItem = (r: Row): AuditItem => ({
  id: r.id, at: r.at, userId: r.user_id, userName: r.user_name, action: r.action, entity: r.entity,
  entityId: r.entity_id, title: r.title, detail: parse(r.detail),
});

export const auditFeed = async (db: D1Database, limit: number) => (await auditPage(db, limit)).items;
