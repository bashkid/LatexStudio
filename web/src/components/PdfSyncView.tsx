import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import * as api from "../api";
import { Modal } from "./ui";
import Icon from "./Icons";
import { type WordHint } from "./wordMatch";

type Info = { pages: [number, number][]; mtime: number };
type Match = { page: number; rects: [number, number, number, number][] };
type Search = { matches: Match[]; total: number; q?: string };
type Zoom = "auto" | "width" | "fit" | number;
type Rot = 0 | 90 | 180 | 270;
type Tool = "select" | "hand";
type Scrolling = "vertical" | "page" | "horizontal" | "wrapped";
type Spread = "none" | "odd" | "even";
type Word = { r: [number, number, number, number]; t: string; l?: string };

/** One line of the page's text as a single selectable span, stretched to the line's printed width, so a selection runs through
 *  the spaces and from line to line like in any PDF reader (a span per word left gaps and ragged ends). */
function TextLine({ text, x, y, w, h }: { text: string; x: number; y: number; w: number; h: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "none";
    const natural = el.scrollWidth;
    if (natural > 0 && w > 0) el.style.transform = `scaleX(${w / natural})`;
  }, [text, w, h]);
  return <span ref={ref} style={{ left: x, top: y, height: h, lineHeight: `${h}px`, fontSize: Math.max(h * 0.85, 4) }}>{text}</span>;
}

/** The words of a page joined into lines (the server names each word's line), each with its box in view coordinates. */
function pageLines(words: Word[], box: (r: Word["r"]) => { x: number; y: number; w: number; h: number }) {
  const lines: { key: string; text: string; x: number; y: number; w: number; h: number }[] = [];
  const at = new Map<string, number>();
  for (const w of words) {
    const b = box(w.r);
    const k = w.l ?? `${Math.round(b.y)}`;
    const i = at.get(k);
    if (i === undefined) { at.set(k, lines.length); lines.push({ key: k, text: w.t, x: b.x, y: b.y, w: b.w, h: b.h }); continue; }
    const L = lines[i];
    const right = Math.max(L.x + L.w, b.x + b.w), top = Math.min(L.y, b.y), bottom = Math.max(L.y + L.h, b.y + b.h);
    L.text += " " + w.t; L.x = Math.min(L.x, b.x); L.w = right - L.x; L.y = top; L.h = bottom - top;
  }
  return lines;
}
type Props = { file: string; bytes: number; pages: number; built: number; pageSize: [number, number] | null; metadata: Record<string, string> };

const PERCENTS = [50, 75, 100, 125, 150, 200, 300, 400];
const CSS_PX_PER_PT = 96 / 72;              // 100% is the size the page would print at, as in a PDF reader
const GAP = 12;

// A point of the page as drawn after turning it clockwise by `rot`, and back (w, h: the unturned page in points).
const toView = (x: number, y: number, rot: Rot, w: number, h: number): [number, number] =>
  rot === 0 ? [x, y] : rot === 90 ? [h - y, x] : rot === 180 ? [w - x, h - y] : [y, w - x];
const toOrig = (x: number, y: number, rot: Rot, w: number, h: number): [number, number] =>
  rot === 0 ? [x, y] : rot === 90 ? [y, h - x] : rot === 180 ? [w - x, h - y] : [w - y, x];
const viewRect = (r: [number, number, number, number], rot: Rot, w: number, h: number) => {
  const [ax, ay] = toView(r[0], r[1], rot, w, h);
  const [bx, by] = toView(r[2], r[3], rot, w, h);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
};
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

/**
 * The built PDF in the editor, as page images with a reader's toolbar that appears only while the pointer is over the
 * viewer: pages sidebar, previous / next page, find, page number, zoom and a tools menu (first / last page, rotate, text
 * selection / hand tool, scrolling mode, spreads, SyncTeX and auto-refresh switches, document properties).
 * A click on a page reports the place in the LaTeX source that produced it (SyncTeX).
 */
export type Reveal = { page: number; x: number; y: number; w: number; h: number; seq: number };

