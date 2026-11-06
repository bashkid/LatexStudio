import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as api from "../api";
import { projectPath, projectsQuery, queryClient, stateQuery } from "../query";
import type { State } from "../api";
import CodeEditor, { type Ghost } from "./CodeEditor";
import PdfSyncView, { type Reveal } from "./PdfSyncView";
import { Modal, ErrorNote } from "./ui";
import { applyCompletion, completionAt, itemDisplay, tableSnippet, visualHtml, type Item } from "./latexSyntax";
import EditorToolbar, { type EditMode } from "./EditorToolbar";
import Icon from "./Icons";
import FileExplorerTree from "./FileExplorerTree";
import { acceptHunk, hunks, rejectHunk } from "./lineDiff";
import { findWord, type WordHint } from "./wordMatch";

/** The paper's LaTeX in a code editor (left) beside its PDF (right): edit, save, rebuild and read the result. */
export default function SourceEditor({ name, main, pdf: pdfInitial, pdfMtime: pdfMtimeInitial, onClose, onSwitch }: {
  name: string; main: string; pdf: boolean; pdfMtime: number; onClose: () => void; onSwitch: (id: string) => void;
}) {
  const base = projectPath(name);
  // Subscribe to the project state so pdfMtime stays live after every build (the prop is only the initial value).
  const msState = useQuery<State>({ ...stateQuery(name), staleTime: 0 });
  const pdfMtime = msState.data?.pdfMtime ?? pdfMtimeInitial;
  const pdf = msState.data?.pdf ?? pdfInitial;
  const [file, setFile] = useState(main);
  const [openFiles, setOpenFiles] = useState<string[]>([main]);
  const cache = useRef<Record<string, { text: string; saved: string }>>({});    // the other open files' unsaved state
  const [, cacheTick] = useState(0);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const previewKind = (f: string): "image" | "pdf" | "other" | null =>
    /\.(png|jpe?g|webp|svg)$/i.test(f) ? "image" : /\.pdf$/i.test(f) ? "pdf" : /\.(eps|csv|json)$/i.test(f) ? null : null;
  const preview = previewKind(file);
  const src = useQuery({ enabled: !preview, queryKey: ["source", name, file], queryFn: () => api.get<{ file: string; text: string; files: string[] }>(`${base}/source?file=${encodeURIComponent(file)}`),
                         staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const loaded = useRef("");                                    // the text the editor was just given (a kept tab's own, else the disk's)
  const textRef = useRef("");
  textRef.current = text;
  useEffect(() => {
    if (!src.data) return;
    const kept = cache.current[src.data.file];                  // coming back to a tab: its own unsaved text, not the disk's
    if (kept) { delete cache.current[src.data.file]; setText(kept.text); setSaved(kept.saved); loaded.current = kept.text; }
    else {
      // Background refetch: only update the editor if the user has not typed anything since the last load.
      // If they have unsaved edits, only advance `saved` so the dirty indicator stays correct.
      const hasEdits = textRef.current !== loaded.current;
      if (!hasEdits) { setText(src.data.text); loaded.current = src.data.text; }
      setSaved(src.data.text);
    }
  }, [src.data]);
  const dirty = text !== saved;

  // ---- syntax completion (local, no AI): commands, environments, citation keys and labels as you type ----
  const [caretPos, setCaretPos] = useState(0);
  const [menuIdx, setMenuIdx] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(-1);
  const syms = useQuery({ queryKey: ["symbols", name, file === "references.bib" ? saved.length : 0],
                          queryFn: () => api.get<{ cites: string[]; labels: string[] }>(`${base}/source/symbols`), staleTime: 30_000 });
  const completion = useMemo(() => {
    if (file.endsWith(".bib") || caretPos === dismissedAt) return null;
    return completionAt(text, caretPos, { cites: syms.data?.cites ?? [], labels: syms.data?.labels ?? [] });
  }, [text, caretPos, dismissedAt, file, syms.data]);

  // ---- a suggestion shown at the cursor (accept or discard) ----
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const caret = useRef({ start: 0, end: 0 });
  const taRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef("");
  latest.current = text;
  const typed = (v: string) => { setText(v); setGhost(null); setDismissedAt(-1); setMenuIdx(0); };
  const typedByUser = (v: string) => { typed(v); remember(v); };
  const acceptGhost = () => {
    if (!ghost) return;
    const at = ghost.at, end = at + ghost.text.length;
    setText(text.slice(0, at) + ghost.text + text.slice(at));
    setGhost(null);
    requestAnimationFrame(() => { const t = taRef.current; if (t) { t.focus(); t.selectionStart = t.selectionEnd = end; } });
  };
  const pick = (item: Item) => {
    if (!completion) return;
    const r = applyCompletion(text, completion, item);
    typed(r.text);
    requestAnimationFrame(() => { const t = taRef.current; if (t) { t.focus(); t.selectionStart = t.selectionEnd = r.caret; setCaretPos(r.caret); } });
  };
  const onKeyIntercept = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); void compileNow(); return true; }
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); traverse(e.shiftKey ? 1 : -1); return true; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); traverse(1); return true; }
    if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); setFindOpen(true); return true; }
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); wrap("\\textbf{", "}", "bold"); return true; }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); wrap("\\textit{", "}", "italic"); return true; }
    if (ghost) {
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); acceptGhost(); return true; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setGhost(null); return true; }
    }
    if (completion) {
      const n = completion.items.length;
      if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx((menuIdx + 1) % n); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((menuIdx - 1 + n) % n); return true; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); pick(completion.items[Math.min(menuIdx, n - 1)]); return true; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDismissedAt(caretPos); return true; }
    }
    return false;
  };

  // ---- layout: tabs and Recompile like Overleaf, a draggable divider, arrows between code and PDF ----
  const [leftPct, setLeftPct] = useState(50);
  const [collapsed, setCollapsed] = useState<"" | "editor" | "pdf">("");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [backSeq, setBackSeq] = useState(0);
  const [menu, setMenu] = useState<"" | "file" | "compile">("");
  const [fileQuery, setFileQuery] = useState("");
  const [explorer, setExplorer] = useState(() => { try { return localStorage.getItem("editor.explorer") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("editor.explorer", explorer ? "1" : "0"); } catch { /* optional */ } }, [explorer]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const logQ = useQuery({ queryKey: ["srclog", name, logOpen], enabled: logOpen, staleTime: 0, gcTime: 0,
                          queryFn: () => api.get<{ log: string; error: string; exists: boolean }>(`${base}/source/log`) });
  const gridRef = useRef<HTMLDivElement>(null);
  const stop = () => api.post(`${base}/build/stop`).then(() => queryClient.invalidateQueries({ queryKey: ["state", name] })).catch(() => undefined);
  const dragDivider = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = gridRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (m: MouseEvent) => setLeftPct(Math.min(75, Math.max(25, ((m.clientX - box.left) / box.width) * 100)));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const createFile = useMutation({
    mutationFn: () => {
      const n = newName.trim().replace(/^\/+/, "");
      return api.post<{ path: string }>(`${base}/files/new`, { path: /\.[A-Za-z0-9]+$/.test(n) ? n : `${n}.tex`, kind: "file" });
    },
    onSuccess: (r) => {
      void src.refetch();
      void queryClient.invalidateQueries({ queryKey: ["paper-files", name] });
      void queryClient.invalidateQueries({ queryKey: ["symbols", name] });
      setNewOpen(false); setNewName(""); setMenu(""); setFileQuery("");
      openTab(r.path);
      showToast(`Created ${r.path}. Add \\input{${r.path.replace(/\.tex$/, "")}} to ${main} to include it.`);
    },
  });
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = (m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 6000);
  };
  const toPdf = async () => {                                  // → the place of the cursor line in the PDF
    const ta = taRef.current;
    const line = ta ? text.slice(0, ta.selectionStart).split("\n").length : 1;
    try {
      const r = await api.post<{ page: number; x: number; y: number; w: number; h: number }>(`${base}/source/forward`, { file, line });
      setReveal({ ...r, seq: Date.now() });
    } catch (e) {
      const m = e as { message?: string; hint?: string };
      showToast(`${m.message ?? "That place is not in the PDF."} ${m.hint ?? ""}`.trim());
    }
  };

  // Esc and a click elsewhere close the file menu and the compile menu
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      setMenu(""); setNewOpen(false); setNewName(""); setFileQuery("");
    };
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".ol-files, .ol-addwrap, .olsplit")) return;
      setMenu(""); setNewOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onDown); };
  }, [menu]);

  // ---- Ctrl/Cmd + S: save every open file and compile (also when the focus is on the PDF or a toolbar) ----
  const compileNow = async () => {
    if (building || build.isPending || save.isPending) return;      // one compile at a time
    try { await saveAndBuild(); } catch { /* the error note and the log show it */ }
  };
  const compileRef = useRef(compileNow);
  compileRef.current = compileNow;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();                                           // never the browser's "save page"
        void compileRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // ---- Ctrl/Cmd + and − : the editor's text size, unless the pointer is over the PDF (that zooms the PDF) ----
  const [fontSize, setFontSize] = useState(() => { try { return Math.min(32, Math.max(9, Number(localStorage.getItem("editor.fontSize")) || 15)); } catch { return 15; } });
  useEffect(() => { try { localStorage.setItem("editor.fontSize", String(fontSize)); } catch { /* optional */ } }, [fontSize]);
  useEffect(() => {
    let overPdf = false;
    const move = (e: MouseEvent) => { overPdf = !!(e.target as Element | null)?.closest?.(".srced-pdf"); };
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const dir = e.key === "+" || e.key === "=" ? 1 : e.key === "-" || e.key === "_" ? -1 : e.key === "0" ? 0 : null;
      if (dir === null) return;
      e.preventDefault();                                          // never the browser's own page zoom in here
      if (overPdf) return;                                         // the PDF viewer takes it
      setFontSize((n) => (dir === 0 ? 15 : Math.min(32, Math.max(9, n + dir))));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("keydown", key, true); };
  }, []);

  // ---- toolbar: undo / redo, formatting and insertions act on the text area's selection ----
  const [mode, setMode] = useState<"code" | "visual">("code");
  const [editMode, setEditMode] = useState<EditMode>("editing");
  const viewing = editMode === "viewing";
  // Review: edits are suggestions. `base` is the accepted text (what is saved); `text` is the working copy with the edits.
  const [accepted, setAccepted] = useState<string | null>(null);
  const review = editMode === "review" && accepted !== null;
  const changeMode = (m: EditMode) => {
    setEditMode(m);
    setAccepted(m === "review" ? text : null);               // leaving Review keeps the edits as ordinary changes
  };
  const suggestions = useMemo(() => (review && accepted !== null ? hunks(accepted, text) : []), [review, accepted, text]);
  const hist = useRef<{ stack: string[]; at: number; last: number; file: string }>({ stack: [], at: -1, last: 0, file: "" });
  const [, bump] = useState(0);
  const histories = useRef<Record<string, { stack: string[]; at: number; last: number; file: string }>>({});
  useEffect(() => {
    if (!src.data) return;
    const h = hist.current;
    if (h.file !== src.data.file) {                              // another file: its own history (kept while its tab is open)
      if (h.file) histories.current[h.file] = h;
      hist.current = histories.current[src.data.file] ?? { stack: [loaded.current], at: 0, last: 0, file: src.data.file };
      const back = hist.current;
      if (back.stack[back.at] !== loaded.current) { back.stack = [...back.stack.slice(0, back.at + 1), loaded.current]; back.at = back.stack.length - 1; back.last = 0; }
    } else if (h.stack[h.at] !== loaded.current) {                // the same file came again (after a build or an AI repair): the history stays, the new text is one more step
      h.stack = [...h.stack.slice(0, h.at + 1), loaded.current];
      h.at = h.stack.length - 1;
      h.last = 0;
    }
    bump((n) => n + 1);
  }, [src.data]);
  const remember = (v: string) => {                          // keystrokes within half a second share one undo step
    const h = hist.current;
    const now = Date.now();
    h.stack = h.stack.slice(0, h.at + 1);
    if (now - h.last < 500 && h.stack.length > 1) h.stack[h.stack.length - 1] = v; else h.stack.push(v);
    h.at = h.stack.length - 1;
    h.last = now;
    bump((n) => n + 1);
  };
  const traverse = (dir: -1 | 1) => {
    const h = hist.current;
    const to = h.at + dir;
    if (to < 0 || to >= h.stack.length) return;
    h.at = to;
    h.last = 0;
    setText(h.stack[to]); setGhost(null);
    bump((n) => n + 1);
  };
  const act = (fn: (t: string, a: number, b: number) => { text: string; a: number; b?: number }) => {
    const ta = taRef.current;
    if (!ta || viewing || mode !== "code") return;
    const r = fn(text, ta.selectionStart, ta.selectionEnd);
    typed(r.text);
    remember(r.text);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(r.a, r.b ?? r.a); setCaretPos(r.a); });
  };
  const wrap = (before: string, after: string, placeholder = "") => act((t, a, b) => {
    const sel = t.slice(a, b) || placeholder;
    const text = t.slice(0, a) + before + sel + after + t.slice(b);
    return { text, a: a + before.length, b: a + before.length + sel.length };
  });
  const insert = (snippet: string) => act((t, a, b) => {
    const m = snippet.match(/^@table:(\d+)x(\d+)$/);
    const body = m ? tableSnippet(Number(m[1]), Number(m[2])) : snippet;
    const bar = body.indexOf("|");
    const clean = body.replace("|", "");
    return { text: t.slice(0, a) + clean + t.slice(b), a: a + (bar >= 0 ? bar : clean.length) };
  });
  const lineRange = (t: string, a: number, b: number) => {
    const from = t.lastIndexOf("\n", Math.max(a - 1, 0)) + 1;
    const nl = t.indexOf("\n", Math.max(b, a));
    return [from, nl === -1 ? t.length : nl] as const;
  };
  const styleLine = (cmd: string) => act((t, a, b) => {
    const [from, to] = lineRange(t, a, b);
    const line = t.slice(from, to).replace(/^\s*\\(?:sub)*(?:section|paragraph)\*?\{(.*)\}\s*$/, "$1");
    const next = cmd ? `\\${cmd}{${line}}` : line;
    return { text: t.slice(0, from) + next + t.slice(to), a: from + next.length };
  });
  const comment = () => act((t, a, b) => {
    const [from, to] = lineRange(t, a, b);
    const lines = t.slice(from, to).split("\n");
    const all = lines.every((l) => /^\s*%/.test(l) || !l.trim());
    const out = lines.map((l) => (all ? l.replace(/^(\s*)% ?/, "$1") : l.trim() ? `% ${l}` : l)).join("\n");
    return { text: t.slice(0, from) + out + t.slice(to), a: from, b: from + out.length };
  });
  const list = (ordered: boolean) => act((t, a, b) => {
    const env = ordered ? "enumerate" : "itemize";
    if (a === b) {
      const ins = `\\begin{${env}}\n  \\item \n\\end{${env}}`;
      return { text: t.slice(0, a) + ins + t.slice(b), a: a + `\\begin{${env}}\n  \\item `.length };
    }
    const [from, to] = lineRange(t, a, b);
    const items = t.slice(from, to).split("\n").filter((l) => l.trim()).map((l) => `  \\item ${l.trim()}`).join("\n");
    const out = `\\begin{${env}}\n${items}\n\\end{${env}}`;
    return { text: t.slice(0, from) + out + t.slice(to), a: from + out.length };
  });

  // ---- an equation from a picture: choose or paste it, review the LaTeX, then insert ----
  const [mathOpen, setMathOpen] = useState(false);
  const [mathImg, setMathImg] = useState<{ url: string; b64: string; type: string } | null>(null);
  const [mathTex, setMathTex] = useState("");
  const closeMath = () => { setMathOpen(false); setMathImg(null); setMathTex(""); };
  const readMath = useMutation({
    mutationFn: (img: { b64: string; type: string }) =>
      api.post<{ latex: string; multiline: boolean }>(`${base}/source/math-image`, { image: img.b64, media_type: img.type }),
    onSuccess: (r) => setMathTex(r.latex),
  });
  const takeImage = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("That is not a picture. Choose a PNG, JPEG or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { showToast("The picture is larger than 5 MB. Crop it to the equation."); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const url = String(rd.result);
      const img = { url, b64: url.split(",")[1] ?? "", type: file.type };
      setMathImg(img); setMathTex("");
      readMath.mutate(img);
    };
    rd.readAsDataURL(file);
  };
  const putMath = (how: "inline" | "display" | "equation") => {
    const t = mathTex.trim();
    if (!t) return;
    const text = how === "inline" ? `$${t}$|`
      : how === "display" ? `\\[\n    ${t}\n\\]|`
      : `\\begin{equation}\n    ${t}\n    \\label{eq:placeholder}\n\\end{equation}|`;
    closeMath();
    insert(text);
  };

  // ---- find and replace ----
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const matchIdx = useMemo(() => {
    if (!findText) return [] as number[];
    const out: number[] = [];
    const low = text.toLowerCase(), q = findText.toLowerCase();
    for (let i = low.indexOf(q); i !== -1 && out.length < 2000; i = low.indexOf(q, i + Math.max(q.length, 1))) out.push(i);
    return out;
  }, [text, findText]);
  const findNext = (dir: 1 | -1 = 1) => {
    const ta = taRef.current;
    if (!ta || !matchIdx.length) return;
    const from = dir === 1 ? ta.selectionEnd : ta.selectionStart - 1;
    const hit = dir === 1 ? matchIdx.find((i) => i >= from) ?? matchIdx[0] : [...matchIdx].reverse().find((i) => i <= from) ?? matchIdx[matchIdx.length - 1];
    const lineNo = text.slice(0, hit).split("\n").length;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(hit, hit + findText.length);
    const row = ta.parentElement?.querySelector<HTMLElement>(`.vsc-line:nth-child(${lineNo})`);
    ta.scrollTop = Math.max(0, (row ? row.offsetTop : (lineNo - 1) * 23) - 90);
  };
  const replaceOne = () => {
    const ta = taRef.current;
    if (!ta || viewing) return;
    if (text.slice(ta.selectionStart, ta.selectionEnd).toLowerCase() === findText.toLowerCase() && findText) {
      const next = text.slice(0, ta.selectionStart) + replaceText + text.slice(ta.selectionEnd);
      typed(next); remember(next);
    }
    requestAnimationFrame(() => findNext(1));
  };
  const replaceAll = () => {
    if (!findText || viewing || !matchIdx.length) return;
    let out = "", last = 0;
    for (const i of matchIdx) { out += text.slice(last, i) + replaceText; last = i + findText.length; }
    out += text.slice(last);
    typed(out); remember(out);
  };

  const refresh = () => { for (const k of ["state"]) void queryClient.invalidateQueries({ queryKey: [k, name] }); };
  const toSave = review && accepted !== null ? accepted : text;
  const save = useMutation({ mutationFn: (t: string) => api.put(`${base}/source`, { file, text: t }), onSuccess: (_r, t) => { setSaved(t); refresh(); } });
  const build = useMutation({ mutationFn: () => api.post(`${base}/build`), onSuccess: refresh });
  const bt = msState.data?.build ?? null;
  const buildTask = bt ? { status: bt.status, meta: { outcome: bt.outcome ?? undefined } } : undefined;
  const building = buildTask?.status === "running";
  const prevBuilding = useRef(false);
  useEffect(() => {                                              // the build ended in failure: say so, the log says why
    if (prevBuilding.current && buildTask?.status && buildTask.status !== "running" && buildTask.status !== "done") {
      showToast("The build did not finish. Open the log (document icon next to Recompile) to see why.");
    } else if (prevBuilding.current && buildTask?.status === "done") {
      const o = buildTask.meta?.outcome as { ok?: boolean } | undefined;
      if (o && o.ok === false) {
        showToast("The build failed. Open the log (document icon next to Recompile) to see the error.");
      }
    }
    prevBuilding.current = building;
  }, [building]);                                                // eslint-disable-line react-hooks/exhaustive-deps
  const saveOthers = async () => {                              // unsaved text of the other open tabs is part of the build
    for (const [f, c] of Object.entries(cache.current)) {
      if (c.text !== c.saved) { await api.put(`${base}/source`, { file: f, text: c.text }); cache.current[f] = { text: c.text, saved: c.text }; }
    }
    cacheTick((n) => n + 1);
  };
  const saveAndBuild = async () => {
    await saveOthers();
    if (dirty) await save.mutateAsync(toSave);
    await build.mutateAsync();
  };
  // opened without a PDF: build one once, so the right side is never empty
  const autoBuilt = useRef(false);
  useEffect(() => {
    if (pdf || building || autoBuilt.current || src.isPending) return;
    autoBuilt.current = true;
    build.mutate();
  }, [pdf, building, src.isPending]);                            // eslint-disable-line react-hooks/exhaustive-deps
  const saveAll = async () => { await saveOthers(); if (dirty) await save.mutateAsync(toSave); };
  const close = () => { if (!dirty || window.confirm("Close the editor and discard unsaved changes?")) onClose(); };
  // switch to another project without leaving the editor
  const projects = useQuery(projectsQuery);
  const [projMenu, setProjMenu] = useState(false);
  const projBox = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!projMenu) return;
    const away = (e: MouseEvent) => { if (projBox.current && !projBox.current.contains(e.target as Node)) setProjMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setProjMenu(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [projMenu]);
  const switchProject = (id: string) => {
    setProjMenu(false);
    if (id === name) return;
    if (anyDirty && !window.confirm("Open another project and discard unsaved changes?")) return;
    onSwitch(id);
  };
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);

  // a click in the PDF: open the file it came from and put the cursor on that line
  const [jump, setJump] = useState<{ file: string; line: number; hint?: WordHint } | null>(null);
  const goTo = (target: { file: string; line: number; hint?: WordHint }) => {
    setJump(target);
    if (target.file !== file) openTab(target.file);
  };
  useEffect(() => {
    if (!jump || jump.file !== file || src.isPending || src.data?.file !== file || text !== src.data.text || text !== saved) return;
    const ta = taRef.current;
    if (!ta) return;
    const lines = text.split("\n");
    const n = Math.min(Math.max(jump.line, 1), lines.length);
    const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    const hit = jump.hint ? findWord(text, n, jump.hint) : null;       // the clicked word itself, else its whole line
    const [from, to] = hit ?? [start, start + lines[n - 1].length];
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(from, to);
    const lineOfHit = hit ? text.slice(0, from).split("\n").length : n;
    const row = ta.parentElement?.querySelector<HTMLElement>(`.vsc-line:nth-child(${lineOfHit})`);
    ta.scrollTop = Math.max(0, (row ? row.offsetTop : (lineOfHit - 1) * 23) - 90);
    caret.current = { start: from, end: to };
    setJump(null);
  }, [jump, file, src.isPending, src.data, text, saved]);
  const openTab = (f: string) => {                               // open (or switch to) a file in its own tab
    if (f === file) return;
    if (src.data?.file === file) cache.current[file] = { text: review && accepted !== null ? accepted : text, saved };
    setAccepted(null); setEditMode((m) => (m === "review" ? "editing" : m));
    setOpenFiles((o) => (o.includes(f) ? o : [...o, f]));
    setFile(f);
    cacheTick((n) => n + 1);
  };
  const isDirty = (f: string) => (f === file ? dirty : !!cache.current[f] && cache.current[f].text !== cache.current[f].saved);
  const anyDirty = dirty || openFiles.some((f) => f !== file && isDirty(f));
  const closeTab = (f: string) => {
    if (openFiles.length === 1) return;                           // the editor is left with its own button
    if (isDirty(f) && !window.confirm(`${f} has unsaved changes. Close it and discard them?`)) return;
    const rest = openFiles.filter((x) => x !== f);
    setOpenFiles(rest);
    delete cache.current[f];
    if (f === file) {
      const next = rest[Math.min(openFiles.indexOf(f), rest.length - 1)];
      setAccepted(null); setEditMode((m) => (m === "review" ? "editing" : m));
      setFile(next);
    }
    cacheTick((n) => n + 1);
  };
  return createPortal(
    <section className="srced srcfull" role="dialog" aria-modal="true" aria-label="LaTeX editor"
             style={{ "--vsc-fs": `${fontSize}px` } as React.CSSProperties}>
      <ErrorNote error={src.error ?? save.error ?? build.error} />
      <div className={`srced-grid ol${collapsed ? ` ol-hide-${collapsed}` : ""}`} ref={gridRef} style={{ gridTemplateColumns: collapsed === "editor" ? "0px 0px minmax(0,1fr)" : collapsed === "pdf" ? "minmax(0,1fr) 0px 0px" : `${leftPct}% 0px minmax(0,1fr)` }}>
        <div className="ol-left">
          <button className={`ol-edge ol-edge-explorer${explorer ? " open" : ""}`} style={explorer ? { left: 200 } : { left: 0 }}
                  aria-label={explorer ? "Hide the project explorer" : "Show the project explorer"} onClick={() => setExplorer((o) => !o)}>
            <Icon name={explorer ? "left" : "right"} size={10} /></button>
          {explorer && (
            <aside className="ol-explorer" aria-label="Project files">
              <div className="ol-exbody">
              <div className="ol-exhead">
                <b>Files</b>
                <button aria-label="New file" onClick={() => setNewOpen((o) => !o)}><Icon name="plus" size={14} /></button>
              </div>
              {newOpen && (
                <form className="ol-exnew" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createFile.mutate(); }}>
                  <span className="ol-newname"><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="chapters/intro.tex" aria-label="New file name" /></span>
                  {createFile.error && <p className="ol-newerr">{(createFile.error as { message?: string }).message}</p>}
                  <span className="ol-newacts">
                    <button className="primary" disabled={!newName.trim() || createFile.isPending}>Create</button>
                    <button type="button" onClick={() => { setNewOpen(false); setNewName(""); }}>Cancel</button>
                  </span>
                </form>
              )}
              <FileExplorerTree base={base} name={name} file={file} isDirty={isDirty} openTab={openTab}
                                onRenamed={(from, to) => { if (openFiles.includes(from)) { closeTab(from); openTab(to); } }}
                                onDeleted={(path) => { openFiles.filter((f) => f === path || f.startsWith(path + "/")).forEach(closeTab); }} />
              </div>
            </aside>
          )}
        <div className="srced-code">
          {preview && (
            <div className="ol-preview" role="region" aria-label={`Preview of ${file}`}>
              {preview === "image"
                ? <img alt={file} src={`/api/v1${base}/files/raw?path=${encodeURIComponent(file)}`} />
                : <iframe title={file} src={`/api/v1${base}/files/raw?path=${encodeURIComponent(file)}`} />}
            </div>
          )}
          <div className="ol-tabs" role="tablist" aria-label="Open files">
            <button className={`ol-toggle${explorer ? " on" : ""}`} aria-label={explorer ? "Hide the file explorer" : "Show the file explorer"}
                    aria-pressed={explorer} onClick={() => setExplorer((o) => !o)}><Icon name="sidebar" size={16} /></button>
            {openFiles.map((f) => (
              <span key={f} className={`ol-tab${f === file ? " on" : ""}`} role="tab" aria-selected={f === file}>
                <Icon name={f.endsWith(".bib") ? "book" : /\.(png|jpe?g|webp|svg)$/i.test(f) ? "image" : "file"} size={14} />
                <button className="ol-tabname" onClick={() => openTab(f)} title={f}>{f.replace(/^sections\//, "")}{isDirty(f) ? " ●" : ""}</button>
                {openFiles.length > 1 && <button className="ol-x" aria-label={`Close ${f}`} onClick={() => closeTab(f)}><Icon name="close" size={12} /></button>}
              </span>
            ))}
            <span className="ol-addwrap">
              <button className="ol-add" aria-label="Open another file" aria-expanded={menu === "file"} onClick={() => setMenu(menu === "file" ? "" : "file")}><Icon name="plus" size={14} /></button>
              {menu === "file" && (() => {
                const all = src.data?.files ?? openFiles;
                const q = fileQuery.trim().toLowerCase();
                const shown = all.filter((f) => !q || f.toLowerCase().includes(q));
                const groups: [string, string[]][] = [
                  ["Main", shown.filter((f) => f === main)],
                  ["TeX files", shown.filter((f) => f !== main && f.endsWith(".tex"))],
                  ["Bibliography", shown.filter((f) => f.endsWith(".bib"))],
                  ["Other", shown.filter((f) => f !== main && !f.endsWith(".tex") && !f.endsWith(".bib"))],
                ];
                return (
                  <div className="ol-files" role="dialog" aria-label="Files of the project">
                    <div className="ol-filesearch">
                      <Icon name="search" size={14} />
                      <input autoFocus value={fileQuery} onChange={(e) => setFileQuery(e.target.value)} placeholder="Find a file…" aria-label="Find a file" />
                    </div>
                    <div className="ol-filelist">
                      {groups.filter(([, fs]) => fs.length).map(([title, fs]) => (
                        <div key={title}>
                          <h6>{title}</h6>
                          {fs.map((f) => (
                            <button key={f} className={`ol-fileitem${f === file ? " on" : ""}`} onClick={() => { setMenu(""); setFileQuery(""); openTab(f); }}>
                              <Icon name={f.endsWith(".bib") ? "book" : "file"} size={15} />
                              <span className="ol-filename">{f.replace(/^sections\//, "")}</span>
                              {isDirty(f) && <i className="ol-dot" title="Unsaved changes" />}
                              {openFiles.includes(f) && <small>open</small>}
                            </button>
                          ))}
                        </div>
                      ))}
                      {shown.length === 0 && <p className="muted small ol-nofile">No file matches “{fileQuery}”.</p>}
                    </div>
                    <div className="ol-filenew">
                      {!newOpen ? (
                        <button className="ol-newbtn" onClick={() => setNewOpen(true)}><Icon name="plus" size={15} /> New file…</button>
                      ) : (
                        <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createFile.mutate(); }}>
                          <label>File name
                            <span className="ol-newname"><input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="chapters/intro.tex" aria-label="New file name" /></span>
                          </label>
                          {createFile.error && <p className="ol-newerr">{(createFile.error as { message?: string; hint?: string }).message} {(createFile.error as { hint?: string }).hint}</p>}
                          <div className="ol-newacts">
                            <button className="primary" disabled={!newName.trim() || createFile.isPending}>{createFile.isPending ? "Creating…" : "Create file"}</button>
                            <button type="button" onClick={() => { setNewOpen(false); setNewName(""); }}>Cancel</button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })()}
            </span>
            <span className="etgrow" />
            <span className="ol-projwrap" ref={projBox}>
              <button className="ol-proj" aria-haspopup="menu" aria-expanded={projMenu} onClick={() => setProjMenu(!projMenu)} title="Switch project">
                <Icon name="folder" size={15} /> <span className="ol-projname">Open</span> <Icon name="chevronDown" size={11} />
              </button>
              {projMenu && (
                <ul className="ol-projmenu" role="menu" aria-label="Open another project">
                  <li className="ol-projhead">Projects</li>
                  {(projects.data ?? []).filter((x) => x.exists).map((x) => (
                    <li key={x.id}><button role="menuitemradio" aria-checked={x.id === name} onClick={() => switchProject(x.id)}>
                      <span>{x.id === name ? "✓ " : ""}{x.name}</span><small>{x.path}</small></button></li>
                  ))}
                  {projects.isPending && <li className="ol-projhead">Loading…</li>}
                  <li><button role="menuitem" onClick={() => { if (!anyDirty || window.confirm("Leave this project and discard unsaved changes?")) onClose(); }}><span>All projects…</span></button></li>
                </ul>
              )}
            </span>
            <button className={`ol-save${anyDirty ? " dirty" : ""}`}
                    disabled={save.isPending || !anyDirty} onClick={() => void saveAll()}
                    aria-label="Save (Ctrl/Cmd+S saves and compiles)"><Icon name="save" size={14} /> {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}</button>
            <button className="ol-closeeditor" onClick={close} aria-label="Close the editor" title="Close the editor"><Icon name="close" size={15} /></button>
          </div>
          <EditorToolbar onUndo={() => traverse(-1)} onRedo={() => traverse(1)}
                         canUndo={hist.current.at > 0} canRedo={hist.current.at < hist.current.stack.length - 1}
                         onStyle={styleLine} onWrap={wrap} onInsert={insert} onComment={comment} onList={list} onMathImage={() => setMathOpen(true)}
                         cites={syms.data?.cites ?? []} labels={syms.data?.labels ?? []}
                         mode={mode} onMode={setMode} editMode={editMode} onEditMode={changeMode} onFind={() => setFindOpen((o) => !o)}
                         disabled={src.isPending || viewing || (file.endsWith(".bib") && mode === "visual")} />
          {findOpen && (
            <div className="edfind" role="search">
              <input autoFocus value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Find" aria-label="Find"
                     onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); } if (e.key === "Escape") { e.stopPropagation(); setFindOpen(false); } }} />
              <span className="muted small">{findText ? `${matchIdx.length} found` : ""}</span>
              <button onClick={() => findNext(-1)} disabled={!matchIdx.length} aria-label="Previous match">︿</button>
              <button onClick={() => findNext(1)} disabled={!matchIdx.length} aria-label="Next match">﹀</button>
              <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="Replace with" aria-label="Replace with" disabled={viewing} />
              <button onClick={replaceOne} disabled={viewing || !matchIdx.length}>Replace</button>
              <button onClick={replaceAll} disabled={viewing || !matchIdx.length}>Replace all</button>
              <button onClick={() => setFindOpen(false)} aria-label="Close find">✕</button>
            </div>
          )}
          {review && (
            <div className="ol-suggest" role="region" aria-label="Suggested changes">
              <div className="ol-suggesthead">
                <b>🗨 {suggestions.length ? `${suggestions.length} suggested change${suggestions.length > 1 ? "s" : ""}` : "Review mode: your edits become suggestions"}</b>
                {suggestions.length > 0 && <>
                  <button onClick={() => setAccepted(text)}>Accept all</button>
                  <button onClick={() => setText(accepted ?? text)}>Reject all</button>
                </>}
              </div>
              {suggestions.slice(0, 20).map((h, i) => {
                const was = (accepted ?? "").split("\n").slice(h.aStart, h.aEnd).join("\n");
                const now = text.split("\n").slice(h.bStart, h.bEnd).join("\n");
                return (
                  <div key={`${h.aStart}-${h.bStart}-${i}`} className="ol-hunk">
                    <span className="muted small">line {h.bStart + 1}</span>
                    {was && <pre className="del">{was}</pre>}
                    {now && <pre className="ins">{now}</pre>}
                    <span className="ol-hunkacts">
                      <button className="primary" onClick={() => setAccepted(acceptHunk(accepted ?? "", text, h))}>Accept</button>
                      <button onClick={() => typed(rejectHunk(accepted ?? "", text, h))}>Reject</button>
                    </span>
                  </div>
                );
              })}
              {suggestions.length > 20 && <p className="muted small">…and {suggestions.length - 20} more. Accept or reject these first.</p>}
            </div>
          )}
          {mode === "visual" ? (
            <div className="vis" aria-label="Visual preview (read only)"
                 dangerouslySetInnerHTML={{ __html: visualHtml(text) }} />
          ) : src.isPending ? <p className="muted">Loading…</p>
            : <CodeEditor label={`Edit ${file}`} value={text} onChange={typedByUser} readOnly={viewing} height="100%" lang={file.endsWith(".bib") ? "plain" : "latex"} wrap taRef={taRef}
                          ghost={ghost} anchor={caretPos} onKeyIntercept={onKeyIntercept}
                          onCaret={(a, b) => { caret.current = { start: a, end: b }; setCaretPos(a); setMenuIdx(0); }}
                          onAcceptGhost={() => undefined} onDismissGhost={() => undefined}
                          overlay={(pos) => (
                            <>
                              {completion && (
                                <ul className="vsc-menu" role="listbox" style={{ left: pos.left, top: pos.lineBottom + 2 }}>
                                  {completion.items.map((it, i) => (
                                    <li key={it.label + i} role="option" aria-selected={i === menuIdx} className={i === menuIdx ? "on" : ""}
                                        onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
                                      <b className="vsc-menulabel">{(() => {
                                        const shown = itemDisplay(it);
                                        const typed = text.slice(completion.from, completion.to);
                                        const n = shown.toLowerCase().startsWith(typed.toLowerCase()) ? typed.length : 0;
                                        return <><span className="hit">{shown.slice(0, n)}</span>{shown.slice(n)}</>;
                                      })()}{it.glyph && <i className="vsc-glyph">{it.glyph}</i>}</b>
                                      <span className="vsc-menutag" title={it.detail || undefined}>{it.tag ?? it.detail}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {ghost && (
                                <div className="vsc-ghostbar" style={{ left: pos.left, top: pos.lineBottom + 4 }}>
                                  <button className="primary" onMouseDown={(e) => { e.preventDefault(); acceptGhost(); }}>Accept</button>
                                  <button onMouseDown={(e) => { e.preventDefault(); setGhost(null); }}>Discard</button>
                                </div>
                              )}
                            </>
                          )} />}
        </div>
        </div>
        {collapsed === "editor" && (
          <button className="ol-edge ol-edge-restore-left" aria-label="Show the editor" onClick={() => setCollapsed("")}><Icon name="right" size={10} /></button>
        )}
        {collapsed === "pdf" && (
          <button className="ol-edge ol-edge-restore-right" aria-label="Show the PDF" onClick={() => setCollapsed("")}><Icon name="left" size={10} /></button>
        )}
        <div className="ol-split" onMouseDown={dragDivider} role="separator" aria-orientation="vertical" aria-label="Drag to resize">
          {!collapsed && <>
            <button className="ol-edge ol-edge-seam-left" aria-label="Hide the editor" onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setCollapsed("editor")}><Icon name="left" size={10} /></button>
            <button className="ol-edge ol-edge-seam-right" aria-label="Hide the PDF" onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setCollapsed("pdf")}><Icon name="right" size={10} /></button>
          </>}
          <button className="ol-arrow" aria-label="Show this line in the PDF" title="Show this line in the PDF"
                  onMouseDown={(e) => e.stopPropagation()} onClick={() => void toPdf()}><Icon name="arrowRight" size={14} /></button>
          <button className="ol-arrow" aria-label="Show this PDF page in the code" title="Show this PDF page in the code"
                  onMouseDown={(e) => e.stopPropagation()} onClick={() => setBackSeq((n) => n + 1)}><Icon name="arrowLeft" size={14} /></button>
        </div>
        <div className="srced-pdf">
          <PdfSyncView base={base} mtime={pdfMtime} onJump={(f, l, h) => goTo({ file: f, line: l, hint: h })} reveal={reveal} backSeq={backSeq} onNotice={showToast}
            leading={(
              <span className="olcompile">
                <span className="olsplit">
                  <button className="olrecompile" disabled={save.isPending || build.isPending || building} onClick={() => void saveAndBuild()}
                          aria-label="Save and compile (Ctrl/Cmd+S)">{building || build.isPending ? "Compiling…" : "Recompile"}</button>
                  <button className="oldrop" aria-label="Compile options" aria-expanded={menu === "compile"} onClick={() => setMenu(menu === "compile" ? "" : "compile")}><Icon name="chevronDown" size={14} /></button>
                  {menu === "compile" && (
                    <span className="ol-menu below" role="menu">
                      <button role="menuitem" onClick={() => { setMenu(""); void saveAndBuild(); }}>Recompile</button>
                      <button role="menuitem" disabled={!building} onClick={() => { setMenu(""); void stop(); }}>Stop compilation</button>
                    </span>
                  )}
                </span>
                {(building || build.isPending) && <span className="olneon" role="status" aria-label="Compiling" />}
                <button className="olicon" aria-label="Compile log and errors" onClick={() => setLogOpen(true)}><Icon name="file" /></button>
                <a className="olicon" aria-label="Download the PDF" href={`/api/v1${base}/main.pdf?download=true`} download><Icon name="download" /></a>
              </span>
            )} />
          {!pdf && (building || build.isPending) && <div className="stinfo olnopdf"><span className="olneon" /> Building the PDF…</div>}
          {!pdf && !building && !build.isPending && (
            <div className="stinfo olnopdf">
              {build.isError || autoBuilt.current ? "The PDF could not be built. Open the compile log (document icon) to see why, fix it, then press Recompile."
                : "There is no PDF yet. Press Recompile to create it."}
            </div>
          )}
        </div>
      </div>
      {mathOpen && (
        <div className="olmath-pop" role="dialog" aria-label="Math from an image" tabIndex={-1}
             onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeMath(); } }}
             onPaste={(e) => { const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); takeImage(f); } }}>
          <div className="olmath-row">
            {mathImg
              ? <img className="olmath-thumb" src={mathImg.url} alt="The equation to read" />
              : <label className="olmath-pick">
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => takeImage(e.target.files?.[0])} />
                  <Icon name="image" size={15} /> Choose or paste an image
                </label>}
            {readMath.isPending && <span className="muted small">Reading…</span>}
            {mathImg && !readMath.isPending && <button className="olmath-link" onClick={() => { setMathImg(null); setMathTex(""); }}>Change</button>}
            <button className="olmath-close" onClick={closeMath} aria-label="Close"><Icon name="close" size={13} /></button>
          </div>
          {readMath.error && <p className="ol-newerr">{(readMath.error as { message?: string }).message} {(readMath.error as { hint?: string }).hint}</p>}
          {mathTex && (
            <>
              <textarea className="olmath-tex" value={mathTex} onChange={(e) => setMathTex(e.target.value)} rows={2} spellCheck={false}
                        aria-label="LaTeX (check it, edit if needed)" />
              <div className="olmath-acts">
                <button className="primary" onClick={() => putMath("equation")}>Equation</button>
                <button onClick={() => putMath("display")}>Display</button>
                <button onClick={() => putMath("inline")}>Inline</button>
              </div>
            </>
          )}
        </div>
      )}
      {toast && <div className="ol-toast" role="status" onClick={() => setToast("")}>{toast}</div>}
      {logOpen && (
        <Modal title="Compile log" onClose={() => setLogOpen(false)}>
          {logQ.isPending ? <p className="muted">Loading…</p>
            : !logQ.data?.exists ? <p className="muted">There is no build log yet. Press Recompile.</p>
            : <>
                {logQ.data.error
                  ? <><b className="ollogerr">First error</b><pre className="ollog">{logQ.data.error}</pre></>
                  : <p className="muted">No errors in the last build.</p>}
                <details><summary>Full build log</summary><pre className="ollog">{logQ.data.log}</pre></details>
              </>}
        </Modal>
      )}
    </section>,
    document.body,
  );
}
