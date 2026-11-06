"""File operations in a project's folder, for the editor's file explorer: list, create, rename, delete, download, upload.

Everything is confined to the project folder: a path is checked segment by segment (no "..", no hidden names, no symbolic
links), the app's own folders (build, .git, .latexstudio) are out of reach, the project's main file cannot be renamed or deleted,
and only the file types a LaTeX project uses can be created or uploaded.
"""
from __future__ import annotations

import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from .errors import InvalidInput

HIDDEN_TOP = {"build", ".git", "__pycache__", ".latexstudio", "node_modules"}
PROTECTED: frozenset[str] = frozenset()                  # the project's main file is passed by the caller (it can have any name)
TEXT_EXT = {".tex", ".bib", ".sty", ".cls", ".bst", ".bbx", ".cbx", ".lbx", ".def", ".cfg", ".clo", ".fd", ".ist", ".txt", ".md",
            ".csv", ".tsv", ".json", ".dat", ".tikz", ".pgf", ".mp", ".bbl", ".log", ".yml", ".yaml", ".toml", ".py", ".r", ".R"}
ALLOWED_EXT = TEXT_EXT | {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".eps", ".gif", ".tif", ".tiff", ".ttf", ".otf", ".xlsx", ".zip"}
SPECIAL_NAMES = {"latexmkrc", ".latexmkrc", "Makefile"}
SEGMENT = re.compile(r"^[^/\\\x00-\x1f<>:\"|?*][^/\\\x00-\x1f<>:\"|?*]{0,120}$")
MAX_UPLOAD = 25_000_000


def safe(out: Path, rel: str, *, must_exist: bool = False) -> Path:
    """The path `rel` inside `out`, or an InvalidInput saying why it is not allowed."""
    rel = (rel or "").strip().strip("/")
    if not rel:
        raise InvalidInput("Give a file or folder name.")
    parts = rel.split("/")
    if any(p in (".", "..") or not SEGMENT.match(p) or (p.startswith(".") and p not in SPECIAL_NAMES) for p in parts):
        raise InvalidInput("That is not a usable file name.", "No “..”, no hidden names, and none of < > : \" | ? *.")
    if parts[0] in HIDDEN_TOP:
        raise InvalidInput(f"“{parts[0]}” is managed by the app and cannot be changed here.")
    root = out.resolve()
    path = (root / rel)
    probe = path
    while probe != root:                                   # no symbolic link on the way
        if probe.is_symlink():
            raise InvalidInput("Links are not followed.")
        probe = probe.parent
    if root not in path.resolve().parents and path.resolve() != root:
        raise InvalidInput("That is outside the paper's folder.")
    if must_exist and not path.exists():
        raise InvalidInput("That file or folder does not exist.")
    return path


def _ext_ok(path: Path) -> None:
    if path.suffix.lower() not in ALLOWED_EXT:
        raise InvalidInput(f"A paper folder holds {', '.join(sorted(ALLOWED_EXT))} files.", "Use one of those extensions.")


def tree(out: Path, protected: frozenset[str] = frozenset()) -> list[dict]:
    """Every file and folder a person can work with, as [{path, kind, size, editable}], folders first within a folder."""
    root = out.resolve()
    rows: list[dict] = []
    for p in sorted(root.rglob("*"), key=lambda q: (q.parent.as_posix(), q.is_file(), q.name.lower())):
        rel = p.relative_to(root).as_posix()
        top = rel.split("/")[0]
        if top in HIDDEN_TOP or any(part.startswith(".") and part not in SPECIAL_NAMES for part in rel.split("/")) or p.is_symlink():
            continue
        if p.is_dir():
            rows.append({"path": rel, "kind": "dir", "size": 0, "editable": False})
        elif p.suffix.lower() in ALLOWED_EXT or rel in PROTECTED | protected or p.name in SPECIAL_NAMES:
            rows.append({"path": rel, "kind": "file", "size": p.stat().st_size, "editable": p.suffix.lower() in TEXT_EXT})
    return rows


def create(out: Path, rel: str, kind: str) -> str:
    path = safe(out, rel)
    if path.exists():
        raise InvalidInput(f"{rel} already exists.")
    if kind == "folder":
        path.mkdir(parents=True)
        return rel
    _ext_ok(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("")
    return rel


def rename(out: Path, rel: str, to: str, protected: frozenset[str] = frozenset()) -> str:
    src = safe(out, rel, must_exist=True)
    dst = safe(out, to)
    if rel in PROTECTED | protected:
        raise InvalidInput(f"{rel} is the project's main file and cannot be renamed.")
    if dst.exists():
        raise InvalidInput(f"{to} already exists.")
    if src.is_file():
        _ext_ok(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return to


def delete(out: Path, rel: str, protected: frozenset[str] = frozenset()) -> None:
    path = safe(out, rel, must_exist=True)
    if rel in PROTECTED | protected:
        raise InvalidInput(f"{rel} is the project's main file and cannot be deleted.")
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def download(out: Path, rel: str) -> tuple[Path, str]:
    """(a file to send, its name): a folder is sent as a zip."""
    path = safe(out, rel, must_exist=True)
    if path.is_file():
        return path, path.name
    tmp = Path(tempfile.mkdtemp(prefix="latexstudio-dl-")) / f"{path.name}.zip"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for f in path.rglob("*"):
            if f.is_file() and not f.is_symlink():
                z.write(f, f.relative_to(path.parent).as_posix())
    return tmp, tmp.name


def store_upload(out: Path, folder: str, filename: str, data: bytes) -> str:
    if len(data) > MAX_UPLOAD:
        raise InvalidInput("That file is larger than 25 MB.")
    name = re.sub(r'[<>:"|?*\\/\x00-\x1f]', "_", Path(filename or "upload").name).lstrip(". ") or "upload"
    rel = f"{folder.strip('/')}/{name}" if folder.strip("/") else name
    path = safe(out, rel)
    _ext_ok(path)
    if path.exists():
        stem, ext, n = path.stem, path.suffix, 2
        while path.exists():
            path = path.with_name(f"{stem} ({n}){ext}")
            n += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path.relative_to(out.resolve()).as_posix()
