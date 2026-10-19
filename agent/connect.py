#!/usr/bin/env python3
"""Connect adlerOS's Music, Gallery and Documents to Navidrome, Immich and
Paperless-ngx: the login or key each needs, made through the app's own API
and written into the settings file (homelab.env, or standalone adlerOS's
.env). Run by install.sh once the apps are up; `./install.sh --connect` runs
only this.

    connect.py --homelab DIR [--yes]       a homelab from spaceadler/homelab
    connect.py --standalone DIR [--yes]    standalone adlerOS, in DIR

One already connected is left alone. Where an app has no admin yet (Immich
and Navidrome make theirs on first visit), it offers to make yours. What you
type goes only to the app, over the address adlerOS knows it at, and is
never saved, except Navidrome's login: Music needs it to tell Navidrome what
you play. In a homelab, Paperless needs no questions: install.sh made its
admin, with the password in Paperless's own .env. With --yes, or with no
terminal, only that.
"""
import argparse
import getpass
import hashlib
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# What Gallery's key may do: the same as server.py's GALLERY_PERMISSIONS.
GALLERY_PERMISSIONS = ["asset.read", "asset.view", "asset.download", "album.read",
                       "person.read", "memory.read", "face.read", "map.read"]
WAIT = 240  # seconds an app that's just started gets to answer (with --yes, half)


def say(text):
    print(f"    {text}", flush=True)


def read_env(path):
    """KEY=VALUE lines, with surrounding quotes removed (as server.py reads them)."""
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


def set_setting(path, key, value):
    """KEY=value in the settings file, rewritten in place: adlerOS sees it
    through a bind mount of that one file, which would go on showing the
    old copy of a file that was replaced. Anything but plain characters is
    single-quoted, so docker compose (which reads standalone's .env) takes
    it as it is."""
    if not re.fullmatch(r"[A-Za-z0-9._@+-]*", value):
        value = f"'{value}'"
    lines = path.read_text().splitlines() if path.exists() else []
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
        f.truncate()


# ------------------------------------------------------------ where they are

class Install:
    """The settings file, this machine's address, and the apps installed
    (id -> port, and their folder in a homelab)."""

    def __init__(self, homelab=None, standalone=None):
        self.apps = {}
        if homelab:
            root = Path(homelab).resolve()
            self.settings = root / "homelab.env"
            env = read_env(self.settings)
            self.host = env.get("TS_IP", "")
            chosen = set(env.get("APPS", "").split())
            try:
                rows = (root / "containers" / "catalog.tsv").read_text().splitlines()
            except OSError:
                rows = []
            for row in rows:
                fields = row.split("\t")
                if not row.strip() or row.lstrip().startswith("#") or len(fields) != 7:
                    continue
                genre, app, _sub, port = fields[:4]
                if genre == "core" or app in chosen:
                    self.apps[app] = {"port": int(port), "folder": root / "containers" / genre / app}
            self.registry(root / "containers" / "extras")
            self.name = read_env(root / "containers" / "core" / "os" / ".env").get("OS_NAME", "")
        else:
            root = Path(standalone).resolve()
            self.settings = root / ".env"
            env = read_env(self.settings)
            self.host = env.get("ADLEROS_HOST", "")
            self.registry(Path(os.environ.get("ADLEROS_REGISTRY") or root / "registry"))
            self.name = env.get("OS_NAME", "")

    def registry(self, folder):
        """Apps found, imported or installed from the store, each its app.json."""
        for f in sorted(folder.glob("*/app.json")):
            try:
                app = json.loads(f.read_text())
            except (OSError, ValueError):
                continue
            if app.get("installed", True) and app.get("port") and f.parent.name not in self.apps:
                self.apps[f.parent.name] = {"port": int(app["port"]), "folder": None}

    def env(self, key):
        return read_env(self.settings).get(key, "")

    def url(self, ids, key):
        """KEY (IMMICH_URL…) if it's set, else this machine at the app's port."""
        if self.env(key):
            return self.env(key).rstrip("/")
        app = next((self.apps[i] for i in ids if i in self.apps), None)
        return f"http://{self.host}:{app['port']}" if app and self.host else None

    def folder(self, ids):
        return next((self.apps[i]["folder"] for i in ids if i in self.apps), None)


# ----------------------------------------------------------- asking the apps

def call(url, method="GET", body=None, headers=None, timeout=10):
    """(status, JSON or text). Connection errors are raised: not up yet."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Accept": "application/json", "User-Agent": "adlerOS",
        **({"Content-Type": "application/json"} if data else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as r:
            status, raw = r.status, r.read(1_000_000)
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read(1_000_000)
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw.decode(errors="replace")


def said(body):
    """What an app's error says, in a few words."""
    if isinstance(body, dict):
        for k in ("message", "detail", "error", "non_field_errors"):
            v = body.get(k)
            if v:
                return "; ".join(map(str, v)) if isinstance(v, list) else str(v)
        return "; ".join(f"{k}: {v}" for k, v in body.items())[:200]
    return str(body or "no answer")[:200]


