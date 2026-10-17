#!/usr/bin/env python3
"""adlerOS, the home screen: the web app in ./static plus a small JSON API.

Standard library only, so the container is a stock Python image with this
folder mounted read-only.

    POST /api/login        {"password": "..."} -> session cookie
    POST /api/logout
    GET  /api/session      {"authenticated": bool}
    GET  /api/apps         installed apps with live status
    GET  /api/icon/<app>   the app's icon, fetched once
    GET  /api/wallpaper    the chosen wallpaper (?id=... for a specific one)
    GET  /api/dock-icon/<name>  a dock icon: yours from ./icons, or the built-in
    GET  /api/widgets      the desktop widgets you chose, and what they show
    GET  /api/updates      images with a newer version, from Cup if it's installed
    GET  /api/terminal     whether the terminal is on, and its open sessions
    POST /api/terminal     {"password", "rows", "cols"} -> a new shell (admin mode)
    GET  /api/terminal/<id>?offset=N  its output from N (waits for some)
    POST /api/terminal/<id>/input|size|close
    GET  /api/notifications           what happened: apps offline, jobs, warnings
    POST /api/notifications           {"read": "all"} or {"clear": true}
    GET  /api/settings     everything the Settings page shows
    POST /api/settings     any of {"name", "wallpaper", "searchUrl", "dock",
                           "widgets", "order"} (order: {collection: [app ids]})
    POST /api/password     {"current": ..., "new": ...}
    POST /api/admin        {"on": true, "password": ...} or {"on": false}
    POST /api/actions      {"action": ..., "params": {...}} -> queued for the helper
    GET  /api/jobs[/<id>]  progress of what the helper is doing
    GET  /healthz          "ok", for Docker's healthcheck

Everything under /api except login, session, wallpaper and dock-icon needs a
login.

This app never changes the machine itself. Anything beyond its own settings
(apply homelab.env, back up, update, restart, start or stop an app, import
one) is written as a request into /data/agent/queue, where the homelab helper
on the host picks it up and runs it from the fixed list in
scripts/agent/actions.json (see that folder).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATIC = Path(__file__).resolve().parent / "static"
# standalone: adlerOS on any Docker host (apps from the registry and the store);
# homelab: part of a homelab built from its catalog (containers/catalog.tsv).
MODE = "standalone" if os.environ.get("ADLEROS_MODE") == "standalone" else "homelab"
HOMELAB_MODE = MODE == "homelab"
ADLEROS = Path(os.environ.get("ADLEROS_ROOT", "/adleros"))  # this repo's catalog/ and agent/
STORE = ADLEROS / "catalog" / "store"
CATALOG = Path(os.environ.get("HOMELAB_CATALOG", "/homelab/catalog.tsv"))
HOMELAB_ENV = Path(os.environ.get("HOMELAB_ENV", "/homelab/homelab.env"))
ACTION_FILES = [ADLEROS / "agent" / "actions.json"] + (
    [Path(os.environ.get("HOMELAB_ACTIONS", "/homelab/agent/actions.json"))] if HOMELAB_MODE else [])
BACKUPS = Path(os.environ.get("HOMELAB_BACKUPS", "/homelab/backup/containers"))
# Apps found, imported or installed from the store: <registry>/<app>/app.json,
# written by the helper (containers/extras in a homelab).
REGISTRY = Path(os.environ.get("ADLEROS_REGISTRY", "/homelab/extras" if HOMELAB_MODE else "/adleros/registry"))
COLLECTION_ORDER = ("core", "system", "media", "knowledge", "productivity", "life", "files")
HOST_OS_RELEASE = Path(os.environ.get("HOST_OS_RELEASE", "/host/os-release"))
DATA = Path(os.environ.get("OS_DATA", "/data"))
ICONS = DATA / "icons"
SETTINGS_FILE = DATA / "settings.json"
NOTIFICATIONS_FILE = DATA / "notifications.json"
QUEUE = DATA / "agent" / "queue"
JOBS = DATA / "agent" / "jobs"
# Your own icons for the dock's fixed items (mounted from ./icons):
# app-store.png, settings.svg... replace the built-in ones.
ICON_OVERRIDES = Path(os.environ.get("OS_ICON_DIR", "/icons"))
DOCK_FIXED = ("app-drawer", "app-store", "settings", "live-usage")
DOCK_MAX_PINS = 12
# The widgets you can put on the desktop, with the defaults and the limit.
WIDGET_CATALOG = STATIC / "widgets-catalog.json"
# Drop any image here (mounted from ./wallpaper) to offer it as a wallpaper.
WALLPAPER_DIR = Path(os.environ.get("OS_WALLPAPER_DIR", "/wallpaper"))
BUILTIN_WALLPAPERS = {
    "aurora": ("Aurora", STATIC / "wallpapers" / "aurora.jpg"),
    "earth-sunrise": ("Sunrise over Earth", STATIC / "wallpapers" / "earth-sunrise.jpg"),
}
DEFAULT_WALLPAPER = "aurora"
OWNER_NAME = os.environ.get("OS_NAME", "").strip()
PORT = int(os.environ.get("OS_PORT", "8686"))
# The first password. Changing it in Settings stores a hash in settings.json,
# which from then on wins over this.
PASSWORD = os.environ["OS_PASSWORD"]
SESSION_SECRET = os.environ["OS_SESSION_SECRET"].encode()

COOKIE = "homelab_session"
SESSION_SECONDS = 30 * 86400
ICON_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons"
ICON_RETRY_SECONDS = 86400  # how long a missing icon stays missing
STATUS_TTL = 10  # seconds a port check is reused
LOGIN_WINDOW, LOGIN_MAX_FAILS = 600, 5  # 5 wrong passwords per 10 minutes per client
JOB_ID = re.compile(r"[a-f0-9]{32}")
JOB_STALE_SECONDS = 4 * 3600  # an unfinished job this old no longer blocks new ones

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
}
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".avif")
PAGE_CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
# Icons come from a third party: even opened directly, an SVG can't run code.
ICON_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def write_private(path, text):
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


# ------------------------------------------------------------- homelab files

def read_env_file(path):
    """KEY=VALUE lines of a .env-style file, with surrounding quotes removed."""
    values = {}
    try:
        text = path.read_text()
    except OSError:
        return values
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not key or key.startswith("#"):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def read_catalog():
    apps = []
    try:
        lines = CATALOG.read_text().splitlines()
    except OSError:
        return apps
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 7:
            continue
        genre, app, sub, port, icon, name, about = fields
        apps.append({"id": app, "genre": genre, "sub": sub, "port": int(port),
                     "icon": icon, "name": name, "about": about})
    return apps


def registry_apps(installed=True):
    """Apps in the registry (found, imported, or from the store), in their
    collection: those on the home screen, or (installed=False) those you deleted."""
    apps = []
    try:
        folders = sorted(p for p in REGISTRY.iterdir() if p.is_dir())
    except OSError:
        return apps
    for folder in folders:
        try:
            info = json.loads((folder / "app.json").read_text())
        except (OSError, ValueError):
            continue
        # An app without a web page (a game server, a bot) has no address.
        if not (isinstance(info, dict) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", folder.name)
                and isinstance(info.get("name"), str) and isinstance(info.get("url"), str)
                and (info["url"] == "" or re.match(r"https?://", info["url"]))):
            continue
        if (info.get("installed", True) is not False) != installed:
            continue
        icon = info.get("icon") if isinstance(info.get("icon"), str) and re.fullmatch(r"di:[a-z0-9-]+", info.get("icon") or "") else "-"
        port = info.get("port") if isinstance(info.get("port"), int) and 0 < info["port"] < 65536 else None
        collection = info.get("collection") if info.get("collection") in COLLECTION_ORDER else EXTRAS
        apps.append({"id": folder.name, "genre": collection, "sub": "-", "port": port, "icon": icon,
                     "name": info["name"][:40], "about": str(info.get("about", ""))[:200], "url": info["url"],
                     "imported": True, "known": str(info.get("known", "")), "note": str(info.get("note", ""))[:300]})
    return apps


def store_apps():
    """The store's apps (standalone): catalog/store/<id>/app.json."""
    apps = []
    if HOMELAB_MODE or not STORE.is_dir():
        return apps
    for folder in sorted(STORE.iterdir()):
        try:
            info = json.loads((folder / "app.json").read_text())
        except (OSError, ValueError):
            continue
        if not (isinstance(info, dict) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", folder.name)):
            continue
        icon = info.get("icon") if re.fullmatch(r"di:[a-z0-9-]+", str(info.get("icon") or "")) else "-"
        apps.append({"id": folder.name, "genre": info.get("collection") if info.get("collection") in COLLECTION_ORDER else EXTRAS,
                     "sub": "-", "port": None, "icon": icon, "name": str(info.get("name", folder.name))[:40],
                     "about": str(info.get("about", ""))[:200], "url": "", "store": True})
    return apps


def installed_apps():
    """The apps on the home screen: in a homelab, its core apps plus APPS in
    catalog order, then the registry's; standalone, the registry's."""
    if not HOMELAB_MODE:
        return registry_apps()
    env = read_env_file(HOMELAB_ENV)
    chosen = set(env.get("APPS", "").split())
    domain = env.get("DOMAIN", "homelab.local")
    scheme = env.get("URL_SCHEME", "http")
    vault_host = env.get("VAULT_HOST", "")
    apps = []
    for app in read_catalog():
        # Nginx has no page of its own, and this is the home screen itself.
        if app["sub"] == "-" or app["id"] == "os":
            continue
        if app["genre"] != "core" and app["id"] not in chosen:
            continue
        if app["id"] == "vaultwarden" and vault_host:
            url = f"https://{vault_host}"
        else:
            url = f"{scheme}://{app['sub']}.{domain}"
        apps.append({**app, "url": url})
    ids = {a["id"] for a in apps}
    return apps + [a for a in registry_apps() if a["id"] not in ids]


EXTRAS = "extras"  # the collection for apps that aren't in one


def collection_name(collection_id):
    """A collection's title, from its folder name: life -> Life, home-lab -> Home lab."""
    return "Extras" if collection_id == EXTRAS else collection_id.replace("-", " ").capitalize()


def collections(apps):
    """The collections that have apps, in catalog order, Extras last."""
    order = list(COLLECTION_ORDER)
    for app in read_catalog() if HOMELAB_MODE else []:
        if app["genre"] not in order:
            order.append(app["genre"])
    present = {a["genre"] for a in apps}
    ids = [c for c in order if c in present and c != EXTRAS]
    ids += sorted(c for c in present if c not in ids and c != EXTRAS)
    if EXTRAS in present:
        ids.append(EXTRAS)
    return [{"id": c, "name": collection_name(c)} for c in ids]


def app_order():
    """Your arrangement of each collection: {collection: [app ids]}."""
    order = load_settings().get("order")
    return order if isinstance(order, dict) else {}


def available_apps():
    """What the App Store can install: in a homelab, catalog apps you haven't
    picked; standalone, the store's apps you don't have yet; and either way,
    apps you deleted."""
    if HOMELAB_MODE:
        chosen = set(read_env_file(HOMELAB_ENV).get("APPS", "").split())
        apps = [{**a, "url": ""} for a in read_catalog()
                if a["genre"] != "core" and a["sub"] != "-" and a["id"] != "os" and a["id"] not in chosen]
    else:
        everything = registry_apps() + registry_apps(installed=False)
        have = {a["known"] or a["id"] for a in everything} | {a["id"] for a in everything}
        apps = [a for a in store_apps() if a["id"] not in have]
    return apps + registry_apps(installed=False)


def load_actions():
    """adlerOS's actions, plus the homelab's; the first file to name one wins.
    Ones for the other kind of install are left out."""
    merged = {}
    for path in ACTION_FILES:
        try:
            actions = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        for k, v in actions.items():
            if not k.startswith("_") and isinstance(v, dict) and v.get("mode", MODE) == MODE:
                merged.setdefault(k, v)
    return merged


# ---------------------------------------------------------------- settings

_settings_lock = threading.Lock()


def load_settings():
    try:
        data = json.loads(SETTINGS_FILE.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_settings(changes):
    with _settings_lock:
        data = load_settings()
        data.update(changes)
        write_private(SETTINGS_FILE, json.dumps(data, indent=2))


def admin_on():
    """Admin mode: restart and shut down, delete apps, stop core apps. Off
    until you turn it on in Settings, with your password."""
    return load_settings().get("admin") is True


def needs_admin(spec, params):
    """Whether an action may only run in admin mode (its "admin" in actions.json)."""
    rule = spec.get("admin")
    if rule == "core":
        app = next((a for a in installed_apps() if a["id"] == (params or {}).get("app")), None)
        return bool(app and app["genre"] == "core")
    return rule is True


def display_name():
    return (load_settings().get("name") or OWNER_NAME).strip()


def search_url():
    """Where the home screen's web search goes; {QUERY} becomes the words.
    Default: your own 4get or SearXNG if adlerOS knows one, else DuckDuckGo."""
    chosen = load_settings().get("searchUrl")
    if chosen:
        return chosen
    apps = {a["id"]: a for a in installed_apps()}
    for app_id, path in (("4get", "/web?s={QUERY}"), ("searxng", "/search?q={QUERY}")):
        if apps.get(app_id, {}).get("url"):
            return apps[app_id]["url"].rstrip("/") + path
    return "https://duckduckgo.com/?q={QUERY}"


def dock_pins():
    """Apps pinned to the dock, in order, that are still installed."""
    installed = {a["id"] for a in installed_apps()}
    return [a for a in load_settings().get("dock", []) if a in installed]


def widget_catalog():
    try:
        catalog = json.loads(WIDGET_CATALOG.read_text())
    except (OSError, ValueError):
        return {"max": 3, "default": [], "ids": set()}
    return {"max": int(catalog.get("max", 3)), "default": catalog.get("default", []),
            "ids": {w["id"] for w in catalog.get("widgets", []) if isinstance(w, dict) and "id" in w}}


def selected_widgets():
    """Your widgets in order; the catalog's defaults until you pick your own."""
    catalog = widget_catalog()
    chosen = load_settings().get("widgets")
    if not isinstance(chosen, list):
        chosen = catalog["default"]
    return [w for w in chosen if w in catalog["ids"]][:catalog["max"]]


def widget_data():
    """Everything the widgets show, in one go: they poll it every few seconds."""
    apps = installed_apps()
    status = app_status(apps)
    offline = [a["name"] for a in apps if not status[a["id"]]]
    device = device_info()
    return {
        "system": {k: device[k] for k in ("cpu", "cpus", "memory", "disk", "temperature", "uptime", "load")},
        "apps": {"total": len(apps), "up": len(apps) - len(offline), "offline": offline},
        "backups": backups_info(),
    }


def dock_icon_path(name):
    if name not in DOCK_FIXED:
        return None
    for suffix in (".svg", ".png", ".webp"):
        mine = ICON_OVERRIDES / f"{name}{suffix}"
        if mine.is_file():
            return mine
    return STATIC / "dock" / f"{name}.svg"


def valid_search_url(url):
    return (isinstance(url, str) and len(url) <= 500 and url.isprintable() and " " not in url
            and re.match(r"https?://[^/?#]+", url) is not None and "{QUERY}" in url)


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def password_ok(password):
    stored = load_settings().get("passwordHash")
    if stored:
        try:
            _, salt, digest = stored.split("$")
            given = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
        except ValueError:
            return False
        return hmac.compare_digest(given.hex(), digest)
    return hmac.compare_digest(password.encode(), PASSWORD.encode())


# ---------------------------------------------------------------- wallpaper

def custom_wallpapers():
    try:
        return sorted(p for p in WALLPAPER_DIR.iterdir()
                      if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and not p.name.startswith("."))
    except OSError:
        return []


def wallpaper_options():
    options = [{"id": k, "name": name} for k, (name, _) in BUILTIN_WALLPAPERS.items()]
    for p in custom_wallpapers():
        options.append({"id": f"mine:{p.name}", "name": re.sub(r"[-_]+", " ", p.stem)})
    return options


def wallpaper_path(wallpaper_id):
    if wallpaper_id in BUILTIN_WALLPAPERS:
        return BUILTIN_WALLPAPERS[wallpaper_id][1]
    if isinstance(wallpaper_id, str) and wallpaper_id.startswith("mine:"):
        return next((p for p in custom_wallpapers() if p.name == wallpaper_id[5:]), None)
    return None


def selected_wallpaper_id():
    chosen = load_settings().get("wallpaper")
    if wallpaper_path(chosen):
        return chosen
    # Not chosen yet: your own image if you added one, else the built-in.
    mine = custom_wallpapers()
    return f"mine:{mine[0].name}" if mine else DEFAULT_WALLPAPER


# -------------------------------------------------------------- device info

_cpu_sample = {"at": None, "when": 0.0, "value": None}
_cpu_lock = threading.Lock()


def cpu_usage():
    """Share of CPU time busy since the previous sample, from /proc/stat.
    Samples less than a second apart reuse the last answer, so Settings and
    the widgets polling together still see a real interval."""
    with _cpu_lock:
        now = time.monotonic()
        if now - _cpu_sample["when"] < 1.0:
            return _cpu_sample["value"]
        try:
            fields = [int(x) for x in Path("/proc/stat").read_text().split("\n", 1)[0].split()[1:]]
        except (OSError, ValueError):
            return None
        idle, total = fields[3] + fields[4], sum(fields)
        previous = _cpu_sample["at"]
        _cpu_sample.update(at=(idle, total), when=now)
        if previous and total != previous[1]:
            _cpu_sample["value"] = round(100 * (1 - (idle - previous[0]) / (total - previous[1])), 1)
        return _cpu_sample["value"]


def device_info():
    info = {"hostname": socket.gethostname(), "kernel": os.uname().release, "arch": os.uname().machine,
            "cpus": os.cpu_count()}
    info["os"] = read_env_file(HOST_OS_RELEASE).get("PRETTY_NAME")
    try:
        cpuinfo = Path("/proc/cpuinfo").read_text()
        model = re.search(r"^(?:Model|model name)\s*:\s*(.+)$", cpuinfo, re.M)
        info["model"] = model.group(1).strip() if model else None
    except OSError:
        info["model"] = None
    try:
        info["uptime"] = int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError):
        info["uptime"] = None
    try:
        mem = dict(re.findall(r"^(\w+):\s+(\d+)", Path("/proc/meminfo").read_text(), re.M))
        total, available = int(mem["MemTotal"]) * 1024, int(mem["MemAvailable"]) * 1024
        info["memory"] = {"total": total, "used": total - available}
    except (OSError, KeyError, ValueError):
        info["memory"] = None
    try:
        info["temperature"] = round(int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000, 1)
    except (OSError, ValueError):
        info["temperature"] = None
    try:
        st = os.statvfs(DATA)  # the disk adlerOS (and so your homelab) lives on
        info["disk"] = {"total": st.f_blocks * st.f_frsize, "used": (st.f_blocks - st.f_bfree) * st.f_frsize}
    except OSError:
        info["disk"] = None
    info["cpu"] = cpu_usage()
    info["load"] = os.getloadavg()[0]
    return info


def backups_info():
    if not BACKUPS.exists():
        return {"readable": True, "last": None, "count": 0}
    try:
        dates = sorted(p.name for p in BACKUPS.iterdir() if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.name))
    except OSError:
        return {"readable": False, "last": None, "count": 0}
    return {"readable": True, "last": dates[-1] if dates else None, "count": len(dates)}


