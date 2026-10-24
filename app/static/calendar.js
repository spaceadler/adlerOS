// Calendar: your calendars as your CalDAV server has them (Radicale, in a
// homelab): a day, a week or a month, each event in its calendar's color, a
// line at now. Changed here too, on the server, so your phone's calendar has
// it as well: dragged to another time or day (its foot: how long), made by
// dragging across free hours (or a double click, or N), and edited (a right
// click, or its details): name, place, all day, when, travel time, repeats,
// calendar, notes. A repeating one asks which: only this one, this and the
// ones after, or all of them. adlerOS's server asks the CalDAV server
// (CALDAV_USER, CALDAV_PASSWORD) and works out every repeat; the page never
// sees the password, and asks for days in its own time zone. Before it's
// connected: the calendar, empty, with how to connect above it. Uses el, svg, $, api, showLock, registerWindow, openWindow,
// toggleWindow, closeWindow, isOpen, winLoad/winSave, phoneLayout, appById,
// openApp, settingsFile, settingsThen.
"use strict";

const CAL_KEY = "adleros.calendar";
const CAL_ICONS = {
  close: ["M18 6 6 18", "m6 6 12 12"], prev: ["m15 18-6-6 6-6"], next: ["m9 18 6-6-6-6"],
  place: ["M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  repeat: ["m17 2 4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "m7 22-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  zone: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18", "M12 3a14 14 0 0 1 0 18", "M12 3a14 14 0 0 0 0 18"],
  open: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  plus: ["M12 5v14", "M5 12h14"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6"],
  car: ["M5 17h14", "M6 17v2", "M18 17v2", "M4 13l2-6h12l2 6v4H4z", "M7.5 14h.01", "M16.5 14h.01"],
};
const CAL_VIEWS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
const CAL_HOUR = () => (phoneLayout() ? 44 : 48); // a time grid's hour, in pixels
const CAL_FRESH = 60 * 1000; // a range's events, kept this long before they're asked for again
const CAL_LANE = 20; // a month's event bars, one above the next

const cal = {
  built: false, status: null, day: null, selected: null, prefs: { view: null, hidden: [] },
  cache: new Map(), shown: null, timer: null, minute: null, asking: 0,
};

// ------------------------------------------------------------- dates

// Days as the page's own (local) days: a Date at midnight, or "YYYY-MM-DD".
const calYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const calFromYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const calAdd = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const calMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const calSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const calDays = (a, b) => Math.round((calMidnight(b) - calMidnight(a)) / 86400000);
const calZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

// The first day of a week where you are (your browser's language says):
// 0 Sunday … 6 Saturday, Monday if it doesn't say.
const CAL_FIRST = (() => {
  try {
    const loc = new Intl.Locale(navigator.language || "en");
    const info = loc.getWeekInfo?.() || loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch { /* an old browser */ }
  return 1;
})();
const calWeekStart = (d) => calAdd(calMidnight(d), -((d.getDay() - CAL_FIRST + 7) % 7));

const calTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const calLong = (d) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

// The days a view shows: [first, last].
function calRange(view = calView(), day = cal.day) {
  if (view === "day") return [day, day];
  if (view === "week") { const s = calWeekStart(day); return [s, calAdd(s, 6)]; }
  const s = calWeekStart(new Date(day.getFullYear(), day.getMonth(), 1));
  return [s, calAdd(s, 41)];
}

function calView() { return cal.prefs.view || (phoneLayout() ? "month" : "week"); }

// ------------------------------------------------------------ the window

async function openCalendar() {
  calBuild();
  openWindow("calendar");
  if (!cal.status?.ok) await calCheck();
  else calRender();
  calTick();
  if (!$("calendar").contains(document.activeElement)) $("cal-main").focus({ preventScroll: true });
}

// A redraw takes away what had the focus (a day, a button): it goes to the
// calendar itself instead, so its keys (T, ←, →, D, W, M) still reach it.
function calKeepFocus(draw) {
  const inside = $("calendar")?.contains(document.activeElement);
  draw();
  if (inside && !$("calendar").contains(document.activeElement)) $("cal-main")?.focus({ preventScroll: true });
}

function toggleCalendar() { toggleWindow("calendar", () => openCalendar()); }

function closeCalendar() {
  closeWindow("calendar");
  calPopClose();
}

function calBuild() {
  if (cal.built) return;
  cal.built = true;
  const saved = winLoad(CAL_KEY, null);
  if (saved && typeof saved === "object") cal.prefs = { ...cal.prefs, ...saved, hidden: Array.isArray(saved.hidden) ? saved.hidden : [] };
  cal.day = calMidnight(new Date());
  cal.selected = cal.day;
  const close = el("button", { class: "sheet-close cal-close", type: "button", "aria-label": "Close Calendar" }, svg(CAL_ICONS.close));
  close.addEventListener("click", closeCalendar);
  const button = (label, icon, run, cls = "cal-icon") => {
    const b = el("button", { type: "button", class: cls, "aria-label": label, title: label }, svg(icon));
    b.addEventListener("click", run);
    return b;
  };
  const today = el("button", { type: "button", class: "chip-button cal-today", title: "Today (T)" }, "Today");
  today.addEventListener("click", () => calGo(calMidnight(new Date())));
  const views = el("div", { class: "cal-views", role: "tablist", "aria-label": "View" },
    ...CAL_VIEWS.map(([id, name]) => {
      const b = el("button", { type: "button", role: "tab", class: "cal-view", "data-view": id, title: `${name} (${name[0]})` }, name);
      b.addEventListener("click", () => calSetView(id));
      return b;
    }));
  const lists = button("Calendars", CAL_ICONS.list, (e) => calListsPop(e.currentTarget), "cal-icon cal-lists-button");
  const add = button("New event (N)", CAL_ICONS.plus, () => calNew(), "cal-icon cal-add");
  const section = el("section", { id: "calendar", class: "sheet calendar-app", "aria-label": "Calendar", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "cal-shell" },
      el("aside", { class: "cal-side", id: "cal-side" }),
      el("div", { class: "cal-body" },
        el("header", { class: "cal-head" },
          el("div", { class: "cal-nav" }, button("Back (←)", CAL_ICONS.prev, () => calStep(-1)), today, button("Next (→)", CAL_ICONS.next, () => calStep(1))),
          el("h1", { class: "cal-title", id: "cal-title" }),
          el("div", { class: "cal-head-tools" }, add, lists, views)),
        el("div", { class: "cal-note", id: "cal-note", hidden: "" }),
        el("main", { class: "cal-main", id: "cal-main", tabindex: "-1" }))));
  document.body.insertBefore(section, $("modal"));
  registerWindow("calendar", { title: "Calendar", close: closeCalendar, hide: () => closeWindow("calendar"), dock: "calendar", size: [1120, 780] });
  section.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === "Escape" && $("cal-pop")) { e.preventDefault(); e.stopPropagation(); calPopClose(); }
    else if (k === "t") calGo(calMidnight(new Date()));
    else if (e.key === "ArrowLeft") calStep(-1);
    else if (e.key === "ArrowRight") calStep(1);
    else if (k === "d" || k === "w" || k === "m") calSetView({ d: "day", w: "week", m: "month" }[k]);
    else if (k === "n") calNew();
    else if (k === "e" && cal.popEvent) calEdit(cal.popEvent);
    else if ((e.key === "Delete" || e.key === "Backspace") && cal.popEvent) calDelete(cal.popEvent);
    else return;
    e.preventDefault();
  });
  // A swipe across it (a phone, a tablet): the next or the one before.
  let touch = null;
  const main = $("cal-main");
  main.addEventListener("touchstart", (e) => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null; }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (!touch || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && Date.now() - touch.t < 600) calStep(dx < 0 ? 1 : -1);
    touch = null;
  }, { passive: true });
  let resize = null;
  new ResizeObserver(() => { clearTimeout(resize); resize = setTimeout(() => { if (isOpen("calendar")) calDraw(); }, 120); }).observe(main);
  // Clicks elsewhere put an event's details away.
  section.addEventListener("pointerdown", (e) => { if ($("cal-pop") && !e.target.closest("#cal-pop, .cal-ev, .cal-bar, .cal-lists-button")) calPopClose(); });
}

// Asked again every minute while it's open (the now line moves, events change).
function calTick() {
  clearInterval(cal.timer);
  cal.timer = setInterval(() => {
    if (!isOpen("calendar")) { clearInterval(cal.timer); cal.timer = null; return; }
    calNowLine();
    if (cal.status?.ok) calLoad(true);
    // Past midnight: today moves on.
    if (cal.minute && !calSameDay(cal.minute, new Date())) calDraw();
    cal.minute = new Date();
  }, 60 * 1000);
  cal.minute = new Date();
}

async function calCheck() {
  const { status, body } = await api("/api/calendar/status").catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  cal.status = status === 200 && body ? body : { error: "unreachable" };
  cal.cache.clear();
  calRender();
}

