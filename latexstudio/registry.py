"""The list of projects the app knows: a folder on this computer each. Stored in ~/.latexstudio/projects.json (override: LATEXSTUDIO_HOME)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import zipfile
from pathlib import Path

from .errors import InvalidInput, NotFound

_lock = threading.Lock()
MAX_ZIP_BYTES = 500_000_000
MAX_ZIP_FILES = 20_000


def home() -> Path:
    h = Path(os.environ.get("LATEXSTUDIO_HOME") or Path.home() / ".latexstudio")
    h.mkdir(parents=True, exist_ok=True)
    return h


def workspace() -> Path:
    """Where new and imported projects are created."""
    w = Path(os.environ.get("LATEXSTUDIO_WORKSPACE") or Path.home() / "LatexStudio")
    w.mkdir(parents=True, exist_ok=True)
    return w


def _file() -> Path:
    return home() / "projects.json"


def _read() -> list[dict]:
    try:
        return json.loads(_file().read_text())
    except (OSError, ValueError):
        return []


def _write(rows: list[dict]) -> None:
    fd, tmp = tempfile.mkstemp(dir=home(), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(rows, f, indent=1)
    os.replace(tmp, _file())


def project_id(path: Path) -> str:
    return hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:12]


def listing() -> list[dict]:
    rows = _read()
    return [{**r, "exists": Path(r["path"]).is_dir()} for r in rows]


def get(pid: str) -> Path:
    for r in _read():
        if r["id"] == pid:
            p = Path(r["path"])
            if not p.is_dir():
                raise NotFound("That project's folder is gone.", f"It was {p}. Remove it from the list or restore the folder.")
            return p
    raise NotFound("That project is not in the list.", "Open it again from the start page.")


def add(path: str, name: str = "") -> dict:
    p = Path(os.path.expanduser(path or "")).resolve()
    if not p.is_dir():
        raise InvalidInput("That folder does not exist.", "Give the full path of a folder with a .tex file.")
    if not any(p.rglob("*.tex")) and not (p / "main.tex").exists():
        # allow empty folders only if the person created them through the app (new project); opening needs LaTeX in it
        raise InvalidInput("There is no .tex file in that folder.", "Choose the folder of a LaTeX project.")
    with _lock:
        rows = _read()
        pid = project_id(p)
        row = next((r for r in rows if r["id"] == pid), None)
        if row is None:
            row = {"id": pid, "name": name.strip() or p.name, "path": str(p)}
            rows.append(row)
        _write(rows)
    return row


def open_path(path: str) -> dict:
    """What the file chooser gave: a project folder, a .tex file (its folder opens, with that file as the main file), or an Overleaf .zip."""
    p = Path(os.path.expanduser(path or "")).resolve()
    if p.is_dir():
        return add(str(p))
    if p.is_file() and p.suffix.lower() == ".zip":
        if p.stat().st_size > MAX_ZIP_BYTES:
            raise InvalidInput("That zip is larger than 500 MB.")
        return import_zip(p.read_bytes(), p.name)
    if p.is_file() and p.suffix.lower() == ".tex":
        row = add(str(p.parent))
        with _lock:
            rows = _read()
            for r in rows:
                if r["id"] == row["id"]:
                    r["main"] = p.name
                    _write(rows)
                    row = r
        return row
    raise InvalidInput("Choose a .tex file, a project folder or an Overleaf .zip.")


def preferred_main(pid: str) -> str:
    return next((r.get("main", "") for r in _read() if r["id"] == pid), "")


def forget(pid: str) -> None:
    """Take a project off the list. The folder and its files stay where they are."""
    with _lock:
        _write([r for r in _read() if r["id"] != pid])


def rename(pid: str, name: str) -> dict:
    name = name.strip()
    if not name or len(name) > 80:
        raise InvalidInput("Give a name of 1 to 80 characters.")
    with _lock:
        rows = _read()
        for r in rows:
            if r["id"] == pid:
                r["name"] = name
                _write(rows)
                return r
    raise NotFound("That project is not in the list.")


_SLUG = re.compile(r"[^A-Za-z0-9._\- ]+")

TEMPLATE = r"""\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{%(title)s}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
A short summary of the work.
\end{abstract}

