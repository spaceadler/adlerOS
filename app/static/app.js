// adlerOS, the home screen. Layout, paging and dock behaviour follow umbrelOS's
// desktop (packages/ui/src/modules/desktop); the code is our own.
// Everything is built with DOM calls, never innerHTML, so nothing from the
// catalog can inject markup.
"use strict";

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 30000;

// Grid geometry per breakpoint: [phone, larger]. Larger screens follow
// umbrelOS's usePager (6×2 apps a page); a phone follows the iPhone's home
// screen (phone.js, ios.css): four across, as many rows as fit, and square
// widgets two app columns wide.
const GEOMETRY = {
  appW: [70, 120],
  appH: [90, 110],
  appXGap: [10, 30],
  appYGap: [6, 12],
  appsPerRowMax: [4, 6],
  rowsMax: [6, 2],
  paddingX: [20, 32],
  widgetH: [null, 150], // a phone's are square
};
// Widget slots above the apps, each two app columns wide (widgets.js).
const WIDGET_SLOTS = 3;
// The dock: icons grow from `size` to `zoomed` as the pointer comes within 150px.
const DOCK = { desktop: { size: 50, zoomed: 80, pad: 12 }, mobile: { size: 48, zoomed: 60, pad: 8 } };

const state = {
  apps: [],
  name: "",
  searchUrl: "https://duckduckgo.com/?q={QUERY}",
  pageCount: 1,
  page: 0,
  layoutKey: "",
  tiles: new Map(), // app id -> {link, label, plate, warning}
  dock: [], // ids of the apps pinned to the dock, in order
  collections: [], // [{id, name}] from the server, in page order
  order: {}, // collection -> app ids, as you arranged them
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function svg(paths, viewBox = "0 0 24 24") {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  return { status: response.status, body };
}

// ------------------------------------------------------------- wallpaper

// `id` picks a specific wallpaper (and makes a new URL, so no stale cache).
function loadWallpaper(id) {
  const url = id ? `/api/wallpaper?id=${encodeURIComponent(id)}` : "/api/wallpaper";
  const img = new Image();
  img.onload = () => {
    $("wallpaper").style.backgroundImage = `url("${url}")`;
    $("wallpaper").classList.add("loaded");
    // Behind every window too, blurred (Settings, App Store, Live Usage).
    for (const bg of document.querySelectorAll(".sheet-wallpaper")) bg.style.backgroundImage = `url("${url}")`;
  };
  img.src = url;
}

// ------------------------------------------------------------- greeting

// What the desktop says, by the hour. Each part of the day has a few lines;
// which one is picked by the date, so it holds steady all day.
const GREETINGS = {
  night: ["Up late, {name}?", "Still up, {name}?", "Burning the midnight oil, {name}?"], // 22:00-04:59
  morning: ["Good morning, {name}.", "Morning, {name}.", "Rise and shine, {name}."], // 05:00-11:59
  afternoon: ["Good afternoon, {name}.", "Afternoon, {name}."], // 12:00-16:59
  evening: ["Good evening, {name}.", "Evening, {name}."], // 17:00-21:59
};

function greeting(now = new Date()) {
  const hour = now.getHours();
  const part = hour < 5 || hour >= 22 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const lines = GREETINGS[part];
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000); // local date
  const line = lines[day % lines.length];
  const first = state.name.split(/\s+/)[0];
  // Without a name: "Good morning." / "Up late?"
  return first ? line.replace("{name}", first) : line.replace(/, \{name\}/, "");
}

// ------------------------------------------------------------- app tiles

// A stable colour per app, for apps without an icon.
function hue(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || "?").slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

function monogram(plate, app) {
  plate.classList.add("mono");
  const h = hue(app.id);
  plate.style.background = `linear-gradient(160deg, hsl(${h} 72% 60%), hsl(${(h + 35) % 360} 68% 42%))`;
  plate.replaceChildren(initials(app.name));
}

function plateFor(app) {
  const plate = el("span", { class: "plate" });
  if (app.hasIcon) {
    const src = `/api/icon/${encodeURIComponent(app.id)}?v=${encodeURIComponent(app.icon || "")}`;
    const img = el("img", { src, alt: "", draggable: "false" });
    img.addEventListener("error", () => monogram(plate, app));
    plate.append(img);
  } else {
    monogram(plate, app);
  }
  return plate;
}

function tile(app, index) {
  const plate = plateFor(app);
  const warning = el("span", { class: "warning", hidden: "" },
    svg(["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"]));
  const label = el("span", { class: "app-label" }, app.name);
  const link = el("a", {
    class: "app",
    href: app.url || "#store",
    target: "_blank",
    rel: "noopener noreferrer",
    title: app.about,
    draggable: "false",
    "data-app": app.id,
  }, el("span", { class: "app-icon" }, plate, warning), label);
  if (!app.url) {
    link.removeAttribute("target");
    link.addEventListener("click", (e) => { e.preventDefault(); openApp(app); });
  }
  link.style.animationDelay = `${index * 10}ms`;
  // Once only: dragging a tile moves it in the page, which would replay it.
  link.addEventListener("animationend", () => { link.style.animation = "none"; }, { once: true });
  state.tiles.set(app.id, { link, label, plate, warning, app });
  setStatus(app);
  return link;
}

