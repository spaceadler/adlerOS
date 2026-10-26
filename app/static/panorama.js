// Desktop mode's third layout, Panorama: floating windows on one strip that
// goes on to the right for as long as you need (it starts at the left, as
// a page does: there's nothing left of where you begin). The screen is a
// view onto part of it. Alt+A and Alt+D, held, glide left and right (a tap
// moves a little; how fast is Settings → Panorama speed), Alt+S jumps to
// the nearer end of your windows (the left edge of the leftmost, the right
// edge of the rightmost), and again to the other end; Alt+1…0 go to that
// screen's width along. A trackpad's sideways swipe, or Shift and the
// wheel, over the desktop (Alt and the wheel anywhere) slide it too.
// While it moves, a map in the corner shows the whole strip: each window a
// box with its app's icon, and where you are in white (click it to go
// there).
// Windows snap as they float (the screen's left or right half, or all of
// it), but here a snapped window is a column, and columns sit side by
// side, Settings → Panorama gap apart: snapped where one already is, it
// goes next to it, and into a space narrower than it would be, it takes
// that space. Dragged up to a column's side, a window goes next to it on
// that side (a white line shows where), filling the room up to the
// screen's edge (or, Settings → Panorama snap, a whole screen wide). The
// edge two columns share moves both: one wider, the other narrower.
// Alt+Shift+D widens the window in front to the right, up to the screen's
// edge (or the next column); again, its left side comes in. Alt+Shift+A the
// other way.
// Geometry is in the strip's px (wm.geometry: x for a floating window; cx
// and cw for a column); winApply draws it pano.x to the left.
// Uses $, el, wm, desktopMode, winLoad, winSave, winArea, winApply,
// winRemember, isOpen, raiseWindow, tiles, TILING_KEY, WS_COUNT, plateFor,
// WIN_MIN, winLayout.
"use strict";

const PANO_X_KEY = "adleros.panoX";
const PANO_SPEED_KEY = "adleros.panoSpeed";
const PANO_SPEED_DEFAULT = 1; // screens a second, held
const PANO_GAP_KEY = "adleros.panoGap";
const PANO_EDGE_NEAR = 24; // px from a column's side: a window dropped there goes next to it
const PANO_MAP_H = 54;
const PANO_MAP_MAX_W = 340;
const PANO_GLIDE_MS = 380;
const pano = { x: Math.max(0, Number(winLoad(PANO_X_KEY, 0)) || 0), dir: 0, keys: new Set(), v: 0, last: 0, raf: 0,
  glide: 0, jump: null, carry: null, mapTimer: null, saveTimer: null, mapOver: false };

function panoramaOn() { return desktopMode() && winLoad(TILING_KEY, false) === "panorama"; }
function panoSpeed() { return Number(winLoad(PANO_SPEED_KEY, PANO_SPEED_DEFAULT)) || PANO_SPEED_DEFAULT; }
function setPanoSpeed(v) { winSave(PANO_SPEED_KEY, v); }
// Snapped beside a column: to the screen's edge ("screen"), or a screen wide ("full").
const PANO_FILL_KEY = "adleros.panoFill";
function panoFill() { return winLoad(PANO_FILL_KEY, "screen") === "full" ? "full" : "screen"; }
function setPanoFill(v) { winSave(PANO_FILL_KEY, v); }
function panoGap() { return Math.max(0, Number(winLoad(PANO_GAP_KEY, 0)) || 0); }
function setPanoGap(v) { winSave(PANO_GAP_KEY, v); }

// The open windows showing (not minimized), with their place on the strip.
function panoSpans(except = null) {
  const out = [];
  for (const id of wm.windows.keys()) {
    if (id === except || !isOpen(id) || $(id).classList.contains("minimized")) continue;
    const g = wm.geometry[id];
    if (!g) continue;
    const col = g.mode === "col";
    out.push({ id, col, x: col ? g.cx : g.x, w: col ? g.cw : g.w, y: col ? 0 : g.y, h: col ? null : g.h });
  }
  return out;
}

// ------------------------------------------------------------ drawing

