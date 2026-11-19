// Clock, after the iPhone's and the Mac's: World Clock, Alarms, Stopwatch and
// Timers, down the side (along the top on a phone).
// - World Clock: the map (StandBy's dots, the half in daylight lit) with your
//   cities marked, and a row each: "Today, +2HRS", the city, its time. Edit
//   takes one out or moves it; + finds one by name (every time zone there is).
// - Alarms: the time big, its label and days, a switch. A tap opens it:
//   Repeat, Label, Sound, Snooze (and how long, 9 minutes unless you say).
//   One that doesn't repeat switches itself off once it's rung.
// - Stopwatch: hundredths, digital or analog (tap the face); Lap and Reset,
//   Start and Stop; the laps under it, the best in green, the worst in red.
// - Timers: as many as you like at once, each with its ring, label and sound;
//   1, 5 and 10 minutes ready, and the ones you used lately.
// All of it is this device's (like an iPhone's), and rings on it while
// adlerOS is open there: a full-screen alarm over anything, StandBy too,
// with Snooze and Stop. The sounds are made here (Web Audio), no files.
// clockNextAlarm() tells StandBy the next one.
// Uses $, el, svg, api, toast, winLoad, winSave, openWindow, closeWindow,
// registerWindow, toggleWindow, sideToggle, openModal, closeModal, SB_MAP
// (standby.js).
"use strict";

const CL_KEY = "adleros.clock";
const CL_ICONS = {
  world: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h20", "M12 2a15 15 0 0 1 0 20", "M12 2a15 15 0 0 0 0 20"],
  alarm: ["M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 9v4l2 2", "M5 3 2 6", "m22 6-3-3"],
  stopwatch: ["M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 10v4", "M10 2h4", "M12 2v4"],
  timer: ["M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v6l-3 2"],
  close: ["M18 6 6 18", "m6 6 12 12"], plus: ["M12 5v14", "M5 12h14"], up: ["m18 15-6-6-6 6"], down: ["m6 9 6 6 6-6"],
  play: ["M7 4l13 8-13 8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"], x: ["M18 6 6 18", "m6 6 12 12"],
};
const CL_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const CL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CL_SOUNDS = ["Chime", "Beacon", "Bells", "Pulse", "Sunrise", "None"];
const CL_PRESETS = [60, 300, 600];

const clock = { built: false, tab: "world", editing: false, where: new Map(), swTimer: null, ringing: null, audio: null, loop: null, mapAt: 0 };

// ------------------------------------------------------------ what's kept

function clData() {
  const d = winLoad(CL_KEY, {}) || {};
  return { cities: Array.isArray(d.cities) ? d.cities : ["Europe/London", "America/New_York", "Asia/Tokyo"],
    alarms: Array.isArray(d.alarms) ? d.alarms : [], recents: Array.isArray(d.recents) ? d.recents : [],
    timers: Array.isArray(d.timers) ? d.timers : [], sw: d.sw || { startAt: null, acc: 0, laps: [] }, face: d.face === "analog" ? "analog" : "digital" };
}
function clSave(d) { winSave(CL_KEY, d); }

// The next alarm to ring (a Date), for StandBy, or null.
function clockNextAlarm() {
  let best = null;
  for (const a of clData().alarms) {
    if (!a.on) continue;
    const at = a.snoozeUntil && a.snoozeUntil > Date.now() ? new Date(a.snoozeUntil) : clNextFire(a, new Date());
    if (at && (!best || at < best)) best = at;
  }
  return best;
}

// When an alarm next rings, after `from`.
function clNextFire(a, from) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(a.h, a.m, 0, 0);
    if (d <= from) continue;
    if (!a.days?.length || a.days.includes(d.getDay())) return d;
  }
  return null;
}

// --------------------------------------------------------------- the window

function openClock(tab) {
  clBuild();
  if (tab) clock.tab = tab;
  openWindow("clock");
  clRender();
}
function toggleClock() { toggleWindow("clock", () => openClock()); }
function closeClock() {
  clearInterval(clock.swTimer);
  closeWindow("clock");
}

function clBuild() {
  if (clock.built) return;
  clock.built = true;
  const close = el("button", { class: "sheet-close mu-close", type: "button", "aria-label": "Close Clock" }, svg(CL_ICONS.close));
  close.addEventListener("click", closeClock);
  const section = el("section", { id: "clock", class: "sheet music-app clock-app", "aria-label": "Clock", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "mu-shell", id: "cl-shell" },
      el("aside", { class: "mu-side" }, el("nav", { class: "mu-side-nav", id: "cl-nav", "aria-label": "Clock" })),
      el("main", { class: "mu-main cl-main", id: "cl-main", tabindex: "-1" })));
  document.body.insertBefore(section, $("modal"));
  registerWindow("clock", { title: "Clock", close: closeClock, hide: () => closeWindow("clock"), dock: "clock", size: [960, 680] });
}