function setStatus(app) {
  const t = state.tiles.get(app.id);
  if (!t) return;
  t.app = app;
  t.link.classList.toggle("offline", !app.up);
  t.warning.hidden = app.up;
  // Like umbrelOS, an app that doesn't answer says so in place of its name.
  t.label.textContent = app.up ? app.name : "Offline";
  t.link.setAttribute("aria-label", app.up ? app.name : `${app.name} (offline)`);
}

// ------------------------------------------------------------- paged grid

function geometry() {
  const i = window.innerWidth >= 640 ? 1 : 0;
  const g = Object.fromEntries(Object.entries(GEOMETRY).map(([k, v]) => [k, v[i]]));
  g.appsMaxW = (g.appW + g.appXGap) * g.appsPerRowMax - g.appXGap + g.paddingX * 2;
  g.widgetW = g.appW * 2 + g.appXGap;
  g.widgetH ??= g.widgetW;
  return g;
}

function layout(force = false) {
  const area = $("grid-area");
  const stage = $("stage");
  if ($("desktop").hidden || !stage.clientHeight) return;
  const g = geometry();
  const root = document.documentElement.style;
  root.setProperty("--app-w", `${g.appW}px`);
  root.setProperty("--app-h", `${g.appH}px`);
  root.setProperty("--app-x-gap", `${g.appXGap}px`);
  root.setProperty("--app-y-gap", `${g.appYGap}px`);
  root.setProperty("--apps-padding-x", `${g.paddingX}px`);
  root.setProperty("--apps-max-w", `${g.appsMaxW}px`);
  root.setProperty("--widget-w", `${g.widgetW}px`);
  root.setProperty("--widget-h", `${g.widgetH}px`);

  const pageW = Math.min(stage.clientWidth, g.appsMaxW) - g.paddingX * 2;
  root.setProperty("--page-w", `${pageW}px`);
  const perRow = Math.max(1, Math.floor((pageW + g.appXGap) / (g.appW + g.appXGap)));

  // Rows that fit under the widgets, capped at rowsMax. Short screens drop
  // the widgets before they drop to a single row of apps.
  // The collection title takes the place of the page's 8px top padding.
  // A phone's page dots sit over the dock (phone.js), not under the apps.
  const pillsH = (phoneLayout() ? 0 : 32) + PAGE_TITLE_H - 8;
  const rowsIn = (h) => Math.floor((h - 8 + g.appYGap) / (g.appH + g.appYGap));
  const stageH = stage.clientHeight - parseFloat(getComputedStyle(stage).paddingTop);
  const widgetsH = g.widgetH + 8 + 20 + 20; // panel, gap, label, margin
  // The web search bar: a quarter of a widget tall (but tappable on phones).
  const searchH = Math.max(38, Math.round(g.widgetH / 4));
  const searchBlockH = searchH + 18;
  const showWidgets = rowsIn(stageH - pillsH - searchBlockH - widgetsH) >= Math.min(2, g.rowsMax);
  const perCol = Math.max(1, Math.min(g.rowsMax, rowsIn(stageH - pillsH - searchBlockH - (showWidgets ? widgetsH : 0))));
  const widgetsFit = Math.max(1, Math.floor((pageW + g.appXGap) / (g.widgetW + g.appXGap)));
  const widgetCols = Math.min(widgetsFit, WIDGET_SLOTS);
  drawWidgets(showWidgets ? widgetCols : 0);
  // As wide as the widget row (or the app grid, when the widgets don't fit).
  const searchW = showWidgets ? widgetCols * g.widgetW + (widgetCols - 1) * g.appXGap
    : perRow * g.appW + (perRow - 1) * g.appXGap;
  root.setProperty("--web-search-w", `${searchW}px`);
  root.setProperty("--web-search-h", `${searchH}px`);
  area.style.height = `${PAGE_TITLE_H + perCol * g.appH + (perCol - 1) * g.appYGap}px`;

  const groups = groupApps();
  state.grid = { perRow, perCol };
  const key = gridKey(groups);
  if (!force && key === state.layoutKey) return;
  state.layoutKey = key;
  draw(groups, perRow, perRow * perCol);
}

function gridKey(groups) {
  const { perRow, perCol } = state.grid || {};
  return `${perRow}x${perCol}:${groups.map((c) => `${c.id}=${c.apps.map((a) => a.id).join(",")}`).join("|")}`;
}

// ------------------------------------------------------------ collections

// Each collection is its own page (or pages, past 12 apps), titled; apps in
// none are under Extras, last. Within one, apps go in the order you dragged
// them into, then alphabetically.
const PAGE_TITLE_H = 18;

function groupApps() {
  const known = new Set(state.collections.map((c) => c.id));
  return state.collections.map((c) => {
    const saved = state.order[c.id] || [];
    const rank = (a) => {
      const i = saved.indexOf(a.id);
      return i < 0 ? Infinity : i;
    };
    const apps = state.apps.filter((a) => a.genre === c.id || (c.id === "extras" && !known.has(a.genre)))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { ...c, apps };
  }).filter((c) => c.apps.length);
}