// Where a window is drawn (winApply): its place on the strip, less pano.x.
function panoBox(g, area) {
  if (g.mode === "left" || g.mode === "right" || g.mode === "max") panoColumnOf(g, g.mode, pano.x, area);
  if (g.mode === "col") return { x: g.cx - pano.x, y: 0, w: g.cw, h: area.h };
  // Never lost: some of it on the strip, its bar on the screen's height.
  g.w = Math.max(WIN_MIN[0], Math.min(g.w, area.w));
  g.h = Math.max(WIN_MIN[1], Math.min(g.h, area.h));
  g.x = Math.max(g.x, 80 - g.w);
  g.y = Math.min(Math.max(g.y, 0), area.h - 40);
  return { x: g.x - pano.x, y: g.y, w: g.w, h: g.h };
}

// A half (or all) of a screen whose left is at `left`, as a column.
function panoColumnOf(g, side, left, area) {
  const half = Math.round(area.w / 2);
  const gap = side === "max" ? 0 : Math.round(panoGap() / 2); // a half's share of the gap
  Object.assign(g, { mode: "col", side, edged: 0, cx: side === "right" ? left + half + gap : left,
    cw: side === "max" ? area.w : side === "left" ? half - gap : area.w - half - gap });
}

// A window opening: where you're looking, unless some of it is already.
function panoIntoView(g, area) {
  const x = g.mode === "col" ? g.cx : g.x;
  const w = g.mode === "col" ? g.cw : g.w;
  if (x + w > pano.x + 40 && x < pano.x + area.w - 40) return;
  if (g.mode === "col") g.mode = "normal";
  g.x = pano.x + Math.max(0, Math.round((area.w - g.w) / 2));
}

// --------------------------------------------------------------- moving

function panoSet(x) {
  x = Math.max(0, x);
  const dx = x - pano.x;
  if (!dx) return;
  pano.x = x;
  // What you're holding comes along: a window you're dragging, or carrying (Alt+Shift+1…0).
  const d = wm.drag;
  if (d && d.moved && d.kind === "move" && wm.geometry[d.id]?.mode === "normal") {
    d.box.x += dx;
    wm.geometry[d.id].x += dx;
  }
  const c = pano.carry && wm.geometry[pano.carry];
  if (c) { if (c.mode === "col") c.cx += dx; else c.x += dx; }
  for (const id of wm.windows.keys()) if (isOpen(id)) winApply(id);
  panoMap(true);
  clearTimeout(pano.saveTimer);
  pano.saveTimer = setTimeout(() => { winSave(PANO_X_KEY, Math.round(pano.x)); if (c) winRemember(); }, 300);
}

function panoGlideStop() {
  if (pano.glide) cancelAnimationFrame(pano.glide);
  pano.glide = 0;
  pano.carry = null;
}

// To x, easing out (a jump, the map, a window you asked for).
function panoGlide(to, carry = null) {
  panoGlideStop();
  to = Math.max(0, Math.round(to));
  const from = pano.x;
  if (Math.abs(to - from) < 1) return panoMap(true);
  pano.carry = carry;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / PANO_GLIDE_MS);
    panoSet(from + (to - from) * (1 - (1 - t) ** 3));
    if (t < 1) pano.glide = requestAnimationFrame(step);
    else {
      pano.glide = 0;
      if (pano.carry) winRemember();
      pano.carry = null;
    }
  };
  pano.glide = requestAnimationFrame(step);
}

// Alt+A / Alt+D held: under way at once (a tap goes a little), up to full
// speed in a moment, and slowing to a stop when you let go.
function panoTick(now) {
  const dt = Math.min(0.1, (now - pano.last) / 1000); // a slow frame still goes its share
  pano.last = now;
  const want = pano.dir * panoSpeed() * winArea().w;
  pano.v += (want - pano.v) * Math.min(1, dt * (pano.dir ? 6 : 12));
  if ((!pano.dir && Math.abs(pano.v) < 8) || (pano.x <= 0 && pano.v < 0 && pano.dir <= 0)) {
    pano.v = 0;
    pano.raf = 0;
    return;
  }
  panoSet(pano.x + pano.v * dt);
  pano.raf = requestAnimationFrame(panoTick);
}

