// TV mode, after tvOS: adlerOS for a television, worked with a remote or
// the arrow keys. A row of big app tiles; above it the "top shelf" shows
// what the focused app has for you (Videos: what you were watching and
// what's next; Photos: this day years ago). Everywhere, in the apps too,
// the arrows move the focus to the nearest thing that way, Enter opens or
// presses it, and Back (Escape, Backspace, a remote's back key) closes
// the menu, the dialog, the player or the app, in that order. Apps open
// full screen. One of the modes (windows.js MODES), kept per device.
// Uses $, el, svg, api, toast, winLoad, winSave, wm, isOpen, desktopMode,
// switchDesktopMode, DESKTOP_MODE_KEY, layout, plateFor, openApp, state,
// closeMenu, closeModal, the apps' open functions, appWidgetValue, vd.
"use strict";

const TV_KEY = "adleros.tvMode";
const tv = { built: false, focus: null, shelfTimer: null, lastTile: null, clock: null };

// adlerOS's own, first: [id, icon, name, open].
const TV_OWN = [
  ["adleros:videos", "videos", "Videos", () => openVideos()],
  ["adleros:music", "music", "Music", () => openMusic()],
  ["adleros:podcasts", "podcasts", "Podcasts", () => openPodcasts()],
  ["adleros:gallery", "gallery", "Photos", () => openGallery()],
  ["adleros:books", "books", "Books", () => openBooks()],
  ["adleros:files", "files", "My Computer", () => openFiles()],
  ["adleros:settings", "settings", "Settings", () => openSettings()],
];

function tvOn() { return document.body.classList.contains("tv"); }

function setTv(on) {
  if (on === tvOn()) return;
  if (on && desktopMode()) { switchDesktopMode(false); winSave(DESKTOP_MODE_KEY, false); }
  if (on && carOn()) { document.body.classList.remove("car"); winSave(CAR_KEY, false); $("car")?.setAttribute("hidden", ""); }
  for (const [id, w] of wm.windows) if (isOpen(id)) (w.hide || w.close)();
  document.body.classList.toggle("tv", on);
  winSave(TV_KEY, on);
  if (on) tvShow();
  else { $("tv")?.setAttribute("hidden", ""); clearInterval(tv.clock); layout(true); }
  toast(on ? "TV mode: the arrows (or a remote) move, Enter opens, Back or Escape goes back." : "Back to the home screen.");
}

// ------------------------------------------------------------- home

function tvBuild() {
  if (tv.built) return;
  tv.built = true;
  const node = el("section", { id: "tv", class: "tv-home", "aria-label": "TV", hidden: "" },
    el("header", { class: "tv-top" }, el("div", { class: "tv-clock", id: "tv-clock" }),
      (() => { const b = el("button", { type: "button", class: "tv-mode", id: "tv-mode" }, "Mode"); b.addEventListener("click", () => { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 6, modeItems()); }); return b; })()),
    el("div", { class: "tv-shelf", id: "tv-shelf" }),
    el("nav", { class: "tv-apps", id: "tv-apps", "aria-label": "Apps" }));
  $("desktop").after(node);
}