function clRender() {
  if (!clock.built) return;
  const nav = $("cl-nav");
  const item = (tab, icon, label) => {
    const b = el("button", { type: "button", class: `mu-nav${clock.tab === tab ? " on" : ""}` }, svg(icon), el("span", {}, label));
    b.addEventListener("click", () => { clock.tab = tab; clock.editing = false; clRender(); });
    return b;
  };
  nav.replaceChildren(item("world", CL_ICONS.world, "World Clock"), item("alarms", CL_ICONS.alarm, "Alarms"),
    item("stopwatch", CL_ICONS.stopwatch, "Stopwatch"), item("timers", CL_ICONS.timer, "Timers"));
  clearInterval(clock.swTimer);
  const main = $("cl-main");
  ({ world: clWorld, alarms: clAlarms, stopwatch: clStopwatch, timers: clTimers }[clock.tab] || clWorld)(main);
}

// A page's head: its title, and Edit / + on the right.
function clHead(title, { edit = false, add = null } = {}) {
  const right = el("div", { class: "cl-head-buttons" });
  if (edit) {
    const b = el("button", { type: "button", class: "cl-text-button" }, clock.editing ? "Done" : "Edit");
    b.addEventListener("click", () => { clock.editing = !clock.editing; clRender(); });
    right.append(b);
  }
  if (add) {
    const b = el("button", { type: "button", class: "cl-icon-button", "aria-label": "Add" }, svg(CL_ICONS.plus));
    b.addEventListener("click", add);
    right.append(b);
  }
  return el("header", { class: "mu-head cl-head" }, el("h1", {}, title), right);
}

// --------------------------------------------------------------- the time

const clTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
function clCity(tz) { return tz.split("/").pop().replace(/_/g, " "); }
// A zone's offset from UTC now, in minutes.
function clOffset(tz, at = new Date()) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
// "7:53" and "PM", as this browser writes the time (in a zone, if given).
function clParts(at, tz) {
  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }).formatToParts(at);
  return { hm: parts.filter((p) => p.type !== "dayPeriod" && (p.type !== "literal" || p.value.trim() === ":")).map((p) => p.value).join("").trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value || "" };
}
function clAlarmTime(a) {
  const d = new Date();
  d.setHours(a.h, a.m, 0, 0);
  return clParts(d);
}
function clDaysText(days) {
  const s = [...(days || [])].sort();
  if (!s.length) return "";
  if (s.length === 7) return "every day";
  if (s.join() === "1,2,3,4,5") return "every weekday";
  if (s.join() === "0,6") return "every weekend";
  return s.map((d) => CL_DAY_NAMES[d].slice(0, 3)).join(" ");
}
function clDuration(ms, hundredths = false) {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), cs = Math.floor((t % 1000) / 10);
  const two = (n) => String(n).padStart(2, "0");
  return `${h ? `${h}:` : ""}${h ? two(m) : two(m)}:${two(s)}${hundredths ? `.${two(cs)}` : ""}`;
}

// ------------------------------------------------------------ World Clock