def wait_for(name, check):
    """check()'s answer once the app answers, or None after WAIT seconds."""
    told = False
    until = time.monotonic() + WAIT
    while True:
        try:
            got = check()
            if got is not None:
                return got
        except (OSError, ValueError):
            pass
        if time.monotonic() > until:
            return None
        if not told:
            say(f"waiting for {name} to start…")
            told = True
        time.sleep(3)


class Terminal:
    """Questions, on the terminal (never on stdin, which may be a pipe)."""

    def __init__(self, enabled):
        self.tty = self.out = None
        if enabled:
            try:  # one each way: a terminal can't be opened "r+" as text (it can't seek)
                self.tty, self.out = open("/dev/tty"), open("/dev/tty", "w")
            except OSError:
                self.tty = self.out = None

    def ask(self, question, default=""):
        self.out.write(f"    {question}{f' [{default}]' if default else ''}: ")
        self.out.flush()
        answer = self.tty.readline()
        if not answer:
            raise EOFError
        return answer.strip() or default

    def yes(self, question):
        return not self.ask(f"{question} [Y/n]").lower().startswith("n")

    def password(self, question):
        return getpass.getpass(f"    {question}: ", stream=self.out)

    def new_password(self, question):
        while True:
            first = self.password(question)
            if not first:
                say("it can't be empty")
            elif self.password("Again") != first:
                say("those weren't the same; once more")
            else:
                return first


# ---------------------------------------------------------------- the three

def paperless(install, term):
    if install.env("PAPERLESS_TOKEN"):
        return "Documents: connected to Paperless already"
    url = install.url(("paperless-ngx", "paperless"), "PAPERLESS_URL")
    if not url:
        return None
    folder = install.folder(("paperless-ngx", "paperless"))
    own = read_env(folder / ".env") if folder else {}
    login = (own.get("PAPERLESS_ADMIN_USER") or "admin", own["PAPERLESS_ADMIN_PASSWORD"]) if own.get("PAPERLESS_ADMIN_PASSWORD") else None
    if not login and not term.tty:
        return "Documents: Paperless needs your login to make its token; run this again in a terminal"
    if wait_for("Paperless", lambda: call(f"{url}/api/")[0] or None) is None:
        return f"Documents: Paperless isn't answering at {url} yet; run this again once it is"
    if not login and not term.yes("Connect Documents to Paperless with your Paperless login?"):
        return "Documents: not connected (it shows the files themselves)"
    for _ in range(3):
        user, password = login or (term.ask("Your Paperless username"), term.password("Its password"))
        status, body = call(f"{url}/api/token/", "POST", {"username": user, "password": password})
        if status == 200 and isinstance(body, dict) and body.get("token"):
            set_setting(install.settings, "PAPERLESS_TOKEN", body["token"])
            return f"Documents: connected to Paperless ({user}'s token)"
        if login:
            return f"Documents: Paperless didn't take its admin's login ({said(body)})"
        say(f"Paperless didn't take that ({said(body)})")
    return "Documents: not connected; make the token in Paperless (My Profile → API Auth Token)"


def immich(install, term):
    if install.env("IMMICH_API_KEY"):
        return "Gallery: connected to Immich already"
    url = install.url(("immich",), "IMMICH_URL")
    if not url:
        return None
    if not term.tty:
        return "Gallery: Immich needs your login to make its key; run this again in a terminal"
    config = wait_for("Immich", lambda: (lambda r: r[1] if r[0] == 200 and isinstance(r[1], dict) else None)(call(f"{url}/api/server/config")))
    if config is None:
        return f"Gallery: Immich isn't answering at {url} yet; run this again once it is"
    if not config.get("isInitialized"):
        if not term.yes("Immich has no admin yet. Make yours now (and Gallery's key with it)?"):
            return "Gallery: not connected; Immich makes its admin when you first open it"
        email = term.ask("Your email (Immich's login)")
        name = term.ask("Your name", install.name)
        password = term.new_password("A password for Immich")
        status, body = call(f"{url}/api/auth/admin-sign-up", "POST", {"email": email, "password": password, "name": name or email})
        if status not in (200, 201):
            return f"Gallery: Immich didn't make the admin ({said(body)})"
        logins = [(email, password)]
    elif term.yes("Connect Gallery to Immich with your Immich login?"):
        logins = None
    else:
        return "Gallery: not connected (it shows the photos themselves)"
    for attempt in range(3):
        email, password = logins[0] if logins else (term.ask("Your Immich email"), term.password("Its password"))
        status, body = call(f"{url}/api/auth/login", "POST", {"email": email, "password": password})
        if status in (200, 201) and isinstance(body, dict) and body.get("accessToken"):
            break
        say(f"Immich didn't take that ({said(body)})")
        if logins:
            return "Gallery: not connected; make the key in Immich (Account Settings → API Keys)"
    else:
        return "Gallery: not connected; make the key in Immich (Account Settings → API Keys)"
    session = {"Authorization": f"Bearer {body['accessToken']}"}
    status, key = call(f"{url}/api/api-keys", "POST", {"name": "adlerOS Gallery", "permissions": GALLERY_PERMISSIONS}, session)
    call(f"{url}/api/auth/logout", "POST", {}, session)  # that login's done with
    if status not in (200, 201) or not isinstance(key, dict) or not key.get("secret"):
        return f"Gallery: Immich didn't make the key ({said(key)})"
    set_setting(install.settings, "IMMICH_API_KEY", key["secret"])
    return "Gallery: connected to Immich (its key may only read)"


