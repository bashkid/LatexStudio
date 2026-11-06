// Syntax completion for the LaTeX editor: commands, environments, citation keys and labels. Local and instant: no AI.

export type Item = {
  label: string; detail: string; insert: string;     // `insert` may contain | where the cursor goes
  tag?: string;                                      // right-hand category: env, Greek, cmd, ref, math …
  display?: string;                                  // what the list shows (`\\begin{}`), defaults to label
  glyph?: string;                                    // a symbol preview (β)
};
export type Symbols = { cites: string[]; labels: string[] };
export type Completion = { from: number; to: number; items: Item[] };

const cmd = (name: string, detail: string, tail = ""): Item => ({ label: `\\${name}`, detail, insert: `\\${name}${tail}` });

const COMMANDS: Item[] = [
  cmd("section", "Section heading", "{|}"), cmd("subsection", "Subsection heading", "{|}"), cmd("subsubsection", "Sub-subsection", "{|}"),
  cmd("paragraph", "Run-in paragraph heading", "{|}"), cmd("chapter", "Chapter heading", "{|}"),
  cmd("begin", "Open an environment", "{|}"), cmd("end", "Close an environment", "{|}"),
  cmd("cite", "Citation", "{|}"), cmd("citep", "Parenthetical citation", "{|}"), cmd("citet", "Textual citation", "{|}"),
  cmd("ref", "Cross-reference", "{|}"), cmd("eqref", "Equation reference", "{|}"), cmd("autoref", "Typed reference", "{|}"),
  cmd("label", "Label", "{|}"), cmd("caption", "Caption", "{|}"), cmd("footnote", "Footnote", "{|}"),
  cmd("textbf", "Bold", "{|}"), cmd("textit", "Italic", "{|}"), cmd("emph", "Emphasis", "{|}"), cmd("texttt", "Monospace", "{|}"),
  cmd("textsc", "Small caps", "{|}"), cmd("underline", "Underline", "{|}"), cmd("url", "URL", "{|}"), cmd("href", "Hyperlink", "{|}{}"),
  cmd("includegraphics", "Include an image", "[width=\\linewidth]{|}"), cmd("centering", "Centre the contents"),
  cmd("item", "List item", " |"), cmd("input", "Include a file", "{|}"), cmd("usepackage", "Load a package", "{|}"),
  cmd("title", "Title", "{|}"), cmd("author", "Author", "{|}"), cmd("date", "Date", "{|}"), cmd("maketitle", "Print the title"),
  cmd("tableofcontents", "Table of contents"), cmd("bibliography", "Bibliography file", "{|}"), cmd("bibliographystyle", "Bibliography style", "{|}"),
  cmd("newcommand", "Define a command", "{\\|}{}"), cmd("renewcommand", "Redefine a command", "{\\|}{}"),
  cmd("frac", "Fraction", "{|}{}"), cmd("sqrt", "Square root", "{|}"), cmd("sum", "Sum"), cmd("prod", "Product"), cmd("int", "Integral"),
  cmd("mathbf", "Bold maths", "{|}"), cmd("mathrm", "Roman maths", "{|}"), cmd("mathcal", "Calligraphic", "{|}"), cmd("mathbb", "Blackboard bold", "{|}"),
  cmd("alpha", "α"), cmd("beta", "β"), cmd("gamma", "γ"), cmd("delta", "δ"), cmd("lambda", "λ"), cmd("theta", "θ"), cmd("sigma", "σ"),
  cmd("times", "×"), cmd("cdot", "·"), cmd("leq", "≤"), cmd("geq", "≥"), cmd("approx", "≈"), cmd("rightarrow", "→"), cmd("infty", "∞"),
  cmd("hline", "Table rule"), cmd("toprule", "Top rule (booktabs)"), cmd("midrule", "Middle rule (booktabs)"), cmd("bottomrule", "Bottom rule (booktabs)"),
  cmd("multicolumn", "Span columns", "{|}{}{}"), cmd("multirow", "Span rows", "{|}{}{}"),
  cmd("textwidth", "Text width"), cmd("linewidth", "Line width"), cmd("newpage", "New page"), cmd("clearpage", "Flush floats"),
  cmd("vspace", "Vertical space", "{|}"), cmd("hspace", "Horizontal space", "{|}"), cmd("noindent", "No indent"),
  cmd("PH", "Placeholder for the author", "{|}"), cmd("ImagePH", "Image placeholder", "{|}{}"),
];

