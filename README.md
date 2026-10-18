# adlerOS

**A home screen and App Store for the Docker apps on your homelab.** Point it
at the folders where your `docker compose` files live; it finds every app,
sorts it into a collection (Media, Knowledge, Files…), and gives you one place
to open, start, stop, update, read the logs of, and delete them, plus a store
of apps to install. It looks and feels like umbrelOS, but it isn't a locked
appliance: it runs next to whatever you already have, on any machine with
Docker, and your compose files stay yours.

<!-- screenshot: the desktop, at 1440×900 or larger, see docs/screenshots/README.md -->
![adlerOS desktop](docs/screenshots/desktop.png)

```bash
cd ~/docker   # wherever your compose folders are: adlerOS is one of them
git clone https://git.spaceadler.com/spaceadler/adleros.git
cd adleros && ./install.sh
```

It asks a few things (your name, this machine's address, where your compose
files are, your timezone…), finds your apps, and prints the address and a
password: `http://<this machine>:8686`. It never lists itself among them, so
you can't stop it from inside it. Open it on your phone and *Add to Home
Screen*: it opens like an app.

## What you get

- **A desktop.** A greeting, up to three widgets (system stats, storage,
  apps up and down, the clock…), a web search bar, and your apps as icons,
  one page per collection. An app that stops answering turns dim and says
  *Offline*.
- **A dock** of the apps you pin, plus All apps, the App Store, Settings and
  Live Usage. It magnifies like a Mac's.
- **The App Store.** Every app with what its containers are doing (*Running*,
  *Partly running (1 of 2)*, *Stopped*…) and buttons to start, stop, restart,
  update, read logs and delete it; *Update available* when there's a newer
  image. Under it, apps you can install.
- **Import.** Already run apps adlerOS didn't find? Point it at a folder; go
  through the compose files one by one, ticking which services are apps (one
  file can hold several).
- **Live Usage.** CPU, memory, storage and temperature as they change, and
  every app's share of the CPU and memory.
- **Notifications.** An app went offline (or came back), a backup or update
  finished or failed, the disk is filling up, it's running hot.
- **All apps**, A to Z, and **search** (Alt+Space or `/`) across apps,
  settings and every file in your homelab by name.
- **A welcome** on the first login: where are your containers (it looks there
  while you watch), or in a homelab the apps you can add, then a short tour.
- **Keyboard first.** Every part works with arrow keys, Enter and Escape: a
  keyboard and a TV is enough. Press `?` for the keys.
- **Admin mode.** Restart and shut down, deleting apps, and stopping core
  apps (DNS, passwords) are off until you switch admin mode on, with your
  password.
- **Desktop mode**, for a computer with a mouse (each device chooses):
  windows side by side that you drag, resize and snap to half the screen,
  your apps in windows of their own, and your Desktop folder on the desktop.
- **My Computer**: your Desktop, your storage folder and (read-only) your
  homelab's own folder, in a window. Upload, download, cut, copy and paste
  between them, rename, delete into a Trash you can restore from; photos,
  videos, PDFs and songs open in windows of their own.
- **Notepad** for text files, and **adlerMD** for notes: Markdown in vaults,
  Obsidian's way (an Obsidian vault works in both), with links, embeds,
  callouts, backlinks, the graph and Bases.
- **Firefox** in the store: a real browser running on the machine, in your
  browser. With My Computer and the terminal, an old laptop is enough to work on
  your homelab.
- **A terminal**, if you want one: a real shell in a window (colours, `htop`,
  `vim`), off unless you switch it on on the machine, and only there in
  admin mode.

<!-- screenshot: the App Store with a few apps, one card's containers open -->
![The App Store](docs/screenshots/app-store.png)

## How it sorts your apps

adlerOS reads each compose file with `docker compose config` (which never
starts anything) and looks at the images. `catalog/known-apps.tsv` knows about
146 self-hosted apps: Immich and Jellyfin go in **Media**, Paperless-ngx in
**Productivity**, Actual Budget in **Life**, and so on. Databases and caches
(Postgres, Redis…) are never apps of their own; they belong to the app that
needs them. One compose file with two apps in it (Ollama and Open WebUI, say)
becomes two apps, each starting and stopping only its own containers. Anything
it doesn't know goes in **Extras**, named after its folder. Teach it an app by
adding a line to that file.

The collections are **Core** (DNS, proxies, VPN, passwords), **System**
(dashboards, monitoring), **Media**, **Knowledge** (notes, wikis, bookmarks,
search, AI), **Productivity** (tasks, documents, office, automation), **Life**
(places, trips, money, food, health), **Files** (sync, git, downloads,
backups) and **Extras**.

