// The desktop in desktop mode: your Desktop folder (a homelab's mailbox/) as
// icons, in columns from the top left like any desktop. Double-click (or
// Enter, or a tap) opens one; right-click (or m) has the rest. Drag one to
// put it somewhere else (each computer remembers where), onto a folder to
// move it in there, or onto the Files window to move it to the folder that
// shows. Drop files from your computer on it to put them there. It looks
// again every so often, so files that arrive another way (Syncthing) show up.
// Uses $, el, svg, api, toast, desktopMode, openFiles, openEntry, editFile,
// downloadFile, clip, paste, renamePath, deletePaths, newFolder, newTextFile,
// uploadFiles, openMenu, menuFor, FILE_ICONS, files, filesPost, watchTask,
// refreshFiles.
"use strict";

const desk = { entries: [], on: false, timer: null, at: 0, drag: null };
const DESK_REFRESH_MS = 15000;
// The desktop's grid: columns an icon wide, and rows half an icon tall, so
// an icon takes two of them and a widget (three columns wide) three: a row
// and a half. Places are [column, half row], the top left one an item takes.
const DESK_PLACES_KEY = "adleros.deskPlaces"; // {file name: [column, half row]}, this computer's
const DESK_CELL = { w: 96, h: 51, gapX: 10, gapY: 6 }; // as in app.css
const ICON_ROWS = 2;
const DESK_WIDGETS_KEY = "adleros.deskWidgets"; // [{key, id, cell: [column, half row]}], this computer's
const DESK_WIDGET = { cols: 3, rows: 3 }; // unless its catalog entry says ("size": [columns, half rows])
function widgetSize(id) {
  const size = widgetDef(id)?.size;
  return Array.isArray(size) ? { cols: size[0], rows: size[1] } : DESK_WIDGET;
}
// From before the half rows: whole rows, once, into half ones.
try {
  if (localStorage.getItem("adleros.deskGrid") !== "half") {
    const half = (cell) => [cell[0], (cell[1] - 1) * 2 + 1];
    const places = JSON.parse(localStorage.getItem(DESK_PLACES_KEY) || "{}");
    for (const name of Object.keys(places)) places[name] = half(places[name]);
    localStorage.setItem(DESK_PLACES_KEY, JSON.stringify(places));
    const list = JSON.parse(localStorage.getItem(DESK_WIDGETS_KEY) || "[]");
    localStorage.setItem(DESK_WIDGETS_KEY, JSON.stringify(list.map((w) => ({ ...w, cell: half(w.cell) }))));
    localStorage.setItem("adleros.deskGrid", "half");
  }
} catch { /* nothing kept, nothing to change */ }
desk.widgets = new Map(); // key -> {node, update}, kept between redraws
// Apps put on the desktop (All apps → Add to desktop): their pin ids (an
// app's id, or adleros:files…), this computer's; placed like files, as "app:<id>".
const DESK_APPS_KEY = "adleros.deskApps";

function deskApps() {
  try {
    const list = JSON.parse(localStorage.getItem(DESK_APPS_KEY));
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function onDesk(id) { return deskApps().includes(id); }
function setOnDesk(id, on) {
  const list = deskApps().filter((x) => x !== id);
  try { localStorage.setItem(DESK_APPS_KEY, JSON.stringify(on ? [...list, id] : list)); } catch { /* not kept */ }
  if (!on) {
    const places = deskPlaces();
    delete places[`app:${id}`];
    saveDeskPlaces(places);
  }
  toast(on ? `${pinName(id)} is on the desktop.` : `${pinName(id)} is off the desktop.`);
  renderDesk();
}
const pinName = (id) => { const p = pinFor(id); return p?.builtin ? p.builtin.name : p?.name || id; };

// Your own folder, named after you (Settings → Name): User, in My Computer.
// Always on the desktop; it moves about like an app, but doesn't go.
const DESK_HOME = "adleros:home";
function deskHomeNode(places) {
  const name = state.name || "User";
  const icon = el("button", { type: "button", class: "desk-icon desk-app desk-home", "data-desk-app": DESK_HOME, title: `${name}: your files (User)` },
    el("span", { class: "desk-glyph file-icon folder" }, svg(FILE_ICONS.folder)), el("span", { class: "desk-name" }, name));
  const at = places[`app:${DESK_HOME}`];
  if (at && at[1] <= deskRows() - ICON_ROWS + 1) placeIcon(icon, at);
  icon.addEventListener("dblclick", () => openFiles("/user"));
  icon.addEventListener("click", () => { if (matchMedia("(pointer: coarse)").matches) openFiles("/user"); });
  icon.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); openFiles("/user"); } });
  return icon;
}

