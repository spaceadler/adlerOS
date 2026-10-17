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

## The welcome

<!-- screenshot: the welcome asking where the compose folders are -->
![The welcome](screenshots/welcome.png)

The first time anyone logs in, adlerOS welcomes you. On its own it asks
**where your containers are**: the folders holding your compose files, one
per line (filled in with what `install.sh` was told). **Look for apps** sets
them and looks there while you watch, then says what it found, collection by
collection. In a homelab it shows instead **the apps you can add**: the
catalog's, by collection, each with a button to its App Store card. Then a
short look around: your apps, the dock, search, the bell, and where Files and
desktop mode are. **Skip the tour** (or Escape) ends it; it doesn't come back
by itself, but **Settings → Welcome tour** (or ⌘K "welcome") shows it again.

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
  the system ones open Live Usage, the apps ones the App Store, the backup one
  Settings.

  <!-- screenshot: the widget picker -->
  ![Edit widgets](screenshots/widgets-picker.png)

- **Your apps**, one page per collection, its name above it. Swipe, use the
  dots under them, or the arrows at the sides to move between pages. An app
  that doesn't answer turns dim and says *Offline*. An app with no web page
  (a game server, a bot) opens its App Store card instead.
- **Rearranging:** drag an app to a new place on its page. On a touch screen,
  long-press it and, without letting go, drag: the menu gives way and the
  apps start to wiggle; **Done** when you've finished. From the keyboard, its
  menu → **Rearrange apps**, then the arrow keys move it.
- **Folders,** like an iPhone's: drag an app onto another and hold a moment
  (the one under it grows), then let go: they're a folder. Drop more apps on
  it to add them. Tap it to open it; tap its name to rename it. Drag an app
  out past its edge to put it back on the page, or use its menu: **Remove
  from folder**. An app's menu also has **Add to a folder…** (a folder on its
  page, or a new one), and a folder's has **Rename…** and **Remove folder**
  (its apps stay). A folder belongs to its collection's page.
- **Collections are folders:** drag an app to the left or right edge and the
  page turns; drop it on another collection's page to move it there. Or
  right-click it → **Move to another collection…** (on an Extras app, **Put
  in a collection…**), which also lists the empty collections, and **Back
  to** where it came from. Only where adlerOS shows it changes: a core app
  stays core (admin mode to stop it) wherever you put it.
- **The bell**, top right: notifications (below).

## The dock

