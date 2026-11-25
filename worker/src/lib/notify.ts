/** Inserts one notification per distinct user id, in a single batch. */
export async function notify(
  db: D1Database,
  userIds: string[],
  kind: string,
  title: string,
  link: string,
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO notifications (id, user_id, kind, title, link, read_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
  );
  await db.batch(ids.map((id) => stmt.bind(crypto.randomUUID(), id, kind, title, link, now)));
}
