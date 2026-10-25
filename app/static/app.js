// adlerOS, the home screen. Layout, paging and dock behaviour follow umbrelOS's
// desktop (packages/ui/src/modules/desktop); the code is our own.
// Everything is built with DOM calls, never innerHTML, so nothing from the
// catalog can inject markup.
"use strict";

// adlermd is Luna (since 2026-10-24): what this browser kept under its old
// name (the desktop's apps and their places, window sizes, its zoom) moves
// over, once.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("adleros.")) continue;
    const value = localStorage.getItem(key);
    const now = value && value.includes("adlermd") ? value.replace(/adleros:adlermd/g, "adleros:luna").replace(/"adlermd"/g, '"luna"') : value;
    const name = key.includes("adlermd") ? key.replace(/adlermd/g, "luna") : key;
    if (name !== key || now !== value) {
      localStorage.setItem(name, now);
      if (name !== key) localStorage.removeItem(key);
    }
  }
} catch { /* nothing kept here */ }

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
    // A style attribute is "inline style", which the page's CSP refuses; the
    // same set through the element's style is allowed.
    else if (k === "style") node.style.cssText = v;
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

// Where this install's settings are, for a page that asks you to set one: a
// homelab's homelab.env (read as you save it), or standalone adlerOS's .env
// (mounted as one file, so adlerOS sees a change once it restarts).
function settingsFile() { return state.mode === "standalone" ? "adlerOS's settings file (.env)" : "homelab.env"; }
function settingsThen() { return state.mode === "standalone" ? ", and restart adlerOS" : ""; }

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
    // Behind every window too, blurred (.sheet-wallpaper).
    document.documentElement.style.setProperty("--wallpaper", `url("${url}")`);
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
    // r: icons served differently (white-only ones made legible), so a week's cache doesn't keep the old.
    const src = `/api/icon/${encodeURIComponent(app.id)}?v=${encodeURIComponent(app.icon || "")}&r=2`;
    const img = el("img", { src, alt: "", draggable: "false" });
    img.addEventListener("error", () => monogram(plate, app));
    plate.append(img);
  } else {
    monogram(plate, app);
  }
  return plate;
}

function tile(app, index) {
  if (app.builtin) return ownTile(app, index);
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
  if (!app.url) link.removeAttribute("target");
  link.addEventListener("click", (e) => {
    if (e.defaultPrevented || !opensHere(e, app)) return;
    e.preventDefault();
    openApp(app);
  });
  link.style.animationDelay = `${index * 10}ms`;
  // Once only: dragging a tile moves it in the page, which would replay it.
  link.addEventListener("animationend", () => { link.style.animation = "none"; }, { once: true });
  state.tiles.set(app.id, { link, label, plate, warning, app });
  setStatus(app);
  return link;
}

// One of adlerOS's own apps on the home screen: its own icon (the dock's),
// opening its window. Its menu is the dock's for it (pin, Add to desktop).
function ownTile(app, index) {
  const plate = el("img", { src: `/api/dock-icon/${app.icon}`, alt: "", draggable: "false" });
  const warning = el("span", { class: "warning", hidden: "" });
  const label = el("span", { class: "app-label" }, app.name);
  const link = el("a", { class: "app own-app", href: "#", title: app.about || app.name, draggable: "false", "data-app": app.id },
    el("span", { class: "app-icon builtin-icon" }, plate, warning), label);
  link.addEventListener("click", (e) => {
    e.preventDefault();
    app.builtin.open();
  });
  link.style.animationDelay = `${index * 10}ms`;
  link.addEventListener("animationend", () => { link.style.animation = "none"; }, { once: true });
  state.tiles.set(app.id, { link, label, plate, warning, app });
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
  // The web search bar: a quarter of a widget tall (a phone has none on the
  // page: its search is the pill over the dock).
  const searchH = Math.max(38, Math.round(g.widgetH / 4));
  const searchBlockH = phoneLayout() ? 0 : searchH + 18;
  // A phone with no widgets picked gives their place to apps ("Edit widgets"
  // in the long-press menu brings them back).
  const showWidgets = !(phoneLayout() && !homeWidgetsChosen()) && rowsIn(stageH - pillsH - searchBlockH - widgetsH) >= Math.min(2, g.rowsMax);
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

  const groups = homeGroups();
  state.grid = { perRow, perCol };
  const key = gridKey(groups);
  if (!force && key === state.layoutKey) return;
  state.layoutKey = key;
  draw(groups, perRow, perRow * perCol);
}

function gridKey(groups) {
  const { perRow, perCol } = state.grid || {};
  const folders = Object.entries(state.folders || {}).map(([id, f]) => `${id}:${f.name}:${f.apps.join("+")}`).join(";");
  return `${perRow}x${perCol}:${groups.map((c) => `${c.id}=${c.items.map((i) => i.key).join(",")}`).join("|")}#${folders}`;
}

// ------------------------------------------------------------ collections

// Each collection is its own page (or pages, past 12 apps), titled; apps in
// none are under Extras, last. Within one, apps go in the order you dragged
// them into, then alphabetically.
const PAGE_TITLE_H = 18;

