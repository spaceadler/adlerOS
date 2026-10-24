// My Computer: three places in a window. Desktop (a homelab's mailbox/) and
// User (your storage folder) you can change: upload (button or drop),
// download, make folders, rename, cut, copy and paste between them, delete
// into the Trash (and restore), edit text files. Root is the homelab's own
// folder: read-only, except in admin mode when the machine allows it, and
// even then it warns you first. Nothing outside the three places is
// reachable. In desktop mode, New window opens more of them, each in a
// folder of its own.
// Uses $, el, svg, api, toast, state, isOpen, isActive, openWindow,
// closeWindow, openModal, closeModal, confirmDialog, openMenu, bytes,
// waitForJob, showLock.
"use strict";

// What every My Computer window shares: what you cut or copied, copies and
// moves under way, uploads, Root's warning, the hidden-files choice, and
// where the desktop's Upload… goes.
const files = { clip: null, tasks: new Map(), uploads: 0, rootOk: false, showHidden: false, uploadTo: null };
// Hidden files (.env, .gitignore…): shown only in admin mode, and only when
// you ask (this browser remembers); off to begin with.
const HIDDEN_KEY = "adleros.showHidden";
try { files.showHidden = localStorage.getItem(HIDDEN_KEY) === "1"; } catch { /* private window */ }
const hiddenShown = (f) => f.admin && files.showHidden;

// Each window's own: its folder, its view (the folder or the Trash), what
// it found there. The first is #files.
const fileWins = new Map();
let fileFront = null; // the one you used last: the desktop's opening and Escape go there

function makeFileWin(id, section) {
  const f = { id, section, path: "/user", place: "user", places: [], entries: [], view: "folder",
    writable: true, admin: false, rootAllowed: false, trash: [], back: [], fwd: [], shown: false,
    part: (name) => section.querySelector(`[data-part="${name}"]`) };
  fileWins.set(id, f);
  wireFiles(f);
  registerNav(id, (dir) => filesNav(f, dir));
  return f;
}

// Back and forward (the mouse's side buttons): where this window has been.
const filesHere = (f) => ({ view: f.view === "trash" ? "trash" : "folder", path: f.path });
function filesWent(f, from) {
  f.back.push(from);
  if (f.back.length > 100) f.back.shift();
  f.fwd = [];
}
function filesNav(f, dir) {
  const to = (dir < 0 ? f.back : f.fwd).pop();
  if (!to) return;
  (dir < 0 ? f.fwd : f.back).push(filesHere(f));
  if (to.view === "trash") showTrash(f, { remember: false });
  else showFolder(to.path, f, { remember: false });
}
const mainFiles = () => fileWins.get("files");
const frontFiles = () => (fileFront && fileWins.has(fileFront.id) && isOpen(fileFront.id) ? fileFront : mainFiles());
const fileWinOf = (node) => fileWins.get(node?.closest?.(".files-sheet")?.id);

