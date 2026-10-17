# Using adlerOS

A tour of everything on the screen, and the two built-in apps, Files and the
Terminal. Every part works with a mouse, a touch
screen, or a keyboard alone ([docs/keyboard.md](keyboard.md)).

## Logging in

<!-- screenshot: the lock screen -->
![The lock screen](screenshots/lock.png)

adlerOS asks for its password (`OS_PASSWORD` in `.env`, until you change it in
Settings). A login lasts 30 days in that browser. Too many wrong tries locks
that address out for a while. Log out from the desktop's right-click menu, or
Settings.

## The desktop

<!-- screenshot: the desktop -->
![The desktop](screenshots/desktop.png)

- **The greeting** changes with the time of day: *Good morning* from 5:00,
  *afternoon* from 12:00, *evening* from 17:00, and something for night owls
  from 22:00. Set your name in Settings.
- **The search bar** searches the web: your own SearXNG or 4get if adlerOS
  finds one, else DuckDuckGo. Change where it goes in Settings → Web search.
- **Widgets:** up to three. Right-click the desktop (long-press on a phone) →
  **Edit widgets**, then tick the ones you want; they fill in from left to
  right in the order you pick them. Click a widget to open what it's about:
  the system ones open Live Usage, the apps ones the App Store.

  <!-- screenshot: the widget picker -->
  ![Edit widgets](screenshots/widgets-picker.png)

- **Your apps**, one page per collection, its name above it. Swipe, use the
  dots under them, or the arrows at the sides to move between pages. An app
  that doesn't answer turns dim and says *Offline*. An app with no web page
  (a game server, a bot) opens its App Store card instead.
- **Rearranging:** drag an app to a new place on its page. On a touch screen,
  long-press → **Rearrange apps**, drag, then **Done**. From the keyboard,
  the same menu, then the arrow keys move the app.
- **The bell**, top right: notifications (below).

## The dock

