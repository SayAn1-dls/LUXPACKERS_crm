import { useAuth } from "../auth";
import { AdminHome } from "../dashboards/AdminHome";
import { EmployeeHome } from "../dashboards/EmployeeHome";
import { HrHome } from "../dashboards/HrHome";
import { ManagerHome } from "../dashboards/ManagerHome";

/** The home page depends on the role. */
export function Home() {
  const { user } = useAuth();
  if (user?.role === "admin") return <AdminHome />;
  if (user?.role === "hr") return <HrHome />;
  if (user?.role === "manager") return <ManagerHome />;
  return <EmployeeHome />;
}
