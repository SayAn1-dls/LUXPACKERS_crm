import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { NotFound } from "./components/Placeholder";
import { Shell } from "./components/Shell";
import { Account } from "./pages/Account";
import { Audit } from "./pages/Audit";
import { Help } from "./pages/Help";
import { Home } from "./pages/Home";
import { Import } from "./pages/Import";
import { Leave } from "./pages/Leave";
import { Login } from "./pages/Login";
import { LoginCode } from "./pages/LoginCode";
import { People } from "./pages/People";
import { Positions } from "./pages/Positions";
import { Register } from "./pages/Register";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Tasks } from "./pages/Tasks";
import { Trash } from "./pages/Trash";
import { TwoStepSetup } from "./pages/TwoStepSetup";
import { Users } from "./pages/Users";
import { Waiting } from "./pages/Waiting";
import { useSetupNeeded } from "./lib/setupStatus";

/** Signed-in area. Sends visitors to setup or sign-in; people waiting for approval see only the waiting page. */
function RequireAuth() {
  const { user, loading } = useAuth();
  const setup = useSetupNeeded();
  const location = useLocation();
  if (loading || (!user && setup.isPending)) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (!user) {
    return setup.data?.needed ? <Navigate to="/setup" replace /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.approval !== "approved") return <Waiting />;
  if (user.mfaRequired && !user.mfaEnabled) return <Navigate to="/account/two-step" replace />;
  return <Shell />;
}

/** Two-step enrolment lives outside the shell but still needs a signed-in user who has been let in. */
function RequireUser() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty" style={{ paddingTop: "30vh" }}>Opening the Luxpackers desk…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return user.approval === "approved" ? <Outlet /> : <Waiting />;
}

export const router = createBrowserRouter([
  {
    element: <AuthProvider />,
    children: [
      { path: "login", element: <Login /> },
      { path: "login/code", element: <LoginCode /> },
      { path: "setup", element: <Setup /> },
      {
        element: <RequireUser />,
        children: [
          { path: "account/two-step", element: <TwoStepSetup /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <Home /> },
          { path: "tasks", element: <Tasks /> },
          { path: "registers/:id", element: <Register /> },
          { path: "people", element: <People /> },
          { path: "leave", element: <Leave /> },
          { path: "users", element: <Users /> },
          { path: "positions", element: <Positions /> },
          { path: "audit", element: <Audit /> },
          { path: "import", element: <Import /> },
          { path: "settings", element: <Settings /> },
          { path: "trash", element: <Trash /> },
          { path: "help", element: <Help /> },
          { path: "account", element: <Account /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