# ------------------------------------------------------------------- actions

def action_summary(actions):
    """What the page needs to know about each action: no steps, no commands."""
    return {name: {"label": spec.get("label", name), "description": spec.get("description", ""),
                   "admin": spec.get("admin", False),
                   "params": {p: {k: rule.get(k) for k in ("pattern", "maxLength", "optional")}
                              for p, rule in spec.get("params", {}).items()}}
            for name, spec in actions.items()}


def validate_action(name, params, actions):
    """(clean params, None) or (None, error). The helper checks again, and more."""
    spec = actions.get(name) if isinstance(name, str) else None
    if not spec:
        return None, "unknown action"
    params = params or {}
    if not isinstance(params, dict):
        return None, "params must be an object"
    rules = spec.get("params", {})
    if set(params) - set(rules):
        return None, "unknown parameter"
    clean = {}
    for key, rule in rules.items():
        if key not in params:
            if rule.get("optional"):
                continue
            return None, f"missing {key}"
        value = params[key]
        if (not isinstance(value, str) or len(value) > rule.get("maxLength", 256)
                or not re.fullmatch(rule["pattern"], value)):
            return None, f"invalid {key}"
        clean[key] = value
    return clean, None


def read_job(job_id):
    if not JOB_ID.fullmatch(job_id):
        return None
    try:
        job = json.loads((JOBS / f"{job_id}.json").read_text())
    except (OSError, ValueError):
        return None
    return job if isinstance(job, dict) else None


