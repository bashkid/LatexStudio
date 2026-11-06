// From a word clicked in the PDF to that word in the LaTeX source.
export type WordHint = { word: string; prev?: string; next?: string };

const LIGATURES: Record<string, string> = { "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "’": "'", "‘": "'" };

/** A PDF word as it is typed in the source: ligatures undone, punctuation at the ends removed. */
export const normalizeWord = (w: string): string =>
  w.replace(/[ﬁﬂﬀﬃﬄ’‘]/g, (c) => LIGATURES[c] ?? c).replace(/­/g, "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The [start, end) of the clicked word in `text`, searched around `line` (1-based, where SyncTeX put the click) and
 * chosen by the words next to it: a repeated word is told apart by what comes before and after it in the PDF.
 */
export function findWord(text: string, line: number, hint: WordHint, radius = 3): [number, number] | null {
  const word = normalizeWord(hint.word);
  if (word.length < 2) return null;
  const lines = text.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const l of lines) { offsets.push(at); at += l.length + 1; }
  const from = Math.max(0, line - 1 - radius), to = Math.min(lines.length - 1, line - 1 + radius);
  const prev = normalizeWord(hint.prev ?? ""), next = normalizeWord(hint.next ?? "");
  const wordRe = new RegExp(`(?<![\\p{L}\\p{N}\\\\])${esc(word)}(?![\\p{L}\\p{N}])`, "giu");
  let best: { score: number; start: number; end: number } | null = null;
  for (let i = from; i <= to; i++) {
    for (const m of lines[i].matchAll(wordRe)) {
      if (lines[i].slice(0, m.index).trim().startsWith("%") ) continue;                // a comment line is not in the PDF
      const start = offsets[i] + (m.index ?? 0), end = start + m[0].length;
      // what surrounds it in the source, across line ends and LaTeX braces/commands
      const before = text.slice(Math.max(0, start - 60), start).replace(/\\[A-Za-z]+\*?|[{}~$\\]/g, " ");
      const after = text.slice(end, end + 60).replace(/\\[A-Za-z]+\*?|[{}~$\\]/g, " ");
      let score = -Math.abs(i - (line - 1));
      if (prev && new RegExp(`${esc(prev)}[^\\p{L}\\p{N}]*$`, "iu").test(before)) score += 3;
      if (next && new RegExp(`^[^\\p{L}\\p{N}]*${esc(next)}`, "iu").test(after)) score += 3;
      if (!best || score > best.score) best = { score, start, end };
    }
  }
  return best ? [best.start, best.end] : null;
}
