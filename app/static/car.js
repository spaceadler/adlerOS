// Car mode: adlerOS on a phone in the car (turned sideways, on a mount).
// Only big things you can hit without looking twice: what's playing (Music
// or Podcasts) with large controls, and big tiles, two to a row, scrolled
// up and down: Navigate and Calendar, Music and Podcasts, then Photos and
// Videos (a film for the passengers) and the way out, back to the mode you
// came from. Navigate hands the drive to the phone's Google Maps (it has
// the traffic and the voice), to a place you saved (Home, Work, ones you
// named) or typed, and remembers the last few; the places are kept on the
// server, so every device has the same ones. One of the modes (windows.js
// MODES), kept per device.
// Uses $, el, svg, api, toast, winLoad, winSave, wm, isOpen, desktopMode,
// switchDesktopMode, DESKTOP_MODE_KEY, layout, openModal, closeModal,
// currentMode, setMode, tvOn, setTv, the apps' open functions, and Music's
// and Podcasts' players.
"use strict";

const CAR_KEY = "adleros.carMode";
const CAR_BEFORE_KEY = "adleros.carBefore"; // the mode to go back to
const CAR_PLACES_KEY = "adleros.carPlaces"; // the server's, for offline
const car = { built: false, timer: null, shown: "", places: null, seeking: null, lyrics: null, event: null, eventAt: 0, morph: null };

const CAR_ICONS = {
  nav: ["M3 11l18-8-8 18-2-8z"],
  calendar: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
  music: ["M9 18V5l12-2v13", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  pods: ["M12 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M8.5 15a5 5 0 1 1 7 0", "M6 18a8.5 8.5 0 1 1 12 0", "M12 13v8"],
  photos: ["M4 5h16v14H4z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 9.5a1.5 1.5 0 1 0 0-.01"],
  videos: ["M3 6h13v12H3z", "M16 10l5-3v10l-5-3"],
  exit: ["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4", "M10 17l-5-5 5-5", "M5 12h12"],
  play: ["M7 4l13 8-13 8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"],
  next: ["M5 4l10 8-10 8z", "M19 5v14"], prev: ["M19 20 9 12l10-8z", "M5 19V5"],
  back30: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"], fwd30: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"],
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"], work: ["M3 7h18v13H3z", "M8 7V4h8v3"], pin: ["M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12z", "M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  star: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"],
  x: ["M18 6 6 18", "M6 6l12 12"], plus: ["M12 5v14", "M5 12h14"], check: ["M5 12l5 5 9-10"],
  expand: ["M5 12h14", "m13 6 6 6-6 6"], collapse: ["M19 12H5", "m11 6-6 6 6 6"],
};

function carOn() { return document.body.classList.contains("car"); }

function setCar(on, quiet = false) {
  if (on === carOn()) return;
  if (on) {
    winSave(CAR_BEFORE_KEY, currentMode()); // where "Leave car mode" goes back to
    if (tvOn()) { document.body.classList.remove("tv"); winSave(TV_KEY, false); $("tv")?.setAttribute("hidden", ""); }
    if (desktopMode()) { switchDesktopMode(false); winSave(DESKTOP_MODE_KEY, false); }
  }
  for (const [id, w] of wm.windows) if (isOpen(id)) (w.hide || w.close)();
  document.body.classList.toggle("car", on);
  winSave(CAR_KEY, on);
  if (on) carShow();
  else { bigClose(); $("car")?.setAttribute("hidden", ""); clearInterval(car.timer); layout(true); }
  if (!quiet) toast(on ? "Car mode. Eyes on the road." : "Car mode off.");
}

// Back to the mode you were in before the car: the home screen, desktop
// mode or the TV.
function carLeave() {
  const before = winLoad(CAR_BEFORE_KEY, "home");
  const back = ["home", "desktop", "tv"].includes(before) ? before : "home";
  setCar(false, back !== "home");
  if (back !== "home") setMode(back);
}

// ------------------------------------------------------------- the screen

