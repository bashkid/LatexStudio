// Line-based change hunks between an accepted text and the working text (Review mode: edits are suggestions).
export type Hunk = { aStart: number; aEnd: number; bStart: number; bEnd: number };   // line ranges [start, end) in a and b

export function hunks(a: string, b: string): Hunk[] {
  if (a === b) return [];
  const A = a.split("\n"), B = b.split("\n");
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const n = A.length - pre - suf, m = B.length - pre - suf;
  if (n === 0 || m === 0 || n * m > 4_000_000) return [{ aStart: pre, aEnd: pre + n, bStart: pre, bEnd: pre + m }];
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[pre + i] === B[pre + j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Hunk[] = [];
  let i = 0, j = 0, open: Hunk | null = null;
  const close = () => { if (open) { out.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[pre + i] === B[pre + j]) { close(); i++; j++; continue; }
    if (!open) open = { aStart: pre + i, aEnd: pre + i, bStart: pre + j, bEnd: pre + j };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { j++; open.bEnd = pre + j; } else { i++; open.aEnd = pre + i; }
  }
  close();
  return out;
}

export const acceptHunk = (base: string, work: string, h: Hunk): string => {
  const A = base.split("\n"), B = work.split("\n");
  return [...A.slice(0, h.aStart), ...B.slice(h.bStart, h.bEnd), ...A.slice(h.aEnd)].join("\n");
};
export const rejectHunk = (base: string, work: string, h: Hunk): string => {
  const A = base.split("\n"), B = work.split("\n");
  return [...B.slice(0, h.bStart), ...A.slice(h.aStart, h.aEnd), ...B.slice(h.bEnd)].join("\n");
};
