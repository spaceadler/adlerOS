// Big screens: adlerOS's own apps drawn big, for the car (a finger on a
// phone on a mount: CarPlay) and the TV (a remote from the sofa: tvOS).
//
// Each app (Music, Podcasts, Videos, Photos, Books, Calendar) says what it
// has as pages: a page has tabs (Music: Recently Played, Playlists,
// Albums, Artists), or a hero (an album: its cover, Play and Shuffle) and
// sections of items in a list, a grid or a shelf (a row across). An item
// plays, opens its own page, or shows (a photo). One drawing for both, the
// sizes and the moving about of each mode their own (app.css .big-car,
// .big-tv): in the car a rail down the side (home, the apps) and what's
// playing along the bottom, and what you pick to hear sends you to the
// car's Now Playing; on the TV tabs along the top, everything reached with
// the arrows (tv.js), Back to go back, and a Now Playing of its own.
// Uses $, el, svg, api, toast, winLoad, winSave, openWindow, closeWindow,
// Music's, Podcasts', Videos', Photos' (gaGet, gaThumb), Books' and
// Calendar's own parts, carOn/carShow/carGo (car.js) and tvOn/tvFocusSoon
// (tv.js).
"use strict";

const BIG_RECENT_KEY = "adleros.bigRecent"; // the albums and playlists you played, newest first
const big = { built: false, mode: "", app: "", stack: [], gen: 0, timer: null, viewer: null, videoWatch: null };

const BIG_ICONS = {
  back: ["m15 18-6-6 6-6"], home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  play: ["M7 4l13 8-13 8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"], next: ["M5 4l10 8-10 8z", "M19 5v14"], prev: ["M19 20 9 12l10-8z", "M5 19V5"],
  shuffle: ["M16 3h5v5", "M4 20 21 3", "M21 16v5h-5", "M15 15l6 6", "M4 4l5 5"],
  back30: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"], fwd30: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"],
  nav: ["M3 11l18-8-8 18-2-8z"], close: ["M18 6 6 18", "M6 6l12 12"], left: ["m15 18-6-6 6-6"], right: ["m9 18 6-6-6-6"],
};

// The apps: [id, name, dock icon, the root page].
const BIG_APPS = {
  music: { name: "Music", icon: "music", root: () => bigMusicRoot() },
  podcasts: { name: "Podcasts", icon: "podcasts", root: () => bigPodsRoot() },
  videos: { name: "Videos", icon: "videos", root: () => bigVideosRoot() },
  photos: { name: "Photos", icon: "gallery", root: () => bigPhotosRoot() },
  books: { name: "Books", icon: "books", root: () => bigBooksRoot() },
  calendar: { name: "Calendar", icon: "calendar", root: () => bigCalendarRoot() },
};
const BIG_CAR_APPS = ["music", "podcasts", "calendar", "photos", "videos"];

function bigOn() { return big.built && !$("big").hidden; }

// ------------------------------------------------------------- the frame

function bigBuild() {
  if (big.built) return;
  big.built = true;
  const node = el("section", { id: "big", class: "big", hidden: "", "aria-label": "App" },
    el("nav", { class: "big-rail", id: "big-rail", "aria-label": "Apps" }),
    el("div", { class: "big-main", id: "big-main", role: "main" },
      el("header", { class: "big-head", id: "big-head" }),
      el("div", { class: "big-tabs", id: "big-tabs", role: "tablist" }),
      el("div", { class: "big-body", id: "big-body" }),
      el("div", { class: "big-mini", id: "big-mini", hidden: "" })),
    el("div", { class: "big-viewer", id: "big-viewer", hidden: "" }));
  $("desktop").after(node);
}

// Opens an app big: `mode` "car" or "tv"; `tab`: on that tab.
async function bigOpen(app, mode, { tab = 0 } = {}) {
  if (!BIG_APPS[app]) return;
  bigBuild();
  big.mode = mode;
  big.app = app;
  const root = $("big");
  root.className = `big big-${mode}`;
  root.dataset.app = app;
  root.hidden = false;
  bigViewerClose();
  bigRail();
  big.stack = [{ page: null, load: BIG_APPS[app].root, tab, cache: new Map() }];
  clearInterval(big.timer);
  big.timer = setInterval(bigTick, 1000);
  await bigDraw();
}

// An app opened at one of its pages (from the TV's feed): Back goes to the
// app's first page.
async function bigOpenPage(app, mode, load) {
  await bigOpen(app, mode);
  if (bigOn() && big.app === app) bigPush(load);
}

function bigClose() {
  if (!big.built) return;
  $("big").hidden = true;
  bigViewerClose();
  clearInterval(big.timer);
  big.stack = [];
  big.app = "";
  if (big.mode === "tv" && typeof tvFocusSoon === "function") tvFocusSoon();
}

// Back: the page before, else out of the app.
function bigBack() {
  if (!bigOn()) return false;
  if (big.viewer) { bigViewerClose(); return true; }
  if (big.stack.length > 1) { big.stack.pop(); bigDraw(true); return true; }
  bigClose();
  return true;
}

// Opens a page over this one; `load`: a function giving the page (or a
// promise of it).
// Where this page was scrolled to and what had the focus, to come back to.
function bigRemember(top) {
  if (!top) return;
  top.scroll = $("big-body").scrollTop;
  top.focus = [...$("big-body").querySelectorAll("button")].indexOf(document.activeElement);
}

function bigPush(load) {
  const top = big.stack.at(-1);
  bigRemember(top);
  big.stack.push({ page: null, load, tab: 0, cache: new Map() });
  bigDraw();
}

