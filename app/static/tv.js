// TV mode, after tvOS 26: adlerOS for a television, worked with a remote,
// the arrow keys, a mouse or a finger.
//
// The home screen, as on an Apple TV: a top row of apps on a glass dock,
// and above it the "top shelf", the whole screen behind it given over to
// what the focused app has for you (Videos: what you were watching, what's
// next, what's new; Photos: this day years ago; Music and Podcasts: what's
// playing). Under the dock, every other app in a grid of big landscape
// icons. The focused icon lifts towards you and catches the light (it
// tilts with the mouse); its name shows under it. Going down into the grid
// slides the shelf away and blurs the picture behind. Top right, the time:
// open it for Control Center (what's playing, the modes, Settings).
//
// Everywhere, in the apps too, the arrows move the focus to the nearest
// thing that way, Enter opens or presses it, and Back (Escape, Backspace,
// a remote's back key) closes Control Center, the menu, the dialog, the
// player or the app, in that order; on the home screen, back to the top.
// Apps open full screen. One of the modes (windows.js MODES), kept per
// device.
// Uses $, el, svg, api, toast, winLoad, winSave, wm, isOpen, desktopMode,
// switchDesktopMode, DESKTOP_MODE_KEY, computerScreen, layout, plateFor,
// openApp, state, closeMenu, closeModal, MODES, currentMode, setMode, the
// apps' open functions, appWidgetValue, vd, Music's and Podcasts' players.
"use strict";

const TV_KEY = "adleros.tvMode";
const tv = { built: false, focus: null, lastTile: null, tick: null, shelfTimer: null, shelfFor: "", appsKey: "", bg: "",
  byPointer: false, soon: false, lost: 0, videos: null, videosAt: 0, ccFrom: null };

// adlerOS's own, first: [id, icon, name, open, about]. The first ones (as
// many as a row holds) are the dock's.
const TV_OWN = [
  ["adleros:videos", "videos", "Videos", () => openVideos(), "Films, shows and documentaries."],
  ["adleros:music", "music", "Music", () => openMusic(), "Your songs, albums, playlists and radio."],
  ["adleros:podcasts", "podcasts", "Podcasts", () => openPodcasts(), "Your audiobooks and podcasts."],
  ["adleros:gallery", "gallery", "Photos", () => openGallery(), "Your photos and videos."],
  ["adleros:books", "books", "Books", () => openBooks(), "Your books."],
  ["adleros:files", "files", "My Computer", () => openFiles(), "Your files."],
  ["adleros:settings", "settings", "Settings", () => openSettings(), "How adlerOS looks and works."],
];