function panoHold(dir, down) {
  if (down) pano.keys.add(dir);
  else pano.keys.delete(dir);
  pano.dir = pano.keys.has(1) === pano.keys.has(-1) ? 0 : pano.keys.has(1) ? 1 : -1;
  if (!pano.dir && !pano.raf) return;
  if (down) {
    panoGlideStop();
    pano.jump = null; // Alt+S starts from the nearer end again
    if (Math.sign(pano.v) !== dir) pano.v = dir * panoSpeed() * winArea().w * 0.35;
  }
  if (!pano.raf) {
    pano.last = performance.now();
    pano.raf = requestAnimationFrame(panoTick);
  }
}

// Alt+S: the nearer end of your windows; again (no Alt+A or D between),
// the other. Already at the nearer one: the other.
function panoJump() {
  const spans = panoSpans();
  if (!spans.length) return panoGlide(0);
  const W = winArea().w;
  const ends = { l: Math.max(0, Math.min(...spans.map((s) => s.x))), r: Math.max(0, Math.max(...spans.map((s) => s.x + s.w)) - W) };
  let to = pano.jump ? (pano.jump === "l" ? "r" : "l") : Math.abs(pano.x - ends.l) <= Math.abs(pano.x - ends.r) ? "l" : "r";
  if (!pano.jump && Math.abs(pano.x - ends[to]) < 2) to = to === "l" ? "r" : "l";
  pano.jump = to;
  panoGlide(ends[to]);
}

// Alt+1…0: that screen's width along; with Shift, the window in front too.
function panoScreen(n, carry = false) {
  pano.jump = null;
  const id = carry ? wm.active : null;
  panoGlide((n - 1) * winArea().w, id && isOpen(id) ? id : null);
}

// A window you asked for (the dock, Alt+H/L, Ctrl+`): all of it in view.
function panoReveal(id) {
  const g = wm.geometry[id];
  if (!g) return;
  const W = winArea().w;
  const x = g.mode === "col" ? g.cx : g.x;
  const w = g.mode === "col" ? g.cw : g.w;
  if (x >= pano.x && x + w <= pano.x + W) return;
  panoGlide(w >= W || x < pano.x ? x : x + w - W);
}

// ------------------------------------------------------------- columns

const panoCols = (except) => panoSpans(except).filter((s) => s.col);

// The strip's free runs, between columns and the gap either side of each
// (none at the strip's start): [{ a, b }], the last one endless.
function panoFree(cols) {
  const gap = panoGap();
  const out = [];
  let at = 0;
  for (const c of [...cols].sort((p, q) => p.x - q.x)) {
    const end = c.x - gap;
    if (end > at) out.push({ a: at, b: end });
    at = Math.max(at, c.x + c.w + gap);
  }
  out.push({ a: at, b: Infinity });
  return out;
}

// Where a window snapped to a side (left, right, max) of the screen goes:
// that part of what you see, or past the columns there to the first room
// it fits (to the right for left and all; to the left for right, unless
// there's none that way), taking only what room there is between two.
function panoTarget(id, side) {
  const W = winArea().w;
  const half = Math.round(W / 2);
  const want = side === "max" ? W : side === "left" ? half : W - half;
  const min = WIN_MIN[0];
  const free = panoFree(panoCols(id));
  const rightward = (from) => {
    for (const f of free) {
      const a = Math.max(from, f.a);
      if (f.b - a >= min) return { cx: a, cw: Math.min(want, f.b - a) };
    }
    return null;
  };
  if (side === "right") {
    const end = pano.x + W;
    for (const f of [...free].reverse()) {
      const b = Math.min(end, f.b);
      if (b - f.a >= min) return { cx: Math.max(f.a, b - want), cw: Math.min(want, b - f.a) };
    }
    return rightward(pano.x + half);
  }
  return rightward(pano.x);
}