function calSave() { winSave(CAL_KEY, cal.prefs); }

function calSetView(view) {
  cal.prefs.view = view;
  calSave();
  if (cal.selected) cal.day = cal.selected; // the day you'd picked (or today), in whichever view
  calRender();
}

function calGo(day) {
  cal.day = calMidnight(day);
  cal.selected = cal.day;
  calRender();
}

function calStep(dir) {
  const v = calView(), d = cal.day;
  cal.day = v === "day" ? calAdd(d, dir) : v === "week" ? calAdd(d, 7 * dir) : new Date(d.getFullYear(), d.getMonth() + dir, 1);
  if (v === "month") cal.selected = calSameDay(new Date(cal.day.getFullYear(), cal.day.getMonth(), 1), new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    ? calMidnight(new Date()) : cal.day;
  else cal.selected = cal.day;
  calRender();
}

// ------------------------------------------------------------ events

// A range's events: kept a minute; asked for again (fresh) when they're older.
async function calLoad(fresh = false) {
  const [a, b] = calRange();
  const key = `${calYmd(a)}|${calYmd(b)}`;
  const kept = cal.cache.get(key);
  if (kept && !fresh && Date.now() - kept.at < CAL_FRESH) return kept;
  const ask = ++cal.asking;
  const q = new URLSearchParams({ from: calYmd(a), to: calYmd(b), tz: calZone() });
  const { status, body } = await api(`/api/calendar/events?${q}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  if (status !== 200 || !body) {
    if (status === 409 && body?.status) { cal.status = body.status; calRender(); }
    else if (!kept) calNoteError(body?.error || "The calendar server didn't answer.");
    return kept || null;
  }
  const got = { at: Date.now(), calendars: body.calendars, events: body.events.map(calEvent) };
  cal.cache.set(key, got);
  if (cal.cache.size > 24) cal.cache.delete(cal.cache.keys().next().value);
  if (cal.status) cal.status.calendars = body.calendars;
  // Still the range on screen, and something changed: drawn again.
  if (ask === cal.asking && (!kept || JSON.stringify(kept.events.map((e) => [e.id, e.start, e.end, e.title])) !== JSON.stringify(got.events.map((e) => [e.id, e.start, e.end, e.title])))) {
    cal.shown = got;
    calDraw();
    calRenderSide();
  }
  return got;
}

function calEvent(e) {
  const s = e.allDay ? calFromYmd(e.start) : new Date(e.start);
  let en = e.allDay ? calFromYmd(e.end) : new Date(e.end);
  if (!(en > s) && e.allDay) en = calAdd(s, 1);
  return { ...e, s, e: en };
}

const calColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? (c.length === 9 ? c.slice(0, 7) : c) : "");

function calCalendar(id) { return (cal.status?.calendars || []).find((c) => c.id === id); }

function calEventColor(ev) { return calColor(ev.color) || calColor(calCalendar(ev.calendar)?.color) || "#4c9aff"; }

function calVisible(events) {
  const hidden = new Set(cal.prefs.hidden);
  return events.filter((ev) => !hidden.has(ev.calendar));
}

// Shown in the all-day row (or as a month's bar): all-day, or a day long or more.
const calLong24 = (ev) => ev.allDay || ev.e - ev.s >= 86400000;

// The last day it's on (an all-day one's end is the day after).
const calLastDay = (ev) => calMidnight(new Date(ev.e - 1 > ev.s ? ev.e - 1 : ev.s));

// ------------------------------------------------------------ drawing

function calRender() {
  if (!cal.built) return;
  for (const b of document.querySelectorAll("#calendar .cal-view")) {
    const on = b.dataset.view === calView();
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  }
  calRenderNote();
  calRenderSide();
  const [a, b] = calRange();
  const key = `${calYmd(a)}|${calYmd(b)}`;
  const kept = cal.cache.get(key);
  cal.shown = kept || { events: [] };
  calDraw();
  if (cal.status?.ok) calLoad();
}

function calDraw() { calKeepFocus(calDrawNow); }

function calDrawNow() {
  const v = calView();
  const main = $("cal-main");
  if (!main) return;
  $("cal-title").textContent = calTitle(v);
  calPopClose();
  const events = calVisible(cal.shown?.events || []);
  const scroll = main.querySelector(".cal-tscroll")?.scrollTop;
  if (v === "month") calMonth(main, events);
  else calTimeGrid(main, events, v === "day" ? 1 : 7, scroll);
}

function calTitle(v) {
  const d = cal.day;
  if (v === "day") return calLong(d);
  if (v === "month") return d.toLocaleDateString([], { month: "long", year: "numeric" });
  const [a, b] = calRange("week", d);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString([], { day: "numeric", ...(sameMonth ? {} : { month: "short" }) });
  const right = b.toLocaleDateString([], { day: "numeric", month: sameMonth ? "long" : "short", year: "numeric" });
  return `${left} – ${right}`;
}

// The line above it, until it's connected (or when the server can't be reached).
function calRenderNote() {
  const note = $("cal-note");
  const s = cal.status;
  if (!s || s.ok) { note.hidden = true; return; }
  const file = settingsFile();
  const text = s.error === "nologin"
    ? [el("strong", {}, "Connect your calendar. "), `Calendar shows your calendars from Radicale (or any CalDAV server). Put your login in ${file} as CALDAV_USER=… and CALDAV_PASSWORD=…${settingsThen()}.`,
      ...(s.url ? [el("span", { class: "cal-dim" }, ` It'll ask ${s.url}.`)] : [])]
    : s.error === "noserver"
      ? [el("strong", {}, "Connect your calendar. "), `Radicale isn't among your apps here. Set CALDAV_URL in ${file} to your CalDAV server's address, with CALDAV_USER and CALDAV_PASSWORD${settingsThen()}.`]
      : s.error === "refused"
        ? [el("strong", {}, "The calendar server didn't take the login. "), `CALDAV_USER and CALDAV_PASSWORD in ${file} aren't a login ${s.url || "it"} knows.`]
        : s.error === "nocalendars"
          ? [el("strong", {}, "No calendars there. "), `${s.url} answered, but doesn't have calendars for that login: is CALDAV_URL your CalDAV server's address?`]
          : [el("strong", {}, "Can't reach your calendars. "), `${s.url || "The calendar server"} didn't answer. Is Radicale running? (The App Store starts it.)`,
            ...(s.error && s.error !== "unreachable" ? [el("span", { class: "cal-dim" }, ` ${s.error}`)] : [])];
  const retry = el("button", { type: "button", class: "chip-button" }, "Try again");
  retry.addEventListener("click", calCheck);
  note.replaceChildren(el("p", {}, ...text), retry);
  note.hidden = false;
}

function calNoteError(message) {
  const note = $("cal-note");
  const retry = el("button", { type: "button", class: "chip-button" }, "Try again");
  retry.addEventListener("click", calCheck);
  note.replaceChildren(el("p", {}, el("strong", {}, "Can't get the events. "), message), retry);
  note.hidden = false;
}

// The side: a month to pick a day from, and your calendars (each one on or off).
function calRenderSide() { calKeepFocus(calRenderSideNow); }

function calRenderSideNow() {
  const side = $("cal-side");
  if (!side) return;
  const month = new Date((cal.mini || cal.day).getFullYear(), (cal.mini || cal.day).getMonth(), 1);
  const head = el("div", { class: "cal-mini-head" },
    el("span", {}, month.toLocaleDateString([], { month: "long", year: "numeric" })));
  for (const [dir, icon, label] of [[-1, CAL_ICONS.prev, "Month before"], [1, CAL_ICONS.next, "Month after"]]) {
    const b = el("button", { type: "button", class: "cal-mini-step", "aria-label": label }, svg(icon));
    b.addEventListener("click", () => { cal.mini = new Date(month.getFullYear(), month.getMonth() + dir, 1); calRenderSide(); });
    head.append(b);
  }
  const grid = el("div", { class: "cal-mini-grid" });
  const start = calWeekStart(month);
  for (let i = 0; i < 7; i++) grid.append(el("span", { class: "cal-mini-wd" }, calAdd(start, i).toLocaleDateString([], { weekday: "narrow" })));
  const [ra, rb] = calRange();
  const today = new Date();
  for (let i = 0; i < 42; i++) {
    const d = calAdd(start, i);
    const b = el("button", { type: "button", class: "cal-mini-day", "aria-label": calLong(d) }, String(d.getDate()));
    b.classList.toggle("out", d.getMonth() !== month.getMonth());
    b.classList.toggle("cal-is-today", calSameDay(d, today));
    b.classList.toggle("in", calView() !== "month" && d >= ra && d <= rb);
    b.classList.toggle("on", cal.selected && calSameDay(d, cal.selected));
    b.addEventListener("click", () => { cal.mini = null; calGo(d); });
    grid.append(b);
  }
  side.replaceChildren(el("div", { class: "cal-mini" }, head, grid), calListsBox());
}

// Your calendars, each with its color: a click hides it or shows it again.
function calListsBox() {
  const calendars = cal.status?.calendars || [];
  const hidden = new Set(cal.prefs.hidden);
  const box = el("div", { class: "cal-lists" }, el("h3", { class: "cal-side-title" }, "Calendars"));
  if (!calendars.length) box.append(el("p", { class: "cal-dim cal-lists-none" }, cal.status?.ok ? "None yet." : "Once it's connected, your calendars."));
  for (const c of calendars) {
    const on = !hidden.has(c.id);
    const b = el("button", { type: "button", class: `cal-list${on ? " on" : ""}`, role: "checkbox", "aria-checked": String(on) },
      el("span", { class: "cal-check" }), el("span", { class: "cal-list-name" }, c.name));
    b.style.setProperty("--c", calColor(c.color) || "#4c9aff");
    b.addEventListener("click", () => {
      cal.prefs.hidden = on ? [...hidden, c.id] : [...hidden].filter((x) => x !== c.id);
      calSave();
      calRenderSide();
      calDraw();
      const pop = $("cal-pop");
      if (pop?.classList.contains("cal-pop-lists")) pop.replaceChildren(calListsBox());
    });
    box.append(b);
  }
  const app = typeof appById === "function" ? appById("radicale") : null;
  if (app) {
    const out = el("button", { type: "button", class: "cal-list cal-out" }, svg(CAL_ICONS.open), el("span", { class: "cal-list-name" }, "Open Radicale"));
    out.addEventListener("click", () => openApp(app));
    box.append(out);
  }
  return box;
}

// A narrow window: the calendars in a pop-up from the header's button.
function calListsPop(anchor) {
  if ($("cal-pop")?.classList.contains("cal-pop-lists")) return calPopClose();
  calPopOpen(anchor, el("div", {}, calListsBox()), "cal-pop-lists");
}

// ------------------------------------------------------------ a month

function calMonth(main, events) {
  const [first] = calRange("month");
  const month = cal.day.getMonth();
  const compact = main.clientWidth < 560; // a phone: dots, and the day's events under
  const today = new Date();
  const box = el("div", { class: `cal-month${compact ? " compact" : ""}` });
  const wdays = el("div", { class: "cal-wdays" });
  for (let i = 0; i < 7; i++) wdays.append(el("span", {}, calAdd(first, i).toLocaleDateString([], { weekday: compact ? "narrow" : "short" })));
  const weeks = el("div", { class: "cal-weeks" });
  box.append(wdays, weeks);
  main.replaceChildren(box);
  main.scrollTop = 0;
  const rows = [];
  for (let w = 0; w < 6; w++) {
    const start = calAdd(first, w * 7);
    const row = el("div", { class: "cal-week" });
    const days = el("div", { class: "cal-week-days" });
    for (let i = 0; i < 7; i++) {
      const d = calAdd(start, i);
      const cell = el("button", { type: "button", class: "cal-mday", "aria-label": calLong(d), "data-day": calYmd(d) },
        el("span", { class: "cal-mnum" }, String(d.getDate())));
      cell.classList.toggle("out", d.getMonth() !== month);
      cell.classList.toggle("cal-is-today", calSameDay(d, today));
      cell.classList.toggle("on", compact && cal.selected && calSameDay(d, cal.selected));
      cell.addEventListener("dblclick", () => { if (!compact) calNew({ allDay: true, day: d }); });
      cell.addEventListener("contextmenu", (e) => {
        if (!calCanEdit()) return;
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [{ label: "New event on this day", run: () => calNew({ allDay: true, day: d }) }]);
      });
      cell.addEventListener("click", () => {
        if (Date.now() - (cal.dragged || 0) < 400) return;
        if (compact) { cal.selected = d; calDraw(); calRenderSide(); }
        else { cal.prefs.view = "day"; calSave(); calGo(d); }
      });
      days.append(cell);
    }
    row.append(days);
    weeks.append(row);
    rows.push({ row, days, start });
  }
  // Each week's events laid out in lanes: a bar across its days (all-day,
  // or longer than a day), else one day's, its time and title.
  const lanesFit = compact ? 3 : Math.max(1, Math.floor((rows[0].row.clientHeight - 26) / CAL_LANE));
  for (const { row, days, start } of rows) {
    const end = calAdd(start, 7);
    const items = events.filter((ev) => ev.s < end && ev.e > start && !(ev.e - ev.s === 0 && ev.s < start))
      .map((ev) => {
        const a = Math.max(0, calDays(start, ev.s < start ? start : ev.s));
        const b = Math.min(6, calDays(start, calLastDay(ev)));
        return { ev, a, b: Math.max(a, b), bar: calLong24(ev) || b > a };
      })
      .sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a) || (y.bar - x.bar) || x.ev.s - y.ev.s);
    const lanes = [];
    for (const it of items) {
      let lane = 0;
      while (lanes[lane]?.some(([a, b]) => it.a <= b && it.b >= a)) lane++;
      (lanes[lane] ||= []).push([it.a, it.b]);
      it.lane = lane;
    }
    if (compact) {
      // Dots: one for each event, three at most, under the day's number.
      const per = Array.from({ length: 7 }, () => []);
      for (const it of items) for (let c = it.a; c <= it.b; c++) per[c].push(it.ev);
      per.forEach((list, c) => {
        if (!list.length) return;
        const dots = el("span", { class: "cal-dots" }, ...list.slice(0, 3).map((ev) => {
          const dot = el("span", { class: "cal-dot" });
          dot.style.background = calEventColor(ev);
          return dot;
        }));
        days.children[c].append(dots);
      });
      continue;
    }
    const overflow = lanes.length > lanesFit;
    const shown = overflow ? lanesFit - 1 : lanesFit;
    const more = Array(7).fill(0);
    const layer = el("div", { class: "cal-week-events" });
    for (const it of items) {
      if (it.lane >= shown) { for (let c = it.a; c <= it.b; c++) more[c]++; continue; }
      const node = calChip(it.ev, it.bar, it.ev.s < start, calLastDay(it.ev) >= end);
      node.style.gridColumn = `${it.a + 1} / ${it.b + 2}`;
      node.style.gridRow = String(it.lane + 1);
      layer.append(node);
    }
    more.forEach((n, c) => {
      if (!n) return;
      const b = el("button", { type: "button", class: "cal-more" }, `${n} more`);
      b.style.gridColumn = String(c + 1);
      b.style.gridRow = String(shown + 1);
      b.addEventListener("click", () => { cal.prefs.view = "day"; calSave(); calGo(calAdd(start, c)); });
      layer.append(b);
    });
    row.append(layer);
  }
  if (compact) {
    const d = cal.selected && cal.selected >= first && cal.selected < calAdd(first, 42) ? cal.selected : cal.day;
    box.append(calAgenda(d, events));
  }
}

