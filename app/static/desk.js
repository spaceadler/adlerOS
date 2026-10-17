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
const DESK_PLACES_KEY = "adleros.deskPlaces"; // {file name: [column, row]}, this computer's
const DESK_CELL = { w: 96, h: 108, gapX: 10, gapY: 6 }; // as in app.css
// Widgets on the desktop: three cells wide, two tall, where you put them.
const DESK_WIDGETS_KEY = "adleros.deskWidgets"; // [{key, id, cell: [column, row]}], this computer's
const DESK_WIDGET = { cols: 3, rows: 2 };
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

function deskAppNodes() {
  const places = deskPlaces();
  return deskApps().map(pinFor).filter(Boolean).map((p) => {
    const name = p.builtin ? p.builtin.name : p.name;
    const glyph = p.builtin
      ? el("span", { class: "desk-glyph desk-app-glyph builtin" }, el("img", { src: `/static/dock/${p.builtin.icon}.svg`, alt: "" }))
      : el("span", { class: "desk-glyph desk-app-glyph" }, plateFor(p));
    const icon = el("button", { type: "button", class: `desk-icon desk-app${p.up === false ? " offline" : ""}`, "data-desk-app": p.id, title: name },
      glyph, el("span", { class: "desk-name" }, name));
    const at = places[`app:${p.id}`];
    if (at && at[1] <= deskRows()) placeIcon(icon, at);
    const open = () => (p.builtin ? p.builtin.open() : openApp(p));
    icon.addEventListener("dblclick", open);
    icon.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
    return icon;
  });
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
  return deskWidgetList().some((w) => w.key !== except && cell[0] >= w.cell[0] && cell[0] < w.cell[0] + DESK_WIDGET.cols
    && cell[1] >= w.cell[1] && cell[1] < w.cell[1] + DESK_WIDGET.rows);
}
function fitsWidget(cell, except) {
  if (cell[0] < 1 || cell[1] < 1 || cell[1] + DESK_WIDGET.rows - 1 > deskRows()) return false;
  for (let c = 0; c < DESK_WIDGET.cols; c++) for (let r = 0; r < DESK_WIDGET.rows; r++) {
    if (underWidget([cell[0] + c, cell[1] + r], except)) return false;
  }
  return true;
}
// The nearest place a widget fits, starting from where you wanted it.
function widgetSpot(want, except) {
  const rows = deskRows();
  const start = [Math.max(1, want[0]), Math.min(Math.max(1, want[1]), Math.max(1, rows - DESK_WIDGET.rows + 1))];
  if (fitsWidget(start, except)) return start;
  for (let d = 1; d < 40; d++) {
    for (const [dc, dr] of [[0, d], [-d, 0], [d, 0], [0, -d]]) {
      const cell = [start[0] + dc, start[1] + dr];
      if (fitsWidget(cell, except)) return cell;
    }
  }
  return start;
}
// Icons you'd put where a widget now is go back in with the rest.
function clearUnderWidgets() {
  const places = deskPlaces();
  let changed = false;
  for (const [name, cell] of Object.entries(places)) {
    if (underWidget(cell)) {
      delete places[name];
      changed = true;
    }
  }
  if (changed) saveDeskPlaces(places);
}

