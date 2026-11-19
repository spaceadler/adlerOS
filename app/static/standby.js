// StandBy, after the iPhone's: adlerOS as a bedside clock, a photo frame
// and a glance at your day, on a screen on its side (a phone on a stand, an
// old tablet, a monitor by the bed). Three pages across, swiped (or the
// arrows, or a trackpad): Widgets, two stacks side by side, each swiped up
// and down on its own (your next events, what's playing, the machine; On
// this day, what's due, a clock); Photos, one at a time, full screen, a new
// one every 20 seconds, swiped up and down through On This Day, Favorites
// and your albums (Immich's), a tap for when and where it was taken; and
// Clock, swiped up and down through Digital, Analog, World, Solar and Float.
// Each page remembers where you left it, on this device. A tap shows the
// dots, the way out and Night Mode for a few seconds; touch and hold a clock
// (or right-click it) for its colours. Night Mode turns it all a dim red, as
// the iPhone does in a dark room: a web page can't see the room, so Auto is
// 21:00 to 07:00 (or always, or never). The screen is kept awake where the
// browser allows it (the Wake Lock API: HTTPS only). An overlay over the
// mode you were in, which comes back when you leave (windows.js MODES).
// Uses $, el, svg, api, toast, winLoad, winSave, openMenu, closeMenu,
// appWidgetValue, bigEvents, bigTimeline, gaGet, gaThumb, openGallery,
// gaOpen, music, muCurrent, muSong, muArtists, musicArt, musicToggle,
// musicNext, pc, pcNow, pcArt, pcToggle, carPods, widgets' VALUES data
// (/api/widgets), and clockNextAlarm (clock.js) when there is one.
"use strict";

const SB_KEY = "adleros.standby";
const SB_PREFS_KEY = "adleros.standbyPrefs";
const sb = { built: false, tick: null, wake: null, prefs: null, where: null, whereAsked: false, chromeTimer: null, press: null,
  sys: null, sysAt: 0, photos: null, photoTimer: null, full: false, scrollTimer: null, lastMinute: -1, lastWorld: 0 };

// Land on a 120 x 50 grid (longitude -180..180, latitude 80..-58), from
// Natural Earth's 1:110m land (public domain), a row of bits a line in hex.
const SB_MAP = [
  "00000057effff800c0000006000000,000007a400fff8000000c01fc03000,00003c2ae03ff000000201fff60000,03e043c9f83fe0000c0037ffffff80",
  "7fffffffffffffff80300800000000,4fffffff3c1c0e00efffffffffffff,07fffff8701c0003dfffffffffffde,03c3fff03a000002cffffffffff740",
  "0000fffe3e0000219fffffffffc0c0,00007fffbf800051ffffffffffe080,00007fffff000037fffffffffff000,00003ffffcc0003ffffffffffff000",
  "00001fffff00000f7df3ffffffc000,00003ffff0000078b833ffffff1000,00001fffe000007057fbfffff60000,00001fffe000006017fbfffffa2000",
  "00000fffc000003e00fffffff0c000,000007ff8000007f90fffffff90000,000001f0800000fffff7fffff80000,000002f0000001fffef9fffff00000",
  "000001e0000001ffff7f1fffe00000,00000072200003ffff7f0f9f000000,0000003e200001ffffbe0f1f080000,00000007000003ffffb80607080000",
  "00000001000003ffffc00603040000,000000001f0001fffff80400100000,000000003f8000fffff00004040000,000000003fe00001fff00008200000",
  "000000003fe00001ffe00006e20000,000000007ff80001ffc00002688000,000000007ffe0000ff800002007000,000000007fff0000ff800001c03800",
  "000000003fff0000ff800000040440,000000003ffe0000ffc8000000d000,000000001ffe0000ffc80000039000,000000000ffe0000ff10000007f801",
  "0000000007fc0000ff1000001ffc00,0000000007f800007f1000003ffc00,000000000ff000007e0000003ffe00,000000000ff000003e0000003ffe00",
  "000000000fe000003c0000001efe00,000000000fc0000020000000103c00,000000001f80000000000000001c02,000000001e00000000000000000002",
  "000000000e00000000000000000004,000000001c00000000000000000008,000000001c00000000000000000000,000000001800000000000000000000",
  "000000000800000000000000000000,000000000000000000000000000000",
].join(",").split(",");

const SB_ICONS = {
  close: ["M18 6 6 18", "m6 6 12 12"], moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  play: ["M7 4l13 8-13 8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"], next: ["M5 4l10 8-10 8z", "M19 5v14"],
  alarm: ["M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 9v4l2 2", "M5 3 2 6", "m22 6-3-3"], link: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
};