function clWorld(main) {
  const d = clData();
  const now = new Date();
  const localOff = clOffset(clTz(), now);
  const today = new Date(now.toLocaleDateString("en-CA", { timeZone: clTz() }));
  const rows = d.cities.map((tz, i) => {
    const off = clOffset(tz, now) - localOff;
    const day = Math.round((new Date(now.toLocaleDateString("en-CA", { timeZone: tz })) - today) / 86400000);
    const hrs = off / 60;
    const diff = `${day === 0 ? "Today" : day > 0 ? "Tomorrow" : "Yesterday"}, ${hrs >= 0 ? "+" : "−"}${Math.abs(hrs) % 1 ? Math.abs(hrs).toFixed(1) : Math.abs(hrs)}HRS`;
    const { hm, period } = clParts(now, tz);
    const tail = clock.editing ? el("div", { class: "cl-edit" }, ...[[CL_ICONS.up, "Move up", -1], [CL_ICONS.down, "Move down", 1]].map(([icon, label, dir]) => {
      const b = el("button", { type: "button", class: "cl-icon-button", "aria-label": label, ...((i + dir < 0 || i + dir >= d.cities.length) ? { disabled: "" } : {}) }, svg(icon));
      b.addEventListener("click", () => { const c = d.cities; [c[i], c[i + dir]] = [c[i + dir], c[i]]; clSave(d); clRender(); });
      return b;
    }), (() => {
      const b = el("button", { type: "button", class: "cl-remove", "aria-label": `Remove ${clCity(tz)}` }, "Remove");
      b.addEventListener("click", () => { d.cities.splice(i, 1); clSave(d); clRender(); });
      return b;
    })()) : el("div", { class: "cl-big-time" }, hm, period ? el("small", {}, period) : "");
    return el("div", { class: "cl-row" }, el("div", { class: "cl-row-text" }, el("span", { class: "cl-sub" }, diff), el("strong", { class: "cl-city" }, clCity(tz))), tail);
  });
  const map = el("canvas", { class: "cl-map" });
  main.replaceChildren(el("div", { class: "mu-page cl-page" }, clHead("World Clock", { edit: d.cities.length > 0, add: clAddCity }), map,
    ...(rows.length ? rows : [el("p", { class: "vd-dim" }, "No cities yet: + adds one.")])));
  requestAnimationFrame(() => clMap(map, d.cities));
  // Where each city is (tzdata's zone1970.tab, through StandBy's lookup), then the map again.
  for (const tz of [clTz(), ...d.cities]) {
    if (clock.where.has(tz)) continue;
    clock.where.set(tz, null);
    api(`/api/standby/where?tz=${encodeURIComponent(tz)}`).then((r) => {
      if (r.status === 200 && r.body.found) { clock.where.set(tz, r.body); if (clock.tab === "world" && map.isConnected) clMap(map, d.cities); }
    }).catch(() => {});
  }
  clock.swTimer = setInterval(() => { if (clock.tab === "world" && isOpen("clock") && !clock.editing) clRender(); }, 30000);
}

// The map: land as dots (StandBy's), the half in daylight lit, each city
// marked with its name, yours in orange.
function clMap(canvas, cities) {
  if (typeof SB_MAP === "undefined") { canvas.hidden = true; return; }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const k = devicePixelRatio || 1;
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const g = canvas.getContext("2d");
  g.scale(k, k);
  const cols = 120, rows = 50, top = 80, bottom = -58, cw = w / cols, ch = h / rows, r = Math.max(0.8, Math.min(cw, ch) * 0.32);
  const now = new Date();
  const doy = (now - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000;
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)) * Math.PI) / 180;
  const subLon = (12 - (now.getUTCHours() + now.getUTCMinutes() / 60)) * 15;
  for (let j = 0; j < rows; j++) {
    const bits = BigInt(`0x${SB_MAP[j]}`);
    const lat = ((top - (j + 0.5) * ((top - bottom) / rows)) * Math.PI) / 180;
    for (let i = 0; i < cols; i++) {
      if (!((bits >> BigInt(cols - 1 - i)) & 1n)) continue;
      const lon = -180 + (i + 0.5) * (360 / cols);
      const sun = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(((lon - subLon) * Math.PI) / 180);
      g.fillStyle = `rgba(255,255,255,${0.14 + Math.min(1, Math.max(0, (sun + 0.1) / 0.2)) * 0.5})`;
      g.beginPath(); g.arc((i + 0.5) * cw, (j + 0.5) * ch, r, 0, 2 * Math.PI); g.fill();
    }
  }
  g.font = "600 12px Inter, system-ui, sans-serif";
  g.textBaseline = "middle";
  for (const tz of [...cities, clTz()]) {
    const p = clock.where.get(tz);
    if (!p) continue;
    const x = ((p.lon + 180) / 360) * w, y = ((top - p.lat) / (top - bottom)) * h, mine = tz === clTz();
    g.fillStyle = mine ? "#ff9f0a" : "#fff";
    g.beginPath(); g.arc(x, y, mine ? 4.5 : 3.5, 0, 2 * Math.PI); g.fill();
    if (!mine) {
      const label = `${clCity(tz)} ${clParts(now, tz).hm}`;
      const tw = g.measureText(label).width;
      const lx = Math.min(w - tw - 10, x + 7);
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(lx - 4, y - 9, tw + 8, 18);
      g.fillStyle = "#fff";
      g.fillText(label, lx, y);
    }
  }
}