function draw(groups, perRow, perPage) {
  const pages = $("pages");
  state.tiles = new Map();
  pages.replaceChildren();
  if (!groups.length) {
    pages.append(el("div", { class: "page" }, el("div", { class: "page-inner" },
      el("p", { class: "empty" }, "No apps yet. Run ", el("code", {}, "./install.sh"), " to add some."))));
    setPageCount([""]);
    return;
  }
  let index = 0;
  const titles = [];
  for (const c of groups) {
    for (let start = 0; start < c.apps.length; start += perPage) {
      const slice = c.apps.slice(start, start + perPage);
      const grid = el("div", { class: "app-grid", "data-collection": c.id, "data-start": String(start) },
        ...slice.map((app) => tile(app, index++)));
      // A short collection sits centred, like a folder; a full one fills the row.
      grid.style.gridTemplateColumns = `repeat(${Math.min(perRow, slice.length)}, var(--app-w))`;
      pages.append(el("div", { class: "page" }, el("div", { class: "page-inner" },
        el("h2", { class: "page-title" }, c.name), grid)));
      titles.push(c.name);
    }
  }
  setPageCount(titles);
  goToPage(Math.min(state.page, state.pageCount - 1), false);
}

// One pill per page, named after its collection.
function setPageCount(titles) {
  state.pageTitles = titles;
  const count = titles.length;
  state.pageCount = count;
  const pills = $("pills");
  pills.replaceChildren();
  for (let i = 0; i < count; i++) {
    const name = titles[i] || `Page ${i + 1}`;
    const pill = el("button", { class: "pill", type: "button", role: "tab", "aria-label": name, title: name }, el("span"));
    pill.addEventListener("click", () => goToPage(i));
    pills.append(pill);
  }
  pills.classList.toggle("single", count <= 1);
  $("grid-area").classList.toggle("arrows", count > 1 && window.innerWidth >= 1024);
  updatePager();
}

function goToPage(index, smooth = true) {
  const pages = $("pages");
  state.page = Math.max(0, Math.min(index, state.pageCount - 1));
  pages.scrollTo({ left: state.page * pages.clientWidth, behavior: smooth ? "smooth" : "instant" });
  updatePager();
}

function updatePager() {
  [...$("pills").children].forEach((pill, i) => pill.setAttribute("aria-selected", String(i === state.page)));
  $("prev").disabled = state.page <= 0;
  $("next").disabled = state.page >= state.pageCount - 1;
}

let scrollIdle = null;
function onPagesScroll() {
  const pages = $("pages");
  pages.classList.add("scrolling");
  clearTimeout(scrollIdle);
  scrollIdle = setTimeout(() => pages.classList.remove("scrolling"), 160);
  const index = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
  if (index !== state.page) {
    state.page = index;
    updatePager();
  }
}

// ------------------------------------------------------------------- dock

// The helper's systemd unit: its name differs between the two kinds of install.
function helperUnit() { return state.mode === "standalone" ? "adleros-agent.path" : "homelab-agent.path"; }

function appById(id) {
  return state.apps.find((a) => a.id === id);
}

// The dock: apps you pin, a divider, then the homelab's own items, which
// always stay. Their icons come from /api/dock-icon, so ./icons can replace them.
// Clicking one whose window is open closes it again.
const DOCK_FIXED = [
  { id: "app-drawer", label: "All apps", run: () => toggleDrawer() },
  { id: "app-store", label: "App Store", run: () => toggleStore() },
  { id: "settings", label: "Settings", run: () => toggleWindow("settings", () => openSettings()) },
  { id: "live-usage", label: "Live Usage", run: () => toggleUsage() },
];
const DOCK_MAX_PINS = 12;
const PHONE_DOCK = 4;

// Phones in portrait get the iPhone-style layout (phone.js, ios.css).
function phoneLayout() { return document.body.classList.contains("phone"); }

function bounce(item) {
  item.classList.remove("bounce");
  void item.offsetWidth;
  item.classList.add("bounce");
}

function fixedDockItem(item) {
  const src = `/api/dock-icon/${item.id}`;
  const button = el("button", { class: `dock-item${item.soon ? " soon" : ""}`, type: "button",
    "aria-label": item.label, "data-dock": item.id },
  el("img", { class: "glow", src, alt: "", draggable: "false" }),
  el("img", { src, alt: "", draggable: "false" }),
  el("span", { class: "dock-label material" }, item.label));
  button.addEventListener("click", () => {
    bounce(button);
    if (item.run) item.run();
    else toast(item.soon);
  });
  return button;
}

function pinnedDockItem(app) {
  const link = el("a", { class: `dock-item dock-app${app.up ? "" : " offline"}`, href: app.url || "#store", target: "_blank",
    rel: "noopener noreferrer", draggable: "false", "data-app": app.id,
    "aria-label": app.up ? app.name : `${app.name} (offline)` },
  el("span", { class: "dock-plate" }, plateFor(app)),
  el("span", { class: "dock-label material" }, app.up ? app.name : `${app.name} · Offline`));
  link.addEventListener("click", (e) => {
    bounce(link);
    if (!app.url || (desktopMode() && !(e.ctrlKey || e.metaKey || e.shiftKey))) {
      e.preventDefault();
      openApp(app);
    }
  });
  return link;
}

let dockKey = null;
const dockKeyFor = (pinned) => pinned.map((a) => `${a.id}:${a.icon}:${a.up}`).join(",");
function buildDock() {
  let pinned = state.dock.map(appById).filter(Boolean);
  let fixed = DOCK_FIXED;
  // A phone's dock holds four, like an iPhone's: your pins first, then
  // adlerOS's own (all of them are in the App Library too).
  if (phoneLayout()) {
    pinned = pinned.slice(0, PHONE_DOCK);
    fixed = DOCK_FIXED.slice(0, PHONE_DOCK - pinned.length);
  }
  // Rebuilt only when the pins, their icons or their status change.
  const key = `${dockKeyFor(pinned)}|${fixed.length}`;
  if (key === dockKey) return;
  dockKey = key;
  $("dock").replaceChildren(...pinned.map(pinnedDockItem),
    ...(pinned.length && fixed.length && !phoneLayout() ? [el("span", { class: "dock-divider", "aria-hidden": "true" })] : []),
    ...fixed.map(fixedDockItem));
  markDockOpen("settings", isOpen("settings"));
  markDockOpen("app-store", isOpen("store"));
  markDockOpen("live-usage", isOpen("usage"));
  markDockOpen("app-drawer", drawerOpen());
  winDock();
}

