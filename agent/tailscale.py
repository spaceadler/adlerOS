"""Taildrop for adlerOS, run by the helper as your user (Tailscale's operator,
so no sudo): what's possible, files sent to this machine into your storage
folder's Tailscale/ (or a folder you pick), and files sent to your other
devices. JSON out. Files' places (User, the Desktop, Root) are found the way
files.py finds them, standalone or in a homelab.

  tailscale.py status
  tailscale.py get FOLDER          (FOLDER: an adlerOS path in User or the Desktop)
  tailscale.py send DEVICE PATHS   (PATHS: adlerOS paths, one a line)
"""
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # files.py, beside this one
from files import Refused, locate, places  # noqa: E402

INBOX = "Tailscale"  # in your storage folder (adlerOS's /user/Tailscale)


def ts(*args, timeout=120):
    return subprocess.run(["tailscale", *args], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, check=False)


def status():
    try:
        prefs = json.loads(ts("debug", "prefs", timeout=20).stdout or "{}")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {"ok": False, "why": "tailscale isn't installed or isn't running"}
    me = getpass.getuser()
    if prefs.get("OperatorUser") != me:
        return {"ok": False, "operator": False, "user": me,
                "why": f"Tailscale doesn't let {me} use it without sudo", "fix": "sudo tailscale set --operator=$USER"}
    targets = []
    for line in ts("file", "cp", "--targets", timeout=20).stdout.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            targets.append({"ip": parts[0], "name": parts[1], "online": not (len(parts) > 2 and parts[2].startswith("offline")),
                            "note": parts[2] if len(parts) > 2 else ""})
    return {"ok": True, "operator": True, "user": me, "inbox": f"/user/{INBOX}", "targets": targets}


def host_path(path, allowed, want):
    """An adlerOS path (/user/…, /desktop/…, /root/…) on this machine, in one
    of the places allowed, or None if it leads out of its place or isn't what's
    wanted (a file, a folder)."""
    where = {k: v for k, v in places().items() if k in allowed}
    try:
        real = locate(path, where)[1]
    except Refused:
        return None
    return real if want(real) else None


def get(into):
    """`tailscale file get` into a folder of User or the Desktop (User/Tailscale
    is made the first time)."""
    user = places().get("user")
    if user and into.strip("/") == f"user/{INBOX}":
        (user / INBOX).mkdir(exist_ok=True)
    folder = host_path(into, ("user", "desktop"), Path.is_dir)
    if not folder:
        return {"ok": False, "why": "files can only be got into a folder of User or the Desktop"}
    before = set(os.listdir(folder))
    done = ts("file", "get", "--conflict=rename", str(folder))
    got = sorted(set(os.listdir(folder)) - before)
    if done.returncode and not got:
        return {"ok": False, "why": (done.stderr or done.stdout).strip()[-300:] or "tailscale file get failed"}
    return {"ok": True, "got": got, "into": into}


def send(device, paths):
    picked = [host_path(p, ("user", "desktop", "root"), Path.is_file) for p in paths.splitlines() if p.strip()]
    if not picked or None in picked:
        return {"ok": False, "why": "only files in your places can be sent"}
    done = ts("file", "cp", *map(str, picked), f"{device}:", timeout=3600)
    if done.returncode:
        return {"ok": False, "why": (done.stderr or done.stdout).strip()[-300:] or "tailscale file cp failed"}
    return {"ok": True, "sent": len(picked), "to": device}


if __name__ == "__main__":
    what = sys.argv[1]
    reply = status() if what == "status" else get(sys.argv[2]) if what == "get" else send(sys.argv[2], sys.argv[3]) if what == "send" else {"ok": False}
    print(json.dumps(reply))