// + : a city, found by name among every time zone there is.
function clAddCity() {
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [clTz()]).filter((z) => z.includes("/"));
  const input = el("input", { class: "field-input", type: "search", placeholder: "Search for a city", autocomplete: "off", spellcheck: "false" });
  const list = el("div", { class: "cl-city-list" });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const found = zones.filter((z) => !q || z.toLowerCase().replace(/_/g, " ").includes(q)).slice(0, 60);
    list.replaceChildren(...found.map((z) => {
      const b = el("button", { type: "button", class: "cl-city-choice" }, el("span", {}, clCity(z)), el("small", {}, z.split("/").slice(0, -1).join(" / ").replace(/_/g, " ")));
      b.addEventListener("click", () => {
        const d = clData();
        if (!d.cities.includes(z)) d.cities.push(z);
        clSave(d);
        closeModal();
        clRender();
      });
      return b;
    }));
  };
  input.addEventListener("input", draw);
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material cl-dialog", role: "dialog", "aria-modal": "true" }, el("h2", {}, "Choose a city"), input, list,
    el("div", { class: "dialog-actions" }, cancel)));
  draw();
  input.focus();
}

// ----------------------------------------------------------------- Alarms

function clAlarms(main) {
  const d = clData();
  const sorted = [...d.alarms].sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  const rows = sorted.map((a) => {
    const { hm, period } = clAlarmTime(a);
    const toggle = el("button", { type: "button", class: `cl-switch${a.on ? " on" : ""}`, role: "switch", "aria-checked": String(a.on), "aria-label": `${hm} ${period}` }, el("span"));
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const x = clData(), t = x.alarms.find((y) => y.id === a.id);
      if (!t) return;
      t.on = !t.on;
      t.snoozeUntil = null;
      t.lastRang = Math.floor(Date.now() / 60000);
      clSave(x);
      clRender();
      if (t.on) clSaysWhen(t);
    });
    const remove = clock.editing ? el("button", { type: "button", class: "cl-remove" }, "Delete") : "";
    if (remove) remove.addEventListener("click", (e) => { e.stopPropagation(); const x = clData(); x.alarms = x.alarms.filter((y) => y.id !== a.id); clSave(x); clRender(); });
    const row = el("div", { class: `cl-row cl-alarm${a.on ? "" : " off"}`, role: "button", tabindex: "0" },
      el("div", { class: "cl-row-text" }, el("div", { class: "cl-big-time" }, hm, period ? el("small", {}, period) : ""),
        el("span", { class: "cl-sub" }, [a.label || "Alarm", clDaysText(a.days)].filter(Boolean).join(", "))),
      remove || toggle);
    row.addEventListener("click", () => clAlarmEditor(a));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") clAlarmEditor(a); });
    return row;
  });
  main.replaceChildren(el("div", { class: "mu-page cl-page" }, clHead("Alarms", { edit: d.alarms.length > 0, add: () => clAlarmEditor(null) }),
    ...(rows.length ? rows : [el("p", { class: "vd-dim" }, "No alarms: + sets one. They ring on this device, while adlerOS is open on it.")])));
}

function clSaysWhen(a) {
  const at = clNextFire(a, new Date());
  if (!at) return;
  const mins = Math.round((at - Date.now()) / 60000), h = Math.floor(mins / 60), m = mins % 60;
  toast(`Alarm set for ${h ? `${h} hour${h === 1 ? "" : "s"} and ` : ""}${m} minute${m === 1 ? "" : "s"} from now.`);
}

