#!/usr/bin/env python3
"""apps.py: install, start, stop, restart, update or delete an app, and the rest
of what the App Store and Live Usage need. The adlerOS helper (agent.py) runs
it, as your user, for the actions in actions.json:

    apps.py status                       every app's containers, as JSON
    apps.py usage                        each app's CPU and memory now, as JSON
    apps.py logs APP                     an app's recent logs, as JSON
    apps.py start|stop|restart|update|delete|install APP
    apps.py discover                     (standalone) find apps in COMPOSE_ROOTS
    apps.py scan PATH                    compose files at PATH, as JSON
    apps.py import NAME FILE SERVICES URL ICON PORT
    apps.py forget APP                   un-import (containers untouched)

Where apps come from depends on how adlerOS is installed:

  homelab      (HOMELAB_DIR set) the homelab's catalog: containers/catalog.tsv
               and APPS in homelab.env, each app in containers/<collection>/<app>
               with every compose file in that folder and the folders right
               inside it; install and delete add or remove it from APPS and
               re-run the homelab's install.sh. Plus apps in the registry.
  standalone   only the registry: apps found in your compose folders
               (COMPOSE_ROOTS in .env), ones you imported, and ones installed
               from adlerOS's store (catalog/store) into APPS_DIR.

The registry is a folder per app holding app.json (containers/extras/<app>
in a homelab, registry/<app> standalone), written only by this script: the
app's name, its compose files, which of their services are its own (one file
can hold several apps, Immich and Navidrome say, and start, stop and delete
then touch only that app's), its address, icon and collection.

Collections: a known app (catalog/known-apps.tsv recognises its image) goes in
its collection, media for Jellyfin, life for Actual Budget; anything else in
extras. Databases and caches belong to the app that depends on them.

    start    runs the app's pre-start.sh first, if it has one (exit 10 means
             "not yet": Kiwix with no archives, say), then `up -d`
    stop     `stop`: the containers stay, ready to start again
    restart  `restart`, or a start if it has no containers
    update   `pull`, then `up -d`: new images, and the containers recreated
             on them; data stays
    delete   `down` (or `rm` for an app that shares its file), and the app
             leaves the home screen; its data and compose files stay, so
             install brings it back as it was. A homelab's core apps can't be
             deleted.
    install  the reverse; or, for a store app, set it up from its template
             first: its folder, generated passwords, a free port

adlerOS itself (and a homelab's nginx) aren't on the list: stopping either
would take the App Store down with it. Import and discovery never take a
compose file the adlerOS web app could have written (its data folder), and
imports from the browser only take files under your home folder.
"""
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ADLEROS = Path(__file__).resolve().parents[1]
CATALOG_DIR = ADLEROS / "catalog"
KNOWN_APPS = CATALOG_DIR / "known-apps.tsv"
STORE = CATALOG_DIR / "store"
HOMELAB = Path(os.environ["HOMELAB_DIR"]).resolve() if os.environ.get("HOMELAB_DIR") else None
if HOMELAB:
    CONTAINERS = HOMELAB / "containers"
    CATALOG = CONTAINERS / "catalog.tsv"
    CONFIG = HOMELAB / "homelab.env"
    REGISTRY = CONTAINERS / "extras"
    OS_DATA = CONTAINERS / "core" / "os" / "data"  # the web app can write here
else:
    CONTAINERS = CATALOG = None
    CONFIG = ADLEROS / ".env"
    REGISTRY = ADLEROS / "registry"
    OS_DATA = ADLEROS / "data"
COMPOSE_NAMES = ("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml")
APP_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
SERVICE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
NOT_MANAGED = {"os", "nginx"}
SKIP = 10  # a pre-start.sh exit code: not ready to start, not an error
HOME = Path.home().resolve()
SCAN_DEPTH = 2
DISCOVER_DEPTH = 3
SCAN_MAX_FILES = 100
SHOW_BYTES = 32 * 1024  # compose text shown per file
SHOW_TOTAL = 700 * 1024
SKIP_DIRS = {"node_modules", ".git", "__pycache__", "venv", ".venv"}
LOG_LINES = 300  # per compose file
LOG_BYTES = 400 * 1024
COLLECTIONS = ("core", "system", "media", "knowledge", "productivity", "life", "files", "extras")
# Services that are never the app itself: they belong to the app that needs them.
BACKING = re.compile(r"postgres|mysql|mariadb|redis|valkey|mongo|couchdb|memcached|elastic|meili|typesense|clickhouse"
                     r"|minio|rabbitmq|nats|pgvecto|immich-machine-learning|(^|[/-])db($|[:-])", re.I)
# Ports that aren't a web page (SSH, DNS, mail, databases, torrents, games).
NOT_WEB = {22, 222, 2222, 53, 25, 465, 587, 993, 1883, 3306, 5432, 6379, 6881, 27017, 25565}
TLS_PORTS = {443, 4433, 8443, 9443}  # a web page, but the plain one is the better link
# Known apps that are often a helper inside someone else's stack: in a file
# with another app they're part of it, alone they're an app of their own.
HELPERS = {"caddy", "traefik", "watchtower", "cloudflared", "tailscale", "webdav", "nginx-proxy-manager", "diun"}