// A month's event: a bar (all-day, or across days) or a line with its time.
function calChip(ev, bar, fromBefore, goesOn) {
  const color = calEventColor(ev);
  const node = bar
    ? el("button", { type: "button", class: `cal-bar${fromBefore ? " from-before" : ""}${goesOn ? " goes-on" : ""}` },
      el("span", { class: "cal-bar-title" }, ev.allDay ? ev.title || "(No title)" : `${calTime(ev.s)} ${ev.title || "(No title)"}`))
    : el("button", { type: "button", class: "cal-ev cal-line" }, el("span", { class: "cal-dot" }),
      el("span", { class: "cal-line-time" }, calTime(ev.s)), el("span", { class: "cal-line-title" }, ev.title || "(No title)"));
  node.style.setProperty("--c", color);
  node.title = `${ev.title}${ev.allDay ? "" : ` · ${calTime(ev.s)}`}`;
  node.addEventListener("click", (e) => { e.stopPropagation(); if (Date.now() - (cal.dragged || 0) > 400) calShowEvent(ev, node); });
  calEventHooks(node, ev);
  calDayDrag(node, ev);
  return node;
}

// A phone's month: the chosen day's events, under the month.
function calAgenda(day, events) {
  const next = calAdd(day, 1);
  const list = events.filter((ev) => ev.s < next && (ev.e > day || (ev.e - ev.s === 0 && ev.s >= day)))
    .sort((a, b) => (b.allDay - a.allDay) || a.s - b.s);
  const box = el("div", { class: "cal-agenda" }, el("h2", {}, calLong(day)));
  if (!list.length) box.append(el("p", { class: "cal-dim" }, cal.status?.ok ? "Nothing on this day." : ""));
  for (const ev of list) {
    const when = ev.allDay || calLong24(ev) ? "All day" : `${calTime(ev.s)} – ${calTime(ev.e)}`;
    const row = el("button", { type: "button", class: "cal-ev cal-agenda-row" }, el("span", { class: "cal-agenda-bar" }),
      el("span", { class: "cal-agenda-main" }, el("span", { class: "cal-agenda-title" }, ev.title || "(No title)"),
        el("span", { class: "cal-agenda-sub" }, [when, ev.location].filter(Boolean).join(" · "))));
    row.style.setProperty("--c", calEventColor(ev));
    row.addEventListener("click", (e) => { e.stopPropagation(); calShowEvent(ev, row); });
    box.append(row);
  }
  return box;
}