function carBuild() {
  if (car.built) return;
  car.built = true;
  const tile = (cls, icon, label, run) => {
    const b = el("button", { type: "button", class: `car-tile ${cls}` }, svg(icon), el("span", {}, label));
    b.addEventListener("click", run);
    return b;
  };
  const control = (id, icon, label) => el("button", { type: "button", class: "car-ctl", id, "aria-label": label }, svg(icon));
  const node = el("section", { id: "car", class: "car-home", "aria-label": "Car", hidden: "" },
    el("div", { class: "car-clock", id: "car-clock" }, el("span", { class: "car-next-event", id: "car-event" }), el("span", { class: "car-clock-time", id: "car-time" })),
    el("div", { class: "car-now", id: "car-now" },
      el("div", { class: "car-bgart", id: "car-bgart", "aria-hidden": "true" }),
      el("div", { class: "car-head" },
        el("button", { type: "button", class: "car-art", id: "car-art", "aria-label": "Lyrics" }),
        el("div", { class: "car-text" }, el("div", { class: "car-title", id: "car-title" }), el("div", { class: "car-sub", id: "car-sub" }))),
      el("div", { class: "car-lyrics", id: "car-lyrics" }),
      el("div", { class: "car-seek", id: "car-seek" }, el("span", { class: "car-time", id: "car-at" }),
        el("div", { class: "car-bar" }, el("span", { id: "car-bar" }), el("i", { class: "car-knob", id: "car-knob" })),
        el("span", { class: "car-time", id: "car-left" })),
      el("div", { class: "car-ctls" }, control("car-prev", CAR_ICONS.prev, "Back"), control("car-play", CAR_ICONS.play, "Play"), control("car-next", CAR_ICONS.next, "Next")),
      el("button", { type: "button", class: "car-expand", id: "car-expand", "aria-label": "Full screen" }, svg(CAR_ICONS.expand))),
    el("div", { class: "car-tiles", id: "car-tiles" }, el("div", { class: "car-track", id: "car-track" },
      tile("nav", CAR_ICONS.nav, "Navigate", () => carNavigate()),
      tile("calendar", CAR_ICONS.calendar, "Calendar", () => bigOpen("calendar", "car")),
      tile("music", CAR_ICONS.music, "Music", () => bigOpen("music", "car")),
      tile("pods", CAR_ICONS.pods, "Podcasts", () => bigOpen("podcasts", "car")),
      tile("photos", CAR_ICONS.photos, "Photos", () => bigOpen("photos", "car")),
      tile("videos", CAR_ICONS.videos, "Videos", () => bigOpen("videos", "car")),
      tile("exit", CAR_ICONS.exit, "Leave car mode", () => carLeave()))),
    el("div", { class: "car-dots", id: "car-dots", "aria-hidden": "true" }));
  $("desktop").after(node);
  carPaging();
  carSeekBar();
  $("car-play").addEventListener("click", carToggle);
  $("car-art").addEventListener("click", () => carLyricsMode(!$("car").classList.contains("car-words")));
  $("car-expand").addEventListener("click", () => carFull(!$("car").classList.contains("car-full")));
  // The words follow the song (a few times a second, while they show).
  music.audio.addEventListener("timeupdate", carLyricsFollow);
  addEventListener("resize", () => { if ($("car").classList.contains("car-full")) $("car-now").style.cssText = ""; });
  $("car-prev").addEventListener("click", () => (carPods() ? pcSkip(-30) : carMusicReady() && musicPrev()));
  $("car-next").addEventListener("click", () => (carPods() ? pcSkip(30) : carMusicReady() && musicNext()));
}

