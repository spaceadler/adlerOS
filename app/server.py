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
    POST /api/terminal     {"rows", "cols"} -> a new shell (admin mode)
    GET  /api/terminal/<id>?offset=N  its output from N (waits for some)
    POST /api/terminal/<id>/input|size|close
    GET  /api/files?path=   a folder (the Files window): /desktop, /user or /root/...
    GET  /api/files/text|raw|trash|tasks  a file to edit or download, the Trash,
                           copies and moves under way
    POST /api/files/text|mkdir|rename|delete|move|copy|restore|empty-trash
    PUT  /api/files/upload?dir=&name=  a file, streamed in
    GET  /api/frame/<app>?secure=  whether the app can open in a window (desktop mode)
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
import calendar
import datetime
import gzip
import hashlib
import hmac
import ipaddress
import json
import os
import posixpath
import re
import secrets
import shutil
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree
from concurrent.futures import ThreadPoolExecutor
from http.cookies import CookieError, SimpleCookie
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ical
import musictags

STATIC = Path(__file__).resolve().parent / "static"
# standalone: adlerOS on any Docker host (apps from the registry and the store);
# homelab: part of a homelab built from its catalog (containers/catalog.tsv).
MODE = "standalone" if os.environ.get("ADLEROS_MODE") == "standalone" else "homelab"
HOMELAB_MODE = MODE == "homelab"
ADLEROS = Path(os.environ.get("ADLEROS_ROOT", "/adleros"))  # this repo's catalog/ and agent/
STORE = ADLEROS / "catalog" / "store"
STANDALONE_ENV = ADLEROS / "settings.env"  # adlerOS's .env, read-only (standalone)
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
# adlerOS's own dock icons (./icons can replace each): All apps, and the ones
# you pin like any app.
DOCK_ICONS = ("app-drawer", "app-store", "settings", "live-usage", "files", "terminal", "notepad", "adlermd", "music", "gallery", "documents", "calendar", "tasks")
DOCK_MAX_PINS = 16
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
# frame-src: your apps' own pages, in desktop mode's windows. Any web page,
# since an app may redirect elsewhere (its login, https); whether it may be
# framed is the app's call, and adlerOS asks it first (/api/frame). img-src
# https: pictures from the internet, in a note (adlermd, Notepad).
PAGE_CSP = ("default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; "
            "connect-src 'self'; frame-src http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
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
        collection = info.get("collection") if info.get("collection") in (*COLLECTION_ORDER, BACKGROUND) else EXTRAS
        apps.append({"id": folder.name, "genre": collection, "sub": "-", "port": port, "icon": icon,
                     "name": info["name"][:40], "about": str(info.get("about", ""))[:200], "url": info["url"],
                     "imported": True, "known": str(info.get("known", "")), "note": str(info.get("note", ""))[:300],
                     "site": info.get("source") == "site",  # a website you added: no containers
                     # "https": only in a window when adlerOS is on HTTPS too; "tab": never.
                     "window": info.get("window") if info.get("window") in ("https", "tab") else ""})
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
            # Bound to loopback on purpose (HTTPS only, by tailscale serve or
            # nginx), so it's checked at its HTTPS name instead of its port.
            app = {**app, "check": vault_host}
            url = f"https://{vault_host}"
        else:
            url = f"{scheme}://{app['sub']}.{domain}"
        apps.append({**app, "url": url})
    ids = {a["id"] for a in apps}
    return apps + [a for a in registry_apps() if a["id"] not in ids]


EXTRAS = "extras"  # the collection for apps that aren't in one
# Agents and the like, with no page of their own (Beszel's agent): only in
# the App Store, to start and stop, never on the home screen or in All apps.
BACKGROUND = "background"


def collection_name(collection_id):
    """A collection's title, from its folder name: life -> Life, home-lab -> Home lab."""
    if collection_id == BACKGROUND:
        return "In the background"
    return "Extras" if collection_id == EXTRAS else collection_id.replace("-", " ").capitalize()


def collections(apps):
    """The collections that have apps, in catalog order, Extras last."""
    order = list(COLLECTION_ORDER)
    for app in read_catalog() if HOMELAB_MODE else []:
        if app["genre"] not in order:
            order.append(app["genre"])
    present = {a["genre"] for a in apps} - {BACKGROUND}
    ids = [c for c in order if c in present and c != EXTRAS]
    ids += sorted(c for c in present if c not in ids and c != EXTRAS)
    if EXTRAS in present:
        ids.append(EXTRAS)
    return [{"id": c, "name": collection_name(c)} for c in ids]


def placements():
    """Collections you've put apps in yourself, like moving a file between
    folders: {app id: collection}. Only where an app shows, not what it is:
    a core app stays core (admin mode to stop it) wherever you put it."""
    placed = load_settings().get("placed")
    return placed if isinstance(placed, dict) else {}


def placed(apps):
    """The apps with your placements applied; "home" is where one came from."""
    mine = placements()
    return [{**a, "genre": mine[a["id"]], "home": a["genre"]} if mine.get(a["id"]) not in (None, a["genre"]) else a
            for a in apps]


def collection_choices():
    """Every collection an app can be put in, empty ones too, Extras last."""
    ids = list(COLLECTION_ORDER)
    for app in read_catalog() if HOMELAB_MODE else []:
        if app["genre"] not in ids and app["genre"] != EXTRAS:
            ids.append(app["genre"])
    return [{"id": c, "name": collection_name(c)} for c in ids + [EXTRAS]]


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


ADMIN_SECONDS = 8 * 3600


def admin_until():
    """When admin mode turns itself off (a time.time()), or 0 when it's off."""
    s = load_settings()
    until = s.get("adminUntil")
    return until if s.get("admin") is True and isinstance(until, (int, float)) and until > time.time() else 0


def admin_left():
    """Seconds until admin mode turns itself off (0: it's off), for the page:
    its clock needn't agree with this one."""
    return max(0, round(admin_until() - time.time()))


def admin_on():
    """Admin mode: restart and shut down, delete apps, stop core and network
    apps, the terminal. Off until you turn it on in Settings, with your
    password, and off again ADMIN_SECONDS later, in case you forget. Its
    shells keep running meanwhile, out of reach until it's back on."""
    return admin_until() > 0


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


# adlerOS's own windows you can pin like an app (and unpin): pre-pinned,
# once, after whatever you'd pinned already.
# adlerOS's own, pinned (and unpinned, moved about) like any app; in the dock
# from the start, in this order, until you take them out.
BUILTIN_PINS = ("adleros:app-store", "adleros:settings", "adleros:live-usage", "adleros:files", "adleros:terminal",
                "adleros:notepad", "adleros:adlermd", "adleros:music", "adleros:gallery", "adleros:documents", "adleros:calendar", "adleros:tasks")
DOCK_FIRST = BUILTIN_PINS[:5]  # a new dock's (Notepad, adlermd and Music: in All apps, for you to pin)
DOCK_SEED = 2  # 1: My Computer and the Terminal pinned; 2: the App Store, Settings and Live Usage too


def dock_pins():
    """Pinned to the dock, in order: installed apps and adlerOS's own."""
    settings = load_settings()
    pins = settings.get("dock", [])
    if not isinstance(pins, list):
        pins = []
    seeded = settings.get("dockSeeded")
    seeded = 1 if seeded is True else seeded if isinstance(seeded, int) else 0
    if seeded < DOCK_SEED:
        # The three that used to stay in the dock whatever you did join the
        # pins, after your apps; the rest as you had them.
        new = DOCK_FIRST if seeded < 1 else ("adleros:app-store", "adleros:settings", "adleros:live-usage")
        own = [p for p in BUILTIN_PINS if p in pins or p in new]
        pins = [p for p in pins if p not in BUILTIN_PINS] + own
        save_settings({"dock": pins, "dockSeeded": DOCK_SEED})
    installed = {a["id"] for a in installed_apps()}
    return [p for p in pins if p in installed or p in BUILTIN_PINS]


FOLDER_ID = re.compile(r"[a-z0-9]{1,16}")


def app_folders(installed=None):
    """Your folders on the home screen, {id: {name, collection, apps}}: apps
    that are gone left out, and a folder with none left gone too."""
    raw = load_settings().get("folders")
    if not isinstance(raw, dict):
        return {}
    ids = installed if installed is not None else {a["id"] for a in installed_apps()}
    found = {}
    for fid, f in raw.items():
        if not (isinstance(fid, str) and FOLDER_ID.fullmatch(fid) and isinstance(f, dict)):
            continue
        apps = [a for a in f.get("apps", []) if a in ids]
        if apps:
            found[fid] = {"name": str(f.get("name", "Folder"))[:30], "collection": f.get("collection"), "apps": apps}
    return found


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
    if name not in DOCK_ICONS:
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

def install_setting(key, default=""):
    """KEY from the install's settings file (homelab.env, or adlerOS's .env)."""
    env = read_env_file(HOMELAB_ENV) if HOMELAB_MODE else read_env_file(STANDALONE_ENV) if STANDALONE_ENV.is_file() else os.environ
    return (env.get(key) or default).strip()


def wallpaper_dirs():
    """Where your wallpapers are: a folder in your storage (WALLPAPER_DIR in the
    settings file, Other/Wallpapers if it isn't set), and the wallpaper/
    folder next to adlerOS."""
    rel = install_setting("WALLPAPER_DIR", "Other/Wallpapers").strip("/")
    _, folder = locate(f"/user/{rel}")
    return [d for d in (folder, WALLPAPER_DIR) if d and d.is_dir()]


def custom_wallpapers():
    found, names = [], set()
    for folder in wallpaper_dirs():
        try:
            pics = sorted(p for p in folder.iterdir()
                          if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and not p.name.startswith("."))
        except OSError:
            continue
        for p in pics:
            if p.name not in names:  # the same name in both: the storage folder's
                names.add(p.name)
                found.append(p)
    return found


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
            with urllib.request.urlopen(f"http://{local_address()}:{cup['port']}{path}", timeout=4) as r:
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


def local_address():
    """This machine, as adlerOS reaches its apps: its Tailscale address (TS_IP
    in a homelab, ADLEROS_HOST standalone), never loopback."""
    return (install_setting("TS_IP") if HOMELAB_MODE else install_setting("ADLEROS_HOST")) or socket.gethostname()


def _up(target):
    """Whether it answers: a port (a number) at this machine's address, or a
    name (an app served only over HTTPS) at port 443 there, asked for that
    name: any answer but a proxy's 5xx (its app is down) is up."""
    host = local_address()
    try:
        if isinstance(target, int):
            with socket.create_connection((host, target), timeout=0.8):
                return True
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE  # only whether it answers
        with socket.create_connection((host, 443), timeout=0.8) as raw, context.wrap_socket(raw, server_hostname=target) as tls:
            tls.settimeout(2)
            tls.sendall(f"HEAD / HTTP/1.1\r\nHost: {target}\r\nConnection: close\r\n\r\n".encode())
            status = tls.recv(64).split(b" ", 2)
            return len(status) > 1 and status[1].isdigit() and int(status[1]) < 500
    except OSError:
        return False


def app_status(apps):
    """{app id: up?}: whether each app's port answers (or its HTTPS name, for
    one bound to loopback). An imported app with no port can't be checked,
    so it counts as up."""
    up = port_status({a.get("check") or a["port"] for a in apps if a.get("check") or a["port"]})
    return {a["id"]: up[a.get("check") or a["port"]] if a.get("check") or a["port"] else True for a in apps}


# ----------------------------------------------------------- app windows

_frames = {}
_frames_lock = threading.Lock()
FRAME_TTL = 600


def frame_headers(app):
    """The headers of the app's page, as the browser will get them: from its
    address when that's a name of its own (through your reverse proxy, which
    can add headers), else at its port on this machine (no DNS needed). None
    if it doesn't answer."""
    host = urllib.parse.urlsplit(app["url"]).hostname or ""
    here = local_address()
    own_name = host not in ("127.0.0.1", "localhost", here)
    urls = [app["url"]] if own_name or not app.get("port") else []
    if app.get("port"):
        urls += [f"http://{here}:{app['port']}/", f"https://{here}:{app['port']}/"]
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE  # only to read its headers: its own certificate, often
    for url in urls:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "adlerOS"})
            with urllib.request.urlopen(request, timeout=4, context=context) as response:
                return response.headers
        except urllib.error.HTTPError as e:
            return e.headers  # a 401 or 404 page says it as well as any
        except (OSError, ValueError):
            continue
    return None


def cert_trusted(url):
    """Whether an https address has a certificate browsers accept. Not
    answering at all isn't a no: frame_headers says that."""
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "adlerOS"})
        with urllib.request.urlopen(request, timeout=4, context=ssl.create_default_context()):
            return True
    except urllib.error.HTTPError:
        return True  # it answered, over a trusted connection
    except urllib.error.URLError as e:
        return not isinstance(e.reason, ssl.SSLCertVerificationError)
    except (OSError, ValueError):
        return True


def frame_allowed(headers, host):
    """Whether these headers let a page at `host` (adlerOS) show it in a frame."""
    xfo = headers.get("X-Frame-Options", "").strip().lower()
    if xfo:
        return False  # DENY, SAMEORIGIN (adlerOS is another origin), ALLOW-FROM (obsolete)
    policy = " ".join(headers.get_all("Content-Security-Policy") or [])
    match = re.search(r"frame-ancestors\s+([^;]*)", policy, re.I)
    if not match:
        return True
    name = host.split(":")[0].lower()
    for source in match[1].lower().split():
        bare = re.sub(r"^[a-z][a-z0-9+.-]*://", "", source).rstrip("/")
        if source == "*" or bare in (host.lower(), name) or (bare.startswith("*.") and name.endswith(bare[1:])):
            return True
    return False


def frame_answer(app, host, secure):
    """{"frame": bool, "why": ...}: whether the app can open in a window."""
    url = app.get("url") or ""
    if not url:
        return {"frame": False, "why": "it has no web page"}
    if app.get("window") == "tab":
        return {"frame": False, "why": "it works best in a tab of its own"}
    if app.get("window") == "https" and not secure:
        return {"frame": False, "why": "in a window it needs adlerOS on HTTPS too"}
    if secure and url.startswith("http:"):
        return {"frame": False, "why": "its page is plain HTTP and adlerOS is on HTTPS"}
    key = (app["id"], url, host)
    with _frames_lock:
        cached = _frames.get(key)
    if cached and time.monotonic() - cached[0] < FRAME_TTL:
        return cached[1]
    headers = frame_headers(app)
    if headers is None:
        answer = {"frame": False, "why": "it didn't answer adlerOS's check"}
    elif url.startswith("https:") and not cert_trusted(url):
        # A browser shows nothing at all in a frame whose certificate it
        # doesn't trust (no warning to click through): a blank window.
        answer = {"frame": False, "why": "its certificate isn't one browsers trust (its own, made for itself)"}
    elif frame_allowed(headers, host):
        answer = {"frame": True, "why": ""}
    else:
        answer = {"frame": False, "why": "it doesn't allow being shown inside another page"}
    with _frames_lock:
        _frames[key] = (time.monotonic(), answer)
    return answer


def port_status(ports):
    """{port (or HTTPS name): up?} for each, checked in parallel, cached STATUS_TTL."""
    now = time.monotonic()
    with _status_lock:
        result = {p: up for p, (at, up) in _status.items() if p in ports and now - at < STATUS_TTL}
    todo = [p for p in ports if p not in result]
    for port, up in zip(todo, _pool.map(_up, todo)):
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


WHITE = {"#fff", "#ffffff", "white", "rgb(255,255,255)"}


def white_only(svg):
    """Whether an SVG is drawn all in white (made for dark backgrounds)."""
    text = svg[:256 * 1024].decode("utf-8", "replace").lower()
    colors = {c.replace(" ", "") for c in re.findall(r'(?:fill|stroke|stop-color)\s*[:=]\s*"?\s*(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\))', text)}
    colors -= {"none", "currentcolor", "transparent", "inherit"}
    return bool(colors) and colors <= WHITE


def legible(name, svg):
    """An icon all in white is lost on a tile's white: dashboard-icons' dark
    one (<name>-dark) instead, or else this one in near-black."""
    if not white_only(svg):
        return svg
    dark = ICONS / f"{name}-dark.svg"
    missing = ICONS / f"{name}-dark.missing"
    if not dark.is_file() and not (missing.exists() and time.time() - missing.stat().st_mtime < ICON_RETRY_SECONDS):
        data = _fetch(f"{ICON_CDN}/svg/{name}-dark.svg", lambda d: b"<svg" in d[:1024])
        if data:
            tmp = ICONS / f".{name}-dark.svg.{secrets.token_hex(4)}"
            tmp.write_bytes(data)
            tmp.replace(dark)
        else:
            missing.touch()
    if dark.is_file():
        return dark.read_bytes()
    return re.sub(rb'((?:fill|stroke|stop-color)\s*[:=]\s*"?\s*)(#ffffff|#fff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))',
                  rb"\1#1c1c1e", svg, flags=re.I)


# An app dashboard-icons has no icon for: its own, as a phone's home screen
# finds it. The biggest apple-touch-icon (or icon) its page names, else the
# usual places (/apple-touch-icon.png, /favicon.svg, /favicon.ico); fetched
# once, kept in data/icons as site-<app>.<ext>, and only if it really is a
# picture.
SITE_ICON_KINDS = [  # (extension, content type, does it look like one)
    ("png", "image/png", lambda d: d.startswith(b"\x89PNG\r\n\x1a\n")),
    ("jpg", "image/jpeg", lambda d: d.startswith(b"\xff\xd8\xff")),
    ("webp", "image/webp", lambda d: d[:4] == b"RIFF" and d[8:12] == b"WEBP"),
    ("gif", "image/gif", lambda d: d[:6] in (b"GIF87a", b"GIF89a")),
    ("ico", "image/x-icon", lambda d: d.startswith(b"\x00\x00\x01\x00")),
    ("svg", "image/svg+xml", lambda d: b"<svg" in d[:2048]),
]


class _IconLinks(HTMLParser):
    """The icons a page links to: [(how good, address)], biggest first."""

    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        rel = a.get("rel", "").lower().split()
        if tag != "link" or not a.get("href") or not ({"icon", "apple-touch-icon", "apple-touch-icon-precomposed"} & set(rel)):
            return
        sizes = [int(n) for n in re.findall(r"(\d+)x\d+", a.get("sizes", ""))]
        size = 1024 if "svg" in a.get("type", "") or a["href"].split("?")[0].endswith(".svg") else max(sizes, default=0)
        # An apple-touch-icon is made for a home screen: square, with its own background.
        self.found.append((size + (200 if "apple-touch-icon" in " ".join(rel) else 0), a["href"]))


def site_icon(app):
    url = str(app.get("url") or "")
    if not re.match(r"https?://", url):
        return None
    key = re.sub(r"[^a-z0-9-]", "-", app["id"])
    for ext, ctype, _ in SITE_ICON_KINDS:
        cached = ICONS / f"site-{key}.{ext}"
        if cached.is_file():
            return ctype, cached.read_bytes()
    missing = ICONS / f"site-{key}.missing"
    if missing.exists() and time.time() - missing.stat().st_mtime < ICON_RETRY_SECONDS:
        return None
    page = _fetch(url, lambda d: True) or b""
    links = _IconLinks()
    try:
        links.feed(page[:512 * 1024].decode("utf-8", "replace"))
    except Exception:  # a page that isn't HTML: the usual places, then
        pass
    # The usual apple-touch-icon (180px) before a small favicon the page names.
    guesses = [(200, "/apple-touch-icon.png"), (-1, "/favicon.svg"), (-1, "/favicon.ico")]
    tries = [urllib.parse.urljoin(url, href) for _, href in sorted(links.found + guesses, key=lambda t: -t[0])]
    for address in dict.fromkeys(tries):
        if not re.match(r"https?://", address):
            continue  # a data: icon, say
        data = _fetch(address, lambda d: any(look(d) for _, _, look in SITE_ICON_KINDS))
        if not data:
            continue
        ext, ctype, _ = next(k for k in SITE_ICON_KINDS if k[2](data))
        ICONS.mkdir(parents=True, exist_ok=True)
        tmp = ICONS / f".site-{key}.{ext}.{secrets.token_hex(4)}"
        tmp.write_bytes(data)
        tmp.replace(ICONS / f"site-{key}.{ext}")
        return ctype, data
    ICONS.mkdir(parents=True, exist_ok=True)
    missing.touch()
    return None


def app_icon(app_id):
    """(content type, bytes) of an app's icon, or None to use a lettered tile."""
    app = next((a for a in read_catalog() + registry_apps() + registry_apps(installed=False) + store_apps()
                if a["id"] == app_id), None)
    if not app:
        return None
    found = dashboard_icon(app["icon"][3:]) if app["icon"].startswith("di:") else None
    return found or site_icon(app)


def dashboard_icon(name):
    """(content type, bytes) of dashboard-icons' <name>, or None."""
    if not re.fullmatch(r"[a-z0-9-]+", name):
        return None
    kinds = [("svg", "image/svg+xml", lambda d: b"<svg" in d[:1024]),
             ("png", "image/png", lambda d: d.startswith(b"\x89PNG\r\n\x1a\n"))]
    for ext, ctype, _ in kinds:
        cached = ICONS / f"{name}.{ext}"
        if cached.is_file():
            return ctype, legible(name, cached.read_bytes()) if ext == "svg" else cached.read_bytes()
    missing = ICONS / f"{name}.missing"
    if missing.exists() and time.time() - missing.stat().st_mtime < ICON_RETRY_SECONDS:
        return None
    for ext, ctype, check in kinds:
        data = _fetch(f"{ICON_CDN}/{ext}/{name}.{ext}", check)
        if data:
            tmp = ICONS / f".{name}.{ext}.{secrets.token_hex(4)}"
            tmp.write_bytes(data)
            tmp.replace(ICONS / f"{name}.{ext}")
            return ctype, legible(name, data) if ext == "svg" else data
    missing.touch()
    return None


# --------------------------------------------------------------- terminal

TERM_DIR = DATA / "agent" / "term"
TERM_ID = re.compile(r"[a-f0-9]{32}")
TERM_WAIT = 20  # seconds a read waits for output
TERM_START_WITHIN = 60  # seconds the terminal host takes a request for (its START_WITHIN)
TERM_CHUNK = 256 * 1024


def terminal_enabled():
    """ADLEROS_TERMINAL=on in the settings file: set on the host, so adlerOS
    can't turn its own terminal on."""
    value = (read_env_file(HOMELAB_ENV).get("ADLEROS_TERMINAL", "") if HOMELAB_MODE
             else os.environ.get("ADLEROS_TERMINAL", ""))
    return value.strip().lower() in ("on", "yes", "true", "1")


def terminal_sessions():
    """Open shells, and requests the terminal host can still take (it refuses
    them after a minute, so one it never saw doesn't count forever)."""
    def open_(p):
        if (p / "ended").exists() or (p / "close").exists():
            return False
        if (p / "started.json").exists():
            return True
        try:
            return time.time() - (p / "start.json").stat().st_mtime < TERM_START_WITHIN
        except OSError:
            return False
    def started(p):
        try:
            return (p / "started.json").stat().st_mtime
        except OSError:
            return time.time()
    try:
        found = [p for p in TERM_DIR.iterdir() if TERM_ID.fullmatch(p.name) and open_(p)]
    except OSError:
        return []
    return [p.name for p in sorted(found, key=started, reverse=True)]  # newest first


TERM_ABANDONED = 60  # seconds no page has read a shell: nobody's looking at it


def terminal_seen(folder):
    """A page is showing this shell (it reads every 20 seconds at most)."""
    try:
        (folder / "seen").touch()
    except OSError:
        pass


def close_abandoned():
    """Shells no page is showing (a tab closed or reloaded): closed, to make
    room for a new one."""
    now = time.time()
    for sid in terminal_sessions():
        folder = TERM_DIR / sid
        try:
            seen = max((folder / name).stat().st_mtime for name in ("seen", "started.json", "start.json") if (folder / name).exists())
        except ValueError:
            continue
        if now - seen > TERM_ABANDONED:
            terminal_append(folder / "close", b"")


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


# ------------------------------------------------------------------ files

# The Files window's three places, each its own mount:
#   desktop  the Desktop folder (a homelab's mailbox/), read-write
#   user     your storage folder, read-write
#   root     the homelab's own folder, read-only. Changes there go through the
#            helper, in admin mode, and only while the machine allows
#            shell-level access (ADLEROS_TERMINAL=on, like the terminal).
# A place inside another (Root's mailbox/ and storage/) counts as itself.
PLACES = {
    "desktop": Path(os.environ.get("ADLEROS_DESKTOP_MOUNT", "/places/desktop")),
    "user": Path(os.environ.get("ADLEROS_FILES", "/storage")),
    "root": Path(os.environ.get("ADLEROS_ROOT_MOUNT", "/places/root")),
}
PLACE_LABELS = {"desktop": "Desktop", "user": "User", "root": "Root"}
WRITABLE = ("desktop", "user")
TRASH = ".trash"  # deleted files wait here, at the top of their place (Root's in User's)
FILE_REQUESTS = DATA / "agent" / "files"  # a change in Root, written out for the helper
TEXT_LIMIT = 2 * 1024 * 1024  # biggest file the editor opens
UPLOAD_LIMIT = 50 * 1024 ** 3
TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".env",
                 ".sh", ".bash", ".py", ".js", ".ts", ".css", ".html", ".xml", ".csv", ".tsv", ".log", ".sql",
                 ".c", ".h", ".cpp", ".rs", ".go", ".java", ".lua", ".tex", ".typ", ".srt", ".vtt", ".service",
                 ".example", ".template", ".fish"}
KINDS = {"image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".heic"},
         "video": {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v"},
         "audio": {".mp3", ".flac", ".ogg", ".opus", ".wav", ".m4a", ".aac", ".m4b"},
         "pdf": {".pdf"}, "archive": {".zip", ".tar", ".gz", ".tgz", ".xz", ".7z", ".rar", ".zst"}}
# What may be shown in the browser rather than downloaded; never HTML or SVG.
INLINE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
                ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".pdf": "application/pdf",
                ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
                ".opus": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".m4b": "audio/mp4",
                ".flac": "audio/flac",
                ".txt": "text/plain; charset=utf-8"}


