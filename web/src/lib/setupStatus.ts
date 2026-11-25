import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** Whether the very first administrator still has to be created. */
export function useSetupNeeded() {
  return useQuery({
    queryKey: ["setup"],
    queryFn: () => api<{ needed: boolean }>("GET", "/setup"),
    staleTime: 0,
    retry: false,
  });
}