// Each face's colours: one each, or a pair (Solar's glow, Float's shade).
const SB_SOLID = ["#ffffff", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#0a84ff", "#bf5af2", "#ff375f"];
const SB_FACES = [
  { id: "digital", name: "Digital", colors: SB_SOLID },
  { id: "analog", name: "Analog", colors: SB_SOLID },
  { id: "world", name: "World", colors: null },
  { id: "solar", name: "Solar", colors: [["#ffd60a", "#ff453a"], ["#ff9f0a", "#ff375f"], ["#64d2ff", "#5e5ce6"], ["#30d158", "#0a84ff"], ["#bf5af2", "#ff375f"], ["#f5f5f7", "#8e8e93"]] },
  { id: "float", name: "Float", colors: [["#ff9f0a", "#c2410c"], ["#64d2ff", "#0369a1"], ["#30d158", "#15803d"], ["#ff375f", "#be123c"], ["#bf5af2", "#7e22ce"], ["#ffd60a", "#a16207"], ["#f5f5f7", "#8e8e93"]] },
];
const SB_STACKS = [["calendar", "now", "system"], ["photo", "tasks", "clock"]];

function sbOn() { return document.body.classList.contains("standby"); }

function sbPrefs() {
  const p = winLoad(SB_PREFS_KEY, {}) || {};
  return { page: [0, 1, 2].includes(p.page) ? p.page : 2, stacks: Array.isArray(p.stacks) ? p.stacks.slice(0, 2) : [0, 0], photos: p.photos || 0,
    clock: p.clock || 0, colors: p.colors && typeof p.colors === "object" ? p.colors : {}, night: ["auto", "on", "off"].includes(p.night) ? p.night : "auto" };
}
function sbSave() { winSave(SB_PREFS_KEY, sb.prefs); }

function setStandby(on) {
  if (on === sbOn()) return;
  if (on) {
    closeMenu();
    sbBuild();
    document.body.classList.add("standby");
    $("standby").hidden = false;
    winSave(SB_KEY, true);
    sbStart();
    // Full screen, when the browser allows (the click that chose it does).
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().then(() => { sb.full = true; }).catch(() => {});
    }
  } else {
    document.body.classList.remove("standby");
    if (sb.built) $("standby").hidden = true;
    winSave(SB_KEY, false);
    sbStop();
    if (sb.full && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    sb.full = false;
  }
}

// ------------------------------------------------------------- the frame

function sbBuild() {
  if (sb.built) return;
  sb.built = true;
  sb.prefs = sbPrefs();
  const stack = (i) => el("div", { class: "sb-stack sb-vert", "data-stack": String(i) }, ...SB_STACKS[i].map((w) => el("div", { class: `sb-widget sb-w-${w}`, "data-widget": w })));
  const pages = el("div", { class: "sb-pages", id: "sb-pages" },
    el("div", { class: "sb-page sb-widgets" }, stack(0), stack(1)),
    el("div", { class: "sb-page" }, el("div", { class: "sb-vert sb-photos", id: "sb-photos" })),
    el("div", { class: "sb-page" }, el("div", { class: "sb-vert sb-clocks", id: "sb-clocks" }, ...SB_FACES.map((f) => el("div", { class: `sb-face sb-${f.id}`, "data-face": f.id })))));
  const exit = el("button", { type: "button", class: "sb-chrome-button sb-exit", "aria-label": "Leave StandBy", title: "Leave StandBy (Escape)" }, svg(SB_ICONS.close));
  exit.addEventListener("click", (e) => { e.stopPropagation(); setStandby(false); });
  const night = el("button", { type: "button", class: "sb-chrome-button sb-nightbutton", id: "sb-nightbutton" }, svg(SB_ICONS.moon), el("span", { id: "sb-night-label" }));
  night.addEventListener("click", (e) => {
    e.stopPropagation();
    sb.prefs.night = { auto: "on", on: "off", off: "auto" }[sb.prefs.night];
    sbSave();
    sbNight();
    sbChrome();
  });
  const node = el("section", { id: "standby", class: "sb", hidden: "", "aria-label": "StandBy" }, pages,
    el("div", { class: "sb-dots", id: "sb-dots", "aria-hidden": "true" }, el("span"), el("span"), el("span")),
    el("div", { class: "sb-chrome" }, night, exit),
    el("div", { class: "sb-palette", id: "sb-palette", hidden: "" }),
    el("div", { class: "sb-tint", "aria-hidden": "true" }));
  document.body.append(node);
  for (const face of node.querySelectorAll(".sb-face")) sbFaceBuild(face);
  sbPhotosBuild();
  // Where you are: which page across, and which view in each.
  pages.addEventListener("scroll", () => sbScrolled(), { passive: true });
  for (const v of node.querySelectorAll(".sb-vert")) v.addEventListener("scroll", () => sbScrolled(), { passive: true });
  // A tap: the dots, the way out, Night Mode. Touch and hold a clock: its colours.
  node.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".sb-chrome, .sb-palette, button")) return;
    sb.press = { x: e.clientX, y: e.clientY, at: Date.now(), face: e.target.closest(".sb-face"),
      timer: setTimeout(() => { if (sb.press?.face) { const f = sb.press.face; sb.press = null; sbPalette(f.dataset.face); } }, 600) };
  });
  node.addEventListener("pointermove", (e) => { if (sb.press && Math.hypot(e.clientX - sb.press.x, e.clientY - sb.press.y) > 10) { clearTimeout(sb.press.timer); sb.press = null; } });
  node.addEventListener("pointerup", (e) => {
    if (!sb.press) return;
    clearTimeout(sb.press.timer);
    sb.press = null;
    if (!$("sb-palette").hidden && !e.target.closest(".sb-palette")) return sbPaletteClose();
    if (e.target.closest(".sb-photo-set")) sbPhotoInfo();
    sbChrome();
  });
  node.addEventListener("contextmenu", (e) => {
    const face = e.target.closest(".sb-face");
    e.preventDefault();
    if (face) sbPalette(face.dataset.face);
  });
}

