# LaTeX Studio

An Overleaf-style LaTeX editor for any project folder on your computer. No account, no cloud: it compiles with your local TeX installation.

- Code and Visual editor, syntax completion (commands, `\cite` keys, `\label`s), find/replace, tabs, file explorer (new, rename, delete, upload, download).
- PDF viewer with text selection, search, zoom, and SyncTeX both ways (click the PDF to jump to the source; arrow to the PDF position).
- Recompile with latexmk (engine from `% !TEX program = xelatex`), compile log with the first error, Stop.
- Open any folder, create a project, or import an Overleaf zip (Menu → Download → Source). Download the project as a zip.

## Install as an app (macOS)

    ./scripts/install-app.sh        # builds ~/Applications/LaTeX Studio.app

Double-click **LaTeX Studio** (Launchpad / Spotlight work too). It starts its own server, opens a window of its own
(Chrome or Edge in app mode, else your browser) and quits by itself after 30 idle minutes. Launching it again opens another window.
The app uses this folder's Python environment, so keep the folder where it is, and re-run the script after updating the code.
Server log: `~/.latexstudio/server.log`.

## Run from a terminal

    ./latexstudio.sh                 # http://127.0.0.1:8700
    ./latexstudio.sh ~/papers/thesis # open a folder directly

Needs Python 3.10+, Node 18+ (first build only) and a TeX installation (MacTeX / TeX Live).
Projects are listed in `~/.latexstudio/projects.json`; new and imported ones live in `~/LatexStudio/`
(`LATEXSTUDIO_HOME`, `LATEXSTUDIO_WORKSPACE`, `LATEXSTUDIO_TEX_BIN` override).

## Safety

The server listens on 127.0.0.1 only, refuses other host names and cross-site writes, confines every file operation to the project folder
(no `..`, no hidden names, no symlinks), and runs TeX without secret-looking environment variables.

## Develop

    .venv/bin/python -m pytest          # API + real compile tests
    cd web && npm run dev                # :5174, proxies /api to :8700
    cd web && npm run build

The editor components are shared in spirit with ResearchRAG's editor; AI features (assist, chat) are not part of this app.