// One alarm, new or as it is: the time, Repeat, Label, Sound, Snooze.
function clAlarmEditor(a) {
  const fresh = !a;
  const now = new Date();
  const al = a ? { ...a, days: [...(a.days || [])] } : { id: Math.random().toString(36).slice(2, 10), h: now.getHours(), m: now.getMinutes(), days: [], label: "", sound: "Chime", snooze: true, snoozeMin: 9, on: true };
  const time = el("input", { class: "field-input cl-time-input", type: "time", value: `${String(al.h).padStart(2, "0")}:${String(al.m).padStart(2, "0")}`, required: "" });
  const days = el("div", { class: "cl-days" }, ...CL_DAYS.map((letter, i) => {
    const b = el("button", { type: "button", class: `cl-day${al.days.includes(i) ? " on" : ""}`, "aria-label": CL_DAY_NAMES[i], "aria-pressed": String(al.days.includes(i)) }, letter);
    b.addEventListener("click", () => {
      al.days = al.days.includes(i) ? al.days.filter((x) => x !== i) : [...al.days, i];
      b.classList.toggle("on");
      b.setAttribute("aria-pressed", String(al.days.includes(i)));
    });
    return b;
  }));
  const label = el("input", { class: "field-input", type: "text", value: al.label, placeholder: "Alarm", maxlength: "60" });
  const sound = clSoundPicker(al.sound);
  const snooze = el("input", { type: "checkbox", ...(al.snooze ? { checked: "" } : {}) });
  const snoozeMin = el("select", { class: "field-input cl-snooze-min" }, ...Array.from({ length: 15 }, (_, i) => el("option", { value: String(i + 1), ...(i + 1 === (al.snoozeMin || 9) ? { selected: "" } : {}) }, `${i + 1} min`)));
  const row = (name, ...control) => el("label", { class: "cl-form-row" }, el("span", {}, name), ...control);
  const save = el("button", { type: "button", class: "button-primary" }, "Save");
  save.addEventListener("click", () => {
    const [h, m] = (time.value || "07:00").split(":").map(Number);
    Object.assign(al, { h, m, label: label.value.trim(), sound: sound.value, snooze: snooze.checked, snoozeMin: Number(snoozeMin.value), on: true, snoozeUntil: null,
      lastRang: Math.floor(Date.now() / 60000) }); // not in the minute it's set: from the next time it comes round
    const d = clData();
    const i = d.alarms.findIndex((x) => x.id === al.id);
    if (i >= 0) d.alarms[i] = al; else d.alarms.push(al);
    clSave(d);
    closeModal();
    clSoundStop();
    clRender();
    clSaysWhen(al);
  });
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", () => { clSoundStop(); closeModal(); });
  const actions = [cancel, save];
  if (!fresh) {
    const del = el("button", { type: "button", class: "button-destructive" }, "Delete Alarm");
    del.addEventListener("click", () => { const d = clData(); d.alarms = d.alarms.filter((x) => x.id !== al.id); clSave(d); clSoundStop(); closeModal(); clRender(); });
    actions.unshift(del);
  }
  openModal(el("div", { class: "dialog material cl-dialog", role: "dialog", "aria-modal": "true" }, el("h2", {}, fresh ? "Add Alarm" : "Edit Alarm"), time,
    el("div", { class: "cl-form" }, row("Repeat", days), row("Label", label), row("Sound", sound), row("Snooze", snooze, snoozeMin)),
    el("div", { class: "dialog-actions" }, ...actions)), { onClose: clSoundStop });
  time.focus();
}

function clSoundPicker(current) {
  const select = el("select", { class: "field-input" }, ...CL_SOUNDS.map((s) => el("option", { value: s, ...(s === current ? { selected: "" } : {}) }, s)));
  select.addEventListener("change", () => { clSoundStop(); clSoundPlay(select.value, false); });
  return select;
}

// -------------------------------------------------------------- Stopwatch

function clSwElapsed(sw) { return sw.acc + (sw.startAt ? Date.now() - sw.startAt : 0); }

function clStopwatch(main) {
  const d = clData();
  const sw = d.sw;
  const face = el("button", { type: "button", class: `cl-sw-face ${d.face}`, "aria-label": "Digital or analog (tap)" });
  face.addEventListener("click", () => { const x = clData(); x.face = x.face === "analog" ? "digital" : "analog"; clSave(x); clRender(); });
  const left = el("button", { type: "button", class: "cl-round gray" });
  const right = el("button", { type: "button", class: "cl-round" });
  const laps = el("div", { class: "cl-laps" });
  left.addEventListener("click", () => {
    const x = clData();
    if (x.sw.startAt) x.sw.laps.push(clSwElapsed(x.sw) - x.sw.laps.reduce((n, l) => n + l, 0));
    else x.sw = { startAt: null, acc: 0, laps: [] };
    clSave(x);
    clRender();
  });
  right.addEventListener("click", () => {
    const x = clData();
    if (x.sw.startAt) { x.sw.acc = clSwElapsed(x.sw); x.sw.startAt = null; } else x.sw.startAt = Date.now();
    clSave(x);
    clRender();
  });
  const running = Boolean(sw.startAt), elapsed = clSwElapsed(sw);
  left.textContent = running ? "Lap" : "Reset";
  left.disabled = !running && !elapsed;
  right.textContent = running ? "Stop" : "Start";
  right.classList.toggle("red", running);
  right.classList.toggle("green", !running);
  if (d.face === "analog") face.append(clDial());
  else face.append(el("span", { class: "cl-sw-digits" }));
  // The laps, newest first: the one running, then the rest; with three or
  // more done, the best in green and the worst in red.
  const done = sw.laps;
  const best = done.length >= 2 ? Math.min(...done) : null, worst = done.length >= 2 ? Math.max(...done) : null;
  const lapRows = done.map((ms, i) => el("div", { class: `cl-lap${ms === best ? " best" : ms === worst ? " worst" : ""}` }, el("span", {}, `Lap ${i + 1}`), el("span", {}, clDuration(ms, true)))).reverse();
  const current = elapsed ? el("div", { class: "cl-lap current" }, el("span", {}, `Lap ${done.length + 1}`), el("span", { class: "cl-lap-now" })) : "";
  laps.append(...(current ? [current] : []), ...lapRows);
  main.replaceChildren(el("div", { class: "mu-page cl-page cl-sw" }, face, el("div", { class: "cl-rounds" }, left, right), laps));
  const draw = () => {
    const x = clData().sw, t = clSwElapsed(x), lapNow = t - x.laps.reduce((n, l) => n + l, 0);
    const digits = face.querySelector(".cl-sw-digits");
    if (digits) digits.textContent = clDuration(t, true);
    const hand = face.querySelector(".cl-hand-s"), small = face.querySelector(".cl-hand-m"), text = face.querySelector(".cl-dial-text");
    if (hand) hand.setAttribute("transform", `rotate(${((t / 1000) % 60) * 6} 100 100)`);
    if (small) small.setAttribute("transform", `rotate(${((t / 60000) % 30) * 12} 100 140)`);
    if (text) text.textContent = clDuration(t, true);
    const now = laps.querySelector(".cl-lap-now");
    if (now) now.textContent = clDuration(lapNow, true);
  };
  draw();
  if (running) clock.swTimer = setInterval(draw, 37);
}