def place_host(place):
    """Where a place is on the host (ADLEROS_HOST_*), to see one inside another."""
    value = os.environ.get("ADLEROS_HOST_STORAGE" if place == "user" else f"ADLEROS_HOST_{place.upper()}", "")
    return os.path.normpath(value) if value.startswith("/") else ""


def place_on(place):
    # Storage needs no host path (older installs don't pass one); the others do.
    return PLACES[place].is_dir() and (place == "user" or bool(place_host(place)))


def places_on():
    return [p for p in PLACES if place_on(p)]


def nested(place):
    """[(other place, its path inside this one, as parts)], deepest first."""
    here = place_host(place)
    found = []
    for other in PLACES:
        there = place_host(other)
        if here and other != place and there.startswith(here + "/") and place_on(other):
            found.append((other, there[len(here) + 1:].split("/")))
    return sorted(found, key=lambda f: -len(f[1]))


# ------------------------------------------------------------ file search

# Search (Alt+Space) finds files by name in every place: from an index made
# in the background, again every SEARCH_EVERY seconds and soon after
# anything changes through My Computer. Hidden files and folders (and the
# Trash) are left out; a place inside another (Root's storage/) is listed
# once, as itself.
SEARCH_EVERY = 1800  # a look round takes a minute on a Raspberry Pi
SEARCH_SOON = 10  # seconds after a change
SEARCH_MAX = 500_000  # files and folders, at most
SEARCH_SKIP = {"node_modules", "__pycache__", "venv"}
_search = {"paths": [], "keys": [], "at": 0.0, "full": False}
_search_lock = threading.Lock()
_search_wake = threading.Event()


def search_key(name):
    """What a name is found by: lower case, with - _ . as spaces."""
    return re.sub(r"[-_.]+", " ", name.lower())


def index_places():
    paths, keys = [], []
    for place in places_on():
        skip = {tuple(p) for _, p in nested(place)}
        stack = [(str(PLACES[place]), ())]
        while stack and len(paths) < SEARCH_MAX:
            folder, rel = stack.pop()
            try:
                with os.scandir(folder) as found:
                    entries = list(found)
            except OSError:
                continue
            for entry in entries:
                if entry.name.startswith(".") or entry.name in SEARCH_SKIP:
                    continue
                sub = (*rel, entry.name)
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                if is_dir and sub in skip:
                    continue
                paths.append("/" + "/".join((place, *sub)) + ("/" if is_dir else ""))  # a folder ends in /
                keys.append(search_key(entry.name))
                if is_dir:
                    stack.append((entry.path, sub))
    return paths, keys


def search_indexer():
    try:  # behind everything else on the CPU: this thread only
        os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 15)
    except (OSError, AttributeError):
        pass
    while True:
        try:
            paths, keys = index_places()
            with _search_lock:
                _search.update(paths=paths, keys=keys, at=time.time(), full=len(paths) >= SEARCH_MAX)
        except Exception as e:  # a bad folder never stops the server
            print(f"file search: couldn't look round ({e})", file=sys.stderr, flush=True)
        if _search_wake.wait(SEARCH_EVERY):
            time.sleep(SEARCH_SOON)  # a burst of changes: one look after
        _search_wake.clear()


def search_files(q, limit=40):
    """The files and folders whose names have every word of q in them,
    best first: names that start with it, then that have it as a word."""
    words = search_key(q).split()
    if not words:
        return {"items": [], "more": 0}
    with _search_lock:
        paths, keys, at = _search["paths"], _search["keys"], _search["at"]
    longest = max(words, key=len)
    hits = [i for i, key in enumerate(keys) if longest in key]
    rest = [w for w in words if w != longest]
    hits = [i for i in hits if all(w in keys[i] for w in rest)]
    whole = " ".join(words)
    hits.sort(key=lambda i: (0 if keys[i].startswith(whole) else 1 if f" {whole}" in f" {keys[i]}" else 2,
                             len(paths[i])))
    items = []
    for i in hits[:limit]:
        path = paths[i]
        is_dir = path.endswith("/")
        path = path.rstrip("/")
        items.append({"path": path, "name": path.rsplit("/", 1)[-1], "dir": is_dir,
                      "kind": file_kind(Path(path), is_dir)})
    return {"items": items, "more": max(0, len(hits) - limit), "ready": at > 0}


# ---------------------------------------------------------------- notes

# adlermd's vaults: folders of notes, Obsidian's way, so a vault Obsidian
# keeps works here and back (its .obsidian settings are read, never
# written). The first is NOTES_DIR in your storage (a homelab's Notes, by
# default); you add more from adlermd.
VAULT_MAX = 20000  # files listed in one vault
NOTE_MAX = 2 * 1024 * 1024
OBSIDIAN_FILES = ("app.json", "appearance.json", "graph.json", "daily-notes.json", "templates.json", "bookmarks.json")
_notes_cache = {}  # real path -> (mtime, size, facts, text)
_notes_lock = threading.Lock()
LINK_MD = re.compile(r"(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
LINK_WIKI = re.compile(r"(!?)\[\[([^\]\n|#^]*)([#^][^\]\n|]*)?(?:\|([^\]\n]*))?\]\]")
TAG = re.compile(r"(?<![\w/#&])#([A-Za-z_][\w/-]*|[0-9]+[A-Za-z_/-][\w/-]*)")
CODE = re.compile(r"^(```|~~~).*?^\1[^\n]*$|`[^`\n]*`", re.M | re.S)


def default_vault():
    """NOTES_DIR (in your storage), if it's there: the vault that's always offered."""
    rel = install_setting("NOTES_DIR", "Notes" if HOMELAB_MODE else "").strip("/")
    if not rel:
        return None
    _, real = locate(f"/user/{rel}")
    return f"/user/{rel}" if real and real.is_dir() else None


def vault_list():
    """[vault paths]: the default first, then the ones you added that are still there."""
    found = [v for v in [default_vault()] if v]
    saved = load_settings().get("vaults")
    for v in saved if isinstance(saved, list) else []:
        if isinstance(v, str) and v not in found and (lambda r: r and r.is_dir())(locate(v)[1]):
            found.append(v)
    return found


def note_facts(real, st):
    """What a note says about itself: its links, embeds, tags, headings and
    frontmatter (as written; adlermd reads it). Kept until it changes."""
    with _notes_lock:
        cached = _notes_cache.get(str(real))
    if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
        return cached[2], cached[3]
    try:
        text = real.read_bytes()[:NOTE_MAX].decode("utf-8", "replace")
    except OSError:
        return {}, ""
    front = ""
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end > 0:
            front = text[4:end][:16384]
    body = CODE.sub(" ", text)
    links = [{"to": m[3], "embed": bool(m[1])} for m in LINK_MD.finditer(body)]
    links += [{"to": m[2] + (m[3] or ""), "wiki": True, "embed": bool(m[1])} for m in LINK_WIKI.finditer(body)]
    tags = sorted({m[1] for m in TAG.finditer(re.sub(r"^#+\s.*$", "", body, flags=re.M))})
    headings = [m[2].strip() for m in re.finditer(r"^(#{1,6})\s+(.+?)\s*#*$", body, re.M)][:200]
    facts = {"links": links[:2000], "tags": tags, "headings": headings, "front": front}
    with _notes_lock:
        _notes_cache[str(real)] = (st.st_mtime, st.st_size, facts, text)
        if len(_notes_cache) > 50000:
            _notes_cache.clear()
    return facts, text


def vault_walk(top):
    """(folders, files) in a vault, as paths inside it; hidden ones (.obsidian,
    .trash) left out."""
    folders, files = [], []
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        rel = os.path.relpath(dirpath, top)
        rel = "" if rel == "." else rel.replace(os.sep, "/")
        if rel:
            folders.append(rel)
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            files.append((f"{rel}/{name}" if rel else name, Path(dirpath) / name))
            if len(files) >= VAULT_MAX:
                return folders, files
    return folders, files


def vault_index(vault):
    """Everything adlermd needs to know about a vault at once: its folders,
    its files (notes with their facts), its Obsidian settings."""
    place, top = locate(vault)
    if not top or not top.is_dir():
        return None
    folders, found = vault_walk(top)
    files = []
    for rel, real in found:
        try:
            st = real.stat()
        except OSError:
            continue
        entry = {"path": rel, "size": st.st_size, "mtime": st.st_mtime}
        if rel.lower().endswith(".md"):
            entry.update(note_facts(real, st)[0])
        files.append(entry)
    obsidian = {}
    for name in OBSIDIAN_FILES:
        f = top / ".obsidian" / name
        try:
            if f.is_file() and f.stat().st_size < 256 * 1024:
                obsidian[name[:-5]] = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
    writable = place in WRITABLE
    return {"vault": vault, "name": top.name, "folders": folders, "files": files, "obsidian": obsidian,
            "writable": writable, "full": len(found) >= VAULT_MAX}


def vault_search(vault, q, limit=100):
    """Notes with every word of q in them, and the lines that have them."""
    words = [w for w in q.lower().split() if w][:10]
    place, top = locate(vault)
    if not words or not top or not top.is_dir():
        return []
    hits = []
    for rel, real in vault_walk(top)[1]:
        if not rel.lower().endswith(".md"):
            continue
        try:
            st = real.stat()
        except OSError:
            continue
        text = note_facts(real, st)[1]
        low = text.lower()
        name_hit = all(w in rel.lower() for w in words)
        if not name_hit and not all(w in low for w in words):
            continue
        lines = [line.strip() for line in text.splitlines() if any(w in line.lower() for w in words)][:3]
        hits.append({"path": rel, "lines": [line[:240] for line in lines], "name": name_hit})
        if len(hits) >= limit:
            break
    hits.sort(key=lambda h: (not h["name"], h["path"]))
    return hits


def link_target(note_rel, href, wiki, names):
    """The file a link in note_rel points at (a path in the vault), and how it
    was written (relative, absolute, or by name), Obsidian's way: from the
    note's folder, then from the vault's top, then by name."""
    target = urllib.parse.unquote(href.split("#", 1)[0].split("^", 1)[0]).strip()
    if not target or re.match(r"[a-z][a-z0-9+.-]*:", target, re.I):
        return None, None
    here = posixpath.dirname(note_rel)
    tries = [] if wiki else [("relative", posixpath.normpath(posixpath.join(here, target)))]
    tries += [("absolute", posixpath.normpath(target.lstrip("/")))]
    for style, cand in tries:
        for c in (cand, f"{cand}.md"):
            if c in names:
                return c, style
    base = posixpath.basename(target).lower()
    matches = sorted((n for n in names if posixpath.basename(n).lower() in (base, f"{base}.md")), key=len)
    return (matches[0], "name") if matches else (None, None)


def link_href(note_rel, target, style, names):
    """How a link to target is written from note_rel in that style, spaces as %20."""
    if style == "relative":
        path = posixpath.relpath(target, posixpath.dirname(note_rel) or ".")
    elif style == "name" and sum(posixpath.basename(n) == posixpath.basename(target) for n in names) == 1:
        path = posixpath.basename(target)
    else:
        path = target
    return urllib.parse.quote(path, safe="/-_.~!*'&=+,;@$")  # ( ) too: a ) would end the link


def vault_rename(vault, old, new, links=True):
    """Rename (or move) a note, file or folder in a vault, and every link in
    the vault that points into it (and the moved notes' own relative links),
    as Obsidian does with Automatically update internal links. {updated: n}."""
    place, top = locate(vault)
    if not top or place not in WRITABLE:
        return {"error": "that vault can't be changed here"}
    old, new = posixpath.normpath(old.strip("/")), posixpath.normpath(new.strip("/"))
    src, dst = top / old, top / new
    if ".." in old.split("/") or ".." in new.split("/") or not old or not new or old == new:
        return {"error": "a path in the vault"}
    if not src.exists() or dst.exists() or not dst.parent.is_dir():
        return {"error": "it's gone, there's one by that name already, or its folder isn't there"}
    before = [rel for rel, _ in vault_walk(top)[1]]
    moved = lambda rel: rel == old or rel.startswith(old + "/")  # noqa: E731
    after_of = lambda rel: new + rel[len(old):] if moved(rel) else rel  # noqa: E731
    names_before, names_after = set(before), {after_of(r) for r in before}
    os.rename(src, dst)
    updated = 0
    for rel in before if links else []:
        if not rel.lower().endswith(".md"):
            continue
        now = after_of(rel)
        real = top / now
        try:
            text = real.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        def fix_md(m, rel=rel, now=now):
            target, style = link_target(rel, m[3], False, names_before)
            if not target or (not moved(target) and now == rel):
                return m[0]
            frag = m[3][len(m[3].split("#", 1)[0]):] if "#" in m[3] else ""
            href = link_href(now, after_of(target), style, names_after) + frag
            return m[0].replace(f"({m[3]}", f"({href}", 1).replace(f"(<{m[3]}>", f"(<{href}>", 1)

        def fix_wiki(m, rel=rel):
            target, _ = link_target(rel, m[2], True, names_before)
            if not target or not moved(target):
                return m[0]
            to = after_of(target)
            unique = sum(posixpath.basename(n) == posixpath.basename(to) for n in names_after) == 1
            name = posixpath.splitext(posixpath.basename(to))[0] if unique else posixpath.splitext(to)[0]
            return f"{m[1]}[[{name}{m[3] or ''}{'|' + m[4] if m[4] is not None else ''}]]"

        fixed = LINK_WIKI.sub(fix_wiki, LINK_MD.sub(fix_md, text))
        if fixed != text:
            tmp = real.with_name(f".{real.name}.{secrets.token_hex(4)}.saving")
            tmp.write_text(fixed, encoding="utf-8")
            os.chmod(tmp, real.stat().st_mode & 0o7777)
            os.replace(tmp, real)
            updated += 1
    return {"ok": True, "updated": updated, "path": new}


# ------------------------------------------------------------ radio stations

# Music's stations from the internet (Klassik Radio, a BBC one…): the ones you
# added, from a station's playlist file (.m3u, .m3u8, .pls, Kodi's .strm) or
# its address, in data/radio-stations.json. Played through here: a playlist
# address is followed to its stream, an http:// one plays on an https:// page,
# and what's on now (Icecast and Shoutcast say, in the stream) is kept, for
# the bar and the lock screen.
RADIO_FILE = DATA / "radio-stations.json"
RADIO_MAX = 300
RADIO_FILE_TYPES = (".m3u", ".m3u8", ".pls", ".strm", ".txt")
RADIO_PLAYLIST_TYPES = ("audio/x-mpegurl", "audio/mpegurl", "application/x-mpegurl", "audio/x-scpls", "application/pls+xml", "text/plain")
RADIO_HLS_TYPES = ("application/vnd.apple.mpegurl",)
_radio_lock = threading.Lock()
_radio_now = {}  # station id -> {"title", "at"}


def radio_stations():
    try:
        data = json.loads(RADIO_FILE.read_text())
    except (OSError, ValueError):
        return []
    items = data.get("stations") if isinstance(data, dict) else None
    return [x for x in items or [] if isinstance(x, dict) and x.get("id") and x.get("url")]


def radio_save(stations):
    write_private(RADIO_FILE, json.dumps({"stations": stations[:RADIO_MAX]}, indent=1))


def radio_url(url):
    """An address a station can be at (http or https, a host), or None."""
    url = (url or "").strip().split()[0] if (url or "").strip() else ""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return None
    return url if parts.scheme in ("http", "https") and parts.hostname and len(url) <= 2000 else None


def radio_parse(text, name=""):
    """A station file's stations: [(name, url)]. An .m3u's #EXTINF titles
    them; a .pls its TitleN; otherwise (.strm, a bare address) the file's
    name does. An HLS stream's own playlist (#EXT-X-…) isn't a list of
    stations: its address is the station."""
    base = re.sub(r"[_]+", " ", Path(name).stem).strip() if name else ""
    if "#EXT-X-TARGETDURATION" in text or "#EXT-X-STREAM-INF" in text:
        raise ValueError("that's an HLS stream's own playlist, not a station's: add its web address instead")
    out = []
    if re.search(r"^\s*\[playlist\]", text, re.I | re.M) or re.search(r"^\s*File\d+\s*=", text, re.I | re.M):
        files, titles = {}, {}
        for line in text.splitlines():
            m = re.match(r"\s*(File|Title)(\d+)\s*=\s*(.*)", line, re.I)
            if m:
                (files if m.group(1).lower() == "file" else titles)[int(m.group(2))] = m.group(3).strip()
        for n in sorted(files):
            url = radio_url(files[n])
            if url:
                out.append((titles.get(n) or base, url))
        return out
    title = None
    for line in text.splitlines():
        line = line.strip().lstrip("﻿")
        if line.upper().startswith("#EXTINF"):
            title = line.split(",", 1)[1].strip() if "," in line else None
            continue
        if not line or line.startswith("#"):
            continue
        url = radio_url(line)
        if url:
            out.append((title or base, url))
        title = None
    return out


def radio_add(found):
    """New stations (name, url) after the ones there (one address only once):
    the ones added, and how many were there already."""
    with _radio_lock:
        stations = radio_stations()
        have = {x["url"] for x in stations}
        added = []
        for name, url in found:
            if url in have or len(stations) >= RADIO_MAX:
                continue
            host = urllib.parse.urlsplit(url).hostname or "A station"
            st = {"id": secrets.token_hex(6), "name": (name or host).strip()[:80] or host, "url": url, "added": int(time.time())}
            stations.append(st)
            added.append(st)
            have.add(url)
        radio_save(stations)
    return added, len(found) - len(added)


def radio_open(url, depth=0):
    """The station's stream, opened: (response, its address). A playlist
    address (.m3u, .pls) is read and its first station followed, three deep
    at most; an HLS one is said to be (the browser plays those itself)."""
    request = urllib.request.Request(url, headers={"User-Agent": "adlerOS radio", "Icy-MetaData": "1", "Accept": "*/*"})
    r = urllib.request.urlopen(request, timeout=20)
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    path = urllib.parse.urlsplit(r.geturl()).path.lower()
    if ctype in RADIO_HLS_TYPES or path.endswith(".m3u8") and ctype not in ("audio/mpeg", "audio/aac", "audio/aacp", "audio/ogg"):
        head = r.read(65536).decode("utf-8", "replace")
        if "#EXT-X-" in head or ctype in RADIO_HLS_TYPES:
            r.close()
            raise LookupError(r.geturl())
        r.close()
        return radio_follow(head, r.geturl(), depth)
    if ctype in RADIO_PLAYLIST_TYPES or path.endswith((".m3u", ".pls")):
        head = r.read(65536).decode("utf-8", "replace")
        r.close()
        return radio_follow(head, r.geturl(), depth)
    return r, r.geturl()


def radio_follow(text, at, depth):
    found = []
    try:
        found = radio_parse(text)
    except ValueError:
        raise LookupError(at)
    if not found or depth >= 3:
        raise OSError("the station's playlist names no stream")
    return radio_open(urllib.parse.urljoin(at, found[0][1]), depth + 1)


def radio_title(meta):
    """StreamTitle='Artist - Song'; from an ICY metadata block."""
    m = re.search(rb"StreamTitle='(.*?)';", meta, re.S)
    if not m:
        return None
    raw = m.group(1)
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc).strip()[:200]
        except UnicodeDecodeError:
            continue
    return None


# ------------------------------------------------------------------ music

# Music: MUSIC_DIR in your storage (Media/Music if it isn't set). Its songs'
# tags are read once and kept (data/music.json, by each file's size and
# time), and looked over again (only what changed) when Music asks and it's
# been a minute. Playlists are its .m3u8 (.m3u) files, as spotdl and other
# players write them; plays are counted in data/music-plays.json, and
# favorites kept in data/music-favorites.json (with Navidrome: its stars).
MUSIC_SUFFIXES = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".m4b", ".wav"}
PLAYLIST_SUFFIXES = {".m3u8", ".m3u"}
MUSIC_CACHE = DATA / "music.json"
MUSIC_PLAYS = DATA / "music-plays.json"
MUSIC_FRESH = 300  # seconds a look round is good for
_music = {"songs": None, "playlists": [], "dir": None, "top": None, "at": 0, "scanning": False, "done": 0, "total": 0,
          "tags": None}  # tags: music.json's, kept from the last look
_music_lock = threading.Lock()
_plays_lock = threading.Lock()


def music_dir():
    """(MUSIC_DIR as adlerOS writes it, its real folder or None)."""
    rel = install_setting("MUSIC_DIR", "Media/Music").strip("/")
    place, real = locate(f"/user/{rel}")
    if not real or not real.is_dir():
        return f"/user/{rel}", None
    return place_path(place, real), real


def music_song(rel, tags, mtime, lrc):
    """A song as Music shows it: its tags, else what its name and folder say
    ("Artist - Title", as spotdl and yt-dlp name them)."""
    stem = posixpath.splitext(posixpath.basename(rel))[0]
    folder = posixpath.basename(posixpath.dirname(rel))
    title, artists = tags.get("title"), tags.get("artists") or []
    if not title or not artists:
        a, sep, t = stem.partition(" - ")
        if sep and t.strip() and a.strip():
            title = title or t.strip()
            artists = artists or [x.strip() for x in a.split(",") if x.strip()]
    song = {"id": rel, "title": title or stem, "artists": artists, "album": tags.get("album") or folder or "",
            "albumArtist": tags.get("albumArtist") or (artists[0] if artists else ""), "added": int(mtime)}
    for key in ("track", "disc", "year", "genre", "duration"):
        if tags.get(key):
            song[key] = tags[key]
    if tags.get("cover"):
        song["cover"] = True
    if lrc or tags.get("lyrics"):
        song["lyrics"] = True
    return song


def music_scan():
    try:
        os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 15)
    except (OSError, AttributeError):
        pass
    try:
        virtual, top = music_dir()
        songs, lists = [], []
        if top:
            cache = _music["tags"]
            if not cache:
                try:
                    cache = json.loads(MUSIC_CACHE.read_text())
                except (OSError, ValueError):
                    cache = {}
            old = cache.get("songs", {}) if isinstance(cache, dict) and cache.get("top") == str(top) else {}
            found = []
            for dirpath, dirnames, filenames in os.walk(top):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d != TRASH)
                names = set(filenames)
                for name in sorted(filenames):
                    suffix = os.path.splitext(name)[1].lower()
                    if name.startswith("."):
                        continue
                    if suffix in MUSIC_SUFFIXES:
                        found.append((Path(dirpath) / name, names))
                    elif suffix in PLAYLIST_SUFFIXES:
                        lists.append(Path(dirpath) / name)
            with _music_lock:
                _music.update(total=len(found), done=0)
            new = {}
            for k, (real, names) in enumerate(found):
                try:
                    st = real.stat()
                except OSError:
                    continue
                rel = real.relative_to(top).as_posix()
                hit = old.get(rel)
                if hit and hit.get("s") == st.st_size and hit.get("m") == st.st_mtime:
                    tags = hit.get("t") or {}
                else:
                    tags = musictags.read_tags(real)
                new[rel] = {"s": st.st_size, "m": st.st_mtime, "t": tags}
                stem = os.path.splitext(real.name)[0]
                songs.append(music_song(rel, tags, st.st_mtime, f"{stem}.lrc" in names or f"{stem}.LRC" in names))
                if k % 25 == 0:
                    with _music_lock:
                        _music["done"] = k
            if new != old:
                write_private(MUSIC_CACHE, json.dumps({"top": str(top), "songs": new}, separators=(",", ":")))
            with _music_lock:
                _music["tags"] = {"top": str(top), "songs": new}
        known = {s["id"] for s in songs}
        playlists = [p for p in (music_playlist(real, top, known) for real in lists) if p]
        with _music_lock:
            _music.update(songs=songs, playlists=playlists, dir=virtual, top=str(top) if top else None,
                          at=time.time(), scanning=False, done=len(songs))
    except Exception as e:  # a bad file never stops the server
        print(f"music: couldn't look round ({e})", file=sys.stderr, flush=True)
        with _music_lock:
            _music.update(scanning=False, at=time.time(), songs=_music["songs"] or [])


def music_library():
    """The songs (looked over again if it's been a while), or how far the
    first look round has got."""
    with _music_lock:
        stale = time.time() - _music["at"] > MUSIC_FRESH or _music["dir"] != music_dir()[0]
        if stale and not _music["scanning"]:
            _music["scanning"] = True
            threading.Thread(target=music_scan, name="music", daemon=True).start()
        return dict(_music)


def music_item(item):
    """(real file, id) for a song: an id in the library (its path in
    MUSIC_DIR) or a file anywhere in your places ("/user/…")."""
    if not isinstance(item, str) or not item or len(item) > 4096:
        return None, None
    if item.startswith("/"):
        place, real = locate(item)
        if not real or not real.is_file():
            return None, None
        _, top = music_dir()
        if top and real.is_relative_to(top.resolve()):
            return real, real.relative_to(top.resolve()).as_posix()
        return real, place_path(place, real)
    _, top = music_dir()
    if not top:
        return None, None
    place, real = locate(f"{music_dir()[0]}/{item}")
    return (real, item) if real and real.is_file() else (None, None)


def music_track(item):
    """A song's tags, read now: one that isn't in the library."""
    real, sid = music_item(item)
    if not real or real.suffix.lower() not in MUSIC_SUFFIXES:
        return None
    st = real.stat()
    song = music_song(sid if not sid.startswith("/") else sid.lstrip("/"), musictags.read_tags(real), st.st_mtime,
                      real.with_suffix(".lrc").exists())
    song["id"] = sid
    return song