function deskAppNodes() {
  const places = deskPlaces();
  return [deskHomeNode(places), ...deskApps().map(pinFor).filter(Boolean).map((p) => {
    const name = p.builtin ? p.builtin.name : p.name;
    const glyph = p.builtin
      ? el("span", { class: "desk-glyph desk-app-glyph builtin" }, el("img", { src: `/api/dock-icon/${p.builtin.icon}`, alt: "" }))
      : el("span", { class: "desk-glyph desk-app-glyph" }, plateFor(p));
    const icon = el("button", { type: "button", class: `desk-icon desk-app${p.up === false ? " offline" : ""}`, "data-desk-app": p.id, title: name },
      glyph, el("span", { class: "desk-name" }, name));
    const at = places[`app:${p.id}`];
    if (at && at[1] <= deskRows() - ICON_ROWS + 1) placeIcon(icon, at);
    const open = () => (p.builtin ? p.builtin.open() : openApp(p));
    icon.addEventListener("dblclick", open);
    icon.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
    return icon;
  })];
}

function deskWidgetList() {
  try {
    const list = JSON.parse(localStorage.getItem(DESK_WIDGETS_KEY));
    return Array.isArray(list) ? list.filter((w) => w && typeof w.key === "string" && Array.isArray(w.cell)) : [];
  } catch {
    return [];
  }
}
function saveDeskWidgets(list) {
  try { localStorage.setItem(DESK_WIDGETS_KEY, JSON.stringify(list)); } catch { /* not kept */ }
}
function deskCols() {
  return Math.max(DESK_WIDGET.cols, Math.floor(($("desk").clientWidth + DESK_CELL.gapX) / (DESK_CELL.w + DESK_CELL.gapX)));
}
// Whether a cell is under one of the desktop's widgets (but `except`).
function underWidget(cell, except) {
  return deskWidgetList().some((w) => {
    const z = widgetSize(w.id);
    return w.key !== except && cell[0] >= w.cell[0] && cell[0] < w.cell[0] + z.cols && cell[1] >= w.cell[1] && cell[1] < w.cell[1] + z.rows;
  });
}
function fitsWidget(cell, except, size = DESK_WIDGET) {
  if (cell[0] < 1 || cell[1] < 1 || cell[1] + size.rows - 1 > deskRows()) return false;
  for (let c = 0; c < size.cols; c++) for (let r = 0; r < size.rows; r++) {
    if (underWidget([cell[0] + c, cell[1] + r], except)) return false;
  }
  return true;
}
// The nearest place a widget fits, starting from where you wanted it: up or
// down that column before another column (a column is wider than a half row).
function widgetSpot(want, except, size = DESK_WIDGET) {
  const rows = deskRows();
  const start = [Math.max(1, want[0]), Math.min(Math.max(1, want[1]), Math.max(1, rows - size.rows + 1))];
  let best = null;
  for (let col = 1; col <= deskCols() + size.cols; col++) {
    for (let row = 1; row <= rows; row++) {
      const cost = Math.abs(col - start[0]) * 4 + Math.abs(row - start[1]);
      if ((!best || cost < best.cost) && fitsWidget([col, row], except, size)) best = { cell: [col, row], cost };
    }
  }
  return best ? best.cell : start;
}
// Whether an icon there would be (partly) under a widget.
function iconUnderWidget(cell) {
  return underWidget(cell) || underWidget([cell[0], cell[1] + ICON_ROWS - 1]);
}
// Icons you'd put where a widget now is go back in with the rest.
// Two widgets on top of each other (one grew: the search bar got wider):
// the later one moves to the nearest place that's free.
function separateWidgets() {
  const list = deskWidgetList();
  list.forEach((w, i) => {
    const z = widgetSize(w.id);
    const hit = list.slice(0, i).some((o) => {
      const y = widgetSize(o.id);
      return w.cell[0] < o.cell[0] + y.cols && o.cell[0] < w.cell[0] + z.cols && w.cell[1] < o.cell[1] + y.rows && o.cell[1] < w.cell[1] + z.rows;
    });
    if (!hit) return;
    w.cell = widgetSpot(w.cell, w.key, z);
    saveDeskWidgets(list);
  });
}