const TV_ICONS = {
  play: ["M7 4l13 8-13 8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"], next: ["M5 4l10 8-10 8z", "M19 5v14"],
  fwd30: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"], shuffle: ["M16 3h5v5", "M4 20 21 3", "M21 16v5h-5", "M15 15l6 6", "M4 4l5 5"],
  cc: ["M4 7h10", "M18 7h2", "M4 17h2", "M10 17h10", "M16 5v4", "M8 15v4"],
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"], desktop: ["M3 5h18v12H3z", "M8 21h8", "M12 17v4"],
  tv: ["M3 6h18v12H3z", "M8 21h8"], car: ["M5 17h14v-5l-2-5H7l-2 5z", "M7 17v2", "M17 17v2", "M5 12h14"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
};

function tvOn() { return document.body.classList.contains("tv"); }

function setTv(on) {
  if (on === tvOn()) return;
  if (on && desktopMode()) { switchDesktopMode(false); winSave(DESKTOP_MODE_KEY, false); }
  if (on && carOn()) { document.body.classList.remove("car"); winSave(CAR_KEY, false); $("car")?.setAttribute("hidden", ""); clearInterval(car.timer); }
  for (const [id, w] of wm.windows) if (isOpen(id)) (w.hide || w.close)();
  document.body.classList.toggle("tv", on);
  winSave(TV_KEY, on);
  if (on) tvShow();
  else { tvControlCenterClose(false); $("tv")?.setAttribute("hidden", ""); clearInterval(tv.tick); layout(true); }
  toast(on ? "TV mode: the arrows (or a remote) move, Enter opens, Back or Escape goes back." : "Back to the home screen.");
}

// ------------------------------------------------------------- home

function tvBuild() {
  if (tv.built) return;
  tv.built = true;
  const status = el("button", { type: "button", class: "tv-status", id: "tv-status", "aria-label": "Control Center" },
    el("span", { class: "tv-clock", id: "tv-clock" }), svg(TV_ICONS.cc));
  status.addEventListener("click", tvControlCenter);
  const node = el("section", { id: "tv", class: "tv-home", "aria-label": "TV", hidden: "" },
    el("div", { class: "tv-bg", "aria-hidden": "true" },
      el("div", { class: "tv-bg-pic", id: "tv-bg-a" }), el("div", { class: "tv-bg-pic", id: "tv-bg-b" }),
      el("div", { class: "tv-scrim" }), el("div", { class: "tv-blur" })),
    el("div", { class: "tv-scroll", id: "tv-scroll" },
      el("div", { class: "tv-shelf", id: "tv-shelf" }),
      el("nav", { class: "tv-dock", id: "tv-dock", "aria-label": "Top row" }),
      el("nav", { class: "tv-grid", id: "tv-grid", "aria-label": "Apps" })),
    el("header", { class: "tv-top" }, status),
    el("aside", { class: "tv-cc", id: "tv-cc", "aria-label": "Control Center", hidden: "" }));
  $("desktop").after(node);
  $("tv-scroll").addEventListener("scroll", tvScrolled, { passive: true });
  // A click (or tap) outside Control Center closes it.
  node.addEventListener("pointerdown", (e) => { if (!$("tv-cc").hidden && !e.target.closest("#tv-cc, #tv-status")) tvControlCenterClose(); });
  addEventListener("resize", () => { if (tvOn()) tvTiles(); });
}

// Drawn at once (the apps' own tiles), then again as the rest arrive: never
// a blank screen while adlerOS loads.
function tvShow() {
  tvBuild();
  $("tv").hidden = false;
  tvTiles();
  const tick = () => {
    $("tv-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    tvTiles(); // apps added or gone
  };
  tick();
  clearInterval(tv.tick);
  tv.tick = setInterval(tick, 5000);
  requestAnimationFrame(() => {
    if ($("tv").contains(document.activeElement) && document.activeElement !== $("tv")) return;
    (document.querySelector(`#tv .tv-app[data-id="${CSS.escape(tv.focus || "")}"]`) || $("tv-dock").querySelector(".tv-app"))?.focus({ preventScroll: true });
  });
}

// How many to a row: five on a television, fewer on a small screen.
function tvColumns() { return innerWidth >= 1100 ? 5 : innerWidth >= 700 ? 4 : 3; }

function tvAppList() {
  const own = TV_OWN.map(([id, icon, name, open, about]) => ({ id, name, open, about, own: icon }));
  const apps = (state.apps || []).filter((a) => a.genre !== "background").sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, name: a.name, open: () => openApp(a), about: a.about || "", app: a }));
  return [...own, ...apps];
}