// Dragged near a column's side (at x on the screen): next to it, that side,
// filling the room there up to the screen's edge (Panorama snap "full": a
// screen wide, room allowing). With the line to show it.
function panoEdgeTarget(id, clientX) {
  const W = winArea().w;
  const x = clientX + pano.x;
  const min = WIN_MIN[0];
  const gap = panoGap();
  const cols = panoCols(id).filter((c) => c.x + c.w > pano.x && c.x < pano.x + W);
  const free = panoFree(panoCols(id));
  let best = null;
  for (const c of cols) {
    for (const after of [true, false]) {
      const edge = after ? c.x + c.w : c.x;
      const far = Math.abs(x - edge);
      if (far > PANO_EDGE_NEAR || (best && best.far <= far)) continue;
      const room = free.find((f) => (after ? Math.abs(f.a - (edge + gap)) <= 1 : Math.abs(f.b - (edge - gap)) <= 1));
      if (!room || room.b - room.a < min) continue;
      // To the screen's edge; too little there for a window, half a screen.
      const toEdge = after ? Math.min(room.b, pano.x + W) - room.a : room.b - Math.max(room.a, pano.x);
      const want = panoFill() === "full" ? W : toEdge >= min ? toEdge : W / 2;
      const cw = Math.round(Math.min(want, room.b - room.a));
      best = { far, cx: after ? room.a : room.b - cw, cw, side: after ? "left" : "right", line: after ? edge + gap / 2 : edge - gap / 2 };
    }
  }
  return best;
}

function panoEdgeHint(t) {
  let line = $("pano-edge");
  if (!t) {
    if (line) line.hidden = true;
    return;
  }
  if (!line) {
    line = el("div", { id: "pano-edge", class: "pano-edge", "aria-hidden": "true" });
    document.body.append(line);
  }
  Object.assign(line.style, { left: `${Math.round(t.line - pano.x)}px`, height: `${winArea().h}px` });
  line.hidden = false;
}

function panoEdgeSnap(id, t) {
  Object.assign(wm.geometry[id], { mode: "col", side: t.side, edged: 0, cx: t.cx, cw: t.cw });
  winApply(id);
  winRemember();
  panoReveal(id);
  panoMap(true);
}

// Alt+Shift+D / A: the window in front wider that way, to the screen's edge
// (or the next column, if that's nearer); then its other side comes in. A
// floating one moves.
function panoNudge(dir) {
  const id = wm.active;
  const g = id && wm.geometry[id];
  if (!g || !isOpen(id)) return;
  const W = winArea().w;
  const step = Math.round(W / 10);
  if (g.mode !== "col") {
    g.x += dir * step;
    winApply(id);
    winRemember();
    return panoReveal(id);
  }
  const gap = panoGap();
  const min = WIN_MIN[0];
  const cols = panoCols(id);
  if (g.edged === -dir) g.edged = 0; // back the other way: that side grows again
  if (dir > 0) {
    const next = cols.filter((c) => c.x >= g.cx + g.cw - 1).sort((p, q) => p.x - q.x)[0];
    const grow = g.edged === 1 ? 0 : Math.min(step, Math.min(pano.x + W, next ? next.x - gap : Infinity) - (g.cx + g.cw));
    if (grow > 0) g.cw += grow;
    else {
      g.edged = 1;
      const shrink = Math.min(step, g.cw - min);
      if (shrink <= 0) return;
      g.cx += shrink;
      g.cw -= shrink;
    }
  } else {
    const prev = cols.filter((c) => c.x + c.w <= g.cx + 1).sort((p, q) => q.x + q.w - (p.x + p.w))[0];
    const grow = g.edged === -1 ? 0 : Math.min(step, g.cx - Math.max(pano.x, prev ? prev.x + prev.w + gap : 0));
    if (grow > 0) {
      g.cx -= grow;
      g.cw += grow;
    } else {
      g.edged = -1;
      const shrink = Math.min(step, g.cw - min);
      if (shrink <= 0) return;
      g.cw -= shrink;
    }
  }
  winApply(id);
  winRemember();
  panoReveal(id);
  panoMap(true);
}