// The car's rail: home (the car's own screen), the apps, the time.
function bigRail() {
  const rail = $("big-rail");
  if (big.mode !== "car") return rail.replaceChildren();
  const home = el("button", { type: "button", class: "big-rail-home", "aria-label": "Car home" }, svg(BIG_ICONS.home));
  home.addEventListener("click", bigClose);
  rail.replaceChildren(el("div", { class: "big-rail-clock", id: "big-clock" }), home,
    ...BIG_CAR_APPS.map((id) => {
      const b = el("button", { type: "button", class: `big-rail-app${id === big.app ? " on" : ""}`, "aria-label": BIG_APPS[id].name },
        el("img", { src: `/static/dock/${BIG_APPS[id].icon}.svg`, alt: "", draggable: "false" }));
      b.addEventListener("click", () => (id === big.app ? (big.stack.length > 1 ? bigOpen(id, "car") : null) : bigOpen(id, "car")));
      return b;
    }));
  bigTick();
}

function bigTick() {
  if (!bigOn()) return;
  const clock = $("big-clock");
  if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  bigMini();
  if (big.stack.at(-1)?.page?.nowPlaying) bigNowUpdate();
}

// ------------------------------------------------------------- drawing

async function bigDraw(restore = false) {
  const top = big.stack.at(-1);
  if (!top) return;
  const gen = ++big.gen;
  const body = $("big-body");
  const tabsBox = $("big-tabs");
  if (!top.page) {
    $("big-head").replaceChildren(bigHeadBack(), el("h1", { class: "big-title" }, top.title || BIG_APPS[big.app].name));
    tabsBox.replaceChildren();
    tabsBox.bigPage = null;
    body.replaceChildren(el("p", { class: "big-loading" }, "Loading…"));
    try { top.page = await top.load(); } catch (e) { top.page = { title: BIG_APPS[big.app].name, empty: e?.message || "It didn't open." }; }
    if (gen !== big.gen) return;
  }
  const page = top.page;
  top.title = page.title;
  $("big-head").replaceChildren(bigHeadBack(), el("div", { class: "big-titles" },
    page.kicker ? el("div", { class: "big-kicker" }, page.kicker) : "", el("h1", { class: "big-title" }, page.title || "")));
  // Tabs: their own pages, each drawn once and kept while you're here.
  let content = page;
  if (page.tabs?.length) {
    // The same tabs: only which is on changes (the focus stays where it is).
    if (tabsBox.bigPage !== page) {
      tabsBox.bigPage = page;
      tabsBox.replaceChildren(...page.tabs.map((t, i) => {
        const b = el("button", { type: "button", role: "tab", class: "big-tab" }, t.label);
        b.addEventListener("click", () => { if (top.tab === i) return; top.tab = i; top.scroll = 0; bigDraw(); });
        // On the TV, as in tvOS: the focus on a tab shows it.
        if (big.mode === "tv") b.addEventListener("focus", () => { if (top.tab !== i) { top.tab = i; top.scroll = 0; bigDraw(); } });
        return b;
      }));
    }
    [...tabsBox.children].forEach((b, i) => { b.classList.toggle("on", i === top.tab); b.setAttribute("aria-selected", String(i === top.tab)); });
    if (big.mode === "tv" && !$("big").contains(document.activeElement)) tabsBox.querySelector(".big-tab.on")?.focus({ preventScroll: true });
    if (!top.cache.has(top.tab)) {
      body.replaceChildren(el("p", { class: "big-loading" }, "Loading…"));
      let got;
      try { got = await page.tabs[top.tab].page(); } catch (e) { got = { empty: e?.message || "It didn't open." }; }
      top.cache.set(top.tab, got);
      if (gen !== big.gen) return;
    }
    content = top.cache.get(top.tab);
  } else { tabsBox.replaceChildren(); tabsBox.bigPage = null; }
  body.replaceChildren(...bigContent(content));
  body.scrollTop = restore || top.scroll ? top.scroll || 0 : 0;
  bigMini();
  if (big.mode === "tv") {
    const keep = document.activeElement;
    const back = restore && top.focus >= 0 ? body.querySelectorAll("button")[top.focus] : null;
    if (back) back.focus({ preventScroll: true });
    else if (!$("big").contains(keep) || !keep.isConnected) {
      (tabsBox.querySelector(".big-tab.on") && !top.scroll ? tabsBox.querySelector(".big-tab.on") : body.querySelector("button, [tabindex='0']"))?.focus({ preventScroll: true });
    }
  }
}

function bigHeadBack() {
  if (big.stack.length <= 1 && big.mode === "car") return "";
  const b = el("button", { type: "button", class: "big-back", "aria-label": big.stack.length > 1 ? "Back" : "Close" }, svg(BIG_ICONS.back));
  b.addEventListener("click", bigBack);
  return b;
}

function bigContent(page) {
  if (page.nowPlaying) return [bigNowPage()];
  const out = [];
  if (page.hero) out.push(bigHero(page.hero));
  for (const s of page.sections || []) if (s.items?.length) out.push(bigSection(s));
  if (!out.length || (!page.hero && !(page.sections || []).some((s) => s.items?.length))) out.push(el("p", { class: "big-empty" }, page.empty || "Nothing here yet."));
  return out;
}

function bigHero(h) {
  const actions = (h.actions || []).map((a) => {
    const b = el("button", { type: "button", class: `big-action${a.primary ? " primary" : ""}` }, a.icon ? svg(a.icon) : "", el("span", {}, a.label));
    b.addEventListener("click", a.run);
    return b;
  });
  return el("div", { class: `big-hero shape-${h.shape || "square"}` },
    h.art ? el("div", { class: "big-hero-art" }, h.art) : "",
    el("div", { class: "big-hero-text" }, h.kicker ? el("div", { class: "big-kicker" }, h.kicker) : "",
      el("h2", {}, h.title || ""), h.sub ? el("p", { class: "big-hero-sub" }, h.sub) : "", h.text ? el("p", { class: "big-hero-about" }, h.text) : "",
      actions.length ? el("div", { class: "big-actions" }, ...actions) : ""));
}