// The home screen's first page: adlerOS's own apps, in this order until you
// drag them about (the Terminal only in admin mode).
const OWN_PAGE = ["adleros:files", "adleros:music", "adleros:gallery", "adleros:documents", "adleros:calendar", "adleros:tasks", "adleros:luna", "adleros:notepad",
  "adleros:app-store", "adleros:settings", "adleros:live-usage", "adleros:terminal"];

function ownApps() {
  const saved = state.order.adleros || [];
  const rank = (id) => (saved.includes(id) ? saved.indexOf(id) : saved.length + OWN_PAGE.indexOf(id));
  return OWN_PAGE.filter((id) => id !== "adleros:terminal" || state.admin)
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => {
      const b = BUILTIN_PINS[id];
      const about = (typeof BUILT_IN !== "undefined" ? BUILT_IN : []).find((x) => `adleros:${x.id}` === id)?.about || "";
      return { id, name: b.name, icon: b.icon, about, builtin: b, up: true, genre: "adleros" };
    });
}

// The home screen's pages: adlerOS's own first, then the collections, with
// Core (DNS, the proxy: what your network needs) only in admin mode. The
// App Store and search have them all, always.
function homeGroups() {
  const own = ownApps();
  return [{ id: "adleros", name: "adlerOS", apps: own, items: own.map((app) => ({ key: app.id, app })) },
    ...groupApps().filter((c) => c.id !== "core" || state.admin)];
}