// The tiles: two rows in sight, moved a row at a time by a swipe (or the
// wheel). Our own, not the browser's scrolling: its snapping let a tap land
// on the tile the rows were still moving to, on a phone. A finger that
// moves is a swipe, never a press.
function carPaging() {
  const box = $("car-tiles"), track = $("car-track");
  const page = { row: 0, y: null, dy: 0, swiped: false, wheel: 0, wheelAt: 0 };
  const step = () => (track.firstElementChild?.offsetHeight || 0) + 12;
  const rows = () => Math.round((track.scrollHeight + 12) / step());
  const last = () => Math.max(0, rows() - 2);
  const place = (animate = true) => {
    page.row = Math.min(last(), Math.max(0, page.row));
    track.style.transition = animate ? "" : "none";
    track.style.transform = `translateY(${-page.row * step() + page.dy}px)`;
    $("car-dots").replaceChildren(...Array.from({ length: last() + 1 }, (_, i) => el("span", { class: i === page.row ? "on" : "" })));
  };
  const size = () => { box.style.setProperty("--car-row", `${Math.max(60, (box.clientHeight - 12) / 2)}px`); place(false); };
  new ResizeObserver(size).observe(box);
  box.addEventListener("pointerdown", (e) => { if (e.isPrimary) { page.y = e.clientY; page.dy = 0; page.swiped = false; } });
  box.addEventListener("pointermove", (e) => {
    if (page.y == null || !e.isPrimary) return;
    const dy = e.clientY - page.y;
    if (!page.swiped && Math.abs(dy) < 10) return;
    if (!page.swiped) { page.swiped = true; box.setPointerCapture?.(e.pointerId); }
    // Past the first or last row it gives a little, not a lot.
    const edge = (page.row === 0 && dy > 0) || (page.row === last() && dy < 0);
    page.dy = edge ? dy / 4 : dy;
    place(false);
  });
  const end = (e) => {
    if (page.y == null || !e.isPrimary) return;
    const dy = page.dy;
    page.y = null;
    page.dy = 0;
    if (page.swiped) {
      if (Math.abs(dy) > 36) page.row -= Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / step()));
      place();
      // A click that comes with the end of a swipe (a mouse's does) opens
      // nothing; the next tap does.
      const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => { removeEventListener("click", swallow, { capture: true }); page.swiped = false; }, 60);
    }
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (Date.now() - page.wheelAt < 350) return;
    page.wheel += e.deltaY;
    if (Math.abs(page.wheel) < 30) return;
    page.row += Math.sign(page.wheel);
    page.wheel = 0;
    page.wheelAt = Date.now();
    place();
  }, { passive: false });
}

function carShow() {
  carBuild();
  $("car").hidden = false;
  car.shown = "";
  carUpdate();
  clearInterval(car.timer);
  car.timer = setInterval(carUpdate, 1000);
  carPlacesLoad(); // fresh from the server, for Navigate
  carNextEvent();
}

