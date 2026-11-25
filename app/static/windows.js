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
const WIN_CLOSE_MS = 1000; // its fade (app.css: Hyprland's fade, 10 ds)
const DESKTOP_MODE_KEY = "adleros.desktopMode";
const WIN_GEOMETRY_KEY = "adleros.windows";

function desktopMode() { return document.body.classList.contains("wm"); }

// Desktop mode is for a computer: a phone-sized screen never has it (it
// gets the iPhone-style layout instead). The choice is kept per browser, so
// it comes back when the screen is wide again.
const NARROW_SCREEN = matchMedia("(max-width: 639px)");
function computerScreen() { return !NARROW_SCREEN.matches; }
// A phone (or another small touch screen) in desktop mode, e.g. turned
// sideways: the dock is too big to keep, so it steps aside over a window
// and comes back from the bottom edge (app.css .small-touch).
const TOUCH_ONLY = matchMedia("(hover: none) and (pointer: coarse)");
function smallTouch() { return TOUCH_ONLY.matches && Math.min(screen.width, screen.height) < 600; }
function markSmallTouch() { document.body.classList.toggle("small-touch", smallTouch()); }
function dockAway() { return desktopMode() && smallTouch(); }

// A phone held sideways: desktop mode, made for a short, wide screen
// (app.css body.land). No menu bar: what it holds is on two floating bars
// down the left, one in each corner, clear of the notch between them
// (menubar.js landRail). A window fills the room beside them, with close and
// minimize only: no dragging, resizing or tiling. It comes by itself when
// the phone turns sideways (from the home screen too) and goes when it's
// upright again, back to what you'd chosen, which it never changes. Not in
// TV or car mode.
const LAND = { gap: 8, rail: 56 }; // the bars' margin and width (app.css --land-rail)
// Settings → On its side: "assisted" (this) or "desktop" (desktop mode as a
// computer has it: the menu bar, windows to drag). Each phone its own.
const LAND_STYLE_KEY = "adleros.landStyle";
function sidewaysPhone() {
  const c = document.body.classList;
  return smallTouch() && innerWidth > innerHeight && computerScreen() && !c.contains("tv") && !c.contains("car")
    && winLoad("adleros.tvMode", false) !== true && winLoad("adleros.carMode", false) !== true;
}
function landPhone() { return sidewaysPhone() && winLoad(LAND_STYLE_KEY, "assisted") !== "desktop"; }
function setLandStyle(style) {
  winSave(LAND_STYLE_KEY, style);
  landSync();
  if (desktopMode()) {
    for (const id of wm.order) if (isOpen(id)) winApply(id);
    if (typeof sizeDock === "function") sizeDock();
  }
}
function landOn() { return document.body.classList.contains("land") && desktopMode(); }
// Desktop mode or not: a phone on its side always; else what you chose, on a computer's screen.
function wantDesktop() { return sidewaysPhone() || (computerScreen() && winLoad(DESKTOP_MODE_KEY, false) === true); }
// Turned (or the screen changed): the right one of the two, and its windows in their places.
function landSync() {
  const c = document.body.classList;
  if (c.contains("tv") || c.contains("car")) return;
  c.toggle("land", landPhone());
  if (wantDesktop() !== desktopMode()) switchDesktopMode(wantDesktop());
  if (landOn() && typeof landRail === "function") landRail();
}
// The room on the right a window leaves: the notch's, when it's that side.
function landRight() {
  let probe = $("land-probe");
  if (!probe) { probe = el("div", { id: "land-probe", "aria-hidden": "true" }); document.body.append(probe); }
  return Math.max(LAND.gap, parseFloat(getComputedStyle(probe).paddingRight) || 0);
}

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

