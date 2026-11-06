import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as api from "../api";
import { projectsQuery, queryClient, statusQuery } from "../query";
import { ErrorNote, Modal } from "../components/ui";

/** The start page: your projects, a new one, a folder from this computer, or an Overleaf download. */
export default function Home() {
  const nav = useNavigate();
  const projects = useQuery(projectsQuery);
  const status = useQuery(statusQuery);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const opened = (p: api.Project) => { void queryClient.invalidateQueries({ queryKey: ["projects"] }); nav(`/p/${p.id}`); };

  // the system's own chooser (the server runs on this computer); the in-page folder list is the fallback
  const choose = useMutation({
    mutationFn: async (kind: "file" | "folder") => {
      try {
        const { path } = await api.post<{ path: string }>("/pick", { kind });
        if (!path) return null;
        return await api.post<api.Project>("/projects/open-path", { path });
      } catch (e) {
        if (kind === "folder" && !(e instanceof api.ApiError && e.status === 400 && /could not|cannot|Choose/.test(e.message))) setPicking(true);
        else throw e;
        return null;
      }
    },
    onSuccess: (p) => { if (p) opened(p); },
  });
  const create = useMutation({ mutationFn: () => api.post<api.Project>("/projects/new", { name }), onSuccess: opened });
  const importZip = useMutation({ mutationFn: (f: File) => api.upload<api.Project>("/projects/import", [f]), onSuccess: opened });
  const forget = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
  const toggleTheme = () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("ls.theme", dark ? "dark" : "light"); } catch { /* optional */ }
  };

  return (
    <main className="home">
      <header className="home-head">
        <h1><span className="home-logo">Tx</span> LaTeX Studio</h1>
        <button className="link" onClick={toggleTheme} aria-label="Switch between light and dark">◐ Theme</button>
      </header>
      {status.data && !status.data.latex && (
        <div className="alert" role="alert">LaTeX is not installed on this computer, so projects can be edited but not compiled.
          <small>Install MacTeX (brew install --cask mactex-no-gui) or TeX Live, then reload this page.</small></div>
      )}
      <div className="home-actions">
        <button className="primary" onClick={() => setNaming(true)}>＋ New project</button>
        <button onClick={() => choose.mutate("file")} disabled={choose.isPending}>📄 Open a file…</button>
        <button onClick={() => choose.mutate("folder")} disabled={choose.isPending}>📂 Open a folder…</button>
        <button onClick={() => fileRef.current?.click()} disabled={importZip.isPending}>{importZip.isPending ? "Importing…" : "⬆ Import an Overleaf zip"}</button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden
               onChange={(e) => { const f = e.target.files?.[0]; if (f) importZip.mutate(f); e.target.value = ""; }} />
      </div>
      <ErrorNote error={create.error ?? choose.error ?? importZip.error ?? forget.error} />
      <p className="muted small">In Overleaf: Menu → Download → Source. Everything stays on this computer; nothing is uploaded anywhere.</p>

      <h2>Projects</h2>
      {projects.isPending && <p className="muted">Loading…</p>}
      {projects.data?.length === 0 && <p className="muted">No project yet. Create one, open a folder or import a zip.</p>}
      <ul className="home-list">
        {(projects.data ?? []).map((p) => (
          <li key={p.id} className={p.exists ? "" : "gone"}>
            {p.exists ? <Link to={`/p/${p.id}`} className="home-open"><b>{p.name}</b><small>{p.path}</small></Link>
                      : <span className="home-open"><b>{p.name}</b><small>{p.path} — folder not found</small></span>}
            <button className="link" onClick={() => { if (window.confirm(`Remove “${p.name}” from this list? Its files stay on disk.`)) forget.mutate(p.id); }}
                    aria-label={`Remove ${p.name} from the list`}>Remove</button>
          </li>
        ))}
      </ul>

      {naming && (
        <Modal title="New project" onClose={() => setNaming(false)}>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <label>Name<br /><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My thesis" style={{ width: "100%" }} /></label>
            <p className="muted small">Created in {status.data?.workspace ?? "your LatexStudio folder"} with a starter main.tex.</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" disabled={!name.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={() => setNaming(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
      {picking && <FolderPicker onClose={() => setPicking(false)} onOpened={opened} />}
    </main>
  );
}

/** Browse the folders of this computer (the server runs here) and open one that holds a LaTeX project. */
function FolderPicker({ onClose, onOpened }: { onClose: () => void; onOpened: (p: api.Project) => void }) {
  const [path, setPath] = useState("");
  const list = useQuery({ queryKey: ["fs", path], queryFn: () => api.get<api.FsList>(`/fs?path=${encodeURIComponent(path)}`), staleTime: 0 });
  const open = useMutation({ mutationFn: (p: string) => api.post<api.Project>("/projects/open", { path: p }), onSuccess: onOpened });
  const here = list.data?.path ?? "";
  return (
    <Modal title="Open a folder" onClose={onClose}>
      <p className="small"><code>{here}</code></p>
      <ErrorNote error={list.error ?? open.error} />
      <ul className="home-fs">
        {list.data?.parent && <li><button className="link" onClick={() => setPath(list.data!.parent)}>↑ Up</button></li>}
        {(list.data?.dirs ?? []).map((d) => <li key={d}><button className="link" onClick={() => setPath(`${here}/${d}`)}>📁 {d}</button></li>)}
      </ul>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" disabled={!list.data?.hasTex || open.isPending} onClick={() => open.mutate(here)}
                title={list.data?.hasTex ? "" : "This folder has no .tex file"}>Open this folder</button>
        <button onClick={onClose}>Cancel</button>
      </div>
      {list.data && !list.data.hasTex && <p className="muted small">Choose the folder that contains your main .tex file.</p>}
    </Modal>
  );
}
