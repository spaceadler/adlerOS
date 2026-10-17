// The desktop in desktop mode: your Desktop folder (a homelab's mailbox/) as
// icons, in columns from the top left like any desktop. Double-click (or
// Enter, or a tap) opens one; right-click (or m) has the rest. Drop files on
// it to put them there. It looks again every so often, so files that arrive
// another way (Syncthing) show up.
// Uses $, el, svg, api, toast, desktopMode, openFiles, openEntry, editFile,
// downloadFile, clip, paste, renamePath, deletePaths, newFolder, newTextFile,
// uploadFiles, openMenu, menuFor, FILE_ICONS, files.
"use strict";

const desk = { entries: [], on: false, timer: null, at: 0 };
const DESK_REFRESH_MS = 15000;

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
