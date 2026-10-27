// Desktop mode's menu bar, Control Center and Notification Center, after a
// Mac's. The bar runs along the top (windows.js keeps them under it,
// MENUBAR_H): on the left adlerOS's menu, the window in front's (its name,
// in bold), Window and Go; on the right Search, Control Center and the
// date and time. One menu open, the pointer over another opens that one.
// Control Center drops down under its icon: tiles for what adlerOS can
// change from here (tiling, admin mode, Do Not Disturb, full screen…), the
// windows' transparency and Music's volume as sliders, what's playing, and
// the machine's load. Notification Center slides in from the right when you
// click the clock (or Alt+N): adlerOS's notifications, one kind's stacked
// (click the stack to open it, Show less to fold it), and your widgets under
// them.
// Uses $, el, svg, api, wm, tiles, desktopMode, setDesktopMode, openMenu,
// closeMenu, winMenu, minimizeWindow, toggleMaximize, winSnap, centerWindow,
// toggleFloating, tilingOn, windowLayout, setWindowLayout, switchWorkspace,
// WS_COUNT, glassLevel, setGlass, toggleSearch, openSettings, openStore,
// openUsage, confirmLogout, powerMenu, settings, state, adminDialog,
// setAdmin, loadSettings, notes, loadNotes, openTarget, NOTE_ICONS, ago,
// widgets, widgetDef, widgetNode, editWidgets, music, muCurrent, muSong,
// muArtists, musicArt, musicToggle, musicNext, musicPrev, musicSaveSoon,
// toggleMusic, isOpen, winLoad, winSave.
"use strict";

const DND_KEY = "adleros.dnd";
const mb = { open: null, nc: { live: [], expanded: new Set() }, clock: null };
function dndOn() { return winLoad(DND_KEY, false) === true; }