function tvTiles() {
  if (!tv.built) return;
  const list = tvAppList();
  const cols = tvColumns();
  const key = `${cols}|${list.map((t) => t.id).join(",")}`;
  if (key === tv.appsKey) return;
  tv.appsKey = key;
  const had = document.activeElement?.closest?.("#tv .tv-app")?.dataset.id;
  $("tv").style.setProperty("--tv-cols", cols);
  $("tv-dock").replaceChildren(...list.slice(0, cols).map(tvTile));
  $("tv-grid").replaceChildren(...list.slice(cols).map(tvTile));
  if (had) $("tv").querySelector(`.tv-app[data-id="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
}

// An app's icon, landscape: adlerOS's own on a wash of their colours, the
// others' logos on their plate.
function tvIcon(t) {
  const glare = el("span", { class: "tv-app-glare" });
  if (t.own) {
    const src = `/static/dock/${t.own}.svg`;
    return el("span", { class: "tv-app-icon own" }, el("img", { class: "tv-app-wash", src, alt: "", draggable: "false" }),
      el("img", { class: "tv-app-glyph", src, alt: "", draggable: "false" }), glare);
  }
  return el("span", { class: "tv-app-icon" }, plateFor(t.app), glare);
}

function tvTile(t) {
  const b = el("button", { type: "button", class: "tv-app", "data-id": t.id, "aria-label": t.name }, tvIcon(t), el("span", { class: "tv-app-name" }, t.name));
  b.addEventListener("click", () => { tv.lastTile = t.id; t.open(); tvFocusSoon(); });
  b.addEventListener("focus", () => tvFocused(b, t));
  b.addEventListener("blur", () => tvTiltReset(b));
  // The mouse is a pointer for the focus, as on an Apple TV: where it rests
  // is what's focused (without moving the page under it).
  b.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse" || document.activeElement === b || !$("tv-cc").hidden) return;
    tv.byPointer = true;
    b.focus({ preventScroll: true });
    tv.byPointer = false;
  });
  b.addEventListener("pointermove", (e) => tvTilt(b, e));
  b.addEventListener("pointerleave", () => tvTiltReset(b));
  return b;
}

function tvFocused(b, t) {
  tv.focus = t.id;
  const inDock = b.parentElement?.id === "tv-dock";
  if (!tv.byPointer) tvScrollTo(inDock ? null : b);
  if (inDock) {
    clearTimeout(tv.shelfTimer);
    tv.shelfTimer = setTimeout(() => tvShelf(t), 140);
  }
}

// The page: at the top for the dock (the shelf in sight), else the focused
// row in the middle of the screen.
function tvScrollTo(tile) {
  const scroller = $("tv-scroll");
  if (!tile) return scroller.scrollTo({ top: 0, behavior: "smooth" });
  const r = tile.getBoundingClientRect();
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + r.top + r.height / 2 - innerHeight * 0.5), behavior: "smooth" });
}

function tvScrolled() {
  $("tv").classList.toggle("in-grid", $("tv-scroll").scrollTop > innerHeight * 0.16);
}

// The light on a focused icon: it leans towards the mouse.
function tvTilt(b, e) {
  if (e.pointerType !== "mouse" || document.activeElement !== b) return;
  const r = b.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  b.style.setProperty("--rx", `${(-y * 9).toFixed(2)}deg`);
  b.style.setProperty("--ry", `${(x * 11).toFixed(2)}deg`);
  b.style.setProperty("--gx", `${Math.round((x + 0.5) * 100)}%`);
  b.style.setProperty("--gy", `${Math.round((y + 0.5) * 100)}%`);
}
function tvTiltReset(b) { for (const p of ["--rx", "--ry", "--gx", "--gy"]) b.style.removeProperty(p); }

// Pushed against the edge (nothing further that way): a little nudge.
function tvNudge(n, dx, dy) {
  if (!n) return;
  n.style.setProperty("--nx", `${dx * 6}px`);
  n.style.setProperty("--ny", `${dy * 6}px`);
  n.classList.remove("tv-nudge");
  void n.offsetWidth;
  n.classList.add("tv-nudge");
  setTimeout(() => n.classList.remove("tv-nudge"), 260);
}

// ------------------------------------------------------------- the top shelf

// The picture behind it all: two layers, one fading into the other.
// `soft`: a small picture (an album cover), blurred to a wash.
function tvBackdrop(url, soft = false) {
  const want = url ? `${url}|${soft}` : "";
  if (want === tv.bg) return;
  tv.bg = want;
  const a = $("tv-bg-a"), b = $("tv-bg-b");
  const [front, back] = a.classList.contains("on") ? [a, b] : [b, a];
  if (!url) { front.classList.remove("on"); return; }
  const img = new Image();
  img.onload = () => {
    if (tv.bg !== want) return;
    back.style.backgroundImage = `url("${url}")`;
    back.classList.toggle("soft", soft);
    back.classList.add("on");
    front.classList.remove("on");
  };
  img.onerror = () => { if (tv.bg === want) front.classList.remove("on"); };
  img.src = url;
}

function tvHead(kicker, title, text) {
  return el("div", { class: "tv-shelf-head" }, kicker ? el("div", { class: "tv-kicker" }, kicker) : "",
    el("h1", {}, title), text ? el("p", {}, text) : "");
}

function tvCard(art, title, run, onFocus) {
  const card = el("button", { type: "button", class: "tv-card" }, art, el("span", { class: "tv-card-title" }, title));
  card.addEventListener("click", run);
  if (onFocus) card.addEventListener("focus", onFocus);
  card.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && $("tv-cc").hidden) card.focus({ preventScroll: true }); });
  return card;
}

async function tvShelf(t) {
  tv.shelfFor = t.id;
  const shelf = $("tv-shelf");
  const here = () => tv.shelfFor === t.id;
  const show = (...kids) => { if (here()) shelf.replaceChildren(...kids); };
  const plain = () => { tvBackdrop(""); show(tvHead("", t.name, t.about)); };
  if (t.id === "adleros:videos") return tvVideosShelf(t, here, show);
  if (t.id === "adleros:gallery") {
    const v = appWidgetValue("photos", () => { if (here()) tvShelf(t); });
    if (!v?.picture) return plain();
    tvBackdrop(v.picture);
    return show(tvHead("On This Day", v.caption || "Photos", v.note || ""));
  }
  if (t.id === "adleros:music") {
    const id = typeof muCurrent === "function" ? muCurrent() : null;
    const s = id ? muSong(id) : null;
    if (s) {
      tvBackdrop(s.cover ? muCover(id) : "", true);
      const art = el("span", { class: "tv-card-square" }, musicArt(id));
      return show(tvHead(music.audio.paused ? "Paused" : "Now Playing", s.station && s.now ? s.now : s.title, s.station ? s.title : muArtists(s)),
        el("div", { class: "tv-shelf-row" }, tvCard(art, music.audio.paused ? "Play" : "Pause", () => { musicToggle(); setTimeout(() => here() && tvShelf(t), 300); })));
    }
    tvBackdrop("");
    const shuffle = el("span", { class: "tv-card-square tv-card-glyph" }, svg(TV_ICONS.shuffle));
    return show(tvHead("", "Music", t.about), el("div", { class: "tv-shelf-row" }, tvCard(shuffle, "Shuffle your library", async () => {
      toast("Getting your music…");
      if (!music.loaded) await musicLoad();
      if (music.all.length) { musicRadio({ kind: "all", label: "Your library" }); setTimeout(() => here() && tvShelf(t), 600); }
    })));
  }
  if (t.id === "adleros:podcasts" && typeof pcNow === "function" && pcNow()) {
    const n = pcNow();
    const art = pcArt(n.item || pc.byId.get(pc.np.id) || {}, 400);
    tvBackdrop(art.querySelector("img")?.src || "", true);
    return show(tvHead(pc.audio.paused ? "Paused" : "Now Playing", n.title, n.sub || ""),
      el("div", { class: "tv-shelf-row" }, tvCard(el("span", { class: "tv-card-square" }, art), pc.audio.paused ? "Play" : "Pause", () => { pcToggle(); setTimeout(() => here() && tvShelf(t), 300); })));
  }
  plain();
}

// Videos: Continue Watching, Up Next and what's new (Jellyfin), or your
// films (offline). The focused one fills the screen.
async function tvVideosShelf(t, here, show) {
  if (!tv.videos || Date.now() - tv.videosAt > 60000) {
    const status = await api("/api/videos/status").then((r) => r.body).catch(() => null);
    let items = [];
    if (status?.source === "jellyfin") {
      const h = await api("/api/videos/home").then((r) => (r.status === 200 ? r.body : null)).catch(() => null);
      if (h) items = [...h.resume.map((i) => ({ ...i, kicker: "Continue Watching" })), ...h.next.map((i) => ({ ...i, kicker: "Up Next" })),
        ...h.latest.flatMap((s) => s.items.map((i) => ({ ...i, kicker: `New in ${s.name}` })))];
    } else {
      const l = await api("/api/videos/local").then((r) => (r.status === 200 ? r.body.folders : [])).catch(() => []);
      items = l.flatMap((f) => f.items.map((i) => ({ ...i, kicker: f.name })));
    }
    const seen = new Set();
    tv.videos = items.filter((i) => !seen.has(i.id) && seen.add(i.id)).slice(0, 12);
    tv.videosAt = Date.now();
  }
  if (!here()) return;
  const items = tv.videos;
  if (!items.length) { tvBackdrop(""); return show(tvHead("", "Videos", "Nothing to watch yet: connect Jellyfin in Videos, or put films in Media/Documentaries.")); }
  const head = el("div", { class: "tv-shelf-headbox" });
  const feature = (i) => {
    const pic = i.local ? "" : `/api/videos/image?id=${i.type === "episode" && i.seriesId ? i.seriesId : i.id}&w=1920&kind=backdrop`;
    tvBackdrop(pic);
    head.replaceChildren(tvHead(i.kicker, i.type === "episode" ? i.series : i.name, i.type === "episode" ? [vdSub(i), i.name].filter(Boolean).join(" · ") : vdSub(i)));
  };
  const cards = items.map((i) => tvCard(vdArt(i, { wide: true }), i.type === "episode" ? `${i.series} · ${i.name}` : i.name, async () => {
    tv.lastTile = t.id;
    if (i.type === "series" || i.type === "folder") {
      await openVideos();
      vdShow({ kind: "item", id: i.id, item: i });
    } else {
      // The film first; Videos loads behind it, for when it ends.
      vdBuild();
      openWindow("videos");
      vdPlay(i);
      vdLoad();
    }
    tvFocusSoon();
  }, () => feature(i)));
  feature(items[0]);
  show(head, el("div", { class: "tv-shelf-row" }, ...cards));
}

// ------------------------------------------------------------- Control Center

function tvControlCenter() {
  const cc = $("tv-cc");
  if (!cc.hidden) return tvControlCenterClose();
  tv.ccFrom = document.activeElement;
  const button = (cls, icon, label, run, extra = {}) => {
    const b = el("button", { type: "button", class: `tv-cc-btn ${cls}`, ...extra }, svg(icon), el("span", {}, label));
    b.addEventListener("click", run);
    return b;
  };
  const now = new Date();
  const kids = [el("div", { class: "tv-cc-time" }, now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
    el("div", { class: "tv-cc-date" }, now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))];
  // What's playing, with its buttons.
  const pods = typeof carPods === "function" && carPods();
  const songId = typeof muCurrent === "function" ? muCurrent() : null;
  if (pods || songId) {
    const s = songId ? muSong(songId) : null;
    const n = pods ? pcNow() : null;
    const paused = pods ? pc.audio.paused : music.audio.paused;
    const redo = () => setTimeout(() => { tvControlCenterClose(false); tvControlCenter(); }, 250);
    kids.push(el("div", { class: "tv-cc-now" },
      el("div", { class: "tv-cc-now-text" }, el("strong", {}, pods ? n.title : s?.title || ""), el("span", {}, pods ? n.sub || "" : s ? muArtists(s) : "")),
      el("div", { class: "tv-cc-now-ctls" },
        button("round", paused ? TV_ICONS.play : TV_ICONS.pause, paused ? "Play" : "Pause", () => { pods ? pcToggle() : musicToggle(); redo(); }),
        button("round", pods ? TV_ICONS.fwd30 : TV_ICONS.next, pods ? "On 30 s" : "Next", () => { pods ? pcSkip(30) : musicNext(); redo(); }))));
  }
  kids.push(el("div", { class: "tv-cc-label" }, "Mode"));
  const modeIcon = { home: TV_ICONS.home, desktop: TV_ICONS.desktop, tv: TV_ICONS.tv, car: TV_ICONS.car };
  kids.push(el("div", { class: "tv-cc-modes" }, ...MODES.map(([m, label]) => button(`mode${currentMode() === m ? " on" : ""}`, modeIcon[m] || TV_ICONS.tv, label,
    () => { if (m === "tv") return tvControlCenterClose(); tvControlCenterClose(false); setMode(m); },
    m === "desktop" && !computerScreen() ? { disabled: "" } : {}))));
  kids.push(button("wide", TV_ICONS.settings, "Settings", () => { tvControlCenterClose(false); openSettings(); tvFocusSoon(); }));
  cc.replaceChildren(...kids);
  cc.hidden = false;
  requestAnimationFrame(() => {
    cc.classList.add("open");
    cc.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  });
}

function tvControlCenterClose(refocus = true) {
  const cc = $("tv-cc");
  if (!cc || cc.hidden) return;
  cc.classList.remove("open");
  cc.hidden = true;
  if (refocus && tv.ccFrom?.isConnected) tv.ccFrom.focus({ preventScroll: true });
  tv.ccFrom = null;
}

// ------------------------------------------------------------- moving about

const TV_FOCUSABLE = "button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex='-1']), [role=link], video";

// Where the keys work now: Control Center, the menu, a dialog, the player,
// the app in front, else the TV's home.
function tvScope() {
  if ($("tv-cc") && !$("tv-cc").hidden) return $("tv-cc");
  if (!$("menu").hidden) return $("menu");
  if (!$("modal").hidden) return $("modal");
  if (typeof vd !== "undefined" && vd.player) return $("vd-player");
  const open = [...document.querySelectorAll(".sheet:not([hidden]):not(.closing)")];
  return open.at(-1) || $("tv");
}

function tvShown(n) {
  if (n.closest("[hidden], [inert]")) return false;
  const r = n.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && getComputedStyle(n).visibility !== "hidden";
}

// The first thing in the app's main part; `fallback`: else the first
// anywhere in it (its side, not its close button, if there's a choice).
function tvFocusFirst(scope = tvScope(), fallback = true) {
  if (!scope) return false;
  if (scope.id === "tv") {
    const tile = document.querySelector(`#tv .tv-app[data-id="${CSS.escape(tv.lastTile || tv.focus || "")}"]`) || $("tv-dock").querySelector(".tv-app");
    tile?.focus({ preventScroll: true });
    if (tile) tvScrollTo(tile.parentElement.id === "tv-dock" ? null : tile);
    return Boolean(tile);
  }
  const main = scope.querySelector(".mu-main, main, [role=main]");
  const inMain = main ? [...main.querySelectorAll(TV_FOCUSABLE)].find(tvShown) : null;
  const any = fallback || !main ? [...scope.querySelectorAll(TV_FOCUSABLE)].filter(tvShown) : [];
  const first = inMain || any.find((n) => !n.matches(".sheet-close")) || any[0];
  first?.focus({ preventScroll: false });
  return Boolean(first);
}
// Whether the focus is somewhere you can see, in what the keys work on.
function tvFocusLost() {
  const a = document.activeElement, scope = tvScope();
  return !scope || !a || a === document.body || a === scope || !scope.contains(a) || !tvShown(a);
}
// Opening, closing, a page drawn again: the focus can drop to nothing (or
// stay on what went away). Lost a moment: back to the first thing there.
setInterval(() => {
  if (!tvOn() || !tv.built || $("desktop").hidden || tv.soon) { tv.lost = 0; return; }
  tv.lost = tvFocusLost() ? (tv.lost || 0) + 1 : 0;
  if (tv.lost >= 2) { tv.lost = 0; tvFocusFirst(tvScope(), true); }
}, 300);