def music_playlist(real, top, known=None):
    """A .m3u8/.m3u: its name and its songs (ids; a file outside the
    library as /user/…). Lines that lead nowhere are left out (counted)."""
    try:
        text = real.read_bytes().decode("utf-8-sig" if real.suffix.lower() == ".m3u8" else "utf-8", "replace")
        st = real.stat()
    except OSError:
        return None
    host = os.environ.get("ADLEROS_HOST_STORAGE", "").rstrip("/")
    top_s = str(top.resolve()) + "/" if top else None
    here = os.path.normpath(str(real.parent))
    items, missing = [], 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if re.match(r"^[a-z][a-z0-9+.-]*://", line, re.I):
            missing += 1  # a stream: not a file
            continue
        line = line.replace("\\", "/")
        if host and line.startswith(host + "/"):
            target = os.path.join(str(PLACES["user"]), line[len(host) + 1:])
        elif line.startswith("/"):
            _, found = locate(line)
            target = str(found) if found else line
        else:
            target = os.path.join(here, line)  # beside it (the usual): worked out, not looked up
        target = os.path.normpath(target)
        if top_s and target.startswith(top_s):
            sid = target[len(top_s):]
            if known is not None and sid not in known:
                missing += 1
                continue
            items.append(sid)
            continue
        try:
            found = Path(target).resolve()
        except OSError:
            missing += 1
            continue
        if top_s and str(found).startswith(top_s):
            items.append(str(found)[len(top_s):])
            continue
        place = next((p for p in PLACES if place_on(p) and found.is_relative_to(PLACES[p].resolve())), None)
        if place and found.is_file() and found.suffix.lower() in MUSIC_SUFFIXES:
            items.append(place_path(place, found))
        else:
            missing += 1
    where = real.relative_to(top).as_posix() if top and real.is_relative_to(top) else None
    place = next((p for p in PLACES if place_on(p) and real.resolve().is_relative_to(PLACES[p].resolve())), None)
    return {"id": where or (place_path(place, real.resolve()) if place else real.name), "name": real.stem,
            "path": place_path(place, real.resolve()) if place else None, "items": items, "missing": missing,
            "mtime": st.st_mtime, "writable": place in WRITABLE}


def write_playlist(real, items, songs):
    """items (ids) as an .m3u8 there: paths from its folder, as players read them."""
    _, top = music_dir()
    lines = ["#EXTM3U"]
    for item in items:
        target, sid = music_item(item)
        if not target:
            continue
        song = songs.get(sid) or {}
        who = ", ".join(song.get("artists") or [])
        lines.append(f"#EXTINF:{int(song.get('duration') or -1)},{who + ' - ' if who else ''}{song.get('title') or target.stem}")
        lines.append(os.path.relpath(target, real.parent).replace(os.sep, "/"))
    tmp = real.with_name(f".{real.name}.{secrets.token_hex(4)}.saving")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if real.exists():
        os.chmod(tmp, real.stat().st_mode & 0o7777)
    os.replace(tmp, real)


def music_plays():
    try:
        data = json.loads(MUSIC_PLAYS.read_text())
    except (OSError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


def music_played(sid):
    """One more play: counted, and first in what you played lately."""
    with _plays_lock:
        data = music_plays()
        counts = data.get("counts") if isinstance(data.get("counts"), dict) else {}
        counts[sid] = int(counts.get(sid, 0)) + 1
        recent = [r for r in data.get("recent", []) if r != sid][:299]
        write_private(MUSIC_PLAYS, json.dumps({"counts": counts, "recent": [sid, *recent],
                                               "last": {**(data.get("last") or {}), sid: int(time.time())}}))


# Navidrome (same music folder): what Music plays shows up there too, now
# playing and then played, and favorites are its stars, if NAVIDROME_USER
# and NAVIDROME_PASSWORD are set.
# It's reached at NAVIDROME_URL, else at this machine's Tailscale address
# (TS_IP, ADLEROS_HOST) and Navidrome's port.
_navidrome_ids = {}  # a song's id here (its path in MUSIC_DIR) -> Navidrome's


def navidrome():
    user, password = install_setting("NAVIDROME_USER"), install_setting("NAVIDROME_PASSWORD")
    if not user or not password:
        return None
    url = install_setting("NAVIDROME_URL").rstrip("/")
    if not url:
        host = install_setting("TS_IP") if HOMELAB_MODE else install_setting("ADLEROS_HOST")
        app = next((a for a in installed_apps() if a["id"] == "navidrome"), None)
        if not host or not app or not app.get("port"):
            return None
        url = f"http://{host}:{app['port']}"
    return url, user, password


def navidrome_call(cfg, view, **params):
    url, user, password = cfg
    salt = secrets.token_hex(6)  # Subsonic's token login: the password itself never goes
    query = urllib.parse.urlencode({"u": user, "t": hashlib.md5((password + salt).encode()).hexdigest(), "s": salt,
                                    "v": "1.16.1", "c": "adlerOS", "f": "json", **params})
    with urllib.request.urlopen(f"{url}/rest/{view}?{query}", timeout=8) as r:
        reply = json.loads(r.read()).get("subsonic-response", {})
    if reply.get("status") != "ok":
        raise ValueError((reply.get("error") or {}).get("message", "it said no"))
    return reply


def navidrome_id(cfg, sid, song):
    """Navidrome's id for a song: the one with the same path, else the same
    title, artist and length."""
    if sid in _navidrome_ids:
        return _navidrome_ids[sid]
    found = navidrome_call(cfg, "search3.view", query=song["title"], songCount=60, artistCount=0, albumCount=0)
    hits = (found.get("searchResult3") or {}).get("song") or []
    norm = lambda t: str(t or "").casefold().strip()  # noqa: E731
    match = next((h for h in hits if h.get("path") == sid or str(h.get("path", "")).endswith(f"/{sid}")), None)
    if not match:
        match = next((h for h in hits if norm(h.get("title")) == norm(song["title"])
                      and any(norm(a) in norm(h.get("artist")) for a in song.get("artists") or [""])
                      and abs((h.get("duration") or 0) - (song.get("duration") or 0)) <= 3), None)
    _navidrome_ids[sid] = match["id"] if match else None
    return _navidrome_ids[sid]


def navidrome_scrobble(sid, played):
    """Now playing (played=False), or played: to Navidrome, in the background."""
    cfg = navidrome()
    if not cfg or sid.startswith("/"):
        return  # not set up, or a song from outside the library (not Navidrome's)
    song = next((x for x in _music["songs"] or [] if x["id"] == sid), None)
    if not song:
        return

    def send():
        try:
            nid = navidrome_id(cfg, sid, song)
            if nid:
                navidrome_call(cfg, "scrobble.view", id=nid, submission="true" if played else "false", time=int(time.time() * 1000))
        except (OSError, ValueError, urllib.error.URLError) as e:
            print(f"music: Navidrome didn't take {sid} ({e})", file=sys.stderr, flush=True)
    threading.Thread(target=send, name="navidrome", daemon=True).start()


def navidrome_matcher(songs):
    """match(a song as Navidrome tells it) -> the same song's id here, or
    None. Navidrome makes up a path (artist/album/track - title) unless its
    player has Report Real Path on, so: the path, if it's a real one; else
    the file's name; else the title (the album and artists deciding between
    copies); else a title one of them says more of ("… (Live)") by the same
    artist. Always about as long (3 s either way)."""
    norm = lambda t: str(t or "").casefold().strip()  # noqa: E731
    known = {s["id"]: s for s in songs}
    by_name, by_title, by_length = {}, {}, {}
    for s in songs:
        by_name.setdefault(norm(posixpath.basename(s["id"])), []).append(s)
        by_title.setdefault(norm(s["title"]), []).append(s)
        by_length.setdefault(round(s.get("duration") or 0), []).append(s)

    def close(s, h):
        return not s.get("duration") or not h.get("duration") or abs(s["duration"] - h["duration"]) <= 3

    def artists(h):
        return ({norm(a.get("name")) for a in h.get("artists") or [] if isinstance(a, dict)}
                or {norm(a) for a in re.split(r"\s*[/,;&]\s*", h.get("artist") or "") if a})

    def best(candidates, h):
        theirs = artists(h)

        def score(s):
            mine = {norm(a) for a in s["artists"]}
            return (2 * (norm(s["album"]) == norm(h.get("album"))) + len(mine & theirs) / max(1, len(mine | theirs))
                    - abs((s.get("duration") or 0) - (h.get("duration") or 0)) / 10)
        candidates = [s for s in candidates if close(s, h)]
        return max(candidates, key=score)["id"] if candidates else None

    def match(h):
        parts = str(h.get("path") or "").split("/")
        for k in range(len(parts)):
            s = known.get("/".join(parts[k:]))
            if s and close(s, h):
                return s["id"]
        found = best(by_name.get(norm(parts[-1]), []), h) or best(by_title.get(norm(h.get("title")), []), h)
        if found:
            return found
        title, theirs = norm(h.get("title")), artists(h)
        near = [s for d in range(-3, 4) for s in by_length.get(round(h.get("duration") or 0) + d, [])
                if title and norm(s["title"]) and (norm(s["title"]).startswith(title) or title.startswith(norm(s["title"])))
                and {norm(a) for a in s["artists"]} & theirs]
        return best(near, h)
    return match


def navidrome_songs(cfg):
    """Every song Navidrome has: an empty search finds them all, 500 at a time."""
    songs = []
    while True:
        page = ((navidrome_call(cfg, "search3.view", query="", songCount=500, songOffset=len(songs), artistCount=0, albumCount=0)
                 .get("searchResult3") or {}).get("song") or [])
        songs += page
        if len(page) < 500 or len(songs) >= 200_000:
            return songs


# Favorites: the songs you've hearted (data/music-favorites.json, id -> when).
# With Navidrome they're its stars, both ways: one starred in its app or on
# your phone is a favorite here, and a heart here stars it there. The file
# also keeps which ones Navidrome had starred last time ("navidrome"), so a
# change made on one side since then is told apart from one the other side
# hasn't heard of yet: a star gone from Navidrome was taken off there, one
# Navidrome never had is a heart made here while it wasn't answering.
MUSIC_FAVORITES = DATA / "music-favorites.json"
NAVIDROME_FRESH = 30  # seconds Navidrome's stars are good for (its plays: MUSIC_FRESH)
_favorites_lock = threading.Lock()
_navidrome = {"at": 0, "listed": 0, "status": None, "plays": {}, "starred": {}}  # starred: id here -> Navidrome's ids
_navidrome_lock = threading.Lock()  # one look at Navidrome at a time


def music_favorites():
    try:
        data = json.loads(MUSIC_FAVORITES.read_text())
    except (OSError, ValueError):
        data = {}
    data = data if isinstance(data, dict) else {}
    songs = data.get("songs") if isinstance(data.get("songs"), dict) else {}
    seen = data.get("navidrome") if isinstance(data.get("navidrome"), list) else []
    return {"songs": {k: int(v) for k, v in songs.items() if isinstance(v, (int, float))},
            "navidrome": [s for s in seen if isinstance(s, str)]}


def save_favorites(fav):
    write_private(MUSIC_FAVORITES, json.dumps(fav, separators=(",", ":")))


def navidrome_seen(sid, starred):
    """Navidrome has that song starred now (or not): remembered for next time."""
    with _favorites_lock:
        fav = music_favorites()
        seen = set(fav["navidrome"])
        (seen.add if starred else seen.discard)(sid)
        fav["navidrome"] = sorted(seen)
        save_favorites(fav)


def music_favorite(sid, on):
    """A heart put on a song (or taken off): kept, and starred (or not) in
    Navidrome too, in the background."""
    with _favorites_lock:
        fav = music_favorites()
        if on:
            fav["songs"].setdefault(sid, int(time.time()))
        else:
            fav["songs"].pop(sid, None)
        save_favorites(fav)
    cfg = navidrome()
    song = next((x for x in _music["songs"] or [] if x["id"] == sid), None)
    if not cfg or not song:
        return

    def send():
        try:
            # Taken off: every copy Navidrome has starred, or it'd be back next time.
            nids = (None if on else _navidrome["starred"].get(sid)) or [navidrome_id(cfg, sid, song)]
            if not all(nids):
                return  # a song Navidrome doesn't have
            for nid in nids:
                navidrome_call(cfg, "star.view" if on else "unstar.view", id=nid)
            if on:
                _navidrome["starred"][sid] = nids
            else:
                _navidrome["starred"].pop(sid, None)
            navidrome_seen(sid, on)
        except (OSError, ValueError, urllib.error.URLError) as e:
            print(f"music: Navidrome didn't take the star on {sid} ({e})", file=sys.stderr, flush=True)
    threading.Thread(target=send, name="navidrome", daemon=True).start()


def navidrome_sync():
    """Navidrome's stars and plays, brought here: {configured, ok, url, error}.
    Stars put on or taken off on either side since last time go to the
    other. Plays (every song's, every few minutes) are counted as Navidrome
    counts them: its apps', your phone's, and Music's own, which go there."""
    cfg = navidrome()
    if not cfg:
        return {"configured": False}
    with _navidrome_lock:
        if _navidrome["status"] and time.time() - _navidrome["at"] < NAVIDROME_FRESH:
            return _navidrome["status"]
        songs = _music["songs"]
        try:
            if not songs:
                navidrome_call(cfg, "ping.view")  # nothing to match yet (the first look round)
            else:
                navidrome_bring(cfg, songs)
            status = {"configured": True, "ok": True, "url": cfg[0]}
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as e:
            status = {"configured": True, "ok": False, "url": cfg[0], "error": str(e)}
        _navidrome.update(at=time.time(), status=status)
        return status


def navidrome_bring(cfg, songs):
    match = navidrome_matcher(songs)
    if time.time() - _navidrome["listed"] > MUSIC_FRESH:
        ids = dict.fromkeys((s["id"] for s in songs), None)  # None: not Navidrome's, no need to look again
        plays = {}
        for h in navidrome_songs(cfg):
            sid = match(h)
            if sid:
                ids[sid] = ids[sid] or h["id"]
                plays[sid] = plays.get(sid, 0) + int(h.get("playCount") or 0)  # copies of one song: all its plays
        _navidrome_ids.clear()
        _navidrome_ids.update(ids)
        _navidrome.update(listed=time.time(), plays={k: n for k, n in plays.items() if n})
    starred, when = {}, {}
    for h in (navidrome_call(cfg, "getStarred2.view").get("starred2") or {}).get("song") or []:
        sid = match(h)
        if not sid:
            continue
        starred.setdefault(sid, []).append(h["id"])
        try:
            when[sid] = calendar.timegm(time.strptime(str(h.get("starred"))[:19], "%Y-%m-%dT%H:%M:%S"))
        except ValueError:
            when[sid] = int(time.time())
    with _favorites_lock:
        fav = music_favorites()
        mine, seen = fav["songs"], set(fav["navidrome"])
        for sid in starred.keys() - seen:  # starred there since
            mine.setdefault(sid, when[sid])
        for sid in seen - starred.keys():  # taken off there since
            mine.pop(sid, None)
        save_favorites(fav)
        star = [sid for sid in mine if sid not in starred]  # hearted here, not there yet
        unstar = [sid for sid in starred if sid not in mine]  # taken off here, not there yet
    _navidrome["starred"] = starred  # a heart meanwhile changes it too
    by_id = {s["id"]: s for s in songs}
    for sid in star:
        nid = navidrome_id(cfg, sid, by_id[sid]) if sid in by_id else None
        if nid:
            navidrome_call(cfg, "star.view", id=nid)
            starred[sid] = [nid]
    for sid in unstar:
        for nid in starred.get(sid, []):
            navidrome_call(cfg, "unstar.view", id=nid)
        starred.pop(sid, None)
    # Stopped half way (Navidrome went), the next look sorts it out: what's
    # starred there and not remembered counts as starred there.
    with _favorites_lock:
        fav = music_favorites()
        fav["navidrome"] = sorted(starred)
        save_favorites(fav)


def music_counts(plays):
    """Each song's plays: Music's own, or Navidrome's where it has more."""
    counts = dict(plays.get("counts") or {})
    for sid, n in _navidrome["plays"].items():
        if n > counts.get(sid, 0):
            counts[sid] = n
    return counts


def music_cover(real):
    """(mime, bytes): the song's own picture, else its folder's (cover.jpg…)."""
    found = musictags.read_cover(real)
    if found:
        return found
    try:
        for child in real.parent.iterdir():
            if child.stem.lower() in musictags.COVER_NAMES and child.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                return INLINE_TYPES[child.suffix.lower()], child.read_bytes()
    except OSError:
        pass
    return None


def music_lyrics(real):
    """{"text", "synced"}: the .lrc beside it, else the song's own."""
    for lrc in (real.with_suffix(".lrc"), real.with_suffix(".LRC")):
        try:
            raw = lrc.read_bytes()[:512 * 1024]
        except OSError:
            continue
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("latin1")
        break
    else:
        text = musictags.read_lyrics(real)
    if not text or not text.strip():
        return None
    return {"text": text, "synced": bool(re.search(r"^\s*\[\d+:\d+(?:[.:]\d+)?\]", text, re.M))}


# ---------------------------------------------------------------- gallery

# Gallery: your photos as Immich has them (the timeline, albums, people,
# places, the map, favorites, memories), through Immich's API with
# IMMICH_API_KEY; one that may only read is enough (asset.read, asset.view,
# asset.download, album.read, person.read, memory.read for On this day,
# face.read for who's where in a photo, map.read for the map). The page never
# sees the key, nor Immich's address: adlerOS asks, and passes on what
# Immich says, pictures and videos too. Immich is at IMMICH_URL, else at
# this machine's Tailscale address (TS_IP, ADLEROS_HOST) and its port.
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
GALLERY_PERMISSIONS = ("asset.read", "asset.view", "asset.download", "album.read", "person.read", "memory.read", "face.read", "map.read")


def immich():
    """(url, key), or (url or None, None) when there's no key."""
    url = install_setting("IMMICH_URL").rstrip("/")
    if not url:
        host = install_setting("TS_IP") if HOMELAB_MODE else install_setting("ADLEROS_HOST")
        app = next((a for a in installed_apps() if a["id"] == "immich"), None)
        url = f"http://{host}:{app['port']}" if host and app and app.get("port") else None
    return url, install_setting("IMMICH_API_KEY") or None


def immich_open(path, query=None, body=None, method="GET", headers=None, timeout=20):
    url, key = immich()
    if not url or not key:
        raise LookupError("not set up")
    full = f"{url}/api/{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(full, data=data, method=method, headers={
        "x-api-key": key, "Accept": "application/json", **({"Content-Type": "application/json"} if data else {}), **(headers or {})})
    return urllib.request.urlopen(request, timeout=timeout)


def immich_json(path, query=None, body=None, method="GET"):
    with immich_open(path, query, body, method) as r:
        return json.loads(r.read())


def gallery_query(query, keys):
    """Only these of the page's query, each as Immich wants it."""
    out = {}
    for k in keys:
        v = query.get(k, [None])[0]
        if v is None or v == "":
            continue
        if k in ("albumId", "personId", "id") and not UUID_RE.match(v):
            raise ValueError(f"{k}: not an id")
        if k in ("isFavorite", "withHidden") and v not in ("true", "false"):
            raise ValueError(f"{k}: true or false")
        if k == "order" and v not in ("asc", "desc"):
            raise ValueError("order: asc or desc")
        if k == "visibility" and v not in ("timeline", "archive"):
            raise ValueError("visibility: timeline or archive")
        if k == "timeBucket" and not re.match(r"^\d{4}-\d{2}-\d{2}[T0-9:.Z+-]*$", v):
            raise ValueError("timeBucket: a date")
        if k == "size" and v not in ("thumbnail", "preview", "fullsize"):
            raise ValueError("size: thumbnail, preview or fullsize")
        out[k] = v
    return out


def gallery_status():
    """Whether Gallery can see your photos, and if not, why."""
    url, key = immich()
    out = {"url": url, "configured": bool(url and key), "permissions": list(GALLERY_PERMISSIONS)}
    if not url:
        return {**out, "error": "noimmich"}
    if not key:
        return {**out, "error": "nokey"}
    try:
        with urllib.request.urlopen(f"{url}/api/server/version", timeout=6) as r:
            v = json.loads(r.read())
        out["version"] = f"{v.get('major')}.{v.get('minor')}.{v.get('patch')}"
        me = immich_json("api-keys/me")
        has = set(me.get("permissions") or [])
        out["missing"] = [] if "all" in has else [p for p in GALLERY_PERMISSIONS if p not in has]
        out["ok"] = True
    except urllib.error.HTTPError as e:
        out["error"] = "refused" if e.code in (401, 403) else f"immich {e.code}"
    except (OSError, ValueError) as e:
        out["error"] = f"unreachable ({e})"
    return out


def gallery_asset_lite(a):
    """A search hit as the timeline has them (what a grid needs)."""
    exif = a.get("exifInfo") or {}
    w, h = a.get("width") or exif.get("exifImageWidth"), a.get("height") or exif.get("exifImageHeight")
    if exif.get("orientation") in ("5", "6", "7", "8") and w and h:
        w, h = h, w
    return {"id": a["id"], "isImage": a.get("type") == "IMAGE", "ratio": (w / h) if w and h else 1,
            "isFavorite": bool(a.get("isFavorite")), "fileCreatedAt": a.get("fileCreatedAt"),
            "localDateTime": a.get("localDateTime"), "duration": a.get("duration"),
            "livePhotoVideoId": a.get("livePhotoVideoId")}


# -------------------------------------------------------------- documents

# Documents: your papers as Paperless-ngx has them (titles, correspondents,
# types, tags, dates, the words it read in them), through its API with
# PAPERLESS_TOKEN (Paperless: My Profile, API Auth Token). The files in
# storage/Documents are only numbers (0000001.pdf): the rest is in
# Paperless's database. The page never sees the token. Paperless is at
# PAPERLESS_URL, else this machine's Tailscale address and its port.
PAPERLESS_ORDER = ("created", "-created", "added", "-added", "title", "-title", "correspondent__name", "-correspondent__name",
                   "archive_serial_number", "-archive_serial_number", "page_count", "-page_count")
PAPERLESS_LIST_FIELDS = "id,title,correspondent,document_type,tags,created,added,page_count,mime_type,archive_serial_number,original_file_name,notes"
UPLOAD_PAPERLESS_LIMIT = 200 * 1024 * 1024
_paperless = {"version": None}


def paperless():
    """(url, token), or (url or None, None) when there's no token."""
    url = install_setting("PAPERLESS_URL").rstrip("/")
    if not url:
        host = install_setting("TS_IP") if HOMELAB_MODE else install_setting("ADLEROS_HOST")
        app = next((a for a in installed_apps() if a["id"] in ("paperless-ngx", "paperless")), None)
        url = f"http://{host}:{app['port']}" if host and app and app.get("port") else None
    return url, install_setting("PAPERLESS_TOKEN") or None


def paperless_open(path, query=None, data=None, method="GET", headers=None, timeout=30):
    url, token = paperless()
    if not url or not token:
        raise LookupError("not set up")
    # The newest API it speaks (it says, once asked): without, Paperless answers as its first.
    accept = "application/json" + (f"; version={_paperless['version']}" if _paperless["version"] else "")
    request = urllib.request.Request(f"{url}/api/{path}" + (f"?{urllib.parse.urlencode(query, doseq=True)}" if query else ""),
                                     data=data, method=method, headers={"Authorization": f"Token {token}", "Accept": accept, **(headers or {})})
    r = urllib.request.urlopen(request, timeout=timeout)
    if not _paperless["version"] and (r.headers.get("X-Api-Version") or "").isdigit():
        _paperless["version"] = r.headers["X-Api-Version"]
    return r


def paperless_json(path, query=None, body=None, method="GET"):
    data = json.dumps(body).encode() if body is not None else None
    with paperless_open(path, query, data, method, {"Content-Type": "application/json"} if data else None) as r:
        return json.loads(r.read())


def paperless_all(path):
    """Every one of a list (tags, correspondents…), page by page."""
    out, page = [], 1
    while page <= 50:
        got = paperless_json(path, {"page": page, "page_size": 250})
        out += got.get("results") or []
        if not got.get("next"):
            break
        page += 1
    return out


def documents_status():
    url, token = paperless()
    out = {"url": url, "configured": bool(url and token)}
    if not url:
        return {**out, "error": "nopaperless"}
    if not token:
        return {**out, "error": "notoken"}
    try:
        got = paperless_json("documents/", {"page_size": 1, "fields": "id"})
        out.update(ok=True, count=got.get("count", 0), version=_paperless["version"])
    except urllib.error.HTTPError as e:
        out["error"] = "refused" if e.code in (401, 403) else f"paperless {e.code}"
    except (OSError, ValueError) as e:
        out["error"] = f"unreachable ({e})"
    return out


def documents_query(query):
    """Only these of the page's query, each as Paperless wants it."""
    out = {"fields": PAPERLESS_LIST_FIELDS, "truncate_content": "true"}
    for k in ("page", "page_size", "ordering", "query", "title_content", "tags__id__all", "tags__id__in", "correspondent__id",
              "document_type__id", "is_in_inbox", "created__date__gte", "created__date__lte"):
        v = query.get(k, [None])[0]
        if v is None or v == "":
            continue
        if k in ("page", "page_size", "correspondent__id", "document_type__id") and not (v.isdigit() and 0 < int(v) <= (100 if k == "page_size" else 10 ** 9)):
            raise ValueError(f"{k}: a number")
        if k in ("tags__id__all", "tags__id__in") and not re.fullmatch(r"\d+(,\d+){0,30}", v):
            raise ValueError(f"{k}: numbers")
        if k == "ordering" and v not in PAPERLESS_ORDER:
            raise ValueError("ordering: not one Documents knows")
        if k == "is_in_inbox" and v not in ("true", "false"):
            raise ValueError("is_in_inbox: true or false")
        if k.startswith("created__") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError(f"{k}: a date")
        if k in ("query", "title_content") and len(v) > 300:
            raise ValueError(f"{k}: too long")
        out[k] = v
    if "query" in out:
        out.pop("fields")  # a search's hits come with Paperless's own (where it matched)
    return out


# --------------------------------------------------------------- calendar

# Calendar: your calendars as your CalDAV server has them (Radicale, in a
# homelab), read and written: CALDAV_USER and CALDAV_PASSWORD, at CALDAV_URL, else
# Radicale at this machine's Tailscale address and its port. Found the way
# CalDAV says (the address's principal, its calendar home, the calendars in
# it); each calendar's events kept until its ctag (or sync token) changes,
# looked at again at most every CALDAV_FRESH seconds. The page never sees
# the password; it asks for days, in its own time zone, and gets each
# repeat worked out (ical.py). A change (calendar_write) is made to the
# item as the server has it now, sent only if nobody changed it meanwhile
# (If-Match), everything in it you didn't change kept as it was.
DAV = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav", "cs": "http://calendarserver.org/ns/", "i": "http://apple.com/ns/ical/"}
CALDAV_FRESH = 30
CALDAV_MAX_DAYS = 430
_caldav = {"key": None, "home": None, "calendars": None, "at": 0, "events": {}}
_caldav_lock = threading.Lock()


