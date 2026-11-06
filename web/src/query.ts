import { QueryClient } from "@tanstack/react-query";
import * as api from "./api";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: true } },
});

export const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
export const stateQuery = (id: string) => ({
  queryKey: ["state", id],
  queryFn: () => api.get<api.State>(projectPath(id)),
  refetchInterval: (q: { state: { data?: api.State } }) => (q.state.data?.running ? 1000 : false) as number | false,
});
export const projectsQuery = { queryKey: ["projects"], queryFn: () => api.get<api.Project[]>("/projects") };
export const statusQuery = { queryKey: ["status"], queryFn: () => api.get<api.Status>("/status"), staleTime: 60_000 };