function isPinned(id) { return state.dock.includes(id); }

async function setPinned(id, pinned) {
  const next = pinned ? [...state.dock.filter((a) => a !== id), id] : state.dock.filter((a) => a !== id);
  if (next.length > DOCK_MAX_PINS) return toast(`The dock holds up to ${DOCK_MAX_PINS} apps.`);
  let result;
  try {
    result = await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dock: next }),
    });
  } catch {
    return toast("Can't reach your homelab right now.");
  }
  if (result.status === 401) return showLock();
  if (result.status !== 200) return toast(result.body?.error || "Couldn't change the dock.");
  state.dock = next;
  buildDock();
  if (!$("settings").hidden) renderSide();
}

function dockDims() {
  // A phone's: four icons, the size of the apps above them, no magnifying.
  if (phoneLayout()) return { size: 60, zoomed: 60, pad: 14, gap: 0 };
  const base = window.innerWidth < 768 ? DOCK.mobile : DOCK.desktop;
  // Many pins on a narrow screen: shrink every icon so the dock still fits.
  const items = $("dock").querySelectorAll(".dock-item").length;
  const gap = window.innerWidth < 768 ? 8 : 10;
  const divider = $("dock").querySelector(".dock-divider") ? 5 + gap : 0;
  const room = window.innerWidth - 16 - 24 - divider - gap * Math.max(0, items - 1);
  const size = Math.max(24, Math.min(base.size, Math.floor(room / Math.max(1, items))));
  return { size, zoomed: size + (base.zoomed - base.size) * (size / base.size), pad: base.pad, gap };
}

function sizeDock() {
  const d = dockDims();
  const root = document.documentElement.style;
  root.setProperty("--dock-h", `${d.size + d.pad * 2}px`);
  root.setProperty("--dock-pad", `${d.pad}px`);
  root.setProperty("--dock-base", `${d.size}px`);
  $("dock").style.gap = `${d.gap}px`;
  for (const item of $("dock").querySelectorAll(".dock-item")) item.style.setProperty("--size", `${d.size}px`);
}

// macOS-style magnification: each icon grows with the pointer's closeness.
function magnify(event) {
  if (event.pointerType !== "mouse" || phoneLayout()) return;
  const d = dockDims();
  for (const item of $("dock").querySelectorAll(".dock-item")) {
    const rect = item.getBoundingClientRect();
    const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
    const t = Math.max(0, 1 - distance / 150);
    item.style.setProperty("--size", `${d.size + (d.zoomed - d.size) * t}px`);
  }
}

// ------------------------------------------------------- toast and menus

let toastTimer = null;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// A context menu of {label, run, destructive} items at the pointer.
let menuOpener = null; // focus goes back here when the menu closes
function openMenu(x, y, items) {
  const menu = $("menu");
  if (menu.hidden) menuOpener = document.activeElement !== document.body ? document.activeElement : null;
  menu.replaceChildren(...items.map((item) => {
    const button = el("button", { type: "button", role: "menuitem", class: item.destructive ? "destructive" : "" }, item.label);
    button.addEventListener("click", () => { closeMenu(); item.run(); });
    return button;
  }));
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
  menu.querySelector("button").focus();
}
function closeMenu() {
  const menu = $("menu");
  if (menu.hidden) return;
  const hadFocus = menu.contains(document.activeElement);
  menu.hidden = true;
  if (hadFocus && menuOpener?.isConnected) menuOpener.focus({ preventScroll: true });
}

// An app with no web page (a game server, a bot) opens its App Store card.
function openApp(app) {
  if (!app.url) {
    toast(`${app.name} has no web page; here it is in the App Store.`);
    return openStore();
  }
  if (desktopMode()) return openAppWindow(app);
  window.open(app.url, "_blank", "noopener,noreferrer");
}

// What a right-click (or a long press) on `target` offers.
function menuFor(target) {
  if (desktopMode() && target.closest("#desktop") && !target.closest("[data-app]")) return deskMenu(target);
  const appId = target.closest("[data-app]")?.dataset.app;
  const app = appId && appById(appId);
  const arrange = { label: "Rearrange apps", run: startArranging };
  if (app) {
    return [{ label: "Open", run: () => openApp(app) },
      isPinned(app.id)
        ? { label: "Remove from Dock", run: () => setPinned(app.id, false) }
        : { label: "Keep in Dock", run: () => setPinned(app.id, true) },
      { label: app.genre === "extras" ? "Put in a collection…" : "Move to another collection…", run: () => collectionDialog(app) },
      arrange];
  }
  const fixed = DOCK_FIXED.find((item) => item.id === target.closest("[data-dock]")?.dataset.dock);
  if (fixed) return [{ label: "Open", run: () => (fixed.run ? fixed.run() : toast(fixed.soon)) }];
  if (target.closest("#dock")) return null;
  const widget = target.closest("[data-widget]")?.dataset.widget;
  if (widget) {
    return [{ label: "Edit widgets", run: editWidgets },
      { label: "Remove widget", run: () => removeWidget(widget), destructive: true }];
  }
  return [{ label: "Edit widgets", run: editWidgets },
    arrange,
    // Desktop mode's own menu (desk.js) has the way back.
    ...(computerScreen() ? [{ label: "Desktop mode", run: () => setDesktopMode(true) }] : []),
    { label: "Change wallpaper", run: () => openSettings("wallpaper") },
    { label: "Log out", run: confirmLogout, destructive: true }];
}