function panoSnap(id, side) {
  const g = wm.geometry[id];
  if (!g) return;
  if (g.mode === "col" && g.side === side) g.mode = "normal"; // again: its own size
  else {
    const t = panoTarget(id, side);
    if (!t) return;
    Object.assign(g, { mode: "col", side, edged: 0 }, t);
  }
  winApply(id);
  winRemember();
  panoReveal(id);
  panoMap(true);
}

// Dragging a column's side: the column it shares that edge with gives (or
// takes) the room.
function panoColStart(d) {
  const g = wm.geometry[d.id];
  if (!g || g.mode !== "col") return;
  const cols = panoSpans(d.id).filter((s) => s.col);
  const near = panoGap() + 2; // its neighbour, the gap away
  const east = cols.find((c) => c.x >= g.cx + g.cw - 2 && c.x - (g.cx + g.cw) <= near);
  const west = cols.find((c) => c.x + c.w <= g.cx + 2 && g.cx - (c.x + c.w) <= near);
  d.col = { cx: g.cx, cw: g.cw, east: east && { id: east.id, cx: east.x, cw: east.w }, west: west && { id: west.id, cx: west.x, cw: west.w } };
}

function panoColDrag(d, dx) {
  const g = wm.geometry[d.id];
  const c = d.col;
  const min = WIN_MIN[0];
  if (d.kind.includes("e")) {
    let delta = Math.max(min - c.cw, dx);
    if (c.east) delta = Math.min(delta, c.east.cw - min);
    g.cw = Math.round(c.cw + delta);
    if (c.east) {
      Object.assign(wm.geometry[c.east.id], { cx: Math.round(c.east.cx + delta), cw: Math.round(c.east.cw - delta) });
      winApply(c.east.id);
    }
  } else if (d.kind.includes("w")) {
    let delta = Math.min(c.cw - min, Math.max(-c.cx, dx));
    if (c.west) delta = Math.max(delta, min - c.west.cw);
    Object.assign(g, { cx: Math.round(c.cx + delta), cw: Math.round(c.cw - delta) });
    if (c.west) {
      wm.geometry[c.west.id].cw = Math.round(c.west.cw + delta);
      winApply(c.west.id);
    }
  }
  winApply(d.id);
  panoMap(false);
}

// Alt+U/P on a column: its right edge, the same way.
function panoColResize(id, dw) {
  const d = { id, kind: "e" };
  panoColStart(d);
  if (!d.col) return false;
  panoColDrag(d, dw);
  winRemember();
  return true;
}

// ------------------------------------------- floating, tiling, panorama

// Into Panorama: workspace n's windows go to the nth screen along, as they
// were (a half-screen one a column there), and you're at the start.
function panoEnter() {
  const area = winArea();
  for (const [id, g] of Object.entries(wm.geometry)) {
    if (!wm.windows.has(id)) continue;
    const left = (Math.min(WS_COUNT, tiles.ws[id] || tiles.current) - 1) * area.w;
    if (g.mode === "left" || g.mode === "right" || g.mode === "max") panoColumnOf(g, g.mode, left, area);
    else if (g.mode !== "col") g.x += left;
  }
  tiles.ws = {};
  tiles.current = tiles.previous = 1;
  for (const id of wm.windows.keys()) $(id)?.classList.remove("off-ws");
  pano.x = 0;
  winSave(PANO_X_KEY, 0);
  winRemember();
}

// Out of it: each window to the workspace of the screen it's mostly on (the
// tenth and on, the tenth), where it was on that screen; you, to yours.
function panoLeave() {
  const W = winArea().w;
  const screen = (x, w) => Math.min(WS_COUNT - 1, Math.max(0, Math.floor((x + w / 2) / W)));
  for (const [id, g] of Object.entries(wm.geometry)) {
    if (!wm.windows.has(id)) continue;
    const col = g.mode === "col";
    const k = screen(col ? g.cx : g.x, col ? g.cw : g.w);
    tiles.ws[id] = k + 1;
    if (col) g.mode = g.side || "normal";
    else g.x -= k * W;
  }
  tiles.current = tiles.previous = screen(pano.x, W) + 1;
  for (const id of wm.windows.keys()) if (isOpen(id)) $(id).classList.toggle("off-ws", tiles.ws[id] !== tiles.current);
  pano.x = 0;
  winSave(PANO_X_KEY, 0);
  winRemember();
}

