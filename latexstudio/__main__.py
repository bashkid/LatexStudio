"""`latexstudio` : start the editor on this computer and open it in the browser."""
from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn


def main() -> None:
    ap = argparse.ArgumentParser(prog="latexstudio", description="An Overleaf-style LaTeX editor for projects on this computer.")
    ap.add_argument("folder", nargs="?", help="open this project folder at start")
    ap.add_argument("--port", type=int, default=8700, help="port to listen on (default 8700)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    a = ap.parse_args()
    url = f"http://127.0.0.1:{a.port}"
    if a.folder:
        from . import registry
        row = registry.add(a.folder)
        url += f"/p/{row['id']}"
    if not a.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"LaTeX Studio on {url}  (Ctrl+C to stop)")
    uvicorn.run("latexstudio.app:app", host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
