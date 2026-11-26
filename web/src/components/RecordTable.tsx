import { useMemo, useState } from "react";
import type { FieldDef, RegisterDef } from "../../../shared/schema";
import { fmtDay } from "../lib/tasks";
import { NO_OWNER, fieldOf, isLate, isOpen, money, safeLink, toneOf, valueOf } from "../lib/registers";
import type { RecordLink, RegisterRecord } from "../lib/registers";

interface Props {
  register: RegisterDef;
  rows: RegisterRecord[];
  onOpen: (id: string) => void;
  /** Null when the person may only look (register level "view"). */
  onNew: (() => void) | null;
  /** Quick status change from the table. */
  onStatus: (row: RegisterRecord, value: string) => void;
  /** Row id whose status is being saved. */
  busyId: string | null;
  /** Start with the owner filter set (e.g. NO_OWNER from the admin's "Needs an owner" list). */
  initialOwner?: string;
}

type Chip = "" | "__open" | "__late" | string;
interface Sort { key: string; dir: "asc" | "desc" }

const NUMERIC = ["money", "number", "computed"];
const SEARCHABLE = ["text", "textarea", "email", "select", "person"];

function Cell({ reg, r, k, first, busy, onStatus }: { reg: RegisterDef; r: RegisterRecord; k: string; first: boolean; busy: boolean; onStatus: ((v: string) => void) | null }) {
  const fd: FieldDef = fieldOf(reg, k) ?? { key: k, label: k, type: "text" };
  const label = fd.label;
  const v = valueOf(r, k);
  if (k === reg.titleKey) {
    const notes = r.data.notes as string | undefined;
    return (
      <td data-l={label}>
        <div className="t-title">{r.title || "Untitled"}</div>
        {notes && <div className="t-meta">{notes}</div>}
      </td>
    );
  }
  if (first) return <td data-l={label} className="nowrap">{fd.type === "date" ? fmtDay(v || null) : v ?? ""}</td>;
  switch (fd.type) {
    case "status":
      if (!onStatus) return <td data-l={label}>{v ? <span className={`pill tone-${toneOf(reg, v)}`}>{v}</span> : null}</td>;
      return (
        <td data-l={label} onClick={(e) => e.stopPropagation()}>
          <select
            className={`pill-select tone-${toneOf(reg, v)}`} aria-label={`Change ${label}`} value={v ?? ""} disabled={busy}
            onChange={(e) => onStatus(e.target.value)}
          >
            {v && !reg.statuses.some((s) => s.v === v) && <option value={v}>{v}</option>}
            {reg.statuses.map((s) => <option key={s.v}>{s.v}</option>)}
          </select>
        </td>
      );
    case "date":
      return <td data-l={label} className={`nowrap${k === reg.dueKey && isLate(reg, r) ? " late" : ""}`}>{fmtDay(v || null)}</td>;
    case "money":
      return <td data-l={label} className="num">{money(v)}</td>;
    case "number":
      return <td data-l={label} className="num">{v ?? ""}</td>;
    case "computed": {
      const x = fd.calc ? fd.calc({ ...r.data, owner_id: r.ownerId }) : 0;
      return <td data-l={label} className={`num${x > 0 ? "" : " muted"}`}>{fd.format === "money" ? money(x) || "₹0" : x}</td>;
    }
    case "links": {
      const ok = ((v ?? []) as RecordLink[]).map((l) => ({ l, href: safeLink(l) })).filter((x) => x.href);
      return (
        <td data-l={label} onClick={(e) => e.stopPropagation()}>
          {ok.length > 0 && (
            <>
              <a className="lnk" href={ok[0].href!} target="_blank" rel="noopener noreferrer">{ok[0].l.label || "Open link"} ↗</a>
              {ok.length > 1 && <span className="small muted"> +{ok.length - 1}</span>}
            </>
          )}
        </td>
      );
    }
    case "checklist": {
      const n = ((v ?? []) as string[]).length;
      const tot = fd.options?.length ?? 1;
      return (
        <td data-l={label}>
          <div className="steps"><span className="small">{n} of {tot}</span><div className="bar"><i style={{ width: `${(n / tot) * 100}%` }} /></div></div>
        </td>
      );
    }
    case "select":
      return <td data-l={label} className={k === "priority" && v === "High" ? "late" : ""}>{v ?? ""}</td>;
    default:
      return <td data-l={label}>{v ?? ""}</td>;
  }
}