function clearUnderWidgets() {
  separateWidgets();
  const places = deskPlaces();
  let changed = false;
  for (const [name, cell] of Object.entries(places)) {
    if (iconUnderWidget(cell)) {
      delete places[name];
      changed = true;
    }
  }
  if (changed) saveDeskPlaces(places);
}

function addDeskWidget(id, cell) {
  const list = deskWidgetList();
  const size = widgetSize(id);
  const want = cell || [Math.max(1, deskCols() - size.cols + 1), 1];
  list.push({ key: Math.random().toString(36).slice(2, 10), id, cell: widgetSpot(want, undefined, size) });
  saveDeskWidgets(list);
  clearUnderWidgets();
  renderDesk();
}

function removeDeskWidget(key) {
  saveDeskWidgets(deskWidgetList().filter((w) => w.key !== key));
  desk.widgets.delete(key);
  renderDesk();
}

function deskWidgetNodes() {
  const list = deskWidgetList();
  for (const key of desk.widgets.keys()) if (!list.some((w) => w.key === key)) desk.widgets.delete(key);
  return list.map((w) => {
    const def = widgetDef(w.id);
    if (!def) return null;
    let made = desk.widgets.get(w.key);
    if (!made) {
      const widget = widgetNode(def);
      if (!widget) return null;
      made = { node: el("div", { class: `desk-widget${def.type === "search" ? " bar" : ""}`, "data-desk-widget": w.key }, widget.node), update: widget.update };
      desk.widgets.set(w.key, made);
    }
    const z = widgetSize(w.id);
    const row = Math.min(w.cell[1], Math.max(1, deskRows() - z.rows + 1));
    made.node.style.gridColumn = `${w.cell[0]} / span ${z.cols}`;
    made.node.style.gridRow = `${row} / span ${z.rows}`;
    if (widgets.data) made.update(widgets.data);
    return made.node;
  }).filter(Boolean);
}

function updateDeskWidgets(data) {
  if (!desktopMode()) return;
  for (const made of desk.widgets.values()) made.update(data);
}

// Right-click → Add widget…: the same widgets as the home screen's.
async function deskWidgetPicker(cell) {
  await loadWidgetCatalog();
  if (!widgets.data) await refreshWidgets();
  const grid = el("div", { class: "picker-grid" }, ...widgets.catalog.widgets.map((w) => {
    const made = widgetNode(w, { preview: true });
    if (!made) return "";
    const option = el("button", { type: "button", class: "picker-option", title: w.description || w.label }, made.node);
    option.addEventListener("click", () => {
      closeModal();
      addDeskWidget(w.id, cell);
    });
    return option;
  }));
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material widget-picker", role: "dialog", "aria-modal": "true", "aria-label": "Add a widget" },
    el("div", { class: "picker-head" }, el("h2", {}, "Add a widget")),
    el("p", { class: "picker-note" }, "It goes on the desktop, three icons wide and a row and a half tall: drag it where you want it."),
    grid, el("div", { class: "dialog-actions" }, cancel)));
  grid.querySelector("button")?.focus();
}

function deskPlaces() {
  try { return JSON.parse(localStorage.getItem(DESK_PLACES_KEY)) || {}; } catch { return {}; }
}
function saveDeskPlaces(places) {
  try { localStorage.setItem(DESK_PLACES_KEY, JSON.stringify(places)); } catch { /* private window: not kept */ }
}
function deskRows() {
  return Math.max(ICON_ROWS, Math.floor(($("desk").clientHeight + DESK_CELL.gapY) / (DESK_CELL.h + DESK_CELL.gapY)));
}
function placeIcon(icon, at) {
  icon.style.gridColumn = at ? String(at[0]) : "";
  icon.style.gridRow = at ? `${at[1]} / span ${ICON_ROWS}` : "";
}
// An icon on the desktop by its place's name (a file's, or app:<id>).
function deskNode(name) {
  return $("desk").querySelector(name.startsWith("app:") ? `[data-desk-app="${CSS.escape(name.slice(4))}"]`
    : `[data-file="${CSS.escape(`/desktop/${name}`)}"]`);
}
const iconsOverlap = (a, b) => a[0] === b[0] && Math.abs(a[1] - b[1]) < ICON_ROWS;

