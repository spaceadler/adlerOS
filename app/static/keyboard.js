// Keyboard control, for a keyboard (or a TV remote that acts like one) and
// no mouse. Arrow keys move focus to the nearest item in that direction
// within whatever is on top (a dialog, a menu, a window, or the desktop and
// dock); past the edge of a page of apps they turn the page. Enter opens,
// Escape closes, the Menu key or Shift+F10 opens an item's menu, and a few
// single keys open things (press ? for the list). Typing in a text field is
// never taken over: only Up and Down leave a one-line field.
// Uses $, state, isOpen, drawerOpen, goToPage, openMenu, menuFor, openModal,
// and the open* functions from the other scripts.
"use strict";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const kb = { last: null }; // the last thing focused on the desktop or dock

const SHORTCUTS = [
  { keys: ["/"], label: "Search apps and settings", run: () => openSearch() },
  { keys: ["a"], label: "All apps", run: () => toggleDrawer() },
  { keys: ["g"], label: "App Store", run: () => toggleStore() },
  { keys: [","], label: "Settings", run: () => toggleWindow("settings", () => openSettings()) },
  { keys: ["u"], label: "Live Usage", run: () => toggleUsage() },
  { keys: ["w"], label: "Edit widgets", run: () => editWidgets() },
  { keys: ["t"], label: "Terminal", run: () => toggleTerminal() },
  { keys: ["f"], label: "Files", run: () => toggleFiles() },
  { keys: ["[", "PageUp"], label: "Previous page", run: () => turnPage(-1) },
  { keys: ["]", "PageDown"], label: "Next page", run: () => turnPage(1) },
  { keys: ["?"], label: "This list", run: () => keyboardHelp() },
];
const HELP_ONLY = [
  ["Arrow keys", "Move between apps, widgets, the dock and buttons"],
  ["Enter", "Open"],
  ["Escape", "Close, or go back"],
  ["Menu key, Shift+F10 or m", "The menu for what's selected (Keep in Dock, Rearrange…)"],
  ["Tab", "Next control in the open window"],
  ["Rearrange mode: arrows", "Move the selected app; Enter or Escape when done"],
  ["Desktop mode: Ctrl+`", "The next window (Shift: the one before), then the desktop"],
  ["Desktop mode: m on a title bar", "The window's menu: halves, maximize, move or resize with the arrows"],
];

// ------------------------------------------------------------- layers

// What's on top: only things inside it can take focus.
function topLayer() {
  for (const id of ["modal", "confirm", "menu", "search", "notes", "welcome", "folder"]) if (!$(id).hidden) return $(id);
  if (drawerOpen()) return $("drawer");
  // Desktop mode: the window in front, if one is; else the desktop and dock.
  if (desktopMode()) return wm.active && isActive(wm.active) ? $(wm.active) : (!$("lock").hidden ? $("lock") : null);
  for (const id of wm.windows.keys()) if (isOpen(id)) return $(id);
  if (!$("lock").hidden) return $("lock");
  return null; // the desktop and the dock
}

function visible(node) {
  if (node.closest("[hidden]") || !node.getClientRects().length) return false;
  const r = node.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  // On the desktop, only the page you're looking at.
  const page = node.closest(".page");
  return !page || page === $("pages").children[state.page];
}

function focusables(layer = topLayer()) {
  const roots = layer ? [layer] : [$("desktop"), $("dock")];
  return roots.flatMap((root) => [...root.querySelectorAll(FOCUSABLE)]).filter(visible);
}

