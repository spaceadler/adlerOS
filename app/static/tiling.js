// Desktop mode, after Hyprland: windows tile or float (Settings → Window
// layout, each computer its own), ten workspaces, and Alt doing what Super
// does there. Tiling is dwindle's: a new window takes half of the one in
// front, split along its longer side. The animations are in app.css, on
// the same curves.
// Uses $, el, wm, desktopMode, winLoad, winSave, winArea, winApply,
// winRemember, winSnap, winCycle, isOpen, raiseWindow, minimizeWindow,
// toggleMaximize, winActivateTop, toast, openMenu, toggleDrawer,
// openTerminal, toggleFiles, openSettings, confirmLogout, loadCatalog,
// loadSettings, runAction, settings, state, closeWindow.
"use strict";

const TILING_KEY = "adleros.tiling";
const TILE_GAP_OUT = 10;
const TILE_GAP_IN = 5;
const WS_COUNT = 10;
const WS_SLIDE = { duration: 500, easing: "cubic-bezier(0.05, 0.9, 0.1, 1.05)" }; // workspaces, 1, 5, wind
const tiles = { trees: {}, boxes: {}, floating: new Set(), ws: {}, current: 1, previous: 1, osdTimer: null };

function tilingOn() { return desktopMode() && winLoad(TILING_KEY, false) === true; }
function setTiling(on) {
  winSave(TILING_KEY, on);
  tiles.trees = {};
  winLayout();
  toast(on ? "Tiling: windows share the screen; Alt+V floats one." : "Floating windows.");
}

function tilesReset() {
  Object.assign(tiles, { trees: {}, boxes: {}, floating: new Set(), ws: {}, current: 1, previous: 1 });
  for (const id of wm.windows.keys()) $(id)?.classList.remove("off-ws");
}

// ---------------------------------------------------------- workspaces

function wsOf(id) { return tiles.ws[id] || tiles.current; }
function wsHere(id) { return !desktopMode() || wsOf(id) === tiles.current; }
function wsClaim(id) {
  tiles.ws[id] = tiles.current;
  $(id)?.classList.remove("off-ws");
}
const wsWindows = (n) => [...wm.windows.keys()].filter((id) => isOpen(id) && wsOf(id) === n);

// To workspace n: this one's windows slide away, n's slide in (focus, if it
// was one of them, goes to `focus`).
function switchWorkspace(n, focus) {
  if (!desktopMode() || n < 1 || n > WS_COUNT) return;
  if (n === tiles.current) {
    if (focus) raiseWindow(focus, true);
    return;
  }
  const dir = n > tiles.current ? 1 : -1;
  const leaving = wsWindows(tiles.current).filter((id) => id !== focus);
  tiles.previous = tiles.current;
  tiles.current = n;
  for (const id of leaving) {
    $(id).animate([{ translate: "0 0" }, { translate: `${-dir * 100}vw 0` }], WS_SLIDE).onfinish = () => {
      if (wsOf(id) !== tiles.current) $(id).classList.add("off-ws");
    };
  }
  for (const id of wsWindows(n)) {
    $(id).classList.remove("off-ws");
    $(id).animate([{ translate: `${dir * 100}vw 0` }, { translate: "0 0" }], WS_SLIDE);
  }
  winLayout();
  if (focus && isOpen(focus)) raiseWindow(focus, true);
  else winActivateTop();
  wsOsd();
}

// Hyprland's movetoworkspace: the window goes, and you go with it.
function moveToWorkspace(n) {
  const id = wm.active;
  if (!id || n === tiles.current) return;
  tiles.ws[id] = n;
  switchWorkspace(n, id);
}

// A moment's note of where you are: the ten, yours lit, the ones with
// windows marked.
function wsOsd() {
  let osd = $("ws-osd");
  if (!osd) {
    osd = el("div", { id: "ws-osd", class: "ws-osd material", "aria-live": "polite" });
    document.body.append(osd);
  }
  osd.replaceChildren(...Array.from({ length: WS_COUNT }, (_, i) => {
    const n = i + 1;
    return el("span", { class: `ws-dot${n === tiles.current ? " current" : ""}${wsWindows(n).length ? " used" : ""}` }, String(n % 10));
  }));
  osd.setAttribute("aria-label", `Workspace ${tiles.current}`);
  osd.classList.add("shown");
  clearTimeout(tiles.osdTimer);
  tiles.osdTimer = setTimeout(() => osd.classList.remove("shown"), 1200);
}