// ------------------------------------------------------- a day, a week

function calTimeGrid(main, events, n, keepScroll) {
  const first = n === 1 ? cal.day : calRange("week")[0];
  const H = CAL_HOUR();
  const today = new Date();
  const box = el("div", { class: "cal-tgrid" });
  box.style.setProperty("--days", String(n));
  box.style.setProperty("--hour", `${H}px`);
  const head = el("div", { class: "cal-thead" }, el("span", { class: "cal-gutter" }));
  for (let i = 0; i < n; i++) {
    const d = calAdd(first, i);
    const h = el("button", { type: "button", class: "cal-tday", "aria-label": calLong(d) },
      el("span", { class: "cal-tday-wd" }, d.toLocaleDateString([], { weekday: "short" })),
      el("span", { class: "cal-tday-num" }, String(d.getDate())));
    h.classList.toggle("cal-is-today", calSameDay(d, today));
    h.addEventListener("click", () => { if (n > 1) { cal.prefs.view = "day"; calSave(); calGo(d); } });
    head.append(h);
  }
  // All day (and anything a day long or more): bars across the days, in lanes.
  const end = calAdd(first, n);
  const longs = events.filter((ev) => calLong24(ev) && ev.s < end && ev.e > first)
    .map((ev) => ({ ev, a: Math.max(0, calDays(first, ev.s < first ? first : ev.s)), b: Math.min(n - 1, calDays(first, calLastDay(ev))) }))
    .sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a) || x.ev.s - y.ev.s);
  const lanes = [];
  for (const it of longs) {
    let lane = 0;
    while (lanes[lane]?.some(([a, b]) => it.a <= b && it.b >= a)) lane++;
    (lanes[lane] ||= []).push([it.a, it.b]);
    it.lane = lane;
  }
  const allday = el("div", { class: "cal-allday" }, el("span", { class: "cal-gutter cal-allday-label" }, "all-day"));
  const bars = el("div", { class: "cal-allday-bars" });
  bars.style.gridTemplateRows = `repeat(${Math.max(1, lanes.length)}, ${CAL_LANE}px)`;
  for (const it of longs) {
    const node = calChip(it.ev, true, it.ev.s < first, calLastDay(it.ev) >= end);
    node.style.gridColumn = `${it.a + 1} / ${it.b + 2}`;
    node.style.gridRow = String(it.lane + 1);
    bars.append(node);
  }
  allday.append(bars);
  // The hours, a column a day, each day's timed events placed in it.
  const scroll = el("div", { class: "cal-tscroll" });
  const body = el("div", { class: "cal-tbody" });
  const gutter = el("div", { class: "cal-hours" });
  for (let h = 1; h < 24; h++) {
    const label = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
    const t = el("span", { class: "cal-hour" }, label);
    t.style.top = `${h * H}px`;
    gutter.append(t);
  }
  body.append(gutter);
  const cols = el("div", { class: "cal-tcols" });
  for (let i = 0; i < n; i++) {
    const d = calAdd(first, i);
    const next = calAdd(d, 1);
    const col = el("div", { class: "cal-tcol", "data-day": calYmd(d) });
    col.classList.toggle("cal-is-today", calSameDay(d, today));
    const segs = events.filter((ev) => !calLong24(ev) && ev.s < next && (ev.e > d || (ev.e - ev.s === 0 && ev.s >= d)))
      .map((ev) => ({ ev, s: ev.s < d ? d : ev.s, e: ev.e > next ? next : ev.e }))
      .sort((a, b) => a.s - b.s || b.e - a.e);
    // Side by side where they overlap: each cluster of overlapping events
    // split into as many columns as it needs.
    let cluster = [], clusterEnd = 0;
    const place = () => {
      const columns = [];
      for (const sg of cluster) {
        let c = 0;
        while (columns[c] && columns[c] > +sg.s) c++;
        columns[c] = +sg.e > +sg.s ? +sg.e : +sg.s + 15 * 60000;
        sg.col = c;
      }
      for (const sg of cluster) sg.cols = columns.length;
      cluster = [];
    };
    for (const sg of segs) {
      const segEnd = Math.max(+sg.e, +sg.s + 15 * 60000);
      if (cluster.length && +sg.s >= clusterEnd) place();
      cluster.push(sg);
      clusterEnd = Math.max(cluster.length > 1 ? clusterEnd : 0, segEnd);
    }
    if (cluster.length) place();
    for (const sg of segs) {
      const top = ((sg.s - d) / 3600000) * H;
      const height = Math.max(18, ((sg.e - sg.s) / 3600000) * H - 2);
      const color = calEventColor(sg.ev);
      const short = height < 34;
      const node = el("button", { type: "button", class: `cal-ev cal-block${short ? " short" : ""}${sg.ev.transparent ? " free" : ""}` },
        el("span", { class: "cal-block-title" }, sg.ev.title || "(No title)"),
        el("span", { class: "cal-block-time" }, short ? ` ${calTime(sg.ev.s)}` : `${calTime(sg.ev.s)} – ${calTime(sg.ev.e)}`),
        ...(!short && sg.ev.location && height > 52 ? [el("span", { class: "cal-block-place" }, sg.ev.location)] : []));
      node.style.setProperty("--c", color);
      node.style.top = `${top}px`;
      node.style.height = `${height}px`;
      node.style.left = `calc(${(sg.col / sg.cols) * 100}% + 1px)`;
      node.style.width = `calc(${100 / sg.cols}% - 3px)`;
      node.title = `${sg.ev.title} · ${calTime(sg.ev.s)} – ${calTime(sg.ev.e)}`;
      node.addEventListener("click", (e) => { e.stopPropagation(); if (Date.now() - (cal.dragged || 0) > 400) calShowEvent(sg.ev, node); });
      calEventHooks(node, sg.ev);
      calTimeDrag(node, sg.ev, H);
      if (sg.ev.travel && +sg.s === +sg.ev.s) {
        // Travel time: the way there, before it.
        const tt = el("div", { class: "cal-travel", "aria-hidden": "true" }, sg.ev.travel >= 30 ? el("span", {}, calMinutes(sg.ev.travel)) : "");
        tt.style.setProperty("--c", color);
        tt.style.top = `${top - (sg.ev.travel / 60) * H}px`;
        tt.style.height = `${(sg.ev.travel / 60) * H}px`;
        tt.style.left = node.style.left;
        tt.style.width = node.style.width;
        col.append(tt);
      }
      col.append(node);
    }
    calColumnHooks(col, d, H);
    cols.append(col);
  }
  body.append(cols);
  scroll.append(body);
  box.append(head, allday, scroll);
  main.replaceChildren(box);
  calNowLine();
  // Where the day starts: as it was, else an hour before now (today), else 7:00.
  const shown = today >= first && today < end;
  scroll.scrollTop = keepScroll ?? Math.max(0, (shown ? today.getHours() + today.getMinutes() / 60 - 1.5 : 7) * H);
}

// The line at now, in today's column (and a dot on the hours' edge).
function calNowLine() {
  document.querySelectorAll("#calendar .cal-now").forEach((n) => n.remove());
  const now = new Date();
  const col = document.querySelector(`#calendar .cal-tcol[data-day="${calYmd(now)}"]`);
  if (!col) return;
  const line = el("div", { class: "cal-now", "aria-hidden": "true" });
  line.style.top = `${((now - calMidnight(now)) / 3600000) * CAL_HOUR()}px`;
  col.append(line);
}

// ------------------------------------------------------- an event's details