function groupApps() {
  const known = new Set(state.collections.map((c) => c.id));
  return state.collections.map((c) => {
    const saved = state.order[c.id] || [];
    const rank = (a) => {
      const i = saved.indexOf(a.id);
      return i < 0 ? Infinity : i;
    };
    const apps = state.apps.filter((a) => a.genre === c.id || (c.id === "extras" && !known.has(a.genre) && a.genre !== "background"))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    // What the page shows: its folders (of its own apps), and the apps in none.
    const here = new Set(apps.map((a) => a.id));
    const folders = Object.entries(state.folders || {})
      .filter(([, f]) => f.collection === c.id)
      .map(([id, f]) => ({ id, name: f.name, apps: f.apps.filter((a) => here.has(a)).map(appById) }))
      .filter((f) => f.apps.length);
    const inFolders = new Set(folders.flatMap((f) => f.apps.map((a) => a.id)));
    const where = (key) => {
      const i = saved.indexOf(key);
      return i < 0 ? Infinity : i;
    };
    const items = [...apps.filter((a) => !inFolders.has(a.id)).map((app) => ({ key: app.id, app })),
      ...folders.map((folder) => ({ key: `folder:${folder.id}`, folder }))]
      .sort((x, y) => where(x.key) - where(y.key) || (x.app || x.folder).name.localeCompare((y.app || y.folder).name));
    return { ...c, apps, items };
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
    for (let start = 0; start < c.items.length; start += perPage) {
      const slice = c.items.slice(start, start + perPage);
      const grid = el("div", { class: "app-grid", "data-collection": c.id, "data-start": String(start) },
        ...slice.map((item) => (item.app ? tile(item.app, index++) : folderTile(item.folder, index++))));
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
  if (pageGlideStop()) { pages.style.transform = ""; pages.style.scrollSnapType = ""; }
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

// The pages turn one at a time: a wheel (up, down or sideways), a sideways
// swipe on a trackpad (its momentum doesn't turn another), or a drag across
// them: a finger anywhere (held still, it's a right click instead: apps are
// picked up that way), a mouse anywhere but an app (it drags apps to
// rearrange them). The drag is an iPhone's: the pages stay under your
// finger, stretch like rubber before the first and after the last, and when
// you let go, the way your finger was still moving decides: on to that
// side's page, however little you'd moved; stopped, the nearer page. A
// spring then carries on at your finger's speed, and a touch catches it.
// On a phone, going on past the last page opens the App Library. adlerOS
// does it rather than the browser (touch-action: pan-y), so an iPhone and an
// Android swipe alike.
const pageTurn = { acc: 0, last: 0, held: false, drag: null, suppress: false, glide: 0, pos: 0 };
// From UIScrollView (its rubber band, as measured) and Flutter's iOS paging
// (PageScrollPhysics, BouncingScrollPhysics, VelocityTracker).
const PAGE_RUBBER = 0.55;
const PAGE_FLING = 0.1; // px/ms: slower than this when you let go is still
const PAGE_STOPPED = 40; // ms without moving before letting go: still
const PAGE_SPRING = { mass: 0.5, stiffness: 100, ratio: 1.1 };
const PAGE_SLOP = 8;
function pageRubber(x, d) { return (x * d * PAGE_RUBBER) / (d + PAGE_RUBBER * x); }
function pageUnrubber(y, d) { return (y * d) / (PAGE_RUBBER * Math.max(1, d - y)); }
// Where the pages are, in px from the first, drawn: past either end, the
// scroll stays put and the stretch is a transform.
function pageShow(pos) {
  const pages = $("pages");
  const end = pages.scrollWidth - pages.clientWidth;
  const at = Math.min(Math.max(pos, 0), end);
  pageTurn.pos = pos;
  pages.scrollLeft = at;
  pages.style.transform = Math.abs(pos - at) > 0.01 ? `translateX(${at - pos}px)` : "";
}
function pageGlideStop() {
  if (!pageTurn.glide) return false;
  cancelAnimationFrame(pageTurn.glide);
  pageTurn.glide = 0;
  return true;
}
// The spring to a page, starting at the finger's speed (px/ms, the pages').
function pageGlide(page, speed) {
  pageGlideStop();
  const pages = $("pages");
  const target = page * pages.clientWidth;
  const { mass, stiffness, ratio } = PAGE_SPRING;
  const damping = ratio * 2 * Math.sqrt(stiffness * mass);
  let x = pageTurn.pos - target;
  let v = speed * 1000; // px/s
  let then = performance.now();
  pages.style.scrollSnapType = "none";
  const step = (now) => {
    let dt = Math.min(0.05, (now - then) / 1000);
    then = now;
    for (; dt > 0; dt -= 0.004) {
      const h = Math.min(0.004, dt);
      v += ((-stiffness * x - damping * v) / mass) * h;
      x += v * h;
    }
    if (Math.abs(x) < 0.5 && Math.abs(v) < 20) {
      pageTurn.glide = 0;
      pageShow(target);
      pages.style.scrollSnapType = "";
      goToPage(page, false);
      return;
    }
    pageShow(target + x);
    pageTurn.glide = requestAnimationFrame(step);
  };
  pageTurn.glide = requestAnimationFrame(step);
}
function onPagesWheel(e) {
  if (state.pageCount < 2 || e.ctrlKey || arranging()) return;
  e.preventDefault();
  const now = performance.now();
  const gap = now - pageTurn.last;
  pageTurn.last = now;
  if (pageTurn.held && gap < 180) return; // the rest of the swipe that turned it
  pageTurn.held = false;
  if (gap > 300) pageTurn.acc = 0;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  pageTurn.acc += e.deltaMode === 1 ? d * 30 : d;
  if (Math.abs(pageTurn.acc) < 40) return;
  const next = state.page + Math.sign(pageTurn.acc);
  pageTurn.acc = 0;
  pageTurn.held = true;
  if (next >= 0 && next < state.pageCount) goToPage(next);
}

function onPagesDown(e) {
  if (e.button !== 0 || (state.pageCount < 2 && !phoneLayout()) || arranging()) return;
  const mouse = e.pointerType === "mouse";
  if (e.target.closest(mouse ? ".app, button, a, input, [data-widget], [data-folder]" : "button, input")) return;
  const pages = $("pages");
  // Still gliding: the touch catches it where it is (and doesn't tap an app).
  const caught = pageGlideStop();
  const end = pages.scrollWidth - pages.clientWidth;
  const pos = caught ? pageTurn.pos : pages.scrollLeft;
  // Caught while stretched: from the finger's place that stretch stands for.
  const W = pages.clientWidth;
  const left = pos < 0 ? -pageUnrubber(-pos, W) : pos > end ? end + pageUnrubber(pos - end, W) : pos;
  pageTurn.drag = { x: e.clientX, y: e.clientY, left, page: state.page, id: e.pointerId, moved: false, caught, over: 0,
    trail: [[e.clientX, e.timeStamp]] };
  if (caught) { pageShow(pos); pages.style.scrollSnapType = "none"; }
}
function onPagesMove(e) {
  const d = pageTurn.drag;
  if (!d || e.pointerId !== d.id) return;
  let dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  const pages = $("pages");
  if (!d.moved) {
    if (Math.abs(dx) < PAGE_SLOP) {
      if (Math.abs(dy) > 12 && !d.caught) pageTurn.drag = null; // up or down: not a page turn (pulled down: search)
      return;
    }
    if (pressed || drag.item) { pageTurn.drag = null; return; } // held first: a right click, or an app picked up
    d.moved = true;
    d.x += Math.sign(dx) * PAGE_SLOP; // from here, without a jump
    dx = e.clientX - d.x;
    clearTimeout(pressTimer);
    pages.style.scrollSnapType = "none"; // follows you; snaps when you let go
    pages.setPointerCapture(e.pointerId);
  }
  const want = d.left - dx;
  const end = pages.scrollWidth - pages.clientWidth;
  const W = pages.clientWidth;
  d.over = want < 0 ? want : want > end ? want - end : 0;
  pageShow(d.over < 0 ? -pageRubber(-d.over, W) : d.over > 0 ? end + pageRubber(d.over, W) : want);
  // When it happened (a busy phone hands them over late).
  const now = e.timeStamp;
  d.trail.push([e.clientX, now]);
  while (d.trail.length > 2 && now - d.trail[0][1] > 100) d.trail.shift();
}
function onPagesUp(e) {
  const d = pageTurn.drag;
  if (!d || e.pointerId !== d.id) return;
  pageTurn.drag = null;
  const pages = $("pages");
  const W = Math.max(1, pages.clientWidth);
  if (!d.moved) {
    if (!d.caught) return;
    pageGlide(Math.round(pageTurn.pos / W), 0); // caught and let go: the nearer page
  } else if (e.type === "pointercancel") {
    // The browser took the swipe (Safari's own back swipe, say): back to
    // where it started. Its place (Safari's 0, 0) isn't the finger's.
    pageGlide(d.page, 0);
  } else {
    // How fast the finger was going, lately (still, if it had stopped).
    const now = e.timeStamp;
    const [x1, t1] = d.trail[d.trail.length - 1];
    const [x0, t0] = d.trail[0];
    let speed = now - t1 > PAGE_STOPPED || t1 === t0 ? 0 : -(x1 - x0) / (t1 - t0); // the pages' way
    if (Math.abs(speed) < PAGE_FLING) speed = 0;
    // Going on past the last page (a phone): the App Library.
    if (phoneLayout() && d.over > 0 && (speed > 0 || d.over > W / 2)) openDrawer();
    let page = pageTurn.pos / W;
    if (speed > 0) page += 0.5;
    else if (speed < 0) page -= 0.5;
    page = Math.max(0, Math.min(state.pageCount - 1, Math.round(page)));
    pageGlide(page, d.over ? 0 : speed);
  }
  // The click this lifting makes doesn't open the app it ended on.
  pageTurn.suppress = true;
  setTimeout(() => { pageTurn.suppress = false; }, 0);
}

// ------------------------------------------------------------------- dock

// The helper's systemd unit: its name differs between the two kinds of install.
function helperUnit() { return state.mode === "standalone" ? "adleros-agent.path" : "homelab-agent.path"; }

function appById(id) {
  return state.apps.find((a) => a.id === id);
}

// The dock, like a Mac's: what you pin (your apps and adlerOS's own, in any
// order), then what's open that isn't pinned, a divider, and All apps, which
// always stays. adlerOS's icons come from /api/dock-icon, so ./icons can
// replace them. Clicking one whose window is open puts it away again.
const DOCK_FIXED = [
  { id: "app-drawer", label: "All apps", run: () => toggleDrawer() },
];
const DOCK_MAX_PINS = 16;
// adlerOS's own windows: pinned (and unpinned, moved about, put on the
// desktop) like any app.
const BUILTIN_PINS = {
  "adleros:app-store": { name: "App Store", icon: "app-store", dock: "app-store", open: () => toggleStore() },
  "adleros:settings": { name: "Settings", icon: "settings", dock: "settings", open: () => toggleWindow("settings", () => openSettings()) },
  "adleros:live-usage": { name: "Live Usage", icon: "live-usage", dock: "live-usage", open: () => toggleUsage() },
  "adleros:files": { name: "My Computer", icon: "files", dock: "files", open: () => toggleFiles() },
  "adleros:terminal": { name: "Terminal", icon: "terminal", dock: "terminal", open: () => toggleTerminal() },
  "adleros:notepad": { name: "Notepad", icon: "notepad", dock: "notepad", open: () => openNotepad() },
  "adleros:luna": { name: "Luna", icon: "luna", dock: "luna", open: () => toggleLuna() },
  "adleros:music": { name: "Music", icon: "music", dock: "music", open: () => toggleMusic() },
  "adleros:gallery": { name: "Gallery", icon: "gallery", dock: "gallery", open: () => toggleGallery() },
  "adleros:documents": { name: "Documents", icon: "documents", dock: "documents", open: () => toggleDocuments() },
  "adleros:calendar": { name: "Calendar", icon: "calendar", dock: "calendar", open: () => toggleCalendar() },
  "adleros:tasks": { name: "Tasks", icon: "tasks", dock: "tasks", open: () => toggleTasks() },
};
// A pin: an installed app, or one of those.
const pinFor = (id) => appById(id) || (BUILTIN_PINS[id] && { id, builtin: BUILTIN_PINS[id] });
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

function builtinDockItem(pin) {
  const b = pin.builtin;
  const src = `/api/dock-icon/${b.icon}`;
  // A pin like an app's (dock-app): dragged about among them.
  const button = el("button", { class: "dock-item dock-app dock-builtin", type: "button", "aria-label": b.name,
    "data-app": pin.id, "data-dock": b.dock },
  el("img", { class: "glow", src, alt: "", draggable: "false" }),
  el("img", { src, alt: "", draggable: "false" }),
  el("span", { class: "dock-label material" }, b.name));
  button.addEventListener("click", () => {
    bounce(button);
    b.open();
  });
  return button;
}

function pinnedDockItem(app) {
  if (app.builtin) return builtinDockItem(app);
  const link = el("a", { class: `dock-item dock-app${app.up ? "" : " offline"}`, href: app.url || "#store", target: "_blank",
    rel: "noopener noreferrer", draggable: "false", "data-app": app.id,
    "aria-label": app.up ? app.name : `${app.name} (offline)` },
  el("span", { class: "dock-plate" }, plateFor(app)),
  el("span", { class: "dock-label material" }, app.up ? app.name : `${app.name} · Offline`));
  link.addEventListener("click", (e) => {
    bounce(link);
    if (opensHere(e, app)) {
      e.preventDefault();
      openApp(app);
    }
  });
  return link;
}

let dockKey = null;
const dockKeyFor = (pinned) => pinned.map((a) => `${a.id}:${a.icon}:${a.up}`).join(",");
function buildDock() {
  // Your pins, in your order (winDock adds what's open after them); then the
  // divider and All apps. The terminal shows only in admin mode (its pin
  // waits until then).
  let pinned = state.dock.map(pinFor).filter((p) => p && (p.id !== "adleros:terminal" || state.admin));
  const fixed = DOCK_FIXED;
  // A phone's dock holds four, like an iPhone's: All apps always, and the
  // first three pins.
  if (phoneLayout()) pinned = pinned.slice(0, PHONE_DOCK - fixed.length);
  // Rebuilt only when the pins, their icons or their status change.
  const key = `${dockKeyFor(pinned)}|${fixed.map((f) => f.id).join(",")}|${state.admin}`;
  if (key === dockKey) return;
  dockKey = key;
  $("dock").replaceChildren(...pinned.map(pinnedDockItem),
    ...(pinned.length && fixed.length && !phoneLayout() ? [el("span", { class: "dock-divider", "aria-hidden": "true" })] : []),
    ...fixed.map(fixedDockItem));
  markDockOpen("settings", isOpen("settings"));
  markDockOpen("app-store", isOpen("store"));
  markDockOpen("live-usage", isOpen("usage"));
  markDockOpen("app-drawer", drawerOpen());
  markDockOpen("files", isOpen("files"));
  markDockOpen("terminal", isOpen("terminal"));
  markDockOpen("luna", isOpen("luna"));
  markDockOpen("music", isOpen("music"));
  markDockOpen("gallery", isOpen("gallery"));
  markDockOpen("documents", isOpen("documents"));
  markDockOpen("calendar", isOpen("calendar"));
  markDockOpen("tasks", isOpen("tasks"));
  markDockOpen("notepad", [...pads.keys()].some((id) => isOpen(id)));
  winDock();
}

function isPinned(id) { return state.dock.includes(id); }

// Pins (or unpins) an app; `at`: where in the dock (dropped there), else the end.
async function setPinned(id, pinned, at) {
  const rest = state.dock.filter((a) => a !== id);
  let next = rest;
  if (pinned) next = at === undefined ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
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

// Whether a click on an app's link opens it here (a window, openApp) rather
// than letting the link make a tab: unless you asked for a tab (Ctrl, ⌘,
// Shift, the middle button) or this device wants tabs on the home screen.
function opensHere(e, app) {
  if (!app.url) return true;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return false;
  return desktopMode() || !appsInTabs();
}

// An app with no web page (a game server, a bot) opens its App Store card.
function openApp(app) {
  if (!app.url) {
    toast(`${app.name} has no web page; here it is in the App Store.`);
    return openStore();
  }
  // In a window, unless this device wants tabs (on the home screen) or the
  // app won't be shown inside another page.
  if (desktopMode() || !appsInTabs()) return openAppWindow(app);
  window.open(app.url, "_blank", "noopener,noreferrer");
}

// My Computer and the terminal open as many windows as you like (desktop
// mode): another, whether or not one's open.
const NEW_WINDOW = { "adleros:files": () => newFilesWindow(), "adleros:terminal": () => newTerminalWindow(), "adleros:notepad": () => newNotepadWindow() };
const newWindowItem = (id) => (desktopMode() && NEW_WINDOW[id] ? [{ label: "New window", run: NEW_WINDOW[id] }] : []);

// What a right-click (or a long press) on `target` offers.
// The window a dock item opens, if it's open: its id, for Close.
const DOCK_WINDOWS = { "app-store": "store", settings: "settings", "live-usage": "usage", files: "files", terminal: "terminal", luna: "luna", music: "music", gallery: "gallery", documents: "documents", calendar: "calendar", tasks: "tasks" };
function openWindowFor(item) {
  const id = item?.dataset.window || DOCK_WINDOWS[item?.dataset.dock] || (item?.dataset.app && !BUILTIN_PINS[item.dataset.app] ? `app-${item.dataset.app}` : null);
  return id && wm.windows.has(id) && isOpen(id) ? id : null;
}
const closeItem = (id) => ({ label: "Close", run: () => wm.windows.get(id)?.close() });

function menuFor(target) {
  if (desktopMode() && target.closest("#desktop") && !target.closest("[data-app]")) return deskMenu(target);
  // An item in the dock whose window is open: Close, at the end of its menu.
  const docked = target.closest("#dock .dock-item");
  const open = docked && openWindowFor(docked);
  if (open && docked.dataset.window) {
    return [{ label: "Show", run: () => raiseWindow(open, true) }, closeItem(open)]; // open, not in the dock otherwise
  }
  const items = menuForItem(target);
  return open && items ? [...items, closeItem(open)] : items;
}

function menuForItem(target) {
  const appId = target.closest("[data-app]")?.dataset.app;
  const app = appId && appById(appId);
  const arrange = { label: "Rearrange apps", run: startArranging };
  const pin = (id) => (isPinned(id)
    ? { label: "Remove from Dock", run: () => setPinned(id, false) }
    : { label: "Keep in Dock", run: () => setPinned(id, true) });
  // Files and the terminal: pinned or not, like an app.
  // In desktop mode, any app (or Files, the terminal) can go on the desktop too.
  // On the desktop itself, its own icon: Remove from desktop.
  const onDesktop = (id) => (!desktopMode() ? []
    : [onDesk(id) || target.closest("#desk") ? { label: "Remove from desktop", run: () => setOnDesk(id, false) } : { label: "Add to desktop", run: () => setOnDesk(id, true) }]);
  const builtin = appId && BUILTIN_PINS[appId];
  if (builtin) return [{ label: "Open", run: builtin.open }, ...newWindowItem(appId), pin(appId), ...onDesktop(appId)];
  if (app) {
    const inFolder = target.closest("#folder");
    return [{ label: "Open", run: () => openApp(app) }, pin(app.id), ...onDesktop(app.id),
      ...(inFolder ? [{ label: "Remove from folder", run: () => removeFromFolder(folderView.id, app.id) }]
        : target.closest("#pages") ? [{ label: "Add to a folder…", run: () => folderDialog(app) }] : []),
      { label: app.genre === "extras" ? "Put in a collection…" : "Move to another collection…", run: () => collectionDialog(app) },
      ...(inFolder ? [] : [arrange])];
  }
  const folderId = target.closest("#pages [data-folder]")?.dataset.folder;
  if (folderId && state.folders?.[folderId]) {
    return [{ label: "Open", run: () => openFolder(folderId) },
      { label: "Rename…", run: async () => {
        const name = await nameDialog({ title: "Rename the folder", value: state.folders[folderId].name, button: "Rename" });
        if (name) renameFolder(folderId, name);
      } },
      { label: "Remove folder (its apps stay)", run: () => dissolveFolder(folderId) },
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
  if (!pressStart) return;
  const moved = Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10;
  if (!pressed) {
    if (moved) clearTimeout(pressTimer);
    return;
  }
  // Held, then moved: it's picked up (the menu goes), like on an iPhone.
  if (moved && !drag.item) {
    const found = sortable(pressStart.target);
    if (!found) return;
    closeMenu();
    if (found.kind === "grid" || found.kind === "dock") startArranging();
    Object.assign(drag, found, { active: false, pointerId: event.pointerId, startX: pressStart.x, startY: pressStart.y,
      from: found.container.dataset.collection, crossed: false, edge: 0 });
    beginDrag(event);
  }
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

// What a drag picks up: a pin along the dock, an app (or folder) on a page,
// an app in an open folder, or an app from All apps (to drop on the dock).
function sortable(target) {
  const pin = target.closest("#dock .dock-app");
  if (pin) return { item: pin, container: $("dock"), selector: ".dock-app", kind: "dock" };
  const inFolder = target.closest("#folder-apps .app");
  if (inFolder) return { item: inFolder, container: $("folder-apps"), selector: ".app", kind: "folder" };
  const fromDrawer = target.closest("#drawer [data-app]");
  if (fromDrawer) return { item: fromDrawer, container: fromDrawer.parentElement, selector: "[data-app]", kind: "drawer" };
  const app = target.closest("#pages .app");
  if (app) return { item: app, container: app.parentElement, selector: ".app", kind: "grid" };
  return null;
}

// Held over the middle of another app (or a folder) for a moment: dropping
// there makes (or adds to) a folder. Anywhere else on it: it moves there.
function mergeZone(over, e) {
  if (!drag.item.dataset.app || drag.kind !== "grid") return false;
  const icon = over.querySelector(".app-icon")?.getBoundingClientRect();
  if (!icon) return false;
  const inset = icon.width * 0.2;
  return e.clientX > icon.left + inset && e.clientX < icon.right - inset && e.clientY > icon.top + inset && e.clientY < icon.bottom - inset;
}

function holdOver(over) {
  if (drag.hover === over) return;
  clearMerge();
  drag.hover = over;
  drag.hoverTimer = setTimeout(() => {
    drag.merge = over;
    over.classList.add("merge-target");
  }, 450);
}

function clearMerge() {
  clearTimeout(drag.hoverTimer);
  drag.merge?.classList.remove("merge-target");
  drag.merge = drag.hover = null;
}

// From All apps onto the dock: pinned where it's dropped.
function overDock(e) {
  const r = $("dock").getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 24 && e.clientY <= r.bottom;
}

function dropOnDock(id, x) {
  const pins = [...$("dock").querySelectorAll(".dock-app")].filter((p) => p.dataset.app !== id);
  const at = pins.filter((p) => { const b = p.getBoundingClientRect(); return b.left + b.width / 2 < x; }).length;
  setPinned(id, true, at).then(() => { if (pinFor(id)) toast(`${pinFor(id).name || pinFor(id).builtin.name} is in the dock.`); });
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
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.kind === "drawer") {
    $("dock").classList.toggle("dock-drop", overDock(e));
    return;
  }
  if (drag.kind === "folder") {
    // Out past the folder's edge: dropped there, it's back on the page.
    const r = $("folder").querySelector(".folder-panel").getBoundingClientRect();
    drag.out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    $("folder").classList.toggle("dragging-out", drag.out);
    if (drag.out) return;
  }
  if (drag.kind === "grid") edgeTurn(e);
  const over = [...drag.container.querySelectorAll(drag.selector)].find((it) => {
    if (it === drag.item) return false;
    const r = it.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (over && mergeZone(over, e)) return holdOver(over);
  clearMerge();
  if (over) moveBefore(over);
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
  // A folder stays in its collection (its apps can move, one by one), and
  // adlerOS's own apps on their page: it's theirs alone.
  if (!drag.active || !page || drag.item.dataset.folder || drag.item.classList.contains("own-app")) return;
  goToPage(state.page + dir);
  const grid = page.querySelector(".app-grid");
  if (grid && grid !== drag.container && grid.dataset.collection !== "adleros") {
    grid.append(drag.item);
    drag.container = grid;
    drag.crossed = true;
  }
}

// Dropped on another page: that collection's new order (and, if it's not
// where the app was, the app's new collection), from what's on screen.
async function dropAcrossPages(appId, collection) {
  const order = collectionOrder(collection);
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
    const merge = drag.merge;
    clearMerge();
    $("dock").classList.remove("dock-drop");
    if (drag.kind === "grid" && merge) mergeOnto(merge, drag.item.dataset.app, drag.container.dataset.collection);
    else if (drag.kind === "drawer") { if (overDock({ clientX: drag.x, clientY: drag.y })) dropOnDock(drag.item.dataset.app, drag.x); }
    else if (drag.kind === "folder") folderDragEnd(drag.item.dataset.app, drag.out);
    else if (drag.kind === "grid" && drag.crossed) dropAcrossPages(drag.item.dataset.app, drag.container.dataset.collection);
    else saveArrangement(drag.kind, drag.container);
  }
  drag.item = null;
  drag.active = false;
  drag.out = false;
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

// A collection's order as the screen shows it, across its pages: apps by
// id, folders as "folder:<id>".
function collectionOrder(collection) {
  return [...document.querySelectorAll(`#pages .app-grid[data-collection="${CSS.escape(collection)}"] > .app`)]
    .map((a) => (a.dataset.folder ? `folder:${a.dataset.folder}` : a.dataset.app));
}

async function saveArrangement(kind, container) {
  let body;
  if (kind === "dock") {
    // A phone's dock shows four: the pins it doesn't show keep their order, after.
    const shown = [...container.querySelectorAll(".dock-app")].map((a) => a.dataset.app);
    const ids = [...shown, ...state.dock.filter((id) => !shown.includes(id))];
    if (ids.join() === state.dock.join()) return;
    body = { dock: ids };
  } else {
    const collection = container.dataset.collection;
    const next = collectionOrder(collection);
    if (next.join() === (state.order[collection] || []).join()) return;
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
    dockKey = null;
    buildDock();
  } else {
    Object.assign(state.order, body.order);
    state.layoutKey = gridKey(homeGroups());
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
  { id: "files", name: "My Computer", keywords: "files folders storage documents upload download trash desktop mailbox root computer finder explorer" },
  { id: "notepad", name: "Notepad", keywords: "notepad text editor edit write txt plain" },
  { id: "luna", name: "Luna", keywords: "luna notes markdown md obsidian vault wiki journal daily graph" },
  { id: "music", name: "Music", keywords: "music songs albums artists playlists radio player play listen lyrics spotify mp3" },
  { id: "gallery", name: "Gallery", keywords: "gallery photos pictures images videos albums people faces memories camera immich" },
  { id: "documents", name: "Documents", keywords: "documents papers paperless pdf scans letters bills invoices receipts contracts tags ocr" },
  { id: "calendar", name: "Calendar", keywords: "calendar events schedule agenda day week month meetings appointments radicale caldav" },
  { id: "tasks", name: "Tasks", keywords: "tasks todo to-do list kanban board projects vikunja due reminders checklist" },
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
function toggleSearch() { $("search").hidden ? openSearch() : closeSearch(); }

// Files whose names have every word you typed (the server's index of every
// place), asked for a moment after you stop typing.
const fileSearch = { q: "", items: [], timer: null };
function searchFilesSoon(q) {
  clearTimeout(fileSearch.timer);
  if (q.length < 2) return;
  fileSearch.timer = setTimeout(async () => {
    const { status, body } = await api(`/api/files/search?q=${encodeURIComponent(q)}`).catch(() => ({ status: 0 }));
    if (status !== 200 || $("search-input").value.trim().toLowerCase() !== q) return;
    Object.assign(fileSearch, { q, items: body.items || [] });
    renderResults(true);
  }, 180);
}

function renderResults(keepSelection = false) {
  const q = $("search-input").value.trim().toLowerCase();
  if (!keepSelection) searchFilesSoon(q);
  const apps = state.apps.filter((a) => a.genre !== "background" && (!q || a.name.toLowerCase().includes(q) || a.about.toLowerCase().includes(q)));
  const actions = q ? ACTIONS.filter((a) => (a.name.toLowerCase().includes(q) || a.keywords.includes(q))
    && (a.id !== "desktop-mode" || computerScreen()) && (a.id !== "terminal" || state.admin)) : [];
  const found = q.length >= 2 && fileSearch.q === q ? fileSearch.items : [];
  results = [...apps.map((app) => ({ type: "app", app })), ...settingsSearchResults(q),
    ...actions.map((action) => ({ type: "action", action })),
    ...found.map((file) => ({ type: "file", file })),
    // Last: the web, for anything else (a phone has no search bar of its own).
    ...(q ? [{ type: "web", query: $("search-input").value.trim() }] : [])];
  const before = selected;
  selected = 0;
  const list = $("search-results");
  list.replaceChildren(...results.map((r, i) => {
    // Settings rows and the Settings / App Store actions wear their dock icons.
    const glyph = r.type === "setting" ? "settings"
      : { settings: "settings", store: "app-store", usage: "live-usage", drawer: "app-drawer" }[r.action?.id] || null;
    const icon = r.type === "app"
      ? el("span", { class: "result-icon" }, plateFor(r.app))
      : r.type === "file"
        ? el("span", { class: `result-icon action file-icon ${r.file.kind}` }, svg(FILE_ICONS[r.file.kind] || FILE_ICONS.file))
      : r.type === "web"
        ? el("span", { class: "result-icon action web" }, svg(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"]))
      : glyph
        ? el("span", { class: "result-icon dock-glyph" }, el("img", { src: `/api/dock-icon/${glyph}`, alt: "" }))
        : el("span", { class: "result-icon action" }, svg(r.action?.id === "terminal" ? ["m4 17 6-6-6-6", "M12 19h8"]
          : r.action?.id === "files" ? ["M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]
          : ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"]));
    const name = r.type === "app" ? r.app.name : r.type === "setting" ? r.row.title : r.type === "file" ? r.file.name
      : r.type === "web" ? `Search the web for “${r.query}”` : r.action.name;
    // A file: where it is (its folder, from its place's name).
    const hint = r.type === "app" ? (r.app.up ? "Open" : "Offline") : r.type === "setting" ? "Settings"
      : r.type === "file" ? fromLabel(r.file.path) || "My Computer"
      : r.type === "web" ? "Web" : "Action";
    const li = el("li", { role: "option", id: `result-${i}` }, icon, el("span", {}, name), el("span", { class: "hint" }, hint));
    li.addEventListener("pointermove", () => select(i));
    li.addEventListener("click", () => runResult(i));
    return li;
  }));
  select(keepSelection ? Math.min(before, results.length - 1) : 0);
}

function select(i) {
  selected = i;
  [...$("search-results").children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
  $("search-input").setAttribute("aria-activedescendant", results.length ? `result-${i}` : "");
  $(`result-${i}`)?.scrollIntoView({ block: "nearest" }); // the list scrolls: every app, then files
}

function runResult(i) {
  const r = results[i];
  if (!r) return;
  closeSearch();
  if (r.type === "app") openApp(r.app);
  else if (r.type === "setting") openSettings(r.row.id);
  else if (r.type === "file") openEntry({ name: r.file.name, dir: r.file.dir, kind: r.file.kind, size: 0 }, r.file.path);
  else if (r.type === "web") webSearch(r.query);
  else if (r.action.id === "settings") openSettings();
  else if (r.action.id === "store") openStore();
  else if (r.action.id === "usage") openUsage();
  else if (r.action.id === "drawer") openDrawer();
  else if (r.action.id === "terminal") openTerminal();
  else if (r.action.id === "files") openFiles(filesHome());
  else if (r.action.id === "notepad") openNotepad();
  else if (r.action.id === "luna") openLuna();
  else if (r.action.id === "music") openMusic();
  else if (r.action.id === "gallery") openGallery();
  else if (r.action.id === "documents") openDocuments();
  else if (r.action.id === "calendar") openCalendar();
  else if (r.action.id === "tasks") openTasks();
  else if (r.action.id === "desktop-mode") setDesktopMode(!desktopMode());
  else if (r.action.id === "welcome") openWelcome();
  else if (r.action.id === "logout") confirmLogout();
}

// Every web search (search's last result, the search bar, the widget) goes
// to the same address: Settings → Web search.
async function webSearch(query) {
  const url = state.searchUrl.replaceAll("{QUERY}", encodeURIComponent(query));
  if (!(await openInFirefox(url, "the search"))) window.open(url, "_blank", "noopener,noreferrer");
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
  forgetFileEdits(); // logging out: no "unsaved changes" question
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
  state.folders = result.body.folders || {};
  state.collections = result.body.collections || [];
  state.choices = result.body.choices || state.collections;
  state.host = result.body.host || {};
  state.available = result.body.available || [];
  noteAdmin(Boolean(result.body.admin), result.body.adminLeft);
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
  return touch ? "" : mac ? "⌥ Space" : "Alt Space";
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
// Long-press (and right-click) menus, and long-press-to-drag, wherever
// apps are: the pages, the dock, All apps, an open folder.
for (const area of [$("desktop"), $("dock"), $("drawer"), $("folder")]) {
  if (area !== $("drawer") && area !== $("folder")) area.addEventListener("contextmenu", onContextMenu);
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
$("pages").addEventListener("wheel", onPagesWheel, { passive: false });
$("pages").addEventListener("pointerdown", onPagesDown);
$("pages").addEventListener("pointermove", onPagesMove);
$("pages").addEventListener("pointerup", onPagesUp);
$("pages").addEventListener("pointercancel", onPagesUp);
$("pages").addEventListener("click", (e) => {
  if (!pageTurn.suppress) return;
  e.preventDefault();
  e.stopPropagation();
}, true);
$("prev").addEventListener("click", () => goToPage(state.page - 1));
$("next").addEventListener("click", () => goToPage(state.page + 1));
document.addEventListener("pointerdown", onSortDown);
// Held (or being dragged): the page mustn't scroll under the finger. A new
// touch, anywhere, is a new start.
document.addEventListener("pointerdown", () => { pressed = false; }, true);
document.addEventListener("touchmove", (e) => { if (pressed || drag.active) e.preventDefault(); }, { passive: false });
document.addEventListener("pointermove", onSortMove);
document.addEventListener("pointerup", onSortUp);
document.addEventListener("pointercancel", onSortUp);
document.addEventListener("click", onSortClick, true);
$("arrange-done").addEventListener("click", stopArranging);
$("dock").addEventListener("pointermove", magnify);
$("dock").addEventListener("pointerleave", sizeDock);
$("login").addEventListener("submit", unlock);
// Web search: at the search address, {QUERY} filled in (webSearch).
$("web-search").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("web-search-input");
  const query = input.value.trim();
  if (!query) return;
  webSearch(query);
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