function sbStart() {
  sb.prefs = sb.prefs || sbPrefs();
  requestAnimationFrame(() => {
    const pages = $("sb-pages");
    pages.scrollLeft = sb.prefs.page * pages.clientWidth;
    document.querySelectorAll("#standby .sb-stack").forEach((s, i) => { s.scrollTop = (sb.prefs.stacks[i] || 0) * s.clientHeight; });
    $("sb-photos").scrollTop = sb.prefs.photos * $("sb-photos").clientHeight;
    $("sb-clocks").scrollTop = sb.prefs.clock * $("sb-clocks").clientHeight;
    sbDots();
  });
  sb.lastMinute = -1;
  clearInterval(sb.tick);
  sb.tick = setInterval(sbTick, 1000);
  sbTick();
  sbWidgets();
  sbChrome();
  sbWake();
  if (!sb.whereAsked) {
    sb.whereAsked = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    api(`/api/standby/where?tz=${encodeURIComponent(tz)}`).then((r) => { if (r.status === 200 && r.body.found) { sb.where = r.body; sb.lastWorld = 0; } }).catch(() => {});
  }
  sbPhotosNext();
}

function sbStop() {
  clearInterval(sb.tick);
  clearInterval(sb.photoTimer);
  sb.photoTimer = null;
  sb.wake?.release?.().catch(() => {});
  sb.wake = null;
}

// The screen stays on, where the browser allows (a secure page).
async function sbWake() {
  if (!sbOn() || !navigator.wakeLock || document.visibilityState !== "visible") return;
  try { sb.wake = await navigator.wakeLock.request("screen"); } catch { sb.wake = null; }
}
document.addEventListener("visibilitychange", () => { if (sbOn() && document.visibilityState === "visible") sbWake(); });

// Which page, and which view in each, kept for next time.
function sbScrolled() {
  clearTimeout(sb.scrollTimer);
  sb.scrollTimer = setTimeout(() => {
    const pages = $("sb-pages");
    const at = (n, size) => (size ? Math.round(n / size) : 0);
    const page = at(pages.scrollLeft, pages.clientWidth);
    const stacks = [...document.querySelectorAll("#standby .sb-stack")].map((s) => at(s.scrollTop, s.clientHeight));
    const photos = at($("sb-photos").scrollTop, $("sb-photos").clientHeight);
    const clock = at($("sb-clocks").scrollTop, $("sb-clocks").clientHeight);
    const photosMoved = photos !== sb.prefs.photos || page !== sb.prefs.page;
    Object.assign(sb.prefs, { page, stacks, photos, clock });
    sbSave();
    sbDots();
    if (photosMoved) sbPhotosNext();
    sbTick(true);
  }, 120);
}

function sbDots() {
  document.querySelectorAll("#sb-dots span").forEach((d, i) => d.classList.toggle("on", i === sb.prefs.page));
}