// ------------------------------------------------------------------ map

function panoMapNode() {
  let map = $("pano-map");
  if (map) return map;
  map = el("div", { id: "pano-map", class: "pano-map material", "aria-hidden": "true" }, el("div", { class: "pano-map-track" }));
  map.addEventListener("pointerenter", () => { pano.mapOver = true; clearTimeout(pano.mapTimer); });
  map.addEventListener("pointerleave", () => { pano.mapOver = false; panoMapAway(); });
  map.addEventListener("click", (e) => {
    const track = map.querySelector(".pano-map-track");
    const r = track.getBoundingClientRect();
    const scale = Number(track.dataset.scale) || 1;
    pano.jump = null;
    panoGlide((e.clientX - r.left) / scale - winArea().w / 2);
  });
  document.body.append(map);
  return map;
}

function panoMapAway() {
  clearTimeout(pano.mapTimer);
  pano.mapTimer = setTimeout(() => { if (!pano.mapOver) $("pano-map")?.classList.remove("shown"); }, 1200);
}

// The whole strip, small: shown (and its fading put off) when `show`,
// else only brought up to date if it's showing.
function panoMap(show) {
  const map = show ? panoMapNode() : $("pano-map");
  if (!map || (!show && !map.classList.contains("shown"))) return;
  if (!panoramaOn()) return map.classList.remove("shown");
  const area = winArea();
  const spans = panoSpans();
  const extent = Math.max(pano.x + area.w, ...spans.map((s) => s.x + s.w)) + area.w * 0.25;
  const scale = Math.min(PANO_MAP_H / area.h, PANO_MAP_MAX_W / extent);
  const track = map.querySelector(".pano-map-track");
  track.dataset.scale = String(scale);
  Object.assign(track.style, { width: `${Math.round(extent * scale)}px`, height: `${Math.round(area.h * scale)}px` });
  const px = (v) => `${Math.round(v * scale)}px`;
  const parts = [];
  for (let s = area.w; s < extent; s += area.w) parts.push(el("span", { class: "pano-map-screen", style: `left: ${px(s)}` }));
  const order = [...wm.stack, ...wm.windows.keys()];
  spans.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  for (const s of spans) {
    const w = wm.windows.get(s.id);
    const icon = w?.app ? plateFor(w.app) : el("img", { src: `/static/dock/${w?.icon || w?.dock || s.id}.svg`, alt: "", draggable: "false" });
    parts.push(el("span", { class: `pano-map-win${wm.active === s.id ? " active" : ""}`,
      style: `left: ${px(s.x)}; top: ${px(s.y)}; width: ${px(s.w)}; height: ${px(s.h ?? area.h)}` }, icon));
  }
  parts.push(el("span", { class: "pano-map-view", style: `left: ${px(pano.x)}; width: ${px(area.w)}` }));
  track.replaceChildren(...parts);
  if (show) {
    map.classList.add("shown");
    panoMapAway();
  }
}

// --------------------------------------------------------------- wiring

document.addEventListener("keyup", (e) => {
  if (e.code === "KeyA") panoHold(-1, false);
  else if (e.code === "KeyD") panoHold(1, false);
  else if (e.key === "Alt") { pano.keys.clear(); panoHold(0, false); }
}, true);
window.addEventListener("blur", () => { pano.keys.clear(); panoHold(0, false); });


// Sideways (a trackpad, Shift and the wheel) over the desktop; Alt and the
// wheel anywhere, over a window too.
document.addEventListener("wheel", (e) => {
  if (!panoramaOn() || e.ctrlKey || e.metaKey) return;
  const overWindow = e.target.closest?.(".sheet, #dock, .menu, #modal, #pano-map");
  if (overWindow && !e.altKey) return;
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? winArea().w : 1;
  const d = (e.deltaX || (e.shiftKey || e.altKey ? e.deltaY : 0)) * unit;
  if (!d) return;
  e.preventDefault();
  panoGlideStop();
  panoSet(pano.x + d * panoSpeed());
}, { passive: false });
