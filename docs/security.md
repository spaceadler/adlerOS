# How adlerOS stays safe

adlerOS can start, stop, install and delete the apps on your machine, so it
deserves a clear picture of what it can and can't do, and what someone could
do with it.

## The pieces

1. **The web app** (`app/`, the `adleros` or `homelab-os` container) is what
   your browser talks to. It runs as your user, in a **read-only** container
   with **no capabilities** and `no-new-privileges`, and has **no access to
   Docker** or to the rest of the machine. It can read: its own folder, the
   app registry and catalog (read-only), the actions list (read-only), and,
   in a homelab, `homelab.env` and the backup folder (read-only). It can write
   only its own `data/`.
2. **The helper** (`agent/agent.py`) runs on the host, as your user (not
   root), only when systemd sees a request in `data/agent/queue/`. It runs an
   action **only** if it's in the actions list, with every parameter matching
   its pattern, and runs commands **without a shell**, so a value can't sneak
   in a second command. Requests must be small, plain files owned by you, and
   are never followed through a symlink.
3. **Root** is used for exactly two things: restart and shut down, through
   `sudo` to a root-owned copy of `agent/power`, allowed by one rule in
   `/etc/sudoers.d/` for exactly those two arguments. (A homelab adds its
   backup script the same way.)

## Logging in

- One password (`OS_PASSWORD`, or what you set in Settings, stored as a
  scrypt hash). A login is a signed cookie (HMAC) valid for 30 days,
  `HttpOnly`, `SameSite=Strict`, and `Secure` over HTTPS.
- Wrong passwords are slowed down (a second each), and too many lock that
  address out for a while.
- Changing the password logs out every other browser.
- Every change is a JSON request, which a page on another site can't send with
  your cookie.

## Admin mode

Restart, shut down, deleting apps, and stopping core apps (DNS, proxies,
passwords) need **admin mode**, which only your password turns on. The server
checks it on every request, so it isn't just hidden buttons: a stolen login
cookie alone can't reboot the machine or delete an app. Once on, it stays on
for every browser until you switch it off, so switch it off when you're done.

## The terminal

The Terminal window is a real shell on the machine, as you, and you're in
the `docker` group, so it's as good as root. That's why it has three locks:

1. **It's off unless you switch it on on the machine**: `ADLEROS_TERMINAL=on`
   in `.env` (or `homelab.env`), then `./install.sh`, which installs its host
   (`adleros-terminal.path` and `.service`). adlerOS can't change that file,
   and with it off the host isn't even installed.
2. **Admin mode**, checked by the server on every keystroke it passes on;
   switching admin mode off closes every open shell.
3. **Your password**, typed again for each session (the same lockout as
   logging in).

The shells run in `agent/terminal.py` on the host, started by systemd when a
session is asked for and stopped when the last one ends. What you type and
what the shell prints pass through files in `data/agent/term/<session>/`,
readable only by you. Sessions end after 30 minutes without typing, at 20 MB
of output, or when closed; three at most.

The honest limit: with the terminal on, someone who took over the web app
itself (not just a login) could ask the host for a shell without your
password, since the host trusts adlerOS's requests. Leave it off unless you
use it.

## Files

The Files window needs adlerOS to read and write your storage folder, so that
one folder is mounted read-write into its container (`STORAGE_DIR` at
`/storage`). Nothing else of yours is. Every path is checked to stay inside
it, links leading out of it are refused, uploads are written next to the
target and renamed into place, and files are only ever *shown* in the browser
when they can't run code (images, video, audio, PDFs, plain text); anything
else, HTML and SVG included, downloads. Deleting moves things to `.trash`
rather than erasing them.

## What adlerOS reads and touches

- **Discovery** (standalone) reads every compose file in `COMPOSE_ROOTS`
  through `docker compose config`, which interpolates its `.env`. adlerOS
  keeps only service names, images, published ports and `depends_on`; never
  environment values or secrets.
- **Import** from the browser only takes compose files under your home
  folder, and never one in adlerOS's own `data/` folder, where the web app
  could have written it. It shows you the compose file's text (not its
  `.env`).
- **Logs** show what an app's containers printed, which can include things
  apps log (addresses, usernames).
- **Store apps** get new random passwords in their own `.env` (only you can
  read it).

## What a compromised adlerOS could do

If someone took over the web app (a bug, or your password), they could still
only queue actions from the list. That means they could:

- stop, start, restart, update or delete your apps (data stays; delete only
  removes containers);
- install a store app, or start a compose file already in your home folder;
- with admin mode on (or your password): restart or shut down the machine;
- with the terminal switched on (on the machine): get a shell (see above);
- read, change or delete files in your storage folder (through Files).

They couldn't run their own commands, read your files beyond what's above, or
reach Docker directly. Your user is in the `docker` group, which is as good as
root, so the helper's checks are the real fence: keep `agent/actions.json`
short, and review what you add to it.

## On the network

adlerOS speaks plain HTTP on port 8686 and is meant for your own network or a
VPN such as Tailscale. **Don't forward it to the internet.** For HTTPS, put it
behind a reverse proxy you already trust (the homelab's nginx does, when it
has a certificate).
