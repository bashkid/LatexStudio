// The one place that talks to the server. Errors carry the server's message and hint, shown as they are.
export class ApiError extends Error {
  constructor(public status: number, message: string, public hint = "") {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data?.detail;
    throw new ApiError(res.status, typeof d === "string" ? d : d?.message ?? "Something went wrong.", d?.hint ?? "");
  }
  return data as T;
}

export const get = <T,>(p: string) => call<T>("GET", p);
export const post = <T,>(p: string, b?: unknown) => call<T>("POST", p, b ?? {});
export const put = <T,>(p: string, b: unknown) => call<T>("PUT", p, b);
export const del = <T,>(p: string) => call<T>("DELETE", p);
export async function upload<T>(path: string, files: File[], fields: Record<string, string> = {}, field = "file"): Promise<T> {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.append(k, v));
  files.forEach((f) => body.append(field, f, f.name));
  const res = await fetch(`/api/v1${path}`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data?.detail;
    throw new ApiError(res.status, typeof d === "string" ? d : d?.message ?? "Upload failed.", d?.hint ?? "");
  }
  return data as T;
}

export type Project = { id: string; name: string; path: string; exists: boolean };
export type Status = { version: string; latex: boolean; latexBin: string; workspace: string };
export type BuildTask = {
  id: string; status: "running" | "done" | "failed" | "stopped"; text: string; elapsed: number;
  error: { message: string; hint: string } | null;
  outcome: { ok: boolean; pdf: boolean; engine: string; seconds: number; error: string; log: string } | null;
} | null;
export type State = {
  id: string; name: string; folder: string; main: string; engine: string; pdf: boolean; pdfMtime: number;
  stale: boolean; running: boolean; latexError: string; build: BuildTask;
};
export type FsList = { path: string; parent: string; dirs: string[]; hasTex: boolean };
