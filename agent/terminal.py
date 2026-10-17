#!/usr/bin/env python3
"""The adlerOS terminal host: shells in pseudo-terminals for adlerOS's
Terminal window. Off unless ADLEROS_TERMINAL=on in the settings file (.env,
or homelab.env in a homelab), which adlerOS itself can't change.

systemd starts this (adleros-terminal.path) when adlerOS asks for a session
by writing data/agent/term/<id>/start.json; adlerOS only does that in admin
mode, after you type your password again. Each session is your login shell
(fish, zsh, bash: whatever your account has), as you, starting in
ADLEROS_TERMINAL_DIR, else the homelab's folder in a homelab, else your home
folder. What you type arrives in the session's `in` file and
goes to the shell; what the shell writes goes to its `out` file for adlerOS to
show. A session ends when its shell exits, when adlerOS writes `close`, after
30 minutes without typing, or at 20 MB of output. This exits when no session
is left.

    python3 agent/terminal.py     run sessions until there are none
"""
import errno
import fcntl
import json
import os
import pty
import pwd
import re
import select
import shutil
import signal
import stat
import struct
import sys
import termios
import time
from pathlib import Path

ADLEROS = Path(__file__).resolve().parents[1]
HOMELAB = Path(os.environ["HOMELAB_DIR"]).resolve() if os.environ.get("HOMELAB_DIR") else None
DATA_DIR = HOMELAB / "containers/core/os/data" if HOMELAB else ADLEROS / "data"
CONFIG = HOMELAB / "homelab.env" if HOMELAB else ADLEROS / ".env"
TERM_DIR = DATA_DIR / "agent" / "term"

SID = re.compile(r"[a-f0-9]{32}")
START_WITHIN = 60  # seconds: an older request is stale
IDLE_LIMIT = 30 * 60
OUTPUT_LIMIT = 20 * 1024 * 1024
KEEP_ENDED = 120  # seconds an ended session's folder stays, for the page to read the end
QUIT_AFTER = 30  # seconds with no sessions before this exits
MAX_SESSIONS = 3


def log(message):
    print(message, flush=True)  # the journal: journalctl -u adleros-terminal


def setting(key):
    """KEY's value in the settings file (the last one, like install.sh), or ''."""
    found = ""
    try:
        for line in CONFIG.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == key:
                found = value.strip().strip("\"'")
    except OSError:
        pass
    return found


def enabled():
    return setting("ADLEROS_TERMINAL").lower() in ("on", "yes", "true", "1")


def login_shell():
    """Your account's shell, as in /etc/passwd: not $SHELL, which is whatever
    started this."""
    try:
        shells = [pwd.getpwuid(os.getuid()).pw_shell]
    except KeyError:
        shells = []
    for shell in shells + [os.environ.get("SHELL", ""), "/bin/bash", "/bin/sh"]:
        if shell and not shell.endswith(("/nologin", "/false")) and os.access(shell, os.X_OK):
            return shell
    return "/bin/sh"


def start_folder():
    """ADLEROS_TERMINAL_DIR (~/ or relative to your home folder), else the
    homelab's folder in a homelab, else your home folder."""
    home = os.path.expanduser("~")
    wanted = setting("ADLEROS_TERMINAL_DIR")
    folder = os.path.join(home, os.path.expanduser(wanted)) if wanted else str(HOMELAB or home)
    return folder if os.path.isdir(folder) else home


def ours(path):
    """A plain file (or folder) of ours, never a link someone planted."""
    try:
        info = os.lstat(path)
    except OSError:
        return False
    return info.st_uid == os.getuid() and (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode))


def write_ended(folder, why, code=None):
    """Tells the page the session is over, and why."""
    fd = os.open(folder / "ended", os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"why": why, "code": code, "at": time.time()}, f)


def read_small(path, limit=4096):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as f:
        return f.read(limit)


def set_size(fd, rows, cols):
    rows = max(5, min(int(rows), 300))
    cols = max(20, min(int(cols), 500))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