<!-- screenshot: the right-click menu on an app, with Keep in Dock -->
![An app's menu](screenshots/dock-menu.png)

Pin any app: right-click it (long-press on a phone) → **Keep in Dock**. Drag
pinned apps to reorder them; right-click → **Remove from Dock** to unpin.
After a divider come adlerOS's own four, which always stay:

| | |
| --- | --- |
| **All apps** | Every app, A to Z, with a search box. Type to narrow it down; Enter opens the first match. |
| **App Store** | Your apps and their containers; apps to install. |
| **Settings** | Your name, password, wallpaper, admin mode, the machine. |
| **Live Usage** | CPU, memory, storage and temperature, and every app's share. |

Click one again to close its window. Put your own icon for any of the four in
`icons/` ([customizing](customizing.md#dock-icons)).

<!-- screenshot: the All apps drawer -->
![All apps](screenshots/all-apps.png)

## Search

<!-- screenshot: ⌘K search -->
![Search](screenshots/search.png)

⌘K, Ctrl+K, or `/` opens a search across your apps, every setting ("timezone",
"back up") and adlerOS's windows. Arrow keys pick, Enter opens.

## The App Store

<!-- screenshot: the App Store -->
![The App Store](screenshots/app-store.png)

Every app on your desktop, by collection, with what its containers are doing:
*Running*, *Partly running (1 of 2)*, *Stopped*, *Restarting*, *Running,
unhealthy*, or *No containers*. Click the line under a card to see each
container. The buttons:

| | |
| --- | --- |
| **Open** | Its web page, in a new tab. |
| **Start** | Starts its containers (`docker compose up -d`). An app with a `pre-start.sh` that says "not yet" (Kiwix without an archive, say) says why. |
| **Stop** | Stops them; they stay, ready to start again. |
| **Restart** | Restarts them, or starts them if there are none. |
| **Update** | Pulls the newest images and recreates the containers on them; data stays. It's highlighted, and the card says *Update available*, when [Cup](https://github.com/sergi0g/cup) is installed and knows of a newer image. |
| **Logs** | The last few hundred lines its containers wrote. |
| **Delete** | Removes its containers and takes it off the desktop. Its data and compose files stay, so **Install** brings it back exactly as it was. Needs admin mode. |
| **Remove** | (Imported and found apps) takes it out of adlerOS without touching its containers or files. |

<!-- screenshot: an app's Logs window -->
![Logs](screenshots/app-logs.png)

**Not installed**, below your apps, lists what you can install: apps from
adlerOS's store (standalone) or the homelab's catalog (homelab mode), and apps
you deleted. A card's *First time* note says what to do on first login.
Installing or deleting can take a minute or two; **Details** on the card shows
it working.

A few things need **admin mode** (Settings → System): deleting apps, and
stopping core apps (DNS, proxies, the password manager), since your network
and logins depend on them.

### Importing apps adlerOS didn't find

**Import apps…** at the top of the App Store asks for a folder in your home
folder, then lists the compose files in it and two levels below. Tick the
ones to bring in and go through them one at a time, *File 2 of 5*:

<!-- screenshot: an import step -->
![Import, one file at a time](screenshots/import-file.png)

- The compose file is on the left; its services on the right.
- **Tick each service that's an app of its own**, the one with a web page you
  open, and give it a name, an address (it suggests
  `http://<this machine>:<port>`) and an icon (`di:` and a name from
  [dashboard-icons](https://github.com/homarr-labs/dashboard-icons)). One file
  can hold several apps: tick them all.
- Every other service (a database, a cache) is **part of** one of them,
  guessed from `depends_on`; change it if the guess is wrong, or leave it out.

Nothing is copied or moved: adlerOS records where the file is and which
services are whose, then starts, stops and deletes only those. A known app
goes in its collection; anything else in Extras.

## Live Usage

<!-- screenshot: Live Usage -->
![Live Usage](screenshots/live-usage.png)

CPU, memory, storage and temperature, each with a word for how it's doing
(*Normal*, *Busy*, *High*), and charts of the last three minutes: hover one for
the value at any moment. Below, **By app**: every app's share of the CPU or
memory, busiest first, from `docker stats`. Apps with nothing running are at
the bottom; containers that aren't part of any app are a line of text.

## Notifications

<!-- screenshot: the notifications panel -->
![Notifications](screenshots/notifications.png)

The bell, top right, collects what happened while you weren't looking, and new
ones pop up at the bottom of the screen:

- an app stopped answering (after two checks a minute apart), or came back;
- a backup, update, install or settings change finished, or anything failed;
- the disk is over 90% full (once a day), or the machine is over 80 °C (once
  an hour);
- Cup found more images with updates.

Opening the panel marks them read; click one to go where it's about.

## Settings

<!-- screenshot: Settings -->
![Settings](screenshots/settings.png)

On the left: the machine at a glance (address, uptime, apps) and its storage,
memory, CPU and temperature. On the right, the settings, filtered by the tabs
or the search box:

- **Account:** your name for the greeting, the password (other browsers are
  logged out when it changes), the wallpaper, and where web searches go.
- **This machine** (or **Homelab**): its address and compose folders, and
  *Look for new apps* (standalone); the domain, timezone, HTTPS and storage
  folder (homelab).
- **System:** **Admin mode**, updating, the **Terminal**, the device,
  **Restart** and **Shut down**.

**Admin mode** is off until you switch it on, which asks for your password:

<!-- screenshot: the admin mode dialog -->
![Admin mode](screenshots/admin-mode.png)

Only while it's on can you restart or shut down the machine, delete apps, or
stop core apps. adlerOS's server checks it on every request, not just the
buttons on the page. It stays on, for every browser, until you switch it off.

## Files

<!-- screenshot: Files, a folder of documents -->
![Files](screenshots/files.png)

Your storage folder (`STORAGE_DIR`: photos, music, documents, notes), in a
window: **All apps → Files**, ⌘K "files", or `f`. Nothing outside that folder
is reachable, and a link that leads out of it is shown greyed out and won't
open.

- **Open** a folder to go in; the path at the top takes you back up. A text
  file opens in the editor, an image, video, song or PDF in a preview,
  anything else downloads.
- **Upload** with the button, or drop files onto the window; big files are
  fine. A file with a name that's taken gets a `(2)`.
- **New folder**, **New text file**, and per file (right-click, `m`, or the
  keys below): Rename, Download, Edit as text, Delete.
- **Delete** moves it to the **Trash** (a `.trash` folder in your storage
  folder), where **Restore** puts it back where it was. **Empty Trash**
  deletes for good.

<!-- screenshot: the text editor -->
![The editor](screenshots/editor.png)

**The editor** opens text files up to 2 MB: notes, configs, compose files,
code. Ctrl+S (⌘S) saves; Tab indents. If something else changed the file
since you opened it, it asks before saving over it. Leaving with unsaved
changes asks first.

## Terminal

<!-- screenshot: the Terminal window running htop -->
![Terminal](screenshots/terminal.png)

A shell on this machine, as you, in a window: **Settings → System →
Terminal**, ⌘K "terminal", or `t`. It's off unless it's switched on *on the
machine itself* (`ADLEROS_TERMINAL=on`, see
[standalone](standalone.md#settings-in-env) or [homelab](homelab.md)), it opens
only in admin mode, and it asks for your password every time.

It's a real terminal: colours, `htop`, `nano`, `vim`, Tab completion,
scrollback (scroll up), copy (select) and paste. While you're typing in it,
every key goes to the shell, Escape included; **Ctrl+Shift+Q** or ✕ closes it
and ends the session. Opening another window only puts it away: `t` brings
the same session back. A session also ends when the shell exits, after 30
minutes without typing, or when admin mode is switched off. Up to three at
once.

## On a phone

<!-- screenshot: the desktop on a phone -->
![On a phone](screenshots/phone-desktop.png)

Same as on a computer, sized for it: 4×3 apps a page, swipe between pages,
long-press for menus. *Share → Add to Home Screen* makes it open full-screen,
like an app.