const ENVIRONMENTS = ["document", "abstract", "figure", "figure*", "table", "table*", "tabular", "tabularx", "equation", "equation*", "align",
  "align*", "itemize", "enumerate", "description", "verbatim", "center", "minipage", "tikzpicture", "algorithm", "algorithmic", "lstlisting",
  "quote", "theorem", "lemma", "proof", "definition", "thebibliography", "cases", "array", "subfigure", "flushleft", "flushright"];

const I = "    ";                                              // one indent level in the inserted templates
const block = (env: string, body: string[]) => `\\begin{${env}}\n${body.map((l) => (l ? I + l : l)).join("\n")}\n\\end{${env}}`;

/** Full environments, inserted whole when `\begin{name` is completed. `|` marks where the cursor lands. */
export const TEMPLATES: Record<string, { detail: string; text: string }> = {
  figure: { detail: "figure with image, caption and label",
    text: block("figure", ["\\centering", "\\includegraphics[width=0.5\\linewidth]{|}", "\\caption{Caption}", "\\label{fig:placeholder}"]) },
  "figure*": { detail: "full-width figure with caption and label",
    text: block("figure*", ["\\centering", "\\includegraphics[width=0.9\\linewidth]{|}", "\\caption{Caption}", "\\label{fig:placeholder}"]) },
  table: { detail: "table with caption, label and a 3-column tabular",
    text: block("table", ["\\centering", "\\caption{Caption}", "\\label{tab:placeholder}", "\\begin{tabular}{lll}",
      `${I}\\toprule`, `${I}Column 1 & Column 2 & Column 3 \\\\`, `${I}\\midrule`, `${I}| &  &  \\\\`, `${I}\\bottomrule`, "\\end{tabular}"]) },
  "table*": { detail: "full-width table with caption and label",
    text: block("table*", ["\\centering", "\\caption{Caption}", "\\label{tab:placeholder}", "\\begin{tabular}{lll}",
      `${I}\\toprule`, `${I}Column 1 & Column 2 & Column 3 \\\\`, `${I}\\midrule`, `${I}| &  &  \\\\`, `${I}\\bottomrule`, "\\end{tabular}"]) },
  tabular: { detail: "3-column tabular with rules",
    text: block("tabular", ["{lll}"].slice(0, 0).concat([`\\toprule`, `Column 1 & Column 2 & Column 3 \\\\`, `\\midrule`, `| &  &  \\\\`, `\\bottomrule`])).replace("\\begin{tabular}", "\\begin{tabular}{lll}") },
  equation: { detail: "numbered equation with label", text: block("equation", ["|", "\\label{eq:placeholder}"]) },
  align: { detail: "aligned equations", text: block("align", ["| &= \\\\", "\\label{eq:placeholder}"]) },
  itemize: { detail: "bulleted list", text: block("itemize", ["\\item |", "\\item "]) },
  enumerate: { detail: "numbered list", text: block("enumerate", ["\\item |", "\\item "]) },
  description: { detail: "description list", text: block("description", ["\\item[|] ", "\\item[] "]) },
  abstract: { detail: "abstract", text: block("abstract", ["|"]) },
  tikzpicture: { detail: "TikZ drawing", text: block("tikzpicture", ["\\node[draw] (a) {|};"]) },
  algorithm: { detail: "algorithm with caption and label", text: block("algorithm", ["\\caption{Caption}", "\\label{alg:placeholder}", "\\begin{algorithmic}[1]", `${I}\\State |`, "\\end{algorithmic}"]) },
  minipage: { detail: "mini page of half the width", text: block("minipage", ["|"]).replace("\\begin{minipage}", "\\begin{minipage}{0.48\\textwidth}") },
  lstlisting: { detail: "code listing", text: block("lstlisting", ["|"]).replace("\\begin{lstlisting}", "\\begin{lstlisting}[language=Python]") },
  verbatim: { detail: "verbatim text", text: block("verbatim", ["|"]) },
  center: { detail: "centred block", text: block("center", ["|"]) },
  quote: { detail: "quotation", text: block("quote", ["|"]) },
  theorem: { detail: "theorem", text: block("theorem", ["|"]) },
  lemma: { detail: "lemma", text: block("lemma", ["|"]) },
  proof: { detail: "proof", text: block("proof", ["|"]) },
  definition: { detail: "definition", text: block("definition", ["|"]) },
  document: { detail: "document body", text: block("document", ["|"]) },
};

