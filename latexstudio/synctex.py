"""From a point in the built PDF to the place in the LaTeX source that produced it (SyncTeX, "inverse search").

The build writes build/main.synctex.gz (latexmk -synctex=1). `locate` asks the `synctex edit` tool of the local TeX
installation which input file and line a click at (x, y) of a page came from, and answers with a path relative to the
paper folder that the editor is allowed to open (any text file of the project).
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from .errors import InvalidInput
from .build import safe_env, find_tex_bin

TIMEOUT_S = 20
_ALLOWED = re.compile(r"^(?!\.)(?!.*\.\.)[^\x00]+\.(?:tex|bib|sty|cls|bst|def|cfg|ltx|tikz|pgf|dtx)$", re.I)     # a text file of the project


def parse_edit_output(text: str) -> dict | None:
    """The first result of `synctex edit`: {"input": path as printed, "line": n, "column": n}."""
    m = re.search(r"^Input:(.+)$", text or "", re.M)
    n = re.search(r"^Line:(-?\d+)$", text or "", re.M)
    if not m or not n or int(n.group(1)) < 1:
        return None
    c = re.search(r"^Column:(-?\d+)$", text or "", re.M)
    return {"input": m.group(1).strip(), "line": int(n.group(1)), "column": max(int(c.group(1)), 0) if c else 0}


def _relative(out: Path, printed: str) -> str | None:
    """`printed` (absolute, or relative to the build or paper folder) as an allowed path inside the paper folder."""
    out = Path(out).resolve()
    candidates = [Path(printed)]
    if not Path(printed).is_absolute():
        candidates += [out / printed, out / "build" / printed]
    for c in candidates:
        try:
            rel = c.resolve().relative_to(out).as_posix()
        except (ValueError, OSError):
            continue
        if _ALLOWED.match(rel):
            return rel
    return None


def locate(out: Path, page: int, x: float, y: float, stem: str = "main") -> dict:
    """{"file": relative path, "line": n, "column": n} for a click at (x, y) in PDF points (origin top left) of `page`."""
    out = Path(out)
    pdf = out / "build" / f"{stem}.pdf"
    if not pdf.exists():
        raise InvalidInput("There is no PDF yet.", "Build it first.")
    if not (out / "build" / f"{stem}.synctex.gz").exists():
        raise InvalidInput("This PDF was built without source positions.", "Rebuild it once; then clicking the PDF finds the source.")
    tex_bin = find_tex_bin()
    tool = (tex_bin / "synctex") if tex_bin else None
    if tool is None or not tool.is_file():
        raise InvalidInput("The synctex tool was not found in your LaTeX installation.")
    if not (page >= 1 and 0 <= x <= 5000 and 0 <= y <= 5000):
        raise InvalidInput("That point is outside the page.")
    env = safe_env(extra={"PATH": f"{tex_bin}{os.pathsep}{os.environ.get('PATH', '')}"})
    try:
        proc = subprocess.run([str(tool), "edit", "-o", f"{int(page)}:{x:.2f}:{y:.2f}:build/{stem}.pdf"], cwd=out, env=env,
                              capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise InvalidInput("Finding the source failed.", str(e)[:200]) from e
    hit = parse_edit_output(proc.stdout)
    rel = _relative(out, hit["input"]) if hit else None
    if not hit or rel is None:
        raise InvalidInput("Nothing in the source belongs to that spot.", "Click on text of the paper.")
    return {"file": rel, "line": hit["line"], "column": hit["column"]}


def parse_view_output(text: str) -> dict | None:
    """The first result of `synctex view` as a box of the page (PDF points, origin top left).

    `h` and `v` are the box's left edge and baseline, `W` and `H` its width and height above the baseline; `x` and
    `y` are only a point inside it (about a line's start plus an offset), so they would draw the marker shifted."""
    def num(key: str):
        m = re.search(rf"^{key}:(-?\d+(?:\.\d+)?)$", text or "", re.M)
        return float(m.group(1)) if m else None
    page, h, v = num("Page"), num("h"), num("v")
    if not page:
        return None
    if h is None or v is None:                                  # an older synctex without h / v: fall back to the point
        h, v = num("x"), num("y")
        if h is None or v is None:
            return None
    w, ht = num("W") or 0.0, num("H") or 0.0
    ht = max(ht, 8.0)
    descent = 0.25 * ht                                          # the box ends at the baseline; letters hang below it
    return {"page": int(page), "x": round(h, 1), "y": round(v - ht, 1), "w": round(w, 1), "h": round(ht + descent, 1)}


def _view_once(tool: Path, out: Path, env: dict, file: str, line: int, stem: str = "main") -> dict | None:
    try:
        proc = subprocess.run([str(tool), "view", "-i", f"{max(int(line), 1)}:0:{file}", "-o", f"build/{stem}.pdf"], cwd=out,
                              env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise InvalidInput("Finding the place failed.", str(e)[:200]) from e
    return parse_view_output(proc.stdout)


NEIGHBOURS = 60          # lines tried around a line that has no text of its own (a blank line, \begin{...}, a comment)


def forward(out: Path, file: str, line: int, stem: str = "main") -> dict:
    """Where a line of `file` is in the PDF: {"page", "x", "y", "w", "h"}. A line that produced nothing visible (blank,
    a comment, \\begin{document}) is answered with the nearest line that did, searched downwards first."""
    out = Path(out)
    if not _ALLOWED.match(file or ""):
        raise InvalidInput("That file can't be located.")
    if not (out / "build" / f"{stem}.pdf").exists() or not (out / "build" / f"{stem}.synctex.gz").exists():
        raise InvalidInput("This PDF was built without source positions.", "Press Recompile once; then the arrows work.")
    tex_bin = find_tex_bin()
    tool = (tex_bin / "synctex") if tex_bin else None
    if tool is None or not tool.is_file():
        raise InvalidInput("The synctex tool was not found in your LaTeX installation.")
    env = safe_env(extra={"PATH": f"{tex_bin}{os.pathsep}{os.environ.get('PATH', '')}"})
    line = max(int(line), 1)
    order = [line] + [line + d for d in range(1, NEIGHBOURS + 1)] + [line - d for d in range(1, NEIGHBOURS + 1) if line - d >= 1]
    for n in order:
        hit = _view_once(tool, out, env, file, n, stem)
        if hit is not None:
            return hit
    raise InvalidInput("Nothing near that line appears in the PDF.", "Place the cursor in text that is part of the paper.")