// The stopwatch's analog face: 60 seconds round, a small dial for 30 minutes.
function clDial() {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 200 200");
  s.setAttribute("class", "cl-dial");
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; s.append(n); return n; };
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * 2 * Math.PI, long = i % 20 === 0, mid = i % 4 === 0;
    const r1 = long ? 86 : mid ? 89 : 92;
    add("line", { x1: 100 + r1 * Math.sin(a), y1: 100 - r1 * Math.cos(a), x2: 100 + 95 * Math.sin(a), y2: 100 - 95 * Math.cos(a), class: long ? "cl-tick long" : "cl-tick" });
  }
  for (let n = 5; n <= 60; n += 5) {
    const a = (n / 60) * 2 * Math.PI;
    add("text", { x: 100 + 76 * Math.sin(a), y: 100 - 76 * Math.cos(a) + 4, class: "cl-dial-num" }, String(n));
  }
  add("circle", { cx: 100, cy: 140, r: 20, class: "cl-subdial" });
  add("line", { x1: 100, y1: 140, x2: 100, y2: 124, class: "cl-hand-m" });
  add("text", { x: 100, y: 72, class: "cl-dial-text" }, "00:00.00");
  add("line", { x1: 100, y1: 116, x2: 100, y2: 8, class: "cl-hand-s" });
  add("circle", { cx: 100, cy: 100, r: 3.5, class: "cl-dial-pin" });
  return s;
}

// ----------------------------------------------------------------- Timers

function clTimerLeft(t) { return t.endsAt ? t.endsAt - Date.now() : t.left; }