const GREEK: [string, string][] = [["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ε"], ["varepsilon", "ɛ"], ["zeta", "ζ"],
  ["eta", "η"], ["theta", "θ"], ["iota", "ι"], ["kappa", "κ"], ["lambda", "λ"], ["mu", "μ"], ["nu", "ν"], ["xi", "ξ"], ["pi", "π"], ["rho", "ρ"],
  ["sigma", "σ"], ["tau", "τ"], ["upsilon", "υ"], ["phi", "φ"], ["varphi", "ϕ"], ["chi", "χ"], ["psi", "ψ"], ["omega", "ω"],
  ["Gamma", "Γ"], ["Delta", "Δ"], ["Theta", "Θ"], ["Lambda", "Λ"], ["Xi", "Ξ"], ["Pi", "Π"], ["Sigma", "Σ"], ["Phi", "Φ"], ["Psi", "Ψ"], ["Omega", "Ω"]];
const TAG_OF: Record<string, string> = {
  section: "sectioning", subsection: "sectioning", subsubsection: "sectioning", paragraph: "sectioning", chapter: "sectioning",
  begin: "env", end: "env", cite: "ref", citep: "ref", citet: "ref", ref: "ref", eqref: "ref", autoref: "ref", label: "ref",
  textbf: "format", textit: "format", emph: "format", texttt: "format", textsc: "format", underline: "format",
  frac: "math", sqrt: "math", sum: "math", prod: "math", int: "math", mathbf: "math", mathrm: "math", mathcal: "math", mathbb: "math",
  times: "math", cdot: "math", leq: "math", geq: "math", approx: "math", rightarrow: "math", infty: "math",
  usepackage: "package", documentclass: "package", includegraphics: "graphics", caption: "float",
};
const display = (i: Item) => i.display ?? i.insert.replace("|", "");
const greekItems: Item[] = GREEK.map(([n, g]) => ({ label: `\\${n}`, insert: `\\${n}`, detail: "", tag: "Greek", glyph: g }));
const envItems = (): Item[] => Array.from(new Set([...ENVIRONMENTS, ...Object.keys(TEMPLATES)])).map((e) => {
  const t = TEMPLATES[e];
  return { label: `\\begin{${e}}`, display: `\\begin{${e}} …`, insert: t ? t.text : block(e, ["|"]), detail: t?.detail ?? "environment", tag: "env" };
});

const take = (items: Item[], prefix: string, limit = 8) =>
  items.filter((i) => i.label.toLowerCase().startsWith(prefix.toLowerCase()) && i.label !== prefix).slice(0, limit);

