// Car mode: adlerOS on a phone in the car (turned sideways, on a mount).
// Only big things you can hit without looking twice: what's playing (Music
// or Podcasts) with large controls, and four tiles: Navigate, Music,
// Podcasts, and the way out. Navigate hands the drive to the phone's
// Google Maps (it has the traffic and the voice), to a place you saved
// (Home, Work) or typed, and remembers the last few. One of the modes
// (windows.js MODES), kept per device.
// Uses $, el, svg, toast, winLoad, winSave, wm, isOpen, desktopMode,
// switchDesktopMode, DESKTOP_MODE_KEY, layout, openModal, closeModal,
// tvOn, setTv, and Music's and Podcasts' players.
"use strict";

const CAR_KEY = "adleros.carMode";
const CAR_PLACES_KEY = "adleros.carPlaces";
const car = { built: false, timer: null, shown: "" };

const CAR_ICONS = {
  nav: ["M3 11l18-8-8 18-2-8z"],
  music: ["M9 18V5l12-2v13", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  pods: ["M12 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M8.5 15a5 5 0 1 1 7 0", "M6 18a8.5 8.5 0 1 1 12 0", "M12 13v8"],
  exit: ["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4", "M10 17l-5-5 5-5", "M5 12h12"],
  play: ["M7 4l13 8-13 8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"],
  next: ["M5 4l10 8-10 8z", "M19 5v14"], prev: ["M19 20 9 12l10-8z", "M5 19V5"],
  back30: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"], fwd30: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"],
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"], work: ["M3 7h18v13H3z", "M8 7V4h8v3"], pin: ["M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12z", "M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
};

function carOn() { return document.body.classList.contains("car"); }

function setCar(on) {
  if (on === carOn()) return;
  if (on) {
    if (tvOn()) { document.body.classList.remove("tv"); winSave(TV_KEY, false); $("tv")?.setAttribute("hidden", ""); }
    if (desktopMode()) { switchDesktopMode(false); winSave(DESKTOP_MODE_KEY, false); }
  }
  for (const [id, w] of wm.windows) if (isOpen(id)) (w.hide || w.close)();
  document.body.classList.toggle("car", on);
  winSave(CAR_KEY, on);
  if (on) carShow();
  else { $("car")?.setAttribute("hidden", ""); clearInterval(car.timer); layout(true); }
  toast(on ? "Car mode. Eyes on the road." : "Back to the home screen.");
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
    el("div", { class: "car-now", id: "car-now" },
      el("div", { class: "car-art", id: "car-art" }),
      el("div", { class: "car-text" }, el("div", { class: "car-title", id: "car-title" }), el("div", { class: "car-sub", id: "car-sub" })),
      el("div", { class: "car-bar" }, el("span", { id: "car-bar" })),
      el("div", { class: "car-ctls" }, control("car-prev", CAR_ICONS.prev, "Back"), control("car-play", CAR_ICONS.play, "Play"), control("car-next", CAR_ICONS.next, "Next"))),
    el("div", { class: "car-side" },
      el("div", { class: "car-clock", id: "car-clock" }),
      el("div", { class: "car-tiles" },
        tile("nav", CAR_ICONS.nav, "Navigate", carNavigate),
        tile("music", CAR_ICONS.music, "Music", () => openMusic()),
        tile("pods", CAR_ICONS.pods, "Podcasts", () => openPodcasts()),
        tile("exit", CAR_ICONS.exit, "Leave car mode", () => setMode("home")))));
  $("desktop").after(node);
  $("car-play").addEventListener("click", carToggle);
  $("car-prev").addEventListener("click", () => (carPods() ? pcSkip(-30) : carMusicReady() && musicPrev()));
  $("car-next").addEventListener("click", () => (carPods() ? pcSkip(30) : carMusicReady() && musicNext()));
}

function carShow() {
  carBuild();
  $("car").hidden = false;
  car.shown = "";
  carUpdate();
  clearInterval(car.timer);
  car.timer = setInterval(carUpdate, 1000);
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
  $("car-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  $("car-bar").style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 1000) / 10}%`;
  $("car-prev").disabled = $("car-next").disabled = !(pods || carMusicReady());
}

// ------------------------------------------------------------- navigate

function carPlaces() {
  const p = winLoad(CAR_PLACES_KEY, null);
  return { home: p?.home || "", work: p?.work || "", recent: Array.isArray(p?.recent) ? p.recent.slice(0, 4) : [] };
}

function carGo(place) {
  const where = place.trim();
  if (!where) return;
  const p = carPlaces();
  if (where !== p.home && where !== p.work) p.recent = [where, ...p.recent.filter((r) => r !== where)].slice(0, 4);
  winSave(CAR_PLACES_KEY, p);
  closeModal();
  // On a phone this opens Google Maps itself, with the route, ready to go.
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(where)}&travelmode=driving`, "_blank", "noopener");
}

function carNavigate() {
  const p = carPlaces();
  const input = el("input", { class: "field-input car-input", type: "search", placeholder: "Where to?", autocomplete: "street-address", enterkeyhint: "go", "aria-label": "Where to" });
  const go = el("button", { type: "button", class: "car-go" }, "Go");
  go.addEventListener("click", () => carGo(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") carGo(input.value); });
  const place = (icon, label, where, set) => {
    const b = el("button", { type: "button", class: "car-place" }, svg(icon), el("span", { class: "car-place-text" }, el("span", {}, label), where ? el("small", {}, where) : el("small", {}, "Tap to set")));
    b.addEventListener("click", () => {
      if (where) return carGo(where);
      const v = input.value.trim();
      if (!v) { toast(`Type ${label.toLowerCase()}'s address above, then tap ${label} again.`); return input.focus(); }
      const q = carPlaces();
      q[set] = v;
      winSave(CAR_PLACES_KEY, q);
      toast(`${label} saved.`);
      closeModal();
      carNavigate();
    });
    if (where) b.addEventListener("contextmenu", (e) => { e.preventDefault(); const q = carPlaces(); q[set] = ""; winSave(CAR_PLACES_KEY, q); toast(`${label} forgotten.`); closeModal(); carNavigate(); });
    return b;
  };
  const close = el("button", { type: "button", class: "car-go secondary" }, "Close");
  close.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material car-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Navigate" },
    el("div", { class: "car-search" }, input, go),
    el("div", { class: "car-places" }, place(CAR_ICONS.home, "Home", p.home, "home"), place(CAR_ICONS.work, "Work", p.work, "work"),
      ...p.recent.map((r) => {
        const b = el("button", { type: "button", class: "car-place" }, svg(CAR_ICONS.pin), el("span", { class: "car-place-text" }, el("span", {}, r)));
        b.addEventListener("click", () => carGo(r));
        return b;
      })),
    el("p", { class: "car-note" }, "Opens Google Maps with the route. A saved place: hold it to forget it."),
    el("div", { class: "dialog-actions" }, close)));
}

// Back on (this device was in car mode): before the first draw.
if (winLoad(CAR_KEY, false) === true) document.body.classList.add("car");
