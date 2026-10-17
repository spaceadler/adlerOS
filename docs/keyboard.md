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
| Enter | Open it (an app opens in a new tab) |
| Escape | Close the menu, dialog or window on top; again to go back further |
| Menu key, Shift+F10, or `m` | The menu for what's selected: Open, Keep in Dock, Rearrange… |
| Tab / Shift+Tab | Next / previous control in the open window |

## Shortcuts

These work anywhere except while you're typing in a text box.

| Key | Opens |
| --- | --- |
| `/` (or ⌘K, Ctrl+K) | Search: apps, settings, adlerOS's windows |
| `a` | All apps |
| `g` | The App Store ("get apps") |
| `,` | Settings |
| `u` | Live Usage |
| `w` | Edit widgets |
| `t` | Terminal (admin mode) |
| `f` | Files |
| `[` or Page Up | Previous page of apps |
| `]` or Page Down | Next page |
| `?` | The list of keys |

Pressing the key of the window that's open closes it again.

## Typing

Text boxes keep their keys: Left and Right move the cursor, letters type.
Up and Down still move you out of a one-line box (so you can leave the search
bar for the widgets below it). In search, Up and Down pick a result and Enter
opens it.

## In Files

Arrows move between files; Enter opens one (a folder goes in). **Delete**
deletes the selected file (to the Trash), **F2** renames it, `m` or the Menu
key shows its menu. Escape goes back: out of the editor, out of the Trash,
then out of Files. In the editor, Ctrl+S saves and Tab indents.

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
Enter or Escape when you're done. The new order is saved as you go.