/** What can be completed at the cursor `pos` of `text`, or null. */
export function completionAt(text: string, pos: number, sym: Symbols): Completion | null {
  const line = text.slice(text.lastIndexOf("\n", pos - 1) + 1, pos);

  const arg = line.match(/\\(cite[a-zA-Z]*|ref|eqref|autoref|cref|Cref|pageref)\*?(?:\[[^\]]*\])*\{([^}]*)$/);
  if (arg) {                                                       // inside the braces of \cite{…} or \ref{…}
    const isCite = arg[1].startsWith("cite");
    const pool = isCite ? sym.cites : sym.labels;
    const typed = arg[2].slice(arg[2].lastIndexOf(",") + 1).trimStart();
    const from = pos - typed.length;
    const items = pool.filter((k) => k.toLowerCase().includes(typed.toLowerCase()) && k !== typed).slice(0, 8)
      .map((k) => ({ label: k, detail: isCite ? "citation key" : "label", insert: k }));
    return items.length ? { from, to: pos, items } : null;
  }
  const env = line.match(/\\(begin|end)\{([A-Za-z*]*)$/);
  if (env) {                                                       // \begin{ … : environment names
    const typed = env[2];
    const names = Array.from(new Set([...ENVIRONMENTS, ...Object.keys(TEMPLATES)]));
    const indent = (line.match(/^\s*/) ?? [""])[0];
    const items = names.filter((e) => e.startsWith(typed) && e !== typed).slice(0, 8).map((e) => {
      if (env[1] === "end") return { label: e, detail: "close", insert: `${e}}` };
      const t = TEMPLATES[e];
      const text = t ? t.text : block(e, ["|"]);
      return { label: e, detail: t ? t.detail : "environment", insert: text.split("\n").map((l, i) => (i ? indent + l : l)).join("\n") };
    });
    // a begin-completion replaces the whole `\begin{typed` with the full template; `\end{typed` only the name
    return items.length ? { from: env[1] === "begin" ? pos - env[0].length : pos - typed.length, to: pos, items } : null;
  }
  const c = line.match(/\\([A-Za-z@]*)$/);
  if (c && c[0].length >= 2) {                                     // \be … : commands, Greek letters and environment templates
    const indent = (line.match(/^\s*/) ?? [""])[0];
    const commands = COMMANDS.map((i) => ({ ...i, tag: TAG_OF[i.label.slice(1)] ?? "cmd" }));
    const envs = envItems().map((i) => ({ ...i, insert: i.insert.split("\n").map((l, k) => (k ? indent + l : l)).join("\n") }));
    const items = [...take(commands, c[0], 12), ...take(greekItems, c[0], 8), ...take(envs, c[0], 14)].slice(0, 30);
    return items.length ? { from: pos - c[0].length, to: pos, items } : null;
  }
  return null;
}

/** Apply a completion: the new text and where the cursor goes (at `|` in the insert, else after it). */
export { display as itemDisplay };

export function applyCompletion(text: string, c: Completion, item: Item): { text: string; caret: number } {
  const bar = item.insert.indexOf("|");
  const body = item.insert.replace("|", "");
  return { text: text.slice(0, c.from) + body + text.slice(c.to), caret: c.from + (bar >= 0 ? bar : body.length) };
}

// ---- the toolbar's helpers ------------------------------------------------------------------------------------

export const SYMBOLS: { label: string; tex: string }[] = [
  ["α", "\\alpha"], ["β", "\\beta"], ["γ", "\\gamma"], ["δ", "\\delta"], ["ε", "\\epsilon"], ["θ", "\\theta"], ["λ", "\\lambda"],
  ["μ", "\\mu"], ["π", "\\pi"], ["σ", "\\sigma"], ["φ", "\\phi"], ["ω", "\\omega"], ["Δ", "\\Delta"], ["Σ", "\\Sigma"], ["Ω", "\\Omega"],
  ["±", "\\pm"], ["×", "\\times"], ["÷", "\\div"], ["·", "\\cdot"], ["≤", "\\leq"], ["≥", "\\geq"], ["≠", "\\neq"], ["≈", "\\approx"],
  ["∞", "\\infty"], ["∈", "\\in"], ["∑", "\\sum"], ["∫", "\\int"], ["√", "\\sqrt{}"], ["→", "\\rightarrow"], ["⇒", "\\Rightarrow"],
  ["∀", "\\forall"], ["∃", "\\exists"], ["∂", "\\partial"], ["∇", "\\nabla"],
].map(([label, tex]) => ({ label, tex }));