// A long one (all your albums) is drawn 120 at a time, the next as you
// come near the end.
const BIG_CHUNK = 120;
function bigSection(s) {
  const layout = s.layout || "list";
  const make = (it) => (layout === "list" ? bigRow(it) : bigTile(it, s.shape));
  const box = el("div", { class: `big-items ${layout}${s.shape ? ` shape-${s.shape}` : ""}` }, ...s.items.slice(0, BIG_CHUNK).map(make));
  if (s.items.length > BIG_CHUNK && layout !== "shelf") {
    let shown = BIG_CHUNK;
    const more = el("div", { class: "big-more", "aria-hidden": "true" });
    const watch = new IntersectionObserver((seen) => {
      if (!seen.some((e) => e.isIntersecting)) return;
      box.append(...s.items.slice(shown, shown + BIG_CHUNK).map(make));
      shown += BIG_CHUNK;
      if (shown >= s.items.length) { watch.disconnect(); more.remove(); }
    }, { rootMargin: "600px" });
    requestAnimationFrame(() => watch.observe(more));
    return el("section", { class: `big-section ${layout}` }, s.title ? el("h3", { class: "big-section-title" }, s.title) : "", box, more);
  }
  return el("section", { class: `big-section ${layout}` }, s.title ? el("h3", { class: "big-section-title" }, s.title) : "", box);
}

function bigPress(node, it) {
  node.addEventListener("click", () => {
    if (it.page) return bigOn() ? bigPush(it.page) : bigOpenPage(it.app || big.app, carOn() ? "car" : "tv", it.page);
    it.run?.();
  });
  return node;
}

function bigBar(frac) {
  if (!(frac > 0.005)) return "";
  const bar = el("span", { class: "big-progress" }, el("span", {}));
  bar.firstChild.style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
  return bar;
}

// An item's picture: made when it's drawn (a function), or made already.
const bigArt = (it) => (typeof it.art === "function" ? it.art() : it.art);

function bigRow(it) {
  return bigPress(el("button", { type: "button", class: `big-row${it.now ? " now" : ""}` },
    it.lead != null ? el("span", { class: "big-row-lead" }, it.lead) : it.art ? el("span", { class: `big-row-art shape-${it.shape || "square"}` }, bigArt(it) || "") : "",
    el("span", { class: "big-row-text" }, el("span", { class: "big-row-title" }, it.title || ""), it.sub ? el("span", { class: "big-row-sub" }, it.sub) : "", bigBar(it.progress)),
    it.side ? el("span", { class: "big-row-side" }, it.side) : "",
    it.page ? el("span", { class: "big-row-go" }, svg(BIG_ICONS.right)) : ""), it);
}

function bigTile(it, shape) {
  const art = el("span", { class: `big-tile-art shape-${it.shape || shape || "square"}` }, bigArt(it) || "", bigBar(it.progress));
  return bigPress(el("button", { type: "button", class: "big-tile" }, art,
    it.title ? el("span", { class: "big-tile-title" }, it.title) : "", it.sub ? el("span", { class: "big-tile-sub" }, it.sub) : ""), it);
}

// What's playing, along the bottom (the car): a tap goes to the car's own
// Now Playing; its button plays and pauses.
function bigMini() {
  const mini = $("big-mini");
  if (!mini || big.mode !== "car") { if (mini) mini.hidden = true; return; }
  const pods = typeof carPods === "function" && carPods();
  const id = typeof muCurrent === "function" ? muCurrent() : null;
  if (!pods && !id) { mini.hidden = true; return; }
  const s = id ? muSong(id) : null;
  const key = pods ? `p|${pc.np.id}|${pc.np.ep}` : `m|${id}`;
  const paused = pods ? pc.audio.paused : music.audio.paused;
  if (mini.dataset.key !== key) {
    mini.dataset.key = key;
    const n = pods ? pcNow() : null;
    const open = el("button", { type: "button", class: "big-mini-open" },
      el("span", { class: "big-mini-art" }, pods ? pcArt(n.item || pc.byId.get(pc.np.id) || {}, 200) : musicArt(id)),
      el("span", { class: "big-mini-text" }, el("strong", {}, pods ? n.title : s?.title || ""), el("span", {}, pods ? n.sub || "" : s ? muArtists(s) : "")));
    open.addEventListener("click", bigClose);
    const play = el("button", { type: "button", class: "big-mini-play", id: "big-mini-play" });
    play.addEventListener("click", () => { (typeof carPods === "function" && carPods()) ? pcToggle() : musicToggle(); setTimeout(bigMini, 120); });
    mini.replaceChildren(open, play);
  }
  const play = $("big-mini-play");
  if (play.dataset.paused !== String(paused)) {
    play.dataset.paused = String(paused);
    play.replaceChildren(svg(paused ? BIG_ICONS.play : BIG_ICONS.pause));
    play.setAttribute("aria-label", paused ? "Play" : "Pause");
  }
  mini.hidden = false;
}

// Something to hear was picked: in the car, its Now Playing (the car's
// home); on the TV, a Now Playing page.
function bigListen() {
  if (carOn()) { bigClose(); return; }
  const page = { page: { title: "Now Playing", nowPlaying: true }, load: null, tab: 0, cache: new Map() };
  if (!bigOn()) {
    // From the TV's home: Now Playing on its own; Back goes home.
    bigBuild();
    big.mode = "tv";
    big.app = "music";
    $("big").className = "big big-tv";
    $("big").dataset.app = "music";
    $("big").hidden = false;
    bigRail();
    big.stack = [page];
    clearInterval(big.timer);
    big.timer = setInterval(bigTick, 1000);
  } else { bigRemember(big.stack.at(-1)); big.stack.push(page); }
  bigDraw().then(bigNowUpdate);
}