// A window's sidebar (Tasks, Calendar, Music, Documents, Luna, Gallery): the
// button at its bottom left puts it away, and brings it back. Kept per app,
// on this device. Where the window's too narrow for a sidebar (a strip along
// the top, or none), the button isn't shown (app.css).
// Also for another panel: flag (the class it puts on the section), what
// it's called and its icon (Documents' info column, on the right).
function sideToggle(section, app, cls = "side-toggle", { flag = "side-collapsed", what = "the sidebar", icon = ["M3 5h18v14H3z", "M9 5v14"] } = {}) {
  const key = `adleros.side.${app}`;
  const button = el("button", { type: "button", class: cls }, svg(icon));
  const show = (hidden) => {
    section.classList.toggle(flag, hidden);
    const label = hidden ? `Show ${what}` : `Hide ${what}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", String(!hidden));
  };
  button.addEventListener("click", () => {
    const hidden = !section.classList.contains(flag);
    winSave(key, hidden);
    show(hidden);
  });
  show(winLoad(key, false));
  return button;
}

// This device's: how see-through windows are, in both modes, 0 (solid) to 1
// (just the blurred wallpaper); and on the home screen, whether an app opens
// in a window here (a Raspberry Pi showing adlerOS full screen has nowhere
// else to show a tab) or in a new tab.
const GLASS_KEY = "adleros.glass";
const GLASS_DEFAULT = 0.45;
const OPEN_APPS_KEY = "adleros.openApps";
function glassLevel() {
  const v = Number(winLoad(GLASS_KEY, GLASS_DEFAULT));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : GLASS_DEFAULT;
}
function setGlass(v, keep = true) {
  document.documentElement.style.setProperty("--glass", String(v));
  if (keep) winSave(GLASS_KEY, v);
}
function appsInTabs() { return winLoad(OPEN_APPS_KEY, "here") === "tab"; }

// Where one app (or website) opens, on this device: a window here (as they
// all do), a tab of its own, or the Firefox app on the machine. A site you
// log in to wants one of the last two: inside a window here it's a page in
// another site's, and browsers keep its login (its cookies) out of that, so
// you log in and land back on its home page, logged out.
const OPEN_IN_KEY = "adleros.openIn";
const firefoxApp = () => state.apps.find((a) => a.known === "firefox" && a.url);
function openInFor(app) {
  const how = (winLoad(OPEN_IN_KEY, {}) || {})[app.id];
  return how === "tab" || (how === "firefox" && app.known !== "firefox" && firefoxApp()) ? how : "window";
}
// Its own window: on a computer, the browser's own app-like window (no tabs,
// no address bar to speak of) the size of one here, over adlerOS; on a
// phone, what the phone does (adlerOS on the Home Screen: a sheet over it,
// Done to come back). Your browser draws it, on your device: logins stick,
// videos play. A blocked pop-up: a tab.
function openOwnWindow(app) {
  if (!smallTouch()) {
    const w = Math.round(Math.min(screen.availWidth * 0.85, 1400)), h = Math.round(Math.min(screen.availHeight * 0.85, 900));
    const x = Math.round((screen.availLeft || 0) + (screen.availWidth - w) / 2), y = Math.round((screen.availTop || 0) + (screen.availHeight - h) / 2);
    // Opened blank, cut loose from adlerOS (it can't reach back into this
    // tab), then sent there; open already: brought forward.
    const win = window.open("", `adleros-${app.id}`, `popup,width=${w},height=${h},left=${x},top=${y}`);
    if (win) {
      try {
        if (win.location.href === "about:blank") { win.opener = null; win.location.href = app.url; }
      } catch { /* already there (another site's page): just bring it forward */ }
      win.focus?.();
      return;
    }
  }
  window.open(app.url, "_blank", "noopener,noreferrer");
}
function setOpenIn(app, how) {
  const all = { ...(winLoad(OPEN_IN_KEY, {}) || {}) };
  if (how === "window") delete all[app.id]; else all[app.id] = how;
  winSave(OPEN_IN_KEY, all);
  toast(`${app.name} opens ${{ window: "in a window here", tab: "in a window of its own", firefox: "in Firefox" }[how]} on this device.`);
}
function openInItems(app) {
  const now = openInFor(app);
  return [
    { label: "A window here", checked: now === "window", run: () => setOpenIn(app, "window") },
    { label: "Its own window (logins work)", checked: now === "tab", run: () => setOpenIn(app, "tab") },
    ...(firefoxApp() && app.known !== "firefox" ? [{ label: "Firefox (on the machine)", checked: now === "firefox", run: () => setOpenIn(app, "firefox") }] : []),
  ];
}

// This device's: how much liquid glass the see-through surfaces get
// (glass.css), 1 (all of it) down to 0 (none: no blur, for a slow machine).
// Near the top, Chromium also bends the light through it (an SVG filter).
const LIQUID_KEY = "adleros.liquid";
function liquidLevel() {
  const v = Number(winLoad(LIQUID_KEY, 1));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
function setLiquid(v, keep = true) {
  const root = document.documentElement;
  root.classList.toggle("glass-off", v <= 0);
  root.style.setProperty("--lg-backdrop", `blur(${Math.round(6 + 14 * v)}px) saturate(${Math.round(110 + 80 * v)}%) brightness(${(1 - 0.08 * v).toFixed(2)})`);
  root.style.setProperty("--lg-veil", `blur(${Math.round(8 + 24 * v)}px) saturate(${Math.round(110 + 50 * v)}%)`);
  const bend = v >= 0.9 && Boolean(navigator.userAgentData?.brands?.some((b) => b.brand === "Chromium"));
  if (bend && !$("lg-filters")) document.body.append(liquidFilter());
  root.classList.toggle("lg-refract", bend);
  if (keep) winSave(LIQUID_KEY, v);
}
// The bend: a soft noise moves what's behind the glass a few pixels.
function liquidFilter() {
  const NS = "http://www.w3.org/2000/svg";
  const node = (name, attrs, ...kids) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };
  return node("svg", { id: "lg-filters", width: "0", height: "0", "aria-hidden": "true" },
    node("filter", { id: "lg-refract", x: "0", y: "0", width: "100%", height: "100%", "color-interpolation-filters": "sRGB" },
      node("feTurbulence", { type: "fractalNoise", baseFrequency: "0.008 0.012", numOctaves: "2", seed: "7", result: "noise" }),
      node("feGaussianBlur", { in: "noise", stdDeviation: "3", result: "soft" }),
      node("feDisplacementMap", { in: "SourceGraphic", in2: "soft", scale: "16", xChannelSelector: "R", yChannelSelector: "G" })));
}

// -------------------------------------------------------- the two modes

function setDesktopMode(on) {
  if (on && !computerScreen()) return toast("Desktop mode is for a computer: a wider screen and a mouse.");
  if (sidewaysPhone()) {
    // On its side a phone keeps its own desktop; upright, it's what you chose.
    winSave(DESKTOP_MODE_KEY, on);
    if (!desktopMode()) landSync();
    return toast(on ? "Desktop mode on: on its side, this phone keeps this layout anyway." : "The home screen comes back when you hold the phone upright.");
  }
  if (on === desktopMode()) return;
  switchDesktopMode(on);
  winSave(DESKTOP_MODE_KEY, on);
  toast(on ? "Desktop mode: windows side by side, and your Desktop folder." : "Back to the home screen.");
}

// The ways adlerOS can look, each device its own: the home screen, desktop
// mode, TV (tv.js) and Car (car.js). One list for Settings, Control
// Center and the menus.
const MODES = [["home", "Home screen"], ["desktop", "Desktop"], ["tv", "TV"], ["car", "Car"], ["standby", "StandBy"]];
const MODES_SOON = new Set();
function currentMode() { return typeof sbOn === "function" && sbOn() ? "standby" : tvOn() ? "tv" : carOn() ? "car" : desktopMode() ? "desktop" : "home"; }
function modeName(mode) { return MODES.find(([m]) => m === mode)?.[1] || mode; }
// From one mode to another through a moment of black, as a TV changing
// its input: the switch itself on a timer, so it happens even where nothing
// is drawn (a hidden tab). A promise, done once it has.
function modeDip(change) {
  if (!motionOK()) { change(); return Promise.resolve(); }
  let veil = $("mode-veil");
  if (!veil) {
    veil = el("div", { id: "mode-veil", class: "mode-veil", "aria-hidden": "true" });
    document.body.append(veil);
  }
  for (const a of veil.getAnimations()) a.cancel();
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: "ease-in", fill: "forwards" });
  return new Promise((done) => setTimeout(() => {
    try { change(); } finally {
      for (const a of veil.getAnimations()) a.cancel();
      veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: "ease-out", fill: "forwards" });
      done();
    }
  }, 180));
}
function setMode(mode) {
  if (MODES_SOON.has(mode)) { toast(`${modeName(mode)} mode isn't here yet; it's on the list.`); return Promise.resolve(); }
  if (mode === currentMode()) { setModeNow(mode); return Promise.resolve(); }
  return modeDip(() => setModeNow(mode));
}
function setModeNow(mode) {
  // StandBy (standby.js) goes over the mode you're in, and leaves it as it was.
  if (mode === "standby") return setStandby(true);
  if (typeof sbOn === "function" && sbOn()) setStandby(false);
  if (mode === "tv") return setTv(true);
  if (mode === "car") return setCar(true);
  if (tvOn()) setTv(false);
  if (carOn()) setCar(false);
  setDesktopMode(mode === "desktop");
}
function modeItems() {
  return MODES.map(([m, label]) => ({ label, checked: currentMode() === m, muted: MODES_SOON.has(m) || (m === "desktop" && !computerScreen()), run: () => setMode(m) }));
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
  tilesReset();
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
// A float one (Music, the viewer) sits over the others on the home screen
// instead of taking their place; a floats one (Music) floats when windows
// tile, too.
// A copy (a second terminal) goes for good when it closes, like an app's.
function registerWindow(id, { title, close, hide = null, dock = null, icon = null, size = [1000, 700], app = null, extras = [],
  float = false, floats = false, copy = false }) {
  wm.windows.set(id, { id, title, close, hide, dock, icon, size, app, float, floats, copy });
  if (!$(id).querySelector(":scope > .win-bar")) winFrame(id, title, extras);
  winZoomApply(id);
  if (typeof sheetSwipeable === "function") sheetSwipeable($(id)); // swiped down to close (phone.js)
}

function winFrame(id, title, extras) {
  const sheet = $(id);
  const button = (kind, label, run, paths) => {
    const b = el("button", { type: "button", class: `win-button ${kind}`, "aria-label": label, title: label }, svg(paths));
    b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
    return b;
  };
  const name = el("span", { class: "win-title", tabindex: "0", title: "m: this window's menu" }, title);
  // Like a Mac's: close, minimize and maximize on the left; the title in the
  // middle; the window's own buttons (an app's Reload) on the right.
  const lights = el("div", { class: "win-lights" },
    button("close", "Close", () => wm.windows.get(id)?.close(), ["M17 7 7 17", "m7 7 10 10"]),
    button("min", "Minimize", () => minimizeWindow(id), ["M6 12h12"]),
    button("max", "Maximize", () => toggleMaximize(id), ["M12 6v12", "M6 12h12"]));
  // Its zoom, when it isn't 100%: a click puts it back.
  const zoom = el("button", { type: "button", class: "win-zoom", title: "Actual size (Ctrl+0)", hidden: "" });
  zoom.addEventListener("click", (e) => { e.stopPropagation(); winZoom(id, 0); });
  const bar = el("div", { class: "win-bar" }, lights, name,
    el("div", { class: "win-extras" }, zoom, ...extras.map((x) => button(x.kind, x.label, x.run, x.icon))));
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

// A window that shows one thing at a time (the viewer): its title, in its
// bar and the dock.
function titleWindow(id, title) {
  const w = wm.windows.get(id);
  if (!w) return;
  w.title = title;
  const bar = $(id).querySelector(":scope > .win-bar .win-title");
  if (bar) bar.textContent = title;
  winDock();
}

// ------------------------------------------------------ open and close

function isActive(id) {
  return isOpen(id) && !$(id).classList.contains("minimized") && (!desktopMode() || wm.active === id);
}

// The home screen's icon an app was opened from (a tap a moment ago): its
// window grows out of it, and goes back into it, as an iPhone's apps do.
let launchedFrom = null;
document.addEventListener("click", (e) => {
  const tile = e.target.closest?.("#desktop .app");
  if (tile) launchedFrom = { app: tile.dataset.app, at: performance.now() };
}, true);
const homeIcon = (app) => app && !document.body.classList.contains("wm") && !document.body.matches(".tv, .car") && !$("desktop").hidden
  ? $("desktop").querySelector(`.app[data-app="${CSS.escape(app)}"] .app-icon`) : null;
// Where the sheet is drawn as it is, and the transform that puts it on `r`.
function sheetToRect(sheet, r) {
  const f = sheet.getBoundingClientRect();
  const base = getComputedStyle(sheet).transform;
  const t = base && base !== "none" ? base : "";
  return {
    from: `translate(${r.left - f.left}px, ${r.top - f.top}px) ${t} scale(${r.width / f.width}, ${r.height / f.height})`,
    to: `translate(0px, 0px) ${t} scale(1, 1)`,
  };
}
function zoomFromIcon(sheet, app) {
  const icon = homeIcon(app);
  const r = icon?.getBoundingClientRect();
  if (!r?.width || !motionOK()) return false;
  sheet.style.animation = "none";
  const { from, to } = sheetToRect(sheet, r);
  sheet.animate([{ transformOrigin: "0 0", transform: from, opacity: 0, borderRadius: "40px" }, { opacity: 1, offset: 0.3 },
    { transformOrigin: "0 0", transform: to, opacity: 1 }], { duration: 520, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }).id = "zoom";
  sheet.dataset.fromApp = app;
  return true;
}
function zoomToIcon(sheet, ms) {
  const app = sheet.dataset.fromApp;
  delete sheet.dataset.fromApp;
  const icon = homeIcon(app);
  const r = icon?.getBoundingClientRect();
  if (!r?.width || !motionOK() || sheet.style.transform) { sheet.style.animation = ""; return false; } // a swipe: it slides on down
  sheet.style.animation = "none";
  const { from, to } = sheetToRect(sheet, r);
  sheet.animate([{ transformOrigin: "0 0", transform: to, opacity: 1 }, { opacity: 1, offset: 0.65 },
    { transformOrigin: "0 0", transform: from, opacity: 0, borderRadius: "40px" }], { duration: ms, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }).id = "zoom";
  return true;
}

function openWindow(id) {
  closeSearch();
  closeMenu();
  closeDrawer();
  const w = wm.windows.get(id);
  if (!desktopMode() && !w?.float) {
    for (const [other, o] of wm.windows) if (other !== id && !o.float && isOpen(other)) (o.hide || o.close)();
    document.body.classList.remove("dock-peek"); // the dock steps aside again
  }
  const sheet = $(id);
  const fresh = sheet.hidden || sheet.classList.contains("closing");
  for (const a of sheet.getAnimations()) if (a.id === "zoom") a.cancel();
  if (fresh) { sheet.style.animation = ""; delete sheet.dataset.fromApp; }
  sheet.classList.remove("closing", "minimized");
  sheet.hidden = false;
  // From a home screen icon just tapped: out of it.
  const from = launchedFrom && performance.now() - launchedFrom.at < 2000 ? launchedFrom.app : null;
  if (fresh && from && !desktopMode() && !w?.float) { launchedFrom = null; zoomFromIcon(sheet, from); }
  if (!w?.float) document.body.classList.add("sheet-open");
  if (w?.dock) markDockOpen(w.dock, true);
  if (!wm.order.includes(id)) wm.order.push(id);
  if (desktopMode()) {
    if (fresh) {
      wsClaim(id); // on the workspace you're on
      // Straight to its place (its tile, when windows tile); the others move over.
      sheet.classList.add("win-placing");
      requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.remove("win-placing")));
      winPlace(id);
    }
    winLayout();
    raiseWindow(id);
  }
  winDock();
  if (fresh) winGenie(id, false);
}

function closeWindow(id) {
  const sheet = $(id);
  if (!sheet || sheet.hidden || sheet.classList.contains("closing")) return false;
  const w = wm.windows.get(id);
  const hadFocus = sheet.contains(document.activeElement);
  // Before winDock takes a running one away; minimized, it's in there already.
  const icon = sheet.classList.contains("minimized") ? null : winGenieIcon(id);
  if (!desktopMode() && sheet.dataset.fromApp) zoomToIcon(sheet, 280);
  sheet.classList.add("closing");
  sheet.classList.remove("active");
  if (desktopMode()) winOnTop(sheet);
  winGenie(id, true, icon);
  if (w?.dock) markDockOpen(w.dock, false);
  if (![...wm.windows].some(([other, o]) => other !== id && !o.float && isOpen(other))) document.body.classList.remove("sheet-open");
  wm.order = wm.order.filter((o) => o !== id);
  if (wm.active === id) winActivateTop();
  if (hadFocus && desktopMode()) winFocusNext();
  winLayout(); // the others fill its place while it fades
  winDock();
  setTimeout(() => {
    if (!sheet.classList.contains("closing")) return; // opened again meanwhile
    sheet.hidden = true;
    for (const a of sheet.getAnimations()) if (a.id === "zoom") a.cancel();
    sheet.style.animation = "";
    sheet.classList.remove("closing", "minimized");
    winGenieStop(sheet);
    if (w?.app || w?.copy) {
      sheet.remove();
      wm.windows.delete(id);
      delete wm.geometry[id];
    }
  }, desktopMode() ? WIN_CLOSE_MS : 280);
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
  if (!wsHere(id)) return switchWorkspace(wsOf(id), id); // over there: go there
  const wasMinimized = sheet.classList.contains("minimized");
  sheet.classList.remove("minimized");
  if (wasMinimized) {
    winLayout();
    winGenie(id, false);
  }
  wm.stack = [...wm.stack.filter((o) => o !== id && wm.windows.has(o)), id];
  // (One going into the dock stays over the rest till it's gone: winOnTop.)
  wm.stack.forEach((o, i) => { if ($(o) && !$(o).classList.contains("closing") && !$(o).classList.contains("minimized")) $(o).style.zIndex = String(WIN_Z + i); });
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
  const next = [...wm.stack].reverse().find((o) => isOpen(o) && wsHere(o) && !$(o).classList.contains("minimized"));
  if (next) raiseWindow(next);
  else for (const o of wm.windows.keys()) $(o)?.classList.remove("active");
}

function deactivateWindows() {
  wm.active = null;
  for (const o of wm.windows.keys()) $(o)?.classList.remove("active");
  winDock();
}

// Closing or minimizing: in front of the others while it goes into the
// dock, so you see it go. Only its own z-index: the order the rest are in
// (wm.stack) stays, and it gets its place back when it's raised again.
function winOnTop(sheet) {
  sheet.style.zIndex = String(Math.min(WIN_Z + wm.stack.length + 1, 49)); // still under the dock
}

function minimizeWindow(id) {
  if (!desktopMode()) return wm.windows.get(id)?.close();
  const sheet = $(id);
  const hadFocus = sheet.contains(document.activeElement);
  sheet.classList.add("minimized");
  sheet.classList.remove("active");
  winOnTop(sheet);
  winGenie(id, true);
  if (wm.active === id) winActivateTop();
  if (hadFocus) winFocusNext();
  winLayout();
  winDock();
}

// ------------------------------------------------------------ the genie

// A window comes out of its dock icon and goes back into it, as a Mac's
// genie: going, its foot narrows to the icon's width, then it's drawn
// down into it; coming, the same backwards.
const WIN_GENIE_MS = 560;
const WIN_GENIE_ROWS = 8; // points down each side, for the curve

// Its icon in the dock: its own, its pin, or the one it shows while open.
function winGenieIcon(id) {
  const dock = $("dock"), w = wm.windows.get(id);
  // A phone on its side too: its windows go into the dock and come out of it, as a Mac's.
  if (!dock || dock.hidden || !w || !desktopMode() || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const icon = (w.dock && dock.querySelector(`[data-dock="${w.dock}"]:not(.dock-run)`))
    || (w.app && dock.querySelector(`.dock-app[data-app="${CSS.escape(w.app.id)}"]`))
    || dock.querySelector(`[data-window="${CSS.escape(id)}"]`);
  const r = icon?.getBoundingClientRect();
  return r?.width ? r : null;
}

function winGenieStop(sheet) {
  for (const a of sheet.getAnimations()) if (a.id === "genie") a.cancel();
  sheet.classList.remove("win-genie");
}

// out: into the icon (and it stays there until it's hidden); else out of it.
function winGenie(id, out, icon = winGenieIcon(id)) {
  const sheet = $(id);
  winGenieStop(sheet);
  if (!icon) return;
  sheet.classList.add("win-genie"); // no pop or fade of its own, and measured as it is
  const b = sheet.getBoundingClientRect();
  const w = b.width, h = b.height;
  // Where it narrows to: under the icon, kept within the window; the rest
  // of the way over it slides.
  const span = Math.min(icon.width, w);
  const left = Math.max(0, Math.min(w - span, icon.left - b.left));
  const dx = icon.left + (icon.width - span) / 2 - b.left - left;
  const smooth = (t) => t * t * (3 - 2 * t);
  // The outline: its top from tl to tr, its foot from bl to br, the sides an S.
  const shape = (tl, tr, bl, br) => {
    const l = [], r = [];
    for (let i = 0; i <= WIN_GENIE_ROWS; i++) {
      const f = i / WIN_GENIE_ROWS, e = smooth(f), y = (f * h).toFixed(1);
      l.push(`${(tl + (bl - tl) * e).toFixed(1)}px ${y}px`);
      r.unshift(`${(tr + (br - tr) * e).toFixed(1)}px ${y}px`);
    }
    return `polygon(${[...l, ...r].join(", ")})`;
  };
  const right = left + span;
  const transformOrigin = `${left + span / 2}px ${icon.top + icon.height / 2 - b.top}px`;
  const frames = [
    { offset: 0, clipPath: shape(0, w, 0, w), transform: "translateX(0) scaleY(1)", opacity: 1 },
    { offset: 0.4, clipPath: shape(left * 0.3, w + (right - w) * 0.3, left, right), transform: "translateX(0) scaleY(1)", opacity: 1 },
    { offset: 0.85, opacity: 1 },
    { offset: 1, clipPath: shape(left, right, left, right), transform: `translateX(${dx}px) scaleY(0.03)`, opacity: 0 },
  ].map((f) => ({ ...f, transformOrigin }));
  const a = sheet.animate(frames, { duration: WIN_GENIE_MS, easing: "ease-in", direction: out ? "normal" : "reverse", fill: out ? "forwards" : "none" });
  a.id = "genie";
  a.onfinish = () => {
    // Gone into the dock (minimized): now it may go; come out: as it was.
    if (!out || sheet.classList.contains("minimized")) winGenieStop(sheet);
  };
}

// Keys keep working after a window goes: into the next one, else the desktop.
function winFocusNext() {
  requestAnimationFrame(() => focusStart(wm.active ? $(wm.active) : null));
}

// -------------------------------------------------------------- geometry

// Where windows may go: the whole screen under the menu bar (menubar.js)
// and above the dock. Their places count from under the bar: winTop.
const MENUBAR_H = 28;
function winTop() { return landOn() ? LAND.gap : desktopMode() ? MENUBAR_H : 0; }
// A phone on its side: windows start right of the bars down the left.
function winLeft() { return landOn() ? LAND.gap * 2 + LAND.rail : 0; }
function winArea() {
  if (landOn()) return { w: innerWidth - winLeft() - landRight(), h: innerHeight - 2 * LAND.gap };
  const dock = $("dock");
  const bottom = dock && !dock.hidden && !dockAway() ? dock.getBoundingClientRect().top - 8 : innerHeight;
  return { w: innerWidth, h: Math.max(240, bottom - winTop()) };
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
  const tile = !landOn() && g.mode !== "max" && tileBox(id);
  sheet.dataset.tiled = tile ? "1" : "";
  let box;
  if (landOn()) box = { x: 0, y: 0, w: area.w, h: area.h }; // a phone on its side: all the room there is
  else if (tile) box = tile;
  else if (g.mode === "col") { g.mode = g.side || "normal"; return winApply(id); } // kept from the old Panorama layout
  else if (g.mode === "max") box = { x: 0, y: 0, w: area.w, h: area.h };
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
  const top = box.y + winTop(), left = box.x + winLeft();
  Object.assign(sheet.style, { left: `${left}px`, top: `${top}px`, width: `${box.w}px`, height: `${box.h}px` });
  // Its blurred wallpaper lines up with the real one: a window shows the
  // desktop behind it, never the windows in between.
  sheet.style.setProperty("--win-x", `${left}px`);
  sheet.style.setProperty("--win-y", `${top}px`);
  sheet.dataset.mode = landOn() ? "land" : g.mode; // on a phone on its side, never "max" (its corners stay round)
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
  if (desktopMode() && !landOn()) winSnap(id, "max"); // on a phone on its side, it fills the room already
}

// ------------------------------------------------- moving and resizing

function winPointerDown(e, id, kind) {
  if (!desktopMode() || landOn() || e.button !== 0 || (kind === "move" && e.target.closest("button"))) return;
  winDragStart(e, id, kind, e.currentTarget);
}

function winDragStart(e, id, kind, holder) {
  raiseWindow(id);
  const r = $(id).getBoundingClientRect();
  // A tiled one is lifted out of its place, and dropped on another to swap.
  wm.drag = { id, kind, sx: e.clientX, sy: e.clientY, box: { x: r.left, y: r.top - winTop(), w: r.width, h: r.height }, moved: false, snap: null,
    tiled: Boolean(tileBox(id)) };
  holder.setPointerCapture(e.pointerId);
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
  if (d.tiled) {
    if (d.kind !== "move") return;
    const sheet = $(d.id);
    const x = Math.round(d.box.x + dx);
    const y = Math.round(d.box.y + dy) + winTop();
    Object.assign(sheet.style, { left: `${x}px`, top: `${y}px` });
    // Its blurred wallpaper comes along: what's behind it now, not where it was.
    sheet.style.setProperty("--win-x", `${x}px`);
    sheet.style.setProperty("--win-y", `${y}px`);
    d.at = [e.clientX, e.clientY];
    return;
  }
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
    d.snap = e.clientX <= 4 ? "left" : e.clientX >= innerWidth - 5 ? "right" : e.clientY <= winTop() + 4 ? "max" : null;
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
  if (d.tiled) {
    if (d.moved && d.at) tileDrop(d.id, d.at[0], d.at[1] - winTop());
    return winLayout();
  }
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
  Object.assign(hint.style, { left: `${box[0]}px`, top: `${box[1] + winTop()}px`, width: `${box[2]}px`, height: `${box[3]}px` });
  hint.hidden = false;
}

// From the window's menu: the arrow keys move (or resize) it, Enter is done.
function winKeys(id, kind) {
  raiseWindow(id);
  const g = wm.geometry[id];
  if (g.mode !== "normal") {
    const r = $(id).getBoundingClientRect();
    Object.assign(g, { mode: "normal", x: r.left, y: r.top - winTop(), w: r.width, h: r.height });
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
  // A My Computer, terminal or Notepad window: another of it.
  const kind = windowKind(id);
  if (kind) items.push(...newWindowItem(kind));
  if (winZoomable(id)) {
    items.push({ label: "Zoom in (Ctrl +)", run: () => winZoom(id, 1) }, { label: "Zoom out (Ctrl −)", run: () => winZoom(id, -1) });
    if (winZoomOf(id) !== 1) items.push({ label: "Actual size (Ctrl 0)", run: () => winZoom(id, 0) });
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

// ---------------------------------------------------------------- zoom

// Ctrl (⌘ on a Mac) with + − 0, or with the wheel (a trackpad's pinch), over
// one of adlerOS's own windows zooms that window's content, not the whole
// page: Luna's text bigger, the rest as it was. Each kind of window
// (Luna, Music, My Computer…) keeps its own, on this device. An app's
// window (another site's page) is left to the browser.
const WIN_ZOOM_KEY = "adleros.zoom";
const WIN_ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const winZoomKind = (id) => id.replace(/-\d+$/, ""); // My Computer 2 zooms with My Computer
function winZoomable(id) { return Boolean(wm.windows.has(id) && !wm.windows.get(id).app && $(id)); }
function winZoomOf(id) { return winLoad(WIN_ZOOM_KEY, {})[winZoomKind(id)] || 1; }

function winZoomApply(id) {
  const sheet = $(id);
  if (!sheet || !winZoomable(id)) return;
  const z = winZoomOf(id);
  sheet.style.setProperty("--win-zoom", String(z));
  const badge = sheet.querySelector(":scope > .win-bar .win-zoom");
  if (badge) {
    badge.hidden = z === 1;
    badge.textContent = `${Math.round(z * 100)}%`;
  }
}

// dir: 1 bigger, -1 smaller, 0 back to 100%.
function winZoom(id, dir) {
  if (!winZoomable(id)) return false;
  const now = winZoomOf(id);
  const at = WIN_ZOOMS.reduce((best, z, i) => (Math.abs(z - now) < Math.abs(WIN_ZOOMS[best] - now) ? i : best), 0);
  const next = dir ? WIN_ZOOMS[Math.max(0, Math.min(WIN_ZOOMS.length - 1, at + dir))] : 1;
  const all = winLoad(WIN_ZOOM_KEY, {});
  if (next === 1) delete all[winZoomKind(id)];
  else all[winZoomKind(id)] = next;
  winSave(WIN_ZOOM_KEY, all);
  for (const other of wm.windows.keys()) if (winZoomKind(other) === winZoomKind(id)) winZoomApply(other);
  toast(`${wm.windows.get(id).title}: ${Math.round(next * 100)}%`);
  return true;
}

// The window a zoom key is for: the one you're in (desktop mode's active
// one, or the sheet that's open on the home screen).
function winZoomTarget() {
  const here = document.activeElement?.closest?.(".sheet")?.id;
  if (here && isOpen(here)) return here;
  if (desktopMode()) return wm.active && isOpen(wm.active) ? wm.active : null;
  return [...wm.windows.keys()].reverse().find((id) => isOpen(id) && !wm.windows.get(id).float) || null;
}

// How much bigger than its own CSS pixels a node is drawn (inside a zoomed
// window): what turns a pointer's offset on screen into the node's pixels.
function drawnScale(node) {
  const w = node?.offsetWidth;
  return w ? node.getBoundingClientRect().width / w || 1 : 1;
}

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const dir = ["=", "+"].includes(e.key) || e.code === "NumpadAdd" ? 1
    : ["-", "_"].includes(e.key) || e.code === "NumpadSubtract" ? -1
      : e.key === "0" || e.code === "Numpad0" ? 0 : null;
  if (dir === null) return;
  const id = winZoomTarget();
  if (!id || !winZoomable(id)) return; // the desktop, or an app's window: the browser's zoom
  e.preventDefault();
  e.stopImmediatePropagation();
  winZoom(id, dir);
}, true);

// Ctrl and the wheel (or a pinch, which browsers send as one) over a window.
const winWheel = { at: 0, sum: 0 };
document.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  const id = e.target.closest?.(".sheet")?.id;
  if (!id || !winZoomable(id) || !isOpen(id)) return;
  e.preventDefault();
  winWheel.sum += e.deltaY;
  if (Math.abs(winWheel.sum) < 40 || Date.now() - winWheel.at < 120) return;
  winWheel.at = Date.now();
  winZoom(id, winWheel.sum < 0 ? 1 : -1);
  winWheel.sum = 0;
}, { passive: false });

// Round the open windows (and the desktop), in the order they opened.
function winCycle(back) {
  const stops = [...wm.order.filter((id) => isOpen(id) && wsHere(id)), null];
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
// window gets the open mark. Called often (a window's title changes as you
// type in it), so a window's item is kept and only updated: made again, its
// icon would load again, a white flash each key; and it stays where it is
// unless the order changed: taken out and put back, it would hop again.
function winDock() {
  const dock = $("dock");
  if (!dock) return;
  if (typeof mbUpdate === "function") mbUpdate(); // the menu bar's name for the window in front
  const had = new Map([...dock.querySelectorAll(".dock-item.dock-run")].map((n) => [n.dataset.window, n]));
  dock.querySelectorAll(".dock-app:not(.dock-builtin).open").forEach((n) => n.classList.remove("open")); // adlerOS's own: markDockOpen
  if (!desktopMode()) {
    dock.querySelectorAll(".dock-run").forEach((n) => n.remove());
    return sizeDock();
  }
  const running = [];
  for (const id of wm.order) {
    const w = wm.windows.get(id);
    // Its own item in the dock (Files and Terminal only while pinned): that.
    if (!w || !isOpen(id) || (w.dock && dock.querySelector(`[data-dock="${w.dock}"]:not(.dock-run)`))) continue;
    const pinned = w.app && dock.querySelector(`.dock-app[data-app="${CSS.escape(w.app.id)}"]`);
    if (pinned) {
      pinned.classList.add("open");
      if (typeof dockOpened === "function") dockOpened(`win:${id}`, true, pinned);
      continue;
    }
    const kept = had.get(id);
    if (kept) {
      kept.classList.toggle("active", wm.active === id);
      kept.setAttribute("aria-label", w.title);
      kept.querySelector(".dock-label").textContent = w.title;
    }
    running.push(kept || winDockItem(id, w));
  }
  if (typeof dockOpen !== "undefined") for (const id of dockOpen) if (id.startsWith("win:") && !isOpen(id.slice(4))) dockOpen.delete(id);
  // Like a Mac's: after your pinned apps, before the divider (and with no
  // pins, a divider of their own).
  const shown = [...dock.querySelectorAll(".dock-item.dock-run")];
  if (shown.length !== running.length || shown.some((n, i) => n !== running[i])) {
    dock.querySelectorAll(".dock-run").forEach((n) => n.remove());
    if (running.length) {
      const divider = dock.querySelector(".dock-divider:not(.dock-run)");
      if (divider) divider.before(...running);
      else dock.prepend(...running, el("span", { class: "dock-divider dock-run", "aria-hidden": "true" }));
    }
  }
  sizeDock();
  dockRunMotion([...had.values()], running);
}

// The windows' own icons in the dock: a new one grows in from nothing and
// hops; a closed one shrinks away where it was.
function dockRunMotion(before, now) {
  if (!motionOK()) return;
  const dock = $("dock");
  const d = dockDims();
  const grow = { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  for (const item of now) {
    if (before.includes(item)) continue;
    item.animate([{ width: "0px", marginRight: `-${d.gap}px`, opacity: 0, transform: "scale(0.4)" },
      { width: `${d.size}px`, marginRight: "0px", opacity: 1, transform: "none" }], grow);
    setTimeout(() => { if (item.isConnected) bounce(item); }, 260);
  }
  before.forEach((item, i) => {
    if (now.includes(item)) return;
    // Not dock-run any more: the next winDock leaves it to finish going.
    item.classList.add("dock-leaving");
    item.classList.remove("dock-run", "open", "active");
    item.inert = true;
    const next = now[i] || dock.querySelector(".dock-divider");
    if (next?.parentNode === dock) next.before(item); else dock.prepend(item);
    item.animate([{ width: `${d.size}px`, marginRight: "0px", opacity: 1, transform: "none" },
      { width: "0px", marginRight: `-${d.gap}px`, opacity: 0, transform: "scale(0.4)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
    setTimeout(() => item.remove(), 300);
  });
}

function winDockItem(id, w) {
  const icon = w.app ? el("span", { class: "dock-plate" }, plateFor(w.app))
    : el("img", { src: `/static/dock/${w.icon || w.dock || id}.svg`, alt: "", draggable: "false" });
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

// wake: false when a page is about to be handed to Firefox (that starts it).
async function openAppWindow(app, { wake = true } = {}) {
  const id = `app-${app.id}`;
  if (wm.windows.has(id) && isOpen(id)) return toggleWindow(id, () => {});
  const check = await frameCheck(app);
  if (!check.frame) {
    // It won't be shown in a page of ours: in the Firefox app instead.
    if (app.known !== "firefox" && (await openInFirefox(app.url, app.name))) return;
    window.open(app.url, "_blank", "noopener,noreferrer");
    if (check.why) toast(`${app.name} opened in a tab: ${check.why}.`);
    return;
  }
  if (!$(id)) {
    const frame = el("iframe", { class: "app-frame", src: app.url, title: app.name, allow: APP_SANDBOX_ALLOW, referrerpolicy: "no-referrer" });
    // An inactive window's page would swallow the click that should bring it forward.
    const shield = el("div", { class: "app-shield", "aria-hidden": "true" });
    shield.addEventListener("pointerdown", () => raiseWindow(id));
    const tab = () => window.open(app.url, "_blank", "noopener,noreferrer");
    // The Firefox app: its window closed, its browser quits (tabs and all,
    // and the memory comes back); opened, a browser's there.
    const firefox = app.known === "firefox";
    const close = () => {
      closeWindow(id);
      if (firefox) postAction("firefox-quit", {});
    };
    if (firefox && wake) postAction("firefox-wake", {});
    // On the home screen there's no title bar: this head, like the terminal's.
    const head = el("div", { class: "app-head" }, el("span", { class: "app-head-plate" }, plateFor(app)),
      el("span", { class: "app-head-title" }, app.name),
      headButton("Reload", () => reloadAppWindow(id), ["M21 12a9 9 0 1 1-3-6.7L21 8", "M21 3v5h-5"]),
      headButton("Open in a new tab", tab, ["M14 4h6v6", "M20 4 10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"]),
      headButton(`Close ${app.name}`, close, ["M18 6 6 18", "m6 6 12 12"]));
    const sheet = el("section", { id, class: "sheet app-sheet", "aria-label": app.name, hidden: "" },
      el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
      head, frame, shield);
    document.body.insertBefore(sheet, $("modal"));
    registerWindow(id, {
      title: app.name, close, size: [1200, 800], app,
      extras: [
        { kind: "reload", label: "Reload", run: () => reloadAppWindow(id), icon: ["M21 12a9 9 0 1 1-3-6.7L21 8", "M21 3v5h-5"] },
        { kind: "tab", label: "Open in a new tab", run: tab, icon: ["M14 4h6v6", "M20 4 10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"] },
      ],
    });
  }
  openWindow(id);
}

function headButton(label, run, paths) {
  const b = el("button", { type: "button", class: "app-head-button", "aria-label": label, title: label }, svg(paths));
  b.addEventListener("click", run);
  return b;
}

// A page we can't show in a window of our own (an app that refuses, a web
// search): in a new tab of the Firefox app from the store, in its window
// here, Firefox started first if it's stopped. False: no Firefox (or this
// device wants tabs on the home screen); the caller opens a tab instead.
async function openInFirefox(url, name = "it") {
  const firefox = state.apps.find((a) => a.known === "firefox" && a.url);
  if (!firefox || (!desktopMode() && appsInTabs())) return false;
  if (!firefox.up) {
    toast(`Starting Firefox for ${name}…`);
    const { status, body } = await postAction("app-start", { app: firefox.id });
    const started = status === 202 && body ? await waitForJob(body) : null;
    if (started?.status !== "done") return false;
    firefox.up = true;
    delete wm.frames[firefox.id]; // it said no while it was off
  }
  openAppWindow(firefox, { wake: false });
  const { status, body } = await postAction("firefox-url", { url });
  const job = status === 202 && body ? await waitForJob(body) : null;
  if (!job?.result?.ok) toast(`Firefox couldn't open ${name} (${job?.result?.error || job?.error || body?.error || "the helper didn't answer"}).`);
  return true;
}

function reloadAppWindow(id) {
  const frame = $(id)?.querySelector("iframe");
  if (frame) frame.src = frame.src;
}

// ---------------------------------------------------- back and forward

// The mouse's side buttons: back (the one nearer your palm) and forward,
// in the window under the pointer (else the one in front) that has
// somewhere to go back to: My Computer's folders, Settings' categories,
// Luna's notes and folders (registerNav). Never the page itself, which
// would leave adlerOS: the browser's own back is cancelled, and for one
// that goes anyway (or its own back: Alt+Left, its button), adlerOS keeps a
// step of history of its own, and going back from it goes back in the
// window in front instead.
const winNavs = new Map(); // window id → go(-1 back, 1 forward)
const navTrap = { armed: false, at: 0 };

function registerNav(id, go) { winNavs.set(id, go); }

function navWindow(node) {
  const sheet = node?.closest?.(".sheet");
  if (sheet) return winNavs.has(sheet.id) && isOpen(sheet.id) ? sheet.id : null;
  if (wm.active && winNavs.has(wm.active) && isActive(wm.active)) return wm.active;
  return [...winNavs.keys()].find((id) => isActive(id)) || null;
}

function navGo(node, dir) {
  const id = navWindow(node);
  if (id) winNavs.get(id)(dir);
}

const sideButton = (e) => e.button === 3 || e.button === 4;
// The step of history, once you've done something (a browser skips one a
// page made on its own) with a mouse or the keyboard: not on a touch
// screen, where it would give Safari its own back swipe to start, from the
// left edge, in the middle of turning the home screen's pages.
function navArm(e) {
  if (navTrap.armed || !e.isTrusted || (e.pointerType && e.pointerType !== "mouse")) return;
  navTrap.armed = true;
  history.pushState(null, "", location.href);
}
document.addEventListener("pointerdown", navArm, true);
document.addEventListener("keydown", navArm, true);
document.addEventListener("mousedown", (e) => { if (sideButton(e)) e.preventDefault(); }, true);
document.addEventListener("auxclick", (e) => { if (sideButton(e)) e.preventDefault(); }, true);
document.addEventListener("mouseup", (e) => {
  if (!sideButton(e)) return;
  e.preventDefault();
  navTrap.at = Date.now();
  navGo(e.target, e.button === 3 ? -1 : 1);
}, true);
window.addEventListener("popstate", () => {
  navTrap.armed = false; // again at the next thing you do
  if (Date.now() - navTrap.at > 500) navGo(document.activeElement, -1); // not the side button's (that's done)
});

// ---------------------------------------------------------------- wiring

wm.geometry = winLoad(WIN_GEOMETRY_KEY, {}) || {};
setGlass(glassLevel(), false);
setLiquid(liquidLevel(), false);

// Over a window on the home screen the dock is away (app.css): down at the
// bottom edge it comes back, and goes again a moment after the pointer isn't
// on it (never while it is, or while its menu is open).
const dockPeek = { timer: null, over: false };
function dockAwaySoon(ms) {
  clearTimeout(dockPeek.timer);
  dockPeek.timer = setTimeout(function away() {
    if (dockPeek.over || !$("menu").hidden) dockPeek.timer = setTimeout(away, 500);
    else document.body.classList.remove("dock-peek");
  }, ms);
}
const dockEdge = el("div", { class: "dock-edge", "aria-hidden": "true" });
document.body.append(dockEdge);
dockEdge.addEventListener("pointerenter", () => {
  document.body.classList.add("dock-peek");
  dockAwaySoon(smallTouch() ? 3000 : 1500);
});
$("dock").addEventListener("pointerenter", () => { dockPeek.over = true; });
$("dock").addEventListener("pointerleave", () => {
  dockPeek.over = false;
  dockAwaySoon(500);
});
markSmallTouch();
document.body.classList.toggle("land", landPhone());
if (wantDesktop()) document.body.classList.add("wm");
// The screen got narrow (or wide again): off, or back on if you'd chosen it.
NARROW_SCREEN.addEventListener("change", () => {
  if (document.body.classList.contains("tv") || document.body.classList.contains("car")) return;
  document.body.classList.toggle("land", landPhone());
  if (wantDesktop() !== desktopMode()) switchDesktopMode(wantDesktop());
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
  markSmallTouch();
  landSync(); // a phone turned
  if (desktopMode()) {
    winLayout();
    if (landOn()) for (const id of wm.order) if (isOpen(id)) winApply(id); // the room changed
  }
});
markSmallTouch();
TOUCH_ONLY.addEventListener("change", () => { markSmallTouch(); if (desktopMode()) winLayout(); });
