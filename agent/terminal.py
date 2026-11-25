#!/usr/bin/env python3
"""The adlerOS terminal host: shells in pseudo-terminals for adlerOS's
Terminal window. Off unless ADLEROS_TERMINAL=on in the settings file (.env,
or homelab.env in a homelab), which adlerOS itself can't change.

systemd starts this (adleros-terminal.path) when adlerOS asks for a session
by writing data/agent/term/<id>/start.json; adlerOS only does that in admin
mode (which your password turns on). Each session is your login shell
(fish, zsh, bash: whatever your account has), as you, starting in
ADLEROS_TERMINAL_DIR, else the homelab's folder in a homelab, else your home
folder.

Each session listens on a socket of its own, term/<id>/sock (yours only),
and adlerOS connects to it for as long as a Terminal window shows that
session: what you type comes in on it, and what the shell writes goes out on
it, to every window showing the session. The last REPLAY bytes are kept, so
a window that connects later (the page reloaded, another device) gets the
screen back. A message either way is a type byte, a 4-byte length and that
many bytes: in, i (typed), s ("rows cols"), c (close); out, r (what's kept,
first, once: perhaps nothing), o (output) and e (the end, as JSON).

A session ends when its shell exits or when adlerOS closes it (on its
socket, or with a `close` file); nothing limits how much it writes or how
many run at once. This exits when no session is left.

    python3 agent/terminal.py     run sessions until there are none
"""
import fcntl
import json
import os
import pty
import pwd
import re
import select
import shutil
import signal
import socket
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
REPLAY = 1024 * 1024  # bytes of output kept for a window that connects later
BEHIND = 8 * 1024 * 1024  # bytes a window may fall behind before it's let go (it connects again)
MESSAGE_LIMIT = 1024 * 1024  # the most one message from adlerOS may carry
HEADER = struct.Struct(">cI")  # a message's type and length
# The alternate screen (htop, vim, less) going on or off, as a program asks.
ALT_SCREEN = re.compile(rb"\x1b\[\?(?:1049|1047|47)([hl])")
KEEP_ENDED = 120  # seconds an ended session's folder stays, for the page to read the end
QUIT_AFTER = 30  # seconds with no sessions before this exits


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


def message(kind, data=b""):
    return HEADER.pack(kind, len(data)) + data


def bind_here(sock, path):
    """Binds a socket at path. Linux takes 107 bytes at most for that, so a
    longer path (a homelab deep in the disk) goes through its folder's
    descriptor instead."""
    if len(os.fsencode(str(path))) < 100:
        return sock.bind(str(path))
    folder = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        sock.bind(f"/proc/self/fd/{folder}/{path.name}")
    finally:
        os.close(folder)


class Window:
    """One of adlerOS's connections to a session: a Terminal window showing it."""

    def __init__(self, sock):
        self.sock = sock
        self.inbox = bytearray()  # what it sent that isn't a whole message yet
        self.outbox = bytearray()  # what's waiting to go to it

    def messages(self):
        """The whole messages it has sent so far, (type, bytes) each."""
        while len(self.inbox) >= HEADER.size:
            kind, size = HEADER.unpack_from(self.inbox)
            if size > MESSAGE_LIMIT:
                raise ValueError("a message too big")
            if len(self.inbox) < HEADER.size + size:
                return
            data = bytes(self.inbox[HEADER.size:HEADER.size + size])
            del self.inbox[:HEADER.size + size]
            yield kind, data


