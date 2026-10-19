# Using adlerOS

A tour of everything on the screen, and the two built-in apps, My Computer and the
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
short look around: your apps, the dock, search, the bell, and where My Computer and
desktop mode are. **Skip the tour** (or Escape) ends it; it doesn't come back
by itself, but **Settings → Welcome tour** (or Alt+Space "welcome") shows it again.

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
- **Opening an app** puts it in a window over the home screen, like the
  terminal's, with Reload, *Open in a new tab* and close at its top. An app
  that won't be shown inside another page opens in the App Store's Firefox
  instead, in its window here (started for it, if it's stopped); without
  Firefox, in a tab. If you'd rather
  have tabs (on this device): **Settings → Open apps → In a new tab**. Keep
  windows on a computer showing adlerOS full screen (a Raspberry Pi on a
  TV): there, a tab would open somewhere you can't see.
- **Over a window the dock steps aside**, so it doesn't cover the window's
  last lines (the terminal's prompt); bring the pointer to the bottom edge
  of the screen and it comes back, until you leave it.
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

Like a Mac's. Pin any app: right-click it (long-press on a phone) → **Keep
in Dock**, on the page, on the desktop or in All apps, or drag it from All
apps onto the dock, where you drop it. Drag pinned apps to reorder them;
right-click → **Remove from Dock** to unpin. adlerOS's own are apps like any
other, pinned from the start (Remove from Dock takes one out; Keep in Dock
in All apps, or a drag from there, brings it back), and in All apps:

| | |
| --- | --- |
| **App Store** | Your apps and their containers; apps to install. |
| **Settings** | Your name, password, wallpaper, admin mode, the machine. |
| **Live Usage** | CPU, memory, storage and temperature, and every app's share. |
| **My Computer** | Your files ([below](#my-computer)). |
| **Terminal** | A shell on the machine, in admin mode ([below](#terminal)). |

After your pins come the windows that are open but not pinned, then a
divider and **All apps**, which always stays: every app, A to Z, with a
search box (type to narrow it down; Enter opens the first match). Click a
pinned one whose window is open to put it away again. Put your own icon for
any of adlerOS's in `icons/` ([customizing](customizing.md#dock-icons)).

<!-- screenshot: the All apps drawer -->
![All apps](screenshots/all-apps.png)

## Desktop mode

<!-- screenshot: desktop mode, My Computer and an app side by side, icons on the desktop -->
![Desktop mode](screenshots/desktop-mode.png)

For a computer with a mouse: windows side by side, like any desktop. Switch it
on in **Settings → Desktop mode**, Alt+Space "desktop mode", or right-click the
desktop. It's kept in that browser only, so the TV can stay on the home screen
while the laptop uses desktop mode. It's for computers: a phone never has it
(held upright, it gets the iPhone-style layout instead), and a browser window
made phone-narrow leaves it until it's wide again.

- **The desktop** shows your Desktop folder (a homelab's `mailbox/`) as icons.
  Double-click one (Enter, or a tap) to open it; right-click for Copy, Cut,
  Rename, Delete; right-click the desktop itself for New folder, New text
  file, Paste, Upload. Drag an icon to put it somewhere else on the desktop
  (each computer remembers where; one already there swaps places), onto a
  folder's icon to move it into that folder, or onto the My Computer window to move
  it to the folder that shows. Drop files from your computer on it to put
  them there.
- **Your folder**, named after you (Settings → Name), is always on the
  desktop: double-click it for User (your storage) in My Computer. It moves
  about like any icon but doesn't go.
- **Apps on the desktop:** right-click any app (in All apps, on the page, in
  the dock; adlerOS's own too) → **Add to desktop**. It's an icon there like
  the files: double-click to open it, drag it about, right-click →
  **Remove from desktop**.
- **Widgets on the desktop:** right-click the desktop → **Add widget…** and
  pick one (the same ones as the home screen's). It's three icons wide and a
  row and a half tall; drag it where you want it (icons make room), right-click it →
  **Remove widget**. One is only for the desktop: **Search the web**, the
  home screen's search bar, eight icons wide (drag it by its edge; inside
  it, you type). Each computer
  keeps its own desktop: where things are, which apps and widgets. Files that arrive
  some other way (Syncthing) show up within 15 seconds.
- **Windows:** Settings, the App Store, Live Usage, My Computer and the Terminal
  open as windows you can have side by side. Drag one by its title bar; drag
  any edge to resize it; drag it to the left or right edge of the screen for
  that half, or to the top to fill the screen (or double-click its bar). The
  buttons on its bar minimize it to the dock, maximize it, and close it.
  Windows remember where you put them. They're glass over the desktop: the
  wallpaper behind them shows through, blurred, but never another window, so
  My Computer over the Terminal is just My Computer. How much shows is **Settings →
  Window transparency**, from 0.00 (solid) to 1.00, the same on the home
  screen; your apps' own pages stay solid. The
  Search pill sits at the top, level with the bell.
- **Your apps** open in windows of their own, if they allow it: adlerOS asks
  each app whether it may be shown inside another page, and opens the ones
  that say no in the App Store's Firefox, in its window (or, without it, in
  a tab). Ctrl+click opens any app in a tab. An app's window
  has Reload and *Open in a new tab* on its bar. The App Store's **Open**
  does the same as the app's icon.
- **The dock** shows what's open: a mark under pinned apps and adlerOS's own
  items with a window, and, after your pinned apps (like a Mac's), the windows
  that have no place in the dock otherwise (apps you haven't pinned, My Computer or
  the Terminal when they aren't). Click one to bring it forward, again to minimize it; right-click
  one whose window is open for **Close**.
- **Tiling:** **Settings → Window layout → Tiling** (each computer its own)
  and windows share the screen, like Hyprland's: a new one takes half of the
  one in front, along its longer side, and closing one gives its space back.
  Drag a window by its bar onto another to swap them; Alt+V floats one (and
  back), Alt+U/P/I/O move the line it shares with its neighbour. Floating is
  the default.
- **Workspaces:** ten, Alt+1 to Alt+0; Alt+Shift and a number takes the
  window in front there. The windows slide over as you go, and a dot row
  says where you are. The desktop and its icons are the same on all of them.
- **Moving** is on the curves of a Hyprland config: windows glide to where
  they go, pop in and fade. Every Alt key is in [keyboard](keyboard.md#alt-keys).
- **More than one My Computer or Terminal:** right-click it (in the dock,
  All apps, on the desktop, or its title bar) → **New window**, or Alt+E /
  Alt+Enter with one open. Each terminal has a shell of its own (three at
  most); each My Computer its own folder, and a file dragged from one onto
  another moves into that one's folder.
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
  (a Raspberry Pi 4 manages, slowly for video). So **closing its window
  quits the browser** (its tabs go, the memory comes back); its container
  stays up, and opening Firefox or anything that goes through it starts the
  browser again, with just that page.
- Apps that won't be shown in a window of adlerOS's, and web searches, open
  in it: in the tab you're on, not a new one (adlerOS sets that in its
  profile's `user.js`).
- The certificate it makes itself isn't one a browser trusts inside a frame
  (you'd get a blank window), so give it a name of its own behind your
  reverse proxy (below) and **Look for new apps**.
- Anyone who can reach it can use it, so keep it on your own network or VPN,
  like adlerOS.

## Search

<!-- screenshot: Alt+Space search -->
![Search](screenshots/search.png)

**Alt+Space** (or `/`, or the Search pill) opens a search across your apps
(all of them, the list scrolls), every setting ("timezone", "back up"),
adlerOS's windows, and every file and folder in your places by name: type
*never snitch* and the song in `Media/Music` is there, and opens in Music
(a folder in My Computer, a picture in the Viewer). Hidden files are left
out, and the list of files is made again every half hour and soon after
you change something in My Computer, so a file that just arrived some other
way (Syncthing) may take a while. The last result searches the web: in the
App Store's Firefox, in a window here, when you have it (a new tab of it);
otherwise a tab of your browser. The search bar and the desktop's search
widget do the same. Arrow keys pick, Enter opens.

## The App Store

<!-- screenshot: the App Store -->
![The App Store](screenshots/app-store.png)

Every app on your desktop, by collection, with what its containers are doing:
*Running*, *Partly running (1 of 2)*, *Stopped*, *Restarting*, *Running,
unhealthy*, or *No containers*. Click the line under a card to see each
container. Agents with no page of their own (Beszel's agent) are only here,
under **In the background**: never on the home screen or in All apps. The
buttons:

| | |
| --- | --- |
| **Open** | Its web page, like its icon: in a window, or a tab if it won't be shown in one (Ctrl+click: a tab). |
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
stopping, restarting or updating core apps (DNS, your reverse proxy, the
password manager), since your network and logins depend on them. Without
it, their cards only offer Start and Logs.

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

Only while it's on can you restart or shut down the machine, delete apps,
stop, restart or update core apps, or use the Terminal. adlerOS's server
checks it on every request, not just the buttons on the page. It's on for
every browser until you switch it off, or for 8 hours: then it switches
itself off, and a terminal you had keeps running for when it's back on.

## My Computer

<!-- screenshot: My Computer, a folder of documents, the places down the side -->
![My Computer](screenshots/files.png)

Your files, in a window: the dock, **All apps → My Computer**, Alt+Space "files",
or `f`. It starts in Root in admin mode, in User otherwise. Down the
side are three places, and the Trash:

| | | |
| --- | --- | --- |
| **Desktop** | `DESKTOP_DIR`; in a homelab, its `mailbox/` | Yours to change. In desktop mode, it's what the desktop shows. |
| **User** | `STORAGE_DIR`: photos, music, documents | Yours to change. |
| **Root** | `FILES_ROOT`; in a homelab, the homelab's own folder | Read-only: look around, copy things out. See below. |

Nothing outside them is reachable, and a link that leads out of its place is
shown greyed out and won't open. Root's `mailbox/` and `storage/` are the
Desktop and User themselves: opening one takes you there.

- **Double-click** a folder to go in (a click picks it; on a touch screen a
  tap opens it; Enter too); the path at the top takes you back up, and the
  mouse's side buttons back and forward through where you've been. A text
  file opens in Notepad (a Markdown one in adlermd's quick look); anything else that opens gets a window of its
  own, so the rest of adlerOS stays usable while it's open:
  - a **picture, video or PDF**: the **Viewer** (in desktop mode, drag and
    resize it like any window; over the home screen it floats over My Computer),
    a PDF in your browser's own PDF viewer;
  - a **song**: **Music** plays it, and an `.m3u8` (`.m3u`) playlist: its
    songs, in Music's queue;

  Anything else downloads.
- **Upload** with the button, or drop files onto the window; big files are
  fine. A file with a name that's taken gets a `(2)`.
- **Sort** by name, type or size, ascending (the default) or descending:
  the two buttons at the top. Folders come first either way. Each device
  keeps its choice.
- **New folder**, **New text file**, and per file (right-click, `m`, or its
  [keys](keyboard.md#in-my-computer)): Edit as text, Download, Copy, Cut, Rename,
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

## Notepad

Text files, one a window, like Windows': **All apps → Notepad**, or open a
text file in My Computer (its menu's **Open in Notepad** for any file).
**File**: New, Open…, Save (Ctrl+S), Save as… (Ctrl+Shift+S), Close;
**View**: word wrap. Open… and Save as… pick from your places. A file only
readable here (Root without admin mode) opens read-only: Save as… puts a
copy somewhere you can change. Closing one with changes asks first.

A **Markdown** file (`.md`) opened from My Computer or the desktop opens
the same way, as adlermd's quick look: as it reads, edited where you click
(View → Live, as in adlermd), its text (Source), how it reads (Read, or
Ctrl+E), or both side by side; for a quick note you'll throw away. Its
**File → Load vault** opens adlermd with your vault instead (the file's own,
if it's in one); with changes it asks whether to save them first.

## adlermd

Your notes, in **vaults**, Obsidian's way: a vault is a folder of Markdown
notes and their attachments, and an Obsidian vault works here as it is (and
back: adlermd reads `.obsidian`'s settings and never writes them, so the
Obsidian on your laptop, through Syncthing, keeps its own). Open it from
All apps, the dock or the desktop; it opens your vault: the first is
`NOTES_DIR` in your storage (in a homelab, `Notes`), and the vault name at
the top left switches, **creates a vault**, or **opens a folder as a
vault**.

- **Files** down the side (right-click: new note or folder, rename, move,
  delete to the Trash; drag one onto a folder to move it), **search**
  (words, or `tag:#name`, `path:folder`) and **tags**.
- **Notes in tabs**: a click opens one in the tab you're on, Ctrl+click (or
  the middle button) in a new one. Over a note is the path to it, the vault
  first: click a folder in it to see what's in that folder (its folders,
  notes and files, to open, drag or right-click), and **↑** (or Backspace)
  goes up a folder; from a PDF or a picture, it goes back to the note it's
  from (the one you opened it from, else the one that links to it). The
  mouse's side buttons go back and forward through where the tab has been. It saves as you go. If Obsidian (or
  anything) changed the note meanwhile, you choose: keep yours, theirs, or
  both.
- **Live** (Obsidian's Live Preview): the note as it reads, and you edit it
  where you click. The paragraph, heading, list or table you're in shows
  its Markdown until you leave it; a link, a task's box or a video still
  works as itself. The arrows go on into the block above or below,
  Backspace at a block's start (Delete at its end) joins it with the next
  one, Escape is done. Or **Source** (all of it as Markdown), **Read**, or
  **Both** side by side. Ctrl+E switches between reading and editing; a
  double-click in reading edits there.
- **What it reads**: headings, emphasis, ==highlights==, lists and tasks
  (tick them while reading), quotes and callouts (`> [!note]`, folding with
  `+`/`-`), code, tables, footnotes, `%%comments%%`, properties (the
  frontmatter), `#tags`, links both ways (`[text](path.md)` and
  `[[name]]`), and embeds: pictures, other notes (or a section), PDFs,
  video, songs and Bases. Pictures from the internet show (over https). A
  note's own HTML formats it too: `<u>`, `<span style="color: …">`, `<br>`,
  `<details>`, tables, `<div align="center">`, pictures and videos (the
  vault's, or a picture from the internet) and a video site's `<iframe>`.
  What could run or reach into adlerOS (scripts, forms, event handlers,
  styles that move things over the page) is left out.
- **Writing links**: `[[` offers the notes whose names match, and writes the
  link the way the vault says (`useMarkdownLinks`, `newLinkFormat`). A link
  to a note that isn't there yet makes it when you click it. A picture
  pasted or dropped in goes to the vault's attachment folder.
- **Renaming or moving** a note or folder updates the links to it (and its
  own), as Obsidian's *Automatically update internal links* does; with that
  off, it asks.
- **On the right**: backlinks, outgoing links, the outline and the tags of
  the note you're on.
- **The graph** (Ctrl+G, or a note's menu for just its part of it), laid
  out as `graph.json` says, with its colour groups. **Bases** (`.base`
  files, or a `base` code block) show their table and card views.
- **Ctrl+O** finds (or makes) a note by name; the calendar button opens
  today's **daily note** (`daily-notes.json`'s folder, format and
  template); a note's menu **inserts a template** (`templates.json`).

## Music

Your songs: `MUSIC_DIR` in your storage (`Media/Music` if it isn't set).
Open it from All apps, the dock, or Alt+Space "music". The first time, it
reads every song's tags (a few thousand take half a minute or so); after
that only what changed, so it opens straight away.

- **Home**: what you've played lately, stations for you, what you added
  lately, your playlists. **Songs** (sort by title, artist, album, recently
  added, most played or length), **Albums**, **Artists** (their songs, their
  albums, and the albums they're on), **Playlists**, and **Search** across
  them all.
- A click picks a song; a double-click (or Enter, or a tap) plays it, with
  the rest of that list after it. Right-click for **Play next**, **Add to
  queue**, **Start radio**, **Add to playlist**, its album and artists, and
  where it is in My Computer.
- **Playlists** are the `.m3u8` (`.m3u`) files in your music folder, so
  spotdl's and other players' work here, and what you make here works
  there. Make one (New playlist), add songs (right-click, or drag a song
  onto a playlist in the side), drag them into a new order, rename it, or
  delete it (its file goes to the Trash; the songs stay).
- **Radio**: stations made from your own library, nothing from the
  internet. A station from a song, an artist, an album, a playlist or a
  genre plays songs like it: the ones your playlists put together with it
  (Spotify's mixes, from spotdl, say a lot), the same artists, genres and
  years. They don't run out. **Your station** follows what you play most.
- **The player** along the bottom: shuffle, previous, play, next, repeat
  (all, then this song), where you are in the song, volume. **Up next**
  shows the queue: what you added (Play next goes first, Add to queue after
  what you added), then the rest; drag to reorder, or remove. **Lyrics**
  follow the song as it plays (an `.lrc` beside it, as spotdl makes them, or
  the song's own); a click on a line goes there.
- Your keyboard's media keys work, and so does a phone's lock screen
  (previous and next song, play, and dragging along the song; next only when
  there's a song after this one). An iPhone shows either song buttons or
  ±10 seconds, never both; Music asks for the song buttons. The mouse's side buttons go back and forward
  through where you've been. Plays are counted (after half a
  minute), for Home, Your station and Most played. With `NAVIDROME_USER`
  and `NAVIDROME_PASSWORD` in the settings file, they go to Navidrome too
  (now playing, then played), when it plays the same music folder.
- Put away (another window over it, minimized), it keeps playing; closing it
  stops it. The queue and where you were in the song are kept on this
  device, for next time.

## Gallery

Your photos and videos as Immich has them: open it from All apps, the dock,
or Alt+Space "gallery". It needs a key from Immich (Immich → Account
Settings → API Keys → New API Key) that may read: `asset.read`,
`asset.view`, `asset.download`, `album.read`, `person.read` and
`memory.read`. Put it in the settings file as `IMMICH_API_KEY`; until then,
Gallery says the same.

- **Photos**: the whole timeline, newest first, by month and then day, in
  rows that fill the width; **On this day** above it. Months are fetched as
  you come to them and let go when you're far past, so even tens of
  thousands scroll lightly.
- **Albums**, **People** (the ones you've named first; the rest a click
  away), **Favorites**, and **Search**: Immich's own, by what's in the
  photo ("beach at sunset", "a red car").
- A photo opens big (a video plays). The arrows, or a swipe, go through the
  rest, past a month's end too; **i** shows what Immich knows (when, the
  file, the camera and its settings, where, who's in it, its albums), and
  the download button gets the original. Escape, or a swipe down, closes it.
- The mouse's side buttons go back and forward (in a photo: the one before
  and after). **Open Immich** in the side opens Immich itself, for
  anything Gallery doesn't do (uploading, sharing, editing).

## Terminal

<!-- screenshot: the Terminal window running htop -->
![Terminal](screenshots/terminal.png)

A shell on this machine, as you, in a window: the dock, **Settings → System →
Terminal**, Alt+Space "terminal", or `t`. It's there only in admin mode: with admin
mode off it's not in the dock, All apps, search or Settings. It's also off
unless it's switched on *on the machine itself* (`ADLEROS_TERMINAL=on`, see
[standalone](standalone.md#settings-in-env) or [homelab](homelab.md)). It asks
for nothing more: admin mode was your password.

The shell is your account's own (fish, zsh, bash…; `chsh` changes it). It
starts in `ADLEROS_TERMINAL_DIR` if that's set, else the homelab's folder in a
homelab, else your home folder.

It's a real terminal: colours, `htop`, `nano`, `vim`, Tab completion,
scrollback (scroll up), copy (select) and paste. A program that takes the
mouse (Claude Code, htop, vim with the mouse on) gets the wheel and
scrolls itself; `less` and `man` get it as arrow keys; Shift+wheel always
scrolls the scrollback. While you're typing in it,
every key goes to the shell, Escape included; **Ctrl+Shift+Q** or ✕ closes it
and ends the session. Opening another window only puts it away: `t` brings
the same session back, and so does opening the terminal after a reload (or
in another tab): it joins the shell that's still running, its screen as it
was. Shells no page is showing are closed when a fourth is wanted. A session also ends when the shell exits, after 30
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
  Settings, Live Usage, My Computer, Terminal) have a folder too. Type to get the
  A to Z list.
- **Windows** come up as cards with a grabber at the top: pull it down, or
  pull down a list that's at its top, to close one. Settings is grouped
  lists, like an iPhone's.
- Messages drop in from the top, and the lock screen shows the time.

*Share → Add to Home Screen* makes it open full-screen, like an app.
