# Features

← [README](../README.md)

Everything adlerOS does, in one list. The [guide](guide.md) walks through each part on screen.

## On top, not instead

adlerOS sits on top of a homelab a person built and set up; it doesn't
replace any of it. The containers, their storage and the network between
them are the base, and they just work, with adlerOS running or not.
adlerOS brings them under one roof, to manage, use and work from. You can
live in it, but nothing depends on it.

Your **storage folder** is the clearest case: next to the containers, full
of what they keep (photos, music, documents, notes), but on its own only
usable through File Browser or ssh. adlerOS makes it a shared desktop and
workspace. **Music, Gallery and Documents** are a layer over Navidrome,
Immich and Paperless-ngx: they ask those apps (with a login or key you make
in each) and show what they know in one place, the same way. They don't
replace them or change them, and need them for the rich parts; without
one, each still shows the files themselves. More in
[the guide](guide.md#how-it-fits).

## What you get

- **A desktop.** Up to three widgets (system stats, storage,
  apps up and down, the clock…), a web search bar, and your apps as icons:
  adlerOS's own first, a page per topic (adlerOS, Listen & Watch, Your
  Day, Notes & Documents), then one page per collection (Core's only in
  admin mode). An app that stops answering turns dim and says
  *Offline*.
- **A dock** of the apps you pin, plus All apps, the App Store, Settings and
  Live Usage. It magnifies like a Mac's.
- **The App Store.** Every app with what its containers are doing (*Running*,
  *Partly running (1 of 2)*, *Stopped*…) and buttons to start, stop, restart,
  update, read logs and delete it; *Update available* when there's a newer
  image. Under it, apps you can install.
- **Import.** Already run apps adlerOS didn't find? Point it at a folder; go
  through the compose files one by one, ticking which services are apps (one
  file can hold several). Or **add a website**: any address becomes an app,
  in a window like the rest; or, for a site you log in to, in a tab of its
  own or Firefox (Opens in, on its menu or its App Store card).
- **Live Usage.** CPU, memory, storage and temperature as they change, and
  every app's share of the CPU and memory.
- **Notifications.** An app went offline (or came back), a backup or update
  finished or failed, the disk is filling up, it's running hot.
- **All apps**, A to Z, and **search** (Alt+Space or `/`) across apps,
  settings and every file in your homelab by name.