// Seeking: drag along the bar (or tap a spot on it); it goes there on
// letting go. A radio station has nowhere to go.
function carDuration() {
  if (carPods()) return pc.np?.duration || 0;
  const d = music.audio.duration;
  return carMusicReady() && Number.isFinite(d) && d > 0 ? d : 0;
}
function carClock(t) {
  t = Math.max(0, Math.round(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
function carShowAt(frac) {
  const d = carDuration();
  const f = Math.min(1, Math.max(0, frac || 0));
  $("car-bar").style.width = `${Math.round(f * 1000) / 10}%`;
  $("car-knob").style.left = `${Math.round(f * 1000) / 10}%`;
  $("car-seek").classList.toggle("off", !d);
  $("car-at").textContent = d ? carClock(f * d) : "";
  $("car-left").textContent = d ? `-${carClock(d - f * d)}` : "";
}
function carSeekBar() {
  const seek = $("car-seek");
  const at = (e) => { const r = seek.querySelector(".car-bar").getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  seek.addEventListener("pointerdown", (e) => {
    if (!carDuration()) return;
    car.seeking = at(e);
    seek.setPointerCapture?.(e.pointerId);
    seek.classList.add("seeking");
    carShowAt(car.seeking);
  });
  seek.addEventListener("pointermove", (e) => { if (car.seeking != null) { car.seeking = at(e); carShowAt(car.seeking); } });
  const done = (go) => {
    if (car.seeking == null) return;
    const d = carDuration(), f = car.seeking;
    car.seeking = null;
    seek.classList.remove("seeking");
    if (go && d) {
      if (carPods()) pcSeek(f * d);
      else music.audio.currentTime = f * d;
    }
    carUpdate();
  };
  seek.addEventListener("pointerup", () => done(true));
  seek.addEventListener("pointercancel", () => done(false));
}

// What's on: a podcast or book that's playing (or paused, last touched),
// else Music's song.
function carPods() { return typeof pcOwnsMedia === "function" && pcOwnsMedia() && (!pc.audio.paused || music.audio.paused); }
function carMusicReady() { return typeof muCurrent === "function" && Boolean(muCurrent()); }

async function carToggle() {
  if (carPods()) return pcToggle();
  if (!carMusicReady()) {
    // Nothing queued: your whole library, shuffled (once it's loaded).
    if (!music.loaded) { toast("Getting your music…"); await musicLoad(); }
    if (music.loaded && music.all.length) musicRadio({ kind: "all", label: "Your library" });
    return;
  }
  musicToggle();
}

function carUpdate() {
  if (!carOn()) return;
  $("car-time").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (Date.now() - (car.eventAt || 0) > 300000) carNextEvent();
  else carEventShow();
  const pods = carPods();
  let title = "Nothing playing", sub = "Tap play for your music, shuffled", paused = true, frac = 0, art = null, key;
  if (pods) {
    const n = pcNow();
    title = n.title; sub = n.sub || ""; paused = pc.audio.paused;
    frac = pc.np.duration ? pcPos() / pc.np.duration : 0;
    key = `p|${pc.np.id}|${pc.np.ep}`;
    if (key !== car.shown) art = pcArt(pc.np.item || pc.byId.get(pc.np.id) || {}, 400);
  } else if (carMusicReady()) {
    const id = muCurrent(), s = muSong(id);
    title = s?.station && s.now ? s.now : s?.title || ""; sub = s ? (s.station ? s.title : muArtists(s)) : "";
    paused = music.audio.paused;
    frac = music.audio.duration ? music.audio.currentTime / music.audio.duration : 0;
    key = `m|${id}`;
    if (key !== car.shown) art = musicArt(id);
  } else key = "none";
  if (key !== car.shown) {
    car.shown = key;
    $("car-art").replaceChildren(art || svg(CAR_ICONS.music));
    // The cover, big and soft, behind the full screen player.
    const pic = art?.querySelector?.("img")?.src || "";
    $("car-bgart").style.backgroundImage = pic ? `url("${pic}")` : "";
    carLyricsLoad();
    $("car-title").textContent = title;
    $("car-sub").textContent = sub;
    // A book or an episode: 30 s back and on, not the last and next song.
    $("car-prev").replaceChildren(svg(pods ? CAR_ICONS.back30 : CAR_ICONS.prev));
    $("car-next").replaceChildren(svg(pods ? CAR_ICONS.fwd30 : CAR_ICONS.next));
    $("car-prev").setAttribute("aria-label", pods ? "Back 30 seconds" : "Last song");
    $("car-next").setAttribute("aria-label", pods ? "On 30 seconds" : "Next song");
  } else if (pods || carMusicReady()) {
    $("car-title").textContent = title;
    $("car-sub").textContent = sub;
  }
  $("car-play").replaceChildren(svg(paused ? CAR_ICONS.play : CAR_ICONS.pause));
  $("car-play").setAttribute("aria-label", paused ? "Play" : "Pause");
  if (car.seeking == null) carShowAt(frac);
  $("car-prev").disabled = $("car-next").disabled = !(pods || carMusicReady());
}

// ------------------------------------------------------------- the words

// The song's lyrics (Music's: an .lrc beside it, or its own), for the cover's
// tap (the cover small, top left, the words under it) and the full screen
// player (the words over the cover). Fetched when one of them shows.
function carLyricsWanted() { const c = $("car").classList; return c.contains("car-words") || c.contains("car-full"); }

async function carLyricsLoad() {
  if (!carLyricsWanted()) return;
  const id = !carPods() && carMusicReady() ? muCurrent() : null;
  if (car.lyrics?.id === id && !car.lyrics.loading) return carLyricsDraw();
  car.lyrics = { id, loading: Boolean(id), lines: [] };
  carLyricsDraw();
  if (!id) return;
  const s = muSong(id);
  let got = { id, lines: [] };
  if (music.lyrics?.id === id && !music.lyrics.loading) got = music.lyrics;
  else if (s?.lyrics) {
    const { status, body } = await api(`/api/music/lyrics?id=${encodeURIComponent(id)}`).catch(() => ({ status: 0 }));
    if (status === 200 && body?.text) got = { id, ...musicParseLyrics(body.text) };
  }
  if (car.lyrics?.id !== id) return;
  car.lyrics = { id, synced: got.synced, lines: got.lines || [] };
  carLyricsDraw();
}

function carLyricsDraw() {
  const box = $("car-lyrics"), l = car.lyrics;
  const none = !l?.loading && !l?.lines?.length;
  $("car-now").classList.toggle("no-lyrics", none);
  if (!l || l.loading) return box.replaceChildren(el("p", { class: "car-line wait" }, "…"));
  if (none) return box.replaceChildren(el("p", { class: "car-line none" }, carPods() ? "No lyrics for this." : "No lyrics for this song."));
  box.classList.toggle("synced", Boolean(l.synced));
  box.replaceChildren(...l.lines.map((line, i) => el("p", { class: "car-line", "data-i": String(i) }, line.text || "♪")));
  l.at = null;
  carLyricsFollow(true);
}

// The line being sung: lit, and in the middle of the space there is.
function carLyricsFollow(jump = false) {
  const l = car.lyrics, box = $("car-lyrics");
  if (!l?.synced || !box || !carLyricsWanted() || l.id !== muCurrent()) return;
  const t = music.audio.currentTime + 0.2;
  let i = -1;
  for (let k = 0; k < l.lines.length && l.lines[k].t <= t; k++) i = k;
  if (i === l.at && jump !== true) return;
  l.at = i;
  box.querySelectorAll(".car-line").forEach((n, k) => { n.classList.toggle("past", k < i); n.classList.toggle("now", k === i); });
  const line = box.querySelector(`.car-line[data-i="${i}"]`);
  if (line) box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2, behavior: jump === true ? "auto" : "smooth" });
}

// The cover's tap: it shrinks to the top left, the song and the artist
// beside it, the words under them; again, back. The cover moves to its new
// place (it's measured before and after).
function carLyricsMode(on) {
  const art = $("car-art");
  const before = art.getBoundingClientRect();
  $("car").classList.toggle("car-words", on);
  carGlide(art, before);
  if (on) carLyricsLoad();
}

function carGlide(node, before) {
  const after = node.getBoundingClientRect();
  if (!after.width || !before.width) return;
  node.style.transition = "none";
  node.style.transformOrigin = "top left";
  node.style.transform = `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width})`;
  node.getBoundingClientRect();
  node.style.transition = "transform 0.42s cubic-bezier(0.3, 0.8, 0.2, 1)";
  node.style.transform = "";
  setTimeout(() => { node.style.transition = ""; node.style.transformOrigin = ""; }, 460);
}

// The → button: the tiles and the time go off to the right and the player
// grows to fill the screen, the cover behind it (and the words, if the song
// has them); ← brings it all back.
function carFull(on) {
  const home = $("car"), now = $("car-now");
  const from = now.getBoundingClientRect();
  if (on) {
    const cs = getComputedStyle(home);
    const to = { left: parseFloat(cs.paddingLeft), top: parseFloat(cs.paddingTop),
      width: home.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), height: home.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) };
    home.classList.add("car-full");
    carMorph(now, from, to);
    carLyricsLoad();
  } else {
    home.classList.remove("car-full");
    now.style.cssText = "";
    const to = now.getBoundingClientRect();
    carMorph(now, from, to);
  }
  $("car-expand").replaceChildren(svg(on ? CAR_ICONS.collapse : CAR_ICONS.expand));
  $("car-expand").setAttribute("aria-label", on ? "Back to the tiles" : "Full screen");
}