async function refreshDesk() {
  if (!desktopMode()) return;
  const { status, body } = await api("/api/files?path=/desktop").catch(() => ({ status: 0 }));
  desk.at = Date.now();
  if (status === 401) return;
  desk.on = status === 200;
  // Hidden files (.gitkeep, .stignore) stay in Files, off the desktop.
  desk.entries = desk.on ? body.entries.filter((e) => !e.name.startsWith(".")) : [];
  renderDesk();
}

function renderDesk() {
  const grid = $("desk");
  if (!desk.on) {
    // No files to show, but the apps you put here (and your folder, the widgets) still.
    grid.replaceChildren(el("p", { class: "desk-empty" }, "No Desktop folder yet: set DESKTOP_DIR (in adlerOS's .env) and run ./install.sh again."),
      ...deskAppNodes(), ...deskWidgetNodes());
    return;
  }
  const had = document.activeElement?.closest?.("#desk") ? document.activeElement.dataset.file : null;
  grid.replaceChildren(...desk.entries.map((entry) => {
    const path = `/desktop/${entry.name}`;
    const icon = el("button", { type: "button", class: `desk-icon${entry.outside ? " outside" : ""}`, "data-file": path, title: entry.name },
      el("span", { class: `desk-glyph file-icon ${entry.kind}` }, svg(FILE_ICONS[entry.kind] || FILE_ICONS.file)),
      el("span", { class: "desk-name" }, entry.name));
    const at = deskPlaces()[entry.name];
    if (at && at[1] <= deskRows() - ICON_ROWS + 1) placeIcon(icon, at);
    icon.addEventListener("dblclick", () => openEntry(entry, path));
    icon.addEventListener("click", () => { if (matchMedia("(pointer: coarse)").matches) openEntry(entry, path); });
    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); openEntry(entry, path); }
      else if (e.key === "Delete") { e.preventDefault(); deletePaths([path]); }
      else if (e.key === "F2") { e.preventDefault(); renamePath(entry, path); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); clip(entry, path, true); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") { e.preventDefault(); clip(entry, path, false); }
    });
    return icon;
  }));
  grid.append(...deskAppNodes(), ...deskWidgetNodes());
  if (had) grid.querySelector(`[data-file="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
}

// ------------------------------------------------------------ dragging

function deskDown(e) {
  const icon = e.target.closest(".desk-icon, .desk-widget");
  // Pressing in the search bar's box is for typing; its edge moves it.
  if (!icon || e.button !== 0 || e.pointerType !== "mouse" || !desktopMode() || e.target.closest("input")) return;
  desk.drag = { icon, widget: icon.dataset.deskWidget || null, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, over: null };
}

// What's under the pointer: a folder on the desktop, the Files window's
// folder, or a free place on the desktop.
function deskTarget(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const icon = under?.closest(".desk-icon");
  const entry = icon && desk.entries.find((x) => `/desktop/${x.name}` === icon.dataset.file);
  if (icon && icon !== desk.drag.icon && entry?.dir) return { folder: icon };
  // A My Computer window's list: into the folder it's showing.
  const w = under?.closest(".files-list") && fileWinOf(under);
  if (w && w.view === "folder" && w.writable && w.path !== "/desktop" && w.path !== "/") return { files: w };
  if (under?.closest("#desk")) return { cell: true };
  return {};
}

function deskMove(e) {
  const d = desk.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.active) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.active = true;
    const r = d.icon.getBoundingClientRect();
    d.offX = d.x - r.left;
    d.offY = d.y - r.top;
    d.ghost = d.icon.cloneNode(true);
    d.ghost.classList.add("desk-ghost");
    Object.assign(d.ghost.style, { width: `${r.width}px`, height: `${r.height}px`, gridColumn: "", gridRow: "" });
    document.body.append(d.ghost);
    d.icon.classList.add("drag-source");
    try { d.icon.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  }
  d.ghost.style.transform = `translate(${e.clientX - d.offX}px, ${e.clientY - d.offY}px)`;
  if (d.widget || d.icon.dataset.deskApp) return; // these only move about
  const t = deskTarget(e);
  d.over?.classList.remove("drop-target");
  for (const w of fileWins.values()) w.part("list").classList.remove("drop-here");
  d.over = t.folder || null;
  d.over?.classList.add("drop-target");
  if (t.files) t.files.part("list").classList.add("drop-here");
}

function deskUp(e) {
  const d = desk.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  desk.drag = null;
  if (!d.active) return;
  d.ghost.remove();
  d.icon.classList.remove("drag-source");
  d.over?.classList.remove("drop-target");
  for (const w of fileWins.values()) w.part("list").classList.remove("drop-here");
  desk.justDragged = true; // its click (a widget opens what it's about) doesn't count
  setTimeout(() => { desk.justDragged = false; }, 0);
  if (d.widget) return moveDeskWidget(d, e);
  // An app on the desktop only moves about on it.
  if (d.icon.dataset.deskApp) return deskPlace(d.icon, `app:${d.icon.dataset.deskApp}`, e);
  const name = d.icon.dataset.file.slice("/desktop/".length);
  const t = deskTarget(e);
  if (t.folder) return deskMoveTo(name, t.folder.dataset.file);
  if (t.files) return deskMoveTo(name, t.files.path);
  if (t.cell) deskPlace(d.icon, name, e);
}

// A widget dropped: its top left corner where the part you held lands.
function moveDeskWidget(d, e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under?.closest("#desk")) return;
  const at = deskCellAt(e.clientX, e.clientY);
  const held = [Math.floor(d.offX / (DESK_CELL.w + DESK_CELL.gapX)), Math.floor(d.offY / (DESK_CELL.h + DESK_CELL.gapY))];
  const list = deskWidgetList();
  const w = list.find((x) => x.key === d.widget);
  if (!w) return;
  w.cell = widgetSpot([at[0] - held[0], at[1] - held[1]], w.key, widgetSize(w.id));
  saveDeskWidgets(list);
  clearUnderWidgets();
  renderDesk();
}

// Into a folder: moved there (the desktop and Files look again).
async function deskMoveTo(name, folder) {
  const reply = await filesPost("move", { paths: [`/desktop/${name}`], to: folder });
  if (!reply) return;
  const places = deskPlaces();
  delete places[name];
  saveDeskPlaces(places);
  if (reply.task) watchTask(reply.task);
  else toast(`Moved ${name}.`);
  refreshFiles();
}

// The cell of the desktop's grid under a point: [column, half row].
function deskCellAt(x, y) {
  const r = $("desk").getBoundingClientRect();
  return [Math.max(1, Math.floor((x - r.left) / (DESK_CELL.w + DESK_CELL.gapX)) + 1),
    Math.min(deskRows(), Math.max(1, Math.floor((y - r.top) / (DESK_CELL.h + DESK_CELL.gapY)) + 1))];
}
// Where an icon whose top you'd put at that cell fits (it's two half rows tall).
const iconCell = (cell) => [cell[0], Math.min(cell[1], deskRows() - ICON_ROWS + 1)];

// A file arriving on the desktop (dragged from Files): there, from now on.
// Whatever had that spot flows back in with the rest.
function rememberDeskPlace(name, cell) {
  const at = iconCell(cell);
  const places = deskPlaces();
  for (const n of Object.keys(places)) if (iconsOverlap(places[n], at)) delete places[n];
  places[name] = at;
  saveDeskPlaces(places);
}

// Somewhere else on the desktop: there, and an icon that was there takes
// this one's old place (or flows back in with the rest).
function deskPlace(icon, name, e) {
  const [col, row] = iconCell(deskCellAt(e.clientX, e.clientY));
  if (iconUnderWidget([col, row])) return; // a widget's there: it stays where it was
  const places = deskPlaces();
  const before = places[name];
  const there = Object.keys(places).filter((n) => n !== name && iconsOverlap(places[n], [col, row]));
  there.forEach((n, i) => {
    if (i === 0 && before) places[n] = before;
    else delete places[n];
    const other = deskNode(n);
    if (other) placeIcon(other, places[n]);
  });
  places[name] = [col, row];
  // Only what's on the desktop now is remembered.
  const names = new Set([...desk.entries.map((x) => x.name), ...deskApps().map((id) => `app:${id}`)]);
  saveDeskPlaces(Object.fromEntries(Object.entries(places).filter(([n]) => names.has(n))));
  placeIcon(icon, [col, row]);
}

// The right-click menu on the desktop, in desktop mode.
function deskMenu(target) {
  const deskApp = target.closest(".desk-app")?.dataset.deskApp;
  if (deskApp === DESK_HOME) return [{ label: "Open", run: () => openFiles("/user") }];
  if (deskApp && pinFor(deskApp)) {
    const p = pinFor(deskApp);
    return [{ label: "Open", run: () => (p.builtin ? p.builtin.open() : openApp(p)) }, ...newWindowItem(deskApp),
      isPinned(deskApp) ? { label: "Remove from Dock", run: () => setPinned(deskApp, false) } : { label: "Keep in Dock", run: () => setPinned(deskApp, true) },
      { label: "Remove from desktop", run: () => setOnDesk(deskApp, false), destructive: true }];
  }
  const widget = target.closest(".desk-widget");
  if (widget) {
    const w = deskWidgetList().find((x) => x.key === widget.dataset.deskWidget);
    const def = w && widgetDef(w.id);
    return [...(def?.open ? [{ label: "Open", run: () => openWidget(def) }] : []),
      { label: "Remove widget", run: () => removeDeskWidget(widget.dataset.deskWidget), destructive: true }];
  }
  const icon = target.closest(".desk-icon");
  if (icon) {
    const entry = desk.entries.find((e) => `/desktop/${e.name}` === icon.dataset.file);
    if (!entry) return null;
    const path = icon.dataset.file;
    const items = [{ label: "Open", run: () => openEntry(entry, path) }];
    if (entry.kind === "text" || (!entry.dir && entry.size < 2 * 1024 * 1024 && entry.kind === "file")) items.push({ label: "Edit as text", run: () => editFile(path) });
    if (!entry.dir) items.push({ label: "Download", run: () => downloadFile(path) });
    items.push({ label: "Copy", run: () => clip(entry, path, true) },
      { label: "Cut", run: () => clip(entry, path, false) },
      { label: "Rename…", run: () => renamePath(entry, path) },
      { label: "Delete", run: () => deletePaths([path]), destructive: true });
    return items;
  }
  const items = [];
  if (desk.on) {
    items.push({ label: "New folder", run: () => newFolder("/desktop") },
      { label: "New text file", run: () => newTextFile("/desktop") });
    if (files.clip) items.push({ label: `Paste ${files.clip.label}`, run: () => paste("/desktop") });
    items.push({ label: "Upload…", run: () => { files.uploadTo = "/desktop"; mainFiles().part("picker").click(); } },
      { label: "Open in My Computer", run: () => openFiles("/desktop") });
  }
  const cell = desk.menuAt && deskCellAt(desk.menuAt[0], desk.menuAt[1]);
  items.push({ label: "Add widget…", run: () => deskWidgetPicker(cell) },
    { label: "Change wallpaper", run: () => openSettings("wallpaper") },
    { label: "Home screen mode", run: () => setDesktopMode(false) },
    { label: "Log out", run: confirmLogout, destructive: true });
  return items;
}

// ---------------------------------------------------------------- wiring

const deskGrid = $("desk");
deskGrid.addEventListener("pointerdown", deskDown);
// Where you right-clicked: a widget added from there goes there.
deskGrid.addEventListener("contextmenu", (e) => { desk.menuAt = [e.clientX, e.clientY]; }, true);
$("desktop").addEventListener("keydown", () => { desk.menuAt = null; }, true);
deskGrid.addEventListener("click", (e) => {
  if (!desk.justDragged) return;
  e.preventDefault();
  e.stopPropagation();
}, true);
window.addEventListener("resize", () => { if (desktopMode() && desk.on) renderDesk(); });
document.addEventListener("pointermove", deskMove);
document.addEventListener("pointerup", deskUp);
document.addEventListener("pointercancel", deskUp);
deskGrid.addEventListener("dragover", (e) => {
  if (!desktopMode() || !desk.on || !e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  deskGrid.classList.add("dropping");
});
deskGrid.addEventListener("dragleave", (e) => { if (!deskGrid.contains(e.relatedTarget)) deskGrid.classList.remove("dropping"); });
deskGrid.addEventListener("drop", (e) => {
  deskGrid.classList.remove("dropping");
  if (!desktopMode() || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  uploadFiles(e.dataTransfer.files, "/desktop");
});
// Ctrl+V on the desktop pastes onto it.
deskGrid.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && files.clip) {
    e.preventDefault();
    paste("/desktop");
  }
});
desk.timer = setInterval(() => {
  if (desktopMode() && !document.hidden && !$("desktop").hidden && Date.now() - desk.at > DESK_REFRESH_MS - 500) refreshDesk();
}, DESK_REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && desktopMode() && !$("desktop").hidden) refreshDesk(); });