// A tap: the dots, the way out and Night Mode, for a few seconds.
function sbChrome() {
  const node = $("standby");
  node.classList.add("chrome");
  $("sb-night-label").textContent = `Night Mode: ${{ auto: "Auto", on: "On", off: "Off" }[sb.prefs.night]}`;
  clearTimeout(sb.chromeTimer);
  sb.chromeTimer = setTimeout(() => node.classList.remove("chrome"), 3500);
}

// Night Mode: a dim red, in the dark hours (Auto), always, or never.
function sbNight() {
  const h = new Date().getHours();
  const on = sb.prefs.night === "on" || (sb.prefs.night === "auto" && (h >= 21 || h < 7));
  $("standby").classList.toggle("sb-night", on);
}

// Every second: the clock in sight (all of them once a minute), Night Mode,
// the widgets every ten seconds.
function sbTick(all = false) {
  if (!sbOn()) return;
  const now = new Date();
  const minute = now.getMinutes() !== sb.lastMinute;
  sb.lastMinute = now.getMinutes();
  const faces = [...document.querySelectorAll("#standby .sb-face")];
  const shown = faces[sb.prefs.clock];
  for (const f of faces) if (f === shown || minute || all) sbFaceTick(f, now);
  if (minute || all) sbNight();
  if (now.getSeconds() % 10 === 0 || all) sbWidgets();
}

// --------------------------------------------------------------- clocks

function sbColor(id) {
  const face = SB_FACES.find((f) => f.id === id);
  if (!face?.colors) return null;
  return face.colors[sb.prefs.colors[id] || 0] || face.colors[0];
}
function sbApplyColor(node) {
  const c = sbColor(node.dataset.face);
  if (!c) return;
  const [a, b] = Array.isArray(c) ? c : [c, c];
  node.style.setProperty("--sb-c", a);
  node.style.setProperty("--sb-c2", b);
}

// The time without seconds, as this browser writes it, and its AM or PM apart.
function sbTime(now) {
  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(now);
  return { hm: parts.filter((p) => p.type !== "dayPeriod" && p.type !== "literal" || p.value.trim() === ":").map((p) => p.value).join("").trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value || "" };
}
const sbDate = (now, opts = { weekday: "short", day: "numeric", month: "short" }) => now.toLocaleDateString([], opts);
function sbAlarm() {
  const at = typeof clockNextAlarm === "function" ? clockNextAlarm() : null;
  return at ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

function sbFaceBuild(node) {
  const id = node.dataset.face;
  sbApplyColor(node);
  if (id === "digital") {
    node.append(el("div", { class: "sb-dig-top" }, el("span", { class: "sb-dig-date" }), el("span", { class: "sb-dig-alarm" })),
      el("div", { class: "sb-dig-time" }), el("div", { class: "sb-dig-period" }));
  } else if (id === "analog") {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 200 200");
    s.setAttribute("class", "sb-dial");
    const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); s.append(n); return n; };
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 2 * Math.PI, hour = i % 5 === 0;
      const r1 = hour ? 84 : 89, r2 = 94;
      add("line", { x1: 100 + r1 * Math.sin(a), y1: 100 - r1 * Math.cos(a), x2: 100 + r2 * Math.sin(a), y2: 100 - r2 * Math.cos(a), class: hour ? "sb-tick hour" : "sb-tick" });
    }
    for (let h = 1; h <= 12; h++) {
      const a = (h / 12) * 2 * Math.PI;
      const t = add("text", { x: 100 + 70 * Math.sin(a), y: 100 - 70 * Math.cos(a) + 6.5, class: "sb-num" });
      t.textContent = String(h);
    }
    add("line", { x1: 100, y1: 112, x2: 100, y2: 50, class: "sb-hand hour" });
    add("line", { x1: 100, y1: 114, x2: 100, y2: 24, class: "sb-hand minute" });
    add("line", { x1: 100, y1: 120, x2: 100, y2: 16, class: "sb-hand second" });
    add("circle", { cx: 100, cy: 100, r: 4, class: "sb-pin" });
    add("circle", { cx: 100, cy: 100, r: 1.6, class: "sb-pin-in" });
    node.append(s, el("div", { class: "sb-analog-side" }, el("div", { class: "sb-analog-day" }), el("div", { class: "sb-analog-date" }), el("div", { class: "sb-analog-alarm" })));
  } else if (id === "world") {
    node.append(el("canvas", { class: "sb-map" }), el("div", { class: "sb-world-text" },
      el("div", { class: "sb-world-time" }), el("div", { class: "sb-world-place" })));
  } else if (id === "solar") {
    node.append(el("div", { class: "sb-sun" }), el("div", { class: "sb-solar-text" }, el("div", { class: "sb-solar-time" }), el("div", { class: "sb-solar-date" })));
  } else if (id === "float") {
    node.append(el("div", { class: "sb-float-time" }), el("div", { class: "sb-float-alarm" }));
  }
}

