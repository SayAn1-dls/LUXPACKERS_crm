/** Statements (one per distinct user id) for use inside a db.batch. */
export function notifyStmts(
  db: D1Database,
  userIds: string[],
  kind: string,
  title: string,
  link: string,
): D1PreparedStatement[] {
  const ids = [...new Set(userIds)];
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO notifications (id, user_id, kind, title, link, read_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
  );
  return ids.map((id) => stmt.bind(crypto.randomUUID(), id, kind, title, link, now));
}

/** Inserts one notification per distinct user id, in a single batch. */
export async function notify(
  db: D1Database,
  userIds: string[],
  kind: string,
  title: string,
  link: string,
): Promise<void> {
  const stmts = notifyStmts(db, userIds, kind, title, link);
  if (stmts.length === 0) return;
  await db.batch(stmts);
}
