# Keyboard

adlerOS works without a mouse: a keyboard and a TV is enough (or a TV remote
that acts like a keyboard). Press `?` on the desktop for this list on screen.

<!-- screenshot: the ? keyboard list -->
![The keyboard list](screenshots/keyboard-help.png)

## Moving around

**Arrow keys** move to the nearest thing in that direction: from the search
bar down to the widgets, the apps, the page dots and the dock, and back up.
Past the last app in a row, they turn to the next page; past the first, the
one before. In a window (Settings, the App Store, Live Usage, All apps) and in
dialogs they move between its controls the same way, and **Tab** goes round
the open window without ever landing behind it.

<!-- screenshot: an app selected by keyboard -->
![An app selected](screenshots/keyboard-focus.png)

The selected thing has a thick white ring, made to be seen from across a
room.

| Key | Does |
| --- | --- |
| Arrows | Move to the nearest item that way |
| Enter | Open it (an app in a window if it allows; Settings → Open apps can make that a tab) |
| Escape | Close the menu, dialog or window on top; again to go back further |
| Menu key, Shift+F10, or `m` | The menu for what's selected: Open, Keep in Dock, Rearrange… |
| Tab / Shift+Tab | Next / previous control in the open window |

### Back and forward

The mouse's **side buttons** go back (the one nearer your palm) and
forward, in the window under the pointer: My Computer's folders, Settings'
categories, adlermd's notes and folders (each tab its own). They never take
the browser off adlerOS; nor does its own back (Alt+Left, its button), which
goes back in the window in front instead.

### Zoom

**Ctrl and + − 0** (⌘ on a Mac), or Ctrl and the wheel (a trackpad's pinch),
zoom the adlerOS window you're in, not the whole page: adlermd's text
bigger, say, and the rest as it was. Each kind of window (adlermd, Music, My
Computer…) keeps its own zoom on this device; its title bar shows it when
it isn't 100% (a click there, or Ctrl+0, puts it back), and the window's
menu has it too. Over the desktop, or an app's own window, they're the
browser's zoom as usual.

## Shortcuts

These work anywhere except while you're typing in a text box.

| Key | Opens |
| --- | --- |
| `/` (or Alt+Space) | Search: apps, settings, adlerOS's windows, files |
| `a` | All apps |
| `g` | The App Store ("get apps") |
| `,` | Settings |
| `u` | Live Usage |
| `w` | Edit widgets |
| `t` | Terminal (admin mode) |
| `f` | My Computer |
| `[` or Page Up | Previous page of apps |
| `]` or Page Down | Next page |
| `?` | The list of keys |

Pressing the key of the window that's open closes it again.

## Alt keys

Hyprland's, with Alt where it has Super. They work everywhere, the
terminal included (so fish's own Alt+E, Alt+L, Alt+H, Alt+P, Alt+S and
Alt+W go to adlerOS there), but not while an app's page has the keys:
click its title bar first. The window keys and workspaces are for desktop
mode.

| Key | Does |
| --- | --- |
| Alt+Space | Search: apps, files, settings (the launcher) |
| Alt+Enter, Alt+T | Terminal (another one, with one open) |
| Alt+E | My Computer (another one, with one open) |
| Alt+Shift+P | Wallpaper (in Settings) |
| Alt+Escape | The power menu: log out, restart, shut down |
| Alt+M | Log out |
| Alt+W | Close the window in front |
| Alt+Tab, Alt+Shift+Tab | The next / previous window |
| Alt+V | Float it, or tile it again (tiling) |
| Alt+F | Fill the screen, or not |
| Alt+C | Centre it (a floating one) |
| Alt+H / L / K / J | The window to the left / right / above / below |
| Alt+Shift+H / L / K / J | Move it that way: swap with that window (tiled), or that half of the screen (floating; up fills it, down is its own size) |
| Alt+U / P | 30 px narrower / wider (hold to keep going) |
| Alt+I / O | 30 px shorter / taller |
| Alt+1 … Alt+0 | Workspace 1 … 10 |
| Alt+Shift+1 … 0 | Move the window there, and go with it |
| Alt+S / Alt+A | The next / previous workspace |
| Alt+D | The workspace you were on before |
| Alt + drag | Move a window from anywhere on it |

Three of Hyprland's had two jobs there (C: clipboard and centre, J: emoji
and down, P: wallpaper and wider); here they move windows, and the
wallpaper is Alt+Shift+P.