function sbFaceTick(node, now) {
  const id = node.dataset.face;
  const { hm, period } = sbTime(now);
  if (id === "digital") {
    node.querySelector(".sb-dig-time").textContent = hm;
    node.querySelector(".sb-dig-period").textContent = period;
    node.querySelector(".sb-dig-date").textContent = sbDate(now, { weekday: "short", day: "numeric" });
    const alarm = sbAlarm();
    node.querySelector(".sb-dig-alarm").replaceChildren(...(alarm ? [svg(SB_ICONS.alarm), alarm] : []));
  } else if (id === "analog") {
    const s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
    node.querySelector(".sb-hand.hour").setAttribute("transform", `rotate(${h * 30} 100 100)`);
    node.querySelector(".sb-hand.minute").setAttribute("transform", `rotate(${m * 6} 100 100)`);
    node.querySelector(".sb-hand.second").setAttribute("transform", `rotate(${s * 6} 100 100)`);
    node.querySelector(".sb-analog-day").textContent = sbDate(now, { weekday: "long" });
    node.querySelector(".sb-analog-date").textContent = sbDate(now, { day: "numeric", month: "long" });
    const alarm = sbAlarm();
    node.querySelector(".sb-analog-alarm").replaceChildren(...(alarm ? [svg(SB_ICONS.alarm), alarm] : []));
  } else if (id === "world") {
    node.querySelector(".sb-world-time").textContent = `${hm}${period ? ` ${period}` : ""}`;
    node.querySelector(".sb-world-place").textContent = [sb.where?.city, sbDate(now)].filter(Boolean).join(" · ");
    if (Date.now() - sb.lastWorld > 60000 || node.querySelector("canvas").width !== Math.round(node.clientWidth * devicePixelRatio)) {
      sb.lastWorld = Date.now();
      sbWorld(node.querySelector("canvas"), now);
    }
  } else if (id === "solar") {
    node.querySelector(".sb-solar-time").textContent = hm;
    node.querySelector(".sb-solar-date").textContent = `${sbDate(now, { weekday: "long", day: "numeric", month: "long" })}${period ? ` · ${period}` : ""}`;
    // The sun: up the left in the morning, over the top at noon, down the right by evening.
    const day = Math.min(1, Math.max(0, (now.getHours() + now.getMinutes() / 60 - 6) / 12));
    const sun = node.querySelector(".sb-sun");
    sun.style.left = `${10 + day * 80}%`;
    sun.style.top = `${70 - Math.sin(day * Math.PI) * 55}%`;
  } else if (id === "float") {
    const box = node.querySelector(".sb-float-time");
    const chars = [...hm];
    // Each character its own bubble; the ones that change float in.
    if (box.children.length !== chars.length) box.replaceChildren(...chars.map(() => el("span", { class: "sb-fl" })));
    chars.forEach((ch, i) => {
      const span = box.children[i];
      if (span.textContent === ch) return;
      const fresh = span.textContent !== "";
      span.textContent = ch;
      span.classList.toggle("sep", ch === ":");
      if (fresh && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        span.animate([{ transform: "translateY(40%) scale(0.6)", opacity: 0 }, { transform: "translateY(-6%) scale(1.04)", opacity: 1, offset: 0.7 }, { transform: "none", opacity: 1 }],
          { duration: 700, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
      }
    });
    const alarm = sbAlarm();
    node.querySelector(".sb-float-alarm").replaceChildren(...(alarm ? [svg(SB_ICONS.alarm), alarm] : []));
  }
}

// The World clock's map: land as dots, the half in daylight lit, your time
// zone's city marked.
function sbWorld(canvas, now) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const k = devicePixelRatio || 1;
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const g = canvas.getContext("2d");
  g.scale(k, k);
  const cols = 120, rows = 50, top = 80, bottom = -58;
  const cw = w / cols, ch = h / rows, r = Math.max(1, Math.min(cw, ch) * 0.34);
  // Where the sun is overhead now.
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = (now - start) / 86400000;
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)) * Math.PI) / 180;
  const subLon = (12 - (now.getUTCHours() + now.getUTCMinutes() / 60)) * 15;
  const night = $("standby").classList.contains("sb-night");
  for (let j = 0; j < rows; j++) {
    const bits = BigInt(`0x${SB_MAP[j]}`);
    const lat = ((top - (j + 0.5) * ((top - bottom) / rows)) * Math.PI) / 180;
    for (let i = 0; i < cols; i++) {
      if (!((bits >> BigInt(cols - 1 - i)) & 1n)) continue;
      const lon = -180 + (i + 0.5) * (360 / cols);
      const sun = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(((lon - subLon) * Math.PI) / 180);
      const light = Math.min(1, Math.max(0, (sun + 0.1) / 0.2)); // a soft edge where the sun's setting
      g.fillStyle = night ? `rgba(255,255,255,${0.16 + light * 0.3})` : `rgba(255,255,255,${0.18 + light * 0.6})`;
      g.beginPath();
      g.arc((i + 0.5) * cw, (j + 0.5) * ch, r, 0, 2 * Math.PI);
      g.fill();
    }
  }
  if (sb.where) {
    const x = ((sb.where.lon + 180) / 360) * w, y = ((top - sb.where.lat) / (top - bottom)) * h;
    g.fillStyle = "rgba(255, 214, 10, 0.25)";
    g.beginPath(); g.arc(x, y, r * 4, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#ffd60a";
    g.beginPath(); g.arc(x, y, r * 1.8, 0, 2 * Math.PI); g.fill();
  }
}

