import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { NotFound } from "./components/Placeholder";
import { Shell } from "./components/Shell";
import { ChangePassword } from "./pages/ChangePassword";
import { Audit } from "./pages/Audit";
import { Help } from "./pages/Help";
import { Home } from "./pages/Home";
import { Import } from "./pages/Import";
import { Leave } from "./pages/Leave";
import { Login } from "./pages/Login";
import { People } from "./pages/People";
import { Register } from "./pages/Register";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Tasks } from "./pages/Tasks";
import { Trash } from "./pages/Trash";
import { Users } from "./pages/Users";
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
          { path: "registers/:id", element: <Register /> },
          { path: "people", element: <People /> },
          { path: "leave", element: <Leave /> },
          { path: "users", element: <Users /> },
          { path: "audit", element: <Audit /> },
          { path: "import", element: <Import /> },
          { path: "settings", element: <Settings /> },
          { path: "trash", element: <Trash /> },
          { path: "help", element: <Help /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