def recent_jobs(limit=10):
    try:
        files = sorted(JOBS.glob("*.json"), key=lambda p: p.lstat().st_mtime, reverse=True)[:limit]
    except OSError:
        return []
    jobs = []
    for f in files:
        job = read_job(f.stem)
        if job:
            jobs.append({k: job.get(k) for k in ("id", "action", "params", "label", "status", "requested", "finished", "error")})
    return jobs


def unfinished_jobs():
    cutoff = time.time() - JOB_STALE_SECONDS
    for f in JOBS.glob("*.json") if JOBS.is_dir() else []:
        try:
            if f.lstat().st_mtime < cutoff:
                continue
        except OSError:
            continue
        job = read_job(f.stem)
        if job and job.get("status") in ("queued", "running"):
            yield job


def busy_job(actions):
    """An unfinished job, if there is one: the helper does one thing at a time.
    Quiet actions (status checks) don't count; they just wait their turn."""
    for job in unfinished_jobs():
        if not actions.get(job.get("action"), {}).get("quiet"):
            return job
    return None


_queue_lock = threading.Lock()


def queue_action(name, params, actions):
    with _queue_lock:
        if actions[name].get("quiet"):
            # The same check already waiting: share it rather than pile up.
            for job in unfinished_jobs():
                if job.get("action") == name and job.get("params", {}) == params:
                    return job, None
        else:
            busy = busy_job(actions)
            if busy:
                return None, busy
        QUEUE.mkdir(parents=True, exist_ok=True)
        JOBS.mkdir(parents=True, exist_ok=True)
        job_id = secrets.token_hex(16)
        job = {"id": job_id, "action": name, "params": params, "label": actions[name].get("label", name),
               "status": "queued", "requested": stamp(), "started": None, "finished": None, "exitCode": None,
               "error": None, "log": []}
        write_private(JOBS / f"{job_id}.json", json.dumps(job))
        request = {"id": job_id, "action": name, "params": params, "requested": job["requested"]}
        write_private(QUEUE / f"{job_id}.json", json.dumps(request))
        return job, None


