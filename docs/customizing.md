# Customizing adlerOS

Most of adlerOS is data: lists you can add a line to without touching code.

## Wallpaper

Put any image (`.jpg`, `.png`, `.webp`, `.avif`) in `wallpaper/` (in a
homelab: `containers/core/os/wallpaper/`), then pick it in **Settings →
Wallpaper**. The built-in ones are NASA photographs.

## Dock icons

The four fixed dock items (All apps, App Store, Settings, Live Usage) have
icons drawn for adlerOS. To use your own, put `app-drawer`, `app-store`,
`settings` or `live-usage` with `.svg`, `.png` or `.webp` in `icons/` (in a
homelab: `containers/core/os/icons/`), then `docker compose up -d`. A square
image works best; the dock doesn't round it for you.

App icons come from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons),
fetched once and kept in `data/icons/`. An app without one gets a coloured
tile with its initials.

## Widgets

`app/static/widgets-catalog.json` lists the widgets **Edit widgets** offers.
Each has a `type` (how it's drawn: `four-stats`, `three-stats`, `progress`,
`gauges`, `list`, `text-button`, `clock`), the named `value`s it shows (from
`VALUES` in `app/static/widgets.js`, which read `GET /api/widgets`), and what
clicking it opens (`live-usage`, `app-store`, `settings`, `settings:<row>`).
Add an entry to offer a new combination; add to `VALUES` for a new number.

## Settings rows

`app/static/settings-catalog.json` is the Settings window. A row has a
category, an icon (from `ICONS` in `settings.js`), a title, a description,
search keywords, and a `control`:

| `control.type` | |
| --- | --- |
| `setting-text` | edits one of adlerOS's own settings (`key`), saved at once |
| `password`, `wallpaper`, `admin` | those built-in controls |
| `open` | a button opening one of adlerOS's windows (`target`: `terminal`) |
| `config` | a value in the homelab's `homelab.env`, applied by an action that accepts it |
| `action` | a button running an action (below), after an optional confirmation |
| `info` | a read-only value: `config.<KEY>`, `device.<field>`, or a named formatter |

`"mode": "homelab"` or `"standalone"` shows a row only in that kind of
install; `"admin": true` makes it work only in admin mode.

## Actions

`agent/actions.json` is everything the helper will do. A homelab adds its own
in `scripts/agent/actions.json`. Each action:

```json
"app-start": {
  "label": "Starting",
  "description": "Starts every container of the app.",
  "params": { "app": { "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" } },
  "steps": [
    { "run": ["python3", "-I", "{adleros}/agent/apps.py", "start", "{param:app}"] }
  ]
}
```

- `params`: every value must match its `pattern`; anything else is refused,
  by adlerOS's server and again by the helper.
- `steps`: `run` a command (no shell; `{adleros}` and `{homelab}` are folders,
  `{param:X}` a whole argument), or `set-config` to write params into the
  settings file. `"result": true` on a run step hands its JSON output to the
  page.
- `"quiet": true` for status checks (they don't count as "something's
  running"), `"admin": true` (or `"core"`, for core apps only) for admin mode,
  `"mode"` for one kind of install.

Root steps go through sudo to a root-owned script; add one to `install.sh`'s
sudo rule only if you're sure.

## Known apps

`catalog/known-apps.tsv` teaches adlerOS what an image is. One tab-separated
line per app:

```text
deluan/navidrome|navidrome	navidrome	Navidrome	media	di:navidrome	Music streaming	4533
```

The image paths (or just last parts) it matches, separated by `|`; a short id;
the name; the collection (`core`, `system`, `media`, `knowledge`,
`productivity`, `life`, `files`, `extras`); a `di:` icon or `-`; one line about
it; and the port it listens on when it shares the host's network (or `-`).
After adding a line, **Look for new apps** picks it up for new files; for an
app adlerOS already found, edit its `registry/<app>/app.json` (or remove and
import it again).

## Store apps

Each folder in `catalog/store/` is one app adlerOS can install:

```text
catalog/store/memos/
├── docker-compose.yml   # ports "${PORT}:5230", volumes ./data:...
├── .env.example         # PORT=__PORT__, and any secrets
└── app.json             # name, collection, icon, about, port, firstRun
```

When it's installed, `.env.example` becomes `.env` with these filled in:
`__PORT__` (the first free port from `port` in `app.json`), `__PASS__` (a new
password each time it appears), `__HEX64__` (a new key), `__TZ__`, `__PUID__`,
`__PGID__` and `__STORAGE__` (the storage folder). Folders the compose file
mounts with `./` or `${...}` are made first, as you. `firstRun` is shown on
its card: what to do on first login.

Keep a store app simple: one compose file that starts on its own, no config
file you have to write first, its data in `./`, and no Docker socket.