// --------------------------------------------------------------- tiling

// A tree per workspace: { id } a window, or { split: "h"|"v", ratio, a, b }.
function tileLeaves(node) { return !node ? [] : node.id ? [node.id] : [...tileLeaves(node.a), ...tileLeaves(node.b)]; }
function tilePath(node, id, path = []) {
  if (!node) return null;
  if (node.id) return node.id === id ? path : null;
  return tilePath(node.a, id, [...path, [node, "a"]]) || tilePath(node.b, id, [...path, [node, "b"]]);
}

function tileInsert(tree, id) {
  if (!tree) return { id };
  // The window in front (before this one opened), else the last.
  const all = tileLeaves(tree);
  const near = all.includes(wm.active) && wm.active !== id ? wm.active : all[all.length - 1];
  const path = tilePath(tree, near);
  const leaf = path.length ? path[path.length - 1][0][path[path.length - 1][1]] : tree;
  const box = tiles.boxes[near] || tileArea();
  const split = box.w >= box.h ? "h" : "v";
  const old = leaf.id;
  delete leaf.id;
  Object.assign(leaf, { split, ratio: 0.5, a: { id: old }, b: { id } });
  return tree;
}

function tileRemove(tree, id) {
  if (tree.id === id) return null;
  const path = tilePath(tree, id);
  const [parent, side] = path[path.length - 1];
  const sibling = side === "a" ? parent.b : parent.a;
  for (const key of Object.keys(parent)) delete parent[key];
  Object.assign(parent, sibling);
  return tree;
}

function tileArea() {
  const a = winArea();
  return { x: TILE_GAP_OUT, y: TILE_GAP_OUT, w: a.w - TILE_GAP_OUT * 2, h: a.h - TILE_GAP_OUT * 2 };
}