# ----------------------------------------------------------------- updates

_cup = {"at": -1e9, "images": None}
CUP_TTL = 600


def normalize_image(ref):
    """One spelling per image: docker.io/library/redis -> redis:latest."""
    ref = ref.strip()
    for prefix in ("docker.io/library/", "docker.io/", "index.docker.io/library/", "index.docker.io/"):
        if ref.startswith(prefix):
            ref = ref[len(prefix):]
            break
    ref = ref.removeprefix("library/")
    name = ref.split("@", 1)[0]
    if "@" not in ref and ":" not in name.rsplit("/", 1)[-1]:
        ref += ":latest"
    return ref


def image_updates():
    """The images Cup says have a newer version, cached for CUP_TTL seconds;
    None when Cup isn't installed or doesn't answer. Cup's API has moved
    between versions, so v3, v2 and the old /json are all understood."""
    cup = next((a for a in installed_apps() if a["id"] == "cup"), None)
    if not cup:
        return None
    now = time.monotonic()
    if now - _cup["at"] < CUP_TTL:
        return _cup["images"]
    found = None
    for path in ("/api/v3/json", "/api/v2/json", "/json"):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{cup['port']}{path}", timeout=4) as r:
                data = json.loads(r.read(5_000_000))
        except (OSError, ValueError):
            continue
        images = data.get("images") if isinstance(data, dict) else None
        if isinstance(images, list):
            found = {normalize_image(i["reference"]) for i in images
                     if isinstance(i, dict) and isinstance(i.get("reference"), str)
                     and isinstance(i.get("result"), dict) and i["result"].get("has_update") is True}
        elif isinstance(images, dict):
            found = {normalize_image(ref) for ref, has_update in images.items() if has_update is True}
        else:
            continue
        break
    _cup.update(at=now, images=sorted(found) if found is not None else None)
    return _cup["images"]


# ------------------------------------------------------------------ status

_status = {}
_status_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=16)


def _port_up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.8):
            return True
    except OSError:
        return False


def app_status(apps):
    """{app id: up?}: whether each app's port answers. An imported app with
    no port can't be checked, so it counts as up."""
    ports = port_status({a["port"] for a in apps if a["port"]})
    return {a["id"]: ports[a["port"]] if a["port"] else True for a in apps}


def port_status(ports):
    """{port: up?} for every port, checked in parallel, cached STATUS_TTL."""
    now = time.monotonic()
    with _status_lock:
        result = {p: up for p, (at, up) in _status.items() if p in ports and now - at < STATUS_TTL}
    todo = [p for p in ports if p not in result]
    for port, up in zip(todo, _pool.map(_port_up, todo)):
        result[port] = up
        with _status_lock:
            _status[port] = (time.monotonic(), up)
    return result


# ---------------------------------------------------------------- sessions

_revoked = {}  # token -> expiry, so logging out ends that session for good
_failures = {}  # client -> [times of wrong passwords]
_auth_lock = threading.Lock()


def _sign(message):
    # Keyed on the secret *and* the current password (or its hash), so a
    # password change logs out every browser.
    material = load_settings().get("passwordHash") or PASSWORD
    key = hmac.new(SESSION_SECRET, material.encode(), hashlib.sha256).digest()
    return hmac.new(key, message.encode(), hashlib.sha256).hexdigest()