function onContextMenu(event) {
  // Typing somewhere keeps the browser's own menu (paste, spelling).
  if (event.target.closest("input, textarea")) return;
  event.preventDefault();
  const items = menuFor(event.target);
  if (items) openMenu(event.clientX, event.clientY, items);
}

// Touch screens without a contextmenu event (iOS) get the menu on a long press.
let pressTimer = null;
let pressStart = null;
let pressed = false;
function onPressStart(event) {
  pressed = false;
  if (event.pointerType !== "touch" || event.target.closest("input, textarea") || arranging()) return;
  pressStart = { x: event.clientX, y: event.clientY, target: event.target };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    const items = menuFor(pressStart.target);
    if (!items) return;
    pressed = true;
    navigator.vibrate?.(8); // a tap you feel, where the phone can
    openMenu(pressStart.x, pressStart.y, items);
  }, 550);
}
function onPressMove(event) {
  if (pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10) clearTimeout(pressTimer);
}
function onPressEnd() { clearTimeout(pressTimer); }
// The click that ends a long press shouldn't also open the app.
function onPressClick(event) {
  if (!pressed) return;
  pressed = false;
  event.preventDefault();
  event.stopPropagation();
}

function confirmLogout() {
  $("confirm").hidden = false;
  $("confirm-ok").focus();
}

// -------------------------------------------------------------- rearrange

// Drag an app to a new place in its collection's page, or a pinned app along
// the dock. With a mouse, just drag. On a touch screen, "Rearrange apps"
// (long-press menu) makes the icons wiggle; drag them, then tap Done.
const drag = { item: null, active: false, suppressClick: false };

function arranging() { return document.body.classList.contains("arranging"); }

function startArranging() {
  document.body.classList.add("arranging");
  $("arrange-done").hidden = false;
}
function stopArranging() {
  document.body.classList.remove("arranging");
  $("arrange-done").hidden = true;
}

function sortable(target) {
  const pin = target.closest("#dock .dock-app");
  if (pin) return { item: pin, container: $("dock"), selector: ".dock-app", kind: "dock" };
  const app = target.closest("#pages .app");
  if (app) return { item: app, container: app.parentElement, selector: ".app", kind: "grid" };
  return null;
}

function onSortDown(e) {
  if (e.button !== 0 || (e.pointerType !== "mouse" && !arranging())) return;
  const found = sortable(e.target);
  if (!found) return;
  Object.assign(drag, found, { active: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
    from: found.container.dataset.collection, crossed: false, edge: 0 });
}

function onSortMove(e) {
  if (!drag.item || e.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    beginDrag(e);
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX - drag.offX}px, ${e.clientY - drag.offY}px) scale(1.08)`;
  const over = [...drag.container.querySelectorAll(drag.selector)].find((it) => {
    if (it === drag.item) return false;
    const r = it.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (over) moveBefore(over);
  if (drag.kind === "grid") edgeTurn(e);
}

// Collections are folders: drag an app to the left or right edge and the
// page turns; drop it on another collection's page to move it there.
function edgeTurn(e) {
  const r = $("grid-area").getBoundingClientRect();
  const dir = e.clientX < r.left + 48 ? -1 : e.clientX > r.right - 48 ? 1 : 0;
  if (dir === drag.edge) return;
  clearTimeout(drag.edgeTimer);
  drag.edge = dir;
  if (dir) drag.edgeTimer = setTimeout(() => turnWhileDragging(dir), 550);
}

function turnWhileDragging(dir) {
  const page = $("pages").children[state.page + dir];
  drag.edge = 0; // still at the edge: the next move turns again
  if (!drag.active || !page) return;
  goToPage(state.page + dir);
  const grid = page.querySelector(".app-grid");
  if (grid && grid !== drag.container) {
    grid.append(drag.item);
    drag.container = grid;
    drag.crossed = true;
  }
}

// Dropped on another page: that collection's new order (and, if it's not
// where the app was, the app's new collection), from what's on screen.
async function dropAcrossPages(appId, collection) {
  const order = [...document.querySelectorAll(`#pages .app-grid[data-collection="${CSS.escape(collection)}"] .app`)].map((a) => a.dataset.app);
  const app = appById(appId);
  await placeApp(app, collection === drag.from ? undefined : collection, order);
}

function beginDrag(e) {
  drag.active = true;
  clearTimeout(pressTimer);
  closeMenu();
  const rect = drag.item.getBoundingClientRect();
  drag.offX = e.clientX - rect.left;
  drag.offY = e.clientY - rect.top;
  drag.ghost = drag.item.cloneNode(true);
  drag.ghost.classList.add("drag-ghost");
  drag.ghost.removeAttribute("href");
  drag.ghost.style.width = `${rect.width}px`;
  drag.ghost.style.height = `${rect.height}px`;
  document.body.append(drag.ghost);
  drag.item.classList.add("drag-source");
  document.body.classList.add("dragging");
  try { drag.item.setPointerCapture(e.pointerId); } catch { /* not supported */ }
}