def say(message):
    print(message, flush=True)


def read_env(path):
    values = {}
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return values
    for line in lines:
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not key or key.startswith("#"):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def rewrite(path, text):
    """Rewrite a file in place, keeping it the same file: the home screen
    sees homelab.env through a bind mount of that one file, which would go
    on showing the old copy of a file that was replaced instead."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
        f.truncate()


def write_private(path, text):
    """Replace a file atomically, never following a link planted there."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


# ------------------------------------------------------------------ apps

def compose_file(folder):
    """The compose file `docker compose` would pick in this folder, if any."""
    for name in COMPOSE_NAMES:
        f = folder / name
        try:
            if f.is_file():
                return f
        except OSError:
            continue
    return None


def folder_compose_files(folder):
    """The folder's compose file, then those of the folders right inside it."""
    files = []
    own = compose_file(folder)
    if own:
        files.append(own)
    try:
        subfolders = sorted(p for p in folder.iterdir() if p.is_dir() and not p.is_symlink())
    except OSError:
        subfolders = []
    for sub in subfolders:
        f = compose_file(sub)
        if f:
            files.append(f)
    return files


def setting(key, default=""):
    return read_env(CONFIG).get(key, default)


def catalog():
    """[(collection, id, subdomain, name)] in catalog order (a homelab's)."""
    rows = []
    if not CATALOG:
        return rows
    try:
        lines = CATALOG.read_text().splitlines()
    except OSError:
        return rows
    for line in lines:
        fields = line.split("\t")
        if not line.startswith("#") and len(fields) == 7:
            rows.append((fields[0], fields[1], fields[2], fields[5]))
    return rows