def new_session():
    message = f"{int(time.time()) + SESSION_SECONDS}.{secrets.token_urlsafe(16)}"
    return f"{message}.{_sign(message)}"


def session_valid(token):
    try:
        expiry, nonce, signature = token.split(".")
        expiry = int(expiry)
    except (AttributeError, ValueError):
        return False
    if not hmac.compare_digest(signature, _sign(f"{expiry}.{nonce}")) or expiry < time.time():
        return False
    with _auth_lock:
        return token not in _revoked


def revoke(token):
    now = time.time()
    with _auth_lock:
        for t in [t for t, exp in _revoked.items() if exp < now]:
            del _revoked[t]
        try:
            _revoked[token] = int(token.split(".")[0])
        except (AttributeError, ValueError):
            pass


def lockout_remaining(client):
    """Seconds until this client may try again, or 0."""
    now = time.time()
    with _auth_lock:
        recent = [t for t in _failures.get(client, []) if now - t < LOGIN_WINDOW]
        _failures[client] = recent
        if len(recent) < LOGIN_MAX_FAILS:
            return 0
        return int(LOGIN_WINDOW - (now - recent[0])) + 1


def record_failure(client):
    with _auth_lock:
        _failures.setdefault(client, []).append(time.time())


# ------------------------------------------------------------------- icons

def _fetch(url, check):
    try:
        with urllib.request.urlopen(url, timeout=6) as response:
            data = response.read(512 * 1024 + 1)
    except OSError:
        return None
    return data if len(data) <= 512 * 1024 and check(data) else None


def app_icon(app_id):
    """(content type, bytes) of an app's icon, or None to use a lettered tile."""
    app = next((a for a in read_catalog() + registry_apps() + registry_apps(installed=False) + store_apps()
                if a["id"] == app_id), None)
    if not app or not app["icon"].startswith("di:"):
        return None
    name = app["icon"][3:]
    if not re.fullmatch(r"[a-z0-9-]+", name):
        return None
    kinds = [("svg", "image/svg+xml", lambda d: b"<svg" in d[:1024]),
             ("png", "image/png", lambda d: d.startswith(b"\x89PNG\r\n\x1a\n"))]
    for ext, ctype, _ in kinds:
        cached = ICONS / f"{name}.{ext}"
        if cached.is_file():
            return ctype, cached.read_bytes()
    missing = ICONS / f"{name}.missing"
    if missing.exists() and time.time() - missing.stat().st_mtime < ICON_RETRY_SECONDS:
        return None
    for ext, ctype, check in kinds:
        data = _fetch(f"{ICON_CDN}/{ext}/{name}.{ext}", check)
        if data:
            tmp = ICONS / f".{name}.{ext}.{secrets.token_hex(4)}"
            tmp.write_bytes(data)
            tmp.replace(ICONS / f"{name}.{ext}")
            return ctype, data
    missing.touch()
    return None


# --------------------------------------------------------------- terminal

TERM_DIR = DATA / "agent" / "term"
TERM_ID = re.compile(r"[a-f0-9]{32}")
TERM_WAIT = 20  # seconds a read waits for output
TERM_CHUNK = 256 * 1024


def terminal_enabled():
    """ADLEROS_TERMINAL=on in the settings file: set on the host, so adlerOS
    can't turn its own terminal on."""
    value = (read_env_file(HOMELAB_ENV).get("ADLEROS_TERMINAL", "") if HOMELAB_MODE
             else os.environ.get("ADLEROS_TERMINAL", ""))
    return value.strip().lower() in ("on", "yes", "true", "1")


def terminal_sessions():
    try:
        return [p.name for p in TERM_DIR.iterdir()
                if TERM_ID.fullmatch(p.name) and not (p / "ended").exists() and not (p / "close").exists()]
    except OSError:
        return []


def terminal_folder(sid):
    folder = TERM_DIR / sid
    return folder if TERM_ID.fullmatch(sid) and folder.is_dir() and not folder.is_symlink() else None


def terminal_append(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)


def close_terminals():
    for sid in terminal_sessions():
        terminal_append(TERM_DIR / sid / "close", b"")