function tvShow() {
  tvBuild();
  $("tv").hidden = false;
  tvTiles();
  const tick = () => { $("tv-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  tick();
  clearInterval(tv.clock);
  tv.clock = setInterval(tick, 15000);
  requestAnimationFrame(() => (document.querySelector(`#tv-apps [data-id="${CSS.escape(tv.focus || "")}"]`) || $("tv-apps").querySelector("button"))?.focus({ preventScroll: true }));
}

function tvTiles() {
  const own = TV_OWN.map(([id, icon, name, open]) => tvTile(id, el("img", { src: `/static/dock/${icon}.svg`, alt: "", draggable: "false" }), name, open));
  const apps = (state.apps || []).filter((a) => a.genre !== "background").sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => tvTile(a.id, plateFor(a), a.name, () => openApp(a), a));
  $("tv-apps").replaceChildren(...own, ...apps);
}

function tvTile(id, icon, name, open, app = null) {
  const b = el("button", { type: "button", class: "tv-app", "data-id": id, "aria-label": name }, el("span", { class: "tv-app-icon" }, icon), el("span", { class: "tv-app-name" }, name));
  b.addEventListener("click", () => { tv.lastTile = id; open(); tvFocusSoon(); });
  b.addEventListener("focus", () => {
    tv.focus = id;
    clearTimeout(tv.shelfTimer);
    tv.shelfTimer = setTimeout(() => tvShelf(id, name, app), 180);
  });
  return b;
}

// The top shelf: what the focused app has.
async function tvShelf(id, name, app) {
  const shelf = $("tv-shelf");
  const about = (text) => shelf.replaceChildren(el("div", { class: "tv-shelf-about" }, el("h1", {}, name), el("p", {}, text)));
  if (id === "adleros:videos") {
    about("Films, shows and documentaries.");
    const status = await api("/api/videos/status").then((r) => r.body).catch(() => null);
    let items = [];
    if (status?.source === "jellyfin") {
      const h = await api("/api/videos/home").then((r) => (r.status === 200 ? r.body : null)).catch(() => null);
      items = h ? [...h.resume, ...h.next, ...h.latest.flatMap((s) => s.items)] : [];
    } else {
      const l = await api("/api/videos/local").then((r) => (r.status === 200 ? r.body.folders : [])).catch(() => []);
      items = l.flatMap((f) => f.items);
    }
    if (tv.focus !== id) return;
    if (!items.length) return about("Nothing to watch yet: connect Jellyfin in Videos, or put films in Media/Documentaries.");
    const seen = new Set();
    const cards = items.filter((i) => !seen.has(i.id) && seen.add(i.id)).slice(0, 8).map((i) => {
      const card = el("button", { type: "button", class: "tv-card" }, vdArt(i, { wide: true }), el("span", { class: "tv-card-title" }, i.type === "episode" ? `${i.series} · ${i.name}` : i.name));
      card.addEventListener("click", async () => {
        tv.lastTile = id;
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
      });
      return card;
    });
    return shelf.replaceChildren(el("div", { class: "tv-shelf-row" }, ...cards));
  }
  if (id === "adleros:gallery") {
    about("Your photos and videos.");
    const redraw = () => { if (tv.focus === id) tvShelf(id, name, app); };
    const v = appWidgetValue("photos", redraw);
    if (v?.picture) shelf.replaceChildren(el("div", { class: "tv-shelf-photo" }, el("img", { src: v.picture.replace("size=preview", "size=preview"), alt: "" }),
      el("div", { class: "tv-shelf-photo-text" }, el("h1", {}, v.caption), el("p", {}, `On this day · ${v.note}`))));
    return;
  }
  if (id === "adleros:music" && typeof muCurrent === "function" && muCurrent()) {
    const s = muSong(muCurrent());
    return about(`Playing: ${s?.title || ""}${s ? `, ${muArtists(s)}` : ""}`);
  }
  const blurb = { "adleros:music": "Your songs, albums, playlists and radio.", "adleros:podcasts": "Your audiobooks and podcasts.",
    "adleros:books": "Your books.", "adleros:files": "Your files.", "adleros:settings": "How adlerOS looks and works, and the way out of TV mode." }[id];
  about(blurb || app?.about || "");
}

// ------------------------------------------------------------- moving about

const TV_FOCUSABLE = "button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex='-1']), [role=link], video";

// Where the keys work now: the menu, a dialog, the player, the app in
// front, else the TV's home.
function tvScope() {
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
  if (scope.id === "tv") {
    const tile = document.querySelector(`#tv-apps [data-id="${CSS.escape(tv.lastTile || tv.focus || "")}"]`) || $("tv-apps").querySelector("button");
    tile?.focus({ preventScroll: true });
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
  return !a || a === document.body || a === scope || !scope.contains(a) || !tvShown(a);
}
// Opening, closing, a page drawn again: the focus can drop to nothing (or
// stay on what went away). Lost a moment: back to the first thing there.
setInterval(() => {
  if (!tvOn() || $("desktop").hidden || tv.soon) { tv.lost = 0; return; }
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
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

function tvBack() {
  if (!$("menu").hidden) { closeMenu(); return true; }
  if (!$("modal").hidden) { closeModal(); return true; }
  if (typeof vd !== "undefined" && vd.player) { vdStop(); tvFocusSoon(); return true; }
  const open = [...wm.windows].filter(([id]) => isOpen(id));
  if (!open.length) return false;
  const [, w] = open.at(-1);
  (w.hide || w.close)();
  setTimeout(() => { if (tvFocusLost()) tvFocusFirst(); }, 350);
  return true;
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

// Back on (this device was in TV mode): before the first draw.
if (winLoad(TV_KEY, false) === true) document.body.classList.add("tv");