// Touch and hold a clock: its colours, a row of swatches.
function sbPalette(id) {
  const face = SB_FACES.find((f) => f.id === id);
  const box = $("sb-palette");
  if (!face?.colors) {
    box.replaceChildren(el("p", {}, `${face?.name || "This"} clock has its own colours.`));
  } else {
    box.replaceChildren(el("p", {}, face.name), el("div", { class: "sb-swatches" }, ...face.colors.map((c, i) => {
      const [a, b] = Array.isArray(c) ? c : [c, c];
      const s = el("button", { type: "button", class: `sb-swatch${(sb.prefs.colors[id] || 0) === i ? " on" : ""}`, "aria-label": `Colour ${i + 1}` });
      s.style.background = a === b ? a : `linear-gradient(135deg, ${a} 50%, ${b} 50%)`;
      s.addEventListener("click", (e) => {
        e.stopPropagation();
        sb.prefs.colors[id] = i;
        sbSave();
        sbApplyColor(document.querySelector(`#standby .sb-face[data-face="${id}"]`));
        sbPalette(id);
      });
      return s;
    })));
  }
  box.hidden = false;
}
function sbPaletteClose() { $("sb-palette").hidden = true; }

// --------------------------------------------------------------- widgets

function sbWidgets() {
  if (!sbOn()) return;
  for (const node of document.querySelectorAll("#standby .sb-widget")) {
    try { sbWidget(node); } catch { /* one that can't draw stays as it was */ }
  }
}

