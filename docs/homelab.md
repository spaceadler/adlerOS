# adlerOS in spaceadler/homelab

[spaceadler/homelab](https://git.spaceadler.com/spaceadler/homelab) is a
clone-and-run homelab: one `install.sh`, a catalog of apps in collections, and
adlerOS as its home screen. There, adlerOS runs in **homelab mode**.

## How it's put together

- The homelab's `install.sh` fetches adlerOS into
  `containers/core/os/adleros/` (a shallow git checkout, never committed to
  the homelab) and updates it on every run. `ADLEROS_REPO` and `ADLEROS_REF`
  in `homelab.env` pick another copy or version.
- `containers/core/os/docker-compose.yml` runs adlerOS's `app/` from there,
  with `ADLEROS_MODE: homelab`, at `os.<domain>` and port 8686.
- The helper is `homelab-agent.path` and `.service`, running adlerOS's
  `agent/agent.py` with `HOMELAB_DIR` set. It loads adlerOS's actions (apps,
  restart, shut down) and the homelab's own in `scripts/agent/actions.json`
  (apply settings, back up, update).

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
adlerOS. `install.sh` won't overwrite local changes; it says it kept your
copy. Static files (`app/static/`) show up on a reload; `app/server.py` needs
`docker compose restart` in `containers/core/os`.
