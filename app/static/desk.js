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
  if (had) grid.querySelector(`[data-file="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
}

// ------------------------------------------------------------ dragging

function deskDown(e) {
  const icon = e.target.closest(".desk-icon");
  if (!icon || e.button !== 0 || e.pointerType !== "mouse" || !desktopMode()) return;
  desk.drag = { icon, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, over: null };
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
  const name = d.icon.dataset.file.slice("/desktop/".length);
  const t = deskTarget(e);
  if (t.folder) return deskMoveTo(name, t.folder.dataset.file);
  if (t.files) return deskMoveTo(name, files.path);
  if (t.cell) deskPlace(d.icon, name, e);
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
  const names = new Set(desk.entries.map((x) => x.name));
  saveDeskPlaces(Object.fromEntries(Object.entries(places).filter(([n]) => names.has(n))));
  placeIcon(icon, [col, row]);
}

// The right-click menu on the desktop, in desktop mode.
function deskMenu(target) {
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
  items.push({ label: "Change wallpaper", run: () => openSettings("wallpaper") },
    { label: "Home screen mode", run: () => setDesktopMode(false) },
    { label: "Log out", run: confirmLogout, destructive: true });
  return items;
}

// ---------------------------------------------------------------- wiring

const deskGrid = $("desk");
deskGrid.addEventListener("pointerdown", deskDown);
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
