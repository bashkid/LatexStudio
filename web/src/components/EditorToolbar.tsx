import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "./Icons";
import { FIGURE_SNIPPET, SYMBOLS, TEXT_STYLES } from "./latexSyntax";

type Mode = "code" | "visual";
export type EditMode = "editing" | "review" | "viewing";

function Menu({ icon, label, children, wide = false, align = "left" }: {
  icon: ReactNode; label: string; children: (close: () => void) => ReactNode; wide?: boolean; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <span className="etmenu" ref={ref}>
      <button type="button" aria-label={label} aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>{icon}</button>
      {open && <div className={`etpanel${wide ? " wide" : ""}${align === "right" ? " right" : ""}`} role="menu">{children(() => setOpen(false))}</div>}
    </span>
  );
}

const EDIT_MODES: { id: EditMode; icon: string; label: string; note: string }[] = [
  { id: "editing", icon: "pencil", label: "Editing", note: "Edit the paper directly" },
  { id: "review", icon: "message", label: "Review", note: "Your edits become suggestions to accept or reject" },
  { id: "viewing", icon: "eye", label: "Viewing", note: "Read only" },
];

/** An Overleaf-style toolbar for the LaTeX editor. It never wraps: what does not fit moves into a ⋯ menu. */
export default function EditorToolbar(p: {
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  onStyle: (cmd: string) => void; onWrap: (before: string, after: string, placeholder?: string) => void; onInsert: (snippet: string) => void;
  onComment: () => void; onList: (ordered: boolean) => void; onMathImage: () => void; cites: string[]; labels: string[];
  mode: Mode; onMode: (m: Mode) => void; editMode: EditMode; onEditMode: (m: EditMode) => void; onFind: () => void; disabled: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // 0: everything; 1: lists, comment and label move to ⋯; 2: links, citations, figure and table too; 3: formatting too
  const tier = width >= 700 ? 0 : width >= 580 ? 1 : width >= 470 ? 2 : 3;
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(2);
  const current = EDIT_MODES.find((m) => m.id === p.editMode) ?? EDIT_MODES[0];

  const btn = (icon: ReactNode, label: string, onClick: () => void, extra: { disabled?: boolean; cls?: string } = {}) => (
    <button type="button" className={extra.cls} aria-label={label} disabled={p.disabled || extra.disabled}
            onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon}</button>
  );
  const figure = () => p.onInsert(FIGURE_SNIPPET);
  const tableMenu = (
    <Menu icon={<Icon name="table" />} label="Insert a table">
      {(close) => (
        <form className="ettable" onSubmit={(e) => { e.preventDefault(); p.onInsert(`@table:${cols}x${rows}`); close(); }}>
          <input type="number" min={1} max={12} value={rows} aria-label="Rows" title="Rows" autoFocus
                 onChange={(e) => setRows(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} />
          <span aria-hidden="true">×</span>
          <input type="number" min={1} max={8} value={cols} aria-label="Columns" title="Columns"
                 onChange={(e) => setCols(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} />
          <button type="submit" className="ettable-go" aria-label="Insert the table"><Icon name="arrowRight" size={14} /></button>
        </form>
      )}
    </Menu>
  );
  const linkMenu = (
    <Menu icon={<Icon name="link" />} label="Insert a link or cross-reference">
      {(close) => (
        <>
          <button role="menuitem" onClick={() => { p.onWrap("\\url{", "}", "https://"); close(); }}>Web link (\url)</button>
          <button role="menuitem" onClick={() => { p.onWrap("\\href{https://}{", "}", "text"); close(); }}>Link with text (\href)</button>
          <hr />
          {p.labels.length === 0 && <span className="etnote">No labels in the paper yet</span>}
          {p.labels.slice(0, 40).map((l) => <button key={l} role="menuitem" onClick={() => { p.onInsert(`\\ref{${l}}|`); close(); }}>{`\\ref{${l}}`}</button>)}
        </>
      )}
    </Menu>
  );
  const citeMenu = (
    <Menu icon={<Icon name="book" />} label="Insert a citation">
      {(close) => (
        <>
          {p.cites.length === 0 && <span className="etnote">No keys in references.bib yet</span>}
          {p.cites.slice(0, 60).map((k) => <button key={k} role="menuitem" onClick={() => { p.onInsert(`\\cite{${k}}|`); close(); }}>{k}</button>)}
        </>
      )}
    </Menu>
  );
  const listMenu = (
    <Menu icon={<Icon name="list" />} label="Lists">
      {(close) => (
        <>
          <button role="menuitem" onClick={() => { p.onList(false); close(); }}>Bulleted list</button>
          <button role="menuitem" onClick={() => { p.onList(true); close(); }}>Numbered list</button>
        </>
      )}
    </Menu>
  );

  return (
    <div className="edtoolbar" role="toolbar" aria-label="Editor tools" ref={bar}>
      <i className="etsep" />
      {btn(<Icon name="undo" />, "Undo (Ctrl+Z)", p.onUndo, { disabled: !p.canUndo })}
      {btn(<Icon name="redo" />, "Redo (Ctrl+Y)", p.onRedo, { disabled: !p.canRedo })}
      <i className="etsep" />
      <Menu icon={<span className="etnowrap"><Icon name="type" /><Icon name="chevronDown" size={12} /></span>} label="Text style">
        {(close) => TEXT_STYLES.map((s) => <button key={s.id} role="menuitem" onClick={() => { p.onStyle(s.cmd); close(); }}>{s.label}</button>)}
      </Menu>
      {tier < 3 && <>
        <i className="etsep" />
        {btn(<Icon name="bold" />, "Bold (Ctrl+B)", () => p.onWrap("\\textbf{", "}", "bold"))}
        {btn(<Icon name="italic" />, "Italic (Ctrl+I)", () => p.onWrap("\\textit{", "}", "italic"))}
      </>}
      {tier < 2 && <>
        <i className="etsep" />
        <Menu icon={<Icon name="sigma" />} label="Insert maths">
          {(close) => {
            const pick = (fn: () => void) => () => { fn(); close(); };
            return (
              <>
                <button role="menuitem" onClick={pick(() => p.onWrap("$", "$", "x"))}>Inline maths <small>$ … $</small></button>
                <button role="menuitem" onClick={pick(() => p.onWrap("\\[ ", " \\]", "x"))}>Display equation <small>\[ … \]</small></button>
                <button role="menuitem" onClick={pick(() => p.onInsert("\\begin{equation}\n    |\n    \\label{eq:placeholder}\n\\end{equation}"))}>Numbered equation</button>
                <button role="menuitem" onClick={pick(() => p.onInsert("\\begin{align}\n    | &= \\\\\n    &= \n\\end{align}"))}>Aligned equations</button>
                <hr />
                <button role="menuitem" onClick={pick(() => p.onInsert("\\frac{|}{}"))}>Fraction <small>\frac</small></button>
                <button role="menuitem" onClick={pick(() => p.onInsert("\\sqrt{|}"))}>Square root <small>\sqrt</small></button>
                <button role="menuitem" onClick={pick(() => p.onInsert("\\sum_{i=1}^{n} |"))}>Sum <small>\sum</small></button>
                <button role="menuitem" onClick={pick(() => p.onInsert("\\int_{a}^{b} | \\,\\mathrm{d}x"))}>Integral <small>\int</small></button>
                <button role="menuitem" onClick={pick(() => p.onInsert("_{|}"))}>Subscript <small>_</small></button>
                <button role="menuitem" onClick={pick(() => p.onInsert("^{|}"))}>Superscript <small>^</small></button>
                <hr />
                <button role="menuitem" onClick={pick(p.onMathImage)}><Icon name="image" size={14} /> Math from an image…</button>
              </>
            );
          }}
        </Menu>
        <Menu icon={<span className="etomega">Ω</span>} label="Insert a symbol" wide>
          {(close) => (
            <div className="etsymbols">
              {SYMBOLS.map((s) => <button key={s.tex} aria-label={s.tex} onClick={() => { p.onInsert(`${s.tex}|`); close(); }}>{s.label}</button>)}
            </div>
          )}
        </Menu>
        <i className="etsep" />
        {linkMenu}
        {tier < 1 && btn(<span className="etpct">%</span>, "Comment out the selected lines (%)", p.onComment)}
        {tier < 1 && btn(<Icon name="tag" />, "Insert a label", () => p.onInsert("\\label{|}"))}
        {citeMenu}
        {btn(<Icon name="image" />, "Insert a figure", figure)}
        {tableMenu}
        {tier < 1 && <><i className="etsep" />{listMenu}</>}
      </>}
      {tier > 0 && (
        <Menu icon={<Icon name="more" />} label="More tools">
          {(close) => (
            <>
              {tier >= 3 && <>
                <button role="menuitem" onClick={() => { p.onWrap("\\textbf{", "}", "bold"); close(); }}>Bold</button>
                <button role="menuitem" onClick={() => { p.onWrap("\\textit{", "}", "italic"); close(); }}>Italic</button>
              </>}
              {tier >= 2 && <>
                <button role="menuitem" onClick={() => { p.onWrap("$", "$", "x"); close(); }}>Inline maths</button>
                <button role="menuitem" onClick={() => { p.onMathImage(); close(); }}>Math from an image…</button>
                <button role="menuitem" onClick={() => { p.onWrap("\\url{", "}", "https://"); close(); }}>Web link</button>
                <button role="menuitem" onClick={() => { figure(); close(); }}>Figure</button>
                <button role="menuitem" onClick={() => { p.onInsert(`@table:${cols}x${rows}`); close(); }}>Table ({cols}×{rows})</button>
                {p.cites.slice(0, 12).map((k) => <button key={k} role="menuitem" onClick={() => { p.onInsert(`\\cite{${k}}|`); close(); }}>Cite {k}</button>)}
              </>}
              <button role="menuitem" onClick={() => { p.onComment(); close(); }}>Comment out lines</button>
              <button role="menuitem" onClick={() => { p.onInsert("\\label{|}"); close(); }}>Label</button>
              <button role="menuitem" onClick={() => { p.onList(false); close(); }}>Bulleted list</button>
              <button role="menuitem" onClick={() => { p.onList(true); close(); }}>Numbered list</button>
            </>
          )}
        </Menu>
      )}
      <span className="etgrow" />
      <span className="etmode" role="group" aria-label="Editor mode">
        <button aria-label="Code view" className={p.mode === "code" ? "on" : ""} aria-pressed={p.mode === "code"} onClick={() => p.onMode("code")}>Code</button>
        <button aria-label="Visual view (read only)" className={p.mode === "visual" ? "on" : ""} aria-pressed={p.mode === "visual"} onClick={() => p.onMode("visual")}>Visual</button>
      </span>
      <Menu icon={<span className="etnowrap"><Icon name={current.icon} /><Icon name="chevronDown" size={12} /></span>} label={`Mode: ${current.label}`} align="right">
        {(close) => EDIT_MODES.map((m) => (
          <button key={m.id} role="menuitemradio" aria-checked={p.editMode === m.id} className="etmode-item" onClick={() => { p.onEditMode(m.id); close(); }}>
            <span className="etmi">{p.editMode === m.id ? <Icon name="save2" size={14} /> : <i className="etgap" />}<Icon name={m.icon} size={14} /> <b>{m.label}</b></span><small>{m.note}</small>
          </button>
        ))}
      </Menu>
      {btn(<Icon name="search" />, "Find and replace (Ctrl+F)", p.onFind)}
    </div>
  );
}