function bigNowPage() {
  const ctl = (id, icon, label, run, primary = false) => {
    const b = el("button", { type: "button", class: `big-now-ctl${primary ? " primary" : ""}`, id, "aria-label": label }, svg(icon));
    b.addEventListener("click", () => { run(); setTimeout(bigNowUpdate, 150); });
    return b;
  };
  const pods = () => typeof carPods === "function" && carPods();
  return el("div", { class: "big-now" }, el("div", { class: "big-now-art", id: "big-now-art" }),
    el("div", { class: "big-now-text" }, el("div", { class: "big-now-title", id: "big-now-title" }), el("div", { class: "big-now-sub", id: "big-now-sub" }),
      el("div", { class: "big-now-bar" }, el("span", { id: "big-now-bar" })), el("div", { class: "big-now-times" }, el("span", { id: "big-now-at" }), el("span", { id: "big-now-left" })),
      el("div", { class: "big-now-ctls" },
        ctl("big-now-prev", BIG_ICONS.prev, "Back", () => (pods() ? pcSkip(-30) : musicPrev())),
        ctl("big-now-play", BIG_ICONS.play, "Play", () => (pods() ? pcToggle() : musicToggle()), true),
        ctl("big-now-next", BIG_ICONS.next, "Next", () => (pods() ? pcSkip(30) : musicNext())))));
}

function bigNowUpdate() {
  if (!$("big-now-title")) return;
  const pods = typeof carPods === "function" && carPods();
  const id = typeof muCurrent === "function" ? muCurrent() : null;
  let title = "Nothing playing", sub = "", paused = true, at = 0, dur = 0, art = null, key = "none";
  if (pods) {
    const n = pcNow();
    title = n.title; sub = n.sub || ""; paused = pc.audio.paused; at = pcPos(); dur = pc.np.duration || 0;
    key = `p|${pc.np.id}|${pc.np.ep}`;
    if ($("big-now-art").dataset.key !== key) art = pcArt(n.item || pc.byId.get(pc.np.id) || {}, 600);
  } else if (id) {
    const s = muSong(id);
    title = s?.station && s.now ? s.now : s?.title || ""; sub = s ? (s.station ? s.title : muArtists(s)) : "";
    paused = music.audio.paused; at = music.audio.currentTime || 0; dur = Number.isFinite(music.audio.duration) ? music.audio.duration : 0;
    key = `m|${id}`;
    if ($("big-now-art").dataset.key !== key) art = musicArt(id);
  }
  if ($("big-now-art").dataset.key !== key) { $("big-now-art").dataset.key = key; $("big-now-art").replaceChildren(art || ""); }
  $("big-now-title").textContent = title;
  $("big-now-sub").textContent = sub;
  $("big-now-bar").style.width = `${dur ? Math.min(100, (at / dur) * 100) : 0}%`;
  const clock = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };
  $("big-now-at").textContent = dur ? clock(at) : "";
  $("big-now-left").textContent = dur ? `-${clock(dur - at)}` : "";
  const play = $("big-now-play");
  if (play.dataset.paused !== String(paused)) { play.dataset.paused = String(paused); play.replaceChildren(svg(paused ? BIG_ICONS.play : BIG_ICONS.pause)); play.setAttribute("aria-label", paused ? "Play" : "Pause"); }
  $("big-now-prev").replaceChildren(svg(pods ? BIG_ICONS.back30 : BIG_ICONS.prev));
  $("big-now-next").replaceChildren(svg(pods ? BIG_ICONS.fwd30 : BIG_ICONS.next));
}

// ------------------------------------------------------------- the photo viewer

// Full screen, one at a time: swiped (or the arrows) to the next, a video
// plays; the X (or Back) closes it.
function bigViewerOpen(list, i) {
  big.viewer = { list, i };
  const v = $("big-viewer");
  const button = (cls, icon, label, run) => {
    const b = el("button", { type: "button", class: `big-viewer-btn ${cls}`, "aria-label": label }, svg(icon));
    b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
    return b;
  };
  v.replaceChildren(el("div", { class: "big-viewer-stage", id: "big-viewer-stage" }),
    button("close", BIG_ICONS.close, "Close", bigViewerClose),
    button("prev", BIG_ICONS.left, "Previous", () => bigViewerStep(-1)),
    button("next", BIG_ICONS.right, "Next", () => bigViewerStep(1)),
    el("div", { class: "big-viewer-count", id: "big-viewer-count" }));
  v.hidden = false;
  let x0 = null;
  v.onpointerdown = (e) => { x0 = e.clientX; };
  v.onpointerup = (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 50) bigViewerStep(e.clientX < x0 ? 1 : -1); x0 = null; };
  bigViewerShow();
  if (big.mode === "tv") v.querySelector(".next")?.focus({ preventScroll: true });
}

function bigViewerShow() {
  const { list, i } = big.viewer;
  const a = list[i];
  const stage = $("big-viewer-stage");
  stage.replaceChildren(a.video
    ? el("video", { src: `/api/gallery/video/${a.id}`, controls: "", autoplay: "", playsinline: "", poster: gaThumb(a.id, "preview") })
    : el("img", { src: gaThumb(a.id, "preview"), alt: "", draggable: "false" }));
  $("big-viewer-count").textContent = `${i + 1} of ${list.length}`;
  // The next one, ready.
  const n = list[i + 1];
  if (n && !n.video) new Image().src = gaThumb(n.id, "preview");
}

function bigViewerStep(dir) {
  if (!big.viewer) return;
  const j = big.viewer.i + dir;
  if (j < 0 || j >= big.viewer.list.length) return;
  big.viewer.i = j;
  bigViewerShow();
}

function bigViewerClose() {
  if (!big.built) return;
  big.viewer = null;
  const v = $("big-viewer");
  v.hidden = true;
  v.replaceChildren();
}

