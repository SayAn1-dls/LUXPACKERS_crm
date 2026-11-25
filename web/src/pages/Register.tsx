import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { REGISTERS, registerDepts } from "../../../shared/schema";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { NotFound } from "../components/Placeholder";
import { RecordDrawer } from "../components/RecordDrawer";
import { RecordTable } from "../components/RecordTable";
import { useToast } from "../components/Toast";
import { NO_ACCESS, canDeleteIn, summaryOf } from "../lib/registers";
import type { RegisterRecord } from "../lib/registers";
import { CONFLICT_MESSAGE, taskErrorMessage } from "../lib/tasks";
import type { Person } from "../lib/tasks";
import { useTitle } from "../lib/useTitle";

export function Register() {
  const { id } = useParams();
  const reg = REGISTERS.find((r) => r.id === id);
  return reg ? <RegisterView key={reg.id} id={reg.id} /> : <NotFound />;
}

function RegisterView({ id }: { id: string }) {
  const reg = REGISTERS.find((r) => r.id === id)!;
  const { user } = useAuth();
  const notify = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  useTitle(reg.name);

  const q = useQuery({
    queryKey: ["records", id],
    queryFn: () => api<{ rows: RegisterRecord[] }>("GET", `/records/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  });
  const peopleQ = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: Person[] }>("GET", "/people"), staleTime: 5 * 60_000 });
  const people = useMemo(() => (peopleQ.data?.people ?? []).filter((p) => p.status !== "left"), [peopleQ.data]);

  const rows = q.data?.rows ?? [];
  const openId = params.get("open");
  const record = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const dept = registerDepts(id);

  // A deep link to a record that is gone (or never was) just opens the register.
  useEffect(() => {
    if (openId && q.isSuccess && !q.isFetching && !record) {
      notify("That record is no longer here.", true);
      setParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }, { replace: true });
    }
  }, [openId, q.isSuccess, q.isFetching, record, notify, setParams]);

  const close = useCallback(() => {
    setCreating(false);
    setParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }, { replace: true });
  }, [setParams]);
  const open = (rid: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("open", rid); return n; });

  const reload = async () => {
    setConflict(false);
    await qc.invalidateQueries({ queryKey: ["records", id] });
  };

  async function quickStatus(row: RegisterRecord, value: string) {
    if (row.data[reg.statusKey] === value) return;
    setBusyId(row.id);
    try {
      await api("PATCH", `/records/${id}/${row.id}`, { version: row.version, data: { [reg.statusKey]: value } });
      await Promise.all(["records", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      notify("Status updated.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      notify(e instanceof ApiError && e.status === 403 ? "You don't have permission to do that." : taskErrorMessage(e), true);
    } finally {
      setBusyId(null);
    }
  }

  if (q.isError && q.error instanceof ApiError && q.error.status === 403) {
    return (
      <div className="page-head"><div><div className="eyebrow">Register</div><h1>{reg.name}</h1><p>{NO_ACCESS}</p></div></div>
    );
  }

  const summary = summaryOf(reg, rows);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{dept.length === 1 ? `Register · ${dept[0]}` : "Register · all departments"}</div>
          <h1>{reg.name}</h1>
          <p>{reg.intro}{summary && <><br /><span style={{ color: "var(--text)" }}>{summary}</span></>}</p>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => setCreating(true)}>New {reg.singular}</button></div>
      </div>
      {reg.id === "access" && (
        <div className="notice red"><b>Never write a password, OTP, API key or card number in this CRM.</b> Record only who holds a login and where it is kept.</div>
      )}
      {conflict && !openId && !creating && (
        <div className="notice red" role="alert">
          {CONFLICT_MESSAGE}{" "}
          <button type="button" className="btn quiet" style={{ marginLeft: 8, minHeight: 36 }} onClick={() => void reload()}>Reload</button>
        </div>
      )}
      {q.isPending ? (
        <div className="empty">Loading {reg.name.toLowerCase()}…</div>
      ) : q.isError ? (
        <div className="empty"><h3>Could not load {reg.name.toLowerCase()}</h3><p>{q.error.message}</p></div>
      ) : (
        <RecordTable register={reg} rows={rows} onOpen={open} onNew={() => setCreating(true)} onStatus={(r, v) => void quickStatus(r, v)} busyId={busyId} />
      )}
      {(record || creating) && user && (
        <RecordDrawer
          key={record?.id ?? "new"} register={reg} record={record} people={people} canDelete={canDeleteIn(user, id)}
          conflict={conflict} onConflict={() => setConflict(true)} onReload={() => void reload()} onClose={close}
        />
      )}
    </>
  );
}