def subsonic_ok(url, user, password):
    salt = secrets.token_hex(6)  # Subsonic's token login: the password itself never goes
    query = urllib.parse.urlencode({"u": user, "t": hashlib.md5((password + salt).encode()).hexdigest(), "s": salt,
                                    "v": "1.16.1", "c": "adlerOS", "f": "json"})
    status, body = call(f"{url}/rest/ping.view?{query}")
    return isinstance(body, dict) and body.get("subsonic-response", {}).get("status") == "ok"


def navidrome(install, term):
    if install.env("NAVIDROME_USER") and install.env("NAVIDROME_PASSWORD"):
        return "Music: connected to Navidrome already"
    url = install.url(("navidrome",), "NAVIDROME_URL")
    if not url:
        return None
    if not term.tty:
        return "Music: Navidrome needs your login; run this again in a terminal"
    # Its page says whether anyone's made an account yet.
    page = wait_for("Navidrome", lambda: (lambda r: r[1] if r[0] == 200 and isinstance(r[1], str) else None)(call(f"{url}/app/")))
    if page is None:
        return f"Music: Navidrome isn't answering at {url} yet; run this again once it is"
    first = re.search(r'firstTime\\?"\s*:\s*true', page) is not None
    usable = lambda p: "'" not in p and "\n" not in p  # it's kept in the settings file, quoted
    if first:
        if not term.yes("Navidrome has no admin yet. Make yours now (Music uses it too)?"):
            return "Music: not connected; Navidrome makes its admin when you first open it"
        user = term.ask("A username for Navidrome", re.sub(r"[^a-z0-9]", "", install.name.lower()) or "admin")
        password = term.new_password("A password for Navidrome")
        while not usable(password):
            say("one without ' in it, please (it's kept in the settings file)")
            password = term.new_password("A password for Navidrome")
        status, body = call(f"{url}/auth/createAdmin", "POST", {"username": user, "password": password})
        if status != 200:
            return f"Music: Navidrome didn't make the admin ({said(body)})"
    elif term.yes("Connect Music to Navidrome with your Navidrome login (so it sees what you play)?"):
        for _ in range(3):
            user, password = term.ask("Your Navidrome username"), term.password("Its password")
            if not usable(password):
                return "Music: that password has ' in it; put it in the settings file yourself, as NAVIDROME_PASSWORD"
            if subsonic_ok(url, user, password):
                break
            say("Navidrome didn't take that")
        else:
            return "Music: not connected; put your login in the settings file (NAVIDROME_USER, NAVIDROME_PASSWORD)"
    else:
        return "Music: not connected (it plays your music folder on its own)"
    set_setting(install.settings, "NAVIDROME_USER", user)
    set_setting(install.settings, "NAVIDROME_PASSWORD", password)
    return f"Music: connected to Navidrome (as {user})"


def main():
    parser = argparse.ArgumentParser(description="Connect Music, Gallery and Documents to their apps.")
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--homelab", metavar="DIR", help="a homelab from spaceadler/homelab")
    where.add_argument("--standalone", metavar="DIR", help="standalone adlerOS's folder")
    parser.add_argument("--yes", action="store_true", help="ask nothing: only what needs no questions")
    args = parser.parse_args()
    install = Install(homelab=args.homelab, standalone=args.standalone)
    if not install.settings.exists():
        sys.exit(f"no settings file at {install.settings}")
    global WAIT
    if args.yes:
        WAIT //= 2  # the helper runs it after every App Store install: not long
    term = Terminal(not args.yes and sys.stdin.isatty())
    told = False
    for connect, name in ((paperless, "Documents"), (immich, "Gallery"), (navidrome, "Music")):
        try:
            result = connect(install, term)
        except EOFError:
            result = f"{name}: no answer; left as it was"
        if result:
            say(result)
            told = True
    if not told:
        say("Navidrome, Immich and Paperless aren't among your apps: nothing to connect")


if __name__ == "__main__":
    main()