// The TV's keys in the viewer: left and right are the photos.
function bigKeys(e) {
  if (!big.viewer) return false;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { bigViewerStep(e.key === "ArrowLeft" ? -1 : 1); return true; }
  return false;
}

// ------------------------------------------------------------- Music

function bigNoteMusic(ids, from) {
  if (!from) return;
  const p = music.playlists.find((x) => x.name === from && x.items.length === ids.length);
  let entry = p ? { kind: "playlist", key: p.id } : null;
  if (!entry) for (const a of music.albums.values()) if (a.title === from && a.ids.length === ids.length) { entry = { kind: "album", key: a.key }; break; }
  if (!entry) return;
  const list = winLoad(BIG_RECENT_KEY, []).filter((r) => !(r.kind === entry.kind && r.key === entry.key));
  winSave(BIG_RECENT_KEY, [entry, ...list].slice(0, 30));
}

async function bigMusicReady() {
  if (typeof musicBuild === "function") musicBuild();
  if (!music.loaded) await musicLoad();
  if (!music.loaded) throw new Error("Your music didn't load.");
}

const bigCount = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function bigAlbumItem(a) {
  return { title: a.title, sub: a.artist || "Unknown artist", art: () => musicArt(a.cover), page: () => bigAlbumPage(a) };
}
function bigListItem(p) {
  return { title: p.name, sub: bigCount(p.items.length, "song"), art: () => musicListArt(p), page: () => bigPlaylistPage(p) };
}

// Recently played: the albums and playlists you played (here or in Music),
// then the albums of the songs you played.
function bigMusicRecent() {
  const out = [], seen = new Set();
  for (const r of winLoad(BIG_RECENT_KEY, [])) {
    const it = r.kind === "album" ? music.albums.get(r.key) : music.playlists.find((p) => p.id === r.key);
    if (it && !seen.has(`${r.kind}|${r.key}`)) { seen.add(`${r.kind}|${r.key}`); out.push(r.kind === "album" ? bigAlbumItem(it) : bigListItem(it)); }
  }
  for (const id of music.plays.recent) {
    if (out.length >= 30) break;
    const key = musicAlbumKey(muSong(id));
    if (key && music.albums.has(key) && !seen.has(`album|${key}`)) { seen.add(`album|${key}`); out.push(bigAlbumItem(music.albums.get(key))); }
  }
  return out;
}

async function bigMusicRoot() {
  await bigMusicReady();
  return { title: "Music", tabs: [
    { label: "Recently Played", page: () => ({
      hero: { title: "Your library", sub: bigCount(music.all.length, "song"), shape: "none",
        actions: [{ label: "Shuffle all", icon: BIG_ICONS.shuffle, primary: true, run: () => { musicRadio({ kind: "all", label: "Your library" }); bigListen(); } }] },
      sections: [{ layout: big.mode === "tv" ? "shelf" : "grid", items: bigMusicRecent() }], empty: "Play an album or a playlist and it's here." }) },
    { label: "Playlists", page: () => ({ sections: [{ layout: "list", items: [...music.playlists].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).map(bigListItem) }], empty: "No playlists yet." }) },
    { label: "Albums", page: () => ({ sections: [{ layout: "grid", items: [...music.albums.values()].sort((a, b) => muCollator.compare(a.title, b.title)).map(bigAlbumItem) }] }) },
    { label: "Artists", page: () => ({ sections: [{ layout: "list", items: [...music.artists.values()].filter((a) => a.ids.length).sort((a, b) => muCollator.compare(a.name, b.name))
      .map((a) => ({ title: a.name, sub: bigCount(a.ids.length, "song"), shape: "round", art: () => musicArt(a.ids.find((id) => muSong(id)?.cover), { round: true }), page: () => bigArtistPage(a) })) }] }) },
  ] };
}

function bigSongs(ids, from, { numbers = false } = {}) {
  const cur = muCurrent();
  return ids.filter((id) => muSong(id)).map((id, i) => {
    const s = muSong(id);
    return { title: s.title, sub: numbers ? muArtists(s) : [muArtists(s), s.album].filter(Boolean).join(" · "), lead: numbers ? String(s.track || i + 1) : null,
      art: () => numbers ? null : musicArt(id), side: muTime(s.duration), now: id === cur,
      run: () => { musicPlayList(ids, i, { from, shuffle: false }); bigListen(); } };
  });
}

function bigPlayButtons(ids, from) {
  return [{ label: "Play", icon: BIG_ICONS.play, primary: true, run: () => { musicPlayList(ids, 0, { from, shuffle: false }); bigListen(); } },
    { label: "Shuffle", icon: BIG_ICONS.shuffle, run: () => { musicPlayList(ids, -1, { from, shuffle: true }); bigListen(); } }];
}

function bigAlbumPage(a) {
  return { title: a.title, hero: { art: musicArt(a.cover), title: a.title, sub: [a.artist, a.year].filter(Boolean).join(" · "), actions: bigPlayButtons(a.ids, a.title) },
    sections: [{ layout: "list", items: bigSongs(a.ids, a.title, { numbers: true }) }] };
}
function bigPlaylistPage(p) {
  return { title: p.name, hero: { art: musicListArt(p), title: p.name, sub: `${bigCount(p.items.length, "song")}, ${muLength(p.items)}`, actions: bigPlayButtons(p.items, p.name) },
    sections: [{ layout: "list", items: bigSongs(p.items, p.name) }] };
}
function bigArtistPage(a) {
  const albums = [...a.albums].map((k) => music.albums.get(k)).filter(Boolean).sort((x, y) => (y.year || 0) - (x.year || 0));
  const top = [...a.ids].sort((x, y) => (music.plays.counts[y] || 0) - (music.plays.counts[x] || 0)).slice(0, 40);
  return { title: a.name, hero: { art: musicArt(a.ids.find((id) => muSong(id)?.cover), { round: true }), shape: "round", title: a.name, sub: bigCount(a.ids.length, "song"),
    actions: [{ label: "Shuffle", icon: BIG_ICONS.shuffle, primary: true, run: () => { musicPlayList(a.ids, -1, { from: a.name, shuffle: true }); bigListen(); } }] },
  sections: [{ title: "Albums", layout: big.mode === "tv" ? "shelf" : "grid", items: albums.map(bigAlbumItem) }, { title: "Songs", layout: "list", items: bigSongs(top, a.name) }] };
}

