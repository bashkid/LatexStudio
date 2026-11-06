import { useLayoutEffect, useRef, useState } from "react";

const KEYWORDS = new Set(("and as assert async await break class continue def del elif else except finally for from global if import in is lambda "
  + "nonlocal not or pass raise return try while with yield").split(" "));
const CONSTANTS = new Set(["True", "False", "None", "self", "cls"]);
const BUILTINS = new Set(("print len range int float str list dict set tuple bool open zip enumerate sorted min max sum abs round map filter "
  + "isinstance super type any all reversed").split(" "));
const TOKEN = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|[rbfRBF]{0,2}"(?:\\.|[^"\\\n])*"|[rbfRBF]{0,2}'(?:\\.|[^'\\\n])*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)|([\s\S])/g;

/** Python syntax highlighting. Returns spans (text is escaped by React). */
function highlight(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let m: RegExpExecArray | null;
  let prevWord = "";
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const [t, comment, str, num, deco, word] = m;
    let cls = "";
    if (comment) cls = "tk-comment";
    else if (str) cls = "tk-string";
    else if (num) cls = "tk-number";
    else if (deco) cls = "tk-deco";
    else if (word) {
      const after = src[TOKEN.lastIndex];
      if (KEYWORDS.has(word)) cls = "tk-keyword";
      else if (CONSTANTS.has(word)) cls = "tk-const";
      else if (prevWord === "def") cls = "tk-func";
      else if (prevWord === "class") cls = "tk-class";
      else if (BUILTINS.has(word)) cls = "tk-builtin";
      else if (after === "(") cls = "tk-func";
      else if (/^[A-Z][A-Za-z0-9]+$/.test(word)) cls = "tk-class";
      prevWord = word;
    } else if (!/\s/.test(t)) prevWord = "";
    out.push(cls ? <span key={i++} className={cls}>{t}</span> : t);
  }
  return out;
}