const FILE_ICONS = {
  folder: ["M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  text: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "m21 15-5-5L5 21", "M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  video: ["M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "m17 10 5-3v10l-5-3"],
  audio: ["M9 18V5l12-2v13", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  pdf: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 15h1a1.5 1.5 0 0 0 0-3H9v5"],
  archive: ["M21 8v13H3V8", "M1 3h22v5H1z", "M10 12h4"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
};
const PLACE_ICONS = {
  desktop: ["M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M8 20h8", "M12 16v4"],
  user: ["M3 10.5 12 3l9 7.5", "M5 9v11h14V9", "M10 20v-6h4v6"],
  root: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"],
};
const PLACE_NAMES = { desktop: "Desktop", user: "User", root: "Root" };

const join = (dir, name) => `${dir.replace(/\/$/, "")}/${name}`;
const parentOf = (path) => path.split("/").slice(0, -1).join("/") || "/";
const placeOf = (path) => path.split("/")[1] || "";
const fileUrl = (path, inline) => `/api/files/raw?path=${encodeURIComponent(path)}&inline=${inline ? 1 : 0}`;

function when(seconds) {
  const d = new Date(seconds * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

// ------------------------------------------------------- open and close

function filesOpen() { return [...fileWins.keys()].some((id) => isOpen(id)); }

// My Computer starts at Root (the homelab's folder) in admin mode, at User
// otherwise; a path (the Desktop, a folder) opens there instead.
const filesHome = () => (state.admin ? "/root" : "/user");
function toggleFiles() { toggleWindow("files", () => openFiles(filesHome())); }

async function openFiles(path, f = mainFiles()) {
  openWindow(f.id);
  fileFront = f;
  await showFolder(path || f.path, f);
  (f.part("list").querySelector(".file-row") || f.part("up")).focus({ preventScroll: true });
}

// Another My Computer window (New window, or Alt+E with one open).
function newFilesWindow(path) {
  if (!desktopMode()) return openFiles(path || filesHome());
  let n = 2;
  while ($(`files-${n}`)) n++;
  const id = `files-${n}`;
  const section = $("files").cloneNode(true);
  section.querySelector(":scope > .win-bar")?.remove();
  section.querySelectorAll(":scope > .win-grip").forEach((g) => g.remove());
  Object.assign(section, { id, hidden: true });
  section.classList.remove("active", "minimized", "closing", "off-ws", "win-genie", "dropping");
  section.removeAttribute("style");
  section.setAttribute("aria-label", `My Computer ${n}`);
  document.body.insertBefore(section, $("files").nextSibling);
  const f = makeFileWin(id, section);
  registerWindow(id, { title: `My Computer ${n}`, close: () => closeFiles(f), icon: "files", size: [980, 640], copy: true });
  return openFiles(path || filesHome(), f);
}

function closeFiles(f = mainFiles()) {
  closeWindow(f.id);
  if (f.id !== "files") fileWins.delete(f.id);
}

// Logging out: no "unsaved changes" question (Notepad's).
function forgetFileEdits() { for (const p of pads.values()) p.dirty = false; }

// --------------------------------------------------------------- folder

async function showFolder(path, f = frontFiles(), { remember = true } = {}) {
  const from = f.shown ? filesHere(f) : null;
  const { status, body } = await api(`/api/files?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status === 404 && body?.error === "no storage folder is mounted") {
    f.view = "folder";
    f.entries = [];
    f.part("side").replaceChildren();
    f.part("list").replaceChildren(el("p", { class: "store-error" }, "adlerOS can't see a storage folder. Set STORAGE_DIR (in .env, or homelab.env) and run ./install.sh again."));
    return;
  }
  if (status !== 200) {
    toast(body?.error || "Can't open that folder.");
    if (path !== "/user" && path !== "/") return showFolder(f.places.length ? `/${f.places[0].place}` : "/", f, { remember });
    return;
  }
  if (remember && from && (from.view !== "folder" || from.path !== body.path)) filesWent(f, from);
  f.shown = true;
  Object.assign(f, {
    view: "folder", path: body.path, place: body.place, places: body.places, entries: body.entries,
    writable: body.writable, admin: Boolean(body.admin), rootAllowed: Boolean(body.rootAllowed),
  });
  if (!f.admin) files.rootOk = false; // the warning again, next time admin mode is on
  renderFiles(f);
}

function crumbs(f) {
  const parts = f.path.split("/").filter(Boolean);
  const nodes = [];
  parts.forEach((part, i) => {
    const b = el("button", { type: "button", class: "crumb" }, i === 0 ? PLACE_NAMES[part] || part : part);
    b.addEventListener("click", () => showFolder(`/${parts.slice(0, i + 1).join("/")}`, f));
    if (i) nodes.push(el("span", { class: "crumb-sep", "aria-hidden": "true" }, "/"));
    nodes.push(b);
  });
  return nodes.length ? nodes : [el("span", { class: "crumb current" }, "My Computer")];
}

function renderPlaces(f) {
  const item = (id, label, current, run) => {
    const b = el("button", { type: "button", class: `files-place${current ? " current" : ""}`, "aria-current": current ? "true" : "false",
      ...(id === "trash" ? { "data-trash": "1" } : { "data-path": `/${id}` }) },
      el("span", { class: "files-place-icon", "aria-hidden": "true" }, svg(PLACE_ICONS[id])), el("span", {}, label));
    b.addEventListener("click", run);
    return b;
  };
  f.part("side").replaceChildren(
    ...f.places.map((p) => item(p.place, p.name, f.view === "folder" && f.place === p.place, () => showFolder(`/${p.place}`, f))),
    item("trash", "Trash", f.view === "trash", () => showTrash(f)));
}

// What Root says about itself: look, don't touch (and how to, if you must).
function renderNote(f) {
  const note = f.part("note");
  if (f.view !== "folder" || f.place !== "root") {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  note.classList.toggle("warn", f.writable);
  note.textContent = f.writable
    ? "Admin mode: you can change Root, your homelab's own files. A wrong edit here can stop your apps; git and the terminal are safer."
    : !f.admin
      ? "Root is your homelab's own folder: look around, copy things out. It's read-only; changing it needs admin mode."
      : "Root is read-only on this machine. Changing it also needs ADLEROS_TERMINAL=on (like the terminal).";
}

function renderFiles(f) {
  renderPlaces(f);
  renderNote(f);
  renderTools(f);
  if (f.view === "trash") return renderTrash(f);
  f.part("crumbs").replaceChildren(...crumbs(f));
  f.part("up").disabled = f.path.split("/").filter(Boolean).length < 2;
  const shown = f.entries.filter((e) => hiddenShown(f) || !e.name.startsWith("."));
  const rows = (f.path === "/" ? shown : sortEntries(shown)).map((entry) => {
    const path = entry.place && f.path === "/" ? `/${entry.place}` : join(f.path, entry.name);
    const row = el("button", { type: "button", class: `file-row${entry.outside ? " outside" : ""}`, "data-file": path,
      ...(entry.dir ? { "data-dir": "1" } : {}), ...(entry.place ? { "data-place": entry.place } : {}), ...(entry.kept ? { "data-kept": "1" } : {}),
      title: entry.outside ? "A link to somewhere outside this place" : entry.place ? `${entry.name}: your ${PLACE_NAMES[entry.place]}` : entry.name },
    el("span", { class: `file-icon ${entry.kind}` }, svg(entry.place ? PLACE_ICONS[entry.place] : FILE_ICONS[entry.kind] || FILE_ICONS.file)),
    el("span", { class: "file-name" }, entry.name, entry.place && f.path !== "/" ? el("span", { class: "file-from" }, `Your ${PLACE_NAMES[entry.place]}`) : ""),
    el("span", { class: "file-size" }, entry.dir ? "" : bytes(entry.size)),
    el("span", { class: "file-date" }, entry.mtime ? when(entry.mtime) : ""));
    // A click picks it, a double click opens it, like any file manager. Enter
    // (a click with no mouse in it) and a tap on a touch screen open it too.
    row.addEventListener("click", (e) => {
      if (e.detail === 0 || matchMedia("(pointer: coarse)").matches) return openEntry(entry, path, f);
      pickRow(row, f, e);
    });
    row.addEventListener("dblclick", () => openEntry(entry, path, f));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // One of several picked: the menu's for all of them; else just this one, picked.
      if (!row.classList.contains("selected")) pickRow(row, f, {});
      const many = pickedPaths(f);
      openMenu(e.clientX, e.clientY, many.length > 1 ? manyMenu(many, f) : entryMenu(entry, path, f));
    });
    row.addEventListener("keydown", (e) => entryKeys(e, entry, path, row, f));
    return row;
  });
  const empty = f.writable ? "Empty. Drop files here, or Upload." : "Empty.";
  f.part("list").replaceChildren(...(rows.length ? rows : [el("p", { class: "no-results" }, empty)]));
  // What was picked here stays picked (a new folder: nothing is).
  if (f.selIn !== f.path) { f.sel = new Set(); f.selIn = f.path; f.anchor = null; }
  setPicked(f, [...(f.sel || [])]);
}

// Sorted by name, type or size, A to Z (smallest first) unless you turn it
// round; folders always first, by name. This device remembers.
const FILES_SORT_KEY = "adleros.filesSort";
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const extOf = (name) => (name.includes(".") && !name.startsWith(".") ? name.split(".").pop().toLowerCase() : "");
function filesSort() {
  const s = winLoad(FILES_SORT_KEY, null);
  return { by: ["name", "type", "size"].includes(s?.by) ? s.by : "name", desc: s?.desc === true };
}
function sortEntries(entries) {
  const { by, desc } = filesSort();
  const order = desc ? -1 : 1;
  const compare = by === "size" ? (a, b) => (a.size || 0) - (b.size || 0) || byName(a, b)
    : by === "type" ? (a, b) => a.kind.localeCompare(b.kind) || extOf(a.name).localeCompare(extOf(b.name)) || byName(a, b)
      : byName;
  return [...entries].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.dir ? byName(a, b) * order : compare(a, b) * order));
}
function setFilesSort(change) {
  winSave(FILES_SORT_KEY, { ...filesSort(), ...change });
  for (const f of fileWins.values()) if (isOpen(f.id) && f.view === "folder") renderFiles(f);
}

function renderTools(f) {
  const inFolder = f.view === "folder" && f.path !== "/";
  const sort = filesSort();
  f.part("sort").hidden = f.part("order").hidden = !inFolder;
  f.part("sort").value = sort.by;
  f.part("order").textContent = sort.desc ? "↓ Descending" : "↑ Ascending";
  f.part("order").setAttribute("aria-label", `Sorted ${sort.desc ? "descending" : "ascending"}; change it`);
  const canChange = inFolder && f.writable;
  f.part("new-folder").hidden = f.part("new-file").hidden = !canChange;
  f.part("upload").hidden = !canChange || f.place === "root";
  const hidden = f.part("hidden");
  hidden.hidden = !inFolder || !f.admin;
  hidden.textContent = files.showHidden ? "Hide hidden files" : "Show hidden files";
  hidden.setAttribute("aria-pressed", String(files.showHidden));
  const paste = f.part("paste");
  paste.hidden = !files.clip || !canChange;
  if (files.clip) paste.textContent = `${files.clip.copy ? "Paste copy of" : "Move"} ${files.clip.label} here`;
}

// The keys for a file or folder in the list.
function entryKeys(e, entry, path, row, f) {
  const mod = e.ctrlKey || e.metaKey;
  // A place, or one of Root's own folders: opened, never deleted, renamed, cut or copied.
  if ((entry.place || entry.kept) && (e.key === "Delete" || e.key === "F2" || (mod && "cx".includes(e.key.toLowerCase())))) { e.preventDefault(); return; }
  // Several picked (this one among them): Delete, copy and cut are for all of them.
  const many = row.classList.contains("selected") ? pickedPaths(f) : [];
  const these = many.length > 1 ? many : [path];
  if (e.key === "Delete") { e.preventDefault(); return f.writable && deletePaths(these); }
  if (e.key === "F2") { e.preventDefault(); return renamePath(entry, path); }
  if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); return these.length > 1 ? clipPaths(these, true) : clip(entry, path, true); }
  if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); return these.length > 1 ? clipPaths(these, false) : clip(entry, path, false); }
  if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); return setPicked(f, pickable(f).map((r) => r.dataset.file)); }
  if (e.key === "m" || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    const r = row.getBoundingClientRect();
    openMenu(r.left + 40, r.bottom, entryMenu(entry, path, f));
  }
}

function selectRow(row, f) {
  setPicked(f, row ? [row.dataset.file] : []);
  f.anchor = row?.dataset.file || null;
}

// ------------------------------------------------------------- picking

// Picked files: a click picks one, Ctrl (⌘) and a click adds one or takes
// it away, Shift and a click everything from the last one you clicked to
// it; dragging across the list's empty part picks what the box touches.
// Places (in My Computer's top level) can't be picked with others.
// Neither can Root's own folders (backup, containers, dev: kept, like the places).
const pickable = (f) => [...f.part("list").querySelectorAll(".file-row[data-file]:not([data-place]):not([data-kept])")];
const pickedPaths = (f) => [...f.part("list").querySelectorAll(".file-row.selected[data-file]")].map((r) => r.dataset.file);

function setPicked(f, paths) {
  f.sel = new Set(paths);
  for (const r of f.part("list").querySelectorAll(".file-row")) r.classList.toggle("selected", f.sel.has(r.dataset.file));
}

function pickRow(row, f, e) {
  const path = row.dataset.file;
  if (row.dataset.place || row.dataset.kept) { setPicked(f, [path]); f.anchor = null; return; }
  const rows = pickable(f);
  if (e.shiftKey && f.anchor && rows.some((r) => r.dataset.file === f.anchor)) {
    const a = rows.findIndex((r) => r.dataset.file === f.anchor), b = rows.indexOf(row);
    const span = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.dataset.file);
    setPicked(f, e.ctrlKey || e.metaKey ? [...new Set([...(f.sel || []), ...span])] : span);
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    const now = new Set(f.sel || []);
    if (now.has(path)) now.delete(path); else now.add(path);
    setPicked(f, [...now]);
  } else setPicked(f, [path]);
  f.anchor = path;
}

// Several picked: copy, cut or delete all of them.
function manyMenu(paths, f) {
  const n = `${paths.length} items`;
  return [
    { label: `Copy ${n}`, run: () => clipPaths(paths, true) },
    ...(f.writable ? [{ label: `Cut ${n}`, run: () => clipPaths(paths, false) },
      { label: `Delete ${n}`, run: () => deletePaths(paths), destructive: true }] : []),
  ];
}

// The box you drag across the empty part of a list (or the desktop): what
// it touches is picked (with Ctrl, ⌘ or Shift held: added to what was). A
// list scrolls along when you drag past its edge. Its click on nothing
// picks nothing. items(): the things it can pick; set(nodes): pick them.
function dragBox(e, area, items, set, picked) {
  if (e.button !== 0 || e.pointerType === "touch") return;
  const adding = e.ctrlKey || e.metaKey || e.shiftKey;
  const before = adding ? picked() : [];
  const x0 = e.clientX, y0 = e.clientY + area.scrollTop;
  let box = null, last = e, raf = 0;
  const draw = () => {
    raf = 0;
    const a = area.getBoundingClientRect();
    const x1 = Math.max(a.left, Math.min(a.right, last.clientX)), y1 = Math.max(a.top, Math.min(a.bottom, last.clientY));
    const ys = y0 - area.scrollTop;
    const r = { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.max(a.top, Math.min(ys, y1)), bottom: Math.min(a.bottom, Math.max(ys, y1)) };
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    const top = Math.min(ys, y1), bottom = Math.max(ys, y1);
    const hit = items().filter((n) => { const b = n.getBoundingClientRect(); return b.right > r.left && b.left < r.right && b.bottom > top && b.top < bottom; });
    set([...new Set([...before, ...hit])]);
    // Past the edge of a list that scrolls: it scrolls along.
    const edge = last.clientY < a.top + 24 ? -12 : last.clientY > a.bottom - 24 ? 12 : 0;
    if (edge && area.scrollHeight > area.clientHeight) { area.scrollTop += edge; raf = requestAnimationFrame(draw); }
  };
  const move = (m) => {
    last = m;
    if (!box) {
      if (Math.hypot(m.clientX - x0, m.clientY - (y0 - area.scrollTop)) < 4) return;
      box = el("div", { class: "drag-box", "aria-hidden": "true" });
      document.body.append(box);
      document.body.classList.add("drag-boxing");
    }
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    cancelAnimationFrame(raf);
    document.body.classList.remove("drag-boxing");
    if (box) { box.remove(); dragBox.justDid = Date.now(); } else if (!adding) set([]);
    // The keys (Delete, Ctrl+C…) go where the picking was.
    if (!area.hasAttribute("tabindex")) area.tabIndex = -1;
    area.focus({ preventScroll: true });
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

function entryMenu(entry, path, f) {
  if (entry.outside) return [{ label: "Can't open: it leads outside this place", run: () => {} }];
  const items = [{ label: "Open", run: () => openEntry(entry, path, f) }];
  if (entry.dir && desktopMode()) items.push({ label: "Open in a new window", run: () => newFilesWindow(path) });
  if (entry.place || entry.kept) return items; // a place itself, or Root's own folder: open it, nothing else
  if (entry.kind === "text" || (!entry.dir && entry.size < 2 * 1024 * 1024 && entry.kind === "file")) {
    items.push({ label: "Open in Notepad", run: () => editFile(path) });
  }
  if (!entry.dir) items.push({ label: "Download", run: () => downloadFile(path) });
  items.push({ label: "Copy", run: () => clip(entry, path, true) });
  if (f.writable) {
    items.push({ label: "Cut", run: () => clip(entry, path, false) });
    items.push({ label: "Rename…", run: () => renamePath(entry, path) });
    items.push({ label: "Delete", run: () => deletePaths([path]), destructive: true });
  }
  return items;
}

// A folder opens in this window (from the desktop: the one in front, if
// one's open); a text file in Notepad (Markdown: Luna's quick look); a
// song or a playlist in Music; the rest in windows of their own.
function openEntry(entry, path, f = null) {
  if (entry.outside) return toast("That link leads outside its place, so adlerOS won't open it.");
  if (entry.dir) {
    const into = f || (filesOpen() ? frontFiles() : null);
    return into ? showFolder(path, into) : openFiles(path);
  }
  if (/\.m3u8?$/i.test(entry.name)) return musicPlayListFile(path); // a playlist: in Music
  if (/\.(pls|strm)$/i.test(entry.name)) return musicStationFile(path); // a radio station's: added to Music's, and played
  if (entry.kind === "text") return openNotepad(path);
  if (entry.kind === "audio") return playSong(entry, path); // in Music
  if (["image", "video", "pdf"].includes(entry.kind)) return viewFile(entry, path);
  return downloadFile(path);
}

function downloadFile(path) {
  const a = el("a", { href: fileUrl(path, false), download: "" });
  document.body.append(a);
  a.click();
  a.remove();
}

// A picture, a video or a PDF opens in a window of its own (one you can
// resize, in desktop mode), so the rest of adlerOS stays usable; over the
// home screen it floats over My Computer. The next one takes its place.
function viewFile(entry, path) {
  const url = fileUrl(path, true);
  const media = entry.kind === "image" ? el("img", { src: url, alt: entry.name })
    : entry.kind === "video" ? el("video", { src: url, controls: "", autoplay: "" })
    : el("iframe", { src: url, title: entry.name }); // the browser's own PDF viewer
  $("viewer-body").replaceChildren(media);
  $("viewer").dataset.path = path;
  $("viewer-title").textContent = entry.name;
  titleWindow("viewer", entry.name);
  openWindow("viewer");
}

function closeViewer() {
  $("viewer-body").replaceChildren(); // a video stops
  closeWindow("viewer");
}

// ------------------------------------------------------------- changing

function nameDialog({ title, value = "", button }) {
  return new Promise((resolve) => {
    const input = el("input", { class: "field-input wide-input", type: "text", value, spellcheck: "false", autocapitalize: "off" });
    const ok = el("button", { type: "submit", class: "button-primary wide" }, button);
    const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
    let answered = false;
    const finish = (v) => { answered = true; closeModal(); resolve(v); };
    const form = el("form", {}, input);
    form.addEventListener("submit", (e) => { e.preventDefault(); if (input.value.trim()) finish(input.value.trim()); });
    ok.addEventListener("click", () => form.requestSubmit());
    cancel.addEventListener("click", () => finish(null));
    openModal(el("div", { class: "dialog material", role: "dialog", "aria-modal": "true" }, el("h2", {}, title), form,
      el("div", { class: "dialog-actions" }, cancel, ok)), { onClose: () => { if (!answered) resolve(null); } });
    input.focus();
    // Rename: select the name, not the extension.
    const dot = value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  });
}

// Changing Root: once per admin session, a warning first.
async function rootOk(paths) {
  if (!paths.some((p) => placeOf(p) === "root") || files.rootOk) return true;
  const ok = await confirmDialog({
    title: "Change your homelab's own files?",
    body: "Root holds your apps' compose files and settings. A wrong change can stop them, and adlerOS can't undo it for you (deleted things do go to the Trash). Prefer git and the terminal when you can.",
    button: "Change it anyway", destructive: true,
  });
  if (ok) files.rootOk = true;
  return ok;
}

// A change: done at once (200), or by the helper (202, Root), which we wait for.
async function filesPost(what, body) {
  const { status, body: reply } = await api(`/api/files/${what}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => ({ status: 0 }));
  if (status === 401) {
    showLock();
    return null;
  }
  if (status === 202 && reply?.job) {
    toast("Working on it…");
    const job = await waitForJob(reply.job);
    const result = job?.result;
    if (job?.status === "done" && result && !result.error) return result;
    if (result?.conflict) return { conflict: true };
    toast(result?.error || job?.error || "That didn't work.");
    return null;
  }
  if (status === 409 && reply?.conflict) return { conflict: true };
  if (status === 409 && reply?.exists) return { exists: true };
  if (status !== 200) {
    toast(reply?.error || "That didn't work.");
    return null;
  }
  return reply;
}

async function newFolder(dir = frontFiles().path) {
  if (!(await rootOk([dir]))) return;
  const name = await nameDialog({ title: "New folder", button: "Create" });
  if (name && await filesPost("mkdir", { path: dir, name })) refreshFiles();
}

async function newTextFile(dir = frontFiles().path) {
  if (!(await rootOk([dir]))) return;
  const name = await nameDialog({ title: "New text file", value: "untitled.txt", button: "Create" });
  if (!name) return;
  const reply = await filesPost("text", { path: join(dir, name), text: "" });
  if (!reply) return;
  refreshFiles();
  openNotepad(reply.path || join(dir, name));
}

async function renamePath(entry, path) {
  if (!(await rootOk([path]))) return;
  const name = await nameDialog({ title: `Rename ${entry.name}`, value: entry.name, button: "Rename" });
  if (name && name !== entry.name && await filesPost("rename", { path, name })) refreshFiles();
}

async function deletePaths(paths) {
  if (!(await rootOk(paths))) return;
  const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} items`;
  const ok = await confirmDialog({ title: `Delete ${label}?`, body: "It goes to the Trash, where you can restore it until you empty it.", button: "Delete", destructive: true });
  if (ok && await filesPost("delete", { paths })) {
    toast(`${label} moved to the Trash.`);
    refreshFiles();
  }
}

// Whatever shows files (every My Computer window, the desktop) looks again.
function refreshFiles() {
  for (const f of fileWins.values()) if (isOpen(f.id) && f.view === "folder") showFolder(f.path, f);
  if (typeof refreshDesk === "function") refreshDesk();
}

// --------------------------------------------------- cut, copy and paste

function clip(entry, path, copy) {
  files.clip = { paths: [path], label: entry.name, copy };
  toast(`${copy ? "Copied" : "Cut"} ${entry.name}. Go to a folder and paste it there (Ctrl+V).`);
  for (const f of fileWins.values()) renderTools(f);
}

function clipPaths(paths, copy) {
  if (paths.length === 1) return clip({ name: paths[0].split("/").pop() }, paths[0], copy);
  files.clip = { paths, label: `${paths.length} items`, copy };
  toast(`${copy ? "Copied" : "Cut"} ${paths.length} items. Go to a folder and paste them there (Ctrl+V).`);
  for (const f of fileWins.values()) renderTools(f);
}

async function paste(into = frontFiles().path, f = frontFiles()) {
  const c = files.clip;
  if (!c) return;
  if (!(await rootOk([into, ...(c.copy ? [] : c.paths)]))) return;
  const reply = await filesPost(c.copy ? "copy" : "move", { paths: c.paths, to: into });
  if (!reply) return;
  if (!c.copy) files.clip = null;
  if (reply.task) watchTask(reply.task, f);
  else toast(c.copy ? `Copied ${c.label}.` : `Moved ${c.label}.`);
  refreshFiles();
}

// A long copy or move: its progress under the window's list, until it's done.
function watchTask(task, f = frontFiles()) {
  if (files.tasks.has(task.id)) return;
  const line = el("div", { class: "upload" }, el("span", { class: "upload-name" }, task.label), el("span", { class: "upload-pct" }, "…"));
  f.part("uploads").append(line);
  files.tasks.set(task.id, line);
  if (files.tasks.size === 1) pollTasks();
}

async function pollTasks() {
  while (files.tasks.size) {
    await new Promise((r) => setTimeout(r, 700));
    const { status, body } = await api("/api/files/tasks").catch(() => ({ status: 0 }));
    if (status !== 200) continue;
    for (const [id, line] of files.tasks) {
      const task = body.tasks.find((t) => t.id === id);
      if (!task || task.status === "running") {
        if (task?.total) line.lastChild.textContent = `${Math.floor((100 * task.done) / task.total)}%`;
        continue;
      }
      line.remove();
      files.tasks.delete(id);
      toast(task.status === "done" ? `${task.label.replace(/^(Copying|Moving)/, (w) => (w === "Copying" ? "Copied" : "Moved"))}.` : `${task.label}: ${task.error || "it didn't work"}`);
      refreshFiles();
    }
  }
}

// --------------------------------------------------------------- upload

function uploadFiles(list, dir = frontFiles().path, f = frontFiles()) {
  if (placeOf(dir) === "root") return toast("Root takes no uploads: upload to the Desktop or User, then move it.");
  for (const file of list) {
    const status = el("div", { class: "upload" }, el("span", { class: "upload-name" }, file.name), el("span", { class: "upload-pct" }, "0%"));
    f.part("uploads").append(status);
    files.uploads++;
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) status.lastChild.textContent = `${Math.round((100 * e.loaded) / e.total)}%`;
    };
    xhr.onloadend = () => {
      files.uploads--;
      status.remove();
      if (xhr.status === 401) return showLock();
      if (xhr.status !== 200) {
        let error = "it didn't work";
        try { error = JSON.parse(xhr.responseText).error || error; } catch { /* not JSON */ }
        return toast(`${file.name}: ${error}`);
      }
      for (const w of fileWins.values()) if (isOpen(w.id) && w.path === dir && w.view === "folder") showFolder(dir, w);
      if (typeof refreshDesk === "function" && placeOf(dir) === "desktop") refreshDesk();
    };
    xhr.send(file);
  }
}

// ---------------------------------------------------------------- trash

async function showTrash(f, { remember = true } = {}) {
  const { status, body } = await api("/api/files/trash").catch(() => ({ status: 0 }));
  if (status !== 200) return toast("Can't open the Trash.");
  if (remember && f.shown && f.view !== "trash") filesWent(f, filesHere(f));
  f.view = "trash";
  f.trash = body.items;
  renderFiles(f);
}

function fromLabel(from) {
  const parts = from.split("/").filter(Boolean);
  return [PLACE_NAMES[parts[0]] || parts[0], ...parts.slice(1, -1)].join(" / ");
}

function renderTrash(f) {
  f.part("crumbs").replaceChildren(el("span", { class: "crumb current" }, "Trash"));
  f.part("up").disabled = false;
  const rows = f.trash.map((item) => {
    const restore = el("button", { type: "button", class: "chip-button" }, "Restore");
    restore.addEventListener("click", async () => {
      if (!(await rootOk([item.from]))) return;
      if (await filesPost("restore", { ids: [item.id] })) {
        toast(`${item.name} is back in ${fromLabel(item.from)}.`);
        showTrash(f);
      }
    });
    return el("div", { class: "file-row trash-row" },
      el("span", { class: `file-icon ${item.dir ? "folder" : "file"}` }, svg(FILE_ICONS[item.dir ? "folder" : "file"])),
      el("span", { class: "file-name" }, item.name, el("span", { class: "file-from" }, `from ${fromLabel(item.from)}`)),
      el("span", { class: "file-date" }, when(item.deleted)), restore);
  });
  const empty = el("button", { type: "button", class: "chip-button destructive" }, "Empty Trash");
  empty.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Empty the Trash?", body: "Everything in it is deleted for good.", button: "Empty Trash", destructive: true });
    if (ok && await filesPost("empty-trash", {})) showTrash(f);
  });
  f.part("list").replaceChildren(...(rows.length ? [...rows, el("div", { class: "trash-actions" }, empty)] : [el("p", { class: "no-results" }, "The Trash is empty.")]));
}

// ------------------------------------------------------------ in Notepad

// A text file is Notepad's (a Markdown one, Luna's quick look):
// Edit as text from the menus, the desktop's too.
function editFile(path) { return openNotepad(path, { markdown: false }); }

// ------------------------------------------------- dragging a file away

// With a mouse: drop it on a folder in the list, a place down the side, the
// Trash, another My Computer window (into its folder), or (desktop mode)
// the desktop. From a folder you can't change (Root), it's a copy;
// otherwise it moves.
const fileDrag = { row: null, suppress: false };

function fileDown(e) {
  const row = e.target.closest(".files-list .file-row[data-file]");
  const f = fileWinOf(row);
  if (!row || !f || row.dataset.place || row.dataset.kept || e.button !== 0 || e.pointerType !== "mouse" || f.view !== "folder") return;
  Object.assign(fileDrag, { row, f, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, over: null });
}

function fileDropTarget(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const w = fileWinOf(under);
  const row = under?.closest(".files-list .file-row[data-dir]");
  if (row && row !== fileDrag.row) return { node: row, to: row.dataset.file };
  const place = under?.closest(".files-side [data-path]");
  if (place) return { node: place, to: place.dataset.path };
  const trash = under?.closest(".files-side [data-trash]");
  if (trash && fileDrag.f.writable) return { node: trash, trash: true };
  const list = under?.closest(".files-list");
  if (list && w && w !== fileDrag.f && w.view === "folder" && w.path !== "/") return { node: list, to: w.path };
  const icon = under?.closest("#desk .desk-icon");
  const entry = icon && desk.entries.find((x) => `/desktop/${x.name}` === icon.dataset.file);
  if (entry?.dir) return { node: icon, to: icon.dataset.file };
  if (under?.closest("#desk") && desktopMode()) return { desk: true, to: "/desktop" };
  return {};
}

function fileMove(e) {
  const d = fileDrag;
  if (!d.row || e.pointerId !== d.pointerId) return;
  if (!d.active) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.active = true;
    // A picked one: all that are picked go with it.
    const many = d.row.classList.contains("selected") ? pickedPaths(d.f) : [];
    d.paths = many.length > 1 ? many : [d.row.dataset.file];
    d.ghost = el("div", { class: "file-ghost material" }, d.row.querySelector(".file-icon").cloneNode(true),
      el("span", {}, d.paths.length > 1 ? `${d.paths.length} items` : d.row.querySelector(".file-name").firstChild?.textContent || ""));
    document.body.append(d.ghost);
    d.row.classList.add("drag-source");
    try { d.row.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  }
  d.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
  const t = fileDropTarget(e);
  d.over?.classList.remove("drop-target");
  d.over = t.node || null;
  d.over?.classList.add("drop-target");
  $("desk").classList.toggle("dropping", Boolean(t.desk));
}

async function fileUp(e) {
  if (!fileDrag.row || e.pointerId !== fileDrag.pointerId) return;
  const d = { ...fileDrag }; // a copy: the drag's over (fileDrag.row cleared), its row still needed here
  fileDrag.row = null;
  if (!d.active) return;
  d.ghost.remove();
  d.row.classList.remove("drag-source");
  d.over?.classList.remove("drop-target");
  $("desk").classList.remove("dropping");
  fileDrag.suppress = true; // the click this makes shouldn't open it
  setTimeout(() => { fileDrag.suppress = false; }, 0);
  const t = fileDropTarget(e);
  const path = d.row.dataset.file;
  const paths = (d.paths || [path]).filter((p) => p !== t.to);
  const name = paths.length > 1 ? `${paths.length} items` : path.split("/").pop();
  if (t.trash) return deletePaths(paths);
  if (!t.to || t.to === parentOf(path) || !paths.length) return;
  if (!(await rootOk([t.to, ...(d.f.writable ? paths : [])]))) return;
  const copy = !d.f.writable;
  const reply = await filesPost(copy ? "copy" : "move", { paths, to: t.to });
  if (!reply) return;
  if (t.desk && paths.length === 1) rememberDeskPlace(name, deskCellAt(e.clientX, e.clientY));
  if (reply.task) watchTask(reply.task, d.f);
  else toast(`${copy ? "Copied" : "Moved"} ${name} to ${t.desk ? "the Desktop" : fromLabel(`${t.to}/x`) || "it"}.`);
  refreshFiles();
}

// ---------------------------------------------------------------- wiring

// A window's own buttons, list and drops.
function wireFiles(f) {
  const front = () => { fileFront = f; };
  f.section.addEventListener("pointerdown", front, true);
  f.section.addEventListener("focusin", front);
  f.part("close").addEventListener("click", () => closeFiles(f));
  f.part("sort").addEventListener("change", () => setFilesSort({ by: f.part("sort").value }));
  f.part("order").addEventListener("click", () => setFilesSort({ desc: !filesSort().desc }));
  f.part("list").addEventListener("pointerdown", fileDown);
  f.part("list").addEventListener("pointerdown", (e) => {
    if (e.target.closest(".file-row, button, a, input") || f.view !== "folder") return;
    dragBox(e, f.part("list"), () => pickable(f), (rows) => setPicked(f, rows.map((r) => (r.dataset ? r.dataset.file : r))), () => [...pickable(f)].filter((r) => r.classList.contains("selected")));
  });
  f.part("list").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && f.view === "folder" && !e.target.matches("input, textarea")) {
      e.preventDefault();
      setPicked(f, pickable(f).map((r) => r.dataset.file));
    }
  });
  f.part("list").addEventListener("click", (e) => {
    if (!fileDrag.suppress) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  f.part("up").addEventListener("click", () => {
    if (f.view !== "folder") return showFolder(f.path, f);
    showFolder(parentOf(f.path), f);
  });
  f.part("new-folder").addEventListener("click", () => newFolder(f.path));
  f.part("new-file").addEventListener("click", () => newTextFile(f.path));
  f.part("paste").addEventListener("click", () => paste(f.path, f));
  f.part("hidden").addEventListener("click", () => {
    files.showHidden = !files.showHidden;
    try { localStorage.setItem(HIDDEN_KEY, files.showHidden ? "1" : "0"); } catch { /* not kept */ }
    for (const w of fileWins.values()) if (isOpen(w.id)) renderFiles(w);
  });
  f.part("upload").addEventListener("click", () => {
    files.uploadTo = null;
    f.part("picker").click();
  });
  // The first window's picker is the desktop's too: its Upload… sets where.
  f.part("picker").addEventListener("change", (e) => {
    uploadFiles(e.target.files, files.uploadTo || f.path, f);
    files.uploadTo = null;
    e.target.value = "";
  });
  const drop = f.section;
  drop.addEventListener("dragover", (e) => {
    if (f.view !== "folder" || !f.writable || f.place === "root" || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    drop.classList.add("dropping");
  });
  drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("dropping"); });
  drop.addEventListener("drop", (e) => {
    drop.classList.remove("dropping");
    if (f.view !== "folder" || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    uploadFiles(e.dataTransfer.files, f.path, f);
  });
  // Delete, Ctrl+C, Ctrl+X: whatever's picked (a row with the focus has its own keys).
  drop.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || f.view !== "folder" || e.target.matches("textarea, input, select")) return;
    const kept = new Set([...f.part("list").querySelectorAll(".file-row[data-kept], .file-row[data-place]")].map((r) => r.dataset.file));
    const picked = pickedPaths(f).filter((p) => p.split("/").filter(Boolean).length > 1 && !kept.has(p)); // a place itself (/user), Root's own folders: never
    if (!picked.length) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Delete" && f.writable) { e.preventDefault(); deletePaths(picked); }
    else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); clipPaths(picked, true); }
    else if (mod && e.key.toLowerCase() === "x" && f.writable) { e.preventDefault(); clipPaths(picked, false); }
  });
  // Ctrl+V in the window pastes into the folder you're in.
  drop.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && files.clip && f.view === "folder" && !e.target.matches("textarea, input")) {
      e.preventDefault();
      paste(f.path, f);
    }
  });
}

const firstFiles = makeFileWin("files", $("files"));
registerWindow("files", { title: "My Computer", close: () => closeFiles(firstFiles), dock: "files", size: [980, 640] });
registerWindow("viewer", { title: "Viewer", close: closeViewer, size: [980, 680], float: true });
$("viewer-close").addEventListener("click", closeViewer);
$("viewer-download").addEventListener("click", () => downloadFile($("viewer").dataset.path));
document.addEventListener("pointermove", fileMove);
document.addEventListener("pointerup", fileUp);
document.addEventListener("pointercancel", fileUp);
// Escape: the viewer first; then out of the Trash, then out of the My
// Computer window in front.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isActive("viewer") && $("modal").hidden && $("menu").hidden) {
    e.stopImmediatePropagation(); // the viewer first, My Computer behind it stays
    return closeViewer();
  }
  const f = [...fileWins.values()].find((w) => isActive(w.id));
  if (e.key !== "Escape" || !f || !$("modal").hidden || !$("menu").hidden) return;
  e.stopImmediatePropagation();
  if (f.view === "trash") showFolder(f.path, f);
  else closeFiles(f);
}, true);
window.addEventListener("beforeunload", (e) => {
  if ([...pads.values()].some((p) => p.dirty) || files.uploads || files.tasks.size) e.preventDefault();
});