// ------------------------------------------------------------- Podcasts

async function bigPodsReady() {
  if (typeof pcBuild === "function") pcBuild();
  if (!pc.loaded) await pcLoad();
  if (!pc.loaded) throw new Error("Your podcasts didn't load.");
}

function bigPodContinue() {
  return pcContinueList().map((x) => {
    const item = pc.byId.get(x.id);
    const d = x.p.d || item.duration || 0;
    return { title: x.ep ? pcEpisodeTitle(x.id, x.ep) || item.title : item.title, sub: x.ep ? item.title : item.author || "", art: () => pcArt(item, 300),
      progress: d ? x.p.t / d : 0, side: d ? `${pcLong(Math.max(0, d - x.p.t))} left` : "",
      run: () => { pcPlay(x.id, x.ep); bigListen(); } };
  });
}

function bigPodItem(item) {
  const st = item.kind === "book" ? pcState(item.id, "", item.duration) : null;
  return { title: item.title, sub: item.kind === "book" ? (st.done ? "Finished" : st.started ? st.text : item.author || "") : bigCount(item.count || 0, "episode"),
    art: () => pcArt(item, 400), progress: st?.started && !st.done ? st.frac : 0, page: () => bigPodPage(item) };
}

async function bigPodsRoot() {
  await bigPodsReady();
  const shows = pc.items.filter((i) => i.kind === "podcast"), books = pc.items.filter((i) => i.kind === "book");
  const by = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return { title: "Podcasts", tabs: [
    { label: "Continue", page: () => ({ sections: [{ layout: "list", items: bigPodContinue() }], empty: "Nothing half-heard: start an episode or a book." }) },
    { label: "New Episodes", page: () => ({ sections: [{ layout: "list", items: pc.episodes.slice(0, 40).map((e) => bigEpisode(e, true)) }], empty: "No new episodes." }) },
    { label: "Shows", page: () => ({ sections: [{ layout: "grid", items: shows.sort((a, b) => by.compare(a.title, b.title)).map(bigPodItem) }], empty: "No podcasts yet." }) },
    { label: "Audiobooks", page: () => ({ sections: [{ layout: "grid", items: books.sort((a, b) => by.compare(a.title, b.title)).map(bigPodItem) }], empty: "No audiobooks yet." }) },
  ] };
}

function bigEpisode(e, show = false) {
  const st = pcState(e.id, e.ep, e.duration);
  const now = pc.np?.id === e.id && pc.np.ep === e.ep;
  return { title: e.title, sub: [pcDate(e.date), show ? e.show || pc.byId.get(e.id)?.title : ""].filter(Boolean).join(" · "),
    art: () => show ? pcArt(pc.byId.get(e.id) || { title: e.show }, 200) : null, side: st.done ? "Played" : st.text, progress: st.started && !st.done ? st.frac : 0, now,
    run: () => { pcPlay(e.id, e.ep); bigListen(); } };
}

async function bigPodPage(item) {
  const d = await pcDetail(item.id).catch(() => null);
  if (item.kind === "book") {
    const st = pcState(item.id, "", item.duration);
    const chapters = d?.chapters || [];
    return { title: item.title, hero: { art: pcArt(item, 600), title: item.title, sub: [item.author, pcLong(item.duration)].filter(Boolean).join(" · "),
      text: st.started ? st.text : "", actions: [{ label: st.started && !st.done ? "Resume" : "Play", icon: BIG_ICONS.play, primary: true, run: () => { pcPlay(item.id, ""); bigListen(); } }] },
    sections: [{ title: chapters.length ? "Chapters" : "", layout: "list", items: chapters.map((c, i) => ({ title: c.title || `Chapter ${i + 1}`, lead: String(i + 1), side: pcTime(c.start),
      run: () => { pcPlay(item.id, "", c.start); bigListen(); } })) }] };
  }
  const eps = (d?.episodes || []).map((e) => ({ ...e, id: item.id }));
  const next = eps.find((e) => { const st = pcState(item.id, e.ep, e.duration); return st.started && !st.done; }) || eps[0];
  return { title: item.title, hero: { art: pcArt(item, 600), title: item.title, sub: [item.author, bigCount(eps.length, "episode")].filter(Boolean).join(" · "),
    actions: next ? [{ label: pcState(item.id, next.ep, next.duration).started ? "Resume" : "Play latest", icon: BIG_ICONS.play, primary: true, run: () => { pcPlay(item.id, next.ep); bigListen(); } }] : [] },
  sections: [{ title: "Episodes", layout: "list", items: eps.map((e) => bigEpisode(e)) }] };
}

// ------------------------------------------------------------- Videos

function bigVideoItem(i, shape) {
  const wide = shape === "wide";
  return { title: i.type === "episode" ? i.series || i.name : i.name, sub: i.type === "episode" ? [vdSub(i), i.name].filter(Boolean).join(" · ") : vdSub(i),
    art: () => vdArt(i, { wide }), shape, progress: i.runtime && i.pos ? i.pos / i.runtime : 0,
    ...(i.type === "series" || i.type === "folder" || i.type === "season" ? { page: () => bigVideoPage(i) } : { run: () => bigPlayVideo(i) }) };
}

