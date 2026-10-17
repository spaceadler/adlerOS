// Windows. On the home screen they come one at a time, sliding up over the
// desktop (like umbrelOS). In desktop mode (each device chooses: Settings →
// Desktop mode, or right-click the desktop) they float side by side: drag one
// by its title bar, resize it from any edge, drag it to the left or right
// edge for half the screen or to the top to maximize (or double-click its
// bar), minimize it to the dock. Your apps open in windows of their own when
// they allow being shown inside another page.
// Keys: Ctrl+` (Ctrl+Shift+` back) goes round the open windows and the
// desktop; on a title bar, m or the Menu key opens its menu, which can also
// snap it, or move and resize it with the arrow keys.
// Uses $, el, svg, api, toast, state, isOpen, closeSearch, closeMenu,
// closeDrawer, markDockOpen, openMenu, plateFor, sizeDock, focusStart.
"use strict";

const wm = { windows: new Map(), stack: [], order: [], active: null, geometry: {}, drag: null, keys: null, frames: {} };
const WIN_MIN = [340, 220];
const WIN_Z = 20; // above the desktop, under the dock (50)
const DESKTOP_MODE_KEY = "adleros.desktopMode";
const WIN_GEOMETRY_KEY = "adleros.windows";

function desktopMode() { return document.body.classList.contains("wm"); }

// Desktop mode is for a computer: a phone-sized screen never has it (it
// gets the iPhone-style layout instead). The choice is kept per browser, so
// it comes back when the screen is wide again.
const NARROW_SCREEN = matchMedia("(max-width: 639px)");
function computerScreen() { return !NARROW_SCREEN.matches; }

function winLoad(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
function winSave(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: not kept */ }
}

// -------------------------------------------------------- the two modes

function setDesktopMode(on) {
  if (on && !computerScreen()) return toast("Desktop mode is for a computer: a wider screen and a mouse.");
  if (on === desktopMode()) return;
  switchDesktopMode(on);
  winSave(DESKTOP_MODE_KEY, on);
  toast(on ? "Desktop mode: windows side by side, and your Desktop folder." : "Back to the home screen.");
}

function switchDesktopMode(on) {
  for (const [id, w] of wm.windows) if (isOpen(id)) (w.hide || w.close)();
  // Back to sliding sheets: no window keeps its place or size.
  for (const id of wm.windows.keys()) {
    const sheet = $(id);
    if (!sheet) continue;
    for (const prop of ["left", "top", "width", "height", "zIndex"]) sheet.style[prop] = "";
    sheet.classList.remove("active", "minimized");
    delete sheet.dataset.mode;
  }
  wm.stack = [];
  wm.order = [];
  document.body.classList.toggle("wm", on);
  wm.active = null;
  dockKey = null;
  buildDock();
  if (on) refreshDesk();
  else layout(true);
}

// ------------------------------------------------------------ registry

// Each window: its section's id, a title, close() (and hide(), if closing
// would lose something, like the terminal's session), its dock item, a size.
function registerWindow(id, { title, close, hide = null, dock = null, size = [1000, 700], app = null, extras = [] }) {
  wm.windows.set(id, { id, title, close, hide, dock, size, app });
  if (!$(id).querySelector(":scope > .win-bar")) winFrame(id, title, extras);
}