## Two ways to run it

- **On its own (standalone):** `./install.sh` here, on any machine that runs
  Docker. Your apps come from your compose folders; new ones from adlerOS's
  store. See [docs/standalone.md](docs/standalone.md).
- **Inside a homelab built from
  [spaceadler/homelab](https://git.spaceadler.com/spaceadler/homelab):** its
  `install.sh` fetches adlerOS into `containers/core/os/adleros` and runs it in
  *homelab mode*: apps come from the homelab's catalog, and the App Store
  installs and deletes them through the homelab's `install.sh`. See
  [docs/homelab.md](docs/homelab.md).

## How it stays safe

The web app has no Docker and no root access. It runs as you, in a read-only
container with no capabilities, behind its own password. Anything that changes
the machine (start an app, install one, restart) is written as a request into
`data/agent/queue`, where a small **helper** on the host (`agent/agent.py`,
started by systemd) picks it up and runs it **only** if it's one of the
actions in `agent/actions.json`, with every parameter checked against a
pattern, and never through a shell. Restart and shut down are the only root
steps, through a sudo rule for exactly one script. See
[docs/security.md](docs/security.md) for what that does and doesn't protect.

Keep adlerOS on your own network or a VPN such as Tailscale. Don't publish it
to the internet.

## More

| | |
| --- | --- |
| [docs/guide.md](docs/guide.md) | A tour: everything on the screen and what it does |
| [docs/keyboard.md](docs/keyboard.md) | Every key, for a keyboard and a TV |
| [docs/standalone.md](docs/standalone.md) | Installing on any homelab, your compose folders, the store, updating, removing |
| [docs/homelab.md](docs/homelab.md) | How spaceadler/homelab runs it |
| [docs/customizing.md](docs/customizing.md) | Wallpapers, dock icons, widgets, settings, actions, known apps, store apps |
| [docs/security.md](docs/security.md) | The trust model, in detail |
| [docs/screenshots/README.md](docs/screenshots/README.md) | The screenshots these docs use, and how to take them |

## What's in here

```text
adleros/
├── install.sh            # standalone install: settings, helper, your apps, start
├── docker-compose.yml    # the adlerOS container (standalone)
├── .env.example          # its settings; install.sh makes .env from it
├── app/                  # the web app: server.py (Python standard library) + static/
├── agent/
│   ├── agent.py          # the helper: runs queued requests from the list below
│   ├── actions.json      # the only things it will do
│   ├── apps.py           # finds, installs, starts, stops, updates and deletes apps
│   ├── terminal.py       # the Terminal's shells (only with ADLEROS_TERMINAL=on)
│   ├── files.py          # changes in Files' Root (admin mode, ADLEROS_TERMINAL=on)
│   └── power             # restart / shut down, installed root-owned for sudo
├── catalog/
│   ├── known-apps.tsv    # which images are which app, and their collection
│   └── store/<app>/      # the store: a compose file, .env.example and app.json each
└── docs/
```

Made by install.sh and never committed: `.env`, `data/` (adlerOS's settings,
icons it fetched, the helper's queue, the empty folders Files mounts when
there's no Desktop or Root), `registry/` (the apps it knows about),
`apps/` (apps from the store), `wallpaper/` and `icons/` (yours, if you add
any).

## Credits

- **Design:** modelled on the umbrelOS desktop by [Umbrel](https://umbrel.com).
  Its layout, sizes and behaviour were studied from umbrelOS's public source
  and reimplemented here in plain HTML, CSS and JS. No umbrelOS code or artwork
  is included.
- **Dock icons:** drawn for adlerOS (`app/static/dock/`). The App Store icon
  is its own design, not Apple's.
- **Font:** [Inter](https://rsms.me/inter/) by Rasmus Andersson, under the SIL
  Open Font License (`app/static/fonts/OFL.txt`).
- **Wallpapers:** NASA photographs from the ISS and the Space Shuttle, in the
  public domain: the aurora (`iss072e159172`) and a sunrise over Earth's limb
  (`STS052-23-022`), from [images.nasa.gov](https://images.nasa.gov).
- **App icons:** fetched at runtime from
  [dashboard-icons](https://github.com/homarr-labs/dashboard-icons). Each icon
  belongs to its app's project.

There is no licence file yet, so for now all rights are reserved by the author;
one will be added before others are invited to reuse it.