// A film plays in Videos' own player, full screen; when it's done (or
// stopped), back here.
function bigPlayVideo(i, queue = null) {
  vdBuild();
  openWindow("videos");
  vdPlay(i, queue ? { queue } : {});
  vdLoad();
  clearInterval(big.videoWatch);
  big.videoWatch = setInterval(() => {
    if (vd.player) return;
    clearInterval(big.videoWatch);
    closeWindow("videos");
    if (big.mode === "tv" && typeof tvFocusSoon === "function") tvFocusSoon();
  }, 500);
}

async function bigVideosRoot() {
  const status = await api("/api/videos/status").then((r) => r.body).catch(() => null);
  if (status?.source === "jellyfin") {
    const h = await api("/api/videos/home").then((r) => (r.status === 200 ? r.body : null)).catch(() => null);
    if (!h) throw new Error("Jellyfin didn't answer.");
    const tabs = [{ label: "Home", page: () => ({
      sections: [{ title: "Continue Watching", layout: big.mode === "tv" ? "shelf" : "grid", shape: "wide", items: h.resume.map((i) => bigVideoItem(i, "wide")) },
        { title: "Up Next", layout: big.mode === "tv" ? "shelf" : "grid", shape: "wide", items: h.next.map((i) => bigVideoItem(i, "wide")) },
        ...h.latest.map((s) => ({ title: `New in ${s.name}`, layout: big.mode === "tv" ? "shelf" : "grid", shape: "poster", items: s.items.map((i) => bigVideoItem(i, "poster")) }))],
      empty: "Nothing in Jellyfin yet." }) },
    ...(h.libraries || []).map((lib) => ({ label: lib.name, page: async () => {
      const got = await api(`/api/videos/library?id=${lib.id}&start=0&sort=name`).then((r) => (r.status === 200 ? r.body : null));
      return { sections: [{ layout: "grid", shape: "poster", items: (got?.items || []).map((i) => bigVideoItem(i, "poster")) }], empty: "Nothing in it yet." };
    } }))];
    return { title: "Videos", tabs };
  }
  const folders = await api("/api/videos/local").then((r) => (r.status === 200 ? r.body.folders : [])).catch(() => []);
  return { title: "Videos", sections: folders.filter((f) => f.items.length).map((f) => ({ title: f.name, layout: "grid", shape: "wide", items: f.items.map((i) => bigVideoItem(i, "wide")) })),
    empty: "Nothing to watch yet: connect Jellyfin in Videos, or put films in Media/Documentaries." };
}

async function bigVideoPage(i) {
  if (i.local) return { title: i.name, sections: [{ layout: "grid", shape: "wide", items: (i.items || []).map((x) => bigVideoItem(x, "wide")) }] };
  const d = await api(`/api/videos/item?id=${i.id}`).then((r) => (r.status === 200 ? r.body : null));
  if (!d) throw new Error("Jellyfin didn't answer.");
  if (d.type === "series") {
    const all = d.seasons.flatMap((s) => s.episodes);
    const next = all.find((e) => e.pos && !e.played) || all.find((e) => !e.played) || all[0];
    return { title: d.name, hero: { art: vdArt(d), shape: "poster", title: d.name, sub: vdSub(d), text: d.overview || "",
      actions: next ? [{ label: next.pos ? `Resume ${vdSub(next).split(" · ").pop()}` : `Play ${vdSub(next).split(" · ").pop()}`, icon: BIG_ICONS.play, primary: true, run: () => bigPlayVideo(next, all) }] : [] },
    sections: d.seasons.map((s) => ({ title: s.name, layout: "list", items: s.episodes.map((e) => ({ title: e.name, sub: [e.episode != null ? `Episode ${e.episode}` : "", vdTime(e.runtime)].filter(Boolean).join(" · "),
      art: () => vdArt(e, { wide: true }), shape: "wide", side: e.played ? "Watched" : "", progress: e.runtime && e.pos ? e.pos / e.runtime : 0, run: () => bigPlayVideo(e, all) })) })) };
  }
  if (d.type === "folder") return { title: d.name, sections: [{ layout: "grid", shape: "poster", items: (d.items || []).map((x) => bigVideoItem(x, "poster")) }] };
  return { title: d.name, hero: { art: vdArt(d), shape: "poster", title: d.name, sub: vdSub(d), text: d.overview || "",
    actions: [{ label: d.pos ? "Resume" : "Play", icon: BIG_ICONS.play, primary: true, run: () => bigPlayVideo(d) }] } };
}

// ------------------------------------------------------------- Photos

function bigPhotoTiles(assets) {
  const list = assets.map((a) => ({ id: a.id, video: a.isImage === false || a.type === "VIDEO" }));
  return assets.map((a, i) => ({ art: () => el("img", { src: gaThumb(a.id), alt: "", loading: "lazy", decoding: "async", draggable: "false" }), shape: "photo",
    run: () => bigViewerOpen(list, i) }));
}

// The newest photos of a timeline (all of them, an album's, your
// favorites): its latest months, up to `max`.
async function bigTimeline(params, max = 240) {
  const q = new URLSearchParams(params).toString();
  const buckets = await gaGet(`buckets?${q}`);
  const out = [];
  for (const b of buckets) {
    if (out.length >= max) break;
    const c = await gaGet(`bucket?${q}&timeBucket=${encodeURIComponent(b.timeBucket)}`);
    c.id.forEach((id, k) => out.push({ id, isImage: c.isImage[k] }));
  }
  return out.slice(0, max);
}