function calShowEvent(ev, anchor) {
  const color = calEventColor(ev);
  const calendar = calCalendar(ev.calendar);
  const lastDay = calLastDay(ev);
  let when;
  if (ev.allDay) when = calSameDay(ev.s, lastDay) ? calLong(ev.s) : `${calLong(ev.s)} – ${calLong(lastDay)}`;
  else if (calSameDay(ev.s, ev.e) || +ev.e === +calAdd(calMidnight(ev.s), 1)) when = `${calLong(ev.s)} · ${calTime(ev.s)} – ${calTime(ev.e)}`;
  else when = `${calLong(ev.s)}, ${calTime(ev.s)} – ${calLong(ev.e)}, ${calTime(ev.e)}`;
  const rows = [el("div", { class: "cal-pop-row" }, svg(CAL_ICONS.clock), el("span", {}, when))];
  // Made in another zone: its own time there too.
  if (!ev.allDay && ev.zone && ev.zone !== calZone()) {
    try {
      const there = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: ev.zone });
      if (there(ev.s) !== calTime(ev.s)) rows.push(el("div", { class: "cal-pop-row cal-dim" }, svg(CAL_ICONS.zone), el("span", {}, `${there(ev.s)} – ${there(ev.e)} in ${ev.zone.replace(/_/g, " ")}`)));
    } catch { /* a zone this browser doesn't know (Outlook's own names) */ }
  }
  if (ev.repeats) rows.push(el("div", { class: "cal-pop-row cal-dim" }, svg(CAL_ICONS.repeat), el("span", {}, ev.rrule ? calRuleSentence(calRuleParse(ev.rrule), ev.s) : "Repeats")));
  if (ev.travel) rows.push(el("div", { class: "cal-pop-row cal-dim" }, svg(CAL_ICONS.car), el("span", {}, `${calMinutes(ev.travel)} travel time, from ${calTime(new Date(ev.s - ev.travel * 60000))}`)));
  if (ev.location) rows.push(el("div", { class: "cal-pop-row" }, svg(CAL_ICONS.place), el("span", { class: "cal-pop-text" }, ev.location)));
  if (/^https?:\/\//i.test(ev.url || "")) {
    rows.push(el("div", { class: "cal-pop-row" }, svg(CAL_ICONS.link),
      el("a", { href: ev.url, target: "_blank", rel: "noopener noreferrer", class: "cal-pop-link" }, ev.url.replace(/^https?:\/\//i, ""))));
  }
  const notes = ev.description ? [el("p", { class: "cal-pop-notes" }, ...calLinkify(ev.description))] : [];
  const dot = el("span", { class: "cal-dot" });
  dot.style.background = color;
  const content = el("div", {},
    el("h3", { class: "cal-pop-title" }, ev.title || "(No title)"),
    ...(calendar ? [el("div", { class: "cal-pop-cal" }, dot, el("span", {}, calendar.name))] : []),
    ...(ev.status === "TENTATIVE" ? [el("div", { class: "cal-pop-cal cal-dim" }, "Tentative")] : []),
    ...rows, ...notes);
  if (calCanEdit() && ev.href) {
    const edit = el("button", { type: "button", class: "chip-button" }, svg(CAL_ICONS.edit), "Edit");
    edit.addEventListener("click", () => calEdit(ev));
    const del = el("button", { type: "button", class: "chip-button cal-pop-delete" }, svg(CAL_ICONS.trash), "Delete");
    del.addEventListener("click", () => calDelete(ev));
    content.append(el("div", { class: "cal-pop-actions" }, edit, del));
  }
  calPopOpen(anchor, content, "cal-pop-event");
  cal.popEvent = ev;
}

// Text with its web addresses as links (as text nodes and anchors: nothing
// in it is ever read as HTML).
function calLinkify(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(el("a", { href: m[0], target: "_blank", rel: "noopener noreferrer", class: "cal-pop-link" }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// A pop-up beside what was clicked, inside the window (a phone: along its foot).
function calPopOpen(anchor, content, kind) {
  calPopClose();
  const section = $("calendar");
  const close = el("button", { type: "button", class: "cal-pop-close", "aria-label": "Close" }, svg(CAL_ICONS.close));
  close.addEventListener("click", calPopClose);
  const pop = el("div", { id: "cal-pop", class: `cal-pop material ${kind}`, role: "dialog", "aria-label": "Details" }, close, content);
  section.append(pop);
  const box = section.getBoundingClientRect();
  if (box.width < 560) { pop.classList.add("docked"); return; }
  const r = anchor.getBoundingClientRect();
  const zoom = box.width / section.offsetWidth || 1; // a zoomed window: its own pixels
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const W = section.offsetWidth, Hh = section.offsetHeight;
  let x = (r.right - box.left) / zoom + 8;
  if (x + w > W - 8) x = (r.left - box.left) / zoom - w - 8;
  if (x < 8) x = Math.min(W - w - 8, Math.max(8, (r.left - box.left) / zoom));
  let y = (r.top - box.top) / zoom;
  if (y + h > Hh - 8) y = Math.max(8, Hh - h - 8);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
}

function calPopClose() { cal.popEvent = null; calKeepFocus(() => $("cal-pop")?.remove()); }

// ------------------------------------------------------- changing them

const calCanEdit = () => Boolean(cal.status?.ok && (cal.status.calendars || []).length);
const calMinutes = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m === 60 ? "" : "s"}`);
const CAL_SNAP = 15; // minutes: what a drag moves by
const CAL_TRAVEL = [0, 5, 15, 30, 60, 90, 120];

// What the server gets for an event's times: days (an all-day one's end is
// the day after its last), or instants.
function calWhen(allDay, s, e) {
  return allDay ? { allDay: true, start: calYmd(s), end: calYmd(e) } : { allDay: false, start: s.toISOString(), end: e.toISOString() };
}

// Its dialogs put away: the keys go to the calendar again.
function calFocus() { setTimeout(() => { if (isOpen("calendar") && $("modal").hidden) $("cal-main")?.focus({ preventScroll: true }); }, 0); }

async function calSend(body) {
  const { status, body: got } = await api("/api/calendar/event", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tz: calZone(), ...body }),
  }).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  cal.cache.clear();
  calLoad(true);
  if (status !== 200) { toast(got?.error || "The calendar server didn't answer."); return null; }
  return got;
}

// A repeating one: which of them a change (or a delete) is for.
function calScope(verb, { only = null } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const pick = (v) => { answered = true; closeModal(); resolve(v); };
    const b = (label, value, cls = "button-secondary wide") => {
      const x = el("button", { type: "button", class: cls }, label);
      x.addEventListener("click", () => pick(value));
      return x;
    };
    const choices = [["this", "Only this one"], ["future", "This and the ones after"], ["all", "All of them"]].filter(([v]) => !only || only.includes(v));
    openModal(el("div", { class: "dialog material cal-scope", role: "dialog", "aria-modal": "true" },
      el("h2", {}, "It repeats"), el("p", {}, `${verb} which of them?`),
      el("div", { class: "cal-scope-choices" }, ...choices.map(([v, l], i) => b(l, v, i === 0 ? "button-primary wide" : "button-secondary wide"))),
      el("div", { class: "dialog-actions" }, b("Cancel", null, "button-secondary"))), { onClose: () => { if (!answered) resolve(null); calFocus(); } });
  });
}

// Right click (or a long press): edit it, delete it.
function calEventHooks(node, ev) {
  node._ev = ev;
  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!calCanEdit() || !ev.href) return calShowEvent(ev, node);
    openMenu(e.clientX, e.clientY, [
      { label: "Edit…", run: () => calEdit(ev) },
      { label: "Details", run: () => calShowEvent(ev, node) },
      { label: "Delete", run: () => calDelete(ev), destructive: true },
    ]);
  });
}

// A day's column: double click, or drag across free hours, for a new event
// there; right click for one.
function calColumnHooks(col, day, H) {
  const at = (e) => {
    const r = col.getBoundingClientRect();
    const zoom = r.height / col.offsetHeight || 1;
    const min = Math.max(0, Math.min(24 * 60, ((e.clientY - r.top) / zoom / H) * 60));
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.floor(min / CAL_SNAP) * CAL_SNAP);
  };
  col.addEventListener("dblclick", (e) => {
    if (e.target !== col || !calCanEdit()) return;
    const s = at(e);
    s.setMinutes(Math.floor(s.getMinutes() / 30) * 30);
    calNew({ start: s, end: new Date(+s + 3600000) });
  });
  col.addEventListener("contextmenu", (e) => {
    if (e.target !== col || !calCanEdit()) return;
    e.preventDefault();
    const s = at(e);
    openMenu(e.clientX, e.clientY, [{ label: `New event at ${calTime(s)}`, run: () => calNew({ start: s, end: new Date(+s + 3600000) }) }]);
  });
  col.addEventListener("pointerdown", (e) => {
    if (e.target !== col || e.button !== 0 || e.pointerType === "touch" || !calCanEdit()) return;
    const from = at(e);
    let to = from, box = null;
    const move = (m) => {
      to = at(m);
      if (!box && Math.abs(to - from) < CAL_SNAP * 60000) return;
      if (!box) { box = el("div", { class: "cal-new-box" }); col.append(box); }
      const [a, b] = to > from ? [from, new Date(+to + CAL_SNAP * 60000)] : [to, new Date(+from + CAL_SNAP * 60000)];
      box.style.top = `${((a - day) / 3600000) * H}px`;
      box.style.height = `${((b - a) / 3600000) * H}px`;
      box.textContent = `${calTime(a)} – ${calTime(b)}`;
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (!box) return;
      const [a, b] = to > from ? [from, new Date(+to + CAL_SNAP * 60000)] : [to, new Date(+from + CAL_SNAP * 60000)];
      cal.dragged = Date.now();
      calNew({ start: a, end: b, onClose: () => box.remove() });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
}

// Dragging an event in the hours: up and down its time, sideways its day
// (15 minutes at a time); by its foot, how long it is. With a finger: hold
// it a moment first (a swipe still scrolls).
function calTimeDrag(node, ev, H) {
  if (!ev.href) return;
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !calCanEdit() || e.ctrlKey || e.metaKey) return;
    const col0 = node.parentElement;
    const cols = [...col0.parentElement.children];
    const r0 = node.getBoundingClientRect();
    const zoom = r0.height / node.offsetHeight || 1;
    const resize = e.clientY > r0.bottom - 7 * zoom && !node.classList.contains("short");
    const x0 = e.clientX, y0 = e.clientY;
    const top0 = parseFloat(node.style.top), h0 = parseFloat(node.style.height);
    const day0 = cols.indexOf(col0);
    let live = false, held = e.pointerType !== "touch", timer = null, dMin = 0, dDay = 0;
    if (!held) timer = setTimeout(() => { held = true; node.classList.add("cal-held"); }, 350);
    const noScroll = (t) => { if (live) t.preventDefault(); };
    const move = (m) => {
      if (!held) { if (Math.hypot(m.clientX - x0, m.clientY - y0) > 8) end(false); return; }
      if (!live && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
      if (!live) { live = true; node.classList.add("cal-dragging"); node.setPointerCapture?.(m.pointerId); }
      dMin = Math.round((((m.clientY - y0) / zoom) / H) * 60 / CAL_SNAP) * CAL_SNAP;
      if (resize) {
        const len = Math.max(CAL_SNAP, (ev.e - ev.s) / 60000 + dMin);
        dMin = len - (ev.e - ev.s) / 60000;
        node.style.height = `${Math.max(18, h0 + (dMin / 60) * H)}px`;
        node.querySelector(".cal-block-time").textContent = `${calTime(ev.s)} – ${calTime(new Date(+ev.e + dMin * 60000))}`;
        return;
      }
      const target = cols.findIndex((c) => { const b = c.getBoundingClientRect(); return m.clientX >= b.left && m.clientX < b.right; });
      dDay = target < 0 ? dDay : target - day0;
      if (cols[day0 + dDay] && node.parentElement !== cols[day0 + dDay]) cols[day0 + dDay].append(node);
      node.style.top = `${top0 + (dMin / 60) * H}px`;
      const s = calShifted(ev.s, dDay, dMin);
      node.querySelector(".cal-block-time").textContent = `${calTime(s)} – ${calTime(new Date(+s + (ev.e - ev.s)))}`;
    };
    const end = (commit = true) => {
      clearTimeout(timer);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("touchmove", noScroll);
      node.classList.remove("cal-held", "cal-dragging");
      if (!live) return;
      cal.dragged = Date.now();
      if (!commit || (!dMin && !dDay)) return calDraw();
      const s = resize ? ev.s : calShifted(ev.s, dDay, dMin);
      const en = resize ? new Date(+ev.e + dMin * 60000) : new Date(+s + (ev.e - ev.s));
      calCommit(ev, s, en);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
    addEventListener("touchmove", noScroll, { passive: false });
  });
}

// A start moved by days (the same clock time, whatever the clocks did) and minutes.
function calShifted(d, days, minutes) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes() + minutes, d.getSeconds());
}

// Dragging a bar (all day) or a month's line to another day.
function calDayDrag(node, ev) {
  if (!ev.href) return;
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !calCanEdit() || e.pointerType === "touch") return;
    const x0 = e.clientX, y0 = e.clientY;
    const inMonth = Boolean(node.closest(".cal-month"));
    const dayAt = (m) => {
      if (inMonth) {
        node.style.pointerEvents = "none";
        const hit = document.elementFromPoint(m.clientX, m.clientY)?.closest(".cal-mday[data-day]");
        node.style.pointerEvents = "";
        return hit ? calFromYmd(hit.dataset.day) : null;
      }
      const head = [...document.querySelectorAll("#calendar .cal-tday")];
      const i = head.findIndex((h) => { const b = h.getBoundingClientRect(); return m.clientX >= b.left && m.clientX < b.right; });
      return i < 0 ? null : calAdd(calRange("week")[0] && calView() === "day" ? cal.day : calRange("week")[0], i);
    };
    const from = dayAt(e);
    if (!from) return;
    let live = false, over = null, ghost = null;
    const move = (m) => {
      if (!live && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
      if (!live) {
        live = true;
        ghost = el("div", { class: "cal-ghost" }, ev.title || "(No title)");
        ghost.style.setProperty("--c", calEventColor(ev));
        document.body.append(ghost);
      }
      ghost.style.left = `${m.clientX + 10}px`;
      ghost.style.top = `${m.clientY + 6}px`;
      const d = dayAt(m);
      over?.classList.remove("cal-drop");
      over = d && (inMonth ? document.querySelector(`#calendar .cal-mday[data-day="${calYmd(d)}"]`) : null);
      over?.classList.add("cal-drop");
      ghost.dataset.day = d ? calYmd(d) : "";
    };
    const up = (m) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      over?.classList.remove("cal-drop");
      ghost?.remove();
      if (!live) return;
      cal.dragged = Date.now();
      const d = dayAt(m);
      const days = d ? calDays(from, d) : 0;
      if (!days) return;
      calCommit(ev, calShifted(ev.s, days, 0), calShifted(ev.e, days, 0));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
}

// A drag let go: moved (asked which, for a repeating one), shown moved
// straight away, then as the server has it.
async function calCommit(ev, s, e) {
  let scope = "all";
  if (ev.rrule) {
    scope = await calScope("Move");
    if (!scope) return calDraw();
  }
  const when = calWhen(ev.allDay, s, e);
  Object.assign(ev, { s, e, start: when.start, end: when.end });
  calDraw();
  await calSend({ action: "update", href: ev.href, original: ev.original, scope, event: when });
}

async function calDelete(ev) {
  calPopClose();
  let scope = "all";
  if (ev.rrule) {
    scope = await calScope("Delete");
    if (!scope) return;
  } else {
    const ok = await confirmDialog({ title: `Delete “${ev.title || "this event"}”?`, body: "It goes from the calendar, on every device.", button: "Delete", destructive: true });
    calFocus();
    if (!ok) return;
  }
  const shown = cal.shown?.events || [];
  cal.shown.events = shown.filter((x) => x !== ev && !(scope !== "this" && x.uid === ev.uid && (scope === "all" || x.s >= ev.s)));
  calDraw();
  await calSend({ action: "delete", href: ev.href, original: ev.original, scope });
}

// A new event: at a time (from a drag, a double click), on a day (all
// day), or at the next hour.
function calNew({ start = null, end = null, allDay = false, day = null, onClose = null } = {}) {
  if (!calCanEdit()) return toast(cal.status?.ok ? "There's no calendar to put it in." : "Connect your calendar first (the note at the top says how).");
  if (allDay) {
    const d = calMidnight(day || cal.selected || cal.day);
    return calEditor(null, { allDay: true, s: d, e: calAdd(d, 1) }, onClose);
  }
  if (!start) {
    const base = cal.selected && !calSameDay(cal.selected, new Date()) ? new Date(cal.selected.getFullYear(), cal.selected.getMonth(), cal.selected.getDate(), 9) : new Date();
    base.setMinutes(0, 0, 0);
    if (calSameDay(base, new Date())) base.setHours(base.getHours() + 1);
    start = base;
    end = new Date(+base + 3600000);
  }
  calEditor(null, { allDay: false, s: start, e: end || new Date(+start + 3600000) }, onClose);
}

function calEdit(ev) {
  calPopClose();
  calEditor(ev, { allDay: ev.allDay, s: ev.s, e: ev.e });
}

// ------------------------------------------------------------- repeats

// RRULE as the editor has it: {freq, interval, byday, bymonthday, bymonth, bysetpos, until (a day), count}.
function calRuleParse(text) {
  const r = { freq: "", interval: 1, byday: [], bymonthday: [], bymonth: [], bysetpos: [], until: null, count: null, other: [] };
  for (const part of String(text || "").split(";")) {
    const [k, v = ""] = part.split("=");
    const key = k.trim().toUpperCase();
    const nums = () => v.split(",").map(Number).filter((n) => Number.isInteger(n) && n);
    if (key === "FREQ") r.freq = v.toLowerCase();
    else if (key === "INTERVAL") r.interval = Math.max(1, Number(v) || 1);
    else if (key === "BYDAY") r.byday = v.toUpperCase().split(",").filter(Boolean);
    else if (key === "BYMONTHDAY") r.bymonthday = nums();
    else if (key === "BYMONTH") r.bymonth = nums();
    else if (key === "BYSETPOS") r.bysetpos = nums();
    else if (key === "COUNT") r.count = Number(v) || null;
    else if (key === "UNTIL") {
      const m = v.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?/);
      if (m) {
        const d = m[4] && m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(+m[1], +m[2] - 1, +m[3]);
        r.until = calYmd(d);
      }
    } else if (key && key !== "WKST") r.other.push(part);
  }
  return r;
}

const CAL_WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const CAL_NTH = [[1, "first"], [2, "second"], [3, "third"], [4, "fourth"], [5, "fifth"], [-1, "last"]];
const calWdName = (code, style = "long") => new Date(2026, 0, 4 + CAL_WD.indexOf(code)).toLocaleDateString([], { weekday: style });
const calMonthName = (m, style = "long") => new Date(2026, m - 1, 1).toLocaleDateString([], { month: style });
const calList = (items) => { try { return new Intl.ListFormat([], { type: "conjunction" }).format(items); } catch { return items.join(", "); } };

// Which of the menu's choices a rule is (or "custom").
function calRulePreset(r, start) {
  if (!r?.freq) return "never";
  const plain = !r.bymonthday.length && !r.bymonth.length && !r.bysetpos.length && !r.other.length;
  const ownDay = !r.byday.length || (r.byday.length === 1 && r.byday[0] === CAL_WD[start.getDay()]);
  if (r.freq === "daily" && r.interval === 1 && plain && !r.byday.length) return "daily";
  if (r.freq === "weekly" && plain && ownDay && r.interval <= 2) return r.interval === 1 ? "weekly" : "biweekly";
  if (r.freq === "monthly" && r.interval === 1 && plain && !r.byday.length) return "monthly";
  if (r.freq === "yearly" && r.interval === 1 && plain && !r.byday.length) return "yearly";
  return "custom";
}

// A rule, said: "Every 2 weeks on Monday and Thursday, 4 times".
function calRuleSentence(r, start) {
  if (!r?.freq) return "Doesn't repeat";
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq] || r.freq;
  let out = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  const nth = (n) => CAL_NTH.find(([k]) => k === n)?.[1] || `${n}th`;
  const days = (list) => list.map((d) => {
    const m = d.match(/^([+-]?\d)?([A-Z]{2})$/);
    return m ? `${m[1] ? `the ${nth(Number(m[1]))} ` : ""}${calWdName(m[2])}` : d;
  });
  if (r.byday.length && r.bysetpos.length) {
    const set = r.byday.join(",");
    const kind = set === "MO,TU,WE,TH,FR" ? "weekday" : set === "SA,SU" ? "weekend day" : set === "MO,TU,WE,TH,FR,SA,SU" ? "day" : calList(days(r.byday));
    out += ` on the ${calList(r.bysetpos.map(nth))} ${kind}`;
  } else if (r.byday.length) out += ` on ${calList(days(r.byday))}`;
  if (r.bymonthday.length) out += ` on the ${calList(r.bymonthday.map((d) => (d === -1 ? "last day" : `${d}.`)))}`;
  if (r.bymonth.length) out += ` in ${calList(r.bymonth.map((m) => calMonthName(m)))}`;
  if (r.count) out += `, ${r.count} time${r.count === 1 ? "" : "s"}`;
  else if (r.until) out += `, until ${calFromYmd(r.until).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
  return out;
}

// ------------------------------------------------------------- the editor

function calEditor(ev, { allDay, s, e }, onClose = null) {
  const calendars = cal.status?.calendars || [];
  const field = (attrs) => el("input", { class: "field-input", ...attrs });
  const title = field({ type: "text", placeholder: "Name", maxlength: "500", value: ev?.title || "" });
  const place = field({ type: "text", placeholder: "Location", maxlength: "500", value: ev?.location || "" });
  const whole = el("input", { type: "checkbox", class: "cal-switch", role: "switch" });
  whole.checked = allDay;
  const lastDay = allDay ? calAdd(e, -1) : e;
  const sDate = field({ type: "date", value: calYmd(s) }), sTime = field({ type: "time", value: `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`, step: "300" });
  const eDate = field({ type: "date", value: calYmd(lastDay) }), eTime = field({ type: "time", value: `${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`, step: "300" });
  const travel = el("select", { class: "field-input" }, ...CAL_TRAVEL.map((m) => el("option", { value: String(m) }, m ? calMinutes(m) : "None")));
  travel.value = String(CAL_TRAVEL.includes(ev?.travel || 0) ? ev?.travel || 0 : 0);
  if (ev?.travel && !CAL_TRAVEL.includes(ev.travel)) { travel.append(el("option", { value: String(ev.travel) }, calMinutes(ev.travel))); travel.value = String(ev.travel); }
  const rule0 = ev?.rrule ? calRuleParse(ev.rrule) : null;
  const repeat = el("select", { class: "field-input" },
    ...[["never", "Never"], ["daily", "Every day"], ["weekly", "Every week"], ["biweekly", "Every 2 weeks"], ["monthly", "Every month"], ["yearly", "Every year"], ["custom", "Custom…"]]
      .map(([v, l]) => el("option", { value: v }, l)));
  repeat.value = calRulePreset(rule0, s);
  const which = el("select", { class: "field-input", "aria-label": "Calendar" }, ...calendars.map((c) => el("option", { value: c.id }, c.name)));
  which.value = ev?.calendar || cal.prefs.lastCalendar && calendars.some((c) => c.id === cal.prefs.lastCalendar) && cal.prefs.lastCalendar || calendars[0]?.id || "";
  const notes = el("textarea", { class: "field-input cal-notes", placeholder: "Notes", rows: "3", maxlength: "20000" }, ev?.description || "");
  const error = el("p", { class: "error", role: "alert" });

  // Custom: how often, and on which days, days of the month, months.
  const rule = rule0 ? { ...rule0 } : { freq: "weekly", interval: 1, byday: [], bymonthday: [], bymonth: [], bysetpos: [], until: null, count: null, other: [] };
  if (!rule.freq) rule.freq = "weekly";
  let touched = false;
  const custom = el("div", { class: "cal-ed-custom" });
  const ends = el("select", { class: "field-input" }, el("option", { value: "never" }, "Never"), el("option", { value: "until" }, "On a day"), el("option", { value: "count" }, "After"));
  ends.value = rule.count ? "count" : rule.until ? "until" : "never";
  const until = field({ type: "date", value: rule.until || calYmd(calAdd(s, 90)) });
  const count = field({ type: "number", min: "1", max: "9999", value: String(rule.count || 10), class: "field-input cal-count" });
  const endsRow = el("div", { class: "cal-ed-row" }, el("span", { class: "cal-ed-label" }, "End repeat"),
    el("div", { class: "cal-ed-fields" }, ends, until, el("span", { class: "cal-ed-count" }, count, el("span", {}, "times"))));
  const sentence = el("p", { class: "cal-ed-sentence" });
  // A frequency's first pick: the event's own weekday, day of the month, month.
  const seed = () => {
    const d = calFromYmd(sDate.value || calYmd(s));
    if (rule.freq === "weekly" && !rule.byday.length) rule.byday = [CAL_WD[d.getDay()]];
    if (rule.freq === "monthly" && !rule.byday.length && !rule.bymonthday.length) rule.bymonthday = [d.getDate()];
    if (rule.freq === "yearly" && !rule.bymonth.length) rule.bymonth = [d.getMonth() + 1];
  };
  const drawCustom = () => {
    const startDay = calFromYmd(sDate.value || calYmd(s));
    const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.freq];
    const freq = el("div", { class: "cal-seg" }, ...["daily", "weekly", "monthly", "yearly"].map((f) => {
      const b = el("button", { type: "button", class: `cal-seg-b${rule.freq === f ? " on" : ""}` }, { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[f]);
      b.addEventListener("click", () => { rule.freq = f; rule.byday = []; rule.bymonthday = []; rule.bymonth = []; rule.bysetpos = []; touched = true; seed(); drawCustom(); });
      return b;
    }));
    const every = field({ type: "number", min: "1", max: "999", value: String(rule.interval), class: "field-input cal-every" });
    every.addEventListener("input", () => { rule.interval = Math.max(1, Math.min(999, Number(every.value) || 1)); touched = true; sentence.textContent = calRuleSentence(rule, startDay); });
    const parts = [freq, el("div", { class: "cal-ed-every" }, el("span", {}, "Every"), every, el("span", {}, `${unit}${rule.interval === 1 ? "" : "s"}`))];
    const toggle = (list, value, label, title) => {
      const b = el("button", { type: "button", class: `cal-pick${list.includes(value) ? " on" : ""}`, title: title || label, "aria-pressed": String(list.includes(value)) }, label);
      b.addEventListener("click", () => {
        const i = list.indexOf(value);
        if (i >= 0) list.splice(i, 1); else list.push(value);
        const rank = (v) => (typeof v === "string" ? (CAL_WD.indexOf(v) - CAL_FIRST + 7) % 7 : v < 0 ? 99 : v);
        list.sort((a, b) => rank(a) - rank(b));
        touched = true;
        drawCustom();
      });
      return b;
    };
    const order = Array.from({ length: 7 }, (_, i) => CAL_WD[(CAL_FIRST + i) % 7]);
    if (rule.freq === "weekly") {
      parts.push(el("div", { class: "cal-picks cal-picks-7" }, ...order.map((d) => toggle(rule.byday, d, calWdName(d, "short"), calWdName(d)))));
    }
    if (rule.freq === "monthly" || rule.freq === "yearly") {
      if (rule.freq === "yearly") {
        parts.push(el("div", { class: "cal-picks cal-picks-12" }, ...Array.from({ length: 12 }, (_, i) => toggle(rule.bymonth, i + 1, calMonthName(i + 1, "short"), calMonthName(i + 1)))));
      }
      // Each (these days of the month) or On the (the second Tuesday, the last weekday).
      const onThe = rule.byday.length > 0;
      const mode = el("div", { class: "cal-seg cal-seg-small" }, ...[["each", rule.freq === "yearly" ? "On its day" : "Each"], ["onthe", "On the"]].map(([m, label]) => {
        const b = el("button", { type: "button", class: `cal-seg-b${(m === "onthe") === onThe ? " on" : ""}` }, label);
        b.addEventListener("click", () => {
          touched = true;
          if (m === "onthe" && !onThe) { const n = Math.min(4, Math.ceil(startDay.getDate() / 7)); rule.byday = [`${n}${CAL_WD[startDay.getDay()]}`]; rule.bymonthday = []; rule.bysetpos = []; }
          if (m === "each" && onThe) { rule.byday = []; rule.bysetpos = []; }
          drawCustom();
        });
        return b;
      }));
      parts.push(mode);
      if (onThe) {
        // [first…last] [Monday…Sunday, day, weekday, weekend day]
        const set = rule.byday.join(",");
        const kinds = [...order.map((d) => [d, calWdName(d)]), ["MO,TU,WE,TH,FR,SA,SU", "day"], ["MO,TU,WE,TH,FR", "weekday"], ["SA,SU", "weekend day"]];
        let n = rule.bysetpos[0] || Number((rule.byday[0] || "1").match(/^[+-]?\d/)?.[0] || 1);
        let kind = rule.bysetpos.length ? set : (rule.byday[0] || "").replace(/^[+-]?\d/, "");
        const nth = el("select", { class: "field-input" }, ...CAL_NTH.map(([k, l]) => el("option", { value: String(k) }, l)));
        nth.value = String(n);
        const what = el("select", { class: "field-input" }, ...kinds.map(([v, l]) => el("option", { value: v }, l)));
        what.value = kinds.some(([v]) => v === kind) ? kind : order[0];
        const apply = () => {
          n = Number(nth.value); kind = what.value; touched = true;
          if (kind.includes(",")) { rule.byday = kind.split(","); rule.bysetpos = [n]; } else { rule.byday = [`${n}${kind}`]; rule.bysetpos = []; }
          rule.bymonthday = [];
          sentence.textContent = calRuleSentence(rule, startDay);
        };
        nth.addEventListener("change", apply);
        what.addEventListener("change", apply);
        parts.push(el("div", { class: "cal-ed-fields" }, nth, what));
      } else if (rule.freq === "monthly") {
        parts.push(el("div", { class: "cal-picks cal-picks-31" }, ...Array.from({ length: 31 }, (_, i) => toggle(rule.bymonthday, i + 1, String(i + 1))),
          toggle(rule.bymonthday, -1, "Last", "The last day of the month")));
      }
    }
    sentence.textContent = calRuleSentence(rule, startDay);
    custom.replaceChildren(...parts, sentence);
  };
  const drawRepeat = () => {
    const v = repeat.value;
    custom.hidden = v !== "custom";
    endsRow.hidden = v === "never";
    until.hidden = ends.value !== "until";
    count.parentElement.hidden = ends.value !== "count";
    if (v === "custom") drawCustom();
  };
  repeat.addEventListener("change", () => { touched = true; if (repeat.value === "custom") seed(); drawRepeat(); });
  ends.addEventListener("change", () => { touched = true; drawRepeat(); });
  until.addEventListener("input", () => { touched = true; });
  count.addEventListener("input", () => { touched = true; });
  // Times: the end keeps its distance when the start moves; all day hides the clocks.
  const read = () => {
    const [sy, sm, sd] = sDate.value.split("-").map(Number);
    const [ey, em, ed] = eDate.value.split("-").map(Number);
    if (!sy || !ey) return null;
    if (whole.checked) return { s: new Date(sy, sm - 1, sd), e: new Date(ey, em - 1, ed + 1) };
    const [sh, smin] = (sTime.value || "00:00").split(":").map(Number);
    const [eh, emin] = (eTime.value || "00:00").split(":").map(Number);
    return { s: new Date(sy, sm - 1, sd, sh, smin), e: new Date(ey, em - 1, ed, eh, emin) };
  };
  let span = read() ? read().e - read().s : 3600000;
  const keep = () => {
    const t = read();
    if (!t) return;
    const ne = new Date(+t.s + span - (whole.checked ? 86400000 : 0));
    eDate.value = calYmd(ne);
    if (!whole.checked) eTime.value = `${String(ne.getHours()).padStart(2, "0")}:${String(ne.getMinutes()).padStart(2, "0")}`;
    if (!custom.hidden) drawCustom();
  };
  sDate.addEventListener("change", keep);
  sTime.addEventListener("change", keep);
  const remember = () => { const t = read(); if (t && t.e > t.s) span = t.e - t.s; };
  eDate.addEventListener("change", remember);
  eTime.addEventListener("change", remember);
  const drawWhole = () => { sTime.hidden = eTime.hidden = whole.checked; travel.closest(".cal-ed-row").hidden = whole.checked; };
  whole.addEventListener("change", () => { drawWhole(); span = whole.checked ? 86400000 : 3600000; keep(); });

  const row = (label, ...fields) => el("div", { class: "cal-ed-row" }, el("span", { class: "cal-ed-label" }, label), el("div", { class: "cal-ed-fields" }, ...fields));
  const dot = el("span", { class: "cal-dot" });
  const tint = () => dot.style.setProperty("--c", calColor(calCalendar(which.value)?.color) || "#4c9aff");
  which.addEventListener("change", tint);
  tint();
  const save = el("button", { type: "button", class: "button-primary wide" }, ev ? "Save" : "Add");
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  const del = ev ? el("button", { type: "button", class: "button-destructive cal-ed-delete" }, "Delete") : null;
  cancel.addEventListener("click", closeModal);
  del?.addEventListener("click", () => { closeModal(); calDelete(ev); });
  const dialog = el("div", { class: "dialog material cal-editor", role: "dialog", "aria-modal": "true" },
    el("h2", {}, ev ? "Edit event" : "New event"),
    title, place,
    el("label", { class: "cal-ed-row cal-ed-switch" }, el("span", { class: "cal-ed-label" }, "All day"), whole),
    row("Starts", sDate, sTime), row("Ends", eDate, eTime),
    row("Travel time", travel),
    row("Repeat", repeat), custom, endsRow,
    row("Calendar", dot, which),
    notes, error,
    el("div", { class: "dialog-actions" }, ...(del ? [del] : []), cancel, save));
  drawWhole();
  drawRepeat();

  const go = async () => {
    error.textContent = "";
    const t = read();
    if (!t) return (error.textContent = "When it starts and ends.");
    if (!(t.e > t.s)) return (error.textContent = "It ends before it starts.");
    const fields = { title: title.value.trim(), location: place.value.trim(), notes: notes.value, travel: whole.checked ? 0 : Number(travel.value), calendar: which.value, ...calWhen(whole.checked, t.s, t.e) };
    if (touched || !ev) {
      const v = repeat.value;
      let r = null;
      if (v === "custom") r = { ...rule };
      else if (v !== "never") r = { freq: { daily: "daily", weekly: "weekly", biweekly: "weekly", monthly: "monthly", yearly: "yearly" }[v], interval: v === "biweekly" ? 2 : 1 };
      if (r) {
        if (ends.value === "until") r.until = until.value || null; else delete r.until;
        if (ends.value === "count") r.count = Math.max(1, Number(count.value) || 1); else delete r.count;
        for (const k of ["byday", "bymonthday", "bymonth", "bysetpos"]) if (!r[k]?.length) delete r[k];
        delete r.other;
      }
      if (!ev || touched) fields.repeat = r;
    }
    let scope = "all";
    if (ev?.rrule) {
      // A change to the repeat itself: for this and the ones after, or all of them.
      scope = await calScope("Change", { only: "repeat" in fields || fields.calendar !== ev.calendar ? ["future", "all"] : null });
      if (!scope) return;
      if (scope !== "all") delete fields.calendar;
      if (scope === "this") delete fields.repeat;
    }
    save.disabled = true;
    cal.prefs.lastCalendar = which.value;
    calSave();
    const got = ev ? await calSend({ action: "update", href: ev.href, original: ev.original, scope, event: fields })
      : await calSend({ action: "create", event: fields });
    save.disabled = false;
    if (!got) return;
    closeModal();
    if (!ev) {
      // Where it is, if it isn't on screen.
      const [a, b] = calRange();
      if (t.s < a || t.s >= calAdd(b, 1)) calGo(calMidnight(t.s));
    }
  };
  save.addEventListener("click", go);
  title.addEventListener("keydown", (k) => { if (k.key === "Enter") go(); });
  openModal(dialog, { onClose: () => { onClose?.(); calFocus(); } });
  title.focus();
}