// From one place and size to another, then back to its own rules.
function carMorph(node, from, to) {
  const px = (r) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  Object.assign(node.style, { position: "absolute", gridArea: "auto", margin: "0", zIndex: "3", transition: "none", ...px(from) });
  node.getBoundingClientRect();
  node.style.transition = "left 0.45s cubic-bezier(0.3, 0.8, 0.2, 1), top 0.45s cubic-bezier(0.3, 0.8, 0.2, 1), width 0.45s cubic-bezier(0.3, 0.8, 0.2, 1), height 0.45s cubic-bezier(0.3, 0.8, 0.2, 1)";
  Object.assign(node.style, px(to));
  clearTimeout(car.morph);
  car.morph = setTimeout(() => { node.style.cssText = ""; carLyricsFollow(true); }, 480);
}

// ------------------------------------------------------------- what's next

// Left of the time, in grey: your next event today or later, and its time
// (one without a time, all day, isn't shown).
async function carNextEvent() {
  car.eventAt = Date.now();
  const list = await bigEvents(3).catch(() => []);
  car.event = list.find((e) => !e.allDay && e.at.getTime() > Date.now()) || null;
  carEventShow();
}

function carEventShow() {
  const box = $("car-event");
  if (!box) return;
  const e = car.event;
  if (!e || e.at.getTime() <= Date.now()) { box.textContent = ""; box.hidden = true; return; }
  const today = new Date().toDateString() === e.at.toDateString();
  const time = e.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  box.textContent = `${e.title || "(No title)"} · ${today ? time : `${e.at.toLocaleDateString([], { weekday: "short" })} ${time}`}`;
  box.hidden = false;
}

