import type { FieldDef, RegisterDef } from "../../../shared/schema";
import { money } from "../lib/registers";
import type { RecordLink } from "../lib/registers";
import type { Person } from "../lib/tasks";

/** Form values: numbers are kept as the text typed, converted when saving. */
export type Draft = Record<string, any>;

interface Props {
  register: RegisterDef;
  draft: Draft;
  set: (key: string, value: unknown) => void;
  people: Person[];
  /** Name to show if the current owner is no longer in the list. */
  ownerName: string | null;
  errors: Record<string, string>;
}

export function RecordFields({ register: reg, draft, set, people, ownerName, errors }: Props) {
  return (
    <div className="form">
      {reg.fields.map((f) => <Field key={f.key} reg={reg} f={f} draft={draft} set={set} people={people} ownerName={ownerName} err={errors[f.key]} />)}
    </div>
  );
}

function Field({ reg, f, draft, set, people, ownerName, err }: { reg: RegisterDef; f: FieldDef; draft: Draft; set: Props["set"]; people: Person[]; ownerName: string | null; err?: string }) {
  const id = `f_${f.key}`;
  const v = draft[f.key];
  const wide = f.wide || ["textarea", "links", "checklist", "status"].includes(f.type);
  const cls = `field${wide ? " wide" : ""}`;
  const req = f.required ? " *" : "";
  const bad = err ? { "aria-invalid": true, "aria-describedby": `${id}_err` } : {};
  const tail = (
    <>
      {f.help && <span className="help">{f.help}</span>}
      {err && <span className="err" id={`${id}_err`}>{err}</span>}
    </>
  );
  const labelled = (control: React.ReactNode) => (
    <div className={cls}>
      <label className="flabel" htmlFor={id}>{f.label}{req}</label>
      {control}
      {tail}
    </div>
  );

  switch (f.type) {
    case "textarea":
      return labelled(<textarea id={id} className="input" value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} {...bad} />);
    case "select":
      return labelled(
        <select id={id} className="input" value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} {...bad}>
          <option value="">—</option>
          {v && !f.options?.includes(v) && <option value={v}>{v}</option>}
          {f.options?.map((o) => <option key={o}>{o}</option>)}
        </select>,
      );
    case "person":
      return labelled(
        <select id={id} className="input" value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} {...bad}>
          <option value="">No owner yet</option>
          {v && !people.some((p) => p.id === v) && <option value={v}>{ownerName ?? "Former team member"}</option>}
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>,
      );
    case "date":
      return labelled(<input id={id} type="date" className="input" value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} {...bad} />);
    case "money":
    case "number":
      return labelled(<input id={id} type="number" inputMode="numeric" min={0} step={1} className="input" value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} {...bad} />);
    case "email":
      return labelled(<input id={id} type="email" className="input" value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} {...bad} />);
    case "computed": {
      const x = f.calc ? f.calc(numeric(reg, draft)) : 0;
      return labelled(<div className="readonly" id={id}>{f.format === "money" ? money(x) || "₹0" : x}</div>);
    }
    case "status": {
      const hint = reg.statuses.find((s) => s.v === v)?.hint;
      return (
        <div className="field wide">
          <span className="flabel">{f.label}</span>
          <div className="statuses" role="radiogroup" aria-label={f.label}>
            {reg.statuses.map((s) => (
              <label key={s.v} title={s.hint}>
                <input type="radio" name={id} checked={v === s.v} onChange={() => set(f.key, s.v)} />
                <span className={`pill tone-${s.tone}`}>{s.v}</span>
              </label>
            ))}
          </div>
          {hint && <span className="help">{hint}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      );
    }
    case "checklist": {
      const on: string[] = v ?? [];
      return (
        <div className="field wide">
          <span className="flabel">{f.label}</span>
          <div className="checks">
            {f.options?.map((o) => (
              <label className="check" key={o}>
                <input type="checkbox" checked={on.includes(o)} onChange={(e) => set(f.key, e.target.checked ? [...on, o] : on.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </div>
        </div>
      );
    }
    case "links":
      return <LinksField f={f} links={v ?? []} set={(l) => set(f.key, l)} err={err} />;
    default:
      return labelled(<input id={id} className="input" value={v ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} {...bad} />);
  }
}

/** Calc functions expect numbers; the draft holds the text typed. */
function numeric(reg: RegisterDef, d: Draft): Draft {
  const out: Draft = { ...d };
  for (const f of reg.fields) if ((f.type === "money" || f.type === "number") && d[f.key] !== "" && d[f.key] != null) out[f.key] = Number(d[f.key]) || 0;
  return out;
}

function LinksField({ f, links, set, err }: { f: FieldDef; links: RecordLink[]; set: (l: RecordLink[]) => void; err?: string }) {
  const change = (i: number, patch: Partial<RecordLink>) => set(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="field wide">
      <span className="flabel">{f.label}</span>
      <div className="links-edit">
        {links.map((l, i) => (
          <div className="link-row" key={i}>
            <input className="input" placeholder="Name, e.g. Quote PDF" aria-label={`Link ${i + 1} name`} value={l.label} onChange={(e) => change(i, { label: e.target.value })} />
            <input className="input" placeholder="https://" type="url" aria-label={`Link ${i + 1} address`} value={l.url} onChange={(e) => change(i, { url: e.target.value })} />
            <button type="button" className="x" aria-label={`Remove link ${i + 1}`} onClick={() => set(links.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div><button type="button" className="btn quiet" onClick={() => set([...links, { label: "", url: "" }])}>Add a link</button></div>
      </div>
      {err && <span className="err">{err}</span>}
      {f.help && <span className="help">{f.help}</span>}
    </div>
  );
}
