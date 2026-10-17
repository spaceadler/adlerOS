#!/usr/bin/env python3
"""Changes in Files' Root (the homelab's own folder), made by the helper:
adlerOS sees Root read-only, so it writes what it wants done into
data/agent/files/<request>.json and queues the files-root action with that
name. adlerOS only does that in admin mode; this also refuses unless the
machine allows shell-level access (ADLEROS_TERMINAL=on in the settings file,
which adlerOS can't change), because editing the homelab is that much power.

Paths are Files' own: /root/containers/..., /desktop/..., /user/....
Deleting in Root moves into User's Trash, like everything else.

    python3 agent/files.py REQUEST    prints {"ok": ...} or {"error": ...}
"""
import json
import os
import re
import secrets
import shutil
import stat
import sys
import time
from pathlib import Path

ADLEROS = Path(__file__).resolve().parents[1]
HOMELAB = Path(os.environ["HOMELAB_DIR"]).resolve() if os.environ.get("HOMELAB_DIR") else None
DATA_DIR = HOMELAB / "containers/core/os/data" if HOMELAB else ADLEROS / "data"
CONFIG = HOMELAB / "homelab.env" if HOMELAB else ADLEROS / ".env"
REQUESTS = DATA_DIR / "agent" / "files"
TOKEN = re.compile(r"[a-f0-9]{32}")
FRESH = 600  # seconds: an older request is stale
TRASH = ".trash"
TEXT_LIMIT = 2 * 1024 * 1024


def setting(key):
    """KEY's value in the settings file (the last one), or ''."""
    found = ""
    try:
        for line in CONFIG.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == key:
                found = value.strip().strip("\"'")
    except OSError:
        pass
    return found


def folder(value):
    value = os.path.expanduser(value) if value else ""
    return Path(value).resolve() if value.startswith("/") else None


def places():
    """Files' places, as folders on this machine."""
    if HOMELAB:
        found = {"root": HOMELAB, "desktop": HOMELAB / "mailbox",
                 "user": folder(setting("STORAGE_DIR")) or HOMELAB / "storage"}
    else:
        found = {"root": folder(setting("FILES_ROOT")), "desktop": folder(setting("DESKTOP_DIR")),
                 "user": folder(setting("STORAGE_DIR"))}
    return {k: v for k, v in found.items() if v and v.is_dir()}


class Refused(Exception):
    pass


def locate(path, where, must_exist=True):
    """(place, real path) for a Files path. A place inside another (Root's
    mailbox/) counts as itself; '..' and links out of a place are refused."""
    parts = [p for p in str(path).split("/") if p not in ("", ".")] if isinstance(path, str) else []
    if not parts or ".." in parts or parts[0] not in where:
        raise Refused(f"not a path in Files: {path}")
    place, rest = parts[0], parts[1:]
    for _ in where:
        hop = None
        for other, top in where.items():
            if other == place or not top.is_relative_to(where[place]) or top == where[place]:
                continue
            inner = top.relative_to(where[place]).parts
            if tuple(rest[:len(inner)]) == inner and (not hop or len(inner) > len(hop[1])):
                hop = (other, inner)
        if not hop:
            break
        place, rest = hop[0], rest[len(hop[1]):]
    top = where[place]
    try:
        real = top.joinpath(*rest).resolve(strict=must_exist)
    except (OSError, RuntimeError):
        raise Refused(f"no such file or folder: {path}") from None
    if real != top and not real.is_relative_to(top):
        raise Refused(f"that leads out of {place}: {path}")
    return place, real


def files_path(place, real, where):
    rel = real.relative_to(where[place])
    return f"/{place}" + ("" if str(rel) == "." else f"/{rel}")


def good_name(name):
    return (isinstance(name, str) and 0 < len(name) <= 255 and "/" not in name and "\x00" not in name
            and name not in (".", "..", TRASH) and name.isprintable())


def changeable(place, real, where):
    """Not a place itself, and not in a Trash."""
    if real == where[place] or real.is_relative_to(where[place] / TRASH):
        raise Refused("can't change that (a place itself, or something in the Trash)")


def unique_name(parent, name):
    candidate, n = parent / name, 2
    stem, suffix = Path(name).stem, Path(name).suffix
    while candidate.exists() or candidate.is_symlink():
        candidate = parent / f"{stem} ({n}){suffix}"
        n += 1
    return candidate


def move(src, target):
    """A rename on the same disk; otherwise copied (links as links), then removed."""
    try:
        os.rename(src, target)
    except OSError:
        if src.is_dir() and not src.is_symlink():
            shutil.copytree(src, target, symlinks=True)
            shutil.rmtree(src)
        else:
            shutil.copy2(src, target, follow_symlinks=False)
            src.unlink()


def copy(src, target):
    if src.is_dir() and not src.is_symlink():
        shutil.copytree(src, target, symlinks=True)
    else:
        shutil.copy2(src, target, follow_symlinks=False)


# ------------------------------------------------------------------ ops