async function bigPhotosRoot() {
  const status = await gaGet("status").catch(() => null);
  if (!status?.ok) throw new Error("Photos isn't connected to Immich yet: set it up in Photos.");
  return { title: "Photos", tabs: [
    { label: "Recent", page: async () => ({ sections: [{ layout: "grid", shape: "photo", items: bigPhotoTiles(await bigTimeline({ visibility: "timeline", order: "desc" })) }] }) },
    { label: "On This Day", page: async () => {
      const year = new Date().getFullYear();
      const mem = (await gaGet("memories").catch(() => [])).filter((m) => m.assets?.length);
      return { sections: mem.map((m) => ({ title: m.data?.year ? `${year - m.data.year} year${year - m.data.year === 1 ? "" : "s"} ago` : "A memory", layout: "grid", shape: "photo",
        items: bigPhotoTiles(m.assets.map((a) => ({ id: a.id, isImage: a.type === "IMAGE" }))) })), empty: "Nothing from this day in other years." };
    } },
    { label: "Albums", page: async () => {
      const albums = [...await gaGet("albums")].sort((a, b) => String(b.endDate || b.updatedAt).localeCompare(String(a.endDate || a.updatedAt)));
      return { sections: [{ layout: "grid", shape: "photo", items: albums.map((al) => ({ title: al.albumName, sub: `${al.assetCount.toLocaleString()} items`,
        art: () => al.albumThumbnailAssetId ? el("img", { src: gaThumb(al.albumThumbnailAssetId), alt: "", loading: "lazy", draggable: "false" }) : "",
        page: async () => ({ title: al.albumName, sections: [{ layout: "grid", shape: "photo", items: bigPhotoTiles(await bigTimeline({ albumId: al.id, order: al.order === "asc" ? "asc" : "desc" })) }], empty: "This album is empty." }) })) }],
      empty: "No albums yet." };
    } },
    { label: "Favorites", page: async () => ({ sections: [{ layout: "grid", shape: "photo", items: bigPhotoTiles(await bigTimeline({ isFavorite: "true", order: "desc" })) }], empty: "No favorites yet." }) },
  ] };
}

// ------------------------------------------------------------- Books (the TV)

function bigBookItem(b) {
  return { title: b.title, sub: b.pct >= 0.995 ? "Finished" : b.pct > 0 ? `${Math.max(1, Math.round(b.pct * 100))}%` : b.author || "", art: () => bkCover(b), shape: "poster",
    progress: b.pct > 0 && b.pct < 0.995 ? b.pct : 0, run: async () => { await openBooks(); bkOpenBook(b.id); if (typeof tvFocusSoon === "function") tvFocusSoon(); } };
}

async function bigBooksRoot() {
  if (typeof bkBuild === "function") bkBuild();
  if (!bk.loaded) await bkLoad();
  const item = bigBookItem;
  const by = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const reading = bk.books.filter((b) => b.at && b.pct < 0.995).sort((a, b) => b.at - a.at);
  return { title: "Books", tabs: [
    { label: "Reading Now", page: () => ({ sections: [{ title: "Continue Reading", layout: "shelf", shape: "poster", items: reading.map(item) },
      { title: "Recently Added", layout: "shelf", shape: "poster", items: [...bk.books].sort((a, b) => b.added - a.added).slice(0, 20).map(item) }], empty: "No books yet." }) },
    { label: "All Books", page: () => ({ sections: [{ layout: "grid", shape: "poster", items: [...bk.books].sort((a, b) => by.compare(a.title, b.title)).map(item) }], empty: "No books yet." }) },
  ] };
}

// ------------------------------------------------------------- Calendar

async function bigEvents(days) {
  const ymd = (d) => d.toLocaleDateString("sv-SE");
  const from = new Date(), to = new Date(Date.now() + days * 86400000);
  const q = new URLSearchParams({ from: ymd(from), to: ymd(to), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
  const r = await api(`/api/calendar/events?${q}`);
  if (r.status === 409) throw new Error("Calendar isn't set up yet: connect it in Calendar.");
  if (r.status !== 200) throw new Error("Can't reach your calendar.");
  const at = (e) => (e.allDay ? new Date(`${e.start}T00:00`) : new Date(e.start));
  const end = (e) => (e.allDay ? new Date(`${e.end || e.start}T00:00`).getTime() + (e.end ? 0 : 86400000) : new Date(e.end || e.start).getTime());
  return (r.body.events || []).filter((e) => end(e) > Date.now()).map((e) => ({ ...e, at: at(e) })).sort((a, b) => a.at - b.at);
}

function bigDayName(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const n = Math.round((day - today) / 86400000);
  return n <= 0 ? "Today" : n === 1 ? "Tomorrow" : day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

function bigEventItem(e) {
  const time = e.allDay ? "All day" : e.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { title: e.title || "(No title)", sub: e.location || "", lead: time, page: () => bigEventPage(e) };
}

function bigEventPage(e) {
  const when = e.allDay ? `${bigDayName(e.at)}, all day` : `${bigDayName(e.at)}, ${e.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${e.end ? `–${new Date(e.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`;
  const actions = e.location && big.mode === "car" ? [{ label: "Navigate there", icon: BIG_ICONS.nav, primary: true, run: () => carGo(e.location) }] : [];
  return { title: e.title || "(No title)", hero: { shape: "none", kicker: when, title: e.title || "(No title)", sub: e.location || "", text: e.notes || "", actions } };
}

async function bigCalendarRoot() {
  const events = await bigEvents(14);
  const byDay = new Map();
  for (const e of events) {
    const k = bigDayName(e.at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const today = events.filter((e) => bigDayName(e.at) === "Today");
  return { title: "Calendar", tabs: [
    { label: "Today", page: () => ({ sections: [{ layout: "list", items: today.map(bigEventItem) }], empty: "Nothing else today." }) },
    { label: "Coming Up", page: () => ({ sections: [...byDay].map(([day, list]) => ({ title: day, layout: "list", items: list.map(bigEventItem) })), empty: "Nothing in the next two weeks." }) },
  ] };
}
