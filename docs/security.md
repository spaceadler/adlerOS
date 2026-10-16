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
- with admin mode on (or your password): restart or shut down the machine.

They couldn't run their own commands, read your files beyond what's above, or
reach Docker directly. Your user is in the `docker` group, which is as good as
root, so the helper's checks are the real fence: keep `agent/actions.json`
short, and review what you add to it.

## On the network

adlerOS speaks plain HTTP on port 8686 and is meant for your own network or a
VPN such as Tailscale. **Don't forward it to the internet.** For HTTPS, put it
behind a reverse proxy you already trust (the homelab's nginx does, when it
has a certificate).