function winFrame(id, title, extras) {
  const sheet = $(id);
  const button = (kind, label, run, paths) => {
    const b = el("button", { type: "button", class: `win-button ${kind}`, "aria-label": label, title: label }, svg(paths));
    b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
    return b;
  };
  const name = el("span", { class: "win-title", tabindex: "0", title: "m: this window's menu" }, title);
  const bar = el("div", { class: "win-bar" }, name,
    ...extras.map((x) => button(x.kind, x.label, x.run, x.icon)),
    button("min", "Minimize", () => minimizeWindow(id), ["M6 12h12"]),
    button("max", "Maximize", () => toggleMaximize(id), ["M6 6h12v12H6z"]),
    button("close", "Close", () => wm.windows.get(id)?.close(), ["M18 6 6 18", "m6 6 12 12"]));
  bar.addEventListener("pointerdown", (e) => winPointerDown(e, id, "move"));
  bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) toggleMaximize(id); });
  bar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, winMenu(id));
  });
  name.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey) || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const r = name.getBoundingClientRect();
      openMenu(r.left + 20, r.bottom + 4, winMenu(id));
    }
  });
  sheet.prepend(bar);
  for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const grip = el("div", { class: `win-grip ${edge}`, "aria-hidden": "true" });
    grip.addEventListener("pointerdown", (e) => winPointerDown(e, id, edge));
    sheet.append(grip);
  }
}

// ------------------------------------------------------ open and close

function isActive(id) {
  return isOpen(id) && !$(id).classList.contains("minimized") && (!desktopMode() || wm.active === id);
}

function openWindow(id) {
  closeSearch();
  closeMenu();
  closeDrawer();
  if (!desktopMode()) {
    for (const [other, w] of wm.windows) if (other !== id && isOpen(other)) (w.hide || w.close)();
  }
  const sheet = $(id);
  const fresh = sheet.hidden || sheet.classList.contains("closing");
  sheet.classList.remove("closing", "minimized");
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  const w = wm.windows.get(id);
  if (w?.dock) markDockOpen(w.dock, true);
  if (!wm.order.includes(id)) wm.order.push(id);
  if (desktopMode()) {
    if (fresh) winPlace(id);
    raiseWindow(id);
  }
  winDock();
}

function closeWindow(id) {
  const sheet = $(id);
  if (!sheet || sheet.hidden || sheet.classList.contains("closing")) return false;
  const w = wm.windows.get(id);
  const hadFocus = sheet.contains(document.activeElement);
  sheet.classList.add("closing");
  sheet.classList.remove("active");
  if (w?.dock) markDockOpen(w.dock, false);
  if (![...wm.windows.keys()].some((other) => other !== id && isOpen(other))) document.body.classList.remove("sheet-open");
  wm.order = wm.order.filter((o) => o !== id);
  if (wm.active === id) winActivateTop();
  if (hadFocus && desktopMode()) winFocusNext();
  winDock();
  setTimeout(() => {
    if (!sheet.classList.contains("closing")) return; // opened again meanwhile
    sheet.hidden = true;
    sheet.classList.remove("closing", "minimized");
    if (w?.app) {
      sheet.remove();
      wm.windows.delete(id);
    }
  }, desktopMode() ? 160 : 280);
  return true;
}

// The dock (and the keys) for a window: open it, bring it forward, or put it away.
function toggleWindow(id, open) {
  if (!isOpen(id)) return open();
  const w = wm.windows.get(id);
  if (!desktopMode()) return (w.hide || w.close)(); // the terminal's shell keeps running
  if ($(id).classList.contains("minimized") || wm.active !== id) return raiseWindow(id, true);
  return minimizeWindow(id);
}

function raiseWindow(id, focus = false) {
  const sheet = $(id);
  if (!sheet || !desktopMode() || !isOpen(id)) return;
  sheet.classList.remove("minimized");
  wm.stack = [...wm.stack.filter((o) => o !== id && wm.windows.has(o)), id];
  wm.stack.forEach((o, i) => { if ($(o)) $(o).style.zIndex = String(WIN_Z + i); });
  if (wm.active !== id) {
    for (const o of wm.windows.keys()) $(o)?.classList.remove("active");
    sheet.classList.add("active");
    wm.active = id;
  }
  if (focus && !sheet.contains(document.activeElement)) requestAnimationFrame(() => focusStart(sheet));
  winDock();
}

// The window under it gets to be the active one; none left, the desktop.
function winActivateTop() {
  wm.active = null;
  const next = [...wm.stack].reverse().find((o) => isOpen(o) && !$(o).classList.contains("minimized"));
  if (next) raiseWindow(next);
  else for (const o of wm.windows.keys()) $(o)?.classList.remove("active");
}

