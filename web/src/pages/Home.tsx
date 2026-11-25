import { useAuth } from "../auth";
import { greeting, longDate, useTitle } from "../lib/useTitle";

/** Role dashboards (EmployeeHome, ManagerHome, HrHome, AdminHome) replace the body in later tasks. */
export function Home() {
  const { user } = useAuth();
  useTitle("Home");
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
