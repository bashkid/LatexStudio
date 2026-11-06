import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api";
import Icon from "./Icons";
import { Modal } from "./ui";

type Entry = { path: string; kind: "file" | "dir"; size: number; editable: boolean };
type Target = { path: string; kind: "file" | "dir" } | null;
type Dialog = { type: "rename" | "file" | "folder" | "delete"; target: Target; dir: string } | null;
const PROTECTED = ["main.tex", "references.bib"];

/** The paper's files and folders as a tree, with a right-click menu: Rename, Download, Delete, New file, New folder, Upload. */
export default function FileExplorerTree({ base, name, file, isDirty, openTab, onRenamed, onDeleted }: {
  base: string; name: string; file: string; isDirty: (f: string) => boolean;
  openTab: (f: string) => void; onRenamed: (from: string, to: string) => void; onDeleted: (path: string) => void;
}) {
  const qc = useQueryClient();
  const key = ["paper-files", name];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ entries: Entry[] }>(`${base}/files`), staleTime: 5_000 });
  const entries = q.data?.entries ?? [];
  const [opened, setOpened] = useState<Set<string>>(new Set());          // folders start collapsed
  const [menu, setMenu] = useState<{ x: number; y: number; target: Target } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const uploadDir = useRef("");

  useEffect(() => {
    if (!menu) return;
    const away = () => setMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("blur", away);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("blur", away); };
  }, [menu]);

  const dirOf = (p: string) => p.split("/").slice(0, -1).join("/");
  const showFolder = (d: string) => setOpened((c) => { const n = new Set(c); d.split("/").forEach((_x, i, a) => n.add(a.slice(0, i + 1).join("/"))); return n; });
  const folderFor = (t: Target) => (!t ? "" : t.kind === "dir" ? t.path : dirOf(t.path));
  const put = (r: { entries: Entry[] }) => qc.setQueryData(key, { entries: r.entries });
  const refreshSource = () => void qc.invalidateQueries({ queryKey: ["source", name] });

  const open = (e: React.MouseEvent, target: Target) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, target }); };
  const ask = (type: NonNullable<Dialog>["type"], target: Target) => {
    setMenu(null); setErr("");
    setValue(type === "rename" && target ? target.path.split("/").pop() ?? "" : "");
    setDialog({ type, target, dir: folderFor(target) });
  };
  const run = async () => {
    if (!dialog) return;
    setBusy(true); setErr("");
    try {
      const dir = dialog.dir ? `${dialog.dir}/` : "";
      if (dialog.type === "file" || dialog.type === "folder") {
        const path = `${dir}${value.trim()}`;
        const r = await api.post<{ path: string; entries: Entry[] }>(`${base}/files/new`, { path, kind: dialog.type });
        put(r); refreshSource();
        if (dir) showFolder(dialog.dir);
        if (dialog.type === "file" && /\.(tex|bib|sty|cls|bst|txt|md|csv|json)$/i.test(r.path)) openTab(r.path);
      } else if (dialog.type === "rename" && dialog.target) {
        const to = `${dirOf(dialog.target.path) ? dirOf(dialog.target.path) + "/" : ""}${value.trim()}`;
        const r = await api.post<{ path: string; entries: Entry[] }>(`${base}/files/rename`, { path: dialog.target.path, to });
        put(r); refreshSource(); onRenamed(dialog.target.path, r.path);
      } else if (dialog.type === "delete" && dialog.target) {
        const r = await api.del<{ entries: Entry[] }>(`${base}/files?path=${encodeURIComponent(dialog.target.path)}`);
        put(r); refreshSource(); onDeleted(dialog.target.path);
      }
      setDialog(null);
    } catch (e) {
      setErr((e as { message?: string }).message ?? "That did not work.");
    } finally { setBusy(false); }
  };
  const download = (t: NonNullable<Target>) => {
    setMenu(null);
    const a = document.createElement("a");
    a.href = `/api/v1${base}/files/download?path=${encodeURIComponent(t.path)}`;
    a.download = t.path.split("/").pop() ?? "file";
    a.click();
  };
  const startUpload = (t: Target) => { setMenu(null); uploadDir.current = folderFor(t); upload.current?.click(); };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setNotice("");
    try {
      for (const f of Array.from(files)) {
        if (/\.zip$/i.test(f.name)) {                          // a zip is unpacked into the folder, as in Overleaf
          const z = await api.upload<{ written: string[]; entries: Entry[] }>(`${base}/files/import-zip?folder=${encodeURIComponent(uploadDir.current)}`, [f], {}, "file");
          put(z);
          setNotice(`Unpacked ${z.written.length} file${z.written.length === 1 ? "" : "s"} from ${f.name}.`);
          void qc.invalidateQueries({ queryKey: ["symbols", name] });
          continue;
        }
        const r = await api.upload<{ path: string; entries: Entry[] }>(`${base}/files/upload?folder=${encodeURIComponent(uploadDir.current)}`, [f], {}, "file");
        put(r);
      }
      if (uploadDir.current) showFolder(uploadDir.current);
      refreshSource();
    } catch (e) { setNotice((e as { message?: string }).message ?? "The upload failed."); }
    if (upload.current) upload.current.value = "";
  };

  const row = (e: Entry, depth: number) => {
    const label = e.path.split("/").pop() ?? e.path;
    if (e.kind === "dir") {
      const openDir = opened.has(e.path);
      return (
        <button key={e.path} className="ol-exfolder" aria-expanded={openDir} style={{ paddingLeft: 8 + depth * 14 }}
                onContextMenu={(ev) => open(ev, { path: e.path, kind: "dir" })}
                onClick={() => setOpened((c) => { const n = new Set(c); if (n.has(e.path)) n.delete(e.path); else n.add(e.path); return n; })}>
          <Icon name={openDir ? "chevronDown" : "right"} size={13} /> {label}
        </button>
      );
    }
    return (
      <button key={e.path} role="treeitem" aria-selected={e.path === file} className={`ol-exitem${e.path === file ? " on" : ""}`}
              style={{ paddingLeft: 10 + depth * 14 }} title={e.path}
              onContextMenu={(ev) => open(ev, { path: e.path, kind: "file" })}
              onClick={() => openTab(e.path)}>
        <Icon name={e.path.endsWith(".bib") ? "book" : /\.(png|jpe?g|webp|svg)$/i.test(e.path) ? "image" : "file"} size={14} />
        <span className="ol-filename">{label}</span>
        {isDirty(e.path) && <i className="ol-dot" title="Unsaved changes" />}
      </button>
    );
  };
  const needle = find.trim().toLowerCase();
  const hits = needle ? new Set(entries.filter((e) => e.path.toLowerCase().includes(needle)).map((e) => e.path)) : null;
  // the tree in reading order: a folder is followed by its own contents (folders first, then files, by name), not by the
  // contents of every folder at the end of the list
  const byParent = new Map<string, Entry[]>();
  for (const e of entries) {
    const d = dirOf(e.path);
    byParent.set(d, [...(byParent.get(d) ?? []), e]);
  }
  const order = (d: string): Entry[] => {
    const kids = (byParent.get(d) ?? []).slice().sort((x, y) => (x.kind === y.kind ? x.path.toLowerCase().localeCompare(y.path.toLowerCase()) : x.kind === "dir" ? -1 : 1));
    const out: Entry[] = [];
    for (const e of kids) {
      if (hits) {
        const keep = hits.has(e.path) || (e.kind === "dir" && Array.from(hits).some((h) => h.startsWith(e.path + "/")));
        if (!keep) continue;
        out.push(e);
        if (e.kind === "dir") out.push(...order(e.path));            // searching: every folder on the way is open
      } else {
        out.push(e);
        if (e.kind === "dir" && opened.has(e.path)) out.push(...order(e.path));
      }
    }
    return out;
  };
  const visible = order("");

  const protectedPath = (t: Target) => !!t && PROTECTED.includes(t.path);
  return (
    <>
      <div className="ol-exsearch" role="search">
        <Icon name="search" size={13} />
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search files" aria-label="Search files"
               onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setFind(""); } }} />
        {find && <button aria-label="Clear the search" onClick={() => setFind("")}><Icon name="close" size={12} /></button>}
      </div>
      <div className="ol-extree" role="tree" onContextMenu={(ev) => open(ev, null)}>
        {needle && visible.length === 0 && <p className="muted small" style={{ padding: "6px 12px" }}>No file matches “{find}”.</p>}
        {visible.map((e) => row(e, e.path.split("/").length - 1))}
        {q.isPending && <p className="muted small" style={{ padding: 10 }}>Loading…</p>}
        {notice && <p className="ol-newerr" style={{ padding: "0 10px" }} role="alert">{notice}</p>}
      </div>
      <input ref={upload} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      {menu && (
        <ul className="ol-ctxmenu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 280) }}
            onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          {menu.target && <>
            <li><button role="menuitem" disabled={protectedPath(menu.target)} onClick={() => ask("rename", menu.target)}>Rename</button></li>
            <li><button role="menuitem" onClick={() => download(menu.target!)}>Download</button></li>
            <li className="sep" />
            <li><button role="menuitem" disabled={protectedPath(menu.target)} onClick={() => ask("delete", menu.target)}>Delete</button></li>
            <li className="sep" />
          </>}
          <li><button role="menuitem" onClick={() => ask("file", menu.target)}>New file</button></li>
          <li><button role="menuitem" onClick={() => ask("folder", menu.target)}>New folder</button></li>
          <li><button role="menuitem" onClick={() => startUpload(menu.target)} title="Files, or a .zip that is unpacked here">Upload</button></li>
        </ul>
      )}
      {dialog && (
        <Modal title={dialog.type === "rename" ? "Rename" : dialog.type === "delete" ? "Delete" : dialog.type === "file" ? "New file" : "New folder"} onClose={() => setDialog(null)}>
          {dialog.type === "delete" ? (
            <p>Delete <b>{dialog.target?.path}</b>{dialog.target?.kind === "dir" ? " and everything in it" : ""}? This cannot be undone.</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) void run(); }}>
              {dialog.dir && <p className="muted small">in <code>{dialog.dir}/</code></p>}
              <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Name"
                     placeholder={dialog.type === "folder" ? "figures_extra" : dialog.type === "file" ? "appendix.tex" : ""} style={{ width: "100%" }} />
            </form>
          )}
          {err && <p className="ol-newerr">{err}</p>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
            <button onClick={() => setDialog(null)}>Cancel</button>
            <button className={dialog.type === "delete" ? "danger" : "primary"} disabled={busy || (dialog.type !== "delete" && !value.trim())} onClick={() => void run()}>
              {dialog.type === "delete" ? "Delete" : dialog.type === "rename" ? "Rename" : "Create"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