// ------------------------------------------------------------- navigate

// The places: { home, work, named: [{name, where}], recent: [where] }. The
// server's are the ones; this device keeps a copy for when it's offline.
function carPlacesClean(p) {
  return { home: p?.home || "", work: p?.work || "", named: Array.isArray(p?.named) ? p.named.filter((n) => n?.name && n?.where) : [],
    recent: Array.isArray(p?.recent) ? p.recent.filter(Boolean).slice(0, 6) : [], at: p?.at || 0 };
}
function carPlaces() { return car.places || carPlacesClean(winLoad(CAR_PLACES_KEY, null)); }

async function carPlacesLoad() {
  const got = await api("/api/car/places").then((r) => (r.status === 200 ? r.body : null)).catch(() => null);
  if (!got) return carPlaces();
  const local = carPlacesClean(winLoad(CAR_PLACES_KEY, null));
  // Nothing on the server yet: what this device had goes up, once.
  if (!got.at && (local.home || local.work || local.named.length || local.recent.length)) return carPlacesSave(local);
  car.places = carPlacesClean(got);
  winSave(CAR_PLACES_KEY, car.places);
  return car.places;
}

async function carPlacesSave(p) {
  car.places = carPlacesClean(p);
  winSave(CAR_PLACES_KEY, car.places);
  const r = await api("/api/car/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(car.places) }).catch(() => null);
  if (r?.status === 200 && r.body) { car.places = carPlacesClean(r.body); winSave(CAR_PLACES_KEY, car.places); }
  else toast("Saved on this device; the server didn't answer.");
  return car.places;
}

function carGo(place) {
  const where = place.trim();
  if (!where) return;
  const p = carPlaces();
  const saved = where === p.home || where === p.work || p.named.some((n) => n.where === where);
  if (!saved) { p.recent = [where, ...p.recent.filter((r) => r !== where)].slice(0, 6); carPlacesSave(p); }
  closeModal();
  // On a phone this opens Google Maps itself, with the route, ready to go.
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(where)}&travelmode=driving`, "_blank", "noopener");
}

// Changed the places: the dialog again, as it is now.
async function carPlacesChange(change, note) {
  const p = carPlaces();
  change(p);
  if (note) toast(note);
  carNavigateDraw();
  await carPlacesSave(p);
  carNavigateDraw();
}

function carNavigate() {
  const input = el("input", { class: "field-input car-input", id: "car-where", type: "search", placeholder: "Where to?", autocomplete: "street-address", enterkeyhint: "go", "aria-label": "Where to" });
  const go = el("button", { type: "button", class: "car-go" }, "Go");
  go.addEventListener("click", () => carGo(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") carGo(input.value); });
  const close = el("button", { type: "button", class: "car-go secondary" }, "Close");
  close.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material car-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Navigate" },
    el("div", { class: "car-search" }, input, go),
    el("div", { class: "car-places", id: "car-places" }),
    el("div", { class: "dialog-actions" }, close)));
  carNavigateDraw();
  carPlacesLoad().then(() => { if ($("car-places")) carNavigateDraw(); });
}

// A corner button on a place: its X (clear or delete), its + (name it).
function carCorner(kind, label, run) {
  const b = el("button", { type: "button", class: `car-corner ${kind}`, "aria-label": label }, svg(CAR_ICONS[kind]));
  b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
  return b;
}

function carNavigateDraw() {
  const list = $("car-places");
  if (!list) return;
  const p = carPlaces();
  const input = $("car-where");
  const place = (icon, label, where, corners, onTap) => {
    const b = el("button", { type: "button", class: "car-place-main" }, svg(icon),
      el("span", { class: "car-place-text" }, el("span", {}, label), where !== null ? el("small", {}, where || "Tap to set") : ""));
    b.addEventListener("click", onTap);
    return el("div", { class: `car-place${corners.length ? " has-corners" : ""}` }, b, el("div", { class: "car-corners" }, ...corners));
  };
  // Home and Work: an address, or empty to set by typing it and tapping.
  const fixed = (key, icon, label) => {
    const where = p[key];
    return place(icon, label, where, where ? [carCorner("x", `Clear ${label}`, () => carPlacesChange((q) => { q[key] = ""; }, `${label} cleared.`))] : [], () => {
      if (where) return carGo(where);
      const v = input.value.trim();
      if (!v) { toast(`Type ${label === "Home" ? "your home's" : "your work's"} address above, then tap ${label} again.`); return input.focus(); }
      input.value = "";
      carPlacesChange((q) => { q[key] = v; }, `${label} saved.`);
    });
  };
  const named = p.named.map((n) => place(CAR_ICONS.star, n.name, n.where,
    [carCorner("x", `Delete ${n.name}`, () => carPlacesChange((q) => { q.named = q.named.filter((m) => m.name !== n.name); }, `${n.name} deleted.`))],
    () => carGo(n.where)));
  const recent = p.recent.map((r) => {
    const tile = place(CAR_ICONS.pin, r, null, [
      carCorner("plus", "Give it a name", () => carNameIt(tile, r)),
      carCorner("x", "Delete it", () => carPlacesChange((q) => { q.recent = q.recent.filter((x) => x !== r); })),
    ], () => carGo(r));
    return tile;
  });
  list.replaceChildren(fixed("home", CAR_ICONS.home, "Home"), fixed("work", CAR_ICONS.work, "Work"), ...named, ...recent);
}

// A recent place's +: a name for it, and it's saved like Home and Work.
function carNameIt(tile, where) {
  const name = el("input", { class: "field-input car-name", type: "text", placeholder: "Name it", maxlength: "40", enterkeyhint: "done", "aria-label": "Name for this place" });
  const save = () => {
    const v = name.value.trim();
    if (!v) return name.focus();
    const p = carPlaces();
    if (["home", "work"].includes(v.toLowerCase()) || p.named.some((n) => n.name.toLowerCase() === v.toLowerCase())) { toast(`There's a ${v} already.`); return name.focus(); }
    carPlacesChange((q) => { q.named.push({ name: v, where }); q.recent = q.recent.filter((x) => x !== where); }, `${v} saved.`);
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); carNavigateDraw(); } });
  tile.classList.add("naming");
  tile.replaceChildren(el("div", { class: "car-place-name" }, svg(CAR_ICONS.star), name,
    carCorner("check", "Save", save), carCorner("x", "Cancel", carNavigateDraw)));
  name.focus();
}

// Back on (this device was in car mode): before the first draw.
if (winLoad(CAR_KEY, false) === true) document.body.classList.add("car");