const TEX = /(%[^\n]*)|(\\[A-Za-z@]+\*?)|(\$[^$\n]*\$)|(\\[\\{}%&_#$])|([{}[\]])/g;
export type Lang = "python" | "latex" | "plain";

/** LaTeX highlighting: comments, commands, inline maths and braces. */
function highlightTex(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  TEX.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = TEX.exec(src)); ) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const [t, comment, command, math, , brace] = m;
    const cls = comment ? "tk-comment" : command ? "tk-keyword" : math ? "tk-string" : brace ? "tk-builtin" : "tk-const";
    out.push(<span key={i++} className={cls}>{t}</span>);
    last = m.index + t.length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const render = (src: string, lang: Lang) => (lang === "latex" ? highlightTex(src) : lang === "plain" ? src : highlight(src));

/** Read-only code block with line numbers. */
export function CodeView({ code, maxHeight = 420, plain = false, lang }: { code: string; maxHeight?: number; plain?: boolean; lang?: Lang }) {
  const mode: Lang = lang ?? (plain ? "plain" : "python");
  const lines = code.split("\n").length;
  return (
    <div className="vsc" style={{ maxHeight }}>
      <pre className="vsc-gutter" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</pre>
      <pre className="vsc-code"><code>{render(code, mode)}</code></pre>
    </div>
  );
}

/** Editable code: the text area sits over a highlighted copy, so typing keeps the colours. */
export type Ghost = { at: number; text: string };

export default function CodeEditor({ value, onChange, height = 420, label, lang = "python", wrap = false, ghost = null, taRef, anchor = null, overlay, onKeyIntercept, readOnly = false,
                                    onCaret, onAcceptGhost, onDismissGhost, onAssistKey }: {
  value: string; onChange: (v: string) => void; height?: number | string; label: string; lang?: Lang; wrap?: boolean;
  ghost?: Ghost | null;                          // an AI completion shown in grey at the cursor
  taRef?: React.RefObject<HTMLTextAreaElement | null>;   // the text area, so a toolbar can read the cursor
  readOnly?: boolean;                            // viewing: the text can be read and selected, not changed
  anchor?: number | null;                        // an index of the text to anchor floating UI to (the cursor)
  overlay?: (pos: { left: number; top: number; lineBottom: number }) => React.ReactNode;   // floating UI at the anchor
  onKeyIntercept?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;   // true: the page handled the key
  onCaret?: (start: number, end: number) => void;
  onAcceptGhost?: () => void; onDismissGhost?: () => void;
  onAssistKey?: (what: "complete" | "ask") => void;   // Ctrl/Cmd+Space completes, Ctrl/Cmd+K asks about the selection
}) {
  const under = useRef<HTMLPreElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const [anchorPos, setAnchorPos] = useState<{ left: number; top: number; lineBottom: number } | null>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const lines = value.split("\n").length;
  useLayoutEffect(() => {                                       // where the anchor is, relative to the editor
    const m = markerRef.current, st = stackRef.current;
    if (anchor === null || !m || !st) { setAnchorPos(null); return; }
    const a = m.getBoundingClientRect(), b = st.getBoundingClientRect();
    const next = { left: a.left - b.left, top: a.top - b.top, lineBottom: a.bottom - b.top };
    setAnchorPos((p) => (p && Math.abs(p.left - next.left) < 1 && Math.abs(p.top - next.top) < 1 ? p : next));
  });
  const [, setScrollTick] = useState(0);
  const sync = (e: React.UIEvent<HTMLTextAreaElement>) => {
    setScrollTick((n) => n + 1);                                // floating UI follows the text
    const t = e.currentTarget;
    if (under.current) { under.current.scrollTop = t.scrollTop; under.current.scrollLeft = t.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = t.scrollTop;
  };
  // Word wrap: a long line folds onto the next visual line. The line numbers then belong to the highlighted layer (a CSS
  // counter per logical line), so they stay level with the text however many rows a line takes.
  const g = ghost && ghost.at <= value.length ? ghost : null;
  const withGhost = (text: string, offset: number) => {         // `text` starts at `offset` of the whole value
    const marks: { at: number; node: React.ReactNode }[] = [];
    if (anchor !== null && anchor >= offset && anchor <= offset + text.length) marks.push({ at: anchor - offset, node: <span key="m" ref={markerRef} className="vsc-marker" /> });
    if (g && g.at >= offset && g.at <= offset + text.length) marks.push({ at: g.at - offset, node: <span key="g" className="vsc-ghost">{g.text}</span> });
    if (!marks.length) return render(text, lang);
    marks.sort((a, b) => a.at - b.at);
    const out: React.ReactNode[] = [];
    let last = 0;
    marks.forEach((m, i) => { out.push(<span key={`t${i}`}>{render(text.slice(last, m.at), lang)}</span>, m.node); last = m.at; });
    out.push(<span key="tail">{render(text.slice(last), lang)}</span>);
    return <>{out}</>;
  };
  let offset = 0;
  const body = wrap
    ? value.split("\n").map((l, i) => {
      const at = offset;
      offset += l.length + 1;
      const here = (anchor !== null && anchor >= at && anchor <= at + l.length) || (g !== null && g.at >= at && g.at <= at + l.length);
      return <div key={i} className="vsc-line">{l || here ? withGhost(l, at) : "\u200b"}</div>;   // an empty line still carries the cursor marker
    })
    : <>{withGhost(value, 0)}{"\n"}</>;
  return (
    <div className={`vsc editor${wrap ? " wrap" : ""}`} style={{ height }}>
      {!wrap && <pre className="vsc-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</pre>}
      <div className="vsc-stack" ref={stackRef}>
        <pre className="vsc-code under" ref={under} aria-hidden="true"><code>{body}</code></pre>
        <textarea className="vsc-input" ref={taRef} readOnly={readOnly} value={value} spellCheck={false} aria-label={label} wrap={wrap ? "soft" : "off"}
                  onChange={(e) => { onChange(e.target.value); onCaret?.(e.target.selectionStart, e.target.selectionEnd); }} onScroll={sync}
                  onSelect={(e) => onCaret?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
                  onKeyUp={(e) => onCaret?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
                  onClick={(e) => onCaret?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
                  onKeyDown={(e) => {
                    if (onKeyIntercept?.(e)) return;
                    if (g && e.key === "Tab") {                  // accept the grey suggestion and put the cursor after it
                      e.preventDefault();
                      const t = e.currentTarget, end = g.at + g.text.length;
                      onChange(value.slice(0, g.at) + g.text + value.slice(g.at));
                      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = end; });
                      onAcceptGhost?.();
                      return;
                    }
                    if (g && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDismissGhost?.(); return; }
                    if ((e.ctrlKey || e.metaKey) && e.key === " ") { e.preventDefault(); onAssistKey?.("complete"); return; }
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onAssistKey?.("ask"); return; }
                    if (e.key === "Tab") {                      // a tab inserts four spaces, like an editor
                      e.preventDefault();
                      const t = e.currentTarget, s = t.selectionStart;
                      onChange(value.slice(0, s) + "    " + value.slice(t.selectionEnd));
                      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
                    }
                  }} />
        {overlay && overlay(anchorPos ?? { left: 64, top: 12, lineBottom: 36 })}
      </div>
    </div>
  );
}