/** Table with status chips, search, filters and sortable columns. All filtering is done here on the loaded rows. */
export function RecordTable({ register: reg, rows, onOpen, onNew, onStatus, busyId, initialOwner = "" }: Props) {
  const [chip, setChip] = useState<Chip>("");
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>(initialOwner ? { owner_id: initialOwner } : {});
  const [sort, setSort] = useState<Sort | null>(null);

  const count = (v: string) => rows.filter((r) => r.data[reg.statusKey] === v).length;
  const lateN = rows.filter((r) => isLate(reg, r)).length;
  const hasDone = reg.doneValues.length > 0;

  const filters = useMemo(
    () =>
      reg.filters.map((k) => {
        const fd = fieldOf(reg, k) ?? { key: k, label: k, type: "text" as const };
        const options =
          k === "owner_id"
            ? [...new Set(rows.map((r) => r.ownerName).filter((x): x is string => !!x))].sort()
            : fd.options ?? [...new Set(rows.map((r) => String(r.data[k] ?? "")).filter(Boolean))].sort();
        return { key: k, fd, options };
      }),
    [reg, rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) =>
      chip === "" ? true : chip === "__open" ? isOpen(reg, r) : chip === "__late" ? isLate(reg, r) : r.data[reg.statusKey] === chip,
    );
    for (const [k, v] of Object.entries(extra)) {
      if (!v) continue;
      out = k === "owner_id" && v === NO_OWNER ? out.filter((r) => !r.ownerId) : out.filter((r) => String(valueOf(r, k) ?? "") === v);
    }
    if (needle) {
      out = out.filter(
        (r) =>
          (r.ownerName ?? "").toLowerCase().includes(needle) ||
          reg.fields.some((fd) => SEARCHABLE.includes(fd.type) && String(r.data[fd.key] ?? "").toLowerCase().includes(needle)),
      );
    }
    const order = reg.statuses.map((s) => s.v);
    const num = (r: RegisterRecord, k: string, fd: FieldDef) => (fd.type === "computed" && fd.calc ? fd.calc({ ...r.data }) : Number(r.data[k])) || 0;
    return [...out].sort((a, b) => {
      if (sort) {
        const fd = fieldOf(reg, sort.key) ?? ({ type: "text" } as FieldDef);
        const sgn = sort.dir === "asc" ? 1 : -1;
        if (NUMERIC.includes(fd.type)) return sgn * (num(a, sort.key, fd) - num(b, sort.key, fd));
        if (fd.type === "checklist") return sgn * (((a.data[sort.key] ?? []) as unknown[]).length - ((b.data[sort.key] ?? []) as unknown[]).length);
        return sgn * String(valueOf(a, sort.key) ?? "").localeCompare(String(valueOf(b, sort.key) ?? ""));
      }
      const oa = isOpen(reg, a) ? 0 : 1;
      const ob = isOpen(reg, b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (reg.dueKey) {
        const da = a.data[reg.dueKey] || "9999";
        const db = b.data[reg.dueKey] || "9999";
        if (da !== db) return da.localeCompare(db);
      }
      return order.indexOf(a.data[reg.statusKey]) - order.indexOf(b.data[reg.statusKey]) || a.title.localeCompare(b.title);
    });
  }, [rows, reg, chip, q, extra, sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));
  const clear = () => { setChip(""); setQ(""); setExtra({}); };

  return (
    <div className="card">
      <div className="toolbar">
        <input className="input q" type="search" placeholder={`Search ${reg.name.toLowerCase()}`} aria-label={`Search ${reg.name}`} value={q} onChange={(e) => setQ(e.target.value)} />
        {filters.map(({ key, fd, options }) => (
          <select key={key} className="input" aria-label={fd.label} value={extra[key] ?? ""} onChange={(e) => setExtra((x) => ({ ...x, [key]: e.target.value }))}>
            <option value="">{key === "owner_id" ? "Everyone" : `Any ${fd.label.toLowerCase()}`}</option>
            {key === "owner_id" && <option value={NO_OWNER}>No owner</option>}
            {options.map((o) => <option key={o}>{o}</option>)}
          </select>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Filter by status">
        <button type="button" className="chip" aria-pressed={chip === ""} onClick={() => setChip("")}>All<b>{rows.length}</b></button>
        {hasDone && <button type="button" className="chip" aria-pressed={chip === "__open"} onClick={() => setChip("__open")}>Open<b>{rows.filter((r) => isOpen(reg, r)).length}</b></button>}
        {lateN > 0 && <button type="button" className="chip" aria-pressed={chip === "__late"} onClick={() => setChip("__late")}>Overdue<b>{lateN}</b></button>}
        {reg.statuses.map((s) => (
          <button key={s.v} type="button" className="chip" aria-pressed={chip === s.v} onClick={() => setChip(s.v)}>{s.v}<b>{count(s.v)}</b></button>
        ))}
      </div>

      {shown.length === 0 ? (
        rows.length === 0 ? (
          <div className="empty">
            <h3>No {reg.name.toLowerCase()} yet</h3>
            {onNew ? (
              <>
                <p>Add the first {reg.singular} and it will appear here for the whole team.</p>
                <button type="button" className="btn" onClick={onNew}>New {reg.singular}</button>
              </>
            ) : <p>Nothing has been added here yet.</p>}
          </div>
        ) : (
          <div className="empty"><p>Nothing matches these filters.</p><button type="button" className="btn quiet" onClick={clear}>Clear filters</button></div>
        )
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                {reg.columns.map((k) => {
                  const fd = fieldOf(reg, k);
                  const dir = sort?.key === k ? sort.dir : undefined;
                  return (
                    <th key={k} className={fd && NUMERIC.includes(fd.type) ? "num" : ""} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" data-dir={dir} onClick={() => toggleSort(k)}>{fd?.label ?? k}</button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id} tabIndex={0} onClick={() => onOpen(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(r.id); }}
                >
                  {reg.columns.map((k, i) => (
                    <Cell key={k} reg={reg} r={r} k={k} first={i === 0} busy={busyId === r.id} onStatus={onNew ? (v) => onStatus(r, v) : null} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <div className="list-foot"><span>{shown.length === rows.length ? `${rows.length} ${rows.length === 1 ? reg.singular : reg.name.toLowerCase()}` : `Showing ${shown.length} of ${rows.length}`}</span></div>}
    </div>
  );
}