## In adlermd

| Key | Does |
| --- | --- |
| Ctrl+O | Find a note (or make one) |
| Ctrl+E | Edit (Live, or how you last edited), or read |
| Ctrl+S | Save now (it saves as you go anyway) |
| Ctrl+G | The graph |
| Ctrl+Shift+F | Search the vault |
| Ctrl+B, Ctrl+I | Bold, italic |
| Tab, Shift+Tab | A list item in, or out |
| Enter | The next list item (in an empty one: out of the list) |
| ↑, ↓ (Live) | Past a block's first or last line: into the one above or below |
| Backspace, Delete (Live) | At a block's start or end: join it with the one before or after |
| Escape (Live) | Done with the block: it reads again |
| Backspace (a folder) | Up a folder |

## In Music

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Enter | Play the song that's picked (with the rest of the list after it) |
| Up, Down | Pick the song above or below |
| L | A heart (a favorite) on the picked song, else the one playing; again takes it off |
| Ctrl+F | Search |
| Media keys, a phone's lock screen | Play, pause, next, previous (the browser passes them on) |
| Mouse side buttons | Back and forward through where you've been |

## In Gallery

| Key | Does |
| --- | --- |
| ←, → | The photo before or after |
| i | Its info |
| Escape | Close the photo |
| Ctrl+F | Search |
| Arrows, +, − (the map) | Move it, zoom in and out |
| Mouse side buttons | Back and forward (in a photo: the one before and after) |

## In Documents

| Key | Does |
| --- | --- |
| Ctrl+F | Search inside them |
| Escape | Back from a document |
| Mouse side buttons | Back and forward |

## Typing

Text boxes keep their keys: Left and Right move the cursor, letters type.
Up and Down still move you out of a one-line box (so you can leave the search
bar for the widgets below it). In search, Up and Down pick a result and Enter
opens it.

## In My Computer

Arrows move between files and the places down the side; Enter opens one (a
folder goes in). **Delete** deletes the selected file (to the Trash), **F2**
renames it, **Ctrl+C** copies and **Ctrl+X** cuts it, **Ctrl+V** pastes into
the folder you're in, and `m` or the Menu key shows its menu. Escape goes
back: out of the Trash, then out of My Computer. The mouse's side buttons go
back and forward through the folders you've been in. On the desktop in
desktop mode, the same keys work on its icons.

## In desktop mode

| Key | Does |
| --- | --- |
| Ctrl+` | The next window, in the order they opened; after the last, the desktop and dock |
| Ctrl+Shift+` | The window before |
| `m` or the Menu key on a title bar | The window's menu: left half, right half, maximize, minimize, close |
| …then **Move** or **Resize with the arrow keys** | Arrows move (or resize) it 40 px, Shift+arrows 10 px; Enter when it's right |
| Escape | Closes the window you're in, like on the home screen |

Ctrl+` works even while you type (in Notepad, in the terminal). Inside an
app's own window the keys belong to the app; Tab past its last control, or
click outside it, to come back.

## In the terminal

While you're typing in the Terminal, every key goes to the shell, including
Escape, Tab and the arrows, so `vim` and Tab completion work as usual.
**Ctrl+Shift+Q** closes the window (and ends the session). To copy, select
text with the mouse and press Ctrl+C (selecting takes the keyboard away from
the shell, so it copies instead of interrupting); click the screen to type
again. To paste, Ctrl+Shift+V (⌘V on a Mac).

## Rearranging from the keyboard

Select an app, open its menu (`m`) → **Rearrange apps**, then the arrow keys
move the selected app within its page (or a pinned app along the dock).
Enter or Escape when you're done. The new order is saved as you go. To move
an app to another collection, its menu (`m`) → **Move to another
collection…**, then pick one; to a folder, **Add to a folder…**. A folder
opens with Enter; inside, an app's menu has **Remove from folder**, and
Escape closes it.
