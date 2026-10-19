# adlerOS in spaceadler/homelab

[spaceadler/homelab](https://github.com/spaceadler/homelab) is a
clone-and-run homelab: one `install.sh`, a catalog of apps in collections, and
adlerOS as its home screen. There, adlerOS runs in **homelab mode**.

## How it's put together

The two repositories have one job each. **spaceadler/homelab** is the
homelab: the machine's setup, the apps, their recipes, storage and
addresses, and nothing of adlerOS. **This repository** is all of adlerOS,
including how it runs in that homelab (`homelab/`). The homelab's
`install.sh` only fetches adlerOS and hands over to adlerOS's installer:

1. **It fetches adlerOS** into `containers/core/os/adleros/` (a shallow git
   checkout), and updates it on every run: from GitHub, else each of
   `ADLEROS_MIRRORS` (by default the Gitea it's pushed to). `ADLEROS_REPO`
   and `ADLEROS_REF` in `homelab.env` pick another copy or version.
   `ADLEROS=off` (or `--no-adleros`, or no to its first question) sets the
   homelab up without adlerOS, and without the helper, which is adlerOS's.
2. **Once the homelab's apps are configured, it runs `install.sh --homelab
   <the homelab>` from that copy** (with `--no-host` and `--no-start` when
   it has them itself). That's the same installer as standalone; the
   argument tells it where it is, so it takes the homelab's settings
   (`homelab.env`) and folders. It writes all of `containers/core/os/`:
   - `docker-compose.yml`, from `homelab/docker-compose.yml` here:
     `ADLEROS_MODE: homelab`, the homelab's catalog, extras, settings,
     storage and mailbox mounted in;
   - `.env`, with the password and session key (made once, then kept),
     your name (it asks), and the homelab settings the container needs,
     again every run;
   - `data/`, `wallpaper/`, `icons/`;
   - and `os.conf` among the homelab's nginx sites, from
     `homelab/nginx.conf.template` (`os.<domain>` → its Tailscale IP, port
     8686).

   Then **the helper**: `homelab-agent.path` and `.service` (from
   `homelab/`), running adlerOS's `agent/agent.py` with `HOMELAB_DIR` set,
   so it loads adlerOS's actions (apps, restart, shut down) and the
   homelab's own in its `scripts/agent/actions.json` (apply settings, back
   up, update); the power script and its sudo rule
   (`/etc/sudoers.d/adleros`); the terminal host, if `ADLEROS_TERMINAL=on`.
   (The homelab's `install.sh` keeps one root step of its own for the
   helper: its backup script and `/etc/sudoers.d/homelab`.) Last, it starts
   adlerOS.
3. **Once the apps are up, it runs `install.sh --homelab <the homelab>
   --connect`**, which connects Music, Gallery and Documents
   (`agent/connect.py`): Documents by itself, with the admin login the
   homelab gave Paperless; Gallery and Music with your Immich and Navidrome
   logins, making the admin where there's none yet. The keys go into
   `homelab.env`. The homelab's summary shows adlerOS's password the first
   time.

So a fix to adlerOS, even to how it runs in a homelab, is made here, and a
homelab picks it up on its next `./install.sh`.

## What's different from standalone

| | Homelab mode | Standalone |
| --- | --- | --- |
| Apps come from | `containers/catalog.tsv` and `APPS` in `homelab.env`, plus imported ones (`containers/extras/<app>/`) | your compose folders, plus imported and store apps (`registry/<app>/`) |
| Collections | the catalog's folders: core, system, media, knowledge, productivity, life, files; imports by what they are, else Extras | by what each app is, else Extras |
| Install | adds the app to `APPS` and re-runs `install.sh`, which sets it up (passwords, nginx route, dashboard entry) | copies a store template, fills in `.env`, starts it |
| Delete | takes it out of `APPS` and re-runs `install.sh`; core apps (Pi-hole, Vaultwarden) can't be deleted | marks it not installed |
| Settings | domain, timezone (applied by `install.sh`), HTTPS, Tailscale, storage, back up, update the homelab | address, compose folders, look for new apps, update adlerOS |
| Addresses | `http(s)://<sub>.<domain>` from the catalog | `http://<ADLEROS_HOST>:<port>` |

Everything else (the desktop, dock, widgets, App Store buttons, Live Usage,
notifications, keyboard, admin mode, the terminal) is the same. The terminal
is switched on with `ADLEROS_TERMINAL=on` in `homelab.env`, then
`./install.sh`; it starts in the homelab's folder (`ADLEROS_TERMINAL_DIR`
picks another). In Files, the Desktop is the homelab's `mailbox/` (so desktop
mode's desktop is your inbox, synced by Syncthing), User is `STORAGE_DIR`, and
Root is the homelab itself, read-only unless admin mode is on and
`ADLEROS_TERMINAL=on`.

## Changing adlerOS while working on the homelab

Edit `containers/core/os/adleros/` directly to try something (it's a git
checkout: `git -C containers/core/os/adleros diff`), then send it upstream to
adlerOS. The homelab's `install.sh` won't overwrite local changes; it says it
kept your copy. A change to `homelab/` here reaches `containers/core/os/` on
the next `./install.sh` (adlerOS's installer writes it again). Static files (`app/static/`) show up on a reload; `app/server.py` needs
`docker compose restart` in `containers/core/os`.