<!-- screenshot: the right-click menu on an app, with Keep in Dock -->
![An app's menu](screenshots/dock-menu.png)

Pin any app: right-click it (long-press on a phone) → **Keep in Dock**, on
the page or in All apps, or drag it from All apps onto the dock, where you
drop it. Drag pinned apps to reorder them; right-click → **Remove from Dock**
to unpin. After a divider come adlerOS's own: four that always stay, then
**Files** and the **Terminal**, pinned from the start (right-click → Remove
from Dock to take them out, Keep in Dock in All apps to bring them back):

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

## Desktop mode

<!-- screenshot: desktop mode, Files and an app side by side, icons on the desktop -->
![Desktop mode](screenshots/desktop-mode.png)

For a computer with a mouse: windows side by side, like any desktop. Switch it
on in **Settings → Desktop mode**, ⌘K "desktop mode", or right-click the
desktop. It's kept in that browser only, so the TV can stay on the home screen
while the laptop uses desktop mode. It's for computers: a phone never has it
(held upright, it gets the iPhone-style layout instead), and a browser window
made phone-narrow leaves it until it's wide again.

- **The desktop** shows your Desktop folder (a homelab's `mailbox/`) as icons.
  Double-click one (Enter, or a tap) to open it; right-click for Copy, Cut,
  Rename, Delete; right-click the desktop itself for New folder, New text
  file, Paste, Upload. Drag an icon to put it somewhere else on the desktop
  (each computer remembers where; one already there swaps places), onto a
  folder's icon to move it into that folder, or onto the Files window to move
  it to the folder that shows. Drop files from your computer on it to put
  them there.
- **Apps on the desktop:** in All apps, right-click an app (or Files, the
  Terminal) → **Add to desktop**. It's an icon there like the files:
  double-click to open it, drag it about, right-click → **Remove from
  desktop**.
- **Widgets on the desktop:** right-click the desktop → **Add widget…** and
  pick one (the same ones as the home screen's). It's three icons wide and a
  row and a half tall; drag it where you want it (icons make room), right-click it →
  **Remove widget**. Each computer keeps its own desktop: where things are,
  which apps and widgets. Files that arrive
  some other way (Syncthing) show up within 15 seconds.
- **Windows:** Settings, the App Store, Live Usage, Files and the Terminal
  open as windows you can have side by side. Drag one by its title bar; drag
  any edge to resize it; drag it to the left or right edge of the screen for
  that half, or to the top to fill the screen (or double-click its bar). The
  buttons on its bar minimize it to the dock, maximize it, and close it.
  Windows remember where you put them. They're glass: what's behind them
  (other windows, the desktop) shows through, blurred, and an app's page is
  a little see-through too; a maximized window is solid.
- **Your apps** open in windows of their own, if they allow it: adlerOS asks
  each app whether it may be shown inside another page, and opens the ones
  that say no in a tab, as on the home screen. Ctrl+click opens any app in a
  tab. An app's window has Reload and *Open in a new tab* on its bar.
- **The dock** shows what's open: a mark under pinned apps and adlerOS's own
  items with a window, and, after a divider at the end, the windows that have
  no place in the dock otherwise (Files, the Terminal, apps you haven't
  pinned). Click one to bring it forward, again to minimize it; right-click
  one whose window is open for **Close**.
- **Keys:** Ctrl+` goes to the next window, then the desktop; Ctrl+Shift+`
  goes back. On a title bar, `m` (or the Menu key) opens its menu: left or
  right half, maximize, minimize, close, or move and resize it with the
  arrow keys. See [keyboard](keyboard.md).

### Firefox

The App Store has **Firefox**: a real Firefox running on this machine, shown
in your browser. You browse from the machine (its network, its logins), from
any device, even a slow one. It's [linuxserver.io's
image](https://docs.linuxserver.io/images/docker-firefox/), so:

- It serves HTTPS with a certificate it makes itself: open it once in a tab
  and accept it.
- It needs a secure page around it, so it opens in a window only when adlerOS
  itself is on HTTPS, behind a reverse proxy, and Firefox has a proxy host of
  its own ([standalone](standalone.md#https-behind-a-reverse-proxy));
  otherwise in a tab.
- It's heavy: about 1 GB of memory and a good part of the CPU while it runs
  (a Raspberry Pi 4 manages, slowly for video). Stop it in the App Store when
  you're done.
- Anyone who can reach it can use it, so keep it on your own network or VPN,
  like adlerOS.

## Search

<!-- screenshot: ⌘K search -->
![Search](screenshots/search.png)

⌘K, Ctrl+K, or `/` opens a search across your apps, every setting ("timezone",
"back up") and adlerOS's windows; the last result searches the web for what
you typed. Arrow keys pick, Enter opens.

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
| **Remove** | (An imported or found app, once deleted, under *Not installed*) forgets it altogether, without touching its containers or files. |

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
(*Normal*, *Busy*, *High*; for the temperature *Normal*, *Warm*, *Hot*), and charts of the last three minutes: hover one for
the value at any moment. Below, **By app**: every app's share of the CPU or
memory, busiest first, from `docker stats`. Apps with nothing running are at
the bottom; containers that aren't part of any app are a line of text.

## Notifications

<!-- screenshot: the notifications panel -->
![Notifications](screenshots/notifications.png)

The bell, top right, collects what happened while you weren't looking, and new
ones pop up as a message (at the bottom of the screen; on a phone, at the top):

- an app stopped answering (after two checks a minute apart), or came back;
- a backup, update, install or settings change finished, or anything failed;
- the disk is over 90% full (once a day), or the machine is over 80 °C (once
  an hour);
- Cup found more images with updates.

Opening the panel marks them read; click one to go where it's about.

## Settings

<!-- screenshot: Settings -->
![Settings](screenshots/settings.png)

On the left: the machine at a glance (its address, or in a homelab its domain
and Tailscale address, uptime, apps) and its storage, memory, CPU and
temperature. On the right, the settings, filtered by the tabs
or the search box:

- **Account:** your name for the greeting, the password (other browsers are
  logged out when it changes), the wallpaper, **Desktop mode** (on a
  computer), the **Welcome tour**, and where web searches go.
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

<!-- screenshot: Files, a folder of documents, the places down the side -->
![Files](screenshots/files.png)

Your files, in a window: **All apps → Files**, ⌘K "files", or `f`. Down the
side are three places, and the Trash:

| | | |
| --- | --- | --- |
| **Desktop** | `DESKTOP_DIR`; in a homelab, its `mailbox/` | Yours to change. In desktop mode, it's what the desktop shows. |
| **User** | `STORAGE_DIR`: photos, music, documents | Yours to change. |
| **Root** | `FILES_ROOT`; in a homelab, the homelab's own folder | Read-only: look around, copy things out. See below. |

Nothing outside them is reachable, and a link that leads out of its place is
shown greyed out and won't open. Root's `mailbox/` and `storage/` are the
Desktop and User themselves: opening one takes you there.

- **Open** a folder to go in; the path at the top takes you back up. A text
  file opens in the editor, an image, video, song or PDF in a preview,
  anything else downloads.
- **Upload** with the button, or drop files onto the window; big files are
  fine. A file with a name that's taken gets a `(2)`.
- **New folder**, **New text file**, and per file (right-click, `m`, or its
  [keys](keyboard.md#in-files)): Edit as text, Download, Copy, Cut, Rename,
  Delete.
- **Drag** a file (with a mouse) onto a folder in the list, onto a place down
  the side, or onto the Trash; in desktop mode, onto the desktop or a folder
  on it. It moves there (from Root, where you can't change things, it's a
  copy).
- **Copy** or **Cut**, then go to another folder (in any place) and
  **Paste** (the button that appears, or Ctrl+V). Between places it's a real
  copy, so a big one shows its progress under the list and carries on while
  you do other things. Sorting the mailbox is this: cut on the Desktop, paste
  in User.
- **Delete** moves it to the **Trash** (a `.trash` folder at the top of its
  place; Root's go to User's), where **Restore** puts it back where it was.
  **Empty Trash** deletes for good.
- **Hidden files** (`.env`, `.gitignore`…) don't show. In admin mode, **Show
  hidden files** in the toolbar shows them (this browser remembers); with
  admin mode off they're hidden whatever it's set to.

**Root is your homelab's own folder**: compose files, `homelab.env`, your
apps' data. Changing it can stop your apps, so adlerOS doesn't, unless:

1. **admin mode** is on (Settings), and
2. the machine allows it: `ADLEROS_TERMINAL=on`, the same switch as the
   terminal, because it's the same kind of power, and
3. you say yes to a warning, once each time admin mode is on.

Then Root works like the other places (except uploads: upload to the Desktop,
then move it), and the helper on the machine makes each change, since adlerOS
itself only sees Root read-only. Git and the terminal are still the better
way to change a homelab.

<!-- screenshot: the text editor -->
![The editor](screenshots/editor.png)

**The editor** opens text files up to 2 MB: notes, configs, compose files,
code. Ctrl+S (⌘S) saves; Tab indents. If something else changed the file
since you opened it, it asks before saving over it. Leaving with unsaved
changes asks first.

## Terminal

<!-- screenshot: the Terminal window running htop -->
![Terminal](screenshots/terminal.png)

A shell on this machine, as you, in a window: the dock, **Settings → System →
Terminal**, ⌘K "terminal", or `t`. It's there only in admin mode: with admin
mode off it's not in the dock, All apps, search or Settings. It's also off
unless it's switched on *on the machine itself* (`ADLEROS_TERMINAL=on`, see
[standalone](standalone.md#settings-in-env) or [homelab](homelab.md)). It asks
for nothing more: admin mode was your password.

The shell is your account's own (fish, zsh, bash…; `chsh` changes it). It
starts in `ADLEROS_TERMINAL_DIR` if that's set, else the homelab's folder in a
homelab, else your home folder.

It's a real terminal: colours, `htop`, `nano`, `vim`, Tab completion,
scrollback (scroll up), copy (select) and paste. While you're typing in it,
every key goes to the shell, Escape included; **Ctrl+Shift+Q** or ✕ closes it
and ends the session. Opening another window only puts it away: `t` brings
the same session back. A session also ends when the shell exits, after 30
minutes without typing, or when admin mode is switched off. Up to three at
once.

## On a phone

<!-- screenshot: the home screen on a phone held upright -->
![On a phone](screenshots/phone-desktop.png)

<!-- screenshot: the App Library on a phone -->
![The App Library](screenshots/phone-library.png)

Held upright, a phone gets adlerOS laid out like an iPhone's home screen
(a computer, or a phone on its side, keeps the Mac-like one):

- **The home screen:** the date and your greeting at the top, square widgets
  two side by side, then your apps four across, as many rows as fit. Swipe
  between pages; while you do, their dots take the place of the **Search**
  pill over the dock. Pull down anywhere on it to search; search also offers
  the web.
- **The dock** holds four: the apps you pin, then the App Store, Settings,
  All apps and Live Usage, as many as there's room for.
- **Long-press** an app: the screen blurs behind its menu (Keep in Dock,
  Add to a folder, Move to another collection, Rearrange); keep holding and
  drag to move it instead, onto another app to make a folder.
- **The App Library:** swipe left past the last page (or All apps). Each
  collection is a folder of four; tap an app to open it, or the corner of
  small ones to see the whole collection. adlerOS's own (App Store,
  Settings, Live Usage, Files, Terminal) have a folder too. Type to get the
  A to Z list.
- **Windows** come up as cards with a grabber at the top: pull it down, or
  pull down a list that's at its top, to close one. Settings is grouped
  lists, like an iPhone's.
- Messages drop in from the top, and the lock screen shows the time.

*Share → Add to Home Screen* makes it open full-screen, like an app.