export default function PdfSyncView({ base, mtime, onJump, leading, reveal, backSeq = 0, onNotice, pinned, onPin }: {
  base: string; mtime: number; onJump: (file: string, line: number, hint?: WordHint) => void;
  leading?: React.ReactNode;                 // buttons placed at the left of an always-visible bar (Recompile …)
  reveal?: Reveal | null;                    // go to this place of the PDF and mark it
  backSeq?: number;                          // bumps when the code-side arrow is pressed: jump to the source of this page
  onNotice?: (message: string) => void;      // a short message to show the reader (nothing found, no source positions …)
  pinned?: boolean;                          // the toolbar stays visible (auto-hide is off)
  onPin?: () => void;                        // adds a pin button that toggles `pinned`
}) {
  const [frozen, setFrozen] = useState<number | null>(null);          // the build being shown while auto-refresh is off
  const shown = frozen ?? mtime;
  const info = useQuery({ queryKey: ["pdfinfo", base, shown], queryFn: () => api.get<Info>(`${base}/pdf/info`), staleTime: 0, gcTime: 0,
                       placeholderData: keepPreviousData });          // a rebuild keeps the pages on screen until the new ones are known
  const pages = info.data?.pages ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 600, h: 800 });
  const [zoom, setZoom] = useState<Zoom>("width");
  const [current, setCurrent] = useState(1);
  const [pageText, setPageText] = useState("1");
  const [sidebar, setSidebar] = useState(false);
  const [tools, setTools] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Search | null>(null);
  const [hit, setHit] = useState(0);
  const shiftDown = useRef(false);
  const [rot, setRot] = useState<Rot>(0);
  const [tool, setTool] = useState<Tool>("select");
  const [scrolling, setScrolling] = useState<Scrolling>("vertical");
  const [spread, setSpread] = useState<Spread>("none");
  const [syncOn, setSyncOn] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [propsOpen, setPropsOpen] = useState(false);
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [info.isSuccess]);

  const turned = (size: [number, number]): [number, number] => (rot % 180 ? [size[1], size[0]] : size);
  const perRow = spread === "none" || scrolling === "wrapped" ? 1 : 2;
  const scaleFor = (size: [number, number]): number => {
    const [w, h] = turned(size);
    const room = Math.max((box.w - 8) / (scrolling === "horizontal" ? 1 : perRow) - (perRow - 1) * GAP, 120);
    if (typeof zoom === "number") return (zoom / 100) * CSS_PX_PER_PT;
    const byWidth = room / w;
    if (zoom === "width") return byWidth;
    if (zoom === "fit") return Math.min(byWidth, Math.max(box.h - 2 * GAP, 120) / h);
    return Math.min(byWidth, 1.25 * CSS_PX_PER_PT);                      // automatic: the page width, not larger than 125%
  };
  const percent = pages.length ? Math.round((scaleFor(pages[0]) / CSS_PX_PER_PT) * 100) : 100;
  const pageEls = () => Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-page]") ?? []);
  const goTo = (n: number) => {
    const target = Math.min(Math.max(n, 1), pages.length || 1);
    setCurrent(target);
    setPageText(String(target));
    if (scrolling !== "page") requestAnimationFrame(() => pageEls().find((el) => el.dataset.page === String(target))?.scrollIntoView({ block: "start", inline: "start" }));
  };
  const onScroll = () => {                                              // the page nearest the top-left of the viewer is the current one
    if (scrolling === "page") return;
    const r = scroller.current?.getBoundingClientRect();
    if (!r) return;
    let n = 1;
    pageEls().forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.top <= r.top + 40 || (scrolling === "horizontal" && b.left <= r.left + 40)) n = Number(el.dataset.page);
    });
    if (n !== current) { setCurrent(n); setPageText(String(n)); }
    const el = pageEls().find((e) => e.dataset.page === String(n));
    if (el && el.offsetHeight) anchor.current = { page: n, frac: (r.top - el.getBoundingClientRect().top) / el.offsetHeight };   // where in that page the reader is
  };
  // after a recompile the viewer shows the same page, and the same place on it, as before
  const anchor = useRef({ page: 1, frac: 0 });
  useEffect(() => {
    if (!info.data || info.isPlaceholderData) return;
    const a = anchor.current;
    if (a.page <= 1 && a.frac <= 0.001) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = scroller.current, el = pageEls().find((e) => e.dataset.page === String(Math.min(a.page, info.data!.pages.length)));
      if (!root || !el) return;
      root.scrollTop += (el.getBoundingClientRect().top - root.getBoundingClientRect().top) + a.frac * el.offsetHeight;
      setCurrent(Math.min(a.page, info.data!.pages.length));
    }));
    return () => cancelAnimationFrame(id);
  }, [info.data, info.isPlaceholderData]);                                // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir: 1 | -1) => {
    const at = dir === 1 ? PERCENTS.find((p) => p > percent + 1) ?? PERCENTS[PERCENTS.length - 1]
      : [...PERCENTS].reverse().find((p) => p < percent - 1) ?? PERCENTS[0];
    setZoom(at);
  };
  // Ctrl/Cmd + and − zoom while the pointer is over this viewer (0 returns to page width)
  const hovering = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!hovering.current || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const dir = e.key === "+" || e.key === "=" ? 1 : e.key === "-" || e.key === "_" ? -1 : e.key === "0" ? 0 : null;
      if (dir === null) return;
      e.preventDefault();
      if (dir === 0) setZoom("width"); else stepRef.current(dir);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const turn = (by: 90 | -90) => setRot((((rot + by) % 360) + 360) % 360 as Rot);

  // find
  const flat = useMemo(() => (found?.matches ?? []).flatMap((m) => m.rects.map((r) => ({ page: m.page, r }))), [found]);
  const search = useMutation({
    mutationFn: (q: string) => api.get<Search>(`${base}/pdf/search?q=${encodeURIComponent(q)}`),
    onSuccess: (d, q) => { setFound({ ...d, q }); setHit(0); const first = d.matches[0]; if (first) goTo(first.page); },
  });
  useEffect(() => {                                                      // bring the current match itself into view, not only its page
    if (!found || !flat.length) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(".synchit.on")?.scrollIntoView({ block: "center", inline: "nearest" })));
    return () => cancelAnimationFrame(id);
  }, [hit, found, flat.length, current]);                                // eslint-disable-line react-hooks/exhaustive-deps
  const moveHit = (dir: 1 | -1) => {
    if (!flat.length) return;
    const next = (hit + dir + flat.length) % flat.length;
    setHit(next);
    goTo(flat[next].page);
  };

  // click -> source
  const locate = useMutation({
    mutationFn: (a: { page: number; x: number; y: number; hint?: WordHint }) =>
      api.post<{ file: string; line: number }>(`${base}/source/locate`, { page: a.page, x: a.x, y: a.y }),
    onSuccess: (r, a) => onJump(r.file, r.line, a.hint),
  });
  // the word under a point of the page (PDF points) with the words before and after it
  const wordAt = (page: number, x: number, y: number): { hint: WordHint; cx: number; cy: number } | null => {
    const list = words[page] ?? [];
    let best = -1, bestD = 1e9;
    list.forEach((w, i) => {
      const dx = x < w.r[0] ? w.r[0] - x : x > w.r[2] ? x - w.r[2] : 0;
      const dy = y < w.r[1] ? w.r[1] - y : y > w.r[3] ? y - w.r[3] : 0;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { best = i; bestD = d; }
    });
    if (best < 0 || bestD > 6) return null;                                            // not on a word
    const w = list[best];
    return { hint: { word: w.t, prev: list[best - 1]?.t, next: list[best + 1]?.t },
             cx: (w.r[0] + w.r[2]) / 2, cy: (w.r[1] + w.r[3]) / 2 };
  };
  const click = (e: React.MouseEvent<HTMLElement>, page: number, size: [number, number], dbl = false) => {
    if (!syncOn || tool !== "select") return;
    if (!dbl && window.getSelection()?.toString()) return;                              // a text selection is not a jump
    const r = e.currentTarget.getBoundingClientRect();
    const [rw, rh] = turned(size);
    const [x, y] = toOrig(((e.clientX - r.left) / r.width) * rw, ((e.clientY - r.top) / r.height) * rh, rot, size[0], size[1]);
    const w = wordAt(page, x, y);
    locate.mutate(w ? { page, x: w.cx, y: w.cy, hint: w.hint } : { page, x, y });     // a word: its centre, and the word itself
  };
  const err = locate.error as { message?: string; hint?: string } | null;
  useEffect(() => { if (err) onNotice?.(`${err.message ?? "Could not find that place."} ${err.hint ?? ""}`.trim()); }, [err]);   // eslint-disable-line react-hooks/exhaustive-deps

  // hand tool: drag the page around
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const down = (e: React.MouseEvent) => {
    if (tool !== "hand" || !scroller.current) return;
    drag.current = { x: e.clientX, y: e.clientY, l: scroller.current.scrollLeft, t: scroller.current.scrollTop };
    e.preventDefault();
  };
  const move = (e: React.MouseEvent) => {
    if (!drag.current || !scroller.current) return;
    scroller.current.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
    scroller.current.scrollTop = drag.current.t - (e.clientY - drag.current.y);
  };

  // text layer (selectable words), loaded per page while the select tool is in use
  const [words, setWords] = useState<Record<number, Word[]>>({});
  const wantWords = useRef(new Set<number>());
  useEffect(() => { setWords({}); wantWords.current = new Set(); }, [base, shown]);
  const needWords = (n: number) => {
    if (words[n] || wantWords.current.has(n)) return;
    wantWords.current.add(n);
    api.get<{ words: Word[] }>(`${base}/pdf/text/${n}`).then((d) => setWords((w) => ({ ...w, [n]: d.words }))).catch(() => undefined);
  };

  // auto-refresh switch: off keeps showing this build, with a note when a newer one exists
  const setAuto = (on: boolean) => { setAutoRefresh(on); setFrozen(on ? null : mtime); };
  const props = useQuery({ queryKey: ["pdfprops", base, shown], queryFn: () => api.get<Props>(`${base}/pdf/properties`), enabled: propsOpen });

  const img = (n: number, z: number) => `/api/v1${base}/pdf/page/${n}.png?zoom=${z}&rotate=${rot}&v=${Math.round(shown * 1000)}`;
  const quality = (scale: number) => Math.min(3, Math.max(1, Math.ceil(scale * dpr * 2) / 2));

  // the pages that are on screen, in rows (spreads put two side by side; page scrolling shows one row)
  const rows = useMemo(() => {
    const all = pages.map((_, i) => i + 1);
    const grouped: number[][] = [];
    if (perRow === 1) all.forEach((n) => grouped.push([n]));
    else if (spread === "odd") for (let i = 0; i < all.length; i += 2) grouped.push(all.slice(i, i + 2));
    else { if (all.length) grouped.push([all[0]]); for (let i = 1; i < all.length; i += 2) grouped.push(all.slice(i, i + 2)); }
    return scrolling === "page" ? grouped.filter((g) => g.includes(current)) : grouped;
  }, [pages, perRow, spread, scrolling, current]);

  useEffect(() => {                                                    // keys: page up/down in page scrolling
    const el = scroller.current;
    if (!el || scrolling !== "page") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") goTo(current + perRow);
      if (e.key === "ArrowLeft" || e.key === "PageUp") goTo(current - perRow);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  });

  useEffect(() => {                                                    // Esc closes the properties, not the whole editor
    if (!propsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setPropsOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [propsOpen]);

  // source -> PDF: scroll to the place and mark it for a moment
  const [flash, setFlash] = useState<Reveal | null>(null);
  const revealed = useRef(0);                                           // the last place that was gone to
  useEffect(() => {
    // wait for the pages to exist (a viewer that has just opened has none yet), then go once per place
    if (!reveal || !pages.length || revealed.current === reveal.seq) return;
    revealed.current = reveal.seq;
    goTo(reveal.page);
    setFlash(reveal);
    const t = window.setTimeout(() => setFlash(null), 2600);
    return () => window.clearTimeout(t);
  }, [reveal?.seq, pages.length]);                                     // eslint-disable-line react-hooks/exhaustive-deps
  // PDF -> source: the text in the middle of what is showing (the nearest word of the page under the viewer's centre)
  useEffect(() => {
    if (!backSeq || !pages.length) return;
    const root = scroller.current?.getBoundingClientRect();
    if (!root) return;
    const cx = root.left + root.width / 2, cy = root.top + root.height / 2;
    const els = pageEls();
    const el = els.find((e) => { const b = e.getBoundingClientRect(); return b.top <= cy && b.bottom >= cy && b.left <= cx && b.right >= cx; })
      ?? els.find((e) => e.dataset.page === String(current)) ?? els[0];
    if (!el) return;
    const n = Number(el.dataset.page);
    const size = pages[n - 1];
    const b = el.getBoundingClientRect();
    const [rw, rh] = turned(size);
    const [px, py] = toOrig(Math.min(Math.max((cx - b.left) / b.width, 0), 1) * rw, Math.min(Math.max((cy - b.top) / b.height, 0), 1) * rh,
                            rot, size[0], size[1]);
    api.get<{ words: Word[] }>(`${base}/pdf/text/${n}`).then((d) => {
      const near = [...d.words].sort((a, c) => {
        const da = Math.hypot((a.r[0] + a.r[2]) / 2 - px, (a.r[1] + a.r[3]) / 2 - py);
        const dc = Math.hypot((c.r[0] + c.r[2]) / 2 - px, (c.r[1] + c.r[3]) / 2 - py);
        return da - dc;
      })[0];
      locate.mutate({ page: n, x: near ? (near.r[0] + near.r[2]) / 2 : px, y: near ? (near.r[1] + near.r[3]) / 2 : py });
    }).catch(() => onNotice?.("Could not read this page of the PDF."));
  }, [backSeq]);                                                       // eslint-disable-line react-hooks/exhaustive-deps

  // the three-dots menu closes when the pointer goes down anywhere else, or on Esc
  const menuBox = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!tools) return;
    const away = (e: MouseEvent) => { if (menuBox.current && !menuBox.current.contains(e.target as Node)) setTools(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setTools(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [tools]);

  const mark = (on: boolean) => (on ? "✓ " : " ");
  const choose = (fn: () => void) => () => { fn(); setTools(false); };
  const newer = frozen !== null && mtime !== frozen;

  return (
    <div className={`syncpdf${leading || pinned ? " always" : ""}`}
         onMouseEnter={() => { hovering.current = true; }} onMouseLeave={() => { hovering.current = false; }}>
      <div className="synctools" role="toolbar" aria-label="PDF tools">
        {leading}
        {leading && <span className="syncgrow" />}
        {onPin && <button aria-label={pinned ? "Unpin the toolbar (hide it automatically)" : "Pin the toolbar (keep it visible)"} aria-pressed={!!pinned} onClick={onPin}>📌</button>}
        <button aria-label="Toggle sidebar" aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)} ><Icon name="sidebar" /></button>
        <button aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - perRow)}><Icon name="left" /></button>
        <button aria-label="Next page" disabled={current >= pages.length} onClick={() => goTo(current + perRow)}><Icon name="right" /></button>
        <button aria-label="Find in the PDF" aria-pressed={findOpen} onClick={() => setFindOpen(!findOpen)} ><Icon name="search" /></button>
        <button aria-label="Previous match" disabled={!flat.length} onClick={() => moveHit(-1)}><Icon name="up" /></button>
        <button aria-label="Next match" disabled={!flat.length} onClick={() => moveHit(1)}><Icon name="down" /></button>
        <input className="syncpageno" aria-label="Page number" value={pageText} inputMode="numeric"
               onChange={(e) => setPageText(e.target.value.replace(/\D/g, ""))}
               onKeyDown={(e) => { if (e.key === "Enter") goTo(parseInt(pageText || "1", 10)); }}
               onBlur={() => setPageText(String(current))} />
        <span className="syncof">of {pages.length}</span>
        <span className="syncgrow" />
        {newer && <button className="syncnew" onClick={() => setAuto(true)} title="A newer build exists">↻ Newer build</button>}
        <button aria-label="Zoom out" onClick={() => step(-1)} disabled={percent <= PERCENTS[0]}><Icon name="minus" /></button>
        <button aria-label="Zoom in" onClick={() => step(1)} disabled={percent >= PERCENTS[PERCENTS.length - 1]}><Icon name="plus" /></button>
        <select aria-label="Zoom" value={typeof zoom === "number" ? String(zoom) : zoom}
                onChange={(e) => { const v = e.target.value; setZoom(["auto", "width", "fit"].includes(v) ? (v as Zoom) : Number(v)); }}>
          <option value="auto">Automatic Zoom</option>
          <option value="fit">Page Fit</option>
          <option value="width">Page Width</option>
          {PERCENTS.map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
        <span className="synctoolsmenu" ref={menuBox}>
          <button aria-label="Tools" aria-expanded={tools} onClick={() => setTools(!tools)} ><Icon name="more" /></button>
          {tools && (
            <div className="syncmenu" role="menu">
              <button role="menuitem" disabled={current <= 1} onClick={choose(() => goTo(1))}>⤒ Go to First Page</button>
              <button role="menuitem" disabled={current >= pages.length} onClick={choose(() => goTo(pages.length))}>⤓ Go to Last Page</button>
              <hr />
              <button role="menuitem" onClick={choose(() => turn(90))}>↻ Rotate Clockwise</button>
              <button role="menuitem" onClick={choose(() => turn(-90))}>↺ Rotate Anti-Clockwise</button>
              <hr />
              <button role="menuitemradio" aria-checked={tool === "select"} onClick={choose(() => setTool("select"))}>{mark(tool === "select")}Text Selection Tool</button>
              <button role="menuitemradio" aria-checked={tool === "hand"} onClick={choose(() => setTool("hand"))}>{mark(tool === "hand")}Hand Tool</button>
              <hr />
              <button role="menuitemradio" aria-checked={scrolling === "page"} onClick={choose(() => { setScrolling("page"); goTo(current); })}>{mark(scrolling === "page")}Page Scrolling</button>
              <button role="menuitemradio" aria-checked={scrolling === "vertical"} onClick={choose(() => setScrolling("vertical"))}>{mark(scrolling === "vertical")}Vertical Scrolling</button>
              <button role="menuitemradio" aria-checked={scrolling === "horizontal"} onClick={choose(() => { setScrolling("horizontal"); setSpread("none"); })}>{mark(scrolling === "horizontal")}Horizontal Scrolling</button>
              <button role="menuitemradio" aria-checked={scrolling === "wrapped"} onClick={choose(() => { setScrolling("wrapped"); setSpread("none"); })}>{mark(scrolling === "wrapped")}Wrapped Scrolling</button>
              <hr />
              <button role="menuitemradio" aria-checked={spread === "none"} onClick={choose(() => setSpread("none"))}>{mark(spread === "none")}No Spreads</button>
              <button role="menuitemradio" aria-checked={spread === "odd"} onClick={choose(() => { setSpread("odd"); if (scrolling !== "page") setScrolling("vertical"); })}>{mark(spread === "odd")}Odd Spreads</button>
              <button role="menuitemradio" aria-checked={spread === "even"} onClick={choose(() => { setSpread("even"); if (scrolling !== "page") setScrolling("vertical"); })}>{mark(spread === "even")}Even Spreads</button>
              <hr />
              <button role="menuitemcheckbox" aria-checked={syncOn} onClick={() => setSyncOn(!syncOn)}>{syncOn ? "☑" : "☐"} Enable SyncTeX</button>
              <button role="menuitemcheckbox" aria-checked={autoRefresh} onClick={() => setAuto(!autoRefresh)}>{autoRefresh ? "☑" : "☐"} Enable auto-refresh</button>
              <hr />
              <button role="menuitem" onClick={choose(() => setPropsOpen(true))}>ⓘ Document Properties…</button>
              <a role="menuitem" href={`/api/v1${base}/main.pdf?download=true`} download onClick={() => setTools(false)}>⬇ Download PDF</a>
            </div>
          )}
        </span>
        {findOpen && (
          <form className="syncfind" onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            if (q.length < 2) return;
            if (found && found.q === q && flat.length) moveHit(shiftDown.current ? -1 : 1);       // Enter again: the next match (Shift+Enter: the previous)
            else search.mutate(q);
          }}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in the PDF…" aria-label="Find in the PDF"
                   onKeyDown={(e) => {
                     shiftDown.current = e.shiftKey;
                     if (e.key === "Escape") { e.stopPropagation(); setFindOpen(false); setFound(null); setQuery(""); }
                   }} />
            <span className="syncof">{search.isPending ? "Searching…" : found ? (flat.length ? `${hit + 1} of ${flat.length}` : "Not found") : ""}</span>
          </form>
        )}
      </div>

      {err && !onNotice && <div className="stwarn syncwarn">{err.message}{err.hint ? ` ${err.hint}` : ""}</div>}
      <div className="syncbody">
        {sidebar && (
          <nav className="syncthumbs" aria-label="Pages">
            {pages.map((size, i) => (
              <button key={i} className={i + 1 === current ? "on" : ""} onClick={() => goTo(i + 1)} aria-label={`Page ${i + 1}`}>
                <img loading="lazy" alt="" src={img(i + 1, 0.4)} style={{ aspectRatio: `${turned(size)[0]} / ${turned(size)[1]}` }} />
                <span>{i + 1}</span>
              </button>
            ))}
          </nav>
        )}
        <div className={`syncpages mode-${scrolling}${tool === "hand" ? " hand" : ""}`} ref={scroller} tabIndex={0}
             onScroll={onScroll} onMouseDown={down} onMouseMove={move} onMouseUp={() => { drag.current = null; }}
             onMouseLeave={() => { drag.current = null; }}>
          {info.isPending && <p className="muted">Loading the PDF…</p>}
          {info.error && <div className="stinfo">There is no PDF yet. Save and rebuild to create it.</div>}
          {rows.map((row) => (
            <div key={row.join("-")} className="syncrow">
              {row.map((n) => {
                const size = pages[n - 1];
                const s = scaleFor(size);
                const [rw, rh] = turned(size);
                const marks = flat.map((m, idx) => ({ ...m, idx })).filter((m) => m.page === n);
                if (tool === "select") needWords(n);
                return (
                  <div key={n} data-page={n} className="syncpagewrap" style={{ width: rw * s, height: rh * s }}>
                    <img loading="lazy" className="syncpage" alt={`Page ${n}`} src={img(n, quality(s))} draggable={false}
                         style={{ width: rw * s, height: rh * s }} />
                    <div className="synctext" onClick={(e) => click(e, n, size)} onDoubleClick={(e) => click(e, n, size, true)} title={syncOn ? "Click or double-click a word to jump to it in the source" : undefined}>
                      {tool === "select" && pageLines(words[n] ?? [], (r) => { const v = viewRect(r, rot, size[0], size[1]); return { x: v.x * s, y: v.y * s, w: v.w * s, h: v.h * s }; })
                        .map((L) => <TextLine key={L.key} text={L.text} x={L.x} y={L.y} w={L.w} h={L.h} />)}
                    </div>
                    {flash && flash.page === n && (() => {
                      const v = viewRect([flash.x, flash.y, flash.x + Math.max(flash.w, 60), flash.y + flash.h], rot, size[0], size[1]);
                      return <span className="syncflash" style={{ left: v.x * s - 4, top: v.y * s - 2, width: v.w * s + 8, height: v.h * s + 4 }} />;
                    })()}
                    {marks.map((m) => {
                      const v = viewRect(m.r, rot, size[0], size[1]);
                      return <span key={m.idx} className={`synchit${m.idx === hit ? " on" : ""}`}
                                   style={{ left: v.x * s, top: v.y * s, width: v.w * s, height: v.h * s }} />;
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {propsOpen && (
        <Modal title="Document Properties" onClose={() => setPropsOpen(false)}>
          {props.isPending ? <p className="muted">Loading…</p> : props.data ? (
            <dl className="syncprops">
              <dt>File name</dt><dd>{props.data.file}</dd>
              <dt>File size</dt><dd>{kb(props.data.bytes)}</dd>
              <dt>Title</dt><dd>{props.data.metadata.title || "–"}</dd>
              <dt>Author</dt><dd>{props.data.metadata.author || "–"}</dd>
              <dt>Subject</dt><dd>{props.data.metadata.subject || "–"}</dd>
              <dt>Keywords</dt><dd>{props.data.metadata.keywords || "–"}</dd>
              <dt>Created with</dt><dd>{props.data.metadata.creator || "–"}</dd>
              <dt>PDF producer</dt><dd>{props.data.metadata.producer || "–"}</dd>
              <dt>Page count</dt><dd>{props.data.pages}</dd>
              <dt>Page size</dt>
              <dd>{props.data.pageSize ? `${(props.data.pageSize[0] / 72 * 25.4).toFixed(0)} × ${(props.data.pageSize[1] / 72 * 25.4).toFixed(0)} mm (${props.data.pageSize[0]} × ${props.data.pageSize[1]} pt)` : "–"}</dd>
              <dt>Built</dt><dd>{new Date(props.data.built * 1000).toLocaleString()}</dd>
            </dl>
          ) : <p className="muted">The properties could not be read.</p>}
        </Modal>
      )}
    </div>
  );
}