const MB_ICONS = {
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  control: ["M4 8h10", "M18 8h2", "M16 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z", "M4 16h2", "M10 16h10", "M8 14a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"],
  tiling: ["M3 4h8v16H3z", "M13 4h8v7h-8z", "M13 13h8v7h-8z"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  desktop: ["M3 4h18v12H3z", "M8 20h8", "M12 16v4"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  full: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
  image: ["M3 5h18v14H3z", "m3 16 5-5 4 4 3-3 6 6", "M15.5 9.5h.01"],
  glass: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 3v18"],
  sound: ["M11 5 6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  play: ["M7 4v16l13-8z"],
  pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"],
  next: ["m5 4 10 8-10 8z", "M19 5v14"],
  prev: ["m19 20-10-8 10-8z", "M5 19V5"],
  chip: ["M6 6h12v12H6z", "M9 2v4", "M15 2v4", "M9 18v4", "M15 18v4", "M2 9h4", "M2 15h4", "M18 9h4", "M18 15h4"],
  close: ["M18 6 6 18", "m6 6 12 12"],
};

// ------------------------------------------------------------- the bar

function mbButton(cls, label, content, run) {
  const b = el("button", { type: "button", class: `mb-item ${cls}`, "aria-label": label, "aria-haspopup": "true" }, ...content);
  b.addEventListener("click", (e) => { e.stopPropagation(); run(b); });
  // A menu of the bar's open: the pointer over another item opens that one.
  b.addEventListener("pointerenter", () => { if (mb.open && mb.open !== b && b.dataset.menu) run(b); });
  return b;
}

function mbBuild() {
  if ($("menubar")) return;
  const bar = el("nav", { id: "menubar", class: "menubar", "aria-label": "Menu bar" },
    el("div", { class: "mb-left" },
      mbButton("mb-logo", "adlerOS", [el("img", { src: "/static/mark.svg", alt: "" })], (b) => mbMenu(b, mbLogoItems())),
      mbButton("mb-app", "The window in front", [el("span", { id: "mb-app-name" }, "adlerOS")], (b) => mbMenu(b, mbAppItems())),
      mbButton("mb-text", "Window", ["Window"], (b) => mbMenu(b, mbWindowItems())),
      mbButton("mb-text", "Go", ["Go"], (b) => mbMenu(b, mbGoItems()))),
    el("div", { class: "mb-right" },
      mbButton("mb-icon", "Search (Alt+Space)", [svg(MB_ICONS.search)], () => { mbCloseAll(); toggleSearch(); }),
      mbButton("mb-icon mb-cc-button", "Control Center", [svg(MB_ICONS.control)], () => ccToggle()),
      mbButton("mb-clock", "Notification Center (Alt+N)", [el("span", { id: "mb-clock" }), el("span", { class: "mb-dot", id: "mb-dot", hidden: "" })], () => ncToggle())));
  for (const b of bar.querySelectorAll(".mb-left .mb-item")) b.dataset.menu = "1";
  document.body.append(bar);
  mbTick();
  mb.clock = setInterval(mbTick, 15000);
  mbUpdate();
}

function mbTick() {
  const now = new Date();
  const day = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const clock = $("mb-clock");
  if (clock) clock.textContent = `${day}  ${time}`;
}

// The name of the window in front (or adlerOS, on the desktop), and the
// dot by the clock for notifications you haven't seen.
function mbUpdate() {
  const name = $("mb-app-name");
  if (!name) return;
  const w = wm.active && wm.windows.get(wm.active);
  name.textContent = w?.title || "adlerOS";
  const unread = notes.items.some((n) => !n.read);
  $("mb-dot").hidden = !unread || ncOpen();
}

// A bar item's menu, under it (and the item lit while it's open).
function mbMenu(button, items) {
  ccClose();
  ncClose();
  if (mb.open === button && !$("menu").hidden) return closeMenu();
  const r = button.getBoundingClientRect();
  openMenu(r.left, MENUBAR_H + 2, items);
  for (const b of document.querySelectorAll(".mb-item.open")) b.classList.remove("open");
  button.classList.add("open");
  mb.open = button;
}

function mbCloseAll() {
  closeMenu();
  ccClose();
  ncClose();
}

function mbLogoItems() {
  const items = [
    { label: "About this machine", run: () => openSettings("device") },
    { label: "Settings…", run: () => openSettings() },
    { label: "App Store…", run: () => openStore() },
    { label: "Live Usage", run: () => openUsage() },
    { label: "Home screen (leave desktop mode)", run: () => setDesktopMode(false) },
    { label: "Log out…", run: confirmLogout },
  ];
  if (state.admin) items.push({ label: "Restart or shut down…", run: () => powerMenu(), destructive: true });
  return items;
}

function mbAppItems() {
  const id = wm.active;
  const w = id && wm.windows.get(id);
  if (!w || !isOpen(id)) {
    return [{ label: "Change wallpaper…", run: () => openSettings("wallpaper") },
      { label: "Edit widgets…", run: () => editWidgets() },
      { label: "Window layout…", run: () => openSettings("tiling") }];
  }
  const items = [];
  if (w.app) items.push({ label: `Open ${w.title} in a new tab`, run: () => window.open(w.app.url, "_blank", "noopener,noreferrer") });
  items.push({ label: `Hide ${w.title}`, run: () => minimizeWindow(id) }, { label: `Close ${w.title}`, run: () => w.close(), destructive: true });
  return items;
}

function mbWindowItems() {
  const id = wm.active;
  if (!id || !isOpen(id)) return [{ label: "No window in front", run: () => {} }];
  // The window's own menu (its title bar's), less what the app menu has.
  return winMenu(id).filter((i) => !/^(Close|Minimize)$/.test(i.label)).concat(
    [{ label: "Minimize", run: () => minimizeWindow(id) }],
    tilingOn() ? [{ label: "Float or tile (Alt+V)", run: () => toggleFloating(id) }] : [{ label: "Center (Alt+C)", run: () => centerWindow(id) }]);
}

function mbGoItems() {
  const items = Array.from({ length: WS_COUNT }, (_, i) => ({
    label: `${i + 1 === tiles.current ? "✓ " : ""}Workspace ${i + 1} (Alt+${(i + 1) % 10})`, run: () => switchWorkspace(i + 1),
  }));
  items.push({ label: "Back to the last one (Alt+D)", run: () => switchWorkspace(tiles.previous) });
  return items;
}

// ------------------------------------------------------ Control Center

function ccOpen() { return Boolean($("cc")) && !$("cc").hidden; }
function ccClose() {
  if (!ccOpen()) return;
  $("cc").hidden = true;
  document.querySelector(".mb-cc-button")?.classList.remove("open");
}
function ccToggle() {
  if (ccOpen()) return ccClose();
  closeMenu();
  ncClose();
  let cc = $("cc");
  if (!cc) {
    cc = el("div", { id: "cc", class: "cc material", role: "dialog", "aria-label": "Control Center", hidden: "" });
    cc.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.append(cc);
  }
  cc.hidden = false;
  document.querySelector(".mb-cc-button")?.classList.add("open");
  ccRender();
  if (!settings.data) loadSettings().then(() => ccOpen() && ccRender()).catch(() => {});
}

// A row in the big tile: a round icon (lit when on), a name, its state.
function ccRow(icon, name, sub, on, run) {
  const b = el("button", { type: "button", class: `cc-row${on ? " on" : ""}`, "aria-pressed": String(on) },
    el("span", { class: "cc-round" }, svg(icon)), el("span", { class: "cc-row-text" }, el("span", { class: "cc-name" }, name), el("span", { class: "cc-sub" }, sub)));
  b.addEventListener("click", run);
  return b;
}
function ccTile(cls, icon, name, on, run, sub = "") {
  const b = el("button", { type: "button", class: `cc-tile ${cls}${on ? " on" : ""}`, "aria-pressed": String(on) },
    el("span", { class: "cc-round" }, svg(icon)), el("span", { class: "cc-row-text" }, el("span", { class: "cc-name" }, name), sub ? el("span", { class: "cc-sub" }, sub) : ""));
  b.addEventListener("click", run);
  return b;
}
function ccSlider(title, icon, value, input, disabled = false) {
  const range = el("input", { type: "range", min: "0", max: "1", step: "0.01", value: String(value), "aria-label": title });
  range.disabled = disabled;
  const paint = () => range.style.setProperty("--done", `${Number(range.value) * 100}%`);
  paint();
  range.addEventListener("input", () => { paint(); input(Number(range.value)); });
  return el("div", { class: "cc-block cc-slider" }, el("span", { class: "cc-label" }, title), el("label", { class: "cc-range" }, svg(icon), range));
}

function ccRender() {
  const cc = $("cc");
  if (!cc || cc.hidden) return;
  const admin = Boolean(state.admin);
  const full = Boolean(document.fullscreenElement);
  const big = el("div", { class: "cc-block cc-big" },
    ccRow(MB_ICONS.tiling, "Tiling", tilingOn() ? "On" : "Off", tilingOn(), () => { setWindowLayout(tilingOn() ? "floating" : "tiling"); ccRender(); }),
    ccRow(MB_ICONS.shield, "Admin mode", admin ? "On" : "Off", admin, async () => {
      if (!admin) { ccClose(); return adminDialog(); }
      await setAdmin(false);
      ccRender();
    }),
    ccRow(MB_ICONS.desktop, "Desktop mode", "On", true, () => { ccClose(); setDesktopMode(false); }));
  const dnd = ccTile("cc-wide", MB_ICONS.moon, "Do Not Disturb", dndOn(), () => { winSave(DND_KEY, !dndOn()); ccRender(); }, dndOn() ? "On: no pop-ups" : "");
  const small = [
    ccTile("cc-small", MB_ICONS.full, full ? "Exit full screen" : "Full screen", full, () => {
      (full ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}).finally(() => setTimeout(ccRender, 200));
    }),
    ccTile("cc-small", MB_ICONS.image, "Wallpaper", false, () => { ccClose(); openSettings("wallpaper"); }),
  ];
  const audio = music.audio;
  const parts = [big, el("div", { class: "cc-side" }, dnd, el("div", { class: "cc-pair" }, ...small)),
    ccSlider("Windows", MB_ICONS.glass, 1 - glassLevel(), (v) => setGlass(Math.round((1 - v) * 100) / 100)),
    ccSlider("Sound", MB_ICONS.sound, audio.muted ? 0 : audio.volume, (v) => { audio.volume = v; audio.muted = false; musicSaveSoon(); }),
    ccNowPlaying(), ccSystem()];
  cc.replaceChildren(...parts);
}

function ccNowPlaying() {
  const id = muCurrent();
  const s = id ? muSong(id) : null;
  const audio = music.audio;
  const button = (label, icon, run) => {
    const b = el("button", { type: "button", class: "cc-media", "aria-label": label }, svg(icon));
    b.addEventListener("click", (e) => { e.stopPropagation(); run(); setTimeout(ccRender, 150); });
    b.disabled = !s;
    return b;
  };
  const art = el("span", { class: "cc-art" }, s ? musicArt(id) : svg(MB_ICONS.sound));
  const text = el("span", { class: "cc-row-text" }, el("span", { class: "cc-name" }, s?.title || "Not playing"), el("span", { class: "cc-sub" }, s ? muArtists(s) : "Music"));
  const block = el("div", { class: "cc-block cc-now" }, art, text,
    el("span", { class: "cc-media-row" }, button("Previous", MB_ICONS.prev, musicPrev), button(audio.paused ? "Play" : "Pause", audio.paused ? MB_ICONS.play : MB_ICONS.pause, musicToggle),
      button("Next", MB_ICONS.next, () => musicNext())));
  for (const n of [art, text]) n.addEventListener("click", () => { ccClose(); toggleMusic(); });
  return block;
}

function ccSystem() {
  const sys = widgets.data?.system || {};
  const stat = (name, value) => el("span", { class: "cc-stat" }, el("span", { class: "cc-stat-value" }, value), el("span", { class: "cc-sub" }, name));
  const mem = sys.memory ? `${Math.round((sys.memory.used / sys.memory.total) * 100)}%` : "–";
  const b = el("button", { type: "button", class: "cc-block cc-system", "aria-label": "Live Usage" },
    el("span", { class: "cc-round" }, svg(MB_ICONS.chip)),
    stat("CPU", sys.cpu == null ? "–" : `${Math.round(sys.cpu)}%`), stat("Memory", mem),
    stat("Temperature", sys.temperature == null ? "–" : `${Math.round(sys.temperature)}°`));
  b.addEventListener("click", () => { ccClose(); openUsage(); });
  return b;
}

// --------------------------------------------------- Notification Center

function ncOpen() { return Boolean($("nc")) && $("nc").classList.contains("shown"); }
function ncClose() {
  const nc = $("nc");
  if (!nc || !ncOpen()) return;
  nc.classList.remove("shown");
  nc.setAttribute("aria-hidden", "true");
  mb.nc.live = [];
  document.querySelector(".mb-clock")?.classList.remove("open");
  mbUpdate();
}
async function ncToggle() {
  if (ncOpen()) return ncClose();
  closeMenu();
  ccClose();
  let nc = $("nc");
  if (!nc) {
    nc = el("aside", { id: "nc", class: "nc", "aria-label": "Notification Center", "aria-hidden": "true" },
      el("div", { class: "nc-notes", id: "nc-notes" }), el("div", { class: "nc-widgets", id: "nc-widgets" }));
    nc.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.append(nc);
  }
  ncRender();
  nc.classList.add("shown");
  nc.removeAttribute("aria-hidden");
  document.querySelector(".mb-clock")?.classList.add("open");
  mbUpdate();
  if (notes.items.some((n) => !n.read)) {
    await api("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: "all" }) }).catch(() => {});
    loadNotes();
  }
}

// adlerOS's kinds of notification, as a Mac groups them by app.
const NC_GROUPS = [
  { name: "Apps", kinds: ["offline", "online"] },
  { name: "Jobs", kinds: ["job-done", "job-failed"] },
  { name: "System", kinds: ["disk", "heat"] },
  { name: "Updates", kinds: ["updates"] },
];

async function ncClear(ids) {
  await api("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: ids }) }).catch(() => {});
  notes.items = notes.items.filter((n) => !ids.includes(n.id));
  ncRender();
  loadNotes();
}

// One notification: click it to open what it's about (or, the top of a
// stack, `open` instead); its × clears it (or `clear`, the stack).
function ncCard(n, { open = null, clear = [n.id] } = {}) {
  const card = el("div", { class: `nc-card ${n.kind}${n.read ? "" : " unread"}`, role: "button", tabindex: "0" },
    el("span", { class: "nc-icon" }, svg(NOTE_ICONS[n.kind] || NOTE_ICONS.online)),
    el("span", { class: "nc-text" }, el("span", { class: "nc-head" }, el("span", { class: "nc-title" }, n.title), el("span", { class: "nc-time" }, ago(n.time))),
      n.body ? el("span", { class: "nc-body" }, n.body) : ""));
  const x = el("button", { type: "button", class: "nc-x", "aria-label": clear.length > 1 ? "Clear all" : "Clear" }, svg(MB_ICONS.close));
  x.addEventListener("click", (e) => { e.stopPropagation(); ncClear(clear); });
  card.prepend(x);
  const go = open || (() => { ncClose(); openTarget(n.open); });
  card.addEventListener("click", go);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  return card;
}

function ncRender() {
  const list = $("nc-notes");
  if (!list) return;
  const sorted = [...notes.items].sort((a, b) => b.time - a.time);
  const groups = NC_GROUPS.map((g) => ({ ...g, items: sorted.filter((n) => g.kinds.includes(n.kind)) }))
    .concat([{ name: "Other", items: sorted.filter((n) => !NC_GROUPS.some((g) => g.kinds.includes(n.kind))) }])
    .filter((g) => g.items.length).sort((a, b) => b.items[0].time - a.items[0].time);
  const parts = [];
  for (const g of groups) {
    const ids = g.items.map((n) => n.id);
    if (g.items.length === 1) { parts.push(ncCard(g.items[0])); continue; }
    if (mb.nc.expanded.has(g.name)) {
      const less = el("button", { type: "button", class: "nc-pill" }, "Show less");
      less.addEventListener("click", () => { mb.nc.expanded.delete(g.name); ncRender(); });
      const all = el("button", { type: "button", class: "nc-pill nc-x-all", "aria-label": `Clear all ${g.name}` }, svg(MB_ICONS.close));
      all.addEventListener("click", () => ncClear(ids));
      parts.push(el("div", { class: "nc-group" }, el("div", { class: "nc-group-head" }, el("span", {}, g.name), less, all), ...g.items.map((n) => ncCard(n))));
    } else {
      // A stack: the newest on top, the edges of the next ones under it.
      const top = ncCard(g.items[0], { open: () => { mb.nc.expanded.add(g.name); ncRender(); }, clear: ids });
      top.append(el("span", { class: "nc-more" }, `${g.items.length - 1} more`));
      parts.push(el("div", { class: `nc-stack${g.items.length > 2 ? " deep" : ""}` }, top));
    }
  }
  if (!parts.length) parts.push(el("p", { class: "nc-empty" }, "No notifications"));
  list.replaceChildren(...parts);
  ncWidgets();
}

function ncWidgets() {
  const box = $("nc-widgets");
  if (!box || !widgets.catalog || !widgets.selected) return;
  mb.nc.live = [];
  const nodes = [];
  for (const id of widgets.selected) {
    const w = widgetDef(id);
    const made = w && widgetNode(w);
    if (!made) continue;
    mb.nc.live.push(made.update);
    nodes.push(made.node);
  }
  const edit = el("button", { type: "button", class: "nc-pill nc-edit" }, "Edit Widgets");
  edit.addEventListener("click", () => { ncClose(); editWidgets(); });
  box.replaceChildren(...nodes, edit);
  if (widgets.data) mb.nc.live.forEach((update) => update(widgets.data));
}

// widgets.js, every few seconds: the open Notification Center's widgets and Control Center's load.
function mbWidgetsUpdate(data) {
  if (ncOpen()) mb.nc.live.forEach((update) => update(data));
  if (ccOpen()) $("cc").querySelector(".cc-system")?.replaceWith(ccSystem());
}

// --------------------------------------------------------------- wiring

document.addEventListener("pointerdown", (e) => {
  if (e.target.closest?.("#menubar, #menu")) return;
  ccClose();
  ncClose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (ccOpen() || ncOpen()) && $("modal").hidden) {
    e.stopImmediatePropagation();
    ccClose();
    ncClose();
  }
}, true);
// The bar's item stays lit only while its menu is open.
new MutationObserver(() => {
  if (!$("menu").hidden) return;
  mb.open = null;
  for (const b of document.querySelectorAll(".mb-left .mb-item.open")) b.classList.remove("open");
}).observe($("menu"), { attributes: true, attributeFilter: ["hidden"] });
for (const type of ["play", "pause", "volumechange", "loadedmetadata"]) music.audio.addEventListener(type, () => ccOpen() && ccRender());
document.addEventListener("fullscreenchange", () => ccOpen() && ccRender());
mbBuild();
