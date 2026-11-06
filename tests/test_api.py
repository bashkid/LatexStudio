import io
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from latexstudio import build, files, registry
from latexstudio.errors import InvalidInput

H = {"host": "127.0.0.1"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LATEXSTUDIO_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("LATEXSTUDIO_WORKSPACE", str(tmp_path / "ws"))
    from latexstudio.app import create_app
    return TestClient(create_app(), base_url="http://127.0.0.1")


def make(client, name="Paper"):
    r = client.post("/api/v1/projects/new", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()


def wait_build(client, pid, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        s = client.get(f"/api/v1/projects/{pid}/build").json()
        if s and s["status"] != "running":
            return s
        time.sleep(0.5)
    raise AssertionError("build did not finish")


needs_tex = pytest.mark.skipif(build.find_tex_bin() is None, reason="no LaTeX")


def test_refuses_other_hosts_and_sites(client):
    assert client.get("/api/v1/projects", headers={"host": "evil.example"}).status_code == 403
    r = client.post("/api/v1/projects/new", json={"name": "x"}, headers={"origin": "https://evil.example"})
    assert r.status_code == 403


def test_new_open_list_forget(client, tmp_path):
    p = make(client)
    assert (tmp_path / "ws" / "Paper" / "main.tex").exists()
    assert [x["name"] for x in client.get("/api/v1/projects").json()] == ["Paper"]
    again = client.post("/api/v1/projects/open", json={"path": p["path"]}).json()
    assert again["id"] == p["id"] and len(client.get("/api/v1/projects").json()) == 1
    assert client.post(f"/api/v1/projects/{p['id']}/rename", json={"name": "Thesis"}).json()["name"] == "Thesis"
    client.delete(f"/api/v1/projects/{p['id']}")
    assert client.get("/api/v1/projects").json() == []
    assert (tmp_path / "ws" / "Paper" / "main.tex").exists()          # forgetting never deletes files


def test_open_rejects_folder_without_tex(client, tmp_path):
    (tmp_path / "empty").mkdir()
    assert client.post("/api/v1/projects/open", json={"path": str(tmp_path / "empty")}).status_code == 400
    assert client.post("/api/v1/projects/open", json={"path": str(tmp_path / "nope")}).status_code == 400


def test_source_read_write_and_confinement(client):
    pid = make(client)["id"]
    base = f"/api/v1/projects/{pid}"
    r = client.get(f"{base}/source").json()
    assert r["file"] == "main.tex" and "\\documentclass" in r["text"] and "references.bib" in r["files"]
    assert client.put(f"{base}/source", json={"file": "main.tex", "text": "\\documentclass{article}\\begin{document}Hi\\end{document}"}).status_code == 200
    assert "Hi" in client.get(f"{base}/source?file=main.tex").json()["text"]
    for bad in ("../x.tex", "/etc/passwd", "build/../../x", ".git/config"):
        assert client.get(f"{base}/source", params={"file": bad}).status_code == 400
        assert client.put(f"{base}/source", json={"file": bad, "text": "x"}).status_code == 400


def test_files_create_rename_delete_protects_main(client):
    pid = make(client)["id"]
    base = f"/api/v1/projects/{pid}"
    assert client.post(f"{base}/files/new", json={"path": "chapters", "kind": "folder"}).status_code == 200
    assert client.post(f"{base}/files/new", json={"path": "chapters/intro.tex", "kind": "file"}).status_code == 200
    assert client.post(f"{base}/files/rename", json={"path": "chapters/intro.tex", "to": "chapters/one.tex"}).status_code == 200
    assert client.post(f"{base}/files/rename", json={"path": "main.tex", "to": "x.tex"}).status_code == 400
    assert client.delete(f"{base}/files", params={"path": "main.tex"}).status_code == 400
    assert client.delete(f"{base}/files", params={"path": "chapters/one.tex"}).status_code == 200
    up = client.post(f"{base}/files/upload?folder=chapters", files={"file": ("fig.png", b"\x89PNG", "image/png")})
    assert up.status_code == 200 and up.json()["path"] == "chapters/fig.png"
    assert client.post(f"{base}/files/upload", files={"file": ("evil.exe", b"MZ", "application/octet-stream")}).status_code == 400


def test_symbols(client):
    pid = make(client)["id"]
    s = client.get(f"/api/v1/projects/{pid}/source/symbols").json()
    assert "example" in s["cites"]


def test_import_zip_unwraps_and_blocks_traversal(client, tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("proj/main.tex", "\\documentclass{article}\\begin{document}x\\end{document}")
        z.writestr("proj/figs/a.png", "x")
    r = client.post("/api/v1/projects/import", files={"file": ("My Paper.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200, r.text
    assert (tmp_path / "ws" / "My Paper" / "main.tex").exists()
    evil = io.BytesIO()
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("main.tex", "x")
        z.writestr("../../escape.tex", "x")
    client.post("/api/v1/projects/import", files={"file": ("e.zip", evil.getvalue(), "application/zip")})
    assert not (tmp_path / "escape.tex").exists() and not (tmp_path.parent / "escape.tex").exists()
    assert client.post("/api/v1/projects/import", files={"file": ("n.zip", b"not a zip", "application/zip")}).status_code == 400


def test_main_file_detection_and_engine(tmp_path):
    (tmp_path / "paper.tex").write_text("% !TEX program = xelatex\n\\documentclass{article}\\begin{document}\\end{document}")
    (tmp_path / "notes.tex").write_text("just notes")
    assert build.main_file(tmp_path) == "paper.tex"
    assert build.engine_of(tmp_path, "paper.tex") == "xelatex"
    (tmp_path / "main.tex").write_text("x")
    assert build.main_file(tmp_path) == "main.tex"


@needs_tex
def test_build_pdf_search_pages_and_synctex(client):
    pid = make(client)["id"]
    base = f"/api/v1/projects/{pid}"
    assert client.get(base).json()["pdf"] is False
    assert client.post(f"{base}/build").status_code == 202
    s = wait_build(client, pid)
    assert s["status"] == "done" and s["outcome"]["pdf"], s
    st = client.get(base).json()
    assert st["pdf"] and not st["stale"]
    info = client.get(f"{base}/pdf/info").json()
    assert len(info["pages"]) >= 1
    assert client.get(f"{base}/pdf/page/1.png").content[:4] == b"\x89PNG"
    assert client.get(f"{base}/main.pdf").content[:4] == b"%PDF"
    assert client.get(f"{base}/pdf/search", params={"q": "Introduction"}).json()["total"] >= 1
    assert any(w["t"] == "Introduction" for w in client.get(f"{base}/pdf/text/1").json()["words"])
    fwd = client.post(f"{base}/source/forward", json={"file": "main.tex", "line": 22}).json()
    assert fwd["page"] == 1
    loc = client.post(f"{base}/source/locate", json={"page": 1, "x": fwd["x"] + 2, "y": fwd["y"] + 4}).json()
    assert loc["file"] == "main.tex"
    z = client.get(f"{base}/zip")
    assert z.status_code == 200 and "main.tex" in zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert not any(n.startswith("build/") for n in zipfile.ZipFile(io.BytesIO(z.content)).namelist())


@needs_tex
def test_build_error_is_reported_and_log_shown(client):
    pid = make(client)["id"]
    base = f"/api/v1/projects/{pid}"
    client.put(f"{base}/source", json={"file": "main.tex", "text": "\\documentclass{article}\\begin{document}\\badmacro\\end{document}"})
    client.post(f"{base}/build")
    s = wait_build(client, pid)
    assert s["outcome"]["ok"] is False and "badmacro" in s["outcome"]["error"]
    assert "Undefined control sequence" in client.get(f"{base}/source/log").json()["error"]
    assert "badmacro" in client.get(base).json()["latexError"]


def test_files_safe_rules(tmp_path):
    for bad in ("../a", "a/../../b", ".git/x", "build/x.tex", "a\0b"):
        with pytest.raises(InvalidInput):
            files.safe(tmp_path, bad)
    (tmp_path / "real").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "real")
    with pytest.raises(InvalidInput):
        files.safe(tmp_path, "link/x.tex")


def test_open_path_tex_file_sets_main_and_zip(client, tmp_path):
    d = tmp_path / "thesis"
    d.mkdir()
    (d / "main.tex").write_text("\\documentclass{article}\\begin{document}a\\end{document}")
    (d / "paper2.tex").write_text("\\documentclass{article}\\begin{document}b\\end{document}")
    r = client.post("/api/v1/projects/open-path", json={"path": str(d / "paper2.tex")}).json()
    assert client.get(f"/api/v1/projects/{r['id']}").json()["main"] == "paper2.tex"
    r2 = client.post("/api/v1/projects/open-path", json={"path": str(d)}).json()
    assert r2["id"] == r["id"]
    assert client.post("/api/v1/projects/open-path", json={"path": str(d / "nope.txt")}).status_code == 400
    z = tmp_path / "ol.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("main.tex", "\\documentclass{article}\\begin{document}c\\end{document}")
    assert client.post("/api/v1/projects/open-path", json={"path": str(z)}).status_code == 200


def test_upload_zip_unpacks_into_project(client):
    pid = make(client)["id"]
    base = f"/api/v1/projects/{pid}"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("extra/chapter.tex", "\\section{New}")
        z.writestr("extra/figs/a.png", "x")
        z.writestr("extra/../../evil.tex", "x")
        z.writestr("__MACOSX/._junk", "x")
        z.writestr("extra/.hidden", "x")
        z.writestr("extra/build/x.tex", "x")
    r = client.post(f"{base}/files/import-zip?folder=", files={"file": ("pack.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200, r.text
    assert sorted(r.json()["written"]) == ["chapter.tex", "figs/a.png"]            # the wrapping folder was unwrapped
    paths = [e["path"] for e in r.json()["entries"]]
    assert "chapter.tex" in paths and "figs/a.png" in paths
    assert client.post(f"{base}/files/import-zip", files={"file": ("x.zip", b"nope", "application/zip")}).status_code == 400
