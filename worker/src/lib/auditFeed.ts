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

/** Newest first. `before` is an exclusive ISO cursor. */
export async function auditFeed(db: D1Database, limit: number, before?: string): Promise<AuditItem[]> {
  const { results } = await db
    .prepare(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${before ? "WHERE a.at < ?" : ""} ORDER BY a.at DESC, a.rowid DESC LIMIT ?`,
    )
    .bind(...(before ? [before, limit] : [limit]))
    .all<Row>();
  return results.map((r) => ({
    id: r.id, at: r.at, userId: r.user_id, userName: r.user_name, action: r.action, entity: r.entity,
    entityId: r.entity_id, title: r.title, detail: parse(r.detail),
  }));
}
