import { useAuth } from "../auth";
import { AdminHome } from "../dashboards/AdminHome";
import { StaffHome } from "../dashboards/StaffHome";

/** The administrator gets the company overview; everyone else gets sections chosen by their position. */
export function Home() {
  const { user } = useAuth();
  return user?.isAdmin ? <AdminHome /> : <StaffHome />;
}
