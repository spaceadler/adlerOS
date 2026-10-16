# adlerOS on any homelab

adlerOS doesn't need a particular setup. If a machine runs Docker and you keep
your apps in `docker compose` files, adlerOS can find them, sort them, and
manage them, without moving or changing anything.

## What you need

- Linux with **systemd** (Debian, Ubuntu, Raspberry Pi OS, Fedora, Arch…),
  64-bit, ARM or x86.
- **Docker** with the **Compose plugin** (`docker compose version` works), and
  your user in the `docker` group.
- `python3`, `git`, `openssl` and `envsubst` (in the `gettext` package).
  Most systems have all but the last.
- `sudo`, once, for the helper's systemd units and its one sudo rule.

## Installing

```bash
git clone https://git.spaceadler.com/spaceadler/adleros.git ~/adleros
cd ~/adleros && ./install.sh
```

<!-- screenshot: ./install.sh finishing -->
![install.sh](screenshots/install.png)

It asks four things, each with a guess you can take by pressing Enter:

| Question | Becomes | Guess |
| --- | --- | --- |
| Your first name | `OS_NAME`, for the greeting | none |
| This machine's address | `ADLEROS_HOST`: apps get `http://<this>:<port>` | its Tailscale IP, else its first IP |
| Your compose folders | `COMPOSE_ROOTS`, separated by `:` | whichever of `~/docker`, `~/stacks`, `~/compose`, `~/homelab/containers`, `~/containers`, `/opt/stacks`, `/opt/docker`, `/srv/docker` exist |
| Timezone | `TZ` | the machine's |

Then it:

1. writes `.env` (only you can read it) with a new password and session key,
2. installs **the helper**: `/etc/systemd/system/adleros-agent.path` and
   `.service`, which run `agent/agent.py` as you whenever adlerOS asks for
   something; `/usr/local/libexec/adleros/power` and `/etc/sudoers.d/adleros`
   so it can restart and shut down, and nothing else as root,
3. **finds your apps** (below),
4. starts adlerOS, and prints its address and password.

`./install.sh --yes` takes the guesses (or what's already in `.env`) without
asking. `--no-host` skips the helper: adlerOS shows your apps, but can't start
or stop them. Running it again is safe: it keeps the password and the apps it
knows, and adds new ones.

## How it finds your apps

Every compose file in your compose folders, and in the folders up to three
levels below them, becomes one or more apps:

1. `docker compose config` reads the file (with its `.env`), without starting
   anything.
2. Each service's image is looked up in `catalog/known-apps.tsv`.
   `lscr.io/linuxserver/jellyfin:10.9` is Jellyfin: a registry in front and a
   tag behind don't matter.
3. Databases and caches (Postgres, MariaDB, Redis, Valkey, Mongo, CouchDB,
   Meilisearch, Immich's machine learning…) are never apps; they belong to the
   app that `depends_on` them.
4. Proxies and updaters (Caddy, Traefik, Watchtower, WebDAV, tunnels) next to
   other services are part of that stack. On their own, they're apps.
5. One known app: the whole file is that app. Several (Ollama and Open WebUI):
   one app each, with the services each depends on; leftovers go with the
   first. None: the file is one app named after its folder, in **Extras**. If
   the folder's name is a known app (an image you built yourself, say), it's
   that app.
6. Its address is `http://<ADLEROS_HOST>:<port>`, from the first published
   port that's a web page (plain HTTP before HTTPS; never SSH, DNS or a
   database). On host networking, where there's nothing published, the port
   the app usually listens on. No web port: no address, and its icon opens its
   App Store card.

The result for each app is `registry/<app>/app.json`: its name, files,
services, address, icon and collection. Edit one by hand if a guess is wrong
(then reload the page), or remove it in the App Store and import the file
instead.

New compose files later? **Settings → Look for new apps**, or
`python3 agent/apps.py discover`. It only adds; apps it knows are left alone.

## The store

**Not installed** in the App Store lists adlerOS's own store, minus apps you
already have: Jellyfin, Navidrome, Audiobookshelf, Kavita, Memos, linkding,
FreshRSS, SearXNG, Uptime Kuma, IT Tools, Stirling-PDF, n8n, Vikunja, Actual
Budget, Mealie, Syncthing, qBittorrent and PairDrop.

Installing one copies `catalog/store/<app>/` to `apps/<app>/` (or
`APPS_DIR/<app>`), writes its `.env` with new passwords, your timezone and user,
and the first free port from the one it likes, creates its folders as you,
and starts it. Media apps read from your storage folder (`STORAGE_DIR`, or
`~/storage`): `Media/Music`, `Media/Books`, `Media/Audiobooks`, `Downloads`…
Its card says what to do on first login. Delete keeps its folder and data;
Install brings it back.

To add your own, see [customizing](customizing.md#store-apps).

## Settings in .env

| Key | What |
| --- | --- |
| `OS_PASSWORD` | adlerOS's password (or change it in Settings) |
| `OS_SESSION_SECRET` | signs logins; changing it logs every browser out |
| `OS_NAME` | your first name |
| `ADLEROS_PORT` | where adlerOS answers, 8686 |
| `ADLEROS_HOST` | how your browser reaches this machine |
| `COMPOSE_ROOTS` | your compose folders, `:`-separated |
| `APPS_DIR` | where store apps go (`./apps`) |
| `STORAGE_DIR` | your files, for store apps that use them (`~/storage`) |
| `TZ`, `PUID`, `PGID` | timezone, and the user adlerOS and store apps run as |

After editing: `docker compose up -d` in this folder.

## Updating

**Settings → Update adlerOS** (or `git pull && docker compose up -d && docker
compose restart`). Your settings, apps and data aren't in git, so they're
untouched.

## Removing it

```bash
cd ~/adleros && docker compose down
sudo systemctl disable --now adleros-agent.path
sudo rm /etc/systemd/system/adleros-agent.{path,service} /etc/sudoers.d/adleros
sudo rm -r /usr/local/libexec/adleros
```

Your apps keep running as they were; adlerOS only ever started and stopped
them. Store apps are in `apps/`: `docker compose down` in each before deleting
the folder, if you want them gone too.