function addDeskWidget(id, cell) {
  const list = deskWidgetList();
  const want = cell || [Math.max(1, deskCols() - DESK_WIDGET.cols + 1), 1];
  list.push({ key: Math.random().toString(36).slice(2, 10), id, cell: widgetSpot(want) });
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
      made = { node: el("div", { class: "desk-widget", "data-desk-widget": w.key }, widget.node), update: widget.update };
      desk.widgets.set(w.key, made);
    }
    const row = Math.min(w.cell[1], Math.max(1, deskRows() - DESK_WIDGET.rows + 1));
    made.node.style.gridColumn = `${w.cell[0]} / span ${DESK_WIDGET.cols}`;
    made.node.style.gridRow = `${row} / span ${DESK_WIDGET.rows}`;
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
    el("p", { class: "picker-note" }, "It goes on the desktop, three icons wide and two tall: drag it where you want it."),
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
  return Math.max(1, Math.floor(($("desk").clientHeight + DESK_CELL.gapY) / (DESK_CELL.h + DESK_CELL.gapY)));
}
function placeIcon(icon, at) {
  icon.style.gridColumn = at ? String(at[0]) : "";
  icon.style.gridRow = at ? String(at[1]) : "";
}

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
    grid.replaceChildren(el("p", { class: "desk-empty" }, "No Desktop folder yet: set DESKTOP_DIR (in adlerOS's .env) and run ./install.sh again."));
    return;
  }
  const had = document.activeElement?.closest?.("#desk") ? document.activeElement.dataset.file : null;
  grid.replaceChildren(...desk.entries.map((entry) => {
    const path = `/desktop/${entry.name}`;
    const icon = el("button", { type: "button", class: `desk-icon${entry.outside ? " outside" : ""}`, "data-file": path, title: entry.name },
      el("span", { class: `desk-glyph file-icon ${entry.kind}` }, svg(FILE_ICONS[entry.kind] || FILE_ICONS.file)),
      el("span", { class: "desk-name" }, entry.name));
    const at = deskPlaces()[entry.name];
    if (at && at[1] <= deskRows()) placeIcon(icon, at);
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
  if (!icon || e.button !== 0 || e.pointerType !== "mouse" || !desktopMode()) return;
  desk.drag = { icon, widget: icon.dataset.deskWidget || null, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, over: null };
}

// What's under the pointer: a folder on the desktop, the Files window's
// folder, or a free place on the desktop.
function deskTarget(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const icon = under?.closest(".desk-icon");
  const entry = icon && desk.entries.find((x) => `/desktop/${x.name}` === icon.dataset.file);
  if (icon && icon !== desk.drag.icon && entry?.dir) return { folder: icon };
  if (under?.closest("#files .files-list") && files.view === "folder" && files.writable && files.path !== "/desktop") return { files: true };
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
  $("files-list").classList.remove("drop-here");
  d.over = t.folder || null;
  d.over?.classList.add("drop-target");
  if (t.files) $("files-list").classList.add("drop-here");
}

function deskUp(e) {
  const d = desk.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  desk.drag = null;
  if (!d.active) return;
  d.ghost.remove();
  d.icon.classList.remove("drag-source");
  d.over?.classList.remove("drop-target");
  $("files-list").classList.remove("drop-here");
  desk.justDragged = true; // its click (a widget opens what it's about) doesn't count
  setTimeout(() => { desk.justDragged = false; }, 0);
  if (d.widget) return moveDeskWidget(d, e);
  // An app on the desktop only moves about on it.
  if (d.icon.dataset.deskApp) return deskPlace(d.icon, `app:${d.icon.dataset.deskApp}`, e);
  const name = d.icon.dataset.file.slice("/desktop/".length);
  const t = deskTarget(e);
  if (t.folder) return deskMoveTo(name, t.folder.dataset.file);
  if (t.files) return deskMoveTo(name, files.path);
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
  w.cell = widgetSpot([at[0] - held[0], at[1] - held[1]], w.key);
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

// Somewhere else on the desktop: that cell, and whatever was there takes
// this one's old place (or flows back in with the rest).
// The cell of the desktop's grid under a point: [column, row].
function deskCellAt(x, y) {
  const r = $("desk").getBoundingClientRect();
  return [Math.max(1, Math.floor((x - r.left) / (DESK_CELL.w + DESK_CELL.gapX)) + 1),
    Math.min(deskRows(), Math.max(1, Math.floor((y - r.top) / (DESK_CELL.h + DESK_CELL.gapY)) + 1))];
}

// A file arriving on the desktop (dragged from Files): there, from now on.
// Whatever had that cell flows back in with the rest.
function rememberDeskPlace(name, cell) {
  const places = deskPlaces();
  for (const n of Object.keys(places)) if (places[n][0] === cell[0] && places[n][1] === cell[1]) delete places[n];
  places[name] = cell;
  saveDeskPlaces(places);
}

function deskPlace(icon, name, e) {
  const [col, row] = deskCellAt(e.clientX, e.clientY);
  if (underWidget([col, row])) return; // a widget's there: it stays where it was
  const places = deskPlaces();
  const before = places[name];
  const there = Object.keys(places).find((n) => n !== name && places[n][0] === col && places[n][1] === row);
  if (there) {
    if (before) places[there] = before;
    else delete places[there];
    const other = $("desk").querySelector(`[data-file="${CSS.escape(`/desktop/${there}`)}"]`);
    if (other) placeIcon(other, places[there]);
  }
  places[name] = [col, row];
  // Only what's on the desktop now is remembered.
  const names = new Set([...desk.entries.map((x) => x.name), ...deskApps().map((id) => `app:${id}`)]);
  saveDeskPlaces(Object.fromEntries(Object.entries(places).filter(([n]) => names.has(n))));
  placeIcon(icon, [col, row]);
}

// The right-click menu on the desktop, in desktop mode.
function deskMenu(target) {
  const deskApp = target.closest(".desk-app")?.dataset.deskApp;
  if (deskApp && pinFor(deskApp)) {
    const p = pinFor(deskApp);
    return [{ label: "Open", run: () => (p.builtin ? p.builtin.open() : openApp(p)) },
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
    items.push({ label: "Upload…", run: () => { files.uploadTo = "/desktop"; $("files-picker").click(); } },
      { label: "Open in Files", run: () => openFiles("/desktop") });
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