// Moves the dragged item to `over`'s place; the others slide over (FLIP).
function moveBefore(over) {
  const items = [...drag.container.querySelectorAll(drag.selector)];
  const from = items.indexOf(drag.item);
  const to = items.indexOf(over);
  const before = new Map(items.map((it) => [it, it.getBoundingClientRect()]));
  drag.container.insertBefore(drag.item, to > from ? over.nextSibling : over);
  for (const it of items) {
    if (it === drag.item) continue;
    const a = before.get(it);
    const b = it.getBoundingClientRect();
    if (a.left !== b.left || a.top !== b.top) {
      it.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }],
        { duration: 180, easing: "ease-out" });
    }
  }
}

function onSortUp(e) {
  if (!drag.item || e.pointerId !== drag.pointerId) return;
  if (drag.active) {
    drag.ghost.remove();
    drag.item.classList.remove("drag-source");
    document.body.classList.remove("dragging");
    // The click this pointerup is about to make shouldn't open the app.
    drag.suppressClick = true;
    setTimeout(() => { drag.suppressClick = false; }, 0);
    clearTimeout(drag.edgeTimer);
    if (drag.kind === "grid" && drag.crossed) dropAcrossPages(drag.item.dataset.app, drag.container.dataset.collection);
    else saveArrangement(drag.kind, drag.container);
  }
  drag.item = null;
  drag.active = false;
}

function onSortClick(e) {
  if (drag.suppressClick || (arranging() && e.target.closest("#pages .app, #dock .dock-app"))) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// Puts an app in another collection (null: back in its own), optionally with
// that collection's new order; then shows it there.
async function placeApp(app, collection, order) {
  if (!app) return;
  // The order belongs to where it ends up: where it is now, a new collection,
  // or (null) its own again.
  const lands = collection === undefined ? app.genre : collection ?? app.home ?? app.genre;
  const body = {
    ...(collection !== undefined ? { place: { app: app.id, collection } } : {}),
    ...(order ? { order: { [lands]: order } } : {}),
  };
  const { status, body: reply } = await api("/api/settings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) {
    toast(reply?.error || "Couldn't move it.");
    return layout(true);
  }
  await refresh();
  const moved = appById(app.id);
  const where = (state.choices || []).find((c) => c.id === moved?.genre)?.name;
  if (collection !== undefined && where) toast(`${app.name} is in ${where} now.`);
  const page = state.pageTitles?.indexOf(where);
  if (page >= 0) goToPage(page);
}

function collectionDialog(app) {
  const here = app.genre;
  const choices = (state.choices || []).map((c) => {
    const b = el("button", { type: "button", class: `chip-button collection-choice${c.id === here ? " current" : ""}` },
      c.name, c.id === here ? el("span", { class: "faint" }, " · here") : "");
    b.disabled = c.id === here;
    b.addEventListener("click", () => { closeModal(); placeApp(app, c.id); });
    return b;
  });
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  const actions = [cancel];
  if (app.home) {
    const home = (state.choices || []).find((c) => c.id === app.home)?.name || app.home;
    const back = el("button", { type: "button", class: "button-secondary" }, `Back to ${home}`);
    back.addEventListener("click", () => { closeModal(); placeApp(app, null); });
    actions.push(back);
  }
  openModal(el("div", { class: "dialog material", role: "dialog", "aria-modal": "true", "aria-label": `Move ${app.name}` },
    el("h2", {}, app.genre === "extras" ? `Put ${app.name} in a collection` : `Move ${app.name} to…`),
    el("p", { class: "dialog-text" }, "Like moving it to another folder: only where adlerOS shows it changes. You can also drag it to the edge of the page, onto another collection."),
    el("div", { class: "collection-choices" }, ...choices),
    el("div", { class: "dialog-actions" }, ...actions)));
  (choices.find((b) => !b.disabled) || cancel).focus();
}

async function saveArrangement(kind, container) {
  let body;
  if (kind === "dock") {
    const ids = [...container.querySelectorAll(".dock-app")].map((a) => a.dataset.app);
    if (ids.join() === state.dock.join()) return;
    body = { dock: ids };
  } else {
    const collection = container.dataset.collection;
    const start = Number(container.dataset.start) || 0;
    const page = [...container.querySelectorAll(".app")].map((a) => a.dataset.app);
    const all = (groupApps().find((c) => c.id === collection)?.apps || []).map((a) => a.id);
    const next = [...all];
    next.splice(start, page.length, ...page);
    if (next.join() === all.join()) return;
    body = { order: { [collection]: next } };
  }
  const { status, body: reply } = await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) {
    toast(reply?.error || "Couldn't save the new arrangement.");
    dockKey = null;
    buildDock();
    return layout(true);
  }
  // The page already shows the new order: record it without redrawing.
  if (body.dock) {
    state.dock = body.dock;
    dockKey = dockKeyFor(state.dock.map(appById).filter(Boolean));
  } else {
    Object.assign(state.order, body.order);
    state.layoutKey = gridKey(groupApps());
  }
  if (!$("settings").hidden) renderSide();
}

// ----------------------------------------------------------------- search

