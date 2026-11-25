import { useAuth } from "../auth";
import { EmployeeHome } from "../dashboards/EmployeeHome";
import { ManagerHome } from "../dashboards/ManagerHome";
import { greeting, longDate, useTitle } from "../lib/useTitle";

/** The home page depends on the role. HR and admin dashboards arrive in later tasks. */
export function Home() {
  const { user } = useAuth();
  useTitle("Home");
  if (user?.role === "employee") return <EmployeeHome />;
  if (user?.role === "manager") return <ManagerHome />;
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{longDate()}</div>
        <h1>{greeting()}, {user?.name.split(" ")[0]}</h1>
        <p>Your day at a glance will appear here soon.</p>
      </div>
    </div>
  );
}
