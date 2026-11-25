import { createBrowserRouter, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { REGISTERS } from "../../shared/schema";
import { AuthProvider, useAuth } from "./auth";
import { Placeholder } from "./components/Placeholder";
import { Shell } from "./components/Shell";
import { ChangePassword } from "./pages/ChangePassword";
import { Help } from "./pages/Help";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { Tasks } from "./pages/Tasks";
import { useSetupNeeded } from "./lib/setupStatus";

/** Signed-in area. Sends visitors to setup or sign-in, and forces a password change when required. */
function RequireAuth() {
  const { user, loading } = useAuth();
  const setup = useSetupNeeded();
  const location = useLocation();
  if (loading || (!user && setup.isPending)) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (!user) {
    return setup.data?.needed ? <Navigate to="/setup" replace /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Shell />;
}

/** Change-password lives outside the shell but still needs a signed-in user. */
function RequireUser() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function RegisterPage() {
  const { id } = useParams();
  const reg = REGISTERS.find((r) => r.id === id);
  return reg ? <Placeholder title={reg.name} eyebrow="Register" note={reg.intro} /> : <NotFound />;
}

function NotFound() {
  return <Placeholder title="Page not found" note="That page does not exist. Use the menu on the left to find your way." />;
}

export const router = createBrowserRouter([
  {
    element: <AuthProvider />,
    children: [
      { path: "login", element: <Login /> },
      { path: "setup", element: <Setup /> },
      { element: <RequireUser />, children: [{ path: "change-password", element: <ChangePassword /> }] },
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <Home /> },
          { path: "tasks", element: <Tasks /> },
          { path: "registers/:id", element: <RegisterPage /> },
          { path: "people", element: <Placeholder title="People" /> },
          { path: "leave", element: <Placeholder title="Leave" /> },
          { path: "users", element: <Placeholder title="Users" eyebrow="Manage" /> },
          { path: "audit", element: <Placeholder title="Audit log" eyebrow="Administrator" /> },
          { path: "import", element: <Placeholder title="Import" eyebrow="Administrator" /> },
          { path: "settings", element: <Placeholder title="Settings" eyebrow="Administrator" /> },
          { path: "trash", element: <Placeholder title="Trash" eyebrow="Administrator" /> },
          { path: "help", element: <Help /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