- **A welcome** on the first login: what adlerOS is (and isn't), where your
  containers are (it looks there while you watch) or in a homelab the apps
  you can add, making your accounts in them, your storage, and connecting
  Music, Gallery and Documents to their apps (each one's connection, live);
  then a short tour.
- **Keyboard first.** Every part works with arrow keys, Enter and Escape: a
  keyboard and a TV is enough. Press `?` for the keys.
- **Admin mode.** Restart and shut down, deleting apps, and stopping core
  apps (DNS, passwords) are off until you switch admin mode on, with your
  password.
- **Desktop mode**, for a computer with a mouse (each device chooses):
  windows side by side that you drag, resize and snap to half the screen,
  your apps in windows of their own, and your Desktop folder on the desktop.
- **My Computer**, named after you (*Sam's Computer*, from your name in
  Settings): your Desktop, your storage folder and (read-only) your
  homelab's own folder, in a window. Upload, download, cut, copy and paste
  between them, rename, delete into a Trash you can restore from; photos,
  videos, PDFs and songs open in windows of their own. Type a path into
  its path bar (a click beside it, or Ctrl+L), and, in admin mode, **Open
  in Terminal** starts a shell in the folder you're in.
- **Notepad** for text files, and **Luna** for notes: Markdown in vaults,
  Obsidian's way (an Obsidian vault works in both), with links, embeds,
  callouts, backlinks, the graph and Bases.
- **Music**: your songs by album, artist and playlist (your `.m3u8` files,
  spotdl's included), a queue, shuffle and repeat, lyrics that follow the
  song (on the TV, full screen in the cover's colour, as Spotify's), and
  radio made from your own library. With your Navidrome login,
  what you play counts there too.
- **Gallery**: your photos from Immich, by month and day, albums, people,
  places and the map, favorites, On this day and search, each photo big
  with its details. Without an Immich key, the photos in your storage.
- **Documents**: your papers from Paperless, by tag, correspondent and
  type, searched by what they say, each with its preview and details.
  Without a Paperless token, the files in your storage.
- **Tasks**: your to-dos from Vikunja: Today, Upcoming, your projects as
  lists or kanban boards, due dates, priorities, labels, repeats. Without
  Vikunja, kept in adlerOS, and moved to it once it's connected.
- **Calendar**: your calendars from Radicale (or any CalDAV server), by day,
  week or month, each in its color, every repeat worked out. Drag an event
  to another time or day; edit it (repeats, travel time, its calendar); on
  the server, so your phone has it too.
- **Videos**: films, series and documentaries from Jellyfin (where you
  stopped, what's next), its key pasted in Videos; without it, the video
  files in your Media folders.
- **Books** and **Podcasts**: your audiobooks, books and podcasts from
  Audiobookshelf, with where you got to (one key for both); without it,
  the files in your Media folder. A mini player as Music's: the cover, where
  you are, back 15 and on 30 seconds, speed, the sleep timer and the volume.
- **Contacts**: the people in Monica (a personal CRM, in the store): how
  to reach them, birthdays, what you know and your notes, changed here and
  in Monica alike. Its token is pasted once in Contacts.
- **Live TV**: the channels in your M3U playlists (your provider's link, a
  .m3u in your storage, or iptv-org's free channels by country), by group,
  with favorites and search; Up and Down zap. In TV mode and in the car it's
  drawn big like Videos: favorites, all channels and groups, a channel the
  whole screen, Up and Down (or its buttons) to the next. ViniPlay is in the
  store too, for a TV guide and recordings.
- **Phone**: your contacts' numbers, favorites, recents and a keypad; a call
  goes to the device's own phone (an iPhone asks to call). In the car it's
  drawn big, as CarPlay's: favorites as faces, recents, contacts by letter,
  and a keypad beside the number.
- **Clock**: world clock (on a map), alarms with snooze, a stopwatch with laps,
  and timers, several at once; they ring on the device, StandBy too.
- **Five modes**, chosen on each device: the Home screen, Desktop, TV (for a
  remote), Car (a phone on the dashboard) and StandBy (a bedside clock and
  photo frame, over whichever of the others you were in).
- **Tailscale** in My Computer (admin mode): files sent to this machine land
  in User/Tailscale, "Get Tailscale files here" takes them into any folder,
  and "Send to a device" sends yours.
- **Settings → Connections**: every app adlerOS's own apps sit on, whether
  it's connected and how to connect it. With your Beszel login, the
  machine's numbers are Beszel's.
- **Firefox** in the store: a real browser running on the machine, in your
  browser. With My Computer and the terminal, an old laptop is enough to work on
  your homelab.
- **A terminal**, if you want one: a real shell in a window (colours, `htop`,
  `vim`), off unless you switch it on on the machine, and only there in
  admin mode. On a touch screen, a bar of the keys a phone hasn't (Esc, Tab,
  Ctrl, Alt, Shift, the arrows, Home, End, PgUp, PgDn).

## How it sorts your apps

adlerOS reads each compose file with `docker compose config` (which never
starts anything) and looks at the images. `catalog/known-apps.tsv` knows about
147 self-hosted apps: Immich and Jellyfin go in **Media**, Paperless-ngx in
**Productivity**, Actual Budget in **Life**, and so on. Databases and caches
(Postgres, Redis…) are never apps of their own; they belong to the app that
needs them. One compose file with two apps in it (Ollama and Open WebUI, say)
becomes two apps, each starting and stopping only its own containers. Anything
it doesn't know goes in **Extras**, named after its folder. Teach it an app by
adding a line to that file.

The collections are **Core** (DNS, proxies, VPN: shown in admin mode), **System**
(dashboards, monitoring), **Media**, **Knowledge** (notes, wikis, bookmarks,
search, AI), **Productivity** (tasks, documents, office, passwords, automation), **Life**
(places, trips, money, food, health), **Files** (sync, git, downloads,
backups) and **Extras**.

---

*powered by logic, coffee, and many sleepless nights*