function clTimers(main) {
  const d = clData();
  const page = el("div", { class: "mu-page cl-page" }, clHead("Timers"));
  // The ones running (or paused), each with its ring.
  if (d.timers.length) {
    page.append(el("div", { class: "cl-timer-list" }, ...d.timers.map((t) => {
      const ring = el("div", { class: "cl-ring", "data-id": t.id }, el("div", { class: "cl-ring-in" }, el("strong", { class: "cl-ring-time" }), el("span", {}, t.label || clDuration(t.total))));
      const pause = el("button", { type: "button", class: "cl-round small" }, t.endsAt ? "Pause" : "Resume");
      pause.classList.toggle("orange", Boolean(t.endsAt));
      pause.classList.toggle("green", !t.endsAt);
      pause.addEventListener("click", () => {
        const x = clData(), y = x.timers.find((z) => z.id === t.id);
        if (!y) return;
        if (y.endsAt) { y.left = y.endsAt - Date.now(); y.endsAt = null; } else { y.endsAt = Date.now() + y.left; }
        clSave(x); clRender();
      });
      const cancel = el("button", { type: "button", class: "cl-round small gray" }, "Cancel");
      cancel.addEventListener("click", () => { const x = clData(); x.timers = x.timers.filter((z) => z.id !== t.id); clSave(x); clRender(); });
      return el("div", { class: "cl-timer" }, ring, el("div", { class: "cl-rounds" }, cancel, pause));
    })));
  }
  // A new one: hours, minutes, seconds; its label and sound; Start.
  const num = (max, value, name) => el("select", { class: "field-input cl-pick", "aria-label": name }, ...Array.from({ length: max + 1 }, (_, i) => el("option", { value: String(i), ...(i === value ? { selected: "" } : {}) }, `${i}`)));
  const hours = num(23, 0, "Hours"), mins = num(59, 5, "Minutes"), secs = num(59, 0, "Seconds");
  const label = el("input", { class: "field-input", type: "text", placeholder: "Timer", maxlength: "60" });
  const sound = clSoundPicker("Bells");
  const start = el("button", { type: "button", class: "cl-round green" }, "Start");
  start.addEventListener("click", () => {
    const total = (Number(hours.value) * 3600 + Number(mins.value) * 60 + Number(secs.value)) * 1000;
    if (!total) return toast("A timer needs a length.");
    clSoundStop();
    clStartTimer(total, label.value.trim(), sound.value);
  });
  const presets = el("div", { class: "cl-presets" }, ...CL_PRESETS.map((s) => {
    const b = el("button", { type: "button", class: "cl-preset" }, el("strong", {}, String(s / 60)), el("span", {}, "min"));
    b.addEventListener("click", () => clStartTimer(s * 1000, "", "Bells"));
    return b;
  }));
  page.append(el("section", { class: "cl-new-timer" }, el("div", { class: "cl-picks" }, hours, el("span", {}, "hours"), mins, el("span", {}, "min"), secs, el("span", {}, "sec")),
    el("div", { class: "cl-form" }, el("label", { class: "cl-form-row" }, el("span", {}, "Label"), label), el("label", { class: "cl-form-row" }, el("span", {}, "When Timer Ends"), sound)),
    el("div", { class: "cl-rounds" }, start)),
  el("h3", { class: "cl-section" }, "Presets"), presets);
  if (d.recents.length) {
    page.append(el("h3", { class: "cl-section" }, "Recents"), ...d.recents.map((r) => {
      const b = el("button", { type: "button", class: "cl-round small green", "aria-label": "Start" }, svg(CL_ICONS.play));
      b.addEventListener("click", () => clStartTimer(r.total, r.label, r.sound));
      return el("div", { class: "cl-row" }, el("div", { class: "cl-row-text" }, el("div", { class: "cl-big-time" }, clDuration(r.total)), el("span", { class: "cl-sub" }, r.label || "Timer")), b);
    }));
  }
  main.replaceChildren(page);
  const draw = () => {
    for (const ring of main.querySelectorAll(".cl-ring")) {
      const t = clData().timers.find((x) => x.id === ring.dataset.id);
      if (!t) continue;
      const left = Math.max(0, clTimerLeft(t));
      ring.querySelector(".cl-ring-time").textContent = clDuration(left + 999);
      ring.style.setProperty("--done", `${(1 - left / t.total) * 360}deg`);
    }
  };
  draw();
  if (d.timers.length) clock.swTimer = setInterval(draw, 250);
}

function clStartTimer(total, label, sound) {
  const d = clData();
  d.timers.push({ id: Math.random().toString(36).slice(2, 10), total, label, sound, endsAt: Date.now() + total, left: total });
  d.recents = [{ total, label, sound }, ...d.recents.filter((r) => !(r.total === total && r.label === label))].slice(0, 6);
  clSave(d);
  clRender();
}

// ------------------------------------------------------------ ringing

// Every second, on every page of adlerOS: an alarm whose minute has come, or
// a timer that's run out, rings (one at a time).
function clCheck() {
  if (clock.ringing) return;
  const d = clData();
  const now = Date.now();
  for (const t of d.timers) {
    if (t.endsAt && t.endsAt <= now) {
      d.timers = d.timers.filter((x) => x.id !== t.id);
      clSave(d);
      if (isOpen("clock") && clock.tab === "timers") clRender();
      return clRing({ kind: "timer", title: t.label || "Timer", sub: clDuration(t.total), sound: t.sound, timer: t });
    }
  }
  for (const a of d.alarms) {
    if (!a.on) continue;
    const due = a.snoozeUntil ? a.snoozeUntil <= now : clDue(a, now);
    if (!due) continue;
    a.snoozeUntil = null;
    a.lastRang = Math.floor(now / 60000);
    if (!a.days?.length && !a.snoozeUntil) a.on = false; // once: off after it rings
    clSave(d);
    if (isOpen("clock") && clock.tab === "alarms") clRender();
    const { hm, period } = clAlarmTime(a);
    return clRing({ kind: "alarm", title: a.label || "Alarm", sub: `${hm}${period ? ` ${period}` : ""}`, sound: a.sound, alarm: a });
  }
}
// This minute is the alarm's, on one of its days, and it hasn't rung in it.
function clDue(a, now) {
  const d = new Date(now);
  return d.getHours() === a.h && d.getMinutes() === a.m && (!a.days?.length || a.days.includes(d.getDay())) && a.lastRang !== Math.floor(now / 60000);
}

