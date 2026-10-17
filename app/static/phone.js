// The iPhone-style layout, for a phone held upright (screens under 640px
// wide; ios.css has the looks, app.js the grid and dock that follow it).
// Here, the touch parts: windows you swipe down to close, swiping past the
// last page into the App Library and down for search, page dots in place of
// the Search pill while you swipe, a long press's blurred backdrop, and the
// date over the greeting and the clock on the lock screen.
// Uses $, state, phoneLayout, desktopMode, buildDock, layout, wm,
// openDrawer, drawerOpen, openSearch, topLayer.
"use strict";

const PHONE_QUERY = matchMedia("(max-width: 639px)");
const phone = { swipe: null, home: null, paging: null };

// (Desktop mode never is on a phone-sized screen: windows.js.)
function applyPhone() {
  const on = PHONE_QUERY.matches;
  if (on === phoneLayout()) return;
  document.body.classList.toggle("phone", on);
  dockKey = null;
  if (!$("desktop").hidden) {
    buildDock();
    layout(true);
  }
}

function tickPhoneClock() {
  const now = new Date();
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  $("today").textContent = date;
  $("lock-time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("lock-date").textContent = date;
}

// ------------------------------------------- windows: swipe down to close

function scrollParent(node, stop) {
  for (let n = node; n && n !== stop; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
}

function sheetTouchStart(e) {
  const sheet = e.currentTarget;
  if (!phoneLayout() || e.touches.length !== 1 || !isOpen(sheet.id)) return;
  const t = e.touches[0];
  // From its top edge, always; from anywhere else when what's under the
  // finger is scrolled to the top (the terminal: its top edge only).
  const grab = t.clientY - sheet.getBoundingClientRect().top < 56;
  const scroller = scrollParent(e.target, sheet);
  if (!grab && (sheet.id === "terminal" || e.target.closest("textarea, input, select") || (scroller && scroller.scrollTop > 0))) return;
  phone.swipe = { sheet, x: t.clientX, y: t.clientY, dy: 0, at: Date.now(), active: false };
}

function sheetTouchMove(e) {
  const s = phone.swipe;
  if (!s || e.currentTarget !== s.sheet) return;
  const t = e.touches[0];
  const dx = t.clientX - s.x;
  const dy = t.clientY - s.y;
  if (!s.active) {
    if (Math.abs(dy) < 8) return;
    if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
      phone.swipe = null; // scrolling, or sideways: not ours
      return;
    }
    s.active = true;
    s.sheet.classList.add("swiping");
  }
  e.preventDefault();
  s.dy = Math.max(0, dy);
  s.sheet.style.transform = `translate(-50%, ${s.dy}px)`;
}

function sheetTouchEnd() {
  const s = phone.swipe;
  phone.swipe = null;
  if (!s?.active) return;
  s.sheet.classList.remove("swiping");
  const fast = s.dy / Math.max(1, Date.now() - s.at) > 0.5;
  if (s.dy > 140 || (fast && s.dy > 50)) {
    // It slides on down from where your finger left it.
    const w = wm.windows.get(s.sheet.id);
    (w?.hide || w?.close)?.();
    setTimeout(() => {
      if (!s.sheet.hidden) settleSheet(s.sheet); // it asked first (unsaved changes), and stayed
      else s.sheet.style.transform = "";
    }, 340);
    return;
  }
  settleSheet(s.sheet);
}

function settleSheet(sheet) {
  sheet.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)";
  sheet.style.transform = "";
  setTimeout(() => { sheet.style.transition = ""; }, 260);
}

// ----------------------------- the home screen: App Library and search

function homeTouchStart(e) {
  if (!phoneLayout() || e.touches.length !== 1 || topLayer() || e.target.closest("#dock, .widget-panel, input")) return;
  const t = e.touches[0];
  phone.home = { x: t.clientX, y: t.clientY, done: false };
}

function homeTouchMove(e) {
  const h = phone.home;
  if (!h || h.done) return;
  const t = e.touches[0];
  const dx = t.clientX - h.x;
  const dy = t.clientY - h.y;
  const pages = $("pages");
  const last = pages.scrollLeft + pages.clientWidth >= pages.scrollWidth - 2;
  if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.5 && last) {
    h.done = true;
    openDrawer(); // past the last page: the App Library
  } else if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.5 && !document.body.classList.contains("arranging")) {
    h.done = true;
    openSearch(); // pulled down: search
  }
}

// ---------------------------------------------------------------- wiring

applyPhone();
PHONE_QUERY.addEventListener("change", applyPhone);
tickPhoneClock();
setInterval(tickPhoneClock, 15000);

for (const id of wm.windows.keys()) {
  const sheet = $(id);
  sheet.addEventListener("touchstart", sheetTouchStart, { passive: true });
  sheet.addEventListener("touchmove", sheetTouchMove, { passive: false });
  sheet.addEventListener("touchend", sheetTouchEnd);
  sheet.addEventListener("touchcancel", sheetTouchEnd);
}
$("desktop").addEventListener("touchstart", homeTouchStart, { passive: true });
$("desktop").addEventListener("touchmove", homeTouchMove, { passive: true });
$("desktop").addEventListener("touchend", () => { phone.home = null; });

// While you swipe between pages, their dots take the Search pill's place.
$("pages").addEventListener("scroll", () => {
  if (!phoneLayout()) return;
  document.body.classList.add("paging");
  clearTimeout(phone.paging);
  phone.paging = setTimeout(() => document.body.classList.remove("paging"), 900);
}, { passive: true });

// A long press's menu: the rest of the screen blurs behind it.
new MutationObserver(() => {
  $("menu-veil").hidden = !phoneLayout() || $("menu").hidden;
}).observe($("menu"), { attributes: true, attributeFilter: ["hidden"] });
