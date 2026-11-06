"""Background jobs (a compile) run in a thread; the page polls their state, so a refresh does not lose them."""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import asdict, dataclass, field


@dataclass
class Task:
    id: str
    scope: str                 # the project id
    kind: str                  # e.g. "build"
    label: str
    status: str = "running"    # running | done | failed | stopped
    progress: float = 0.0
    text: str = ""
    started: float = field(default_factory=time.time)
    elapsed: float = 0.0
    meta: dict = field(default_factory=dict)
    error: dict | None = None
    _proc: object = field(default=None, repr=False)


_tasks: dict[tuple[str, str], Task] = {}
_lock = threading.Lock()


def start(scope: str, kind: str, label: str, work) -> Task:
    """Run `work(task)` in a thread. One task per (project, kind): a second start while it runs returns the running one."""
    with _lock:
        cur = _tasks.get((scope, kind))
        if cur and cur.status == "running":
            return cur
        task = Task(uuid.uuid4().hex[:10], scope, kind, label)
        _tasks[(scope, kind)] = task

    def run() -> None:
        try:
            work(task)
            if task.status == "running":
                task.status = "done"
        except Exception as e:  # noqa: BLE001 - the page shows the message
            task.status = "failed"
            task.error = {"message": getattr(e, "message", None) or str(e)[:300], "hint": getattr(e, "hint", "")}
        finally:
            task.progress = 1.0
            task.elapsed = time.time() - task.started
    threading.Thread(target=run, name=f"task-{kind}", daemon=True).start()
    return task


def get(scope: str, kind: str) -> Task | None:
    return _tasks.get((scope, kind))


def stop(scope: str, kind: str) -> bool:
    t = _tasks.get((scope, kind))
    if t and t.status == "running":
        t.status = "stopped"
        proc = t._proc
        if proc is not None and getattr(proc, "poll", lambda: 0)() is None:
            proc.kill()
        return True
    return False


def dismiss(scope: str, kind: str) -> None:
    t = _tasks.get((scope, kind))
    if t and t.status != "running":
        _tasks.pop((scope, kind), None)


def snapshot() -> list[dict]:
    out = []
    for t in list(_tasks.values()):
        if t.status == "running":
            t.elapsed = time.time() - t.started
        d = asdict(t)
        d.pop("_proc", None)
        out.append(d)
    return out