def op_text(req, where):
    place, real = locate(req.get("path"), where, must_exist=False)
    changeable(place, real, where)
    text = req.get("text")
    if not isinstance(text, str) or len(text.encode()) > TEXT_LIMIT:
        raise Refused("expected text, at most 2 MB")
    if real.exists():
        if not real.is_file():
            raise Refused("that's a folder")
        mtime = req.get("mtime")
        if isinstance(mtime, (int, float)) and abs(real.stat().st_mtime - mtime) > 0.001:
            return {"error": "changed since you opened it", "conflict": True}
    elif req.get("mtime") is not None or not real.parent.is_dir():
        raise Refused("it's gone, or its folder is")
    tmp = real.with_name(f".{real.name}.{secrets.token_hex(4)}.saving")
    tmp.write_text(text)
    if real.exists():
        os.chmod(tmp, real.stat().st_mode & 0o7777)
    os.replace(tmp, real)
    return {"ok": True, "path": files_path(place, real, where), "mtime": real.stat().st_mtime}


def op_mkdir(req, where):
    place, parent = locate(req.get("path"), where)
    if not parent.is_dir() or not good_name(req.get("name")):
        raise Refused("a folder name, without /")
    target = parent / req["name"]
    if target.exists():
        raise Refused("there's already something called that")
    target.mkdir()
    return {"ok": True, "path": files_path(place, target, where)}


def op_rename(req, where):
    place, real = locate(req.get("path"), where)
    changeable(place, real, where)
    if not good_name(req.get("name")):
        raise Refused("a new name, without /")
    target = real.parent / req["name"]
    if target.exists():
        raise Refused("there's already something called that")
    real.rename(target)
    return {"ok": True, "path": files_path(place, target, where)}


def op_delete(req, where):
    if "user" not in where:
        raise Refused("no User folder for the Trash")
    found = [locate(p, where) for p in req.get("paths") or []]
    for place, real in found:
        changeable(place, real, where)
    for place, real in found:
        slot = where["user"] / TRASH / f"{int(time.time() * 1000)}-{secrets.token_hex(3)}"
        slot.mkdir(parents=True)
        (slot / "meta.json").write_text(json.dumps({"from": files_path(place, real, where), "deleted": time.time()}))
        move(real, slot / real.name)
    return {"ok": True, "moved": len(found)}


def op_restore(req, where):
    done = 0
    for item_id in req.get("ids") or []:
        match = re.fullmatch(r"user/(\d+-[0-9a-f]{6})", str(item_id))
        slot = where["user"] / TRASH / match[1] if match and "user" in where else None
        if not slot or not slot.is_dir() or slot.is_symlink():
            continue
        item = next((p for p in slot.iterdir() if p.name != "meta.json"), None)
        try:
            origin = json.loads((slot / "meta.json").read_text()).get("from", "")
        except (OSError, ValueError):
            origin = ""
        try:
            _, parent = locate(str(Path(origin).parent), where)
        except Refused:
            parent = where.get("root")
        if item and parent and parent.is_dir():
            move(item, unique_name(parent, item.name))
            shutil.rmtree(slot)
            done += 1
    return {"ok": True, "done": done}


def op_transfer(req, where, copying):
    dest, target_dir = locate(req.get("to"), where)
    if not target_dir.is_dir() or target_dir.is_relative_to(where[dest] / TRASH):
        raise Refused("pick a folder to put them in")
    found = [locate(p, where) for p in req.get("paths") or []]
    for place, src in found:
        if not copying:
            changeable(place, src, where)
        if target_dir == src or target_dir.is_relative_to(src):
            raise Refused("a folder can't go inside itself")
    for _, src in found:
        target = unique_name(target_dir, src.name)
        copy(src, target) if copying else move(src, target)
    return {"ok": True, "path": files_path(dest, target_dir, where)}


OPS = {"text": op_text, "mkdir": op_mkdir, "rename": op_rename, "delete": op_delete, "restore": op_restore,
       "move": lambda r, w: op_transfer(r, w, False), "copy": lambda r, w: op_transfer(r, w, True)}


def read_request(token):
    if not TOKEN.fullmatch(token):
        raise Refused("bad request name")
    path = REQUESTS / f"{token}.json"
    try:
        info = os.lstat(path)
        if info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode) or info.st_size > 3 * TEXT_LIMIT:
            raise Refused("not a request of ours")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as f:
            request = json.load(f)
    except (OSError, ValueError):
        raise Refused("no such request") from None
    finally:
        path.unlink(missing_ok=True)  # used once, whatever happens
    if not isinstance(request, dict) or time.time() - float(request.get("created", 0)) > FRESH:
        raise Refused("the request is too old")
    return request


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    try:
        request = read_request(sys.argv[1])
        if setting("ADLEROS_TERMINAL").lower() not in ("on", "yes", "true", "1"):
            raise Refused("Root is read-only on this machine: changing it needs ADLEROS_TERMINAL=on")
        op = OPS.get(request.get("op"))
        if not op:
            raise Refused(f"unknown change: {request.get('op')!r}")
        result = op(request, places())
    except Refused as e:
        result = {"error": str(e)}
    except OSError as e:
        result = {"error": f"{e.strerror or e}{f': {e.filename}' if e.filename else ''}"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
