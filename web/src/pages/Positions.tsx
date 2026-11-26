import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Empty, Icon } from "../components/Icon";
import { Placeholder } from "../components/Placeholder";
import { PositionDrawer } from "../components/PositionDrawer";
import { permsSummary, usePositions } from "../lib/positions";
import { useTitle } from "../lib/useTitle";

export function Positions() {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Placeholder title="Positions" eyebrow="Admin" note="You don't have access to this page." />;
  return <PositionList />;
}

function PositionList() {
  useTitle("Positions");
  const [params, setParams] = useSearchParams();
  const q = usePositions();
  const list = q.data?.positions ?? [];
  const openId = params.get("open");
  const creating = params.get("new") === "1";
  const open = openId ? list.find((p) => p.id === openId) ?? null : null;
  const show = (k: "open" | "new", v: string | null) =>
    setParams((p) => { const n = new URLSearchParams(p); n.delete("open"); n.delete("new"); if (v) n.set(k, v); return n; }, { replace: !v });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Positions</h1>
          <p>A position decides what someone can open: which tasks they see, whose leave they approve and which registers are in their menu. Give each person one position.</p>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => show("new", "1")}><Icon name="plus" size={16} />Create a position</button></div>
      </div>
      {q.isPending ? (
        <div className="card"><Empty icon="badge">Loading positions…</Empty></div>
      ) : q.isError ? (
        <div className="card"><Empty icon="badge" title="Could not load positions"><p>Refresh the page to try again.</p></Empty></div>
      ) : (
        <ul className="tiles">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" className="tile" onClick={() => show("open", p.id)}>
                <span className="tile-top">
                  <span className="tile-icon"><Icon name={p.isAdmin ? "key" : "badge"} /></span>
                  <span className="tile-name">{p.name}</span>
                  {p.builtIn && <span className="tag"><Icon name="lock" size={12} />Built in</span>}
                </span>
                <span className="tile-sum">{permsSummary(p)}</span>
                <span className="tile-foot">{p.memberCount === 0 ? "No one yet" : `${p.memberCount} ${p.memberCount === 1 ? "person" : "people"}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(open || creating) && <PositionDrawer key={open?.id ?? "new"} position={open} onClose={() => show("open", null)} />}
    </>
  );
}