class Session:
    def __init__(self, sid, folder, rows, cols, where=""):
        self.sid, self.folder = sid, folder
        self.size = (rows, cols)
        self.windows = {}  # a window's socket's fd -> Window
        self.kept = bytearray()  # the last REPLAY bytes the shell wrote
        self.cut = False  # whether kept starts part-way through
        self.alt = False  # whether the program in front has the alternate screen up
        self.to_shell = bytearray()  # typed, not yet taken by the shell
        self.closing = None  # why it ends, once a window asked
        # Its socket before its shell: the request only counts as taken
        # (started.json) once the socket is there to connect to.
        path = folder / "sock"
        if os.path.lexists(path):
            os.unlink(path)
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        umask = os.umask(0o177)  # yours only: 0600
        try:
            bind_here(self.listener, path)
        finally:
            os.umask(umask)
        self.listener.listen(8)
        self.listener.setblocking(False)
        # Open in Terminal: in that folder (one that's there), else as always.
        shell, cwd = login_shell(), where if where and os.path.isabs(where) and os.path.isdir(where) else start_folder()
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL")}
        env.update(TERM="xterm-256color", COLORTERM="truecolor", SHELL=shell)
        self.pid, self.fd = pty.fork()
        if self.pid == 0:  # the shell (the sockets close as it starts: Python's aren't inherited)
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
        log(f"{sid}: started {shell} in {cwd} (pid {self.pid})")

    def read_shell(self):
        """What the shell wrote, kept and sent to every window. False once
        the shell has gone."""
        try:
            data = os.read(self.fd, 65536)
        except BlockingIOError:
            return True
        except OSError:
            return False  # EIO: the shell has gone
        if not data:
            return False
        self.kept += data
        if len(self.kept) > REPLAY:
            del self.kept[:len(self.kept) - REPLAY]
            self.cut = True
        for m in ALT_SCREEN.finditer(data):
            self.alt = m[1] == b"h"
        out = message(b"o", data)
        for w in list(self.windows.values()):
            self.send(w, out)
        return True

    def write_shell(self):
        try:
            n = os.write(self.fd, self.to_shell)
        except BlockingIOError:
            return
        except OSError:
            n = len(self.to_shell)  # the shell is going; read_shell sees to it
        del self.to_shell[:n]

    def send(self, w, data):
        w.outbox += data
        if len(w.outbox) > BEHIND:
            log(f"{self.sid}: a window fell too far behind; let go (it connects again)")
            self.drop(w)

    def accept(self):
        """A window connecting: the screen so far (an r message, sent even
        when it's empty, so the window knows what's old), then what comes next."""
        try:
            sock, _ = self.listener.accept()
        except (BlockingIOError, InterruptedError):
            return
        sock.setblocking(False)
        w = Window(sock)
        self.windows[sock.fileno()] = w
        replay = bytes(self.kept)
        if self.cut:  # from a line's start, not part-way through a character or a colour
            replay = replay[replay.find(b"\n") + 1:]
            if self.alt and not ALT_SCREEN.search(replay):
                replay = b"\x1b[?1049h" + replay  # it went up before what's kept
        self.send(w, message(b"r", replay))
        if replay:
            self.redraw()

    def redraw(self):
        """The program in front draws its screen again, as after a resize:
        what's kept is the last of the output, not always all that shows."""
        try:
            os.killpg(os.tcgetpgrp(self.fd), signal.SIGWINCH)
        except OSError:
            pass

    def read_window(self, w):
        try:
            data = w.sock.recv(65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            data = b""
        if not data:
            return self.drop(w)
        w.inbox += data
        try:
            for kind, body in w.messages():
                if kind == b"i":
                    if len(self.to_shell) + len(body) > BEHIND:
                        raise ValueError("typing faster than the shell reads")
                    self.to_shell += body
                elif kind == b"s":
                    self.resize(body)
                elif kind == b"c":
                    self.closing = "closed"
        except ValueError as e:
            log(f"{self.sid}: let a window go ({e})")
            self.drop(w)

    def write_window(self, w):
        try:
            n = w.sock.send(w.outbox)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            return self.drop(w)
        del w.outbox[:n]

    def drop(self, w):
        self.windows.pop(w.sock.fileno(), None)
        w.sock.close()

    def resize(self, body):
        try:
            rows, cols = (int(x) for x in body.split()[:2])
        except ValueError:
            return
        if (rows, cols) != self.size:
            self.size = (rows, cols)
            set_size(self.fd, rows, cols)
            os.kill(self.pid, signal.SIGWINCH)

    def wanted_closed(self):
        return self.closing or ("closed" if (self.folder / "close").exists() else None)

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
        try:
            os.close(self.fd)
        except OSError:
            pass
        write_ended(self.folder, why, code)
        # Each window gets what was still on its way, then the end (a
        # second at most each: one that stopped reading doesn't hold up the rest).
        end = message(b"e", json.dumps({"why": why, "code": code}).encode())
        for w in list(self.windows.values()):
            try:
                w.sock.settimeout(1)
                w.sock.sendall(bytes(w.outbox) + end)
            except OSError:
                pass
            self.drop(w)
        self.listener.close()
        try:
            os.unlink(self.folder / "sock")
        except OSError:
            pass
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
            where = request.get("dir") if isinstance(request.get("dir"), str) else ""
        except (OSError, ValueError, TypeError) as e:
            refuse(folder, f"refused ({e})")
            continue
        found.append((folder.name, folder, rows, cols, where))
    return found


def refuse(folder, why):
    """A request that won't be a session: gone, so systemd's path unit
    doesn't start us again for it, and ended, so the page stops waiting."""
    log(f"{folder.name}: {why}")
    (folder / "start.json").unlink(missing_ok=True)
    try:
        write_ended(folder, why)
    except OSError:
        pass


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
        for sid, folder, *_ in new_requests({}):
            refuse(folder, "the terminal is off (ADLEROS_TERMINAL)")
        sys.exit("the terminal is off: set ADLEROS_TERMINAL=on in the settings file to allow it")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    sessions = {}
    idle_since = time.monotonic()
    try:
        while True:
            for sid, folder, rows, cols, where in new_requests(sessions):
                try:
                    sessions[sid] = Session(sid, folder, rows, cols, where)
                except OSError as e:
                    refuse(folder, f"couldn't start ({e})")
                    continue
                # Taken (its socket is up): systemd's path unit won't start us again for it.
                os.replace(folder / "start.json", folder / "started.json")
            if not sessions:
                time.sleep(0.25)
                tidy()
                if time.monotonic() - idle_since > QUIT_AFTER:
                    return
                continue
            # Wait for the shells, their windows and new windows (and, a
            # quarter of a second at most, for new requests and `close`).
            reads, writes = [], []
            for s in sessions.values():
                reads += [s.fd, s.listener.fileno(), *s.windows]
                writes += [s.fd] if s.to_shell else []
                writes += [fd for fd, w in s.windows.items() if w.outbox]
            readable, writable, _ = select.select(reads, writes, [], 0.25)
            readable, writable = set(readable), set(writable)
            for s in list(sessions.values()):
                alive = s.read_shell() if s.fd in readable else True
                if s.listener.fileno() in readable:
                    s.accept()
                for fd, w in list(s.windows.items()):
                    if fd in readable:
                        s.read_window(w)
                if s.to_shell and s.fd in writable:
                    s.write_shell()
                for fd, w in list(s.windows.items()):
                    if w.outbox and fd in writable:
                        s.write_window(w)
                why = s.wanted_closed() if alive else "the shell exited"
                if why:
                    s.end(why)
                    del sessions[s.sid]
            idle_since = time.monotonic()
    finally:
        for s in sessions.values():
            s.end("the terminal host stopped")


if __name__ == "__main__":
    main()
