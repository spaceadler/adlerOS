# adlerOS on a screen (kiosk)

For a machine with a screen attached (a Pi on a TV): adlerOS full screen
from boot, no desktop and no browser around it. labwc (a small Wayland
compositor) runs Chromium in kiosk mode; Chromium draws with the GPU.

    kiosk/setup on http://<adlerOS address>:8686
    kiosk/setup off

`on` hooks the console's login (tty1) and needs no sudo. For it to come up
by itself at boot, the console has to log you in by itself (on a Pi:
`sudo raspi-config`, System Options, Boot / Auto Login, Console Autologin).

- Mouse and keyboard work as on a computer; adlerOS's keyboard navigation
  works with the arrows.
- Chromium comes back by itself if it closes. If labwc fails three times in
  a row at once, you're left at the console; the log is
  `~/.local/state/adleros-kiosk/kiosk.log`.
- Another console: Ctrl+Alt+F2.
- Extra Chromium flags, one per line: `~/.config/adleros-kiosk/flags`.
- Sign in once with the keyboard; the kiosk keeps its own profile in
  `~/.local/share/adleros-kiosk`.
