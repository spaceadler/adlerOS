// Calendar: your calendars as your CalDAV server has them (Radicale, in a
// homelab): a day, a week or a month, each event in its calendar's color, a
// line at now. Only read: events are made and changed where they always are
// (your phone's calendar, Fantastical, Super Productivity). adlerOS's server
// asks the CalDAV server (CALDAV_USER, CALDAV_PASSWORD) and works out every
// repeat; the page never sees the password, and asks for days in its own
// time zone. Before it's connected: the calendar, empty, with how to connect
// above it. Uses el, svg, $, api, showLock, registerWindow, openWindow,
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
  const section = el("section", { id: "calendar", class: "sheet calendar-app", "aria-label": "Calendar", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "cal-shell" },
      el("aside", { class: "cal-side", id: "cal-side" }),
      el("div", { class: "cal-body" },
        el("header", { class: "cal-head" },
          el("div", { class: "cal-nav" }, button("Back (←)", CAL_ICONS.prev, () => calStep(-1)), today, button("Next (→)", CAL_ICONS.next, () => calStep(1))),
          el("h1", { class: "cal-title", id: "cal-title" }),
          el("div", { class: "cal-head-tools" }, lists, views)),
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
      const cell = el("button", { type: "button", class: "cal-mday", "aria-label": calLong(d) },
        el("span", { class: "cal-mnum" }, String(d.getDate())));
      cell.classList.toggle("out", d.getMonth() !== month);
      cell.classList.toggle("cal-is-today", calSameDay(d, today));
      cell.classList.toggle("on", compact && cal.selected && calSameDay(d, cal.selected));
      cell.addEventListener("click", () => {
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
  node.addEventListener("click", (e) => { e.stopPropagation(); calShowEvent(ev, node); });
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
      node.addEventListener("click", (e) => { e.stopPropagation(); calShowEvent(sg.ev, node); });
      col.append(node);
    }
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
  if (ev.repeats) rows.push(el("div", { class: "cal-pop-row cal-dim" }, svg(CAL_ICONS.repeat), el("span", {}, "Repeats")));
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
  calPopOpen(anchor, content, "cal-pop-event");
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

function calPopClose() { calKeepFocus(() => $("cal-pop")?.remove()); }