function deactivateWindows() {
  wm.active = null;
  for (const o of wm.windows.keys()) $(o)?.classList.remove("active");
  winDock();
}

function minimizeWindow(id) {
  if (!desktopMode()) return wm.windows.get(id)?.close();
  const sheet = $(id);
  const hadFocus = sheet.contains(document.activeElement);
  sheet.classList.add("minimized");
  sheet.classList.remove("active");
  if (wm.active === id) winActivateTop();
  if (hadFocus) winFocusNext();
  winDock();
}

// Keys keep working after a window goes: into the next one, else the desktop.
function winFocusNext() {
  requestAnimationFrame(() => focusStart(wm.active ? $(wm.active) : null));
}

// -------------------------------------------------------------- geometry

// Where windows may go: the whole screen above the dock.
function winArea() {
  const dock = $("dock");
  const bottom = dock && !dock.hidden ? dock.getBoundingClientRect().top - 8 : innerHeight;
  return { w: innerWidth, h: Math.max(240, bottom) };
}

function winPlace(id) {
  const saved = wm.geometry[id];
  const area = winArea();
  if (!saved) {
    const [w, h] = wm.windows.get(id)?.size || [1000, 700];
    const width = Math.min(w, area.w - 40);
    const height = Math.min(h, area.h - 40);
    const step = (wm.order.length - 1) % 6;
    wm.geometry[id] = {
      mode: "normal", w: width, h: height,
      x: Math.max(0, Math.round((area.w - width) / 2) - 60 + step * 32), y: Math.max(0, Math.round((area.h - height) / 2) - 40 + step * 28),
    };
  }
  winApply(id);
}

