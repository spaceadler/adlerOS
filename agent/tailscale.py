"""Taildrop for adlerOS, run by the helper as your user (Tailscale's operator,
so no sudo): what's possible, files sent to this machine into your storage
folder's Tailscale/, and files sent to your other devices. JSON out.

  tailscale.py ADLEROS status
  tailscale.py ADLEROS get
  tailscale.py ADLEROS send DEVICE PATHS   (PATHS: adlerOS paths, one a line)
"""
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path

INBOX = "Tailscale"  # in your storage folder (adlerOS's /user/Tailscale)


def settings(adleros):
    """adlerOS's .env, as KEY: value."""
    found = {}
    try:
        for line in Path(adleros, ".env").read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                found[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    return found


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


def get(adleros):
    storage = settings(adleros).get("STORAGE_DIR")
    if not storage or not Path(storage).is_dir():
        return {"ok": False, "why": "adlerOS has no storage folder (STORAGE_DIR)"}
    inbox = Path(storage, INBOX)
    inbox.mkdir(exist_ok=True)
    before = set(os.listdir(inbox))
    done = ts("file", "get", "--conflict=rename", str(inbox))
    got = sorted(set(os.listdir(inbox)) - before)
    if done.returncode and not got:
        return {"ok": False, "why": (done.stderr or done.stdout).strip()[-300:] or "tailscale file get failed"}
    return {"ok": True, "got": got, "inbox": f"/user/{INBOX}"}


def host_path(adleros, path):
    """An adlerOS path (/user/…, /desktop/…, /root/…) on this machine, or None
    if it leads out of its place."""
    env = settings(adleros)
    tops = {"user": env.get("STORAGE_DIR"), "desktop": env.get("DESKTOP_DIR"), "root": env.get("FILES_ROOT")}
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if not parts or ".." in parts or not tops.get(parts[0]):
        return None
    top = Path(tops[parts[0]]).resolve()
    real = top.joinpath(*parts[1:]).resolve()
    return real if real.is_file() and real.is_relative_to(top) else None


def send(adleros, device, paths):
    files = [host_path(adleros, p) for p in paths.splitlines() if p.strip()]
    if not files or None in files:
        return {"ok": False, "why": "only files in your places can be sent"}
    done = ts("file", "cp", *map(str, files), f"{device}:", timeout=3600)
    if done.returncode:
        return {"ok": False, "why": (done.stderr or done.stdout).strip()[-300:] or "tailscale file cp failed"}
    return {"ok": True, "sent": len(files), "to": device}


if __name__ == "__main__":
    adleros, what = sys.argv[1], sys.argv[2]
    reply = status() if what == "status" else get(adleros) if what == "get" else send(adleros, sys.argv[3], sys.argv[4]) if what == "send" else {"ok": False}
    print(json.dumps(reply))
