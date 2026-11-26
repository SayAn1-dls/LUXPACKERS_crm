import { NavLink } from "react-router-dom";
import { REGISTERS } from "../../../shared/schema";
import { useAuth, type User } from "../auth";
import { canAddPeople, canReadRegister, canSeePeoplePrivate } from "../lib/perms";
import { Icon, type IconName } from "./Icon";

interface Item { to: string; label: string; icon: IconName; end?: boolean }
interface Group { title: string; items: Item[] }

/** The menu is built only from the person's position. The server is still the real gate. */
export function navFor(user: User): Group[] {
  const groups: Group[] = [
    {
      title: "Work",
      items: [
        { to: "/", label: "Home", icon: "home", end: true },
        { to: "/tasks", label: "My tasks", icon: "tasks" },
        { to: "/leave", label: "Leave", icon: "leave" },
      ],
    },
  ];

  const registers = REGISTERS.filter((r) => canReadRegister(user, r.id));
  if (registers.length) groups.push({ title: "Registers", items: registers.map((r) => ({ to: `/registers/${r.id}`, label: r.name, icon: "folder" })) });

  if (canSeePeoplePrivate(user) || canAddPeople(user)) groups.push({ title: "Team", items: [{ to: "/people", label: "People", icon: "people" }] });

  if (user.isAdmin) {
    groups.push({
      title: "Admin",
      items: [
        { to: "/positions", label: "Positions", icon: "badge" },
        { to: "/users", label: "People & logins", icon: "key" },
        { to: "/import", label: "Import", icon: "upload" },
        { to: "/audit", label: "Audit log", icon: "log" },
        { to: "/trash", label: "Trash", icon: "trash" },
        { to: "/settings", label: "Settings", icon: "settings" },
      ],
    });
  }
  return groups;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <aside className={`side${open ? " open" : ""}`} id="side">
      <div className="wordmark">
        Luxpackers<small>Operations desk</small>
      </div>
      <nav aria-label="Main menu" className="nav-wrap">
        {navFor(user).map((g) => (
          <div className={`nav-group g-${g.title.toLowerCase()}`} key={g.title}>
            <div className="nav-title">{g.title}</div>
            <div className="nav">
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate}>
                  <span className="nav-ico"><Icon name={it.icon} size={16} /></span>
                  <span>{it.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <div className="me">
          <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          <div>
            <b>{user.name}</b>
            <span>{user.positionName ?? (user.isAdmin ? "Administrator" : "No position yet")}</span>
          </div>
        </div>
        <div className="side-links">
          <NavLink to="/help" onClick={onNavigate}><Icon name="help" size={16} />How to use</NavLink>
          <button type="button" onClick={() => void signOut()}><Icon name="signOut" size={16} />Sign out</button>
        </div>
      </div>
    </aside>
  );
}
