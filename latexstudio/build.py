"""Compile a LaTeX project with the local TeX installation (latexmk), the way Overleaf does: the main file, the engine from a magic comment, a
build folder inside the project, SyncTeX on, and a log the editor can show."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from .errors import ToolError

TEX_DIRS = ["/Library/TeX/texbin", "/usr/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
ENGINES = {"pdflatex": "-pdf", "xelatex": "-xelatex", "lualatex": "-lualatex", "latex": "-dvi"}
TIMEOUT_S = 900
SECRET_HINTS = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL")


def find_tex_bin() -> Path | None:
    """The folder with latexmk: LATEXSTUDIO_TEX_BIN, PATH, then the usual install locations (MacTeX, TeX Live, Homebrew)."""
    if os.environ.get("LATEXSTUDIO_TEX_BIN") and (Path(os.environ["LATEXSTUDIO_TEX_BIN"]) / "latexmk").is_file():
        return Path(os.environ["LATEXSTUDIO_TEX_BIN"])
    found = shutil.which("latexmk")
    if found:
        return Path(found).parent
    for d in TEX_DIRS:
        if (Path(d) / "latexmk").is_file():
            return Path(d)
    for g in sorted(Path("/usr/local/texlive").glob("*/bin/*")):
        if (g / "latexmk").is_file():
            return g
    return None


def safe_env(extra: dict | None = None) -> dict[str, str]:
    """The environment of a TeX run: this process's, without anything that looks like a secret."""
    env = {k: v for k, v in os.environ.items() if not any(h in k.upper() for h in SECRET_HINTS)}
    env.update(extra or {})
    return env


def main_file(folder: Path) -> str:
    """The project's main .tex file: main.tex, else a root file with \\documentclass (the one Overleaf would pick), else the first .tex."""
    folder = Path(folder)
    if (folder / "main.tex").is_file():
        return "main.tex"
    roots = []
    for f in sorted(folder.glob("*.tex")):
        try:
            head = f.read_text(errors="replace")[:20000]
        except OSError:
            continue
        if re.search(r"^[^%\n]*\\documentclass", head, re.M):
            roots.append(f.name)
    if roots:
        return roots[0]
    first = sorted(folder.glob("*.tex"))
    return first[0].name if first else "main.tex"


def engine_of(folder: Path, main: str) -> str:
    """The engine named by a magic comment (`% !TEX program = xelatex`) in the first lines of the main file, else pdflatex."""
    try:
        head = "\n".join((Path(folder) / main).read_text(errors="replace").splitlines()[:30])
    except OSError:
        return "pdflatex"
    m = re.search(r"^%\s*!TEX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex|latex)", head, re.M | re.I)
    return m.group(1).lower() if m else "pdflatex"


def stem_of(main: str) -> str:
    return Path(main).stem


def pdf_path(folder: Path, main: str | None = None) -> Path:
    main = main or main_file(folder)
    return Path(folder) / "build" / f"{stem_of(main)}.pdf"


def sources_newer_than_pdf(folder: Path, main: str | None = None) -> bool:
    """True when the PDF is missing or older than a source file of the project (not the build folder, not hidden folders)."""
    folder = Path(folder)
    pdf = pdf_path(folder, main)
    if not pdf.exists():
        return True
    stamp = pdf.stat().st_mtime
    skip = {"build", ".git", "node_modules", "__pycache__", ".latexstudio"}
    for f in folder.rglob("*"):
        if not f.is_file() or f.suffix.lower() not in {".tex", ".bib", ".sty", ".cls", ".bst", ".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg", ".csv", ".dat"}:
            continue
        if skip & set(f.relative_to(folder).parts[:-1]):
            continue
        if f.stat().st_mtime > stamp:
            return True
    return False


def last_error(folder: Path, main: str | None = None) -> str:
    """The first error of the build log with its context lines, else ''."""
    log = Path(folder) / "build" / f"{stem_of(main or main_file(folder))}.log"
    try:
        lines = log.read_text(errors="replace").splitlines()
    except OSError:
        return ""
    for i, line in enumerate(lines):
        if line.startswith("!") or re.match(r"^\S+\.tex:\d+:", line):
            return "\n".join(lines[i:i + 6]).strip()
    return ""


def log_tail(folder: Path, main: str | None = None, lines: int = 400) -> dict:
    log = Path(folder) / "build" / f"{stem_of(main or main_file(folder))}.log"
    try:
        text = log.read_text(errors="replace").splitlines()
    except OSError:
        return {"log": "", "error": "", "exists": False}
    return {"log": "\n".join(text[-lines:]), "error": last_error(folder, main), "exists": True}


def compile(folder: Path, main: str | None = None, *, kill_hook=None) -> dict:
    """Run latexmk. Returns {"ok": pdf made without errors, "pdf": a PDF exists, "engine", "seconds", "log", "error"}.
    A PDF is kept even when there are errors (like Overleaf, which shows what it could typeset)."""
    folder = Path(folder)
    main = main or main_file(folder)
    tex_bin = find_tex_bin()
    if tex_bin is None:
        raise ToolError("LaTeX is not installed on this computer.", "Install MacTeX (brew install --cask mactex-no-gui) or TeX Live, then try again.")
    if not (folder / main).is_file():
        raise ToolError(f"{main} does not exist.", "Create the main file, or choose another one.")
    engine = engine_of(folder, main)
    (folder / "build").mkdir(exist_ok=True)
    cmd = [str(tex_bin / "latexmk"), ENGINES[engine], "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-outdir=build", main]
    env = safe_env({"PATH": f"{tex_bin}{os.pathsep}{os.environ.get('PATH', '')}"})
    started = time.time()
    proc = subprocess.Popen(cmd, cwd=folder, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    if kill_hook:
        kill_hook(proc)
    try:
        out, _ = proc.communicate(timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise ToolError("The compilation took more than 15 minutes and was stopped.", "Look for a loop or a very large figure.") from None
    pdf = pdf_path(folder, main)
    return {"ok": proc.returncode == 0 and pdf.exists(), "pdf": pdf.exists(), "engine": engine, "main": main,
            "seconds": round(time.time() - started, 1), "log": out[-4000:], "error": last_error(folder, main)}