function sbWidget(node) {
  const kind = node.dataset.widget;
  const redraw = () => sbWidget(node);
  const head = (title) => el("div", { class: "sb-w-head" }, title);
  if (kind === "calendar") {
    const now = new Date();
    if (!sb.events || Date.now() - sb.eventsAt > 300000) {
      sb.eventsAt = Date.now();
      bigEvents(7).then((list) => { sb.events = list; redraw(); }, () => { sb.events = []; redraw(); });
    }
    const list = (sb.events || []).slice(0, 3);
    node.replaceChildren(el("div", { class: "sb-cal-day" }, el("span", {}, sbDate(now, { weekday: "long" }).toUpperCase()), el("strong", {}, String(now.getDate()))),
      el("div", { class: "sb-list" }, ...(list.length ? list.map((e) => el("div", { class: "sb-item" }, el("span", { class: "sb-item-title" }, e.title || "(No title)"),
        el("span", { class: "sb-item-sub" }, `${bigDayName(e.at)}${e.allDay ? ", all day" : `, ${e.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}`)))
        : [el("div", { class: "sb-item-sub" }, sb.events ? "Nothing in the next week." : "…")])));
  } else if (kind === "now") {
    const pods = typeof carPods === "function" && carPods();
    const id = typeof muCurrent === "function" ? muCurrent() : null;
    if (!pods && !id) { node.replaceChildren(head("Music"), el("div", { class: "sb-big-note" }, "Nothing playing")); return; }
    const s = id ? muSong(id) : null, n = pods ? pcNow() : null;
    const paused = pods ? pc.audio.paused : music.audio.paused;
    const key = `${pods ? "p" : "m"}|${pods ? n.title : id}|${paused}`;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    const button = (icon, label, run) => {
      const b = el("button", { type: "button", class: "sb-ctl", "aria-label": label }, svg(icon));
      b.addEventListener("click", (e) => { e.stopPropagation(); run(); setTimeout(redraw, 200); });
      return b;
    };
    node.replaceChildren(el("div", { class: "sb-now-art" }, pods ? pcArt(n.item || pc.byId.get(pc.np.id) || {}, 300) : musicArt(id)),
      el("div", { class: "sb-now-text" }, el("strong", {}, pods ? n.title : s?.title || ""), el("span", {}, pods ? n.sub || "" : s ? muArtists(s) : "")),
      el("div", { class: "sb-now-ctls" }, button(paused ? SB_ICONS.play : SB_ICONS.pause, paused ? "Play" : "Pause", () => (pods ? pcToggle() : musicToggle())),
        button(SB_ICONS.next, "Next", () => (pods ? pcSkip(30) : musicNext()))));
  } else if (kind === "system") {
    if (Date.now() - sb.sysAt > 10000) {
      sb.sysAt = Date.now();
      api("/api/widgets").then((r) => { if (r.status === 200) { sb.sys = r.body.system; redraw(); } }).catch(() => {});
    }
    const d = sb.sys;
    const ring = (label, frac, text) => {
      const deg = Math.round(Math.min(1, Math.max(0, frac || 0)) * 360);
      const r = el("div", { class: "sb-ring" }, el("span", {}, text));
      r.style.background = `conic-gradient(var(--sb-wc, #30d158) ${deg}deg, rgb(255 255 255 / 0.12) 0)`;
      return el("div", { class: "sb-ring-box" }, r, el("small", {}, label));
    };
    node.replaceChildren(head("This machine"), el("div", { class: "sb-rings" },
      ring("CPU", d?.cpu != null ? d.cpu / 100 : 0, d?.cpu != null ? `${Math.round(d.cpu)}%` : "–"),
      ring("Memory", d?.memory ? d.memory.used / d.memory.total : 0, d?.memory ? `${Math.round((100 * d.memory.used) / d.memory.total)}%` : "–"),
      ring("Temp", d?.temperature != null ? d.temperature / 85 : 0, d?.temperature != null ? `${Math.round(d.temperature)}°` : "–")));
  } else if (kind === "photo") {
    const v = typeof appWidgetValue === "function" ? appWidgetValue("photos", redraw) : null;
    if (!v?.picture) { node.replaceChildren(head("On This Day"), el("div", { class: "sb-big-note" }, v?.empty || "…")); return; }
    if (node.dataset.key === v.picture) return;
    node.dataset.key = v.picture;
    node.replaceChildren(el("img", { class: "sb-w-pic", src: v.picture, alt: "" }), el("div", { class: "sb-w-caption" }, el("span", {}, "On This Day"), el("strong", {}, v.caption || "")));
  } else if (kind === "tasks") {
    const v = typeof appWidgetValue === "function" ? appWidgetValue("tasks", redraw) : null;
    node.replaceChildren(head("Due"), el("div", { class: "sb-list" }, ...(v?.items?.length ? v.items.slice(0, 4).map((t) => el("div", { class: "sb-item" },
      el("span", { class: "sb-item-title" }, t.text), el("span", { class: "sb-item-sub" }, t.subtext || ""))) : [el("div", { class: "sb-big-note" }, v?.empty || "…")])));
  } else if (kind === "clock") {
    const now = new Date();
    const { hm, period } = sbTime(now);
    node.replaceChildren(el("div", { class: "sb-w-clock" }, el("strong", {}, hm), el("span", {}, period)), el("div", { class: "sb-item-sub" }, sbDate(now, { weekday: "long", day: "numeric", month: "long" })));
  }
}

// ---------------------------------------------------------------- photos

// Sets swiped up and down: On This Day, Favorites, then your albums (newest
// first), each read from Immich when it's first shown; one photo of it at a
// time, a new one every 20 seconds, fading over.
function sbPhotosBuild() {
  sb.photos = { sets: [{ name: "On This Day", load: async () => (await gaGet("memories")).flatMap((m) => m.assets || []).map((a) => ({ id: a.id, a })) },
    { name: "Favorites", load: async () => (await bigTimeline({ isFavorite: "true", visibility: "timeline", order: "desc" }, 300)).filter((a) => a.isImage !== false).map((a) => ({ id: a.id })) }],
  ready: false, shown: null };
  const box = $("sb-photos");
  const draw = () => box.replaceChildren(...sb.photos.sets.map((s, i) => el("div", { class: "sb-photo-set", "data-set": String(i) },
    el("img", { class: "sb-ph a", alt: "" }), el("img", { class: "sb-ph b", alt: "" }), el("div", { class: "sb-ph-name" }, s.name),
    el("div", { class: "sb-ph-info", hidden: "" }))));
  draw();
  gaGet("status").then((st) => {
    if (!st?.ok) {
      box.replaceChildren(el("div", { class: "sb-photo-set sb-ph-empty" }, el("p", {}, "Photos come from Immich: connect Gallery to it, and they show here.")));
      return;
    }
    return gaGet("albums").then((albums) => {
      for (const al of [...albums].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))).slice(0, 12)) {
        sb.photos.sets.push({ name: al.albumName, load: async () => (await bigTimeline({ albumId: al.id, order: "desc" }, 300)).filter((a) => a.isImage !== false).map((a) => ({ id: a.id })) });
      }
      draw();
      requestAnimationFrame(() => { box.scrollTop = sb.prefs.photos * box.clientHeight; sbPhotosNext(); });
    });
  }).catch(() => {});
}

async function sbPhotosNext() {
  clearInterval(sb.photoTimer);
  sb.photoTimer = null;
  if (!sbOn() || sb.prefs.page !== 1 || !sb.photos) return;
  const node = document.querySelector(`#sb-photos .sb-photo-set[data-set="${sb.prefs.photos}"]`);
  const set = sb.photos.sets[sb.prefs.photos];
  if (!node || !set) return;
  if (!set.list) {
    set.list = await set.load().catch(() => []);
    if (!set.list.length) { node.querySelector(".sb-ph-name").textContent = `${set.name}: nothing here`; return; }
  }
  const show = () => {
    const pick = set.list[Math.floor(Math.random() * set.list.length)];
    // Into the one out of sight (a while flipped, b otherwise), then over.
    const hidden = node.querySelector(node.classList.contains("flip") ? ".sb-ph.b" : ".sb-ph.a");
    const img = new Image();
    img.onload = () => { hidden.src = img.src; node.classList.toggle("flip"); node.dataset.id = pick.id; node.querySelector(".sb-ph-info").hidden = true; };
    img.src = gaThumb(pick.id, "preview");
  };
  show();
  sb.photoTimer = setInterval(show, 20000);
  // Its name, a moment, then the photo alone.
  node.classList.add("named");
  setTimeout(() => node.classList.remove("named"), 2500);
}

// A tap on a photo: when and where, and a way to it in Gallery.
async function sbPhotoInfo() {
  const node = document.querySelector(`#sb-photos .sb-photo-set[data-set="${sb.prefs.photos}"]`);
  const id = node?.dataset.id;
  if (!id) return;
  const box = node.querySelector(".sb-ph-info");
  if (!box.hidden) { box.hidden = true; return; }
  const a = await gaGet(`asset/${id}`).catch(() => null);
  if (!a) return;
  const e = a.exifInfo || {};
  const when = new Date(a.localDateTime).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const open = el("button", { type: "button", class: "sb-ph-open" }, svg(SB_ICONS.link), "Show in Gallery");
  open.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setStandby(false);
    openGallery().then(() => gaOpen({ list: [{ id, isImage: a.type !== "VIDEO" }] }, id));
  });
  box.replaceChildren(el("strong", {}, when), el("span", {}, [e.city, e.country].filter(Boolean).join(", ")), open);
  box.hidden = false;
}

// ------------------------------------------------------------------ keys

document.addEventListener("keydown", (e) => {
  if (!sbOn() || e.ctrlKey || e.metaKey || e.altKey) return;
  const pages = $("sb-pages");
  const vert = [document.querySelector("#standby .sb-stack"), $("sb-photos"), $("sb-clocks")][sb.prefs.page];
  const go = { ArrowLeft: () => pages.scrollBy({ left: -pages.clientWidth, behavior: "smooth" }), ArrowRight: () => pages.scrollBy({ left: pages.clientWidth, behavior: "smooth" }),
    ArrowUp: () => vert.scrollBy({ top: -vert.clientHeight, behavior: "smooth" }), ArrowDown: () => vert.scrollBy({ top: vert.clientHeight, behavior: "smooth" }),
    Escape: () => ($("sb-palette").hidden ? setStandby(false) : sbPaletteClose()), Enter: () => sbChrome(), " ": () => sbChrome() }[e.key];
  if (!go) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  go();
}, true);

// Back on (this device was in StandBy): straight away, over whatever's under it.
if (winLoad(SB_KEY, false) === true) { document.body.classList.add("standby"); requestAnimationFrame(() => { sbBuild(); $("standby").hidden = false; sbStart(); }); }
