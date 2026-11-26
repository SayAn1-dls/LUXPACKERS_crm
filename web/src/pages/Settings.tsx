import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Placeholder } from "../components/Placeholder";
import { useToast } from "../components/Toast";
import { errorText } from "../lib/errors";
import { useTitle } from "../lib/useTitle";

interface Settings { leaveAllowances: Record<"Casual" | "Sick" | "Earned", number>; holidays: string[] }
const KINDS = ["Casual", "Sick", "Earned"] as const;

export function Settings() {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Placeholder title="Settings" eyebrow="Administrator" note="You don't have access to this page." />;
  return <SettingsForm />;
}

const dayLabel = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function SettingsForm() {
  useTitle("Settings");
  const notify = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("GET", "/settings") });
  const [allow, setAllow] = useState<Record<string, string>>({});
  const [allowErr, setAllowErr] = useState("");
  const [newDay, setNewDay] = useState("");
  const [busy, setBusy] = useState<"allow" | "holidays" | null>(null);

  useEffect(() => {
    if (q.data) setAllow(Object.fromEntries(KINDS.map((k) => [k, String(q.data.leaveAllowances[k])])));
  }, [q.data]);

  async function save(body: Partial<Settings>, which: "allow" | "holidays", done: string) {
    setBusy(which);
    try {
      const next = await api<Settings>("PATCH", "/settings", body);
      qc.setQueryData(["settings"], next);
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["leave"] });
      notify(done);
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(null);
    }
  }

  function saveAllowances() {
    const parsed = Object.fromEntries(KINDS.map((k) => [k, allow[k] === "" ? NaN : Number(allow[k])]));
    if (KINDS.some((k) => !Number.isFinite(parsed[k]) || parsed[k] < 0)) return setAllowErr("Use a number that is 0 or more for each kind.");
    setAllowErr("");
    void save({ leaveAllowances: parsed as Settings["leaveAllowances"] }, "allow", "Leave allowances saved.");
  }

  const holidays = q.data?.holidays ?? [];
  function addHoliday() {
    if (!newDay) return notify("Choose a date first.", true);
    if (holidays.includes(newDay)) return notify("That date is already on the list.", true);
    void save({ holidays: [...holidays, newDay].sort() }, "holidays", "Holiday added.").then(() => setNewDay(""));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administrator</div>
          <h1>Settings</h1>
          <p>How much leave each person gets a year, and the days the office is closed.</p>
        </div>
      </div>
      {q.isPending ? (
        <div className="empty">Loading settings…</div>
      ) : q.isError ? (
        <div className="empty"><h3>Could not load settings</h3><p>Refresh the page to try again.</p></div>
      ) : (
        <div className="grid-2">
          <section className="card card-pad">
            <div className="section-head"><h2>Leave allowances</h2></div>
            <p className="muted small" style={{ marginTop: 0 }}>Days each person can take in a calendar year. Unpaid leave has no limit.</p>
            <div className="form">
              {KINDS.map((k) => (
                <div className="field" key={k}>
                  <label className="flabel" htmlFor={`al_${k}`}>{k} leave (days a year)</label>
                  <input id={`al_${k}`} type="number" min={0} step={0.5} inputMode="decimal" className="input" value={allow[k] ?? ""} onChange={(e) => { setAllow((a) => ({ ...a, [k]: e.target.value })); setAllowErr(""); }} />
                </div>
              ))}
            </div>
            {allowErr && <div className="err" role="alert">{allowErr}</div>}
            <button type="button" className="btn" disabled={busy === "allow"} onClick={saveAllowances}>Save allowances</button>
          </section>

          <section className="card card-pad">
            <div className="section-head"><h2>Holidays</h2></div>
            <p className="muted small" style={{ marginTop: 0 }}>Days the office is closed. They are not counted as leave days.</p>
            <div className="actions" style={{ marginBottom: 14 }}>
              <label className="sr-only" htmlFor="hol_new">Holiday date</label>
              <input id="hol_new" type="date" className="input" style={{ width: "auto" }} value={newDay} onChange={(e) => setNewDay(e.target.value)} />
              <button type="button" className="btn" disabled={busy === "holidays"} onClick={addHoliday}>Add holiday</button>
            </div>
            {holidays.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>No holidays yet.</p>
            ) : (
              <ul className="upcoming">
                {holidays.map((h) => (
                  <li key={h}>
                    <span>{dayLabel(h)}</span>
                    <button type="button" className="btn link" disabled={busy === "holidays"} aria-label={`Remove ${dayLabel(h)}`} onClick={() => void save({ holidays: holidays.filter((x) => x !== h) }, "holidays", "Holiday removed.")}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
