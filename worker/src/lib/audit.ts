import type { SessionUser } from "../env";

/** Statement builder for use inside a db.batch (atomic with the change it records). */
export function auditStmt(
  db: D1Database,
  user: Pick<SessionUser, "id"> | null,
  action: string,
  entity: string,
  entityId: string | null,
  title: string | null,
  detail?: unknown,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, title, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      user?.id ?? null,
      action,
      entity,
      entityId,
      title,
      detail === undefined ? null : JSON.stringify(detail),
    );
}

/** Writes an audit row. Never pass passwords or hashes in `detail`. */
export async function audit(
  db: D1Database,
  user: Pick<SessionUser, "id"> | null,
  action: string,
  entity: string,
  entityId: string | null,
  title: string | null,
  detail?: unknown,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, title, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      user?.id ?? null,
      action,
      entity,
      entityId,
      title,
      detail === undefined ? null : JSON.stringify(detail),
    )
    .run();
}