function focusItem(node) {
  if (!node) return;
  node.focus({ preventScroll: true });
  // Apps on the desktop are already in view (goToPage scrolls the pages);
  // in a window, bring the item into view.
  if (!node.closest("#pages")) node.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// Somewhere sensible to start: back where you were, else the first app.
function focusStart(layer) {
  const items = focusables(layer);
  if (!layer && kb.last?.isConnected && items.includes(kb.last)) return focusItem(kb.last);
  const firstApp = !layer && items.find((n) => n.matches("#pages .app, .desk-icon"));
  focusItem(firstApp || items[0]);
}

// ------------------------------------------------------------- moving

const DIRS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function center(r) { return [r.left + r.width / 2, r.top + r.height / 2]; }

// The nearest item whose centre lies that way, favouring ones in line.
function nearest(from, items, [dx, dy]) {
  const a = from.getBoundingClientRect();
  const [ax, ay] = center(a);
  let best = null;
  let bestScore = Infinity;
  for (const node of items) {
    if (node === from || node.contains(from) || from.contains(node)) continue;
    const b = node.getBoundingClientRect();
    const [bx, by] = center(b);
    const along = (bx - ax) * dx + (by - ay) * dy;
    if (along <= 4) continue;
    const across = Math.abs((bx - ax) * dy + (by - ay) * dx);
    // In line: the other box overlaps this one across the direction of travel.
    const overlap = dx ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const score = along + across * (overlap > 0 ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function turnPage(step) {
  if (topLayer()) return;
  const next = state.page + step;
  if (next < 0 || next >= state.pageCount) return;
  goToPage(next);
}

// Past the last app in a row: the next page, same row.
function pageAcross(from, dx) {
  const grid = from.parentElement;
  const tiles = [...grid.children];
  const index = tiles.indexOf(from);
  const perRow = state.grid?.perRow || tiles.length;
  const row = Math.floor(index / perRow);
  const next = state.page + dx;
  if (next < 0 || next >= state.pageCount) return false;
  goToPage(next);
  const target = $("pages").children[next]?.querySelectorAll(".app");
  if (!target?.length) return true;
  const col = dx > 0 ? 0 : perRow - 1;
  focusItem(target[Math.min(target.length - 1, row * perRow + col)]);
  return true;
}

function moveFocus(key) {
  const layer = topLayer();
  const items = focusables(layer);
  const current = document.activeElement;
  if (!items.includes(current)) return focusStart(layer);
  const [dx, dy] = DIRS[key];
  const target = nearest(current, items, [dx, dy]);
  const inGrid = current.matches("#pages .app");
  // Sideways out of the grid means the next page, not the page arrows.
  if (inGrid && dx && (!target || !target.matches("#pages .app") || Math.abs(center(target.getBoundingClientRect())[1] - center(current.getBoundingClientRect())[1]) > 20)) {
    if (pageAcross(current, dx)) return;
  }
  if (target) focusItem(target);
}

// ------------------------------------------------- rearranging by keyboard

function moveArranged(key) {
  const item = document.activeElement;
  const found = item && sortable(item);
  if (!found) return false;
  const items = [...found.container.querySelectorAll(found.selector)];
  const index = items.indexOf(found.item);
  const perRow = found.kind === "grid" ? state.grid?.perRow || items.length : items.length;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow }[key];
  if (found.kind === "dock" && (key === "ArrowUp" || key === "ArrowDown")) return true;
  const to = index + step;
  if (to < 0 || to >= items.length) return true;
  const other = items[to];
  found.container.insertBefore(found.item, step > 0 ? other.nextSibling : other);
  found.item.focus({ preventScroll: true });
  saveArrangement(found.kind, found.container);
  return true;
}

// ----------------------------------------------------------------- menus

function menuForFocused() {
  const node = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const target = node || $("desktop");
  const items = menuFor(target);
  if (!items) return;
  const r = (node || $("greeting")).getBoundingClientRect();
  openMenu(r.left + r.width / 2, r.bottom + 6, items);
}

// --------------------------------------------------------------- the list

function keyboardHelp() {
  const rows = [
    ...SHORTCUTS.filter((s) => !s.keys.includes("t") || state.admin).map((s) => [s.keys.join(" or "), s.label]),
    ...HELP_ONLY,
  ].map(([keys, what]) => el("div", { class: "kb-row" }, el("kbd", {}, keys), el("span", {}, what)));
  const close = el("button", { type: "button", class: "button-primary wide" }, "Done");
  close.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material kb-help", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard" },
    el("h2", {}, "Keyboard"), el("div", { class: "kb-rows" }, ...rows), el("div", { class: "dialog-actions" }, close)));
  close.focus();
}

// ---------------------------------------------------------------- wiring

function typing(node) {
  return node && (node.matches("textarea, select, [contenteditable]") ||
    (node.matches("input") && !["checkbox", "radio", "button", "submit", "range"].includes(node.type)));
}

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const node = document.activeElement;
  const layer = topLayer();
  // The menu for what's selected.
  if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey) || (e.key === "m" && !typing(node) && !e.ctrlKey && !e.metaKey && !e.altKey)) && (!layer || layer.id === "drawer")) {
    e.preventDefault();
    return menuForFocused();
  }
  if (DIRS[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) {
    // The search box (⌘K) runs its own list; text fields keep Left and Right.
    if (layer?.id === "search") return;
    if (typing(node) && (node.matches("textarea, select") || e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    if (arranging() && !layer && moveArranged(e.key)) return e.preventDefault();
    e.preventDefault();
    return moveFocus(e.key);
  }
  if (arranging() && (e.key === "Enter" || e.key === "Escape") && !layer) {
    e.preventDefault();
    return stopArranging();
  }
  if (e.key === "Tab" && layer) {
    // Tab goes round the open window, never behind it.
    const items = focusables(layer);
    if (!items.length) return;
    const i = items.indexOf(node);
    if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1)) {
      e.preventDefault();
      focusItem(e.shiftKey ? items.at(-1) : items[0]);
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || typing(node) || $("desktop").hidden) return;
  if (layer && layer.id !== "drawer" && !wm.windows.has(layer.id)) return;
  const shortcut = SHORTCUTS.find((s) => s.keys.includes(e.key));
  if (!shortcut) return;
  e.preventDefault();
  shortcut.run();
  // Opened a window from the keyboard: start inside it.
  requestAnimationFrame(() => {
    const now = topLayer();
    if (now && now !== layer && !now.contains(document.activeElement)) focusStart(now);
  });
});

// Remember where you were on the desktop, to come back to it.
document.addEventListener("focusin", (e) => {
  if (e.target.closest?.("#desktop, #dock")) kb.last = e.target;
});

