import { NavLink } from "react-router-dom";
import { REGISTERS, registerDepts } from "../../../shared/schema";
import { useAuth, type User } from "../auth";

interface Item { to: string; label: string; end?: boolean }
interface Group { title?: string; items: Item[] }

const ROLE_LABEL: Record<User["role"], string> = {
  admin: "Administrator",
  manager: "Manager",
  hr: "People & HR",
  employee: "Team member",
};

/** What each role sees in the menu. The server is still the real gate. */
export function navFor(user: User): Group[] {
  const groups: Group[] = [
    {
      items: [
        { to: "/", label: "Home", end: true },
        { to: "/tasks", label: "My tasks" },
        { to: "/leave", label: "Leave" },
        { to: "/people", label: "People" },
      ],
    },
  ];

  const registers = REGISTERS.filter((r) => user.role === "admin" || registerDepts(r.id).includes(user.dept));
  if (registers.length) groups.push({ title: "Registers", items: registers.map((r) => ({ to: `/registers/${r.id}`, label: r.name })) });

  if (user.role === "admin") {
    groups.push({
      title: "Manage",
      items: [
        { to: "/users", label: "Users" },
        { to: "/import", label: "Import" },
        { to: "/audit", label: "Audit log" },
        { to: "/trash", label: "Trash" },
        { to: "/settings", label: "Settings" },
      ],
    });
  } else if (user.role === "hr") {
    groups.push({ title: "Manage", items: [{ to: "/users", label: "Users" }] });
  }

  groups.push({ items: [{ to: "/help", label: "How to use" }] });
  return groups;
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <aside className={`side${open ? " open" : ""}`} id="side">
      <div className="wordmark">
        Luxpackers<small>Operations desk</small>
      </div>
      <nav aria-label="Main menu" className="nav-wrap">
        {navFor(user).map((g, i) => (
          <div className="nav-group" key={g.title ?? i}>
            {g.title && <div className="nav-title">{g.title}</div>}
            <div className="nav">
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate}>
                  <span>{it.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <b>{user.name}</b>
        {ROLE_LABEL[user.role]} · {user.dept}
        <div>
          <button type="button" className="btn link" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
    </aside>
  );
}
