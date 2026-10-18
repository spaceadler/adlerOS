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
- A change only counts when it comes from adlerOS's own page: the browser
  says where a request started (`Sec-Fetch-Site`, or `Origin` in older
  ones), and anything another page started is refused. Cookies alone don't
  stop that, since every port of this machine and every name under your
  domain is the same "site" to a browser, so a page in any of your apps
  could otherwise post to adlerOS while you're logged in.

## Who it answers

`ADLEROS_NETWORKS` decides who even gets the lock screen: `tailscale` (your
tailnet's devices), `anyone` (anyone who can reach the machine, your Wi-Fi
included), or addresses and networks. Anyone else gets no answer at all;
through your reverse proxy, it's the visitor the proxy names that counts, so
the proxy isn't a way around it. `install.sh` picks `tailscale` when the
machine is on a tailnet. In a homelab it's `tailscale`, and ufw keeps port
8686 shut on the LAN as well.

## Admin mode

Restart, shut down, deleting apps, and stopping, restarting, updating or
removing core apps (DNS, your reverse proxy, passwords: Pi-hole, Nginx Proxy
Manager, Vaultwarden…) need **admin mode**, which only your password turns
on. A core app stays one wherever you put it on the home screen. The server
checks it on every request, so it isn't just hidden buttons: a stolen login
cookie alone can't reboot the machine or delete an app. Once on, it's on for
every browser, until you switch it off or **8 hours** pass, whichever comes
first.

## The terminal

The Terminal window is a real shell on the machine, as you, and you're in
the `docker` group, so it's as good as root. That's why it has two locks:

1. **It's off unless you switch it on on the machine**: `ADLEROS_TERMINAL=on`
   in `.env` (or `homelab.env`), then `./install.sh`, which installs its host
   (`adleros-terminal.path` and `.service`). adlerOS can't change that file,
   and with it off the host isn't even installed.
2. **Admin mode**, which only your password turns on, checked by the server
   on every keystroke it passes on. With it off the terminal isn't even
   shown, and switching it off closes every open shell. Opening one asks for
   nothing more, so admin mode left on is a shell for anyone at that login:
   switch it off when you're done. If you don't, it goes off by itself after
   8 hours; then your shells keep running, out of reach, until you turn it
   on again and Terminal takes you back to them.

The shells run in `agent/terminal.py` on the host, started by systemd when a
session is asked for and stopped when the last one ends. What you type and
what the shell prints pass through files in `data/agent/term/<session>/`,
readable only by you. Sessions end after 30 minutes without typing, at 20 MB
of output, or when closed; three at most.

The honest limit: with the terminal on, someone who took over the web app
itself (not just a login) could ask the host for a shell, since the host
trusts adlerOS's requests. Leave it off unless you use it.

## Files

The Files window has three places, each mounted into adlerOS's container on
its own, and nothing else of yours is:

- **Desktop** (`DESKTOP_DIR`, a homelab's `mailbox/`) and **User**
  (`STORAGE_DIR`), read-write.
- **Root** (`FILES_ROOT`, or the whole homelab), **read-only**. adlerOS can
  read everything in it (compose files, `.env` files, `homelab.env`), so
  anyone logged in can too: choose `FILES_ROOT` with that in mind, or leave
  it empty. A homelab's Root includes its secrets; that's the trade for
  being able to look at your own homelab from adlerOS.

Changing Root doesn't happen in the container at all. adlerOS writes what it
wants done into `data/agent/files/<request>.json` and queues the `files-root`
action; the helper runs `agent/files.py`, which refuses unless
`ADLEROS_TERMINAL=on` on the machine (adlerOS can't change that), checks
every path again on the host, and makes the change as you. The server asks
for admin mode first, and the page warns you once per admin session. With
the terminal off, Root stays read-only whatever happens to adlerOS.

Every path is checked to stay inside its place, links leading out of one are
refused, uploads are written next to the target and renamed into place, and
files are only ever *shown* in the browser when they can't run code (images,
video, audio, PDFs, plain text); anything else, HTML and SVG included,
downloads. Deleting moves things to a `.trash` folder rather than erasing
them.

## Apps in windows

In desktop mode an app opens inside adlerOS's page (an iframe), so it's still
the app's own page, on its own address, with its own login: adlerOS can't see
into it, and it can't see into adlerOS (they're different origins). adlerOS
only asks the app's server for its headers first, to honour an app that
forbids being framed (`X-Frame-Options`, CSP `frame-ancestors`); those open in
a tab instead. adlerOS's own page may frame any web page (`frame-src http:
https:`), since an app's page can redirect to its login or to HTTPS; it still
runs only its own scripts.

**Notes** (adlerMD, Notepad) are yours, but may come from anywhere (a vault
someone shared). Their HTML is rebuilt from an allowlist, never inserted as
is: formatting tags and their plain attributes, with no scripts, forms,
event handlers, ids or classes, and style only for how text looks (no
`position`, `url()` or `!important`). Links go where Markdown links go. A
picture may come from the internet (`img-src https:`), which tells that
site you opened the note (no referrer is sent). An `<iframe>` must be
another site over HTTPS, and is sandboxed.

**Firefox** from the store is a whole browser on the machine: whoever reaches
its port can browse as the machine, and its web interface can give a root
shell inside its own container. It has no login unless you add one
(`CUSTOM_USER` and `PASSWORD`). Keep it on your own network or VPN.

## What adlerOS reads and touches

- **Discovery** (standalone) reads every compose file in `COMPOSE_ROOTS`
  through `docker compose config`, which interpolates its `.env`. adlerOS
  keeps only service names, images, published ports and `depends_on`; never
  environment values or secrets.
- **Import** from the browser only takes compose files under your home
  folder, and never one in a folder the web app can write to: its own
  `data/`, and Files' Desktop and User. The same goes for looking for apps,
  and the helper won't start one from there either (it will still stop or
  remove it): otherwise whoever had adlerOS could upload a compose file of
  their own and run it. Import shows you the compose file's text (not its
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
- read, change or delete files in your Desktop and storage folders, and read
  Root (through Files);
- with the terminal switched on and admin mode: change Root too.

They couldn't run their own commands, read your files beyond what's above, or
reach Docker directly. Your user is in the `docker` group, which is as good as
root, so the helper's checks are the real fence: keep `agent/actions.json`
short, and review what you add to it.

## On the network

adlerOS speaks plain HTTP on port 8686 and is meant for your own network or a
VPN such as Tailscale. **Don't forward it to the internet.** For HTTPS, put it
behind a reverse proxy you already trust (the homelab's nginx does, when it
has a certificate; see [standalone](standalone.md#https-behind-a-reverse-proxy)
for any other), at a name that points at your private address. It believes a
proxy's `X-Real-IP` and `X-Forwarded-Proto` only from this machine and
`ADLEROS_TRUSTED_PROXIES`, so nobody else can dodge the login lockout by
claiming to be someone else.