const ACTIONS = [
  { id: "settings", name: "Settings", keywords: "settings preferences options configure" },
  { id: "store", name: "App Store", keywords: "app store apps containers docker start stop restart delete install import manage" },
  { id: "usage", name: "Live Usage", keywords: "live usage cpu memory ram storage disk temperature stats monitor" },
  { id: "drawer", name: "All apps", keywords: "all apps drawer launchpad list every app alphabetical" },
  { id: "terminal", name: "Terminal", keywords: "terminal shell console ssh bash command line admin" },
  { id: "files", name: "Files", keywords: "files folders storage documents upload download editor text edit trash desktop mailbox root" },
  { id: "desktop-mode", name: "Desktop mode or home screen", keywords: "desktop mode windows window manager floating side by side home screen switch" },
  { id: "welcome", name: "Welcome tour", keywords: "welcome tour intro introduction start first help guide find apps compose folders" },
  { id: "logout", name: "Log out", keywords: "log out sign out lock exit" },
];
let results = [];
let selected = 0;

function openSearch() {
  if ($("desktop").hidden) return;
  $("search").hidden = false;
  $("search-input").value = "";
  renderResults();
  $("search-input").focus();
}
function closeSearch() { $("search").hidden = true; }

function renderResults() {
  const q = $("search-input").value.trim().toLowerCase();
  const apps = state.apps.filter((a) => !q || a.name.toLowerCase().includes(q) || a.about.toLowerCase().includes(q));
  const actions = q ? ACTIONS.filter((a) => (a.name.toLowerCase().includes(q) || a.keywords.includes(q))
    && (a.id !== "desktop-mode" || computerScreen())) : [];
  results = [...apps.slice(0, 8).map((app) => ({ type: "app", app })), ...settingsSearchResults(q),
    ...actions.map((action) => ({ type: "action", action })),
    // Last: the web, for anything else (a phone has no search bar of its own).
    ...(q ? [{ type: "web", query: $("search-input").value.trim() }] : [])];
  selected = 0;
  const list = $("search-results");
  list.replaceChildren(...results.map((r, i) => {
    // Settings rows and the Settings / App Store actions wear their dock icons.
    const glyph = r.type === "setting" ? "settings"
      : { settings: "settings", store: "app-store", usage: "live-usage", drawer: "app-drawer" }[r.action?.id] || null;
    const icon = r.type === "app"
      ? el("span", { class: "result-icon" }, plateFor(r.app))
      : r.type === "web"
        ? el("span", { class: "result-icon action web" }, svg(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"]))
      : glyph
        ? el("span", { class: "result-icon dock-glyph" }, el("img", { src: `/api/dock-icon/${glyph}`, alt: "" }))
        : el("span", { class: "result-icon action" }, svg(r.action?.id === "terminal" ? ["m4 17 6-6-6-6", "M12 19h8"]
          : r.action?.id === "files" ? ["M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]
          : ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"]));
    const name = r.type === "app" ? r.app.name : r.type === "setting" ? r.row.title
      : r.type === "web" ? `Search the web for “${r.query}”` : r.action.name;
    const hint = r.type === "app" ? (r.app.up ? "Open" : "Offline") : r.type === "setting" ? "Settings"
      : r.type === "web" ? "Web" : "Action";
    const li = el("li", { role: "option", id: `result-${i}` }, icon, el("span", {}, name), el("span", { class: "hint" }, hint));
    li.addEventListener("pointermove", () => select(i));
    li.addEventListener("click", () => runResult(i));
    return li;
  }));
  select(0);
}

function select(i) {
  selected = i;
  [...$("search-results").children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
  $("search-input").setAttribute("aria-activedescendant", results.length ? `result-${i}` : "");
}

function runResult(i) {
  const r = results[i];
  if (!r) return;
  closeSearch();
  if (r.type === "app") openApp(r.app);
  else if (r.type === "setting") openSettings(r.row.id);
  else if (r.type === "web") window.open(state.searchUrl.replaceAll("{QUERY}", encodeURIComponent(r.query)), "_blank", "noopener,noreferrer");
  else if (r.action.id === "settings") openSettings();
  else if (r.action.id === "store") openStore();
  else if (r.action.id === "usage") openUsage();
  else if (r.action.id === "drawer") openDrawer();
  else if (r.action.id === "terminal") openTerminal();
  else if (r.action.id === "files") openFiles();
  else if (r.action.id === "desktop-mode") setDesktopMode(!desktopMode());
  else if (r.action.id === "welcome") openWelcome();
  else if (r.action.id === "logout") confirmLogout();
}

// ------------------------------------------------------------- lock/unlock

function showLock() {
  stopRefresh();
  stopWidgets();
  stopNotes();
  stopArranging();
  closeSearch();
  closeMenu();
  closeModal();
  closeSettings();
  closeStore();
  closeUsage();
  closeDrawer();
  closeTerminal();
  files.editor = null; // logging out: no "unsaved changes" question
  closeFiles();
  for (const [id, w] of wm.windows) if (w.app && isOpen(id)) w.close();
  $("confirm").hidden = true;
  $("desktop").hidden = true;
  $("dock").hidden = true;
  $("lock").hidden = false;
  $("wallpaper").classList.add("blurred");
  $("veil").classList.add("on");
  $("password").value = "";
  $("password").focus();
}

async function unlock(event) {
  event.preventDefault();
  const form = $("login");
  const button = form.querySelector("button");
  const error = $("login-error");
  const input = $("password");
  error.textContent = "";
  input.classList.remove("invalid");
  button.disabled = true;
  try {
    const { status, body } = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: input.value }),
    });
    if (status === 200) return showDesktop();
    if (status === 429) {
      const minutes = Math.ceil((body?.retryAfter || 60) / 60);
      error.textContent = `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    } else {
      error.textContent = "Incorrect password";
      input.classList.add("invalid");
    }
  } catch {
    error.textContent = "Can't reach your homelab";
  } finally {
    button.disabled = false;
  }
  form.classList.remove("shake");
  void form.offsetWidth;
  form.classList.add("shake");
  input.select();
}

async function logout() {
  $("confirm").hidden = true;
  await api("/api/logout", { method: "POST" }).catch(() => {});
  showLock();
}

async function showDesktop() {
  $("lock").hidden = true;
  $("wallpaper").classList.remove("blurred");
  $("veil").classList.remove("on");
  $("desktop").hidden = false;
  $("dock").hidden = false;
  state.layoutKey = "";
  dockKey = null;
  await loadWidgetCatalog().catch(() => {});
  await refresh();
  buildDock();
  startRefresh();
  startWidgets();
  startNotes();
  refreshDesk();
  // An install's first login: the welcome (unless a link asked for a window).
  if (!state.welcomed && !location.hash) openWelcome();
  // A link (or reload) to #settings or #settings/<row> opens Settings there;
  // #store, the App Store.
  const match = location.hash.match(/^#settings(?:\/([\w-]+))?$/);
  if (match) openSettings(match[1]);
  if (location.hash === "#store") openStore();
  if (location.hash === "#usage") openUsage();
}

// ------------------------------------------------------------------ data

async function refresh() {
  let result;
  try {
    result = await api("/api/apps");
  } catch {
    return;
  }
  if (result.status === 401) return showLock();
  if (result.status !== 200 || !result.body) return;
  state.name = result.body.name || "";
  state.searchUrl = result.body.searchUrl || state.searchUrl;
  $("greeting").textContent = greeting();
  // Alphabetical, like the umbrelOS desktop.
  state.apps = result.body.apps.slice().sort((a, b) => a.name.localeCompare(b.name));
  state.dock = result.body.dock || [];
  state.collections = result.body.collections || [];
  state.choices = result.body.choices || state.collections;
  state.host = result.body.host || {};
  state.available = result.body.available || [];
  state.admin = Boolean(result.body.admin);
  state.mode = result.body.mode || "homelab";
  state.welcomed = Boolean(result.body.welcomed);
  state.order = result.body.order || {};
  layout();
  for (const app of state.apps) setStatus(app);
  buildDock();
}

let refreshTimer = null;
function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
}
function stopRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

// ------------------------------------------------------------------ start

function platformKey() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const touch = matchMedia("(pointer: coarse)").matches;
  return touch ? "" : mac ? "⌘K" : "Ctrl K";
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { layout(); sizeDock(); setPageCount(state.pageTitles || [""]); }, 100);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && refreshTimer) refresh();
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("search").hidden ? openSearch() : closeSearch();
    return;
  }
  if (e.key === "Escape") {
    closeMenu();
    closeSearch();
    stopArranging();
    $("confirm").hidden = true;
  }
  if (!$("search").hidden) {
    if (e.key === "ArrowDown") { e.preventDefault(); select(Math.min(selected + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); select(Math.max(selected - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); runResult(selected); }
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!$("menu").hidden && !$("menu").contains(e.target)) closeMenu();
});
for (const area of [$("desktop"), $("dock")]) {
  area.addEventListener("contextmenu", onContextMenu);
  area.addEventListener("pointerdown", onPressStart);
  area.addEventListener("pointermove", onPressMove, { passive: true });
  area.addEventListener("pointerup", onPressEnd);
  area.addEventListener("pointercancel", onPressEnd);
  area.addEventListener("click", onPressClick, true);
}
$("search").addEventListener("pointerdown", (e) => { if (e.target === $("search")) closeSearch(); });
$("search-input").addEventListener("input", renderResults);
$("search-open").addEventListener("click", openSearch);
$("confirm-cancel").addEventListener("click", () => { $("confirm").hidden = true; });
$("confirm-ok").addEventListener("click", logout);
$("confirm").addEventListener("pointerdown", (e) => { if (e.target === $("confirm")) $("confirm").hidden = true; });
$("pages").addEventListener("scroll", onPagesScroll, { passive: true });
$("prev").addEventListener("click", () => goToPage(state.page - 1));
$("next").addEventListener("click", () => goToPage(state.page + 1));
document.addEventListener("pointerdown", onSortDown);
document.addEventListener("pointermove", onSortMove);
document.addEventListener("pointerup", onSortUp);
document.addEventListener("pointercancel", onSortUp);
document.addEventListener("click", onSortClick, true);
$("arrange-done").addEventListener("click", stopArranging);
$("dock").addEventListener("pointermove", magnify);
$("dock").addEventListener("pointerleave", sizeDock);
$("login").addEventListener("submit", unlock);
// Web search: a new tab at the search address, {QUERY} filled in.
$("web-search").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("web-search-input");
  const query = input.value.trim();
  if (!query) return;
  window.open(state.searchUrl.replaceAll("{QUERY}", encodeURIComponent(query)), "_blank", "noopener,noreferrer");
  input.value = "";
});

$("kbd").textContent = platformKey();
loadWallpaper();
setInterval(() => { if (!$("desktop").hidden) $("greeting").textContent = greeting(); }, 60000);
// After every script has run (the desktop needs the windows, Files, the dock…).
document.addEventListener("DOMContentLoaded", () => {
  api("/api/session")
    .then(({ body }) => (body?.authenticated ? showDesktop() : showLock()))
    .catch(showLock);
});
