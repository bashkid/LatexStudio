"""The LaTeX Studio server: a small FastAPI app on 127.0.0.1 that serves the editor and works on project folders of this computer.

The URL shapes under /api/v1/projects/{id} match the editor components (source, files, pdf, build)."""
from __future__ import annotations

import io
import logging
import time
import os
import re
import zipfile
from pathlib import Path

import pymupdf
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__, build, files, registry, synctex, tasks
from .errors import InvalidInput, NotFound, StudioError

log = logging.getLogger("latexstudio")
WEB_DIST = Path(os.environ.get("LATEXSTUDIO_WEB") or Path(__file__).resolve().parent.parent / "web" / "dist")
SOURCE_MAX = 1_500_000
LAST_REQUEST = [time.time()]          # when the server was last asked something (for the idle exit)
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
       "connect-src 'self'; frame-ancestors 'self'; object-src 'self'; base-uri 'none'")


class OpenIn(BaseModel):
    path: str
    name: str = ""


class NewIn(BaseModel):
    name: str


class RenameIn(BaseModel):
    name: str


class SourceIn(BaseModel):
    file: str
    text: str


class ForwardIn(BaseModel):
    file: str
    line: int


class LocateIn(BaseModel):
    page: int
    x: float
    y: float


class AssistIn(BaseModel):
    file: str = ""
    mode: str = "write"
    before: str = ""
    after: str = ""
    selection: str = ""
    instruction: str = ""


class FileNewIn(BaseModel):
    path: str
    kind: str = "file"


class FileRenameIn(BaseModel):
    path: str
    to: str