export const TEXT_STYLES = [
  { id: "normal", label: "Normal text", cmd: "" }, { id: "section", label: "Section", cmd: "section" },
  { id: "subsection", label: "Subsection", cmd: "subsection" }, { id: "subsubsection", label: "Subsubsection", cmd: "subsubsection" },
  { id: "paragraph", label: "Paragraph", cmd: "paragraph" },
];

export const FIGURE_SNIPPET = TEMPLATES.figure.text;
export const tableSnippet = (cols: number, rows: number): string => {
  const head = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(" & ");
  const body = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "").join(" & ")).join(" \\\\\n    ");
  return `\\begin{table}\n${I}\\centering\n${I}\\caption{Caption}\n${I}\\label{tab:placeholder}\n${I}\\begin{tabular}{${"l".repeat(cols)}}\n${I}${I}\\toprule\n${I}${I}${head} \\\\\n${I}${I}\\midrule\n${I}${I}${body.replace(/^/, "|")} \\\\\n${I}${I}\\bottomrule\n${I}\\end{tabular}\n\\end{table}`;
};

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A read-only, simplified rendering of LaTeX for the "Visual" view. The text is escaped first, so it cannot inject HTML. */
export function visualHtml(tex: string): string {
  let t = tex.replace(/(?<!\\)%.*$/gm, "");
  const body = t.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (body) t = body[1];
  t = esc(t);
  const braced = (cmd: string, open: string, close: string) =>
    (t = t.replace(new RegExp(`\\\\${cmd}\\*?\\{([^{}]*)\\}`, "g"), `${open}$1${close}`));
  braced("section", "<h2>", "</h2>"); braced("subsection", "<h3>", "</h3>"); braced("subsubsection", "<h4>", "</h4>");
  braced("paragraph", "<b>", "</b> "); braced("chapter", "<h1>", "</h1>");
  braced("textbf", "<b>", "</b>"); braced("textit", "<i>", "</i>"); braced("emph", "<i>", "</i>"); braced("texttt", "<code>", "</code>");
  braced("underline", "<u>", "</u>"); braced("textsc", "<span style='font-variant:small-caps'>", "</span>");
  t = t.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, "<blockquote><b>Abstract.</b> $1</blockquote>")
    .replace(/\\begin\{(figure\*?|table\*?)\}[\s\S]*?\\caption\{([^{}]*)\}[\s\S]*?\\end\{\1\}/g, "<div class='vis-float'>▣ <i>$2</i></div>")
    .replace(/\\begin\{(figure\*?|table\*?)\}[\s\S]*?\\end\{\1\}/g, "<div class='vis-float'>▣ float</div>")
    .replace(/\\begin\{itemize\}/g, "<ul>").replace(/\\end\{itemize\}/g, "</ul>")
    .replace(/\\begin\{enumerate\}/g, "<ol>").replace(/\\end\{enumerate\}/g, "</ol>")
    .replace(/\\item\s*/g, "<li>")
    .replace(/\\(?:cite|citep|citet)\*?(?:\[[^\]]*\])*\{([^{}]*)\}/g, "<span class='vis-ref'>[$1]</span>")
    .replace(/\\(?:ref|eqref|autoref)\{([^{}]*)\}/g, "<span class='vis-ref'>($1)</span>")
    .replace(/\\(?:label|centering|noindent|newpage|clearpage|maketitle|usepackage\{[^}]*\}|documentclass(?:\[[^\]]*\])?\{[^}]*\})/g, "")
    .replace(/\\input\{([^{}]*)\}/g, "<div class='vis-float'>↳ $1</div>")
    .replace(/\\PH\{([^{}]*)\}/g, "<span class='vis-ph'>$1</span>")
    .replace(/\$\$([\s\S]*?)\$\$/g, "<div class='vis-math'>$1</div>")
    .replace(/\$([^$\n]+)\$/g, "<span class='vis-math'>$1</span>")
    .replace(/\\\\/g, "<br>")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "")
    .replace(/[{}]/g, "");
  return t.split(/\n\s*\n/).map((p) => (/^\s*<(h\d|ul|ol|blockquote|div)/.test(p) ? p : `<p>${p.trim()}</p>`)).join("\n");
}