def caldav():
    """(url, (user, password)), or (url or None, None) without a login."""
    url = install_setting("CALDAV_URL").rstrip("/")
    if not url:
        host = install_setting("TS_IP") if HOMELAB_MODE else install_setting("ADLEROS_HOST")
        app = next((a for a in installed_apps() if a["id"] == "radicale"), None)
        url = f"http://{host}:{app['port']}" if host and app and app.get("port") else None
    user, password = install_setting("CALDAV_USER"), install_setting("CALDAV_PASSWORD")
    return url, ((user, password) if user and password else None)


def dav(method, url, login, body=None, depth=None, timeout=20):
    """(the URL it answered at, its body). Redirects followed here (urllib
    won't, for PROPFIND), only on the same server: the login goes nowhere else."""
    headers = {"Authorization": "Basic " + base64.b64encode(f"{login[0]}:{login[1]}".encode()).decode(),
               "Content-Type": "application/xml; charset=utf-8"}
    if depth is not None:
        headers["Depth"] = depth
    origin = urllib.parse.urlsplit(url)
    for _ in range(5):
        request = urllib.request.Request(url, data=body.encode() if body else None, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as r:
                return r.geturl(), r.read(20 * 1024 * 1024)
        except urllib.error.HTTPError as e:
            target = e.headers.get("Location") if e.code in (301, 302, 303, 307, 308) else None
            if not target:
                raise
            nxt = urllib.parse.urlsplit(urllib.parse.urljoin(url, target))
            if nxt.hostname != origin.hostname or nxt.scheme not in (origin.scheme, "https"):
                raise
            url = nxt.geturl()
    raise OSError("too many redirects")


def dav_responses(data):
    """A multistatus: [(href, {tag: element})], each response's found props."""
    out = []
    for response in ElementTree.fromstring(data).findall("d:response", DAV):
        href = response.findtext("d:href", "", DAV).strip()
        found = {}
        for stat in response.findall("d:propstat", DAV):
            if " 200" not in (stat.findtext("d:status", "", DAV) or " 200"):
                continue
            for p in stat.find("d:prop", DAV) if stat.find("d:prop", DAV) is not None else []:
                found[p.tag] = p
        out.append((href, found))
    return out


def dav_href(element):
    return (element.findtext("d:href", "", DAV) if element is not None else "").strip()


def caldav_home(url, login):
    """Its calendar home: the principal's, found from the address (or from
    /.well-known/caldav, if the address isn't the server's DAV root)."""
    ask = ('<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>'
           '<d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>')
    for start in (url + "/", urllib.parse.urljoin(url + "/", "/.well-known/caldav")):
        try:
            at, data = dav("PROPFIND", start, login, ask, "0")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise
            continue
        found = (dav_responses(data) or [("", {})])[0][1]
        home = dav_href(found.get(f"{{{DAV['c']}}}calendar-home-set"))
        if home:
            return urllib.parse.urljoin(at, home)
        principal = dav_href(found.get(f"{{{DAV['d']}}}current-user-principal"))
        if principal:
            at, data = dav("PROPFIND", urllib.parse.urljoin(at, principal), login, ask, "0")
            home = dav_href((dav_responses(data) or [("", {})])[0][1].get(f"{{{DAV['c']}}}calendar-home-set"))
            if home:
                return urllib.parse.urljoin(at, home)
    raise LookupError("no calendars there")


def caldav_calendars(home, login):
    """The calendars in a home that hold events: [{id, href, name, color, tag}]."""
    ask = ('<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" '
           'xmlns:i="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><i:calendar-color/><i:calendar-order/>'
           '<c:supported-calendar-component-set/><cs:getctag/><d:sync-token/></d:prop></d:propfind>')
    at, data = dav("PROPFIND", home, login, ask, "1")
    out = []
    for href, found in dav_responses(data):
        kind = found.get(f"{{{DAV['d']}}}resourcetype")
        if kind is None or kind.find("c:calendar", DAV) is None:
            continue
        comps = found.get(f"{{{DAV['c']}}}supported-calendar-component-set")
        if comps is not None and len(comps) and not any(c.get("name", "").upper() == "VEVENT" for c in comps):
            continue  # tasks only (or journal): not Calendar's
        full = urllib.parse.urljoin(at, href)
        color = (found.get(f"{{{DAV['i']}}}calendar-color").text or "").strip() if f"{{{DAV['i']}}}calendar-color" in found else ""
        name = (found[f"{{{DAV['d']}}}displayname"].text or "").strip() if f"{{{DAV['d']}}}displayname" in found else ""
        tag = "".join((found[k].text or "") for k in (f"{{{DAV['cs']}}}getctag", f"{{{DAV['d']}}}sync-token") if k in found)
        order = (found[f"{{{DAV['i']}}}calendar-order"].text or "").strip() if f"{{{DAV['i']}}}calendar-order" in found else ""
        out.append({"id": hashlib.sha1(full.encode()).hexdigest()[:12], "href": full,
                    "name": name or urllib.parse.unquote(href.rstrip("/").rsplit("/", 1)[-1]),
                    "color": color if re.fullmatch(r"#[0-9a-fA-F]{3,8}", color) else "", "tag": tag,
                    "order": int(order) if order.lstrip("-").isdigit() else 10 ** 6})
    # In the order your calendar apps put them (calendar-order), else by name.
    return sorted(out, key=lambda c: (c["order"], c["name"].lower()))


def caldav_events(cal, login):
    """A calendar's items, from one REPORT: [{path, etag, events}], each
    event read (ical.events) and knowing its item's path."""
    ask = ('<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/>'
           '</d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>')
    at, data = dav("REPORT", cal["href"], login, ask, "1", timeout=60)
    items = []
    for href, found in dav_responses(data):
        item = found.get(f"{{{DAV['c']}}}calendar-data")
        if item is None or not item.text:
            continue
        path = urllib.parse.urlsplit(urllib.parse.urljoin(at, href)).path
        events = []
        for vcal in ical.parse(item.text):
            if vcal["name"] == "VCALENDAR":
                events += [{**e, "href": path} for e in ical.events(vcal)]
        items.append({"path": path, "events": events})
    return items


def calendar_state():
    """The calendars, their events up to date (asked again after
    CALDAV_FRESH seconds; a calendar's events only when its tag moved)."""
    url, login = caldav()
    if not url or not login:
        raise LookupError("not set up")
    with _caldav_lock:
        key = (url, login)
        if _caldav["key"] != key:
            _caldav.update(key=key, home=None, calendars=None, at=0, events={})
        if _caldav["calendars"] is None or time.time() - _caldav["at"] > CALDAV_FRESH:
            if not _caldav["home"]:
                _caldav["home"] = caldav_home(url, login)
            calendars = caldav_calendars(_caldav["home"], login)
            kept = {}
            for cal in calendars:
                old = _caldav["events"].get(cal["href"])
                kept[cal["href"]] = old if old and old[0] == cal["tag"] and cal["tag"] else (cal["tag"], caldav_events(cal, login))
            _caldav.update(calendars=calendars, events=kept, at=time.time())
        return _caldav["calendars"], _caldav["events"]


# Writing: one item (an .ics: an event, its moved or changed occurrences)
# fetched as it is now, changed, and put back if it hasn't changed since.
def dav_raw(method, url, login, body=None, headers=None, timeout=30):
    """(status, headers, body) of one request; an HTTPError as it comes."""
    h = {"Authorization": "Basic " + base64.b64encode(f"{login[0]}:{login[1]}".encode()).decode(), **(headers or {})}
    request = urllib.request.Request(url, data=body.encode() if isinstance(body, str) else body, method=method, headers=h)
    with urllib.request.urlopen(request, timeout=timeout) as r:
        return r.status, r.headers, r.read(5 * 1024 * 1024)


def calendar_fields(f, viewer):
    """What the page sent (an event's name, place, times…), checked."""
    if not isinstance(f, dict):
        raise ValueError("event: an object")
    out = {}
    for key, limit in (("title", 500), ("location", 500), ("notes", 20000)):
        if key in f:
            if not isinstance(f[key], str) or len(f[key]) > limit:
                raise ValueError(f"{key}: text, up to {limit}")
            out[key] = f[key]
    if "start" in f or "end" in f:
        all_day = bool(f.get("allDay"))
        try:
            if all_day:
                start, end = datetime.date.fromisoformat(f["start"]), datetime.date.fromisoformat(f["end"])
            else:
                start = datetime.datetime.fromisoformat(f["start"].replace("Z", "+00:00"))
                end = datetime.datetime.fromisoformat(f["end"].replace("Z", "+00:00"))
                if not start.tzinfo or not end.tzinfo:
                    raise ValueError
        except (KeyError, TypeError, ValueError):
            raise ValueError("start, end: dates (all day) or times with their zone")
        if end < start or (all_day and end == start):
            raise ValueError("it ends before it starts")
        out.update(allDay=all_day, start=start, end=end)
    if "travel" in f:
        if not isinstance(f["travel"], int) or not 0 <= f["travel"] <= 24 * 60:
            raise ValueError("travel: minutes, up to a day")
        out["travel"] = f["travel"]
    if "repeat" in f:
        if f["repeat"] is not None and not isinstance(f["repeat"], dict):
            raise ValueError("repeat: a rule, or none")
        out["repeat"] = f["repeat"]
    if "calendar" in f:
        out["calendar"] = str(f["calendar"])
    return out


def cal_master(vcal):
    events = [c for c in vcal["children"] if c["name"] == "VEVENT"]
    master = next((c for c in events if ical.prop(c, "RECURRENCE-ID")[1] is None), None)
    return master, events


def cal_start(comp, tzs):
    """A component's start, and its zone (None: floating or all day)."""
    start = ical.value_of(*ical.prop(comp, "DTSTART"), tzs)
    zone = start.tzinfo if isinstance(start, datetime.datetime) else None
    return start, zone


def cal_wall(value, zone, viewer):
    """A time as the event's clock shows it (floating: the viewer's), or a date."""
    if isinstance(value, datetime.datetime):
        if value.tzinfo is None:
            return value
        return value.astimezone(zone or viewer).replace(tzinfo=None)
    return value


def cal_aware(wall, zone, viewer):
    return wall.replace(tzinfo=zone or viewer) if isinstance(wall, datetime.datetime) else wall


def cal_encode(comp, name, wall, zone, all_day, floating=False):
    """NAME (DTSTART, DTEND, RECURRENCE-ID) set from an event-clock time or a date."""
    if all_day:
        params, value = ical.when_text(wall if not isinstance(wall, datetime.datetime) else wall.date(), None)
    elif floating:
        params, value = {}, wall.strftime("%Y%m%dT%H%M%S")
    else:
        params, value = ical.when_text(wall.replace(tzinfo=zone), zone)
    ical.put(comp, name, value, params)


def cal_until_text(day, zone, all_day, floating):
    """UNTIL for a last day: the date (all day), the end of that day."""
    if all_day:
        return day.strftime("%Y%m%d")
    end = datetime.datetime.combine(day, datetime.time(23, 59, 59))
    if floating:
        return end.strftime("%Y%m%dT%H%M%S")
    return end.replace(tzinfo=zone).astimezone(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def cal_rule(repeat, zone, all_day, floating):
    if repeat is None:
        return None
    rule = dict(repeat)
    if rule.get("until"):
        try:
            rule["untilText"] = cal_until_text(datetime.date.fromisoformat(rule["until"]), zone, all_day, floating)
        except (TypeError, ValueError):
            raise ValueError("repeat until: a day")
    return ical.rrule_text(rule)


def cal_stamp(comp, bump=True):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ical.put(comp, "DTSTAMP", now)
    ical.put(comp, "LAST-MODIFIED", now)
    if bump:
        seq = ical.prop(comp, "SEQUENCE")[1]
        ical.put(comp, "SEQUENCE", str(int(seq) + 1 if (seq or "").strip().isdigit() else 1))


def cal_text(comp, f):
    for key, name in (("title", "SUMMARY"), ("location", "LOCATION"), ("notes", "DESCRIPTION")):
        if key in f:
            if f[key].strip() or key == "title":
                ical.put(comp, name, ical.escape(f[key].strip() if key != "notes" else f[key]))
            else:
                ical.remove(comp, name)
    if "travel" in f:
        if f["travel"]:
            ical.put(comp, "X-APPLE-TRAVEL-DURATION", f"PT{f['travel']}M", {"VALUE": "DURATION"})
        else:
            ical.remove(comp, "X-APPLE-TRAVEL-DURATION", "X-APPLE-TRAVEL-START", "X-APPLE-TRAVEL-RETURN", "X-APPLE-TRAVEL-RETURN-DURATION")


def cal_zones_used(vcal):
    """Each TZID its events use has its VTIMEZONE (made from zoneinfo where it's missing)."""
    have = {ical.prop(c, "TZID")[1] for c in vcal["children"] if c["name"] == "VTIMEZONE"}
    used = {params.get("TZID") for c in vcal["children"] if c["name"] == "VEVENT" for _, params, _ in c["props"] if params.get("TZID")}
    for tzid in sorted(t for t in used - have if t):
        zone = ical.named_zone(tzid)
        if zone:
            vcal["children"].insert(0, ical.vtimezone(zone))


def cal_shift(value, days, clock, all_day):
    """A start of the series moved by days, at the series' new clock time (or a date)."""
    day = (value.date() if isinstance(value, datetime.datetime) else value) + datetime.timedelta(days=days)
    return day if all_day or clock is None else datetime.datetime.combine(day, clock)


def cal_times(comp, f, zone, viewer, floating):
    """DTSTART and DTEND from the page's start and end (DURATION gives way)."""
    all_day = f["allDay"]
    ical.remove(comp, "DURATION")
    if all_day:
        cal_encode(comp, "DTSTART", f["start"], None, True)
        cal_encode(comp, "DTEND", f["end"], None, True)
    else:
        cal_encode(comp, "DTSTART", cal_wall(f["start"], zone, viewer), zone, False, floating)
        cal_encode(comp, "DTEND", cal_wall(f["end"], zone, viewer), zone, False, floating)


def calendar_find(path, calendars):
    """The calendar an item's path is in (a path from this server's calendars only)."""
    for cal in calendars:
        root = urllib.parse.urlsplit(cal["href"]).path
        if isinstance(path, str) and path.startswith(root) and path.endswith(".ics") and "/../" not in path and "?" not in path:
            return cal
    raise ValueError("not an item of your calendars")


def calendar_write(body, viewer):
    """A change from the page: create, update (scope all, this, future) or
    delete (the same). The item is fetched as it is now and put back only
    if nobody changed it meanwhile."""
    url, login = caldav()
    if not url or not login:
        raise LookupError("not set up")
    calendars, _ = calendar_state()
    action = body.get("action")
    f = calendar_fields(body.get("event") or {}, viewer)
    origin = urllib.parse.urlsplit(calendars[0]["href"]) if calendars else None
    absolute = lambda path: f"{origin.scheme}://{origin.netloc}{path}"
    target = next((c for c in calendars if c["id"] == f.get("calendar")), None) if f.get("calendar") else None
    if action == "create":
        cal = target or (calendars[0] if calendars else None)
        if not cal:
            raise LookupError("no calendars")
        if "start" not in f:
            raise ValueError("start, end: when it is")
        uid = f"{secrets.token_hex(16)}@adleros"
        zone = None if f["allDay"] else viewer
        vevent = {"name": "VEVENT", "props": [("UID", {}, uid)], "children": []}
        cal_times(vevent, f, zone, viewer, False)
        cal_text(vevent, {"title": "", **f})
        if f.get("repeat"):
            ical.add(vevent, "RRULE", cal_rule(f["repeat"], zone, f["allDay"], False))
        ical.put(vevent, "CREATED", datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        ical.put(vevent, "SEQUENCE", "0")
        cal_stamp(vevent, bump=False)
        vcal = {"name": "VCALENDAR", "props": [("VERSION", {}, "2.0"), ("PRODID", {}, "-//adlerOS//Calendar//EN"), ("CALSCALE", {}, "GREGORIAN")],
                "children": [vevent]}
        cal_zones_used(vcal)
        path = urllib.parse.urlsplit(cal["href"]).path.rstrip("/") + f"/{uid.split('@')[0]}.ics"
        dav_raw("PUT", absolute(path), login, ical.serialize([vcal]), {"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
        _caldav["at"] = 0
        return {"ok": True, "href": path}

    path = body.get("href")
    cal = calendar_find(path, calendars)
    scope = body.get("scope") or "all"
    if scope not in ("all", "this", "future"):
        raise ValueError("scope: all, this or future")
    status, headers, data = dav_raw("GET", absolute(path), login)
    etag = headers.get("ETag")
    parsed = [c for c in ical.parse(data.decode("utf-8", "replace"))]
    vcal = next((c for c in parsed if c["name"] == "VCALENDAR"), None)
    if not vcal:
        raise ValueError("that item isn't a calendar's")
    tzs = ical.zones(vcal)
    master, events = cal_master(vcal)
    original = body.get("original")
    try:
        original = (datetime.datetime.fromisoformat(original.replace("Z", "+00:00")) if "T" in original
                    else datetime.date.fromisoformat(original)) if original else None
    except (AttributeError, ValueError):
        raise ValueError("original: the occurrence's start")
    repeating = master is not None and ical.prop(master, "RRULE")[1] is not None
    if not repeating:
        scope = "all"
    base = master or (events[0] if events else None)
    if base is None:
        raise ValueError("no event in that item")
    start0, zone = cal_start(base, tzs)
    all_day0 = not isinstance(start0, datetime.datetime)
    floating = isinstance(start0, datetime.datetime) and start0.tzinfo is None
    occ_wall = cal_wall(original, zone, viewer) if original is not None else cal_wall(start0, zone, viewer)
    if all_day0 and isinstance(occ_wall, datetime.datetime):
        occ_wall = occ_wall.date()

    def rid_of(comp):
        rid = ical.value_of(*ical.prop(comp, "RECURRENCE-ID"), tzs)
        if rid is None:
            return None
        w = cal_wall(rid, zone, viewer)
        return w.date() if all_day0 and isinstance(w, datetime.datetime) else w

    def match(comp):
        return rid_of(comp) == occ_wall

    def send(text, at=path, new=False):
        h = {"Content-Type": "text/calendar; charset=utf-8", **({"If-None-Match": "*"} if new else {"If-Match": etag} if etag else {})}
        dav_raw("PUT", absolute(at), login, text, h)

    def first_start():
        return cal_wall(start0, zone, viewer)

    if action == "delete":
        if scope == "all" or (scope == "future" and occ_wall == (first_start() if not all_day0 else start0)):
            dav_raw("DELETE", absolute(path), login, None, {"If-Match": etag} if etag else {})
        elif scope == "this":
            vcal["children"] = [c for c in vcal["children"] if not (c["name"] == "VEVENT" and c is not master and match(c))]
            cal_encode(master, "EXDATE__", occ_wall, zone, all_day0, floating)
            # EXDATE adds to any there (put would replace them): moved from the placeholder.
            i = next(i for i, (k, _, _) in enumerate(master["props"]) if k == "EXDATE__")
            name, params, value = master["props"][i]
            master["props"][i] = ("EXDATE", params, value)
            cal_stamp(master)
            send(ical.serialize(parsed))
        else:
            cal_split(master, vcal, occ_wall, zone, all_day0, floating, rid_of, tzs, viewer)
            cal_stamp(master)
            send(ical.serialize(parsed))
        _caldav["at"] = 0
        return {"ok": True}

    if action != "update":
        raise ValueError("action: create, update or delete")
    moving = target is not None and target["id"] != cal["id"]
    if moving and scope != "all":
        raise ValueError("one occurrence can't go to another calendar alone: change them all")
    times = "start" in f
    if scope == "this":
        comp = next((c for c in events if c is not master and match(c)), None)
        if comp is None:
            comp = {"name": "VEVENT", "props": [p for p in master["props"] if p[0] not in ("RRULE", "RDATE", "EXDATE", "RECURRENCE-ID", "DTSTAMP")],
                    "children": [json.loads(json.dumps(ch)) for ch in master["children"]]}
            comp["raw"] = {}
            cal_encode(comp, "RECURRENCE-ID", occ_wall, zone, all_day0, floating)
            vcal["children"].append(comp)
        if times:
            tz = zone if not f["allDay"] or all_day0 else zone
            cal_times(comp, f, tz if not all_day0 or f["allDay"] else viewer, viewer, floating)
        cal_text(comp, f)
        cal_stamp(comp)
        cal_zones_used(vcal)
        send(ical.serialize(parsed))
        _caldav["at"] = 0
        return {"ok": True}

    if scope == "future" and occ_wall != (first_start() if not all_day0 else start0):
        # The series ends before this one; a new one, from here on, gets the changes.
        new_uid = f"{secrets.token_hex(16)}@adleros"
        tail = {"name": "VEVENT", "props": [p for p in master["props"] if p[0] not in ("UID", "EXDATE", "DTSTAMP", "CREATED")],
                "children": [json.loads(json.dumps(ch)) for ch in master["children"]], "raw": {}}
        ical.put(tail, "UID", new_uid)
        moved = cal_split(master, vcal, occ_wall, zone, all_day0, floating, rid_of, tzs, viewer, tail=tail)
        cal_stamp(master)
        new_zone = zone if not (times and f["allDay"]) else None
        span = cal_span(master, tzs)
        if not times:
            f = {**f, "allDay": all_day0, "start": cal_aware(occ_wall, zone, viewer) if not all_day0 else occ_wall,
                 "end": (cal_aware(occ_wall, zone, viewer) + span) if not all_day0 else occ_wall + max(span, datetime.timedelta(days=1))}
        cal_times(tail, f, zone if not f["allDay"] else None, viewer, floating)
        cal_text(tail, f)
        if "repeat" in f:
            ical.remove(tail, "RRULE")
            if f["repeat"]:
                ical.add(tail, "RRULE", cal_rule(f["repeat"], zone or viewer, f["allDay"], floating))
        ical.put(tail, "SEQUENCE", "0")
        cal_stamp(tail, bump=False)
        new = {"name": "VCALENDAR", "props": [p for p in vcal["props"]], "children": [tail, *moved], "raw": {}}
        for m in moved:
            ical.put(m, "UID", new_uid)
        cal_zones_used(new)
        dest = target or cal
        new_path = urllib.parse.urlsplit(dest["href"]).path.rstrip("/") + f"/{new_uid.split('@')[0]}.ics"
        send(ical.serialize(parsed))
        send(ical.serialize([new]), new_path, new=True)
        _caldav["at"] = 0
        return {"ok": True}

    # All of it (or the one event): the master changed; a move in time moves
    # the whole series by as many days, at the new clock time, its skipped
    # and changed occurrences with it.
    comp = master or base
    if times:
        new_zone = zone if (not f["allDay"] and not all_day0) else (viewer if not f["allDay"] else None)
        new_start = cal_wall(f["start"], new_zone, viewer) if not f["allDay"] else f["start"]
        if repeating:
            days = ((new_start.date() if isinstance(new_start, datetime.datetime) else new_start)
                    - (occ_wall.date() if isinstance(occ_wall, datetime.datetime) else occ_wall)).days
            clock = new_start.time() if isinstance(new_start, datetime.datetime) else None
            first = cal_shift(cal_wall(start0, zone, viewer), days, clock, f["allDay"])
            length = (f["end"] - f["start"])
            f2 = {**f, "start": cal_aware(first, new_zone, viewer) if not f["allDay"] else first,
                  "end": (cal_aware(first, new_zone, viewer) + length) if not f["allDay"] else first + length}
            cal_times(comp, f2, new_zone, viewer, floating and not f["allDay"])
            exdates = [x for p, v in ical.props(comp, "EXDATE") for x in ical.values_of(p, v, tzs)]
            ical.remove(comp, "EXDATE")
            for x in exdates:
                cal_encode(comp, "EXDATE__", cal_shift(cal_wall(x, zone, viewer), days, clock, f["allDay"]), new_zone, f["allDay"], floating)
                i = next(i for i, (k, _, _) in enumerate(comp["props"]) if k == "EXDATE__")
                comp["props"][i] = ("EXDATE",) + comp["props"][i][1:]
            for c in events:
                if c is not comp and ical.prop(c, "RECURRENCE-ID")[1] is not None:
                    cal_encode(c, "RECURRENCE-ID", cal_shift(rid_of(c), days, clock, f["allDay"]), new_zone, f["allDay"], floating)
            if f["allDay"] != all_day0 and ical.prop(comp, "RRULE")[1] and "UNTIL=" in ical.prop(comp, "RRULE")[1].upper():
                rule = ical.prop(comp, "RRULE")[1]
                until = ical.value_of({}, re.search(r"UNTIL=([0-9TZ]+)", rule, re.I).group(1), {})
                day = until.date() if isinstance(until, datetime.datetime) else until
                ical.put(comp, "RRULE", re.sub(r"UNTIL=[0-9TZ]+", "UNTIL=" + cal_until_text(day, new_zone, f["allDay"], floating), rule, flags=re.I))
        else:
            cal_times(comp, f, new_zone, viewer, floating and not f["allDay"])
        zone = new_zone
    cal_text(comp, f)
    if "repeat" in f:
        ical.remove(comp, "RRULE")
        if f["repeat"]:
            is_all_day = f["allDay"] if times else all_day0
            ical.add(comp, "RRULE", cal_rule(f["repeat"], zone or viewer, is_all_day, floating))
    cal_stamp(comp)
    cal_zones_used(vcal)
    text = ical.serialize(parsed)
    if moving:
        new_path = urllib.parse.urlsplit(target["href"]).path.rstrip("/") + "/" + path.rsplit("/", 1)[-1]
        dav_raw("PUT", absolute(new_path), login, text, {"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
        dav_raw("DELETE", absolute(path), login, None, {"If-Match": etag} if etag else {})
    else:
        send(text)
    _caldav["at"] = 0
    return {"ok": True}


def cal_span(comp, tzs):
    start = ical.value_of(*ical.prop(comp, "DTSTART"), tzs)
    end = ical.value_of(*ical.prop(comp, "DTEND"), tzs)
    if end is not None and type(end) is type(start):
        return end - start
    return ical.duration(ical.prop(comp, "DURATION")[1] or "") or (datetime.timedelta(days=1) if not isinstance(start, datetime.datetime) else datetime.timedelta(0))


def cal_split(master, vcal, occ_wall, zone, all_day, floating, rid_of, tzs, viewer, tail=None):
    """The series ends just before occ_wall: UNTIL the day (or second)
    before; a COUNT made the rest's (on tail, if there's one). Its skipped
    and changed occurrences from then on leave it: the changed ones
    returned (for tail's item), the skipped ones put on tail."""
    rule = ical.prop(master, "RRULE")[1] or ""
    count = re.search(r"COUNT=(\d+)", rule, re.I)
    if count and tail is not None:
        ev = ical.events({"name": "VCALENDAR", "props": [], "children": [*[c for c in vcal["children"] if c["name"] == "VTIMEZONE"], master]})[0]
        parsed = ical.rrule(ev["rrule"])
        before = sum(1 for w in ical.starts(ev, parsed, None, None, occ_wall if not isinstance(occ_wall, datetime.datetime) else occ_wall.date())
                     if (w if isinstance(w, datetime.datetime) or not isinstance(occ_wall, datetime.datetime) else datetime.datetime.combine(w, datetime.time.min)) < occ_wall)
        left = max(1, int(count.group(1)) - before)
        ical.put(tail, "RRULE", re.sub(r"COUNT=\d+", f"COUNT={left}", rule, flags=re.I))
    if all_day:
        until = (occ_wall - datetime.timedelta(days=1)).strftime("%Y%m%d")
    elif floating:
        until = (occ_wall - datetime.timedelta(seconds=1)).strftime("%Y%m%dT%H%M%S")
    else:
        until = (occ_wall.replace(tzinfo=zone) - datetime.timedelta(seconds=1)).astimezone(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rule = re.sub(r";?(COUNT|UNTIL)=[^;]*", "", rule, flags=re.I).strip(";")
    ical.put(master, "RRULE", f"{rule};UNTIL={until}")
    kept, later = [], []
    for p, v in ical.props(master, "EXDATE"):
        for x in ical.values_of(p, v, tzs):
            w = cal_wall(x, zone, viewer)
            (later if (w >= occ_wall if type(w) is type(occ_wall) else False) else kept).append((p, v, x))
    ical.remove(master, "EXDATE")
    for p, v, x in kept:
        ical.add(master, "EXDATE", ical.when_text(x, zone)[1] if isinstance(x, datetime.datetime) and x.tzinfo else v.split(",")[0], p)
    if tail is not None:
        for p, v, x in later:
            ical.add(tail, "EXDATE", v.split(",")[0], p)
    moved = []
    for c in list(vcal["children"]):
        if c["name"] == "VEVENT" and c is not master:
            rid = rid_of(c)
            if rid is not None and type(rid) is type(occ_wall) and rid >= occ_wall:
                vcal["children"].remove(c)
                moved.append(c)
    return moved


def calendar_status():
    url, login = caldav()
    out = {"url": url, "configured": bool(url and login)}
    if not url:
        return {**out, "error": "noserver"}
    if not login:
        return {**out, "error": "nologin"}
    try:
        calendars, _ = calendar_state()
        out.update(ok=True, calendars=[{k: c[k] for k in ("id", "name", "color")} for c in calendars])
    except urllib.error.HTTPError as e:
        out["error"] = "refused" if e.code in (401, 403) else f"caldav {e.code}"
    except LookupError:
        out["error"] = "nocalendars"
    except (OSError, ValueError, ElementTree.ParseError) as e:
        out["error"] = f"unreachable ({e})"
    return out


def calendar_events(query):
    """Every event on from…to (YYYY-MM-DD, the page's days, in its zone tz)."""
    first = query.get("from", [""])[0]
    last = query.get("to", [""])[0]
    try:
        first, last = datetime.date.fromisoformat(first), datetime.date.fromisoformat(last)
    except ValueError:
        raise ValueError("from, to: days (YYYY-MM-DD)")
    if not 0 <= (last - first).days <= CALDAV_MAX_DAYS:
        raise ValueError(f"from…to: up to {CALDAV_MAX_DAYS} days")
    viewer = ical.named_zone(query.get("tz", [""])[0][:64]) or datetime.timezone.utc
    calendars, events = calendar_state()
    out = []
    for cal in calendars:
        evs = [e for item in events.get(cal["href"], (None, []))[1] for e in item["events"]]
        for o in ical.expand(evs, first, last, viewer):
            out.append({**o, "calendar": cal["id"]})
    return {"calendars": [{k: c[k] for k in ("id", "name", "color")} for c in calendars], "events": out}


# ------------------------------------------------------------------ tasks

# Tasks: your to-dos as Vikunja has them (projects, each a list and a board
# of buckets; due dates, priorities, labels, repeats), through its API:
# VIKUNJA_TOKEN (Vikunja: Settings, API Tokens), or VIKUNJA_USER and
# VIKUNJA_PASSWORD (a login; its session kept here), at VIKUNJA_URL, else
# Vikunja at this machine's Tailscale address and its port. The page never
# sees them. Before it's connected, the same kept here (data/tasks.json):
# once it is, they're moved to Vikunja (a copy of them kept, as
# tasks-moved-<when>.json), so nothing you did meanwhile is lost.
TASKS_FILE = DATA / "tasks.json"
VIKUNJA_NULL = "0001-01-01T00:00:00Z"
_vikunja = {"jwt": None, "key": None}
_tasks_lock = threading.Lock()
TASK_FIELDS = ("title", "description", "done", "due", "priority", "labels", "repeat", "project", "color", "favorite")


def vikunja():
    """(api url, token or (user, password)), or (url or None, None)."""
    url = install_setting("VIKUNJA_URL").rstrip("/")
    if not url:
        host = install_setting("TS_IP") if HOMELAB_MODE else install_setting("ADLEROS_HOST")
        app = next((a for a in installed_apps() if a["id"] == "vikunja"), None)
        url = f"http://{host}:{app['port']}" if host and app and app.get("port") else None
    token = install_setting("VIKUNJA_TOKEN")
    user, password = install_setting("VIKUNJA_USER"), install_setting("VIKUNJA_PASSWORD")
    return (url + "/api/v1") if url else None, (token or ((user, password) if user and password else None))


def vk(method, path, body=None, query=None, again=True):
    """Vikunja's answer (JSON) to one request; LookupError without a login."""
    url, login = vikunja()
    if not url or not login:
        raise LookupError("not set up")
    if isinstance(login, tuple):
        if _vikunja["key"] != login or not _vikunja["jwt"]:
            r = urllib.request.Request(f"{url}/login", data=json.dumps({"username": login[0], "password": login[1], "long_token": True}).encode(),
                                       method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(r, timeout=20) as answer:
                _vikunja.update(jwt=json.loads(answer.read())["token"], key=login)
        bearer = _vikunja["jwt"]
    else:
        bearer = login
    target = f"{url}{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(target, data=data, method=method,
                               headers={"Authorization": f"Bearer {bearer}", **({"Content-Type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(r, timeout=30) as answer:
            raw = answer.read(10 * 1024 * 1024)
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        if e.code == 401 and isinstance(login, tuple) and again:
            _vikunja["jwt"] = None  # its session ran out: log in again, once
            return vk(method, path, body, query, again=False)
        raise


def vk_all(path, query=None, limit=40):
    """Every page of a list."""
    out, page = [], 1
    while page <= limit:
        got = vk("GET", path, query={**(query or {}), "page": page, "per_page": 50})
        if not isinstance(got, list):
            break
        out += got
        if len(got) < 50:
            break
        page += 1
    return out


def task_text(html):
    """Vikunja's description (HTML) as text: paragraphs and lines kept."""
    if not html:
        return ""
    t = re.sub(r"(?i)<br\s*/?>", "\n", html)
    t = re.sub(r"(?i)</(p|h[1-6]|blockquote)>", "\n\n", t)  # a paragraph: a blank line after it
    t = re.sub(r"(?i)</(div|li)>", "\n", t)
    t = re.sub(r"(?i)<li[^>]*>", "• ", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'").replace("&amp;", "&")
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def task_html(text):
    """Text as Vikunja's editor writes it: a <p> a paragraph."""
    import html as html_lib
    paras = [p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    return "".join(f"<p>{html_lib.escape(p).replace(chr(10), '<br>')}</p>" for p in paras)


def vk_date(value):
    return None if not value or value.startswith("0001-") else value


REPEATS = {"daily": 86400, "weekly": 7 * 86400, "yearly": 365 * 86400}


def vk_task(t):
    """A Vikunja task as the page has them."""
    every, mode = t.get("repeat_after") or 0, t.get("repeat_mode") or 0
    repeat = None
    if mode == 1:
        repeat = {"kind": "monthly"}
    elif every:
        kind = next((k for k, v in REPEATS.items() if v == every), None)
        repeat = {"kind": kind} if kind else {"kind": "days", "days": max(1, every // 86400)}
        if mode == 2:
            repeat["fromDone"] = True
    return {"id": str(t["id"]), "project": str(t.get("project_id")), "title": t.get("title") or "", "description": task_text(t.get("description")),
            "done": bool(t.get("done")), "doneAt": vk_date(t.get("done_at")), "due": vk_date(t.get("due_date")),
            "priority": t.get("priority") or 0, "labels": [str(l["id"]) for l in t.get("labels") or []],
            "position": t.get("position") or 0, "bucket": str(t["bucket_id"]) if t.get("bucket_id") else None, "repeat": repeat,
            "percent": t.get("percent_done") or 0, "identifier": t.get("identifier") or "", "favorite": bool(t.get("is_favorite")),
            "color": t.get("hex_color") or "", "created": t.get("created"), "updated": t.get("updated")}


def vk_projects():
    out = []
    for p in vk("GET", "/projects", query={"is_archived": "false"}) or []:
        if p.get("id", 0) <= 0:
            continue  # saved filters, Favorites: not projects
        views = p.get("views") or []
        kanban = next((v for v in views if v.get("view_kind") == "kanban"), None)
        lst = next((v for v in views if v.get("view_kind") == "list"), None)
        out.append({"id": str(p["id"]), "title": p.get("title") or "", "color": p.get("hex_color") or "", "parent": str(p["parent_project_id"]) if p.get("parent_project_id") else None,
                    "position": p.get("position") or 0, "archived": bool(p.get("is_archived")), "board": str(kanban["id"]) if kanban else None,
                    "list": str(lst["id"]) if lst else None, "doneBucket": str(kanban.get("done_bucket_id")) if kanban and kanban.get("done_bucket_id") else None,
                    "defaultBucket": str(kanban.get("default_bucket_id")) if kanban and kanban.get("default_bucket_id") else None})
    return sorted(out, key=lambda p: (p["position"], p["title"].lower()))


def vk_id(value, what="id"):
    value = str(value or "")
    if not value.isdigit() or not 0 < int(value) < 10 ** 12:
        raise ValueError(f"{what}: a number")
    return int(value)


# ---------------------------------------------------- kept here, meanwhile

def tasks_local():
    try:
        data = json.loads(TASKS_FILE.read_text())
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict) or not isinstance(data.get("projects"), list):
        data = {"projects": [{"id": "l-inbox", "title": "Inbox", "color": "", "position": 0,
                              "buckets": [{"id": "lb-todo", "title": "To-Do", "position": 100}, {"id": "lb-doing", "title": "Doing", "position": 200},
                                          {"id": "lb-done", "title": "Done", "position": 300}], "doneBucket": "lb-done"}],
                "tasks": [], "labels": [], "next": 1}
    return data


def tasks_local_save(data):
    write_private(TASKS_FILE, json.dumps(data, indent=1))


def local_id(data, kind):
    n = data.get("next", 1)
    data["next"] = n + 1
    return f"{kind}{n}"


def local_projects(data):
    return [{"id": p["id"], "title": p["title"], "color": p.get("color", ""), "parent": None, "position": p.get("position", 0), "archived": False,
             "board": "local", "list": "local", "doneBucket": p.get("doneBucket"), "defaultBucket": (p.get("buckets") or [{}])[0].get("id")}
            for p in data["projects"]]


# ------------------------------------------------------------ either way

def tasks_status():
    url, login = vikunja()
    out = {"url": url[:-len("/api/v1")] if url else None, "configured": bool(url and login), "local": True}
    if not url:
        return {**out, "error": "novikunja"}
    if not login:
        return {**out, "error": "nologin"}
    try:
        me = vk("GET", "/user")
        out.update(ok=True, local=False, user=me.get("name") or me.get("username"))
        moved = tasks_move_in()
        if moved:
            out["moved"] = moved
    except urllib.error.HTTPError as e:
        out["error"] = "refused" if e.code in (401, 403) else f"vikunja {e.code}"
    except (OSError, ValueError, KeyError) as e:
        out["error"] = f"unreachable ({e})"
    return out


def tasks_connected():
    url, login = vikunja()
    return bool(url and login)


def tasks_move_in():
    """What was kept here while Vikunja wasn't connected: into Vikunja (its
    projects by name, made where they're missing; buckets by name; labels by
    name), then the file put aside. How many tasks moved."""
    with _tasks_lock:
        if not TASKS_FILE.is_file():
            return 0
        data = tasks_local()
        if not data["tasks"] and all(p["id"] == "l-inbox" for p in data["projects"]):
            TASKS_FILE.rename(TASKS_FILE.with_name(f"tasks-moved-{time.strftime('%Y%m%d-%H%M%S')}.json"))
            return 0
        projects = {p["title"].lower(): p for p in vk_projects()}
        labels = {l.get("title", "").lower(): l for l in vk_all("/labels")}
        label_ids = {}
        for l in data.get("labels") or []:
            got = labels.get(l["title"].lower()) or vk("PUT", "/labels", {"title": l["title"], "hex_color": l.get("color", "")})
            label_ids[l["id"]] = got["id"]
        moved = 0
        for lp in data["projects"]:
            tasks = [t for t in data["tasks"] if t["project"] == lp["id"]]
            if not tasks and lp["id"] == "l-inbox":
                continue
            vp = projects.get(lp["title"].lower())
            if not vp:
                vk("PUT", "/projects", {"title": lp["title"], "hex_color": lp.get("color", "")})
                vp = {p["title"].lower(): p for p in vk_projects()}[lp["title"].lower()]
            buckets = {}
            if vp.get("board"):
                have = {b["title"].lower(): b for b in vk("GET", f"/projects/{vp['id']}/views/{vp['board']}/buckets") or []}
                for b in lp.get("buckets") or []:
                    got = have.get(b["title"].lower()) or vk("PUT", f"/projects/{vp['id']}/views/{vp['board']}/buckets", {"title": b["title"]})
                    buckets[b["id"]] = got["id"]
            for t in sorted(tasks, key=lambda t: t.get("position", 0)):
                made = vk("PUT", f"/projects/{vp['id']}/tasks", vk_body({}, t))
                for lid in t.get("labels") or []:
                    if lid in label_ids:
                        vk("PUT", f"/tasks/{made['id']}/labels", {"label_id": label_ids[lid]})
                if t.get("bucket") in buckets and not t.get("done"):
                    vk("POST", f"/projects/{vp['id']}/views/{vp['board']}/buckets/{buckets[t['bucket']]}/tasks", {"task_id": made["id"]})
                moved += 1
                # In Vikunja now: out of the file (stopped halfway, the rest move next time, nothing twice).
                data["tasks"] = [x for x in data["tasks"] if x["id"] != t["id"]]
                tasks_local_save(data)
        TASKS_FILE.rename(TASKS_FILE.with_name(f"tasks-moved-{time.strftime('%Y%m%d-%H%M%S')}.json"))
        return moved


def vk_body(task, f):
    """A Vikunja task (as it is: task) with the page's changes (f) in it."""
    body = dict(task)
    for k in ("labels", "assignees", "attachments", "buckets", "reactions", "related_tasks", "comments", "created_by", "subscription"):
        body.pop(k, None)
    if "title" in f:
        body["title"] = f["title"]
    if "description" in f:
        body["description"] = task_html(f["description"])
    if "done" in f:
        body["done"] = bool(f["done"])
    if "due" in f:
        body["due_date"] = f["due"] or VIKUNJA_NULL
    if "priority" in f:
        body["priority"] = f["priority"]
    if "favorite" in f:
        body["is_favorite"] = bool(f["favorite"])
    if "color" in f:
        body["hex_color"] = f["color"].lstrip("#")
    if "repeat" in f:
        r = f["repeat"] or {}
        kind = r.get("kind")
        body["repeat_mode"] = 1 if kind == "monthly" else (2 if r.get("fromDone") else 0)
        body["repeat_after"] = 0 if kind in (None, "monthly") else REPEATS.get(kind) or int(r.get("days") or 1) * 86400
    return body


def task_fields(f):
    """What the page sent for a task, checked."""
    if not isinstance(f, dict):
        raise ValueError("task: an object")
    out = {}
    if "title" in f:
        if not isinstance(f["title"], str) or not f["title"].strip() or len(f["title"]) > 250:
            raise ValueError("title: up to 250 characters")
        out["title"] = f["title"].strip()
    if "description" in f:
        if not isinstance(f["description"], str) or len(f["description"]) > 50000:
            raise ValueError("description: text")
        out["description"] = f["description"]
    if "done" in f:
        out["done"] = bool(f["done"])
    if "favorite" in f:
        out["favorite"] = bool(f["favorite"])
    if "due" in f:
        if f["due"]:
            try:
                when = datetime.datetime.fromisoformat(str(f["due"]).replace("Z", "+00:00"))
            except ValueError:
                raise ValueError("due: a time")
            if not when.tzinfo:
                raise ValueError("due: a time with its zone")
            out["due"] = when.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            out["due"] = None
    if "priority" in f:
        if f["priority"] not in (0, 1, 2, 3, 4, 5):
            raise ValueError("priority: 0 to 5")
        out["priority"] = f["priority"]
    if "labels" in f:
        if not isinstance(f["labels"], list) or len(f["labels"]) > 50:
            raise ValueError("labels: a list")
        out["labels"] = [str(x) for x in f["labels"]]
    if "repeat" in f:
        r = f["repeat"]
        if r is not None and (not isinstance(r, dict) or r.get("kind") not in ("daily", "weekly", "monthly", "yearly", "days")):
            raise ValueError("repeat: daily, weekly, monthly, yearly or every so many days")
        if r and r.get("kind") == "days" and not (isinstance(r.get("days"), int) and 1 <= r["days"] <= 3650):
            raise ValueError("repeat: every 1 to 3650 days")
        out["repeat"] = r
    if "color" in f:
        if not re.fullmatch(r"#?([0-9a-fA-F]{6})?", str(f["color"])):
            raise ValueError("color: #rrggbb")
        out["color"] = str(f["color"])
    return out


def tasks_read(what, query):
    """projects, labels, list (a project's), board (its buckets), due (open
    ones due before a day, across projects), search."""
    if not tasks_connected():
        return tasks_read_local(what, query)
    if what == "projects":
        return {"projects": vk_projects()}
    if what == "labels":
        return {"labels": [{"id": str(l["id"]), "title": l.get("title") or "", "color": l.get("hex_color") or ""} for l in vk_all("/labels")]}
    if what in ("list", "board"):
        pid = vk_id(query.get("project", [""])[0], "project")
        project = next((p for p in vk_projects() if p["id"] == str(pid)), None)
        if not project:
            raise KeyError("no such project")
        if what == "board":
            if not project["board"]:
                return {"buckets": []}
            got = vk("GET", f"/projects/{pid}/views/{project['board']}/tasks", query={"per_page": 200}) or []
            return {"buckets": [{"id": str(b["id"]), "title": b.get("title") or "", "position": b.get("position") or 0, "limit": b.get("limit") or 0,
                                 "tasks": [vk_task(t) for t in b.get("tasks") or []]} for b in got]}
        done = query.get("done", ["false"])[0] == "true"
        q = {"filter": f"done = {'true' if done else 'false'}", "sort_by": "done_at" if done else "position", "order_by": "desc" if done else "asc"}
        tasks = vk_all(f"/projects/{pid}/views/{project['list']}/tasks", q, limit=4 if done else 40) if project["list"] else []
        return {"tasks": [vk_task(t) for t in tasks]}
    if what == "due":
        until = query.get("until", [""])[0]
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", until):
            raise ValueError("until: a day")
        tz = query.get("tz", ["UTC"])[0][:64]
        got = vk_all("/tasks", {"filter": f"done = false && due_date < {until}", "filter_timezone": tz, "sort_by": "due_date", "order_by": "asc"}, limit=10)
        return {"tasks": [vk_task(t) for t in got if vk_date(t.get("due_date"))]}
    if what == "search":
        text = query.get("q", [""])[0][:200]
        got = vk_all("/tasks", {"s": text, "filter": "done = false"}, limit=4) if text else []
        return {"tasks": [vk_task(t) for t in got]}
    raise KeyError("not found")


def tasks_read_local(what, query):
    data = tasks_local()
    task = lambda t: {"id": t["id"], "project": t["project"], "title": t["title"], "description": t.get("description", ""), "done": bool(t.get("done")),
                      "doneAt": t.get("doneAt"), "due": t.get("due"), "priority": t.get("priority", 0), "labels": t.get("labels", []),
                      "position": t.get("position", 0), "bucket": t.get("bucket"), "repeat": t.get("repeat"), "percent": 0, "identifier": "",
                      "favorite": bool(t.get("favorite")), "color": t.get("color", ""), "created": t.get("created"), "updated": t.get("updated")}
    if what == "projects":
        return {"projects": local_projects(data)}
    if what == "labels":
        return {"labels": data.get("labels") or []}
    if what in ("list", "board"):
        pid = query.get("project", [""])[0]
        project = next((p for p in data["projects"] if p["id"] == pid), None)
        if not project:
            raise KeyError("no such project")
        tasks = sorted((t for t in data["tasks"] if t["project"] == pid), key=lambda t: t.get("position", 0))
        if what == "board":
            first = (project.get("buckets") or [{}])[0].get("id")
            return {"buckets": [{"id": b["id"], "title": b["title"], "position": b.get("position", 0), "limit": 0,
                                 "tasks": [task(t) for t in tasks if (t.get("bucket") or first) == b["id"]]} for b in project.get("buckets") or []]}
        done = query.get("done", ["false"])[0] == "true"
        shown = [task(t) for t in tasks if bool(t.get("done")) == done]
        if done:
            shown.sort(key=lambda t: t.get("doneAt") or "", reverse=True)
        return {"tasks": shown}
    if what == "due":
        until = query.get("until", [""])[0]
        return {"tasks": sorted((task(t) for t in data["tasks"] if not t.get("done") and t.get("due") and t["due"][:10] < until), key=lambda t: t["due"])}
    if what == "search":
        text = query.get("q", [""])[0].lower()
        return {"tasks": [task(t) for t in data["tasks"] if text and not t.get("done") and text in t["title"].lower()]}
    raise KeyError("not found")


def tasks_write(body):
    """A change: task-create, task-update, task-delete, task-move (to a
    bucket, a place), project-create/update/delete, bucket-create/update/
    delete, label-create."""
    action = body.get("action")
    if not isinstance(action, str):
        raise ValueError("action")
    if not tasks_connected():
        with _tasks_lock:
            data = tasks_local()
            out = tasks_write_local(data, action, body)
            tasks_local_save(data)
            return out
    if action == "task-create":
        pid = vk_id(body.get("project"), "project")
        f = task_fields(body.get("task") or {})
        if "title" not in f:
            raise ValueError("title")
        made = vk("PUT", f"/projects/{pid}/tasks", vk_body({}, f))
        for lid in f.get("labels") or []:
            vk("PUT", f"/tasks/{made['id']}/labels", {"label_id": vk_id(lid, "label")})
        if body.get("bucket"):
            project = next((p for p in vk_projects() if p["id"] == str(pid)), None)
            if project and project["board"]:
                vk("POST", f"/projects/{pid}/views/{project['board']}/buckets/{vk_id(body['bucket'], 'bucket')}/tasks", {"task_id": made["id"]})
        return {"task": vk_task(vk("GET", f"/tasks/{made['id']}"))}
    if action == "task-update":
        tid = vk_id(body.get("id"), "task")
        f = task_fields(body.get("task") or {})
        current = vk("GET", f"/tasks/{tid}")
        if body.get("project") and str(body["project"]) != str(current.get("project_id")):
            current["project_id"] = vk_id(body["project"], "project")
        changed = vk("POST", f"/tasks/{tid}", vk_body(current, f))
        if "labels" in f:
            have = {str(l["id"]) for l in current.get("labels") or []}
            want = set(f["labels"])
            for lid in want - have:
                vk("PUT", f"/tasks/{tid}/labels", {"label_id": vk_id(lid, "label")})
            for lid in have - want:
                vk("DELETE", f"/tasks/{tid}/labels/{vk_id(lid, 'label')}")
        return {"task": vk_task(vk("GET", f"/tasks/{tid}") if "labels" in f else changed)}
    if action == "task-delete":
        vk("DELETE", f"/tasks/{vk_id(body.get('id'), 'task')}")
        return {"ok": True}
    if action == "task-move":
        tid = vk_id(body.get("id"), "task")
        pid = vk_id(body.get("project"), "project")
        project = next((p for p in vk_projects() if p["id"] == str(pid)), None)
        if not project or not project["board"]:
            raise KeyError("no such project")
        if body.get("bucket"):
            vk("POST", f"/projects/{pid}/views/{project['board']}/buckets/{vk_id(body['bucket'], 'bucket')}/tasks", {"task_id": tid})
        if body.get("position") is not None:
            view = project["board"] if body.get("view") == "board" else project["list"]
            vk("POST", f"/tasks/{tid}/position", {"task_id": tid, "project_view_id": vk_id(view, "view"), "position": float(body["position"])})
        return {"task": vk_task(vk("GET", f"/tasks/{tid}"))}
    if action in ("project-create", "project-update"):
        title = str(body.get("title") or "").strip()[:250]
        if action == "project-create":
            if not title:
                raise ValueError("title")
            made = vk("PUT", "/projects", {"title": title, "hex_color": str(body.get("color") or "").lstrip("#")})
            return {"project": next((p for p in vk_projects() if p["id"] == str(made["id"])), None)}
        pid = vk_id(body.get("id"), "project")
        current = vk("GET", f"/projects/{pid}")
        current.pop("views", None)
        if title:
            current["title"] = title
        if "color" in body:
            current["hex_color"] = str(body["color"] or "").lstrip("#")
        if "archived" in body:
            current["is_archived"] = bool(body["archived"])
        vk("POST", f"/projects/{pid}", current)
        return {"ok": True}
    if action == "project-delete":
        vk("DELETE", f"/projects/{vk_id(body.get('id'), 'project')}")
        return {"ok": True}
    if action in ("bucket-create", "bucket-update", "bucket-delete"):
        pid = vk_id(body.get("project"), "project")
        project = next((p for p in vk_projects() if p["id"] == str(pid)), None)
        if not project or not project["board"]:
            raise KeyError("no such project")
        base = f"/projects/{pid}/views/{project['board']}/buckets"
        if action == "bucket-create":
            title = str(body.get("title") or "").strip()[:250]
            if not title:
                raise ValueError("title")
            return {"bucket": vk("PUT", base, {"title": title})}
        bid = vk_id(body.get("id"), "bucket")
        if action == "bucket-delete":
            vk("DELETE", f"{base}/{bid}")
            return {"ok": True}
        current = next((b for b in vk("GET", base) or [] if b["id"] == bid), None)
        if not current:
            raise KeyError("no such bucket")
        current.pop("tasks", None)
        if body.get("title"):
            current["title"] = str(body["title"]).strip()[:250]
        if "limit" in body:
            current["limit"] = max(0, int(body["limit"] or 0))
        vk("POST", f"{base}/{bid}", current)
        return {"ok": True}
    if action == "label-create":
        title = str(body.get("title") or "").strip()[:250]
        if not title:
            raise ValueError("title")
        made = vk("PUT", "/labels", {"title": title, "hex_color": str(body.get("color") or "").lstrip("#")})
        return {"label": {"id": str(made["id"]), "title": made.get("title"), "color": made.get("hex_color") or ""}}
    raise ValueError("action: not one Tasks knows")


def task_next_due(due, repeat):
    """When a repeating task is due next: a day, a week, a month, a year or
    so many days on (from its due date; from now, if it repeats from when it's done)."""
    when = datetime.datetime.fromisoformat(due.replace("Z", "+00:00"))
    now = datetime.datetime.now(datetime.timezone.utc)
    base = max(when, now) if repeat.get("fromDone") else when
    if repeat.get("fromDone"):
        base = now.replace(hour=when.hour, minute=when.minute, second=0)
    kind = repeat.get("kind")
    if kind == "monthly":
        m = base.month % 12 + 1
        y = base.year + (base.month == 12)
        nxt = base.replace(year=y, month=m, day=min(base.day, calendar.monthrange(y, m)[1]))
    else:
        nxt = base + datetime.timedelta(seconds=REPEATS.get(kind) or int(repeat.get("days") or 1) * 86400)
    while not repeat.get("fromDone") and nxt <= now - datetime.timedelta(days=1) and kind != "monthly":
        nxt += datetime.timedelta(seconds=REPEATS.get(kind) or int(repeat.get("days") or 1) * 86400)
    return nxt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tasks_write_local(data, action, body):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    find = lambda kind, i: next((x for x in data[kind] if x["id"] == str(i)), None)
    if action == "task-create":
        project = find("projects", body.get("project"))
        f = task_fields(body.get("task") or {})
        if not project or "title" not in f:
            raise ValueError("project, title")
        same = [t for t in data["tasks"] if t["project"] == project["id"]]
        t = {"id": local_id(data, "lt"), "project": project["id"], "created": now, "updated": now,
             "position": (max((x.get("position", 0) for x in same), default=0) + 65536),
             "bucket": body.get("bucket") or (project.get("buckets") or [{}])[0].get("id"), **f}
        if t.get("done"):
            t["doneAt"] = now
            t["bucket"] = project.get("doneBucket") or t["bucket"]
        data["tasks"].append(t)
        return {"task": t}
    if action == "task-update":
        t = find("tasks", body.get("id"))
        if not t:
            raise KeyError("no such task")
        f = task_fields(body.get("task") or {})
        project = find("projects", body.get("project") or t["project"]) or find("projects", t["project"])
        repeat = f.get("repeat", t.get("repeat"))
        if f.get("done") and not t.get("done") and repeat and (f.get("due", t.get("due"))):
            # Done, and it repeats: due again (from its due date, or from now), as Vikunja does.
            f = {**f, "done": False, "due": task_next_due(f.get("due", t.get("due")), repeat)}
        if f.get("done") and not t.get("done"):
            t["doneAt"] = now
            if project.get("doneBucket"):
                t["bucket"] = project["doneBucket"]
        elif "done" in f and not f["done"] and t.get("done"):
            t["doneAt"] = None
            if t.get("bucket") == project.get("doneBucket"):
                t["bucket"] = (project.get("buckets") or [{}])[0].get("id")
        if project["id"] != t["project"]:
            t["project"], t["bucket"] = project["id"], (project.get("buckets") or [{}])[0].get("id")
        t.update(f, updated=now)
        return {"task": t}
    if action == "task-delete":
        data["tasks"] = [t for t in data["tasks"] if t["id"] != str(body.get("id"))]
        return {"ok": True}
    if action == "task-move":
        t = find("tasks", body.get("id"))
        if not t:
            raise KeyError("no such task")
        project = find("projects", t["project"])
        if body.get("bucket"):
            t["bucket"] = str(body["bucket"])
            done = t["bucket"] == project.get("doneBucket")
            if done != bool(t.get("done")):
                t["done"], t["doneAt"] = done, now if done else None
        if body.get("position") is not None:
            t["position"] = float(body["position"])
        t["updated"] = now
        return {"task": t}
    if action == "project-create":
        title = str(body.get("title") or "").strip()[:250]
        if not title:
            raise ValueError("title")
        p = {"id": local_id(data, "lp"), "title": title, "color": str(body.get("color") or ""), "position": len(data["projects"]),
             "buckets": [{"id": local_id(data, "lb"), "title": t, "position": (i + 1) * 100} for i, t in enumerate(("To-Do", "Doing", "Done"))]}
        p["doneBucket"] = p["buckets"][-1]["id"]
        data["projects"].append(p)
        return {"project": local_projects({"projects": [p]})[0]}
    if action == "project-update":
        p = find("projects", body.get("id"))
        if not p:
            raise KeyError("no such project")
        if body.get("title"):
            p["title"] = str(body["title"]).strip()[:250]
        if "color" in body:
            p["color"] = str(body["color"] or "")
        return {"ok": True}
    if action == "project-delete":
        if len(data["projects"]) <= 1:
            raise ValueError("the last project stays")
        pid = str(body.get("id"))
        data["projects"] = [p for p in data["projects"] if p["id"] != pid]
        data["tasks"] = [t for t in data["tasks"] if t["project"] != pid]
        return {"ok": True}
    if action in ("bucket-create", "bucket-update", "bucket-delete"):
        p = find("projects", body.get("project"))
        if not p:
            raise KeyError("no such project")
        if action == "bucket-create":
            title = str(body.get("title") or "").strip()[:250]
            if not title:
                raise ValueError("title")
            b = {"id": local_id(data, "lb"), "title": title, "position": max((x.get("position", 0) for x in p["buckets"]), default=0) + 100}
            p["buckets"].append(b)
            return {"bucket": b}
        b = next((x for x in p["buckets"] if x["id"] == str(body.get("id"))), None)
        if not b:
            raise KeyError("no such bucket")
        if action == "bucket-delete":
            if len(p["buckets"]) <= 1:
                raise ValueError("the last bucket stays")
            p["buckets"].remove(b)
            for t in data["tasks"]:
                if t.get("bucket") == b["id"]:
                    t["bucket"] = p["buckets"][0]["id"]
            if p.get("doneBucket") == b["id"]:
                p["doneBucket"] = None
            return {"ok": True}
        if body.get("title"):
            b["title"] = str(body["title"]).strip()[:250]
        return {"ok": True}
    if action == "label-create":
        title = str(body.get("title") or "").strip()[:250]
        if not title:
            raise ValueError("title")
        label = {"id": local_id(data, "ll"), "title": title, "color": str(body.get("color") or "")}
        data.setdefault("labels", []).append(label)
        return {"label": label}
    raise ValueError("action: not one Tasks knows")


# --------------------------------------------- without Immich, Paperless

# Gallery and Documents before they're connected (or while Immich or
# Paperless is off): the files themselves, from their folders in your
# storage. Immich's library is by day (library/<you>/<year>/<day>/), so
# that's each photo's day; Paperless's are numbers, with its thumbnails and
# searchable PDFs beside them. Kept, and looked over again (in the
# background) when it's over five minutes old.
GALLERY_SHOWN = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"}
GALLERY_HEIC = {".heic", ".heif"}
GALLERY_VIDEO = {".mp4", ".mov", ".webm", ".m4v", ".3gp", ".mkv"}
DOCUMENT_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".txt", ".md", ".rtf", ".csv", ".doc", ".docx",
                     ".odt", ".ods", ".odp", ".xls", ".xlsx", ".ppt", ".pptx", ".epub", ".eml", ".html"}
_local_lists = {}
_local_lock = threading.Lock()


def media_root(key, default):
    """(its path in adlerOS, its real folder or None) for a folder setting (GALLERY_DIR…)."""
    rel = install_setting(key, default).strip("/")
    place, real = locate(f"/user/{rel}")
    return (place_path(place, real), real) if real and real.is_dir() else (f"/user/{rel}", None)


def local_cached(key, make):
    """make()'s answer, kept: when it's over five minutes old, the old one
    straight away while a new one is made (a big library takes a while)."""
    def remake():
        try:
            data = make()
        except Exception as e:  # a bad folder never stops the server
            print(f"{key}: couldn't look round ({e})", file=sys.stderr, flush=True)
            data = None
        with _local_lock:
            old = _local_lists.get(key)
            _local_lists[key] = (time.time(), data if data is not None else (old[1] if old else None), False)
        return data
    with _local_lock:
        hit = _local_lists.get(key)
        if hit and hit[1] is not None:
            if time.time() - hit[0] > 300 and not hit[2]:
                _local_lists[key] = (hit[0], hit[1], True)
                threading.Thread(target=remake, name=key, daemon=True).start()
            return hit[1]
    return remake() or {"dir": None, "found": False, "items": []}


def gallery_local():
    virtual, top = media_root("GALLERY_DIR", "Gallery")
    if not top:
        return {"dir": virtual, "found": False, "items": []}

    def make():
        immich_layout = (top / "library").is_dir() or (top / "upload").is_dir()
        roots = [top / "library", top / "upload"] if immich_layout else [top]
        items = []
        for root in roots:
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != TRASH]
                day = re.search(r"(\d{4}-\d{2}-\d{2})$", dirpath)
                for name in filenames:
                    suffix = os.path.splitext(name)[1].lower()
                    kind = "image" if suffix in GALLERY_SHOWN else "heic" if suffix in GALLERY_HEIC else "video" if suffix in GALLERY_VIDEO else None
                    if not kind or name.startswith("."):
                        continue
                    real = os.path.join(dirpath, name)
                    try:
                        st = os.stat(real)
                    except OSError:
                        continue
                    items.append({"path": f"{virtual}/{os.path.relpath(real, top)}", "name": name, "kind": kind, "size": st.st_size,
                                  "date": day.group(1) if day else time.strftime("%Y-%m-%d", time.localtime(st.st_mtime))})
                if len(items) > 200000:
                    break
        items.sort(key=lambda x: (x["date"], x["name"]), reverse=True)
        return {"dir": virtual, "found": True, "immich": immich_layout, "items": items}
    return local_cached("gallery", make)


def documents_local():
    virtual, top = media_root("DOCUMENTS_DIR", "Documents")
    if not top:
        return {"dir": virtual, "found": False, "items": []}

    def make():
        media = top / "documents"
        paperless_layout = (media / "originals").is_dir()
        root = media / "originals" if paperless_layout else top
        items = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != TRASH]
            for name in filenames:
                stem, suffix = os.path.splitext(name)
                if name.startswith(".") or suffix.lower() not in DOCUMENT_SUFFIXES:
                    continue
                real = os.path.join(dirpath, name)
                try:
                    st = os.stat(real)
                except OSError:
                    continue
                rel = os.path.relpath(real, top)
                item = {"path": f"{virtual}/{rel}", "name": name, "suffix": suffix.lower().lstrip("."), "size": st.st_size, "mtime": st.st_mtime}
                if paperless_layout:
                    # Paperless's own: its number, its thumbnail, its searchable PDF.
                    inner = os.path.relpath(real, media / "originals")
                    if stem.isdigit():
                        item["number"] = int(stem)
                        if (media / "thumbnails" / f"{stem}.webp").is_file():
                            item["thumb"] = f"{virtual}/documents/thumbnails/{stem}.webp"
                    archive = media / "archive" / (os.path.splitext(inner)[0] + ".pdf")
                    if archive.is_file():
                        item["archive"] = f"{virtual}/documents/archive/{os.path.splitext(inner)[0]}.pdf"
                items.append(item)
                if len(items) > 50000:
                    break
        items.sort(key=lambda x: -x["mtime"])
        return {"dir": virtual, "found": True, "paperless": paperless_layout, "items": items}
    return local_cached("documents", make)


def exif_thumbnail(real):
    """The small JPEG most cameras keep in a photo's EXIF, turned the way the
    photo is (its own EXIF orientation, put on it), or None."""
    with open(real, "rb") as f:
        data = f.read(160 * 1024)
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker, size = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker == 0xE1 and data[i + 4:i + 10] == b"Exif\x00\x00":
            tiff = data[i + 10:i + 2 + size]
            bo = "<" if tiff[:2] == b"II" else ">"
            u16 = lambda at: struct.unpack(bo + "H", tiff[at:at + 2])[0]  # noqa: E731
            u32 = lambda at: struct.unpack(bo + "I", tiff[at:at + 4])[0]  # noqa: E731
            ifd0 = u32(4)
            orientation = 1
            for k in range(u16(ifd0)):
                at = ifd0 + 2 + 12 * k
                if u16(at) == 0x0112:
                    orientation = u16(at + 8)
            ifd1 = u32(ifd0 + 2 + 12 * u16(ifd0))
            if not ifd1 or ifd1 + 2 > len(tiff):
                return None
            off = length = None
            for k in range(u16(ifd1)):
                at = ifd1 + 2 + 12 * k
                if u16(at) == 0x0201:
                    off = u32(at + 8)
                elif u16(at) == 0x0202:
                    length = u32(at + 8)
            thumb = tiff[off:off + length] if off and length and off + length <= len(tiff) else b""
            if thumb[:2] != b"\xff\xd8":
                return None
            if orientation in range(2, 9):
                # A tiny EXIF of its own, with only the orientation: the browser turns it.
                ifd = b"MM\x00\x2a\x00\x00\x00\x08\x00\x01" + b"\x01\x12\x00\x03\x00\x00\x00\x01" + struct.pack(">H", orientation) + b"\x00\x00\x00\x00\x00\x00"
                app1 = b"Exif\x00\x00" + ifd
                thumb = b"\xff\xd8\xff\xe1" + struct.pack(">H", len(app1) + 2) + app1 + thumb[2:]
            return thumb
        if marker == 0xDA:
            return None
        i += 2 + size
    return None


def locate(path, must_exist=True):
    """(place, real path) for '/user/Documents/a.txt', else (None, None). '..'
    and links that lead out of their place are refused."""
    if not isinstance(path, str) or "\x00" in path or len(path) > 4096:
        return None, None
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if not parts or ".." in parts or parts[0] not in PLACES or not place_on(parts[0]):
        return None, None
    place, rest = parts[0], parts[1:]
    for _ in PLACES:  # Root/storage/Desktop: one hop per place at most
        hop = next(((other, p) for other, p in nested(place) if rest[:len(p)] == p), None)
        if not hop:
            break
        place, rest = hop[0], rest[len(hop[1]):]
    top = PLACES[place].resolve()
    try:
        real = top.joinpath(*rest).resolve(strict=must_exist)
    except (OSError, RuntimeError):
        return None, None
    return (place, real) if real == top or real.is_relative_to(top) else (None, None)


def place_path(place, real):
    rel = real.relative_to(PLACES[place].resolve())
    return f"/{place}" + ("" if str(rel) == "." else f"/{rel}")


def is_top(place, real):
    return real == PLACES[place].resolve()


def root_writes():
    """Whether Root may change now: admin mode, and the machine allows it."""
    return admin_on() and terminal_enabled()


def good_name(name):
    return (isinstance(name, str) and 0 < len(name) <= 255 and "/" not in name and "\x00" not in name
            and name not in (".", "..", TRASH) and name.isprintable())


def file_kind(path, is_dir):
    if is_dir:
        return "folder"
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES or path.name in ("Dockerfile", "Makefile", ".gitignore", "README", ".env", ".stignore"):
        return "text"
    return next((k for k, sufs in KINDS.items() if suffix in sufs), "file")


def list_folder(place, real):
    entries = []
    top = PLACES[place].resolve()
    here = real.relative_to(top)
    inner = {"/".join(parts): other for other, parts in nested(place)}
    for child in real.iterdir():
        if real == top and child.name == TRASH:
            continue
        try:
            st = child.stat()
            is_dir = child.is_dir()
        except OSError:
            continue  # a broken link
        link = child.is_symlink()
        # A link that leads out of its place is shown, but can't be opened.
        outside = link and not child.resolve().is_relative_to(top)
        entry = {"name": child.name, "dir": is_dir, "size": None if is_dir else st.st_size,
                 "mtime": st.st_mtime, "kind": file_kind(child, is_dir), "link": link, "outside": outside}
        other = inner.get(str(here / child.name) if str(here) != "." else child.name)
        if other and is_dir and not link:
            entry["place"] = other  # Root's mailbox/: opening it opens the Desktop
        entries.append(entry)
    entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    return entries


def unique_name(folder, name):
    """name, or 'name (2).ext' if that's taken."""
    candidate, n = folder / name, 2
    stem, suffix = Path(name).stem, Path(name).suffix
    while candidate.exists() or candidate.is_symlink():
        candidate = folder / f"{stem} ({n}){suffix}"
        n += 1
    return candidate


def to_trash(place, real):
    """Into the place's Trash, with where it came from."""
    slot = PLACES[place] / TRASH / f"{int(time.time() * 1000)}-{secrets.token_hex(3)}"
    slot.mkdir(parents=True)
    (slot / "meta.json").write_text(json.dumps({"from": place_path(place, real), "deleted": time.time()}))
    shutil.move(str(real), str(slot / real.name))


def trash_items():
    items = []
    for place in WRITABLE:
        trash = PLACES[place] / TRASH
        if not place_on(place) or not trash.is_dir():
            continue
        for entry in trash.iterdir():
            try:
                meta = json.loads((entry / "meta.json").read_text())
                inside = next(p for p in entry.iterdir() if p.name != "meta.json")
            except (OSError, ValueError, StopIteration):
                continue
            origin = meta.get("from", "")
            if not any(origin == f"/{p}" or origin.startswith(f"/{p}/") for p in PLACES):
                origin = "/user" + origin  # from before there were places
            items.append({"id": f"{place}/{entry.name}", "name": inside.name, "from": origin,
                          "deleted": meta.get("deleted", 0), "dir": inside.is_dir()})
    return sorted(items, key=lambda i: -i["deleted"])


def trash_slot(item_id):
    """(place, slot folder) for a Trash item's id, else (None, None)."""
    match = re.fullmatch(r"(desktop|user)/(\d+-[0-9a-f]{6})", str(item_id))
    if not match or not place_on(match[1]):
        return None, None
    slot = PLACES[match[1]] / TRASH / match[2]
    return (match[1], slot) if slot.is_dir() and not slot.is_symlink() else (None, None)


# Copies and moves between places take a while: they run as tasks, with
# progress, while the page carries on.
TASKS = {}
_tasks_lock = threading.Lock()


def start_task(label, work):
    task = {"id": secrets.token_hex(8), "label": label, "done": 0, "total": 0, "status": "running",
            "error": None, "started": time.time()}
    with _tasks_lock:
        for old in [k for k, t in TASKS.items() if t["status"] != "running" and time.time() - t["started"] > 600]:
            del TASKS[old]
        TASKS[task["id"]] = task

    def run():
        try:
            work(task)
            task["status"] = "done"
        except OSError as e:
            task["status"], task["error"] = "failed", e.strerror or str(e)
        except Exception as e:  # noqa: BLE001 (it's reported, not swallowed)
            task["status"], task["error"] = "failed", str(e)
    threading.Thread(target=run, daemon=True).start()
    return task


def tree_size(path):
    if path.is_symlink() or not path.is_dir():
        return path.lstat().st_size
    total = 0
    for folder, _, names in os.walk(path):
        for name in names:
            try:
                total += os.lstat(os.path.join(folder, name)).st_size
            except OSError:
                pass
    return total


def copy_item(src, dst, task):
    """src to dst (which mustn't exist), counting bytes into the task. Links
    are copied as links, never followed."""
    if src.is_symlink():
        os.symlink(os.readlink(src), dst)
    elif src.is_dir():
        dst.mkdir()
        for child in src.iterdir():
            copy_item(child, dst / child.name, task)
        shutil.copystat(src, dst)
    else:
        with open(src, "rb") as a, open(dst, "xb") as b:
            while chunk := a.read(1024 * 1024):
                b.write(chunk)
                task["done"] += len(chunk)
        shutil.copystat(src, dst)


def remove_item(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def transfer(sources, folder, copy):
    """Copy or move [(place, path)] into folder; a task. A move inside one
    place is a rename, done at once (None)."""
    if not copy:
        try:
            for _, src in sources:
                os.rename(src, unique_name(folder, src.name))
            return None
        except OSError:
            pass  # another disk: copy, then delete
    names = [src.name for _, src in sources]
    label = (f"{'Copying' if copy else 'Moving'} {names[0]}" if len(names) == 1
             else f"{'Copying' if copy else 'Moving'} {len(names)} items")

    def work(task):
        task["total"] = sum(tree_size(src) for _, src in sources if src.exists() or src.is_symlink())
        for _, src in sources:
            if not (src.exists() or src.is_symlink()):
                continue  # moved already, by the rename above
            target = unique_name(folder, src.name)
            try:
                copy_item(src, target, task)
            except BaseException:
                if target.exists() or target.is_symlink():
                    remove_item(target)
                raise
            if not copy:
                remove_item(src)
    return start_task(label, work)


def root_request(op, **details):
    """Queues a change in Root for the helper: the details in a file of their
    own (paths and text don't fit an action's parameters), its name the
    action's one parameter."""
    token = secrets.token_hex(16)
    FILE_REQUESTS.mkdir(parents=True, exist_ok=True)
    write_private(FILE_REQUESTS / f"{token}.json", json.dumps({"op": op, "created": time.time(), **details}))
    actions = load_actions()
    if "files-root" not in actions:
        return None, "this adlerOS's helper can't change Root"
    job, busy = queue_action("files-root", {"request": token}, actions)
    if busy:
        (FILE_REQUESTS / f"{token}.json").unlink(missing_ok=True)
        return None, f"the helper is busy ({busy.get('label', 'something else')}); try again when it's done"
    return job, None


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

def trusted_proxies():
    """Who may tell adlerOS a visitor's real address and scheme (X-Real-IP,
    X-Forwarded-Proto): this machine (its own Tailscale address too, which a
    homelab's nginx comes from), and ADLEROS_TRUSTED_PROXIES (addresses or
    networks, comma-separated: your reverse proxy's, e.g. its Docker network)."""
    found = []
    for item in ["127.0.0.1", "::1", local_address(), *os.environ.get("ADLEROS_TRUSTED_PROXIES", "").replace(" ", ",").split(",")]:
        try:
            found.append(ipaddress.ip_network(item.strip(), strict=False))
        except ValueError:
            continue
    return found


TRUSTED_PROXIES = trusted_proxies()

TAILNET = ("100.64.0.0/10", "fd7a:115c:a1e0::/48")


def allowed_networks():
    """Who may use adlerOS (ADLEROS_NETWORKS): "tailscale" (your tailnet),
    addresses or networks, comma-separated; "anyone" or empty: whoever can
    reach this machine. This machine itself always may. Through a trusted
    proxy, it's the visitor it names that counts."""
    items = [i.strip().lower() for i in os.environ.get("ADLEROS_NETWORKS", "").replace(" ", ",").split(",") if i.strip()]
    if not items or "anyone" in items:
        return None
    found = [ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("::1/128")]
    try:
        found.append(ipaddress.ip_network(local_address()))  # its own address, as its health check asks
    except ValueError:
        pass  # a name, not an address
    for item in items:
        try:
            found += [ipaddress.ip_network(n) for n in TAILNET] if item == "tailscale" else [ipaddress.ip_network(item, strict=False)]
        except ValueError:
            print(f"ADLEROS_NETWORKS: {item!r} isn't an address or a network; skipped", file=sys.stderr, flush=True)
    return found


ALLOWED_NETWORKS = allowed_networks()
_refused = {}


def note_refused(address):
    """Logged once an hour per address, not once a request."""
    now = time.monotonic()
    if len(_refused) > 1000:
        _refused.clear()
    if now - _refused.get(address, -3600.0) >= 3600:
        _refused[address] = now
        print(f"{address} isn't on ADLEROS_NETWORKS: no answer", file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "homelab"
    sys_version = ""

    # Through a reverse proxy we trust, it passes the real client and scheme
    # along; anything else is talking to us directly, and its headers count
    # for nothing (they'd let anyone dodge the login lockout).
    def _from_proxy(self):
        try:
            peer = ipaddress.ip_address(self.client_address[0])
        except ValueError:
            return False
        return any(peer in network for network in TRUSTED_PROXIES)

    def client(self):
        if self._from_proxy():
            return self.headers.get("X-Real-IP", self.client_address[0])
        return self.client_address[0]

    def https(self):
        return self._from_proxy() and self.headers.get("X-Forwarded-Proto") == "https"

    def allowed(self):
        if ALLOWED_NETWORKS is None:
            return True
        try:
            who = ipaddress.ip_address(self.client())
        except ValueError:
            return False
        who = getattr(who, "ipv4_mapped", None) or who
        return any(who in network for network in ALLOWED_NETWORKS)

    # Not one of ADLEROS_NETWORKS: no answer at all, not even the lock screen.
    def parse_request(self):
        if not super().parse_request():
            return False
        if self.allowed():
            return True
        note_refused(self.client())
        self.close_connection = True
        return False

    # SameSite cookies don't stop your other apps: every port of this machine,
    # and every name under your domain, is the same "site" to a browser. So a
    # change has to come from adlerOS's own page, which the browser vouches for.
    def cross_site(self):
        site = self.headers.get("Sec-Fetch-Site")
        if site is not None:
            return site not in ("same-origin", "none")
        origin = self.headers.get("Origin")
        if not origin:
            return False  # not a browser (curl, a script), or one too old to say
        return urllib.parse.urlsplit(origin).netloc != self.headers.get("Host", "")

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
            # Standalone: adlerOS's .env as it is now (the helper changes it,
            # the welcome's compose folders say), else as compose handed it in.
            env = read_env_file(STANDALONE_ENV) if STANDALONE_ENV.is_file() else os.environ
            config = {k: env.get(k, "") for k in ("ADLEROS_HOST", "COMPOSE_ROOTS", "APPS_DIR", "TZ", "STORAGE_DIR")}
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
            "adminLeft": admin_left(),
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
            # The chosen one is public: the lock screen shows it too, blurred.
            # Any other is a picture in your storage, so only once you're in.
            wanted = query.get("id", [None])[0]
            if wanted and wanted != selected_wallpaper_id() and not self.logged_in():
                return self.send_json(401, {"error": "login required"})
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
            apps = placed(installed_apps())
            status = app_status(apps)
            env = read_env_file(HOMELAB_ENV)
            return self.send_json(200, {"name": display_name(), "searchUrl": search_url(), "dock": dock_pins(),
                                        "folders": app_folders({a["id"] for a in apps}),
                                        "admin": admin_on(), "adminLeft": admin_left(), "mode": MODE, "welcomed": bool(load_settings().get("welcomed")),
                                        "collections": collections(apps), "order": app_order(),
                                        "choices": collection_choices(),
                                        "host": {"tsIp": env.get("TS_IP", ""), "domain": env.get("DOMAIN", "")},
                                        "apps": [
                {"id": a["id"], "name": a["name"], "about": a["about"], "genre": a["genre"],
                 "url": a["url"], "hasIcon": a["icon"].startswith("di:") or a["url"].startswith("http"), "icon": a["icon"],
                 "imported": bool(a.get("imported")), "note": a.get("note", ""), "up": status[a["id"]],
                 "home": a.get("home"), "known": a.get("known", ""), "site": bool(a.get("site"))} for a in apps],
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
            terminal_seen(folder)
            data, ended, started = terminal_read(folder, offset)
            return self.send_json(200, {"data": base64.b64encode(data).decode(), "offset": offset + len(data),
                                        "ended": ended, "started": started})
        if path.startswith("/api/files"):
            return self.files_get(path, query)
        if path.startswith("/api/notes/"):
            return self.notes_get(path[len("/api/notes/"):], query)
        if path.startswith("/api/music/"):
            return self.music_get(path[len("/api/music/"):], query)
        if path.startswith("/api/gallery/"):
            return self.gallery_get(path[len("/api/gallery/"):], query)
        if path.startswith("/api/paperless/"):
            return self.documents_get(path[len("/api/paperless/"):], query)
        if path.startswith("/api/calendar/"):
            return self.calendar_get(path[len("/api/calendar/"):], query)
        if path.startswith("/api/tasks/"):
            return self.tasks_get(path[len("/api/tasks/"):], query)
        if path.startswith("/api/frame/"):
            app = next((a for a in installed_apps() if a["id"] == path[len("/api/frame/"):]), None)
            if not app:
                return self.send_json(404, {"error": "no such app"})
            return self.send_json(200, frame_answer(app, self.headers.get("Host", ""), query.get("secure", ["0"])[0] == "1"))
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

    def read_json(self, limit=4096):
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if not 0 < length <= limit:
            return None
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            return None
        return body if isinstance(body, dict) else None

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if self.cross_site():
            return self.send_json(403, {"error": "only adlerOS's own page can do that"})
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
        # Saving a file from the editor is the one big body.
        body = self.read_json(TEXT_LIMIT * 2 + 4096 if path == "/api/files/text"
                              else 256 * 1024 if path.startswith("/api/files/")
                              else 2 * 1024 * 1024 if path.startswith("/api/music/") else 4096)
        if body is None:
            return self.send_json(400, {"error": "expected a JSON object"})
        if path == "/api/settings":
            return self.update_settings(body)
        if path == "/api/password":
            return self.change_password(body)
        if path == "/api/admin":
            return self.set_admin(body)
        if path.startswith("/api/files/"):
            _search_wake.set()  # it may change what search should find
            return self.files_post(path[len("/api/files/"):], body)
        if path.startswith("/api/notes/"):
            _search_wake.set()
            return self.notes_post(path[len("/api/notes/"):], body)
        if path.startswith("/api/music/"):
            return self.music_post(path[len("/api/music/"):], body)
        if path == "/api/calendar/event":
            return self.calendar_post(body)
        if path == "/api/tasks/change":
            return self.tasks_post(body)
        if path == "/api/gallery/search":
            return self.gallery_search(body)
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
            if not all(isinstance(a, str) and (a in installed or a in BUILTIN_PINS) for a in pins):
                return self.send_json(400, {"error": "dock: only installed apps and adlerOS's own can be pinned"})
            changes["dock"] = pins
        if "folders" in body:
            # Every folder at once: {id: {name, collection, apps}}; an app in
            # one folder at most.
            folders, ids = body["folders"], {a["id"] for a in installed_apps()}
            choices = {c["id"] for c in collection_choices()}
            seen, ok = set(), isinstance(folders, dict) and len(folders) <= 60
            for fid, f in folders.items() if ok else []:
                apps = f.get("apps") if isinstance(f, dict) else None
                name = f.get("name") if isinstance(f, dict) else None
                ok = (isinstance(fid, str) and bool(FOLDER_ID.fullmatch(fid)) and isinstance(name, str)
                      and 0 < len(name.strip()) <= 30 and name.isprintable() and f.get("collection") in choices
                      and isinstance(apps, list) and 0 < len(apps) <= 100 and len(set(map(str, apps))) == len(apps)
                      and all(isinstance(a, str) and a in ids and a not in seen for a in apps))
                if not ok:
                    break
                seen |= set(apps)
            if not ok:
                return self.send_json(400, {"error": "folders: {id: {name: up to 30 characters, collection, apps: installed apps, each in one folder}}"})
            changes["folders"] = {fid: {"name": f["name"].strip(), "collection": f["collection"], "apps": f["apps"]}
                                  for fid, f in folders.items()}
        if "order" in body:
            # One or more collections' new arrangement, merged into the rest.
            # A folder takes its place as "folder:<id>".
            order = body["order"]
            folder_ids = set(changes["folders"] if "folders" in changes else app_folders())
            # adlerOS's own apps too: the home screen's first page is theirs.
            ids = {a["id"] for a in installed_apps()} | {f"folder:{f}" for f in folder_ids} | set(BUILTIN_PINS)
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
        if "place" in body:
            # {"app": id, "collection": c}: the app shows in c from now on;
            # null (or its own collection) puts it back.
            place, apps = body["place"], {a["id"]: a for a in installed_apps()}
            choices = {c["id"] for c in collection_choices()}
            if (not isinstance(place, dict) or place.get("app") not in apps
                    or not (place.get("collection") is None or place.get("collection") in choices)):
                return self.send_json(400, {"error": "place: {app: an installed app, collection: one of the collections, or null}"})
            mine = placements()
            if place["collection"] in (None, apps[place["app"]]["genre"]):
                mine.pop(place["app"], None)
            else:
                mine[place["app"]] = place["collection"]
            changes["placed"] = mine
            # Out of any folder of where it was (a folder lives in one collection).
            if "folders" not in body:
                folders = app_folders()
                for f in folders.values():
                    if place["app"] in f["apps"]:
                        f["apps"].remove(place["app"])
                changes["folders"] = {k: f for k, f in folders.items() if f["apps"]}
        if "welcomed" in body:
            # The first-run welcome: seen (or skipped), so it doesn't come back.
            if not isinstance(body["welcomed"], bool):
                return self.send_json(400, {"error": "welcomed: true or false"})
            changes["welcomed"] = body["welcomed"]
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

    # ---------------------------------------------------------- files

    def files_get(self, path, query):
        on = places_on()
        if not on:
            return self.send_json(404, {"error": "no storage folder is mounted"})
        if path == "/api/files/trash":
            return self.send_json(200, {"items": trash_items()})
        if path == "/api/files/search":
            q = query.get("q", [""])[0]
            return self.send_json(200, search_files(q[:200]))
        if path == "/api/files/tasks":
            with _tasks_lock:
                return self.send_json(200, {"tasks": list(TASKS.values())})
        rel = query.get("path", ["/"])[0]
        places = [{"place": p, "name": PLACE_LABELS[p]} for p in on]
        if path == "/api/files":
            if rel.strip("/") == "":
                entries = [{"name": PLACE_LABELS[p], "dir": True, "size": None, "mtime": None, "kind": "folder",
                            "link": False, "outside": False, "place": p} for p in on]
                return self.send_json(200, {"path": "/", "place": None, "places": places, "entries": entries,
                                            "writable": False, "admin": admin_on()})
            place, real = locate(rel)
            if not real or not real.is_dir():
                return self.send_json(404, {"error": "no such folder"})
            try:
                entries = list_folder(place, real)
            except OSError as e:
                return self.send_json(403, {"error": f"can't read it: {e.strerror}"})
            return self.send_json(200, {"path": place_path(place, real), "place": place, "places": places,
                                        "entries": entries, "writable": place in WRITABLE or root_writes(),
                                        "admin": admin_on(), "rootAllowed": terminal_enabled()})
        place, real = locate(rel)
        if not real or not real.is_file():
            return self.send_json(404, {"error": "no such file"})
        if path == "/api/files/text":
            st = real.stat()
            if st.st_size > TEXT_LIMIT:
                return self.send_json(413, {"error": "too big to edit here (over 2 MB); download it instead"})
            try:
                text = real.read_bytes().decode("utf-8")
            except UnicodeDecodeError:
                return self.send_json(415, {"error": "not a text file (or not UTF-8)"})
            return self.send_json(200, {"path": place_path(place, real), "place": place, "text": text,
                                        "mtime": st.st_mtime, "writable": place in WRITABLE or root_writes()})
        if path == "/api/files/raw":
            return self.send_file_stream(real, inline=query.get("inline", ["0"])[0] == "1")
        return self.send(404, b"not found")

    def send_file_stream(self, real, inline):
        """A file, streamed; Range requests (seeking in a video) work. Inline
        only for types that can't run code."""
        size = real.stat().st_size
        ctype = INLINE_TYPES.get(real.suffix.lower()) if inline else None
        start, end = 0, size - 1
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if match and size:
            a, b = match.groups()
            start = int(a) if a else max(0, size - int(b or 0))
            end = min(size - 1, int(b)) if a and b else size - 1
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        self.send_response(206 if match and size else 200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(max(0, end - start + 1)))
        self.send_header("Accept-Ranges", "bytes")
        if match and size:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        quoted = urllib.parse.quote(real.name)
        self.send_header("Content-Disposition", f"{'inline' if ctype else 'attachment'}; filename*=UTF-8''{quoted}")
        # PDFs keep the browser's viewer; everything else can't run anything.
        self.send_header("Content-Security-Policy", "default-src 'none'" if real.suffix.lower() == ".pdf" else "default-src 'none'; img-src 'self'; media-src 'self'; sandbox")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "private, no-cache")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(real, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1024 * 1024, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def root_refused(self):
        """Sends why Root can't change right now (and says so), else False."""
        if not admin_on():
            self.send_json(403, {"error": "Root is read-only. Switch admin mode on (Settings) to change it.", "admin": True})
            return True
        if not terminal_enabled():
            self.send_json(403, {"error": "Root is read-only on this machine: changing it needs ADLEROS_TERMINAL=on, like the terminal."})
            return True
        return False

    def root_change(self, op, **details):
        """A change in Root, done by the helper: the page waits for the job."""
        if self.root_refused():
            return None
        job, error = root_request(op, **details)
        if error:
            return self.send_json(409, {"error": error})
        return self.send_json(202, {"ok": True, "job": job})

    # adlermd: its vaults, a vault's index, search in it, renames that keep
    # links working.
    def notes_get(self, what, query):
        if not places_on():
            return self.send_json(404, {"error": "no storage folder is mounted"})
        if what == "vaults":
            current = load_settings().get("vault")
            found = vault_list()
            return self.send_json(200, {"vaults": [{"path": v, "name": v.rstrip("/").rsplit("/", 1)[-1], "default": v == default_vault()}
                                                   for v in found],
                                        "current": current if current in found else (found[0] if found else None)})
        vault = query.get("vault", [""])[0]
        if what == "index":
            index = vault_index(vault)
            return self.send_json(200, index) if index else self.send_json(404, {"error": "no such vault"})
        if what == "search":
            return self.send_json(200, {"hits": vault_search(vault, query.get("q", [""])[0][:200])})
        return self.send_json(404, {"error": "not found"})

    def notes_post(self, what, body):
        if not places_on():
            return self.send_json(404, {"error": "no storage folder is mounted"})
        if what == "rename":
            vault, old, new = body.get("vault"), body.get("from"), body.get("to")
            if not all(isinstance(x, str) and 0 < len(x) < 2000 for x in (vault, old, new)):
                return self.send_json(400, {"error": "expected vault, from and to"})
            result = vault_rename(vault, old, new, links=body.get("links") is not False)
            return self.send_json(200 if result.get("ok") else 409, result)
        if what == "vaults":
            # {"use": path}, {"add": path}, {"remove": path}, or {"create": {"in": folder, "name": name}}.
            saved = [v for v in load_settings().get("vaults") or [] if isinstance(v, str)]
            if "create" in body:
                c = body["create"] if isinstance(body["create"], dict) else {}
                place, parent = locate(c.get("in", ""))
                if not parent or not parent.is_dir() or place not in WRITABLE or not good_name(c.get("name")):
                    return self.send_json(400, {"error": "a folder in your Desktop or User, and a name without /"})
                real = parent / c["name"]
                if real.exists():
                    return self.send_json(409, {"error": "there's one by that name already"})
                (real / ".obsidian").mkdir(parents=True)  # a vault to Obsidian too
                body = {"add": place_path(place, real), "use": True}
            path = body.get("add") or body.get("remove") or body.get("use")
            if not isinstance(path, str):
                return self.send_json(400, {"error": "expected a vault"})
            if body.get("add"):
                place, real = locate(path)
                if not real or not real.is_dir():
                    return self.send_json(400, {"error": "that isn't a folder"})
                path = place_path(place, real)
                saved = [*[v for v in saved if v != path], path][-20:]
                save_settings({"vaults": saved, **({"vault": path} if body.get("use") else {})})
            elif body.get("remove"):
                save_settings({"vaults": [v for v in saved if v != path]})  # the folder itself stays
            else:
                if path not in vault_list():
                    return self.send_json(400, {"error": "not one of your vaults"})
                save_settings({"vault": path})
            return self.send_json(200, {"ok": True, "vault": path})
        return self.send_json(404, {"error": "not found"})

    # Music: the library, a song's tags, cover and lyrics, an .m3u8 anywhere,
    # plays, and playlists to make, change and delete.
    def music_get(self, what, query):
        if what == "stations":
            return self.send_json(200, {"stations": radio_stations()})
        if what.startswith("station/"):
            return self.radio_get(what[len("station/"):])
        if not places_on():
            return self.send_json(404, {"error": "no storage folder is mounted"})
        item = query.get("id", [""])[0]
        if what == "navidrome":
            # Whether Music is connected to Navidrome (and if not, why not),
            # with its stars and plays brought over.
            status = navidrome_sync()
            return self.send_json(200, {**status, "favorites": music_favorites()["songs"], "counts": music_counts(music_plays())})
        if what == "library":
            lib = music_library()
            if lib["songs"] is None:
                return self.send_json(200, {"scanning": True, "done": lib["done"], "total": lib["total"], "dir": lib["dir"]})
            plays = music_plays()
            body = json.dumps({"dir": lib["dir"], "found": bool(lib["top"]), "songs": lib["songs"], "playlists": lib["playlists"],
                               "scanning": lib["scanning"], "plays": {**plays, "counts": music_counts(plays)},
                               "favorites": music_favorites()["songs"]}, separators=(",", ":")).encode()
            headers = [("Cache-Control", "no-store"), ("Vary", "Accept-Encoding")]
            if "gzip" in self.headers.get("Accept-Encoding", ""):
                body = gzip.compress(body, 6)
                headers.append(("Content-Encoding", "gzip"))
            return self.send(200, body, "application/json", headers)
        if what == "track":
            song = music_track(item)
            return self.send_json(200, song) if song else self.send_json(404, {"error": "not a song adlerOS can play"})
        if what == "playlist":
            place, real = locate(query.get("path", [""])[0])
            if not real or not real.is_file() or real.suffix.lower() not in PLAYLIST_SUFFIXES:
                return self.send_json(404, {"error": "no such playlist"})
            lib = music_library()
            known = {s["id"]: s for s in lib["songs"] or []}
            found = music_playlist(real, music_dir()[1], None)
            extra = {i: t for i in found["items"] if i not in known for t in [music_track(i)] if t}
            return self.send_json(200, {**found, "items": [i for i in found["items"] if i in known or i in extra], "songs": extra})
        real, _ = music_item(item)
        if not real or real.suffix.lower() not in MUSIC_SUFFIXES:
            return self.send_json(404, {"error": "no such song"})
        if what == "cover":
            found = music_cover(real)
            if not found:
                return self.send(404, b"no cover")
            return self.send(200, found[1], found[0], [("Cache-Control", "private, max-age=604800")], csp="default-src 'none'; sandbox")
        if what == "lyrics":
            return self.send_json(200, music_lyrics(real) or {"text": None})
        return self.send_json(404, {"error": "not found"})

    def radio_get(self, what):
        sid, _, part = what.partition("/")
        st = next((x for x in radio_stations() if x["id"] == sid), None)
        if not st:
            return self.send_json(404, {"error": "no such station"})
        if part == "now":
            now = _radio_now.get(sid) or {}
            return self.send_json(200, {"title": now.get("title") if time.time() - now.get("at", 0) < 600 else None})
        if part == "check":
            # Why one didn't play: an HLS stream (the browser's to play), or the station's answer.
            try:
                r, at = radio_open(st["url"])
                r.close()
                return self.send_json(200, {"ok": True, "at": at})
            except LookupError as e:
                return self.send_json(200, {"ok": False, "hls": str(e)})
            except urllib.error.HTTPError as e:
                return self.send_json(200, {"ok": False, "error": f"the station said {e.code}"})
            except (OSError, ValueError) as e:
                return self.send_json(200, {"ok": False, "error": f"can't reach it ({e})"})
        if part != "stream":
            return self.send_json(404, {"error": "not found"})
        try:
            r, _ = radio_open(st["url"])
        except LookupError as e:
            # An HLS stream: the browser plays it itself, if it can.
            return self.send_json(415, {"error": "an HLS stream", "hls": str(e)})
        except urllib.error.HTTPError as e:
            return self.send_json(502, {"error": f"the station said {e.code}"})
        except (OSError, ValueError) as e:
            return self.send_json(502, {"error": f"can't reach the station ({e})"})
        with r:
            ctype = (r.headers.get("Content-Type") or "audio/mpeg").split(";")[0].strip().lower()
            if not ctype.startswith(("audio/", "application/ogg", "video/")):
                ctype = "audio/mpeg"
            try:
                every = int(r.headers.get("icy-metaint") or 0)
            except ValueError:
                every = 0
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command == "HEAD":
                return
            # The sound to the browser; every so many bytes (icy-metaint) a
            # block of what's on now, kept here and left out of the sound.
            try:
                while True:
                    if every:
                        audio = r.read(every)
                        if not audio:
                            break
                        self.wfile.write(audio)
                        size = r.read(1)
                        if not size:
                            break
                        meta = r.read(size[0] * 16) if size[0] else b""
                        title = radio_title(meta) if meta else None
                        if title is not None:
                            _radio_now[sid] = {"title": title, "at": time.time()}
                    else:
                        chunk = r.read(32 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

    def radio_post(self, body):
        """Stations added (from files' text, a file in your storage, an
        address), renamed or removed."""
        if not isinstance(body, dict):
            return self.send_json(400, {"error": "a JSON object"})
        if "remove" in body:
            with _radio_lock:
                stations = radio_stations()
                kept = [x for x in stations if x["id"] != body["remove"]]
                radio_save(kept)
            return self.send_json(200 if len(kept) < len(stations) else 404, {"stations": kept})
        if "rename" in body:
            name = str(body.get("name") or "").strip()[:80]
            if not name:
                return self.send_json(400, {"error": "a name"})
            with _radio_lock:
                stations = radio_stations()
                for x in stations:
                    if x["id"] == body["rename"]:
                        x["name"] = name
                radio_save(stations)
            return self.send_json(200, {"stations": stations})
        if "order" in body and isinstance(body["order"], list):
            with _radio_lock:
                stations = radio_stations()
                rank = {sid: i for i, sid in enumerate(body["order"]) if isinstance(sid, str)}
                stations.sort(key=lambda x: rank.get(x["id"], len(rank)))
                radio_save(stations)
            return self.send_json(200, {"stations": stations})
        found, problems = [], []
        for f in body.get("files") or []:
            if not isinstance(f, dict) or not isinstance(f.get("text"), str):
                continue
            name = str(f.get("name") or "")[:200]
            try:
                got = radio_parse(f["text"][:256 * 1024], name)
            except ValueError as e:
                problems.append(f"{name}: {e}")
                continue
            if not got:
                problems.append(f"{name}: no station's address in it")
            found += got
        if isinstance(body.get("path"), str):
            place, real = locate(body["path"])
            if not real or not real.is_file() or real.suffix.lower() not in RADIO_FILE_TYPES:
                return self.send_json(404, {"error": "no such station file"})
            try:
                if real.stat().st_size > 256 * 1024:
                    raise ValueError("too big for a station's file")
                got = radio_parse(real.read_text("utf-8", "replace"), real.name)
            except (OSError, ValueError) as e:
                return self.send_json(400, {"error": str(e)})
            if not got:
                return self.send_json(400, {"error": f"{real.name} has no station's address in it"})
            found += got
        if body.get("url") is not None:
            url = radio_url(str(body.get("url")))
            if not url:
                return self.send_json(400, {"error": "an http:// or https:// address"})
            found.append((str(body.get("name") or "").strip()[:80], url))
        if not found:
            return self.send_json(400, {"error": "; ".join(problems) or "no stations in that"})
        added, already = radio_add(found)
        # Already there: the ones a file named, for playing straight away.
        urls = [u for _, u in found]
        named = [x for x in radio_stations() if x["url"] in urls]
        return self.send_json(200, {"added": added, "already": already, "stations": radio_stations(), "named": named, "problems": problems})

    def music_post(self, what, body):
        if what == "stations":
            return self.radio_post(body)
        if not places_on():
            return self.send_json(404, {"error": "no storage folder is mounted"})
        if what in ("played", "playing"):
            real, sid = music_item(body.get("id"))
            if not real:
                return self.send_json(404, {"error": "no such song"})
            if what == "played":
                music_played(sid)
            navidrome_scrobble(sid, played=what == "played")
            return self.send_json(200, {"ok": True})
        if what == "favorite":
            real, sid = music_item(body.get("id"))
            if not real or sid.startswith("/"):
                return self.send_json(404, {"error": "only songs in your music folder can be favorites"})
            music_favorite(sid, bool(body.get("on")))
            return self.send_json(200, {"ok": True})
        if what != "playlists":
            return self.send_json(404, {"error": "not found"})
        virtual, top = music_dir()
        lib = music_library()
        songs = {s["id"]: s for s in lib["songs"] or []}
        if "delete" in body:
            real, place = self.music_list_file(body.get("delete"), virtual)
            if not real:
                return self.send_json(404, {"error": "no such playlist"})
            to_trash(place, real)
            with _music_lock:
                _music["playlists"] = [p for p in _music["playlists"] if p["id"] != body["delete"]]
                _music["at"] = 0
            return self.send_json(200, {"ok": True})
        save = body.get("save") if isinstance(body.get("save"), dict) else None
        if not save or not isinstance(save.get("items"), list) or not all(isinstance(i, str) for i in save["items"]):
            return self.send_json(400, {"error": "expected {save: {id, name, items}} or {delete: id}"})
        name = save.get("name")
        if not good_name(name) or len(name) > 200:
            return self.send_json(400, {"error": "a name, without /"})
        if save.get("id"):
            real, place = self.music_list_file(save["id"], virtual)
            if not real:
                return self.send_json(404, {"error": "no such playlist"})
            if name != real.stem:
                moved = real.with_name(name + real.suffix)
                if moved.exists():
                    return self.send_json(409, {"error": "there's a playlist by that name already"})
                real.rename(moved)
                real = moved
        else:
            if not top:
                return self.send_json(404, {"error": f"there's no music folder ({virtual})"})
            real = top / f"{name}.m3u8"
            if real.exists():
                return self.send_json(409, {"error": "there's a playlist by that name already"})
        write_playlist(real, save["items"][:20000], songs)
        found = music_playlist(real, top, None)
        with _music_lock:
            _music["playlists"] = [*[p for p in _music["playlists"] if p["id"] not in (found["id"], save.get("id"))], found]
            _music["at"] = 0
        return self.send_json(200, found)

    # Gallery: what it asks Immich, passed on (the key stays here).
    def gallery_get(self, what, query):
        try:
            if what == "status":
                return self.send_json(200, gallery_status())
            filters = ("albumId", "personId", "isFavorite", "order", "visibility")
            if what == "buckets":
                return self.send_json(200, immich_json("timeline/buckets", gallery_query(query, filters)))
            if what == "bucket":
                q = gallery_query(query, (*filters, "timeBucket"))
                if "timeBucket" not in q:
                    raise ValueError("timeBucket: a date")
                return self.send_json(200, immich_json("timeline/bucket", q))
            if what == "albums":
                return self.send_json(200, immich_json("albums"))
            if what == "people":
                people = []
                for page in range(1, 21):
                    got = immich_json("people", {"withHidden": "false", "page": page, "size": 500})
                    people += got.get("people") or []
                    if not got.get("hasNextPage"):
                        break
                return self.send_json(200, {"people": people})
            if what == "memories":
                try:  # today's (On this day), not every one there's been
                    return self.send_json(200, immich_json("memories", {"for": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}))
                except urllib.error.HTTPError as e:
                    if e.code == 403:
                        return self.send_json(200, [])  # the key may not read them: none
                    raise
            if what == "local":
                return self.gallery_local_reply()
            if what == "local-thumb":
                return self.gallery_local_thumb(query.get("path", [""])[0])
            if what == "markers":
                return self.send_json(200, [{k: m.get(k) for k in ("id", "lat", "lon", "city", "state", "country")}
                                            for m in immich_json("map/markers")])
            if what == "cities":
                return self.send_json(200, [{"id": a["id"], "city": (a.get("exifInfo") or {}).get("city"), "state": (a.get("exifInfo") or {}).get("state"),
                                             "country": (a.get("exifInfo") or {}).get("country")} for a in immich_json("search/cities")])
            kind, _, aid = what.partition("/")
            if not UUID_RE.match(aid):
                return self.send_json(404, {"error": "not found"})
            if kind == "faces":
                return self.send_json(200, [{"box": [f.get("boundingBoxX1"), f.get("boundingBoxY1"), f.get("boundingBoxX2"), f.get("boundingBoxY2")],
                                             "size": [f.get("imageWidth"), f.get("imageHeight")],
                                             "person": {k: (f.get("person") or {}).get(k) for k in ("id", "name")} if f.get("person") else None}
                                            for f in immich_json("faces", {"id": aid})])
            if kind == "album-zip-info":
                info = immich_json("download/info", body={"albumId": aid}, method="POST")
                return self.send_json(200, {"totalSize": info.get("totalSize"), "parts": [a.get("size") for a in info.get("archives") or []]})
            if kind == "album-zip":
                return self.gallery_album_zip(aid, query)
            if kind == "asset":
                return self.send_json(200, immich_json(f"assets/{aid}"))
            if kind == "albums-of":
                return self.send_json(200, immich_json("albums", {"assetId": aid}))
            if kind == "album":
                return self.send_json(200, immich_json(f"albums/{aid}", {"withoutAssets": "true"}))
            if kind == "person":
                return self.send_json(200, immich_json(f"people/{aid}"))
            if kind == "thumb":
                size = gallery_query(query, ("size",)).get("size", "thumbnail")
                return self.gallery_stream(f"assets/{aid}/thumbnail", {"size": size}, ("image/",), cache=86400)
            if kind == "face":
                return self.gallery_stream(f"people/{aid}/thumbnail", None, ("image/",), cache=86400)
            if kind == "video":
                return self.gallery_stream(f"assets/{aid}/video/playback", None, ("video/",))
            if kind == "original":
                return self.gallery_stream(f"assets/{aid}/original", None, None, download=True)
            return self.send_json(404, {"error": "not found"})
        except LookupError:
            return self.send_json(409, {"error": "Gallery isn't set up", "status": gallery_status()})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except urllib.error.HTTPError as e:
            return self.send_json(e.code if e.code in (400, 401, 403, 404) else 502, {"error": f"Immich said {e.code}", "immich": e.code})
        except OSError as e:
            return self.send_json(502, {"error": f"can't reach Immich ({e})"})

    # Documents: what it asks Paperless, passed on (the token stays here).
    def documents_get(self, what, query):
        try:
            if what == "status":
                return self.send_json(200, documents_status())
            if what == "local":
                return self.send_json(200, documents_local())
            if what == "list":
                return self.send_json(200, paperless_json("documents/", documents_query(query)))
            if what == "meta":
                return self.send_json(200, {
                    "tags": [{k: t.get(k) for k in ("id", "name", "color", "text_color", "is_inbox_tag", "document_count", "parent")} for t in paperless_all("tags/")],
                    "correspondents": [{k: c.get(k) for k in ("id", "name", "document_count", "last_correspondence")} for c in paperless_all("correspondents/")],
                    "types": [{k: t.get(k) for k in ("id", "name", "document_count")} for t in paperless_all("document_types/")],
                })
            kind, _, did = what.partition("/")
            if not did.isdigit() or not 0 < int(did) < 10 ** 9:
                return self.send_json(404, {"error": "not found"})
            if kind == "doc":
                return self.send_json(200, paperless_json(f"documents/{did}/"))
            if kind == "metadata":
                return self.send_json(200, paperless_json(f"documents/{did}/metadata/"))
            if kind == "thumb":
                return self.paperless_stream(f"documents/{did}/thumb/", None, ("image/",), cache=3600)
            if kind == "preview":
                return self.paperless_stream(f"documents/{did}/preview/", None, ("application/pdf", "image/"), inline_pdf=True)
            if kind == "download":
                return self.paperless_stream(f"documents/{did}/download/", {"original": "true"}, None, download=True)
            return self.send_json(404, {"error": "not found"})
        except LookupError:
            return self.send_json(409, {"error": "Documents isn't set up", "status": documents_status()})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except urllib.error.HTTPError as e:
            return self.send_json(e.code if e.code in (400, 401, 403, 404) else 502, {"error": f"Paperless said {e.code}", "paperless": e.code})
        except OSError as e:
            return self.send_json(502, {"error": f"can't reach Paperless ({e})"})

    def tasks_get(self, what, query):
        try:
            if what == "status":
                return self.send_json(200, tasks_status())
            return self.send_json(200, tasks_read(what, query))
        except KeyError as e:
            return self.send_json(404, {"error": str(e).strip("'")})
        except LookupError:
            return self.send_json(409, {"error": "Tasks isn't connected to Vikunja"})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except urllib.error.HTTPError as e:
            return self.send_json(502, {"error": f"Vikunja said {e.code}", "vikunja": e.code})
        except OSError as e:
            return self.send_json(502, {"error": f"can't reach Vikunja ({e})"})

    def tasks_post(self, body):
        if not isinstance(body, dict):
            return self.send_json(400, {"error": "a JSON object"})
        try:
            return self.send_json(200, tasks_write(body))
        except KeyError as e:
            return self.send_json(404, {"error": str(e).strip("'")})
        except LookupError:
            return self.send_json(409, {"error": "Tasks isn't connected to Vikunja"})
        except (ValueError, TypeError) as e:
            return self.send_json(400, {"error": str(e)})
        except urllib.error.HTTPError as e:
            try:
                said = json.loads(e.read()).get("message")
            except (ValueError, AttributeError, OSError):
                said = None
            return self.send_json(502, {"error": f"Vikunja said {e.code}{f': {said}' if said else ''}", "vikunja": e.code})
        except OSError as e:
            return self.send_json(502, {"error": f"can't reach Vikunja ({e})"})

    def calendar_post(self, body):
        if not isinstance(body, dict):
            return self.send_json(400, {"error": "a JSON object"})
        viewer = ical.named_zone(str(body.get("tz") or "")[:64]) or datetime.timezone.utc
        try:
            return self.send_json(200, calendar_write(body, viewer))
        except LookupError as e:
            return self.send_json(409, {"error": "Calendar isn't set up" if str(e) == "not set up" else str(e)})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except urllib.error.HTTPError as e:
            if e.code == 412:
                return self.send_json(409, {"error": "It changed somewhere else meanwhile: it's shown as it is now; make your change again.", "conflict": True})
            if e.code in (401, 403):
                return self.send_json(403, {"error": "The calendar server didn't let it be changed (a calendar you may only read?)."})
            return self.send_json(502, {"error": f"the calendar server said {e.code}"})
        except (OSError, ElementTree.ParseError) as e:
            return self.send_json(502, {"error": f"can't reach the calendar server ({e})"})

    def calendar_get(self, what, query):
        try:
            if what == "status":
                return self.send_json(200, calendar_status())
            if what == "events":
                return self.send_json(200, calendar_events(query))
            return self.send_json(404, {"error": "not found"})
        except LookupError:
            return self.send_json(409, {"error": "Calendar isn't set up", "status": calendar_status()})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except urllib.error.HTTPError as e:
            return self.send_json(502, {"error": f"the calendar server said {e.code}", "caldav": e.code})
        except (OSError, ElementTree.ParseError) as e:
            return self.send_json(502, {"error": f"can't reach the calendar server ({e})"})

    def paperless_stream(self, path, query, kinds, cache=0, download=False, inline_pdf=False):
        """A thumbnail, a preview or an original from Paperless, as it sends it."""
        try:
            r = paperless_open(path, query, timeout=60)
        except urllib.error.HTTPError as e:
            return self.send(e.code if e.code == 404 else 502, b"")
        with r:
            ctype = (r.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip().lower()
            if kinds and not ctype.startswith(kinds):
                return self.send(502, b"not a picture or a PDF")
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream" if download else ctype)
            if r.headers.get("Content-Length"):
                self.send_header("Content-Length", r.headers["Content-Length"])
            given = r.headers.get("Content-Disposition") or ""
            self.send_header("Content-Disposition", ("attachment" + given[given.index(";"):] if ";" in given else "attachment") if download else "inline")
            # A PDF keeps the browser's own viewer; anything else can't run a thing.
            self.send_header("Content-Security-Policy", "default-src 'none'" if inline_pdf and ctype == "application/pdf" else "default-src 'none'; sandbox")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", f"private, max-age={cache}" if cache else "private, no-cache")
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                while chunk := r.read(256 * 1024):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def documents_upload(self, query):
        """A file for Paperless to read (PUT, the file as the body): its task's id."""
        name = query.get("name", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if not good_name(name) or len(name) > 200:
            return self.send_json(400, {"error": "a file name"})
        if not 0 < length <= UPLOAD_PAPERLESS_LIMIT:
            return self.send_json(413, {"error": "too big (200 MB at most)"})
        data = self.rfile.read(length)
        if len(data) != length:
            return self.send_json(400, {"error": "the upload stopped part-way"})
        boundary = secrets.token_hex(16)
        quoted = name.replace('"', "_").replace("\r", "_").replace("\n", "_")
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{quoted}"\r\n'
                f"Content-Type: application/octet-stream\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
        try:
            with paperless_open("documents/post_document/", data=body, method="POST", timeout=120,
                                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}) as r:
                task = json.loads(r.read() or b'""')
        except LookupError:
            return self.send_json(409, {"error": "Documents isn't set up"})
        except urllib.error.HTTPError as e:
            return self.send_json(e.code if e.code in (400, 401, 403, 413) else 502, {"error": f"Paperless said {e.code}"})
        except OSError as e:
            return self.send_json(502, {"error": f"can't reach Paperless ({e})"})
        return self.send_json(200, {"ok": True, "task": task})

    def gallery_local_reply(self):
        body = json.dumps(gallery_local(), separators=(",", ":")).encode()
        headers = [("Cache-Control", "no-store"), ("Vary", "Accept-Encoding")]
        if "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, 6)
            headers.append(("Content-Encoding", "gzip"))
        return self.send(200, body, "application/json", headers)

    def gallery_local_thumb(self, path):
        """A photo small: its EXIF thumbnail, else (a picture a browser draws) itself."""
        virtual, top = media_root("GALLERY_DIR", "Gallery")
        place, real = locate(path)
        if not top or not real or not real.is_file() or not real.is_relative_to(top.resolve()) or real.suffix.lower() not in GALLERY_SHOWN:
            return self.send(404, b"no picture")
        thumb = exif_thumbnail(real) if real.suffix.lower() in (".jpg", ".jpeg") else None
        if thumb:
            return self.send(200, thumb, "image/jpeg", [("Cache-Control", "private, max-age=86400")], csp="default-src 'none'; sandbox")
        return self.send_file_stream(real, inline=True)

    def gallery_search(self, body):
        # {query, page}: Immich's smart search; {city, country, page}: a place's photos, newest first.
        query, city = body.get("query"), body.get("city")
        page = body.get("page") or 1
        if not isinstance(page, int) or not 0 < page < 1000 or not any(isinstance(x, str) and x.strip() and len(x) <= 500 for x in (query, city)) \
                or not all(x is None or isinstance(x, str) and len(x) <= 500 for x in (query, city, body.get("country"))):
            return self.send_json(400, {"error": "expected {query, page} or {city, country, page}"})
        try:
            if city:
                found = immich_json("search/metadata", body={"city": city, **({"country": body["country"]} if body.get("country") else {}),
                                                             "page": page, "size": 100, "withExif": True, "order": "desc"}, method="POST")
            else:
                found = immich_json("search/smart", body={"query": query.strip(), "page": page, "size": 100, "withExif": True}, method="POST")
        except LookupError:
            return self.send_json(409, {"error": "Gallery isn't set up"})
        except urllib.error.HTTPError as e:
            return self.send_json(e.code if e.code in (400, 401, 403) else 502, {"error": f"Immich said {e.code}", "immich": e.code})
        except OSError as e:
            return self.send_json(502, {"error": f"can't reach Immich ({e})"})
        assets = found.get("assets") or {}
        return self.send_json(200, {"items": [gallery_asset_lite(a) for a in assets.get("items") or []], "nextPage": assets.get("nextPage")})

    def gallery_album_zip(self, aid, query):
        """An album's photos as a zip (a part of it, when Immich splits a big one)."""
        part = query.get("part", ["0"])[0]
        if not part.isdigit():
            return self.send_json(400, {"error": "part: a number"})
        info = immich_json("download/info", body={"albumId": aid}, method="POST")
        archives = info.get("archives") or []
        if int(part) >= len(archives):
            return self.send_json(404, {"error": "no such part"})
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", immich_json(f"albums/{aid}", {"withoutAssets": "true"}).get("albumName") or "Album")[:120]
        filename = f"{name}{f' ({int(part) + 1} of {len(archives)})' if len(archives) > 1 else ''}.zip"
        r = immich_open("download/archive", body={"assetIds": archives[int(part)]["assetIds"]}, method="POST", timeout=120)
        with r:
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            if r.headers.get("Content-Length"):
                self.send_header("Content-Length", r.headers["Content-Length"])
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}")
            self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            try:
                while chunk := r.read(256 * 1024):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def gallery_stream(self, path, query, kinds, cache=0, download=False):
        """A picture or a video from Immich, as it sends it (Range too: seeking)."""
        try:
            r = immich_open(path, query, headers={"Range": self.headers["Range"]} if self.headers.get("Range") else None, timeout=60)
        except LookupError:
            return self.send(409, b"Gallery isn't set up")
        except urllib.error.HTTPError as e:
            return self.send(e.code if e.code in (404, 416) else 502, b"")
        except OSError:
            return self.send(502, b"can't reach Immich")
        with r:
            ctype = (r.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip().lower()
            if kinds and not ctype.startswith(kinds):
                return self.send(502, b"not a picture or a video")
            self.send_response(r.status)
            self.send_header("Content-Type", "application/octet-stream" if download else ctype)
            for name in ("Content-Length", "Content-Range", "Accept-Ranges"):
                if r.headers.get(name):
                    self.send_header(name, r.headers[name])
            given = r.headers.get("Content-Disposition") or ""
            self.send_header("Content-Disposition", ("attachment" + given[given.index(";"):] if ";" in given else "attachment") if download else "inline")
            self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", f"private, max-age={cache}" if cache else "private, no-cache")
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                while chunk := r.read(256 * 1024):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the page stopped it (a video sought elsewhere)

    def music_list_file(self, pid, virtual):
        """(real file, place) for a playlist's id, if it may change."""
        if not isinstance(pid, str) or not pid:
            return None, None
        place, real = locate(pid if pid.startswith("/") else f"{virtual}/{pid}")
        if not real or not real.is_file() or real.suffix.lower() not in PLAYLIST_SUFFIXES or place not in WRITABLE:
            return None, None
        return real, place

    def files_post(self, what, body):
        if not places_on():
            return self.send_json(404, {"error": "no storage folder is mounted"})

        def in_trash(place, real):
            return place in WRITABLE and real.is_relative_to(PLACES[place].resolve() / TRASH)

        if what == "text":
            # Save from the editor; with "mtime", only if nobody changed it since.
            place, real = locate(body.get("path"), must_exist=False)
            text = body.get("text")
            if not real or is_top(place, real) or in_trash(place, real) or not isinstance(text, str):
                return self.send_json(400, {"error": "expected path and text"})
            data = text.encode("utf-8")
            if len(data) > TEXT_LIMIT:
                return self.send_json(413, {"error": "too big (over 2 MB)"})
            if place == "root":
                return self.root_change("text", path=place_path(place, real), text=text, mtime=body.get("mtime"))
            if real.exists():
                if not real.is_file():
                    return self.send_json(409, {"error": "that's a folder"})
                if isinstance(body.get("mtime"), (int, float)) and abs(real.stat().st_mtime - body["mtime"]) > 0.001:
                    return self.send_json(409, {"error": "changed since you opened it", "conflict": True})
            elif body.get("mtime") is not None or not real.parent.is_dir():
                return self.send_json(404, {"error": "it's gone, or its folder is"})
            if body.get("create") is True and real.exists():
                return self.send_json(409, {"error": "there's one by that name already", "exists": True})
            tmp = real.with_name(f".{real.name}.{secrets.token_hex(4)}.saving")
            tmp.write_bytes(data)
            if real.exists():
                os.chmod(tmp, real.stat().st_mode & 0o7777)
            os.replace(tmp, real)
            return self.send_json(200, {"ok": True, "mtime": real.stat().st_mtime, "path": place_path(place, real)})
        if what == "mkdir":
            place, parent = locate(body.get("path", ""))
            if not parent or not parent.is_dir() or in_trash(place, parent) or not good_name(body.get("name")):
                return self.send_json(400, {"error": "a folder name, without /"})
            if place == "root":
                return self.root_change("mkdir", path=place_path(place, parent), name=body["name"])
            target = parent / body["name"]
            if target.exists():
                return self.send_json(409, {"error": "there's already something called that"})
            target.mkdir()
            return self.send_json(200, {"ok": True, "path": place_path(place, target)})
        if what == "rename":
            place, real = locate(body.get("path"))
            if not real or is_top(place, real) or in_trash(place, real) or not good_name(body.get("name")):
                return self.send_json(400, {"error": "a new name, without /"})
            if place == "root":
                return self.root_change("rename", path=place_path(place, real), name=body["name"])
            target = real.parent / body["name"]
            if target.exists():
                return self.send_json(409, {"error": "there's already something called that"})
            real.rename(target)
            return self.send_json(200, {"ok": True, "path": place_path(place, target)})
        if what == "delete":
            # Into the Trash, not gone: restore from the Trash view.
            paths = body.get("paths")
            if not isinstance(paths, list) or not 0 < len(paths) <= 500:
                return self.send_json(400, {"error": "expected paths"})
            found = [locate(p) for p in paths]
            if any(not real or is_top(place, real) or in_trash(place, real) for place, real in found):
                return self.send_json(400, {"error": "can't delete that (a place itself, or something already in the Trash)"})
            in_root = [place_path(place, real) for place, real in found if place == "root"]
            if in_root and self.root_refused():
                return None
            moved = 0
            for place, real in found:
                if place in WRITABLE:
                    to_trash(place, real)
                    moved += 1
            if in_root:
                return self.root_change("delete", paths=in_root)
            return self.send_json(200, {"ok": True, "moved": moved})
        if what in ("move", "copy"):
            paths, to = body.get("paths"), body.get("to")
            if not isinstance(paths, list) or not 0 < len(paths) <= 500:
                return self.send_json(400, {"error": "expected paths"})
            dest, folder = locate(to)
            if not folder or not folder.is_dir() or in_trash(dest, folder):
                return self.send_json(400, {"error": "pick a folder to put them in"})
            sources = [locate(p) for p in paths]
            for place, src in sources:
                if not src or in_trash(place, src) or (what == "move" and is_top(place, src)):
                    return self.send_json(400, {"error": f"can't {what} that"})
                if folder == src or folder.is_relative_to(src):
                    return self.send_json(400, {"error": "a folder can't go inside itself"})
            if what == "move" and all(src.parent == folder for _, src in sources):
                return self.send_json(200, {"ok": True, "task": None})  # already there
            if dest == "root" or (what == "move" and any(place == "root" for place, _ in sources)):
                return self.root_change(what, paths=[place_path(p, s) for p, s in sources], to=place_path(dest, folder))
            task = transfer(sources, folder, copy=what == "copy")
            return self.send_json(200, {"ok": True, "task": task})
        if what in ("restore", "empty-trash"):
            ids = body.get("ids") if what == "restore" else [i["id"] for i in trash_items()]
            if not isinstance(ids, list):
                return self.send_json(400, {"error": "expected ids"})
            done, to_root = 0, []
            for item_id in ids:
                place, slot = trash_slot(item_id)
                if not slot:
                    continue
                if what == "empty-trash":
                    shutil.rmtree(slot)
                    done += 1
                    continue
                item = next((p for p in slot.iterdir() if p.name != "meta.json"), None)
                try:
                    origin = json.loads((slot / "meta.json").read_text()).get("from", "")
                except (OSError, ValueError):
                    origin = ""
                if not any(origin == f"/{p}" or origin.startswith(f"/{p}/") for p in PLACES):
                    origin = "/user" + (origin or "/" + (item.name if item else ""))
                if origin.startswith("/root/"):
                    to_root.append(item_id)
                    continue
                back, parent = locate(str(Path(origin).parent))
                if not parent or not parent.is_dir() or back not in WRITABLE:
                    parent = PLACES[place].resolve()  # its folder is gone: the top of its place
                if item:
                    shutil.move(str(item), str(unique_name(parent, item.name)))
                shutil.rmtree(slot)
                done += 1
            if to_root:
                return self.root_change("restore", ids=to_root)
            return self.send_json(200, {"ok": True, "done": done})
        return self.send(404, b"not found")

    def do_PUT(self):
        """Upload: PUT /api/files/upload?dir=/user/Documents&name=a.pdf, the
        file as the body. A cross-site page can't send a PUT with your cookie."""
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        if url.path not in ("/api/files/upload", "/api/paperless/upload"):
            return self.send(404, b"not found")
        if self.cross_site():
            return self.send_json(403, {"error": "only adlerOS's own page can do that"})
        if not self.logged_in():
            return self.send_json(401, {"error": "login required"})
        if url.path == "/api/paperless/upload":
            return self.documents_upload(query)
        if not places_on():
            return self.send_json(404, {"error": "no storage folder is mounted"})
        _search_wake.set()  # a new file to find
        place, folder = locate(query.get("dir", [""])[0])
        name = query.get("name", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if place == "root":
            return self.send_json(400, {"error": "Root takes no uploads: upload to the Desktop or User, then move it"})
        if not folder or not folder.is_dir() or not good_name(name) or folder.is_relative_to(PLACES[place].resolve() / TRASH):
            return self.send_json(400, {"error": "a folder and a file name"})
        if not 0 <= length <= UPLOAD_LIMIT:
            return self.send_json(413, {"error": "too big"})
        target = folder / name
        if target.exists() and query.get("replace", ["0"])[0] != "1":
            target = unique_name(folder, name)
        part = folder / f".{name}.{secrets.token_hex(4)}.part"
        try:
            with open(part, "wb") as f:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(1024 * 1024, left))
                    if not chunk:
                        raise OSError("the upload stopped part-way")
                    f.write(chunk)
                    left -= len(chunk)
            os.replace(part, target)
        except OSError as e:
            part.unlink(missing_ok=True)
            return self.send_json(500, {"error": str(e)})
        return self.send_json(200, {"ok": True, "path": place_path(place, target), "name": target.name})

    def open_terminal(self, body):
        """A new shell: admin mode (your password turned it on) and the
        terminal switched on, on the machine."""
        if not admin_on():
            return self.send_json(403, {"error": "admin mode is off", "admin": True})
        if not terminal_enabled():
            return self.send_json(409, {"error": "the terminal is off: set ADLEROS_TERMINAL=on and re-run install.sh"})
        if len(terminal_sessions()) >= 3:
            close_abandoned()
        if len(terminal_sessions()) >= 3:
            return self.send_json(409, {"error": "at most 3 terminals at once; close one"})
        try:
            rows, cols = int(body.get("rows", 24)), int(body.get("cols", 80))
        except (TypeError, ValueError):
            return self.send_json(400, {"error": "rows and cols: numbers"})
        sid = secrets.token_hex(16)
        TERM_DIR.mkdir(parents=True, exist_ok=True)
        # Made under a hidden name, then renamed into place whole: systemd's
        # path unit watches term/ only, so a start.json written into a new
        # folder after it looked would wait for the next request.
        ready = TERM_DIR / f".{sid}.new"
        ready.mkdir(mode=0o700)
        terminal_append(ready / "in", b"")
        write_private(ready / "start.json", json.dumps({"sid": sid, "rows": rows, "cols": cols, "created": time.time()}))
        os.rename(ready, TERM_DIR / sid)
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
        save_settings({"admin": on, "adminUntil": time.time() + ADMIN_SECONDS if on else 0})
        if not on:
            close_terminals()  # you turned it off: its shells go too
        return self.send_json(200, {"ok": True, "admin": on, "adminLeft": admin_left()})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.client()} {fmt % args}\n")


def main():
    for folder in (ICONS, QUEUE, JOBS):
        folder.mkdir(parents=True, exist_ok=True)
    cpu_usage()  # first sample, so the first Settings view has a reading
    settings = load_settings()
    if settings.get("admin") is True and "adminUntil" not in settings:
        save_settings({"adminUntil": time.time() + ADMIN_SECONDS})  # on from before it timed out: from now
    threading.Thread(target=Watcher().run, name="watcher", daemon=True).start()
    threading.Thread(target=search_indexer, name="search", daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"adlerOS on :{PORT}, for {os.environ.get('ADLEROS_NETWORKS') or 'anyone'}" if ALLOWED_NETWORKS
          else f"adlerOS on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