def native_pick(kind: str) -> str:
    """Ask for a file or a folder with the system's own chooser; '' when cancelled or no chooser exists."""
    import shutil
    import subprocess
    if not shutil.which("osascript"):
        raise InvalidInput("There is no system file chooser here.", "Use the folder list instead.")
    if kind == "folder":
        script = 'POSIX path of (choose folder with prompt "Choose the folder of your LaTeX project")'
    else:
        script = ('POSIX path of (choose file with prompt "Choose your main .tex file or an Overleaf .zip" '
                  'of type {"tex", "public.plain-text", "zip", "public.zip-archive"})')
    try:
        r = subprocess.run(["osascript", "-e", 'tell application "System Events" to activate', "-e", script],
                           capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        raise InvalidInput("The file chooser did not open.") from None
    return r.stdout.strip().rstrip("\n") if r.returncode == 0 else ""


def create_app() -> FastAPI:
    app = FastAPI(title="LaTeX Studio", version=__version__, docs_url=None, redoc_url=None, openapi_url="/api/openapi.json")

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # This server is for the person at this computer: refuse other host names (DNS rebinding) and other websites (CSRF).
        host = (request.headers.get("host") or "").rsplit(":", 1)[0] if not (request.headers.get("host") or "").startswith("[") \
            else (request.headers.get("host") or "").split("]")[0] + "]"
        if host not in LOCAL_HOSTS:
            return JSONResponse({"detail": {"message": "This app answers only on this computer.", "hint": ""}}, status_code=403)
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin:
            o = re.sub(r"^https?://", "", origin).rsplit(":", 1)[0] if not origin.rstrip("/").endswith("]") else "[::1]"
            if o not in LOCAL_HOSTS:
                return JSONResponse({"detail": {"message": "Requests from other websites are refused.", "hint": ""}}, status_code=403)
        LAST_REQUEST[0] = time.time()
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith("/api/"):
            resp.headers["Cache-Control"] = resp.headers.get("Cache-Control", "no-store")
        return resp

    @app.exception_handler(StudioError)
    async def studio_error(_: Request, e: StudioError):
        return JSONResponse({"detail": {"message": e.message, "hint": e.hint}}, status_code=e.status)

    @app.exception_handler(Exception)
    async def crash(_: Request, e: Exception):
        log.exception("unhandled error")
        return JSONResponse({"detail": {"message": "Something went wrong.", "hint": "Try again; the details are in the server log."}}, status_code=500)

    # ---------------------------------------------------------------- projects
    @app.get("/api/v1/status")
    def status():
        tex = build.find_tex_bin()
        return {"version": __version__, "latex": bool(tex), "latexBin": str(tex) if tex else "", "workspace": str(registry.workspace())}

    @app.get("/api/v1/projects")
    def projects():
        return registry.listing()


    @app.post("/api/v1/projects/open")
    def open_project(body: OpenIn):
        return registry.add(body.path, body.name)


    @app.post("/api/v1/projects/new")
    def new_project(body: NewIn):
        return registry.create(body.name)

    @app.post("/api/v1/projects/import")
    async def import_project(file: UploadFile = File(...)):
        return registry.import_zip(await file.read(), file.filename or "project.zip")

    @app.post("/api/v1/projects/open-path")
    def open_path(body: OpenIn):
        return registry.open_path(body.path)

    class PickIn(BaseModel):
        kind: str = "file"            # file | folder

    @app.post("/api/v1/pick")
    def pick(body: PickIn):
        """The macOS file chooser (this server runs on this computer). Returns {"path": ""} when cancelled."""
        return {"path": native_pick(body.kind)}

    @app.get("/api/v1/fs")
    def browse(path: str = ""):
        return registry.browse(path)


    @app.post("/api/v1/projects/{pid}/rename")
    def rename_project(pid: str, body: RenameIn):
        return registry.rename(pid, body.name)

    @app.delete("/api/v1/projects/{pid}")
    def forget_project(pid: str):
        registry.forget(pid)
        return {"ok": True}

    # ---------------------------------------------------------------- one project
    def folder(pid: str) -> Path:
        return registry.get(pid)

    def main_of(pid: str) -> str:
        out = folder(pid)
        want = registry.preferred_main(pid)
        return want if want and (out / want).is_file() else build.main_file(out)

    def protected(pid: str) -> frozenset[str]:
        return frozenset({main_of(pid)})

    def pdf_of(pid: str) -> Path:
        pdf = build.pdf_path(folder(pid), main_of(pid))
        if not pdf.exists():
            raise HTTPException(404, detail={"message": "There is no PDF yet.", "hint": "Press Recompile."})
        return pdf

    @app.get("/api/v1/projects/{pid}")
    def project_state(pid: str):
        out = folder(pid)
        main = main_of(pid)
        pdf = build.pdf_path(out, main)
        t = tasks.get(pid, "build")
        stale = build.sources_newer_than_pdf(out, main)
        return {"id": pid, "name": next((r["name"] for r in registry.listing() if r["id"] == pid), out.name), "folder": str(out),
                "main": main, "engine": build.engine_of(out, main), "pdf": pdf.exists(), "pdfMtime": pdf.stat().st_mtime if pdf.exists() else 0,
                "stale": stale, "running": bool(t and t.status == "running"), "latexError": build.last_error(out, main) if stale or not pdf.exists() else "",
                "build": _task_json(t)}

    def _task_json(t: tasks.Task | None) -> dict | None:
        if t is None:
            return None
        return {"id": t.id, "status": t.status, "text": t.text, "elapsed": round(t.elapsed if t.status != "running" else __import__("time").time() - t.started, 1),
                "error": t.error, "outcome": t.meta.get("outcome")}

    @app.post("/api/v1/projects/{pid}/build", status_code=202)
    def start_build(pid: str):
        out = folder(pid)
        main = main_of(pid)

        def work(t: tasks.Task) -> None:
            t.text = "Compiling…"
            res = build.compile(out, main, kill_hook=lambda proc: setattr(t, "_proc", proc))
            if t.status == "stopped":
                return
            t.meta["outcome"] = {"ok": res["ok"], "pdf": res["pdf"], "engine": res["engine"], "seconds": res["seconds"], "error": res["error"], "log": res["log"][-2500:]}
            t.text = "Done" if res["ok"] else "Finished with errors"
        return _task_json(tasks.start(pid, "build", f"Compile {main}", work))

    @app.post("/api/v1/projects/{pid}/build/stop")
    def stop_build(pid: str):
        return {"stopped": tasks.stop(pid, "build")}

    @app.get("/api/v1/projects/{pid}/build")
    def build_state(pid: str):
        folder(pid)
        return _task_json(tasks.get(pid, "build"))

    # ---- source
    TEXT_OPEN = files.TEXT_EXT | {".latexmkrc"}

    def source_path(pid: str, rel: str) -> Path:
        path = files.safe(folder(pid), rel or "", must_exist=True)
        if not path.is_file() or (path.suffix.lower() not in TEXT_OPEN and path.name not in files.SPECIAL_NAMES) or path.stat().st_size > SOURCE_MAX:
            raise InvalidInput("That file can't be opened as text here.", "Download it from the explorer's menu instead.")
        return path

    @app.get("/api/v1/projects/{pid}/source")
    def read_source(pid: str, file: str = ""):
        out = folder(pid)
        file = file or main_of(pid)
        text_files = [e["path"] for e in files.tree(out, protected(pid)) if e["kind"] == "file" and e["editable"]]
        return {"file": file, "text": source_path(pid, file).read_text(errors="replace"), "files": text_files}


    @app.put("/api/v1/projects/{pid}/source")
    def write_source(pid: str, body: SourceIn):
        if len(body.text.encode()) > SOURCE_MAX:
            raise InvalidInput("That file is too large to edit here.")
        path = source_path(pid, body.file)
        tmp = path.with_name(path.name + ".latexstudio.tmp")
        tmp.write_text(body.text)
        os.replace(tmp, path)
        return {"ok": True}

    @app.get("/api/v1/projects/{pid}/source/log")
    def source_log(pid: str):
        return build.log_tail(folder(pid), main_of(pid))

    @app.get("/api/v1/projects/{pid}/source/symbols")
    def symbols(pid: str):
        out = folder(pid)
        cites, labels = set(), set()
        for f in list(out.rglob("*.bib"))[:50]:
            if "build" in f.relative_to(out).parts:
                continue
            cites.update(re.findall(r"^\s*@\w+\s*\{\s*([^,\s]+)\s*,", f.read_text(errors="replace"), re.M))
        for f in list(out.rglob("*.tex"))[:300]:
            if "build" in f.relative_to(out).parts:
                continue
            labels.update(re.findall(r"\\label\{([^}]+)\}", f.read_text(errors="replace")))
        return {"cites": sorted(cites)[:3000], "labels": sorted(labels)[:3000]}


    @app.post("/api/v1/projects/{pid}/source/forward")
    def forward(pid: str, body: ForwardIn):
        return synctex.forward(folder(pid), body.file, body.line, build.stem_of(main_of(pid)))


    @app.post("/api/v1/projects/{pid}/source/locate")
    def locate(pid: str, body: LocateIn):
        return synctex.locate(folder(pid), body.page, body.x, body.y, build.stem_of(main_of(pid)))


    @app.post("/api/v1/projects/{pid}/source/assist")
    def assist(pid: str, body: AssistIn):
        raise InvalidInput("AI help is not part of LaTeX Studio.", "Inside ResearchRAG the editor has it.")

    # ---- files
    @app.get("/api/v1/projects/{pid}/files")
    def files_tree(pid: str):
        return {"entries": files.tree(folder(pid), protected(pid))}


    @app.post("/api/v1/projects/{pid}/files/new")
    def files_new(pid: str, body: FileNewIn):
        out = folder(pid)
        return {"path": files.create(out, body.path, body.kind), "entries": files.tree(out, protected(pid))}


    @app.post("/api/v1/projects/{pid}/files/rename")
    def files_rename(pid: str, body: FileRenameIn):
        out = folder(pid)
        return {"path": files.rename(out, body.path, body.to, protected(pid)), "entries": files.tree(out, protected(pid))}

    @app.delete("/api/v1/projects/{pid}/files")
    def files_delete(pid: str, path: str):
        out = folder(pid)
        files.delete(out, path, protected(pid))
        return {"entries": files.tree(out, protected(pid))}

    MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf"}

    @app.get("/api/v1/projects/{pid}/files/raw")
    def files_raw(pid: str, path: str):
        f = files.safe(folder(pid), path, must_exist=True)
        media = MEDIA.get(f.suffix.lower())
        if not f.is_file() or media is None:
            raise InvalidInput("That file cannot be shown here.", "Download it from the explorer's menu.")
        return FileResponse(f, media_type=media, headers={"Cache-Control": "no-cache"})

    @app.get("/api/v1/projects/{pid}/files/download")
    def files_download(pid: str, path: str):
        file, fname = files.download(folder(pid), path)
        return FileResponse(file, filename=fname)

    async def upload(request: Request, pid: str, file: UploadFile = File(...)):
        out = folder(pid)
        saved = files.store_upload(out, request.query_params.get("folder", ""), file.filename or "upload", await file.read())
        return {"path": saved, "entries": files.tree(out, protected(pid))}
    app.add_api_route("/api/v1/projects/{pid}/files/upload", upload, methods=["POST"])

    async def import_zip(request: Request, pid: str, file: UploadFile = File(...)):
        """Unpack an uploaded zip into the project (the explorer's Upload of a .zip, as in Overleaf)."""
        out = folder(pid)
        data = await file.read()
        if len(data) > files.MAX_UPLOAD * 20:
            raise InvalidInput("That zip is larger than 500 MB.")
        written = files.extract_zip(out, request.query_params.get("folder", ""), data)
        return {"written": written, "entries": files.tree(out, protected(pid))}
    app.add_api_route("/api/v1/projects/{pid}/files/import-zip", import_zip, methods=["POST"])

    @app.get("/api/v1/projects/{pid}/zip")
    def project_zip(pid: str):
        """The whole project as a zip (without the build folder), like Overleaf's Download Source."""
        out = folder(pid)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(out.rglob("*")):
                rel = f.relative_to(out)
                if f.is_file() and not f.is_symlink() and rel.parts[0] not in files.HIDDEN_TOP and not any(p.startswith(".") for p in rel.parts):
                    z.write(f, rel.as_posix())
        return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{out.name}.zip"'})

    # ---- pdf
    @app.get("/api/v1/projects/{pid}/main.pdf")
    def main_pdf(pid: str, download: bool = False):
        pdf = pdf_of(pid)
        return FileResponse(pdf, media_type="application/pdf", filename=pdf.name if download else None,
                            headers={"Cache-Control": "no-cache"}, content_disposition_type="attachment" if download else "inline")

    def open_pdf(pid: str):
        return pymupdf.open(str(pdf_of(pid)))

    @app.get("/api/v1/projects/{pid}/pdf/info")
    def pdf_info(pid: str):
        pdf = pdf_of(pid)
        with _PDF_LOCK, pymupdf.open(str(pdf)) as doc:
            return {"pages": [[round(pg.rect.width, 2), round(pg.rect.height, 2)] for pg in doc], "mtime": pdf.stat().st_mtime}

    @app.get("/api/v1/projects/{pid}/pdf/page/{number}.png")
    def pdf_page(pid: str, number: int, zoom: float = 1.6, rotate: int = 0):
        if rotate not in (0, 90, 180, 270):
            raise InvalidInput("Rotate by 0, 90, 180 or 270 degrees.")
        z = min(max(zoom, 0.3), 3.0)
        with _PDF_LOCK, pymupdf.open(str(pdf_of(pid))) as doc:
            if not 1 <= number <= doc.page_count:
                raise HTTPException(404, detail={"message": "That page doesn't exist.", "hint": ""})
            png = doc[number - 1].get_pixmap(matrix=pymupdf.Matrix(z, z).prerotate(rotate), alpha=False).tobytes("png")
        return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})

    @app.get("/api/v1/projects/{pid}/pdf/text/{number}")
    def pdf_text(pid: str, number: int):
        with _PDF_LOCK, pymupdf.open(str(pdf_of(pid))) as doc:
            if not 1 <= number <= doc.page_count:
                raise HTTPException(404, detail={"message": "That page doesn't exist.", "hint": ""})
            words = doc[number - 1].get_text("words")[:4000]
        return {"words": [{"r": [round(w[0], 1), round(w[1], 1), round(w[2], 1), round(w[3], 1)], "t": w[4], "l": f"{w[5]}-{w[6]}"} for w in words]}

    @app.get("/api/v1/projects/{pid}/pdf/properties")
    def pdf_properties(pid: str):
        pdf = pdf_of(pid)
        with _PDF_LOCK, pymupdf.open(str(pdf)) as doc:
            meta = {k: (doc.metadata or {}).get(k) or "" for k in ("title", "author", "subject", "keywords", "creator", "producer")}
            first = doc[0].rect if doc.page_count else None
            return {"file": pdf.name, "bytes": pdf.stat().st_size, "pages": doc.page_count, "built": pdf.stat().st_mtime,
                    "pageSize": [round(first.width, 1), round(first.height, 1)] if first else None,
                    "format": (doc.metadata or {}).get("format", ""), "metadata": meta}

    @app.get("/api/v1/projects/{pid}/pdf/search")
    def pdf_search(pid: str, q: str):
        q = (q or "").strip()
        pdf = pdf_of(pid)
        if len(q) < 2 or len(q) > 120:
            return {"matches": [], "total": 0}
        matches, total = [], 0
        with _PDF_LOCK, pymupdf.open(str(pdf)) as doc:
            for number, page in enumerate(doc, 1):
                rects = page.search_for(q)
                if rects:
                    total += len(rects)
                    matches.append({"page": number, "rects": [[round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)] for r in rects[:100]]})
                if total >= 500:
                    break
        return {"matches": matches, "total": total}

    # ---------------------------------------------------------------- the built web app
    if WEB_DIST.is_dir():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, detail={"message": "Not found.", "hint": ""})
            f = (WEB_DIST / path).resolve()
            if path and WEB_DIST.resolve() in f.parents and f.is_file():
                return FileResponse(f)
            return FileResponse(WEB_DIST / "index.html", headers={"Cache-Control": "no-cache"})
    return app


import threading  # noqa: E402

_PDF_LOCK = threading.Lock()          # PyMuPDF is not thread-safe
app = create_app()