function clRing(r) {
  clock.ringing = r;
  const box = el("div", { class: "cl-ringing", role: "alertdialog", "aria-label": r.title },
    el("div", { class: "cl-ringing-sub" }, r.kind === "alarm" ? "Alarm" : "Timer"), el("div", { class: "cl-ringing-time" }, r.sub), el("div", { class: "cl-ringing-title" }, r.title));
  const buttons = el("div", { class: "cl-ringing-buttons" });
  const stop = el("button", { type: "button", class: "cl-ringing-stop" }, "Stop");
  stop.addEventListener("click", () => clRingEnd());
  if (r.kind === "alarm" && r.alarm.snooze) {
    const snooze = el("button", { type: "button", class: "cl-ringing-snooze" }, `Snooze (${r.alarm.snoozeMin || 9} min)`);
    snooze.addEventListener("click", () => {
      const d = clData(), a = d.alarms.find((x) => x.id === r.alarm.id);
      if (a) { a.on = true; a.snoozeUntil = Date.now() + (a.snoozeMin || 9) * 60000; clSave(d); }
      clRingEnd();
      toast(`Snoozed for ${r.alarm.snoozeMin || 9} minutes.`);
    });
    buttons.append(snooze);
  }
  if (r.kind === "timer") {
    const again = el("button", { type: "button", class: "cl-ringing-snooze" }, "Repeat");
    again.addEventListener("click", () => { clRingEnd(); clStartTimer(r.timer.total, r.timer.label, r.timer.sound); });
    buttons.append(again);
  }
  buttons.append(stop);
  box.append(buttons);
  document.body.append(box);
  stop.focus();
  clSoundPlay(r.sound, true);
  clock.title = document.title;
  document.title = `⏰ ${r.title}`;
}
function clRingEnd() {
  clSoundStop();
  document.querySelector(".cl-ringing")?.remove();
  if (clock.title) document.title = clock.title;
  clock.ringing = null;
}

// The sounds, made here: a few notes, again every couple of seconds while
// it rings. A page may only make sound after a tap, so the first tap
// anywhere readies it.
function clAudio() {
  if (!clock.audio) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    clock.audio = new C();
  }
  if (clock.audio.state === "suspended") clock.audio.resume().catch(() => {});
  return clock.audio;
}
addEventListener("pointerdown", () => clAudio(), { once: true, capture: true });

function clNotes(name) {
  // [frequency, start (s), length (s), wave]
  return { Chime: [[880, 0, 0.5, "sine"], [1109, 0.18, 0.5, "sine"], [1319, 0.36, 0.8, "sine"]],
    Beacon: [[1047, 0, 0.12, "triangle"], [1047, 0.2, 0.12, "triangle"], [1047, 0.4, 0.12, "triangle"], [1319, 0.6, 0.3, "triangle"]],
    Bells: [[659, 0, 1.2, "sine"], [988, 0, 1.2, "sine"], [1319, 0.4, 1.2, "sine"], [1976, 0.4, 0.8, "sine"]],
    Pulse: [[523, 0, 0.18, "square"], [523, 0.3, 0.18, "square"], [523, 0.6, 0.18, "square"]],
    Sunrise: [[392, 0, 0.6, "sine"], [494, 0.3, 0.6, "sine"], [587, 0.6, 0.6, "sine"], [784, 0.9, 0.9, "sine"]] }[name] || [];
}
function clSoundOnce(name, gainLevel = 0.18) {
  const ctx = clAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (const [f, at, len, type] of clNotes(name)) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(gainLevel, t0 + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + len + 0.05);
  }
}
function clSoundPlay(name, loop) {
  clSoundStop();
  if (name === "None") return;
  clSoundOnce(name);
  if (loop) clock.loop = setInterval(() => clSoundOnce(name), 2200);
}
function clSoundStop() { clearInterval(clock.loop); clock.loop = null; }

setInterval(clCheck, 1000);
document.addEventListener("keydown", (e) => {
  if (!clock.ringing) return;
  if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); document.querySelector(".cl-ringing button")?.click(); }
}, true);