function winApply(id) {
  const sheet = $(id);
  const g = wm.geometry[id];
  if (!sheet || !g) return;
  const area = winArea();
  let box;
  if (g.mode === "max") box = { x: 0, y: 0, w: area.w, h: area.h };
  else if (g.mode === "left") box = { x: 0, y: 0, w: Math.round(area.w / 2), h: area.h };
  else if (g.mode === "right") box = { x: Math.round(area.w / 2), y: 0, w: area.w - Math.round(area.w / 2), h: area.h };
  else {
    // Never lost: some of the bar stays on screen.
    g.w = Math.max(WIN_MIN[0], Math.min(g.w, area.w));
    g.h = Math.max(WIN_MIN[1], Math.min(g.h, area.h));
    g.x = Math.min(Math.max(g.x, 80 - g.w), area.w - 80);
    g.y = Math.min(Math.max(g.y, 0), area.h - 40);
    box = g;
  }
  Object.assign(sheet.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  sheet.dataset.mode = g.mode;
  const max = sheet.querySelector(":scope > .win-bar .win-button.max");
  if (max) max.setAttribute("aria-label", g.mode === "max" ? "Restore" : "Maximize");
}

function winRemember() {
  const keep = {};
  for (const [id, g] of Object.entries(wm.geometry)) if (!id.startsWith("app-") || wm.windows.has(id)) keep[id] = g;
  winSave(WIN_GEOMETRY_KEY, keep);
}

function winSnap(id, mode) {
  const g = wm.geometry[id];
  if (!g) return;
  g.mode = g.mode === mode ? "normal" : mode;
  winApply(id);
  winRemember();
}

function toggleMaximize(id) {
  if (desktopMode()) winSnap(id, "max");
}

// ------------------------------------------------- moving and resizing

function winPointerDown(e, id, kind) {
  if (!desktopMode() || e.button !== 0 || (kind === "move" && e.target.closest("button"))) return;
  raiseWindow(id);
  const r = $(id).getBoundingClientRect();
  wm.drag = { id, kind, sx: e.clientX, sy: e.clientY, box: { x: r.left, y: r.top, w: r.width, h: r.height }, moved: false, snap: null };
  e.currentTarget.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function winPointerMove(e) {
  const d = wm.drag;
  if (!d) return;
  const dx = e.clientX - d.sx;
  const dy = e.clientY - d.sy;
  if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  if (!d.moved) {
    d.moved = true;
    document.body.classList.add("win-moving");
  }
  const g = wm.geometry[d.id];
  if (d.kind === "move") {
    if (g.mode !== "normal") {
      // Dragging a maximized or half-screen window off: its own size again,
      // under the pointer where you grabbed it.
      const along = (d.sx - d.box.x) / d.box.w;
      g.mode = "normal";
      d.box = { x: e.clientX - along * g.w, y: d.box.y, w: g.w, h: g.h };
      d.sx = e.clientX;
      d.sy = e.clientY;
    }
    g.x = Math.round(d.box.x + (e.clientX - d.sx));
    g.y = Math.round(d.box.y + (e.clientY - d.sy));
    d.snap = e.clientX <= 4 ? "left" : e.clientX >= innerWidth - 5 ? "right" : e.clientY <= 4 ? "max" : null;
    winSnapHint(d.snap);
  } else {
    let { x, y, w, h } = d.box;
    if (d.kind.includes("e")) w = Math.max(WIN_MIN[0], w + dx);
    if (d.kind.includes("s")) h = Math.max(WIN_MIN[1], h + dy);
    if (d.kind.includes("w")) { const nw = Math.max(WIN_MIN[0], w - dx); x += w - nw; w = nw; }
    if (d.kind.includes("n")) { const nh = Math.max(WIN_MIN[1], h - dy); y += h - nh; h = nh; }
    Object.assign(g, { mode: "normal", x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }
  winApply(d.id);
}

function winPointerUp() {
  const d = wm.drag;
  if (!d) return;
  wm.drag = null;
  document.body.classList.remove("win-moving");
  winSnapHint(null);
  if (d.snap) {
    wm.geometry[d.id].mode = d.snap;
    winApply(d.id);
  }
  if (d.moved) winRemember();
}

function winSnapHint(mode) {
  const hint = $("win-snap");
  if (!mode) {
    hint.hidden = true;
    return;
  }
  const area = winArea();
  const half = Math.round(area.w / 2);
  const box = mode === "left" ? [0, 0, half, area.h] : mode === "right" ? [half, 0, area.w - half, area.h] : [0, 0, area.w, area.h];
  Object.assign(hint.style, { left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2]}px`, height: `${box[3]}px` });
  hint.hidden = false;
}

// From the window's menu: the arrow keys move (or resize) it, Enter is done.
function winKeys(id, kind) {
  raiseWindow(id);
  const g = wm.geometry[id];
  if (g.mode !== "normal") {
    const r = $(id).getBoundingClientRect();
    Object.assign(g, { mode: "normal", x: r.left, y: r.top, w: r.width, h: r.height });
  }
  wm.keys = { id, kind };
  $(id).classList.add("win-keyed");
  toast(kind === "move" ? "Arrow keys move the window (Shift: a little). Enter when it's there." : "Arrow keys resize the window (Shift: a little). Enter when it's right.");
}

function winKeysDone() {
  if (!wm.keys) return;
  $(wm.keys.id)?.classList.remove("win-keyed");
  wm.keys = null;
  winRemember();
}

// ---------------------------------------------------------------- menu

function winMenu(id) {
  const g = wm.geometry[id] || {};
  const w = wm.windows.get(id);
  const items = [];
  if (w?.app) {
    items.push({ label: "Open in a new tab", run: () => window.open(w.app.url, "_blank", "noopener,noreferrer") },
      { label: "Reload", run: () => reloadAppWindow(id) });
  }
  items.push(
    { label: g.mode === "max" ? "Restore" : "Maximize", run: () => toggleMaximize(id) },
    { label: g.mode === "left" ? "Restore" : "Left half", run: () => winSnap(id, "left") },
    { label: g.mode === "right" ? "Restore" : "Right half", run: () => winSnap(id, "right") },
    { label: "Move with the arrow keys", run: () => winKeys(id, "move") },
    { label: "Resize with the arrow keys", run: () => winKeys(id, "resize") },
    { label: "Minimize", run: () => minimizeWindow(id) },
    { label: "Close", run: () => w?.close(), destructive: true });
  return items;
}

// Round the open windows (and the desktop), in the order they opened.
function winCycle(back) {
  const stops = [...wm.order.filter((id) => isOpen(id)), null];
  if (stops.length === 1) return;
  const i = stops.indexOf(wm.active);
  const next = stops[(i + (back ? -1 : 1) + stops.length) % stops.length];
  if (next) return raiseWindow(next, true);
  deactivateWindows();
  focusStart(null);
}

// ------------------------------------------------------- in the dock

// Open windows without a dock item of their own (Files, the terminal, apps
// you haven't pinned) show at the end of the dock; a pinned app with a
// window gets the open mark.
function winDock() {
  const dock = $("dock");
  if (!dock) return;
  dock.querySelectorAll(".dock-run").forEach((n) => n.remove());
  dock.querySelectorAll(".dock-app.open").forEach((n) => n.classList.remove("open"));
  if (!desktopMode()) return sizeDock();
  const running = [];
  for (const id of wm.order) {
    const w = wm.windows.get(id);
    // Its own item in the dock (Files and Terminal only while pinned): that.
    if (!w || !isOpen(id) || (w.dock && dock.querySelector(`[data-dock="${w.dock}"]:not(.dock-run)`))) continue;
    const pinned = w.app && dock.querySelector(`.dock-app[data-app="${CSS.escape(w.app.id)}"]`);
    if (pinned) {
      pinned.classList.add("open");
      continue;
    }
    running.push(winDockItem(id, w));
  }
  // Like a Mac's: after your pinned apps, before the divider (and with no
  // pins, a divider of their own).
  if (running.length) {
    const divider = dock.querySelector(".dock-divider:not(.dock-run)");
    if (divider) divider.before(...running);
    else dock.prepend(...running, el("span", { class: "dock-divider dock-run", "aria-hidden": "true" }));
  }
  sizeDock();
}

function winDockItem(id, w) {
  const icon = w.app ? el("span", { class: "dock-plate" }, plateFor(w.app))
    : el("img", { src: `/static/dock/${id}.svg`, alt: "", draggable: "false" });
  // Not a pin (no dock-app): it can't be dragged in among them.
  const b = el("button", { type: "button", class: `dock-item dock-run open${wm.active === id ? " active" : ""}`,
    "aria-label": w.title, "data-window": id }, icon, el("span", { class: "dock-label material" }, w.title));
  b.addEventListener("click", () => toggleWindow(id, () => openWindow(id)));
  return b;
}

// --------------------------------------------------------- app windows

const APP_SANDBOX_ALLOW = "clipboard-read; clipboard-write; fullscreen; autoplay; camera; microphone; display-capture; web-share";

// Whether an app can open in a window (it may refuse to be shown inside
// another page). adlerOS asks once in a while; the answer is cached.
async function frameCheck(app) {
  const cached = wm.frames[app.id];
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  const secure = location.protocol === "https:" ? 1 : 0;
  const { status, body } = await api(`/api/frame/${encodeURIComponent(app.id)}?secure=${secure}`).catch(() => ({ status: 0 }));
  const answer = status === 200 && body ? body : { frame: false, why: "adlerOS couldn't check whether it can" };
  wm.frames[app.id] = { ...answer, at: Date.now() };
  return wm.frames[app.id];
}

async function openAppWindow(app) {
  const id = `app-${app.id}`;
  if (wm.windows.has(id) && isOpen(id)) return toggleWindow(id, () => {});
  const check = await frameCheck(app);
  if (!check.frame) {
    window.open(app.url, "_blank", "noopener,noreferrer");
    if (check.why) toast(`${app.name} opened in a tab: ${check.why}.`);
    return;
  }
  if (!$(id)) {
    const frame = el("iframe", { class: "app-frame", src: app.url, title: app.name, allow: APP_SANDBOX_ALLOW, referrerpolicy: "no-referrer" });
    // An inactive window's page would swallow the click that should bring it forward.
    const shield = el("div", { class: "app-shield", "aria-hidden": "true" });
    shield.addEventListener("pointerdown", () => raiseWindow(id));
    const sheet = el("section", { id, class: "sheet app-sheet", "aria-label": app.name, hidden: "" },
      el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-tint" })), frame, shield);
    document.body.insertBefore(sheet, $("modal"));
    registerWindow(id, {
      title: app.name, close: () => closeWindow(id), size: [1200, 800], app,
      extras: [
        { kind: "reload", label: "Reload", run: () => reloadAppWindow(id), icon: ["M21 12a9 9 0 1 1-3-6.7L21 8", "M21 3v5h-5"] },
        { kind: "tab", label: "Open in a new tab", run: () => window.open(app.url, "_blank", "noopener,noreferrer"), icon: ["M14 4h6v6", "M20 4 10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"] },
      ],
    });
  }
  openWindow(id);
}

function reloadAppWindow(id) {
  const frame = $(id)?.querySelector("iframe");
  if (frame) frame.src = frame.src;
}

// ---------------------------------------------------------------- wiring

wm.geometry = winLoad(WIN_GEOMETRY_KEY, {}) || {};
if (winLoad(DESKTOP_MODE_KEY, false) === true && computerScreen()) document.body.classList.add("wm");
// The screen got narrow (or wide again): off, or back on if you'd chosen it.
NARROW_SCREEN.addEventListener("change", () => {
  const want = computerScreen() && winLoad(DESKTOP_MODE_KEY, false) === true;
  if (want !== desktopMode()) switchDesktopMode(want);
});

document.addEventListener("pointermove", winPointerMove);
document.addEventListener("pointerup", winPointerUp);
document.addEventListener("pointercancel", winPointerUp);
// A click in a window brings it forward; on the desktop, none is in front.
document.addEventListener("pointerdown", (e) => {
  if (!desktopMode()) return;
  const sheet = e.target.closest?.(".sheet");
  if (sheet && wm.windows.has(sheet.id)) raiseWindow(sheet.id);
  else if (e.target.closest?.("#desktop") && !e.target.closest(".menu")) deactivateWindows();
}, true);
document.addEventListener("focusin", (e) => {
  const sheet = desktopMode() && e.target.closest?.(".sheet");
  if (sheet && wm.windows.has(sheet.id) && wm.active !== sheet.id) raiseWindow(sheet.id);
});
// Focus went into an app's page (the window can't hear its clicks).
window.addEventListener("blur", () => {
  setTimeout(() => {
    const frame = document.activeElement?.matches?.("iframe") && document.activeElement.closest(".sheet");
    if (frame && desktopMode() && wm.active !== frame.id) raiseWindow(frame.id);
  });
});
// Before anything else hears it (the terminal, the editor): Ctrl+` goes round
// the windows, and the arrow keys move a window you're placing.
document.addEventListener("keydown", (e) => {
  if (!desktopMode()) return;
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.code === "Backquote") {
    e.preventDefault();
    e.stopImmediatePropagation();
    winKeysDone();
    return winCycle(e.shiftKey);
  }
  if (!wm.keys) return;
  const { id, kind } = wm.keys;
  const step = e.shiftKey ? 10 : 40;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (delta) {
    const g = wm.geometry[id];
    if (kind === "move") { g.x += delta[0]; g.y += delta[1]; } else { g.w += delta[0]; g.h += delta[1]; }
    winApply(id);
  } else if (e.key === "Enter" || e.key === "Escape") {
    winKeysDone();
  } else {
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
window.addEventListener("resize", () => {
  if (!desktopMode()) return;
  for (const id of wm.windows.keys()) if (isOpen(id)) winApply(id);
});