class Session:
    def __init__(self, sid, folder, rows, cols):
        self.sid, self.folder = sid, folder
        self.in_offset = 0
        self.size = None
        self.written = 0
        self.last_input = time.monotonic()
        shell, cwd = login_shell(), start_folder()
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL")}
        env.update(TERM="xterm-256color", COLORTERM="truecolor", SHELL=shell)
        self.pid, self.fd = pty.fork()
        if self.pid == 0:  # the shell
            try:
                os.chdir(cwd)
            except OSError:
                pass
            try:
                os.execve(shell, [os.path.basename(shell), "-l"], env)
            finally:
                os._exit(127)  # never fall back into the host's loop
        set_size(self.fd, rows, cols)
        os.set_blocking(self.fd, False)
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW
        self.out = os.open(folder / "out", flags, 0o600)
        log(f"{sid}: started {shell} in {cwd} (pid {self.pid})")

    def pump_output(self):
        try:
            data = os.read(self.fd, 65536)
        except OSError as e:
            if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                return True
            return False  # EIO: the shell has gone
        if not data:
            return False
        os.write(self.out, data)
        self.written += len(data)
        return self.written < OUTPUT_LIMIT

    def pump_input(self):
        path = self.folder / "in"
        if not ours(path):
            return
        size = os.lstat(path).st_size
        if size <= self.in_offset:
            return
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.lseek(fd, self.in_offset, os.SEEK_SET)
            data = os.read(fd, min(size - self.in_offset, 65536))
        finally:
            os.close(fd)
        self.in_offset += len(data)
        self.last_input = time.monotonic()
        view = memoryview(data)
        while view:
            try:
                n = os.write(self.fd, view)
                view = view[n:]
            except BlockingIOError:
                select.select([], [self.fd], [], 1)

    def check_size(self):
        path = self.folder / "size"
        if not ours(path):
            return
        try:
            rows, cols = (int(x) for x in read_small(path).split()[:2])
        except (OSError, ValueError):
            return
        if (rows, cols) != self.size:
            self.size = (rows, cols)
            set_size(self.fd, rows, cols)
            os.kill(self.pid, signal.SIGWINCH)

    def wanted_closed(self):
        return (self.folder / "close").exists() or time.monotonic() - self.last_input > IDLE_LIMIT

    def end(self, why):
        try:
            os.kill(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        code = None
        for _ in range(20):
            try:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                break
            if pid:
                code = os.waitstatus_to_exitcode(status)
                break
            time.sleep(0.05)
        else:
            try:
                os.kill(self.pid, signal.SIGKILL)
                os.waitpid(self.pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        for fd in (self.fd, self.out):
            try:
                os.close(fd)
            except OSError:
                pass
        write_ended(self.folder, why, code)
        log(f"{self.sid}: ended ({why})")


def new_requests(sessions):
    """Sessions adlerOS asked for: TERM_DIR/<sid>/start.json, recent and ours."""
    found = []
    if not TERM_DIR.is_dir():
        return found
    for folder in TERM_DIR.iterdir():
        start = folder / "start.json"
        if folder.name in sessions or not SID.fullmatch(folder.name) or not ours(folder) or not start.exists():
            continue
        try:
            if not ours(start):
                raise ValueError("not a file of ours")
            request = json.loads(read_small(start))
            if request.get("sid") != folder.name:
                raise ValueError("mismatched")
            if time.time() - float(request.get("created", 0)) > START_WITHIN:
                raise ValueError("too old: the terminal host wasn't running")
            rows, cols = int(request.get("rows", 24)), int(request.get("cols", 80))
        except (OSError, ValueError, TypeError) as e:
            log(f"{folder.name}: refused ({e})")
            start.unlink(missing_ok=True)
            # So the page stops waiting, and it no longer counts as open.
            try:
                write_ended(folder, f"refused ({e})")
            except OSError:
                pass
            continue
        # Taken: so systemd's path unit doesn't start us again for it.
        os.replace(start, folder / "started.json")
        found.append((folder.name, folder, rows, cols))
    return found


def tidy():
    """Remove folders of sessions that ended a while ago, or never started."""
    if not TERM_DIR.is_dir():
        return
    now = time.time()
    for folder in TERM_DIR.iterdir():
        if not SID.fullmatch(folder.name) or not ours(folder):
            continue
        ended = folder / "ended"
        try:
            age = now - os.lstat(ended if ended.exists() else folder).st_mtime
        except OSError:
            continue
        if (ended.exists() and age > KEEP_ENDED) or (not (folder / "started.json").exists()
                                                     and not (folder / "start.json").exists() and age > KEEP_ENDED):
            shutil.rmtree(folder, ignore_errors=True)


def main():
    if os.geteuid() == 0:
        sys.exit("the terminal host runs as your user, not root")
    if not enabled():
        # Refuse every request, so the page says so instead of waiting.
        for sid, folder, _, _ in new_requests({}):
            write_ended(folder, "the terminal is off (ADLEROS_TERMINAL)")
        sys.exit("the terminal is off: set ADLEROS_TERMINAL=on in the settings file to allow it")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    sessions = {}
    idle_since = time.monotonic()
    try:
        while True:
            for sid, folder, rows, cols in new_requests(sessions):
                if len(sessions) >= MAX_SESSIONS:
                    write_ended(folder, f"at most {MAX_SESSIONS} terminals at once")
                    continue
                try:
                    sessions[sid] = Session(sid, folder, rows, cols)
                except OSError as e:
                    log(f"{sid}: couldn't start: {e}")
            if sessions:
                ready, _, _ = select.select([s.fd for s in sessions.values()], [], [], 0.04)
                for s in list(sessions.values()):
                    alive = s.pump_output() if s.fd in ready else True
                    s.pump_input()
                    s.check_size()
                    why = None if alive else ("the shell exited" if s.written < OUTPUT_LIMIT else "too much output")
                    if not why and s.wanted_closed():
                        why = "closed" if (s.folder / "close").exists() else "idle for 30 minutes"
                    if why:
                        s.end(why)
                        del sessions[s.sid]
                idle_since = time.monotonic()
            else:
                time.sleep(0.25)
                tidy()
                if time.monotonic() - idle_since > QUIT_AFTER:
                    return
    finally:
        for s in sessions.values():
            s.end("the terminal host stopped")


if __name__ == "__main__":
    main()
