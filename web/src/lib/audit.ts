/* Plain-English description of an audit entry, shared by the Audit page and the admin home. */
export interface AuditItem {
  id: string; at: string; userId: string | null; userName: string | null; action: string; entity: string;
  entityId: string | null; title: string | null; detail: unknown;
}

const q = (t: string | null) => (t ? `“${t}”` : "");

export function describe(a: AuditItem): string {
  const who = a.userName ?? "Someone";
  const t = q(a.title);
  switch (a.action) {
    case "login": return `${who} signed in`;
    case "logout": return `${who} signed out`;
    case "setup": return `${who} set up the CRM`;
    case "password_change": return `${who} changed their password`;
    case "password_reset": return `${who} reset the password for ${a.title ?? "someone"}`;
    case "user_created": return `${who} created an account for ${a.title ?? "someone"}`;
    case "user_updated": return `${who} updated ${a.title ?? "a person"}`;
    case "user_disabled": return `${who} turned off ${a.title ?? "an account"}`;
    case "onboarding_updated": return `${who} updated onboarding for ${a.title ?? "a new joiner"}`;
    case "leave_requested": return a.title ?? `${who} asked for leave`;
    case "leave_approved": return `${who} approved a leave request`;
    case "leave_rejected": return `${who} rejected a leave request`;
    case "leave_cancelled": return `${who} cancelled leave: ${a.title ?? ""}`.trim();
    case "settings_updated": return `${who} changed the settings`;
    case "import": return `${who} imported ${a.title ?? "records"}`;
    case "task_created": return `${who} created the task ${t}`;
    case "task_updated": return `${who} updated the task ${t}`;
    case "task_submitted": return `${who} submitted the task ${t} for review`;
    case "task_approved": return `${who} approved the task ${t}`;
    case "task_sent_back": return `${who} sent back the task ${t}`;
    case "task_commented": return `${who} commented on the task ${t}`;
    case "record_created": return `${who} added ${t}`;
    case "record_updated": return `${who} updated ${t}`;
    case "record_deleted": return `${who} moved ${t} to the Trash`;
    case "record_restored": return `${who} restored ${t}`;
    default: return `${who} ${a.action.replace(/_/g, " ")}${t ? ` ${t}` : ""}`;
  }
}

/** A short second line (what changed), or null. */
export function detailLine(a: AuditItem): string | null {
  const d = a.detail;
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (Array.isArray(o.fields) && o.fields.length) return `Changed: ${o.fields.join(", ")}`;
  if (typeof o.step === "string") return `${o.step}: ${o.done ? "ticked" : "unticked"}`;
  if (a.action === "import" && o.created !== undefined) return `${o.created} added, ${o.updated ?? 0} updated`;
  return null;
}

/** Where the entry's subject lives in the app, when it still does. */
export function linkFor(a: AuditItem): string | null {
  if (!a.entityId || a.action === "record_deleted") return null;
  if (a.entity === "task") return `/tasks?open=${a.entityId}`;
  if (a.entity === "user") return "/people";
  if (a.entity === "leave") return "/leave";
  if (a.action.startsWith("record_")) return `/registers/${a.entity}?open=${a.entityId}`;
  return null;
}