\section{Introduction}
Start writing here. Cite a paper with \cite{example}.

\bibliographystyle{plain}
\bibliography{references}
\end{document}
"""

BIB = """@article{example,
  title   = {An Example Article},
  author  = {Author, Anne},
  journal = {Journal of Examples},
  year    = {2026}
}
"""


def _unique_dir(name: str) -> Path:
    slug = _SLUG.sub("", name).strip().strip(".") or "project"
    d = workspace() / slug
    n = 2
    while d.exists():
        d = workspace() / f"{slug} ({n})"
        n += 1
    return d


def create(name: str) -> dict:
    """A new project with a starter main.tex and references.bib in the workspace folder."""
    name = (name or "").strip()
    if not name or len(name) > 80:
        raise InvalidInput("Give the project a name of 1 to 80 characters.")
    d = _unique_dir(name)
    d.mkdir(parents=True)
    (d / "main.tex").write_text(TEMPLATE % {"title": name.replace("\\", "").replace("{", "").replace("}", "")})
    (d / "references.bib").write_text(BIB)
    return add(str(d), name)


def import_zip(data: bytes, filename: str) -> dict:
    """An Overleaf download (Menu → Download → Source): unpacked into a new folder of the workspace, safely."""
    name = Path(filename or "project.zip").stem or "project"
    if len(data) > MAX_ZIP_BYTES:
        raise InvalidInput("That zip is larger than 500 MB.")
    d = _unique_dir(name)
    tmp = Path(tempfile.mkdtemp(prefix="latexstudio-zip-"))
    zpath = tmp / "in.zip"
    zpath.write_bytes(data)
    try:
        with zipfile.ZipFile(zpath) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
            if len(infos) > MAX_ZIP_FILES or sum(i.file_size for i in infos) > MAX_ZIP_BYTES * 2:
                raise InvalidInput("That zip holds too many or too large files.")
            names = [i.filename for i in infos]
            top = {n.split("/")[0] for n in names}
            strip = len(top) == 1 and all("/" in n for n in names)         # one wrapping folder: unwrap it
            root = d.resolve()
            for i in infos:
                rel = i.filename.split("/", 1)[1] if strip else i.filename
                parts = [p for p in rel.split("/") if p]
                if not parts or any(p in (".", "..") for p in parts) or rel.startswith("/") or parts[0] == "__MACOSX":
                    continue
                dest = (root / "/".join(parts)).resolve()
                if root not in dest.parents:
                    raise InvalidInput("That zip has a file outside its folder.", "It was not unpacked.")
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(z.read(i))
    except zipfile.BadZipFile:
        raise InvalidInput("That is not a zip file.", "Download the project from Overleaf with Menu → Source.") from None
    except InvalidInput:
        import shutil
        shutil.rmtree(d, ignore_errors=True)
        raise
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    if not any(d.rglob("*.tex")):
        import shutil
        shutil.rmtree(d, ignore_errors=True)
        raise InvalidInput("There is no .tex file in that zip.")
    return add(str(d), name)


def browse(path: str = "") -> dict:
    """Folders of this computer, for the 'open a folder' picker (this app listens on this computer only)."""
    p = Path(os.path.expanduser(path)) if path else Path.home()
    p = p.resolve()
    if not p.is_dir():
        raise InvalidInput("That folder does not exist.")
    dirs, has_tex = [], False
    try:
        for c in sorted(p.iterdir(), key=lambda q: q.name.lower()):
            if c.name.startswith("."):
                continue
            if c.is_dir() and not c.is_symlink():
                dirs.append(c.name)
            elif c.suffix.lower() == ".tex":
                has_tex = True
    except PermissionError:
        raise InvalidInput("That folder cannot be read.") from None
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else "", "dirs": dirs, "hasTex": has_tex}