def registry_app(app_id):
    """An app in the registry (found, imported or from the store), or None.
    Only this script writes these."""
    try:
        info = json.loads((REGISTRY / app_id / "app.json").read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(info, dict) or not isinstance(info.get("files"), list):
        return None
    files = [Path(f) for f in info["files"] if isinstance(f, str) and f.startswith("/")]
    services = info.get("services")
    if not (isinstance(services, list) and services and all(isinstance(s, str) and SERVICE.fullmatch(s) for s in services)):
        services = None  # the whole file
    return {"id": app_id, "name": info.get("name", app_id), "kind": "registry", "folder": None,
            "files": [f for f in files if f.is_file()], "services": services,
            "core": False, "installed": info.get("installed", True) is not False, "info": info}


def registry_apps():
    apps = {}
    if REGISTRY.is_dir():
        for entry in sorted(REGISTRY.iterdir()):
            if APP_ID.fullmatch(entry.name):
                app = registry_app(entry.name)
                if app:
                    apps[entry.name] = app
    return apps


def store_templates():
    """{id: template} from catalog/store/<id>/app.json (standalone installs)."""
    templates = {}
    if HOMELAB or not STORE.is_dir():
        return templates
    for folder in sorted(STORE.iterdir()):
        try:
            info = json.loads((folder / "app.json").read_text())
        except (OSError, ValueError):
            continue
        if APP_ID.fullmatch(folder.name) and isinstance(info, dict) and (folder / "docker-compose.yml").is_file():
            templates[folder.name] = {**info, "folder": folder}
    return templates


def catalog_app(collection, app_id, name, installed):
    folder = CONTAINERS / collection / app_id
    return {"id": app_id, "name": name, "kind": "catalog", "core": collection == "core", "folder": folder,
            "files": folder_compose_files(folder), "services": None, "installed": installed}


def every_app():
    """{id: app} for every app the App Store knows, installed or not."""
    chosen = set(read_env(CONFIG).get("APPS", "").split())
    apps = {}
    for collection, app_id, sub, name in catalog():
        if app_id in NOT_MANAGED or sub == "-":
            continue
        apps[app_id] = catalog_app(collection, app_id, name, collection == "core" or app_id in chosen)
    registry = registry_apps()
    for app_id, app in registry.items():
        apps.setdefault(app_id, app)
    # Store apps you don't have yet (one you have, found or installed, isn't offered).
    have = {a["info"].get("known") or a["id"] for a in registry.values()} | set(apps)
    for app_id, t in store_templates().items():
        if app_id not in have:
            apps[app_id] = {"id": app_id, "name": t.get("name", app_id), "kind": "store", "core": False,
                            "folder": None, "files": [t["folder"] / "docker-compose.yml"], "services": None,
                            "installed": False, "template": t}
    return apps


def all_apps():
    """{id: app} for every installed app: what the home screen shows."""
    return {k: v for k, v in every_app().items() if v["installed"]}


# ---------------------------------------------------------------- docker

def docker_env():
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL")}
    env.setdefault("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
    return env


def compose(file, *args):
    """`docker compose <args>` for one file, from its folder; output goes to the job."""
    say(f"$ docker compose {' '.join(args)}    ({file.parent})")
    return subprocess.run(["docker", "compose", "-f", str(file), *args], cwd=file.parent, env=docker_env(),
                          stdin=subprocess.DEVNULL, check=False).returncode


def run_installer():
    """Re-run the homelab's install.sh as the helper always does: no host
    setup, no prompts."""
    say("$ ./install.sh --no-host --yes")
    return subprocess.run([str(HOMELAB / "install.sh"), "--no-host", "--yes"], cwd=HOMELAB, env=docker_env(),
                          stdin=subprocess.DEVNULL, check=False).returncode


def containers():
    """Every container on the machine: (name, state, status, compose folder, service)."""
    fmt = "\t".join(["{{.Names}}", "{{.State}}", "{{.Status}}",
                     '{{.Label "com.docker.compose.project.working_dir"}}',
                     '{{.Label "com.docker.compose.service"}}', "{{.Image}}"])
    result = subprocess.run(["docker", "ps", "-a", "--no-trunc", "--format", fmt], env=docker_env(),
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "docker ps failed")
    rows = []
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 6:
            rows.append(dict(zip(("name", "state", "status", "folder", "service", "image"), parts)))
    return rows


def summarize(found, files):
    if not files:
        return "no-compose"
    if not found:
        return "removed"
    states = [c["state"] for c in found]
    if any(s == "restarting" for s in states):
        return "restarting"
    running = sum(s == "running" for s in states)
    if running == len(states):
        return "unhealthy" if any("(unhealthy)" in c["status"] for c in found) else "running"
    return "partial" if running else "stopped"


def app_status(apps):
    rows = containers()
    by_folder = {}
    for row in rows:
        if row["folder"]:
            by_folder.setdefault(os.path.realpath(row["folder"]), []).append(row)
    report = {}
    for app_id, app in apps.items():
        found = []
        for f in app["files"]:
            found += [c for c in by_folder.get(os.path.realpath(f.parent), [])
                      if app["services"] is None or c["service"] in app["services"]]
        report[app_id] = {"state": summarize(found, app["files"]), "files": len(app["files"]),
                          "containers": [{k: c[k] for k in ("name", "service", "state", "status", "image")} for c in found]}
    return report


def parse_bytes(text):
    """'123.4MiB' -> bytes (docker stats' units)."""
    m = re.fullmatch(r"([\d.]+)\s*([KMGT]?i?B)", text.strip())
    if not m:
        return 0
    scale = {"B": 1, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12,
             "KiB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3, "TiB": 1024 ** 4}
    return int(float(m.group(1)) * scale.get(m.group(2), 1))


def usage(apps):
    """Each app's share of the CPU (0-100, of the whole machine) and memory
    (bytes) right now, from one `docker stats` sample; containers that aren't
    part of an app add up under "other"."""
    result = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
                            env=docker_env(), stdin=subprocess.DEVNULL, capture_output=True, text=True,
                            timeout=60, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "docker stats failed")
    owner = {}
    status = app_status(apps)
    for app_id, report in status.items():
        for c in report["containers"]:
            owner[c["name"]] = app_id
    cpus = os.cpu_count() or 1
    out = {app_id: {"cpu": 0.0, "memory": 0, "containers": 0} for app_id in apps}
    other = {"cpu": 0.0, "memory": 0, "containers": 0}
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        name, cpu, mem = parts
        try:
            share = float(cpu.rstrip("%")) / cpus
        except ValueError:
            share = 0.0
        entry = out.get(owner.get(name), other)
        entry["cpu"] += share
        entry["memory"] += parse_bytes(mem.split("/")[0])
        entry["containers"] += 1
    for entry in [*out.values(), other]:
        entry["cpu"] = round(entry["cpu"], 2)
    return {"apps": out, "other": other}


# --------------------------------------------------------------- actions

def scoped(app, *args):
    """compose args for this app: its own services, when it shares its file."""
    return [*args, *(app["services"] or [])]


def pre_start(app):
    """Run the app's pre-start.sh like install.sh does; its exit code."""
    hook = app["folder"] / "pre-start.sh" if app["folder"] else None
    if not hook or not hook.is_file():
        return 0
    env = {**docker_env(), **read_env(app["folder"] / ".env"), "DOCKER": "docker"}
    say("$ ./pre-start.sh")
    return subprocess.run(["bash", "./pre-start.sh"], cwd=app["folder"], env=env,
                          stdin=subprocess.DEVNULL, check=False).returncode


def start(app):
    code = pre_start(app)
    if code == SKIP:
        say(f"{app['name']} isn't ready to start yet; the message above says why.")
        return SKIP
    if code:
        say(f"pre-start.sh failed ({code}), so {app['name']} wasn't started.")
        return code
    return first_failure(compose(f, *scoped(app, "up", "-d")) for f in app["files"])


def stop(app):
    return first_failure(compose(f, *scoped(app, "stop")) for f in reversed(app["files"]))


def restart(app):
    if not app_status({app["id"]: app})[app["id"]]["containers"]:
        say("No containers yet, so starting it instead.")
        return start(app)
    return first_failure(compose(f, *scoped(app, "restart")) for f in app["files"])


def update(app):
    """New images, then the containers recreated on them (only those that changed)."""
    code = first_failure(compose(f, *scoped(app, "pull")) for f in app["files"])
    if code:
        say(f"Pulling didn't finish ({code}); {app['name']} keeps running as it was.")
        return code
    return start(app)


def logs(app):
    """The last LOG_LINES lines of each compose file's containers, oldest first."""
    lines = []
    for f in app["files"]:
        result = subprocess.run(["docker", "compose", "-f", str(f), *scoped(app, "logs", "--no-color", "--timestamps",
                                                                            "--tail", str(LOG_LINES))],
                                cwd=f.parent, env=docker_env(), stdin=subprocess.DEVNULL, capture_output=True,
                                text=True, errors="replace", timeout=60, check=False)
        lines += (result.stdout + result.stderr).splitlines()
    # Compose interleaves containers; sort by the timestamp after the "name | ".
    stamp = re.compile(r"^\S+\s+\|\s+(\S+)")
    lines.sort(key=lambda l: (m.group(1) if (m := stamp.match(l)) else ""))
    text = "\n".join(lines)
    if len(text) > LOG_BYTES:
        text = text[-LOG_BYTES:].split("\n", 1)[-1]
    return {"app": app["id"], "lines": text.splitlines()}


def remove_containers(app):
    if app["services"] is None:
        return first_failure(compose(f, "down") for f in reversed(app["files"]))
    # Only this app's services: the rest of its file belongs to other apps.
    return first_failure(compose(f, *scoped(app, "rm", "--stop", "--force")) for f in reversed(app["files"]))


def set_chosen(app_id, chosen):
    """Add an app to APPS in homelab.env, or take it out; catalog order."""
    current = set(read_env(CONFIG).get("APPS", "").split())
    current = current | {app_id} if chosen else current - {app_id}
    ordered = [a for _, a, _, _ in catalog() if a in current]
    line = f'APPS="{" ".join(ordered)}"'
    lines = CONFIG.read_text().splitlines() if CONFIG.exists() else []
    for i, existing in enumerate(lines):
        if existing.startswith("APPS="):
            lines[i] = line
            break
    else:
        lines.append(line)
    rewrite(CONFIG, "\n".join(lines) + "\n")


def write_record(app_id, info):
    folder = REGISTRY / app_id
    folder.mkdir(parents=True, exist_ok=True, mode=0o755)
    write_private(folder / "app.json", json.dumps(info, indent=2) + "\n")
    os.chmod(folder / "app.json", 0o644)


def set_registry_installed(app, installed):
    write_record(app["id"], {**app["info"], "installed": installed})


def delete(app):
    if app.get("core"):
        sys.exit(f"{app['name']} is a core app and always installed; stop it instead.")
    code = remove_containers(app)
    if code:
        say(f"Its containers didn't all come down ({code}), so {app['name']} stays installed.")
        return code
    if app["kind"] == "registry":
        set_registry_installed(app, False)
        say(f"{app['name']} is off your home screen. Install brings it back.")
        return 0
    set_chosen(app["id"], False)
    say(f"{app['name']} is out of APPS. Re-running install.sh to drop its address and dashboard entry:")
    return run_installer()


def install(app):
    if app["installed"]:
        sys.exit(f"{app['name']} is already installed.")
    if app["kind"] == "registry":
        set_registry_installed(app, True)
        return start({**app, "installed": True})
    if app["kind"] == "store":
        return store_install(app)
    set_chosen(app["id"], True)
    say(f"Added {app['name']} to APPS. install.sh sets it up and starts it:")
    return run_installer()


# ------------------------------------------------------- known apps, store

def image_path(image):
    """'lscr.io/linuxserver/jellyfin:10.9' -> 'linuxserver/jellyfin'."""
    ref = image.split("@", 1)[0]
    parts = ref.split("/")
    if len(parts) > 1 and ("." in parts[0] or ":" in parts[0] or parts[0] == "localhost"):
        parts = parts[1:]  # a registry host
    path = "/".join(parts)
    return path.rsplit(":", 1)[0] if ":" in path.rsplit("/", 1)[-1] else path


def known_apps():
    """[(patterns, info)] from catalog/known-apps.tsv: which images are which app."""
    rows = []
    try:
        lines = KNOWN_APPS.read_text().splitlines()
    except OSError:
        return rows
    for line in lines:
        fields = line.split("\t")
        if line.startswith("#") or len(fields) != 7:
            continue
        match, app_id, name, collection, icon, about, port = fields
        rows.append((match.split("|"), {"id": app_id, "name": name, "collection": collection if collection in COLLECTIONS else "extras",
                                        "icon": icon if icon != "-" else "", "about": about,
                                        "port": int(port) if port.isdigit() else None}))
    return rows


def classify(image, known=None):
    """The known app this image is, or None. A pattern is an image path
    (immich-app/immich-server) or just its last part (jellyfin)."""
    path = image_path(image).lower()
    base = path.rsplit("/", 1)[-1]
    for patterns, info in known if known is not None else known_apps():
        for pattern in patterns:
            if path == pattern or base == pattern or path.endswith("/" + pattern):
                return info
    return None


def backing(svc):
    return bool(BACKING.search(svc["image"]) or BACKING.search(svc["name"]))


def web_port(svc):
    """The port most likely to be the web page: plain HTTP before TLS, and
    never SSH, DNS or a database."""
    ports = svc.get("ports") or []
    web = sorted((p for p in ports if p not in NOT_WEB), key=lambda p: p in TLS_PORTS)
    return (web or ports or [None])[0]


def host_address():
    """How your browser reaches this machine, for apps' addresses (standalone)."""
    return setting("ADLEROS_HOST") or socket.gethostname()


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("0.0.0.0", port))
        except OSError:
            return False
    return True


def free_port(wanted, taken):
    for port in range(wanted, wanted + 200):
        if port not in taken and port_free(port):
            return port
    raise RuntimeError(f"no free port near {wanted}")


def new_app_id(name, apps):
    # A store app of the same name is fine: once you have the app, the store
    # stops offering it.
    base = app_id = slug(name)
    catalog_ids = {a for _, a, _, _ in catalog()}
    n = 2
    taken = {k for k, v in apps.items() if v.get("kind") != "store"}
    while app_id in taken or app_id in catalog_ids or (REGISTRY / app_id).exists():
        app_id = f"{base}-{n}"
        n += 1
    return app_id


def apps_dir():
    return Path(setting("APPS_DIR") or ADLEROS / "apps").expanduser()


def render_env(template_text, values):
    """A store app's .env.example with its placeholders filled in:
    __PASS__ (a new password), __HEX64__ (a new key), __PORT__, __TZ__,
    __PUID__, __PGID__, __STORAGE__."""
    out = template_text
    while "__PASS__" in out:
        out = out.replace("__PASS__", secrets.token_urlsafe(18), 1)
    while "__HEX64__" in out:
        out = out.replace("__HEX64__", secrets.token_hex(32), 1)
    for key, value in values.items():
        out = out.replace(f"__{key}__", str(value))
    return out


def make_mount_dirs(target, env_text):
    """Folders the app mounts, made now as you: Docker would make them as
    root, and the app couldn't write there. Only inside the app's folder or
    your home folder."""
    env = {}
    for line in env_text.splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            env[key.strip()] = value.strip()
    compose_text = (target / "docker-compose.yml").read_text()
    for source in re.findall(r"^\s*-\s*[\"']?(\./[^:\"']+|\$\{\w+\}[^:\"']*):", compose_text, re.M):
        path = source
        for key, value in env.items():
            path = path.replace("${" + key + "}", value)
        if "${" in path:
            continue
        folder = (target / path).resolve() if path.startswith("./") else Path(path).expanduser().resolve()
        if folder.is_relative_to(target.resolve()) or folder.is_relative_to(HOME):
            folder.mkdir(parents=True, exist_ok=True)


def store_install(app):
    """Set a store app up in APPS_DIR/<id> and start it."""
    t = app["template"]
    target = apps_dir() / app["id"]
    if target.exists() and any(target.iterdir()):
        sys.exit(f"{target} already exists; move it away, or import it instead")
    taken = {a["info"].get("port") for a in registry_apps().values()}
    port = free_port(int(t.get("port", 8080)), taken)
    target.mkdir(parents=True, exist_ok=True)
    for item in t["folder"].iterdir():
        if item.name in ("app.json", ".env.example"):
            continue
        dest = target / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    example = t["folder"] / ".env.example"
    values = {"PORT": port, "TZ": setting("TZ", "UTC"), "PUID": os.getuid(), "PGID": os.getgid(),
              "STORAGE": setting("STORAGE_DIR") or str(Path.home() / "storage")}
    env_text = render_env(example.read_text() if example.is_file() else "PORT=__PORT__\n", values)
    rewrite(target / ".env", env_text)
    make_mount_dirs(target, env_text)
    say(f"Set up {t.get('name', app['id'])} in {target}, on port {port}.")
    compose_file_path = target / "docker-compose.yml"
    # "scheme": https for an app that only serves that; "window": how adlerOS
    # may show it (https: in a window only when adlerOS is on HTTPS too).
    scheme = t.get("scheme") if t.get("scheme") in ("http", "https") else "http"
    record = {"name": t.get("name", app["id"]), "files": [str(compose_file_path)], "services": None,
              "url": f"{scheme}://{host_address()}:{port}", "icon": t.get("icon", ""), "port": port,
              "about": t.get("about", ""), "collection": t.get("collection", "extras"), "source": "store",
              "known": app["id"], "note": t.get("firstRun", ""), "added": time.strftime("%Y-%m-%d"), "installed": True,
              **({"window": t["window"]} if t.get("window") in ("https", "tab") else {})}
    code = compose(compose_file_path, "up", "-d")
    if code:
        say(f"It didn't start ({code}); its folder stays, so you can look. Delete it to tidy up.")
    write_record(app["id"], record)
    return code


# ------------------------------------------------------------- discovery

def plan_file(file, svcs, known):
    """The apps in one compose file: [(main service, info or None, services)]."""
    found = []
    for svc in svcs:
        info = classify(svc["image"], known)
        if info and not backing(svc) and info["id"] not in {i["id"] for _, i, _ in found if i}:
            found.append((svc, info, None))
    # A proxy or updater next to other services is part of their stack.
    others = [s for s in svcs if not backing(s)]
    if len(others) > 1:
        found = [f for f in found if f[1]["id"] not in HELPERS] or ([] if len(found) < len(others) else found)
    if not found:
        # Built here, or not in the list: maybe the folder says which app it is.
        by_folder = classify(file.parent.name, known)
        main = next((s for s in svcs if s["ports"] and not backing(s)), None) or next((s for s in svcs if not backing(s)), svcs[0])
        if by_folder:
            return [(main, by_folder, None)]
    if not found:
        # Nothing we know: the file is one app, named after its folder, in Extras.
        web = [s for s in svcs if s["ports"] and not backing(s)]
        main = web[0] if web else next((s for s in svcs if not backing(s)), svcs[0])
        return [(main, None, None)]
    if len(found) == 1:
        return [(found[0][0], found[0][1], None)]  # the whole file
    needs = {s["name"]: s.get("needs", []) for s in svcs}

    def closure(name, seen):
        for n in needs.get(name, []):
            if n not in seen:
                seen.add(n)
                closure(n, seen)
        return seen

    plans, owned = [], set()
    for svc, info, _ in found:
        own = [svc["name"]] + sorted(n for n in closure(svc["name"], set()) if n not in {f[0]["name"] for f in found})
        plans.append([svc, info, own])
        owned |= set(own)
    plans[0][2] += [s["name"] for s in svcs if s["name"] not in owned]  # leftovers: the first app's
    return [tuple(p) for p in plans]


def record_for(file, folder_name, svc, info, own, apps, svcs=()):
    # The app's own web port; else one of its other services' (a proxy in
    # front of it); else, on host networking, where the app usually listens.
    mine = [s for s in svcs if own is None or s["name"] in own]
    port = web_port(svc) or next((p for p in map(web_port, [s for s in mine if not backing(s)]) if p), None)
    if not port and (info or {}).get("port") and svc.get("host"):
        port = info["port"]
    # Unknown: the folder's name, each word capitalised (spaceadler.com stays as is).
    name = info["name"] if info else " ".join(w[:1].upper() + w[1:] for w in re.split(r"[-_ ]+", folder_name) if w)
    image_base = image_path(svc["image"]).rsplit("/", 1)[-1]
    icon = (info or {}).get("icon") or (f"di:{image_base}" if re.fullmatch(r"[a-z0-9-]+", image_base) else "")
    return new_app_id(name, apps), {
        "name": name[:40], "files": [str(file)], "services": own,
        "url": f"http://{host_address()}:{port}" if port else "", "icon": icon, "port": port,
        "about": (info or {}).get("about") or f"Found in {file.parent}",
        "collection": (info or {}).get("collection", "extras"), "source": "discovered",
        "known": (info or {}).get("id", ""), "added": time.strftime("%Y-%m-%d"), "installed": True}


def discover():
    """Make every compose file in COMPOSE_ROOTS that isn't an app yet into
    apps, sorted into collections. Safe to run again: it only adds."""
    roots = [Path(r).expanduser() for r in re.split(r"[:,]", setting("COMPOSE_ROOTS")) if r.strip()]
    if not roots:
        say("No COMPOSE_ROOTS in .env: nothing to look through. Add your compose folders there.")
        return 0
    apps = every_app()
    known = known_apps()
    used = {os.path.realpath(f) for a in apps.values() for f in a["files"]}
    skip = [p.resolve() for p in (ADLEROS, apps_dir(), OS_DATA) if p.exists()]
    added = failed = 0
    for root in roots:
        if not root.is_dir():
            say(f"! {root} isn't a folder; skipped")
            continue
        for file in find_compose_files(root, depth=DISCOVER_DEPTH):
            real = file.resolve()
            if str(real) in used or any(real.is_relative_to(p) for p in skip):
                continue
            try:
                svcs = services(real)
            except (OSError, ValueError, subprocess.TimeoutExpired) as e:
                say(f"! {file}: can't read it ({e}); skipped")
                failed += 1
                continue
            if not svcs:
                continue
            for svc, info, own in plan_file(real, svcs, known):
                app_id, record = record_for(real, real.parent.name, svc, info, own, apps, svcs)
                write_record(app_id, record)
                apps[app_id] = {"id": app_id, "files": [real]}
                where = record["collection"].capitalize()
                say(f"+ {record['name']} ({where}): {real}{'' if own is None else ' [' + ', '.join(own) + ']'}")
                added += 1
            used.add(str(real))
    say(f"{added} app{'' if added == 1 else 's'} added{f', {failed} file(s) skipped' if failed else ''}.")
    return 0


def first_failure(codes):
    """Run every step (a failed one doesn't stop the rest); the first error."""
    failed = 0
    for code in list(codes):
        failed = failed or code
    return failed


COMMANDS = {"start": start, "stop": stop, "restart": restart, "update": update, "delete": delete, "install": install}


# ---------------------------------------------------------------- import

def importable(path):
    """The real path of a compose file we may import, or an error."""
    real = Path(os.path.realpath(path))
    if not real.is_relative_to(HOME):
        return None, "only compose files under your home folder"
    if real.is_relative_to(OS_DATA.resolve()):
        return None, "not from the home screen's own data"
    if real.name not in COMPOSE_NAMES and not re.fullmatch(r"(docker-)?compose[\w.-]*\.ya?ml", real.name):
        return None, "not a compose file name"
    if not real.is_file():
        return None, "no such file"
    return real, None


def services(file):
    """[{name, image, ports, container, needs}] from `docker compose config`,
    which reads the file (and its .env) without starting anything."""
    result = subprocess.run(["docker", "compose", "-f", str(file), "config", "--format", "json"], cwd=file.parent,
                            env=docker_env(), stdin=subprocess.DEVNULL, capture_output=True, text=True,
                            timeout=30, check=False)
    if result.returncode != 0:
        raise ValueError((result.stderr.strip().splitlines() or ["docker compose config failed"])[-1])
    config = json.loads(result.stdout)
    found = []
    for name, svc in (config.get("services") or {}).items():
        ports = sorted({int(p["published"]) for p in svc.get("ports") or []
                        if str(p.get("published", "")).isdigit()})
        needs = svc.get("depends_on") or {}
        found.append({"name": name, "image": svc.get("image") or "(built here)", "ports": ports,
                      "container": svc.get("container_name") or "", "needs": sorted(needs),
                      "host": svc.get("network_mode") == "host"})
    return found


def taken_services(real, apps):
    """{service: app name} already in adlerOS for this file; '*' for all of it."""
    taken = {}
    for app in apps.values():
        if app["kind"] == "store":
            continue  # a store template, not one of your files
        if any(os.path.realpath(f) == str(real) for f in app["files"]):
            for s in app["services"] or ["*"]:
                taken[s] = app["name"]
    return taken


def find_compose_files(start, depth=SCAN_DEPTH):
    if start.is_file():
        return [start]
    files, todo = [], [(start, 0)]
    while todo and len(files) < SCAN_MAX_FILES:
        folder, level = todo.pop(0)
        try:
            entries = sorted(folder.iterdir())
        except OSError:
            continue
        own = compose_file(folder)
        if own:
            files.append(own)
        if level < depth:
            todo += [(e, level + 1) for e in entries
                     if e.is_dir() and not e.is_symlink() and not e.name.startswith(".") and e.name not in SKIP_DIRS]
    return files


def scan(path):
    start = Path(os.path.realpath(path))
    if not start.is_relative_to(HOME):
        return {"error": f"Pick a folder inside your home folder ({HOME})."}
    if not start.exists():
        return {"error": f"{path} doesn't exist."}
    apps = every_app()
    report, shown = [], 0
    for f in find_compose_files(start):
        real, error = importable(f)
        entry = {"path": str(f), "folder": f.parent.name, "taken": {}, "already": None}
        if error:
            entry["error"] = error
            report.append(entry)
            continue
        taken = taken_services(real, apps)
        try:
            text = real.read_text(errors="replace")
            if shown + len(text) <= SHOW_TOTAL and len(text) <= SHOW_BYTES:
                entry["text"] = text
                shown += len(text)
            entry["services"] = services(real)
        except (OSError, ValueError, subprocess.TimeoutExpired) as e:
            entry["error"] = f"can't read it: {e}"
        names = {s["name"] for s in entry.get("services", [])}
        if "*" in taken:
            taken = {s: taken["*"] for s in names}
        entry["taken"] = taken
        if names and names <= set(taken):
            entry["already"] = ", ".join(sorted(set(taken.values())))
        report.append(entry)
    return {"files": report, "home": str(HOME)}


def slug(name):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")[:40] or "app"


def import_app(name, file, service_list, url, icon, port):
    real, error = importable(file)
    if error:
        sys.exit(f"{file}: {error}")
    if not re.fullmatch(r"[^\x00-\x1f]{1,40}", name):
        sys.exit("name: 1 to 40 characters")
    if not re.fullmatch(r"https?://[^\s\"'<>\\]{1,300}", url):
        sys.exit("address: an http:// or https:// address")
    if icon and not re.fullmatch(r"di:[a-z0-9-]{1,64}", icon):
        sys.exit("icon: di:<name> from dashboard-icons, or nothing")
    if port and not (port.isdigit() and 0 < int(port) < 65536):
        sys.exit("port: a number from 1 to 65535, or nothing")
    wanted = service_list.split(",")
    if not all(SERVICE.fullmatch(s) for s in wanted) or len(set(wanted)) != len(wanted):
        sys.exit("services: the app's service first, then the ones it needs, separated by commas")
    try:
        found_services = services(real)
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        sys.exit(f"can't read {file}: {e}")
    found = {s["name"] for s in found_services}
    missing = [s for s in wanted if s not in found]
    if missing:
        sys.exit(f"{file} has no service called {', '.join(missing)}")
    apps = every_app()
    taken = taken_services(real, apps)
    clash = sorted(s for s in wanted if s in taken or "*" in taken)
    if clash:
        owner = taken.get(clash[0]) or taken.get("*")
        sys.exit(f"{', '.join(clash)} in {file} already belong to {owner} in adlerOS")
    app_id = new_app_id(name, apps)
    # A known app goes in its collection (Jellyfin in media); the rest in extras.
    images = {s["name"]: s["image"] for s in found_services}
    known = classify(images.get(wanted[0], ""))
    info = {"name": name, "files": [str(real)],
            # All of the file: none listed, so it runs as a whole (down, not rm).
            "services": None if set(wanted) == found else wanted,
            "url": url, "icon": icon, "port": int(port) if port else None,
            "about": (known or {}).get("about") or f"Imported from {real.parent}",
            "collection": (known or {}).get("collection", "extras"), "source": "import",
            "known": (known or {}).get("id", ""), "added": time.strftime("%Y-%m-%d"), "installed": True}
    write_record(app_id, info)
    part = "" if info["services"] is None else f" (services: {', '.join(wanted)})"
    say(f"Imported {name} as {app_id} ({info['collection']}): {real}{part}")
    return 0


def forget(app_id):
    app = registry_app(app_id) if APP_ID.fullmatch(app_id) else None
    if not app:
        sys.exit(f"{app_id}: not an imported app")
    folder = REGISTRY / app_id
    (folder / "app.json").unlink()
    try:
        folder.rmdir()
    except OSError:
        pass  # something else of yours is in there: left alone
    say(f"{app['name']} is no longer in adlerOS. Its containers and files weren't touched.")
    return 0


def main(argv):
    if argv == ["discover"]:
        if HOMELAB:
            sys.exit("discover is for standalone installs; a homelab's apps come from its catalog")
        return discover()
    if len(argv) == 2 and argv[0] == "scan":
        print(json.dumps(scan(argv[1])))
        return 0
    if len(argv) == 7 and argv[0] == "import":
        return import_app(*argv[1:])
    if len(argv) == 2 and argv[0] == "forget":
        return forget(argv[1])
    if len(argv) == 1 and argv[0] == "usage":
        try:
            print(json.dumps(usage(all_apps())))
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as e:
            print(json.dumps({"error": f"can't read Docker: {e}", "apps": {}}))
        return 0
    if len(argv) == 2 and argv[0] == "logs" and APP_ID.fullmatch(argv[1]):
        app = all_apps().get(argv[1])
        if not app:
            print(json.dumps({"error": f"{argv[1]} isn't an installed app", "lines": []}))
            return 0
        try:
            print(json.dumps(logs(app)))
        except (OSError, subprocess.TimeoutExpired) as e:
            print(json.dumps({"error": f"can't read the logs: {e}", "lines": []}))
        return 0
    if len(argv) == 1 and argv[0] == "status":
        try:
            report = app_status(all_apps())
        except (OSError, RuntimeError) as e:
            print(json.dumps({"error": f"can't read Docker: {e}", "apps": {}}))
            return 0
        print(json.dumps({"apps": report}))
        return 0
    if len(argv) != 2 or argv[0] not in COMMANDS or not APP_ID.fullmatch(argv[1]):
        sys.exit(f"usage: apps.py status | usage | discover | logs APP | {{{'|'.join(COMMANDS)}}} APP | scan PATH | forget APP"
                 " | import NAME FILE SERVICES URL ICON PORT")
    app = every_app().get(argv[1])
    if not app:
        sys.exit(f"{argv[1]}: not an app the App Store manages")
    if argv[0] != "install" and not app["installed"]:
        sys.exit(f"{app['name']} isn't installed; install it first.")
    if not app["files"]:
        sys.exit(f"{app['name']}: no compose file found")
    return COMMANDS[argv[0]](app)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