function tileLay(node, r) {
  node.rect = r;
  if (node.id) {
    tiles.boxes[node.id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    return;
  }
  const gap = TILE_GAP_IN * 2;
  if (node.split === "h") {
    const w = (r.w - gap) * node.ratio;
    tileLay(node.a, { x: r.x, y: r.y, w, h: r.h });
    tileLay(node.b, { x: r.x + w + gap, y: r.y, w: r.w - w - gap, h: r.h });
  } else {
    const h = (r.h - gap) * node.ratio;
    tileLay(node.a, { x: r.x, y: r.y, w: r.w, h });
    tileLay(node.b, { x: r.x, y: r.y + h + gap, w: r.w, h: r.h - h - gap });
  }
}

function tiledHere(id) {
  const w = wm.windows.get(id);
  return tilingOn() && isOpen(id) && wsOf(id) === tiles.current && !$(id).classList.contains("minimized")
    && !tiles.floating.has(id) && !w?.floats;
}

// The box a tiled window has (winApply), or null: it floats.
function tileBox(id) { return tiledHere(id) ? tiles.boxes[id] || null : null; }

// After anything that changes what's open where: this workspace's tiled
// windows, in their places again.
function winLayout() {
  if (!desktopMode()) return;
  const want = wm.order.filter(tiledHere);
  let tree = tiles.trees[tiles.current] || null;
  for (const id of tileLeaves(tree)) if (!want.includes(id)) tree = tileRemove(tree, id);
  for (const id of want) {
    if (tileLeaves(tree).includes(id)) continue;
    tree = tileInsert(tree, id);
    tileLay(tree, tileArea());
  }
  tiles.trees[tiles.current] = tree;
  if (tree) tileLay(tree, tileArea());
  for (const id of wm.windows.keys()) if (isOpen(id)) winApply(id);
}

// A tiled window dropped at (x, y): on another, they swap places.
function tileDrop(id, x, y) {
  const target = tileLeaves(tiles.trees[tiles.current]).find((o) => {
    const b = tiles.boxes[o];
    return o !== id && b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  });
  if (target) tileSwap(id, target);
}

function tileSwap(a, b) {
  const tree = tiles.trees[tiles.current];
  const pa = tilePath(tree, a);
  const pb = tilePath(tree, b);
  const leafA = pa.length ? pa[pa.length - 1][0][pa[pa.length - 1][1]] : tree;
  const leafB = pb.length ? pb[pb.length - 1][0][pb[pb.length - 1][1]] : tree;
  [leafA.id, leafB.id] = [b, a];
}

// Alt+V: out of the tiles (centred, its own size) or back in.
function toggleFloating(id) {
  if (!tilingOn()) return toast("Windows float already: Settings → Window layout → Tiling.");
  if (tiles.floating.has(id)) tiles.floating.delete(id);
  else {
    tiles.floating.add(id);
    centerWindow(id);
  }
  winLayout();
  raiseWindow(id);
}

function centerWindow(id) {
  const g = wm.geometry[id];
  if (!g || tileBox(id)) return;
  const area = winArea();
  g.mode = "normal";
  g.x = Math.round((area.w - g.w) / 2);
  g.y = Math.round((area.h - g.h) / 2);
  winApply(id);
  winRemember();
}

// Alt+U/P/I/O: 30px narrower, wider, shorter, taller. A tiled window moves
// the line it shares with its neighbour.
function resizeActive(dw, dh) {
  const id = wm.active;
  if (!id) return;
  if (tileBox(id)) {
    const path = tilePath(tiles.trees[tiles.current], id);
    for (const [axis, d] of [["h", dw], ["v", dh]]) {
      if (!d) continue;
      const step = [...path].reverse().find(([node]) => node.split === axis);
      if (!step) continue;
      const [node, side] = step;
      const size = axis === "h" ? node.rect.w : node.rect.h;
      node.ratio = Math.min(0.9, Math.max(0.1, node.ratio + (side === "a" ? d : -d) / size));
    }
    return winLayout();
  }
  const g = wm.geometry[id];
  if (g.mode !== "normal") {
    const r = $(id).getBoundingClientRect();
    Object.assign(g, { mode: "normal", x: r.left, y: r.top, w: r.width, h: r.height });
  }
  g.w += dw;
  g.h += dh;
  winApply(id);
  winRemember();
}

// ------------------------------------------------------------ the keys

// The window nearest in a direction (l, r, u, d) from the one in front.
function windowToward(id, dir) {
  const here = $(id).getBoundingClientRect();
  const cx = here.left + here.width / 2;
  const cy = here.top + here.height / 2;
  let best = null;
  for (const o of wm.order) {
    if (o === id || !isOpen(o) || !wsHere(o) || $(o).classList.contains("minimized")) continue;
    const b = $(o).getBoundingClientRect();
    const dx = b.left + b.width / 2 - cx;
    const dy = b.top + b.height / 2 - cy;
    const sideways = dir === "l" || dir === "r";
    if (!(dir === "l" ? dx < -1 : dir === "r" ? dx > 1 : dir === "u" ? dy < -1 : dy > 1)) continue;
    const score = (sideways ? Math.abs(dx) : Math.abs(dy)) + (sideways ? Math.abs(dy) : Math.abs(dx)) * 2;
    if (!best || score < best.score) best = { id: o, score };
  }
  return best?.id || null;
}

function focusToward(dir) {
  const id = wm.active;
  const next = id ? windowToward(id, dir) : wm.order.find((o) => isOpen(o) && wsHere(o));
  if (next) raiseWindow(next, true);
}

// Alt+Shift+H/J/K/L: a tiled window swaps with its neighbour; a floating one
// goes to that half of the screen (up: all of it; down: its own size).
function moveToward(dir) {
  const id = wm.active;
  if (!id) return;
  if (tileBox(id)) {
    const other = windowToward(id, dir);
    if (other && tileBox(other)) {
      tileSwap(id, other);
      winLayout();
    }
    return;
  }
  const g = wm.geometry[id];
  if (dir === "d") {
    g.mode = "normal";
    winApply(id);
    return winRemember();
  }
  const mode = { l: "left", r: "right", u: "max" }[dir];
  if (g.mode !== mode) winSnap(id, mode);
}

// Alt+Escape: Hyprland's power menu.
async function powerMenu() {
  const run = async (rowId) => {
    await loadCatalog();
    await loadSettings();
    const row = settings.catalog.rows.find((r) => r.id === rowId);
    if (row) runAction(row);
  };
  const r = { x: innerWidth / 2 - 90, y: innerHeight / 3 };
  openMenu(r.x, r.y, [
    { label: "Log out", run: confirmLogout },
    ...(state.admin ? [{ label: "Restart this machine…", run: () => run("restart") },
      { label: "Shut it down…", run: () => run("shutdown"), destructive: true }] : []),
  ]);
}

function closeActive() {
  if (desktopMode()) return wm.active && wm.windows.get(wm.active)?.close();
  for (const [id, w] of wm.windows) if (isOpen(id) && !w.float) return w.close();
}

// Alt and a key (by where it is: Alt changes what some keys type). Anywhere,
// even in the terminal, since that's what these are for; the window keys
// and workspaces only in desktop mode.
// Like exec alacritty / nautilus: with one open, another (desktop mode).
const openOrNew = (open, again, ids) => () => (desktopMode() && [...ids()].some((id) => isOpen(id)) ? again() : open());
const ALT_KEYS = {
  Space: () => toggleSearch(),
  Enter: openOrNew(openTerminal, newTerminalWindow, () => terms.keys()),
  KeyT: openOrNew(openTerminal, newTerminalWindow, () => terms.keys()),
  KeyE: openOrNew(() => openFiles(filesHome()), () => newFilesWindow(), () => fileWins.keys()),
  "Shift+KeyP": () => openSettings("wallpaper"),
  Escape: () => powerMenu(),
  KeyM: () => confirmLogout(),
  KeyW: () => closeActive(),
};
const ALT_WINDOW_KEYS = {
  Tab: () => winCycle(false),
  "Shift+Tab": () => winCycle(true),
  KeyV: () => wm.active && toggleFloating(wm.active),
  KeyF: () => wm.active && toggleMaximize(wm.active),
  KeyC: () => wm.active && centerWindow(wm.active),
  KeyH: () => focusToward("l"),
  KeyL: () => focusToward("r"),
  KeyK: () => focusToward("u"),
  KeyJ: () => focusToward("d"),
  "Shift+KeyH": () => moveToward("l"),
  "Shift+KeyL": () => moveToward("r"),
  "Shift+KeyK": () => moveToward("u"),
  "Shift+KeyJ": () => moveToward("d"),
  KeyU: () => resizeActive(-30, 0),
  KeyP: () => resizeActive(30, 0),
  KeyI: () => resizeActive(0, -30),
  KeyO: () => resizeActive(0, 30),
  KeyS: () => switchWorkspace(Math.min(WS_COUNT, tiles.current + 1)),
  KeyA: () => switchWorkspace(Math.max(1, tiles.current - 1)),
  KeyD: () => switchWorkspace(tiles.previous),
};
for (let n = 1; n <= WS_COUNT; n++) {
  ALT_WINDOW_KEYS[`Digit${n % 10}`] = () => switchWorkspace(n);
  ALT_WINDOW_KEYS[`Shift+Digit${n % 10}`] = () => moveToWorkspace(n);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Alt") document.body.classList.add("alt-held");
  if (!e.altKey || e.ctrlKey || e.metaKey || $("lock")?.hidden === false) return;
  const key = `${e.shiftKey ? "Shift+" : ""}${e.code}`;
  const run = ALT_KEYS[key] || (desktopMode() && ALT_WINDOW_KEYS[key]);
  if (!run) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  run();
}, true);
document.addEventListener("keyup", (e) => { if (e.key === "Alt") document.body.classList.remove("alt-held"); }, true);
window.addEventListener("blur", () => document.body.classList.remove("alt-held"));

// Alt and a drag anywhere on a window moves it (an app's page too: while
// Alt is down a shield covers it, app.css).
document.addEventListener("pointerdown", (e) => {
  if (!e.altKey || e.button !== 0 || !desktopMode()) return;
  const sheet = e.target.closest?.(".sheet");
  if (!sheet || !wm.windows.has(sheet.id) || !isOpen(sheet.id)) return;
  e.stopPropagation();
  winDragStart(e, sheet.id, "move", sheet);
}, true);