// Once what was opened has drawn (it may still be loading): up to 4 s.
function tvFocusSoon() {
  const until = Date.now() + 4000;
  tv.soon = true; // the watchdog waits for this
  const step = () => {
    if (!tvOn()) { tv.soon = false; return; }
    const scope = tvScope();
    const done = (!tvFocusLost() && !document.activeElement.matches(".sheet-close, .tv-app, .tv-card")) || tvFocusFirst(scope, Date.now() > until);
    if (done) { tv.soon = false; return; }
    setTimeout(step, 250);
  };
  setTimeout(step, 400);
}

// The nearest focusable the way of the arrow, its edge past ours.
function tvMove(dx, dy) {
  const scope = tvScope();
  if (!scope) return false;
  const cur = scope.contains(document.activeElement) && document.activeElement !== scope ? document.activeElement : null;
  const all = [...scope.querySelectorAll(TV_FOCUSABLE)].filter((n) => n !== cur && tvShown(n));
  if (!cur) { (all[0])?.focus(); return Boolean(all[0]); }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, score = Infinity;
  for (const n of all) {
    if (n.contains(cur) || cur.contains(n)) continue;
    const b = n.getBoundingClientRect();
    const past = dx > 0 ? b.left >= r.right - 6 : dx < 0 ? b.right <= r.left + 6 : dy > 0 ? b.top >= r.bottom - 6 : b.bottom <= r.top + 6;
    if (!past) continue;
    const along = dx ? (b.left + b.width / 2 - cx) * dx : (b.top + b.height / 2 - cy) * dy;
    const across = dx ? Math.max(0, Math.abs(b.top + b.height / 2 - cy) - (r.height + b.height) / 4) : Math.max(0, Math.abs(b.left + b.width / 2 - cx) - (r.width + b.width) / 4);
    const s = along + across * 3;
    if (along > 0 && s < score) { score = s; best = n; }
  }
  if (!best) { if (scope.id === "tv") tvNudge(cur, dx, dy); return scope.id === "tv"; }
  best.focus({ preventScroll: true });
  // The home's tiles move the page themselves (tvFocused).
  if (!best.closest("#tv-dock, #tv-grid")) best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

function tvBack() {
  if ($("tv-cc") && !$("tv-cc").hidden) { tvControlCenterClose(); return true; }
  if (!$("menu").hidden) { closeMenu(); return true; }
  if (!$("modal").hidden) { closeModal(); return true; }
  if (typeof vd !== "undefined" && vd.player) { vdStop(); tvFocusSoon(); return true; }
  const open = [...wm.windows].filter(([id]) => isOpen(id));
  if (open.length) {
    const [, w] = open.at(-1);
    (w.hide || w.close)();
    setTimeout(() => { if (tvFocusLost()) tvFocusFirst(); }, 350);
    return true;
  }
  // The home screen: down in the grid (or up in the shelf), back to the top row.
  const a = document.activeElement;
  if (tv.built && $("tv").contains(a) && !a.closest("#tv-dock")) {
    const tile = $("tv-dock").querySelector(`.tv-app[data-id="${CSS.escape(tv.lastTile || "")}"]`) || $("tv-dock").querySelector(".tv-app");
    tile?.focus({ preventScroll: true });
    tvScrollTo(null);
    return true;
  }
  return false;
}

document.addEventListener("keydown", (e) => {
  if (!tvOn() || e.ctrlKey || e.metaKey || e.altKey || $("desktop").hidden) return;
  const t = e.target;
  const typing = t.closest?.("input:not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable='true'], [contenteditable='']");
  // The player: left and right skip 10 s, Enter and the space pause.
  if (t.tagName === "VIDEO") {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); t.currentTime = Math.max(0, t.currentTime + (e.key === "ArrowLeft" ? -10 : 10)); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); t.paused ? t.play().catch(() => {}) : t.pause(); return; }
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) {
    if (typing && dir[0] && t.value) return; // the caret moves
    if (t.tagName === "SELECT" && dir[1]) return; // its own choices
    if (tvMove(dir[0], dir[1])) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  if (["Escape", "BrowserBack", "GoBack"].includes(e.key) || (e.key === "Backspace" && !typing)) {
    if (tvBack()) { e.preventDefault(); e.stopPropagation(); }
  }
}, true);

// Back on (this device was in TV mode): before the first draw, and the TV's
// home straight away (the lock screen, if it's up, stays in front).
if (winLoad(TV_KEY, false) === true) {
  document.body.classList.add("tv");
  tvShow();
}