def terminal_read(folder, offset):
    """(bytes from offset, ended info or None, started?), waiting up to
    TERM_WAIT seconds for something new."""
    deadline = time.monotonic() + TERM_WAIT
    out, ended = folder / "out", folder / "ended"
    while True:
        size = out.stat().st_size if out.exists() else 0
        if size > offset or ended.exists() or time.monotonic() > deadline:
            break
        time.sleep(0.04)
    data = b""
    if size > offset:
        fd = os.open(out, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.lseek(fd, offset, os.SEEK_SET)
            data = os.read(fd, TERM_CHUNK)
        finally:
            os.close(fd)
    info = None
    if ended.exists() and offset + len(data) >= size:
        try:
            info = json.loads(ended.read_text())
        except (OSError, ValueError):
            info = {"why": "ended"}
    started = (folder / "started.json").exists() or out.exists()
    return data, info, started


# ----------------------------------------------------------- notifications

KEEP_NOTIFICATIONS = 100
WATCH_SECONDS = 60
_notes_lock = threading.Lock()
# Jobs worth telling you about when they finish (all of them when they fail).
NOTIFY_DONE = {"backup": "Backup finished", "update": "Homelab updated", "apply-config": "Settings applied",
               "app-install": "Installed", "app-update": "Updated"}


def load_notifications():
    try:
        items = json.loads(NOTIFICATIONS_FILE.read_text()).get("items", [])
    except (OSError, ValueError, AttributeError):
        return []
    return [n for n in items if isinstance(n, dict)]


def notify(kind, title, body="", open_target=""):
    """Add a notification: kind is offline, online, job-done, job-failed, disk,
    heat or updates; open_target what clicking it opens (as in widgets)."""
    with _notes_lock:
        items = load_notifications()
        items.append({"id": secrets.token_hex(6), "time": int(time.time()), "kind": kind, "title": title,
                      "body": body, "open": open_target, "read": False})
        write_private(NOTIFICATIONS_FILE, json.dumps({"items": items[-KEEP_NOTIFICATIONS:]}))


def update_notifications(change):
    with _notes_lock:
        items = load_notifications()
        if change == "clear":
            items = []
        else:
            for n in items:
                n["read"] = True
        write_private(NOTIFICATIONS_FILE, json.dumps({"items": items}))


class Watcher:
    """Every WATCH_SECONDS: apps that stop or start answering, jobs that end,
    a filling disk, a hot CPU, new updates from Cup. Runs in its own thread."""

    def __init__(self):
        self.down = {}  # app id -> consecutive failed checks
        self.told_down = set()
        self.started = time.time()
        self.seen_jobs = set()
        self.last = {"disk": 0, "heat": 0, "updates": 0}
        self.update_count = None

    def apps(self):
        apps = installed_apps()
        status = app_status(apps)
        for app in apps:
            if status[app["id"]]:
                self.down[app["id"]] = 0
                if app["id"] in self.told_down:
                    self.told_down.discard(app["id"])
                    notify("online", f"{app['name']} is back", "It's answering again.", "app-store")
                continue
            self.down[app["id"]] = self.down.get(app["id"], 0) + 1
            # Twice in a row, so a restart doesn't count.
            if self.down[app["id"]] == 2 and app["id"] not in self.told_down:
                self.told_down.add(app["id"])
                notify("offline", f"{app['name']} is offline", "It stopped answering. The App Store shows its logs.", "app-store")

    def jobs(self):
        actions = load_actions()
        files = list(JOBS.glob("*.json")) if JOBS.is_dir() else []
        self.seen_jobs &= {f.stem for f in files}  # the helper prunes old jobs; so do we
        for f in files:
            if f.stem in self.seen_jobs:
                continue
            job = read_job(f.stem)
            if not job or job.get("status") not in ("done", "failed"):
                continue
            self.seen_jobs.add(f.stem)
            try:
                if f.stat().st_mtime < self.started:
                    continue  # finished before adlerOS started: old news
            except OSError:
                continue
            name = job.get("action")
            if actions.get(name, {}).get("quiet"):
                continue
            app = (job.get("params") or {}).get("app")
            what = next((a["name"] for a in installed_apps() + available_apps() if a["id"] == app), app) if app else ""
            label = job.get("label") or name
            if job["status"] == "failed":
                # The helper's last words say why better than an exit code does.
                why = next((l for l in reversed(job.get("log") or []) if l.strip() and not l.startswith("$ ")), "") or job.get("error") or ""
                notify("job-failed", f"{label}{f': {what}' if what else ''} didn't work", why[:200], "settings" if not app else "app-store")
            elif name in NOTIFY_DONE:
                notify("job-done", f"{NOTIFY_DONE[name]}{f': {what}' if what else ''}", "", "settings:backup" if name == "backup" else "app-store" if app else "settings")

    def machine(self):
        info = device_info()
        now = time.time()
        disk = info.get("disk")
        if disk and disk["total"] and disk["used"] / disk["total"] >= 0.9 and now - self.last["disk"] > 86400:
            self.last["disk"] = now
            notify("disk", f"Storage is {round(100 * disk['used'] / disk['total'])}% full",
                   "Live Usage shows what's using it.", "live-usage")
        temp = info.get("temperature")
        if temp is not None and temp >= 80 and now - self.last["heat"] > 3600:
            self.last["heat"] = now
            notify("heat", f"Running hot: {round(temp)}°C", "Check the fan or the airflow around the machine.", "live-usage")

    def updates(self):
        now = time.time()
        if now - self.last["updates"] < 6 * 3600:
            return
        self.last["updates"] = now
        images = image_updates()
        if images is None:
            return
        if self.update_count is not None and len(images) > self.update_count:
            notify("updates", f"{len(images)} images have updates", "Cup found newer versions. Update apps from the App Store.", "app-store")
        self.update_count = len(images)

    def run(self):
        while True:
            for check in (self.apps, self.jobs, self.machine, self.updates):
                try:
                    check()
                except Exception as e:  # one bad check mustn't stop the others
                    print(f"watcher: {check.__name__}: {e!r}", flush=True)
            time.sleep(WATCH_SECONDS)


# ------------------------------------------------------------------ server

class Handler(BaseHTTPRequestHandler):
    server_version = "homelab"
    sys_version = ""

    # Requests come through nginx on 127.0.0.1, which passes the real client
    # and scheme along; anything else is talking to us directly.
    def _from_proxy(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def client(self):
        if self._from_proxy():
            return self.headers.get("X-Real-IP", self.client_address[0])
        return self.client_address[0]

    def https(self):
        return self._from_proxy() and self.headers.get("X-Forwarded-Proto") == "https"

    def session_token(self):
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(COOKIE)
        return morsel.value if morsel else None

    def logged_in(self):
        token = self.session_token()
        return bool(token) and session_valid(token)

    def send(self, status, body=b"", ctype="text/plain; charset=utf-8", headers=(), csp=PAGE_CSP):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Security-Policy", csp)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, obj, headers=()):
        body = json.dumps(obj).encode()
        self.send(status, body, "application/json", [("Cache-Control", "no-store"), *headers])

    def cookie_header(self, value, max_age):
        secure = "; Secure" if self.https() else ""
        return ("Set-Cookie",
                f"{COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict{secure}")

    def serve_static(self, name):
        parts = name.split("/")
        path = STATIC.joinpath(*parts)
        if (len(parts) > 2 or any(not p or p.startswith(".") for p in parts)
                or not path.is_file() or path.suffix not in STATIC_TYPES):
            return self.send(404, b"not found")
        self.serve_file(path)

    def serve_file(self, path, cache="no-cache", csp=PAGE_CSP):
        """A file with an ETag, so revalidating unchanged files costs a 304."""
        stat = path.stat()
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        ctype = STATIC_TYPES.get(path.suffix.lower(), "application/octet-stream")
        self.send(200, path.read_bytes(), ctype, [("Cache-Control", cache), ("ETag", etag)], csp=csp)

    def settings_payload(self):
        if HOMELAB_MODE:
            env = read_env_file(HOMELAB_ENV)
            config = {k: env.get(k, "") for k in ("DOMAIN", "TZ", "URL_SCHEME", "TS_IP", "VAULT_HOST", "STORAGE_DIR")}
        else:
            # Standalone: what install.sh put in adlerOS's .env, handed in by compose.
            config = {k: os.environ.get(k, "") for k in ("ADLEROS_HOST", "COMPOSE_ROOTS", "APPS_DIR", "TZ", "STORAGE_DIR")}
        return {
            "mode": MODE,
            "name": display_name(),
            "searchUrl": search_url(),
            "wallpaper": {"selected": selected_wallpaper_id(), "options": wallpaper_options()},
            "config": config,
            "appCount": len(installed_apps()),
            "device": device_info(),
            "backups": backups_info() if HOMELAB_MODE else None,
            "actions": action_summary(load_actions()),
            "jobs": recent_jobs(),
            "passwordChanged": bool(load_settings().get("passwordHash")),
            "admin": admin_on(),
        }

    # --------------------------------------------------------------- GET

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path, query = url.path, urllib.parse.parse_qs(url.query)
        if path == "/healthz":
            return self.send(200, b"ok")
        if path in ("/", "/index.html"):
            return self.serve_static("index.html")
        if path.startswith("/static/"):
            return self.serve_static(path[len("/static/"):])
        if path == "/api/wallpaper":
            # Public: the lock screen shows it too, blurred.
            wanted = query.get("id", [None])[0]
            image = wallpaper_path(wanted or selected_wallpaper_id())
            return self.serve_file(image) if image else self.send(404, b"no such wallpaper")
        if path.startswith("/api/dock-icon/"):
            icon = dock_icon_path(path[len("/api/dock-icon/"):])
            if not icon:
                return self.send(404, b"no such icon")
            return self.serve_file(icon, csp=ICON_CSP)
        if path == "/api/session":
            return self.send_json(200, {"authenticated": self.logged_in()})
        if not path.startswith("/api/"):
            return self.send(404, b"not found")
        if not self.logged_in():
            return self.send_json(401, {"error": "login required"})

        if path == "/api/apps":
            apps = installed_apps()
            status = app_status(apps)
            env = read_env_file(HOMELAB_ENV)
            return self.send_json(200, {"name": display_name(), "searchUrl": search_url(), "dock": dock_pins(),
                                        "admin": admin_on(), "mode": MODE,
                                        "collections": collections(apps), "order": app_order(),
                                        "host": {"tsIp": env.get("TS_IP", ""), "domain": env.get("DOMAIN", "")},
                                        "apps": [
                {"id": a["id"], "name": a["name"], "about": a["about"], "genre": a["genre"],
                 "url": a["url"], "hasIcon": a["icon"].startswith("di:"), "icon": a["icon"],
                 "imported": bool(a.get("imported")), "note": a.get("note", ""), "up": status[a["id"]]} for a in apps],
                "available": [{"id": a["id"], "name": a["name"], "about": a["about"], "genre": a["genre"],
                               "hasIcon": a["icon"].startswith("di:"), "icon": a["icon"],
                               "imported": bool(a.get("imported")), "store": bool(a.get("store"))}
                              for a in available_apps()]})
        if path.startswith("/api/icon/"):
            icon = app_icon(path[len("/api/icon/"):])
            if not icon:
                return self.send(404, b"no icon")
            ctype, data = icon
            return self.send(200, data, ctype, [("Cache-Control", "private, max-age=604800")], csp=ICON_CSP)
        if path == "/api/settings":
            return self.send_json(200, self.settings_payload())
        if path == "/api/terminal":
            return self.send_json(200, {"enabled": terminal_enabled(), "admin": admin_on(), "sessions": terminal_sessions()})
        if path.startswith("/api/terminal/"):
            if not admin_on():
                return self.send_json(403, {"error": "admin mode is off", "admin": True})
            folder = terminal_folder(path[len("/api/terminal/"):])
            if not folder:
                return self.send_json(404, {"error": "no such terminal"})
            try:
                offset = max(0, int(query.get("offset", ["0"])[0]))
            except ValueError:
                return self.send_json(400, {"error": "offset: a number"})
            data, ended, started = terminal_read(folder, offset)
            return self.send_json(200, {"data": base64.b64encode(data).decode(), "offset": offset + len(data),
                                        "ended": ended, "started": started})
        if path == "/api/notifications":
            items = load_notifications()[::-1]
            return self.send_json(200, {"items": items, "unread": sum(not n.get("read") for n in items)})
        if path == "/api/updates":
            images = image_updates()
            return self.send_json(200, {"checked": images is not None, "images": images or []})
        if path == "/api/widgets":
            return self.send_json(200, {"selected": selected_widgets(), "data": widget_data()})
        if path == "/api/jobs":
            return self.send_json(200, {"jobs": recent_jobs()})
        if path.startswith("/api/jobs/"):
            job = read_job(path[len("/api/jobs/"):])
            return self.send_json(200, job) if job else self.send_json(404, {"error": "no such job"})
        self.send(404, b"not found")

    # -------------------------------------------------------------- POST

    def read_json(self):
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if not 0 < length <= 4096:
            return None
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            return None
        return body if isinstance(body, dict) else None

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/login":
            return self.login()
        if path == "/api/logout":
            token = self.session_token()
            if token:
                revoke(token)
            return self.send_json(200, {"ok": True}, [self.cookie_header("", 0)])
        if not path.startswith("/api/"):
            return self.send(404, b"not found")
        if not self.logged_in():
            return self.send_json(401, {"error": "login required"})
        # JSON only: a plain cross-site form can't send it, so with SameSite
        # cookies these can't be triggered from another site.
        body = self.read_json()
        if body is None:
            return self.send_json(400, {"error": "expected a JSON object"})
        if path == "/api/settings":
            return self.update_settings(body)
        if path == "/api/password":
            return self.change_password(body)
        if path == "/api/admin":
            return self.set_admin(body)
        if path == "/api/terminal":
            return self.open_terminal(body)
        if path.startswith("/api/terminal/"):
            return self.terminal_request(path[len("/api/terminal/"):], body)
        if path == "/api/notifications":
            if body.get("read") == "all":
                update_notifications("read")
            elif body.get("clear") is True:
                update_notifications("clear")
            else:
                return self.send_json(400, {"error": "expected {\"read\": \"all\"} or {\"clear\": true}"})
            return self.send_json(200, {"ok": True})
        if path == "/api/actions":
            actions = load_actions()
            params, error = validate_action(body.get("action"), body.get("params"), actions)
            if error:
                return self.send_json(400, {"error": error})
            if needs_admin(actions[body["action"]], params) and not admin_on():
                return self.send_json(403, {"error": "admin mode is off", "admin": True})
            job, busy = queue_action(body["action"], params, actions)
            if busy:
                return self.send_json(409, {"error": "busy", "job": busy})
            return self.send_json(202, job)
        self.send(404, b"not found")

    def login(self):
        client = self.client()
        wait = lockout_remaining(client)
        if wait:
            return self.send_json(429, {"error": "too many attempts", "retryAfter": wait})
        body = self.read_json()
        password = body.get("password") if body else None
        if not isinstance(password, str) or len(password) > 200:
            return self.send_json(400, {"error": "expected {\"password\": ...}"})
        if not password_ok(password):
            record_failure(client)
            time.sleep(1)  # slows guessing; each request has its own thread
            return self.send_json(401, {"error": "wrong password"})
        with _auth_lock:
            _failures.pop(client, None)
        return self.send_json(200, {"ok": True}, [self.cookie_header(new_session(), SESSION_SECONDS)])

    def update_settings(self, body):
        changes = {}
        if "name" in body:
            name = body["name"]
            if not isinstance(name, str) or len(name) > 40 or not name.isprintable():
                return self.send_json(400, {"error": "name: up to 40 printable characters"})
            changes["name"] = name.strip()
        if "dock" in body:
            pins, installed = body["dock"], {a["id"] for a in installed_apps()}
            if not isinstance(pins, list) or len(pins) > DOCK_MAX_PINS or len(set(map(str, pins))) != len(pins):
                return self.send_json(400, {"error": f"dock: up to {DOCK_MAX_PINS} different apps"})
            if not all(isinstance(a, str) and a in installed for a in pins):
                return self.send_json(400, {"error": "dock: only installed apps can be pinned"})
            changes["dock"] = pins
        if "order" in body:
            # One or more collections' new arrangement, merged into the rest.
            order = body["order"]
            ids = {a["id"] for a in installed_apps()}
            if (not isinstance(order, dict) or not order or len(order) > 50
                    or not all(isinstance(c, str) and re.fullmatch(r"[a-z0-9-]{1,40}", c) for c in order)
                    or not all(isinstance(v, list) and len(v) <= 200 and len(set(map(str, v))) == len(v)
                               and all(isinstance(a, str) and a in ids for a in v) for v in order.values())):
                return self.send_json(400, {"error": "order: {collection: [installed app ids]}"})
            changes["order"] = {**app_order(), **order}
        if "widgets" in body:
            chosen, catalog = body["widgets"], widget_catalog()
            if (not isinstance(chosen, list) or len(chosen) > catalog["max"]
                    or not all(isinstance(w, str) and w in catalog["ids"] for w in chosen)
                    or len(set(chosen)) != len(chosen)):
                return self.send_json(400, {"error": f"widgets: up to {catalog['max']} different widgets"})
            changes["widgets"] = chosen
        if "searchUrl" in body:
            if not valid_search_url(body["searchUrl"]):
                return self.send_json(400, {"error": "web search: an http(s) address containing {QUERY}"})
            changes["searchUrl"] = body["searchUrl"]
        if "wallpaper" in body:
            if not wallpaper_path(body["wallpaper"]):
                return self.send_json(400, {"error": "no such wallpaper"})
            changes["wallpaper"] = body["wallpaper"]
        if not changes:
            return self.send_json(400, {"error": "nothing to change"})
        save_settings(changes)
        return self.send_json(200, {"ok": True})

    def change_password(self, body):
        client = self.client()
        wait = lockout_remaining(client)
        if wait:
            return self.send_json(429, {"error": "too many attempts", "retryAfter": wait})
        current, new = body.get("current"), body.get("new")
        if not isinstance(current, str) or not isinstance(new, str):
            return self.send_json(400, {"error": "expected current and new"})
        if not password_ok(current):
            record_failure(client)
            time.sleep(1)
            return self.send_json(401, {"error": "wrong password"})
        if not 8 <= len(new) <= 200:
            return self.send_json(400, {"error": "the new password needs 8 to 200 characters"})
        save_settings({"passwordHash": hash_password(new)})
        # Every other session is now signed with the old key; this one carries on.
        return self.send_json(200, {"ok": True}, [self.cookie_header(new_session(), SESSION_SECONDS)])

    def open_terminal(self, body):
        """A new shell: admin mode, the terminal switched on, and your password again."""
        if not admin_on():
            return self.send_json(403, {"error": "admin mode is off", "admin": True})
        if not terminal_enabled():
            return self.send_json(409, {"error": "the terminal is off: set ADLEROS_TERMINAL=on and re-run install.sh"})
        client = self.client()
        wait = lockout_remaining(client)
        if wait:
            return self.send_json(429, {"error": "too many attempts", "retryAfter": wait})
        password = body.get("password")
        if not isinstance(password, str) or len(password) > 200 or not password_ok(password):
            record_failure(client)
            time.sleep(1)
            return self.send_json(401, {"error": "wrong password"})
        if len(terminal_sessions()) >= 3:
            return self.send_json(409, {"error": "at most 3 terminals at once; close one"})
        try:
            rows, cols = int(body.get("rows", 24)), int(body.get("cols", 80))
        except (TypeError, ValueError):
            return self.send_json(400, {"error": "rows and cols: numbers"})
        sid = secrets.token_hex(16)
        folder = TERM_DIR / sid
        TERM_DIR.mkdir(parents=True, exist_ok=True)
        folder.mkdir(mode=0o700)
        terminal_append(folder / "in", b"")
        write_private(folder / "start.json", json.dumps({"sid": sid, "rows": rows, "cols": cols, "created": time.time()}))
        return self.send_json(200, {"sid": sid})

    def terminal_request(self, rest, body):
        sid, _, what = rest.partition("/")
        if not admin_on():
            return self.send_json(403, {"error": "admin mode is off", "admin": True})
        folder = terminal_folder(sid)
        if not folder:
            return self.send_json(404, {"error": "no such terminal"})
        if what == "input":
            try:
                data = base64.b64decode(body.get("data", ""), validate=True)
            except (ValueError, TypeError):
                return self.send_json(400, {"error": "data: base64"})
            terminal_append(folder / "in", data)
        elif what == "size":
            try:
                rows, cols = int(body["rows"]), int(body["cols"])
            except (KeyError, TypeError, ValueError):
                return self.send_json(400, {"error": "rows and cols: numbers"})
            write_private(folder / "size", f"{rows} {cols}\n")
        elif what == "close":
            terminal_append(folder / "close", b"")
        else:
            return self.send(404, b"not found")
        return self.send_json(200, {"ok": True})

    def set_admin(self, body):
        """Turning admin mode on takes your password, like sudo; off doesn't."""
        on = body.get("on")
        if not isinstance(on, bool):
            return self.send_json(400, {"error": "expected {\"on\": true|false}"})
        if on:
            client = self.client()
            wait = lockout_remaining(client)
            if wait:
                return self.send_json(429, {"error": "too many attempts", "retryAfter": wait})
            password = body.get("password")
            if not isinstance(password, str) or len(password) > 200 or not password_ok(password):
                record_failure(client)
                time.sleep(1)
                return self.send_json(401, {"error": "wrong password"})
        save_settings({"admin": on})
        if not on:
            close_terminals()  # a shell needs admin mode for as long as it's open
        return self.send_json(200, {"ok": True, "admin": on})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.client()} {fmt % args}\n")


def main():
    for folder in (ICONS, QUEUE, JOBS):
        folder.mkdir(parents=True, exist_ok=True)
    cpu_usage()  # first sample, so the first Settings view has a reading
    threading.Thread(target=Watcher().run, name="watcher", daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"adlerOS on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
