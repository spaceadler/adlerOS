// Files: three places in a window. Desktop (a homelab's mailbox/) and User
// (your storage folder) you can change: upload (button or drop), download,
// make folders, rename, cut, copy and paste between them, delete into the
// Trash (and restore), edit text files. Root is the homelab's own folder:
// read-only, except in admin mode when the machine allows it, and even then
// it warns you first. Nothing outside the three places is reachable.
// Uses $, el, svg, api, toast, state, isOpen, isActive, openWindow,
// closeWindow, openModal, closeModal, confirmDialog, openMenu, bytes,
// waitForJob, showLock.
"use strict";

const files = {
  path: "/user", place: "user", places: [], entries: [], view: "folder", editor: null, uploads: 0,
  writable: true, admin: false, rootAllowed: false, clip: null, tasks: new Map(), rootOk: false,
  showHidden: false,
};
// Hidden files (.env, .gitignore…): shown only in admin mode, and only when
// you ask (this browser remembers); off to begin with.
const HIDDEN_KEY = "adleros.showHidden";
try { files.showHidden = localStorage.getItem(HIDDEN_KEY) === "1"; } catch { /* private window */ }
const hiddenShown = () => files.admin && files.showHidden;

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

function filesOpen() { return isOpen("files"); }

function toggleFiles() { toggleWindow("files", () => openFiles()); }

async function openFiles(path) {
  openWindow("files");
  await showFolder(path || files.path);
  ($("files-list").querySelector(".file-row") || $("files-up")).focus({ preventScroll: true });
}

async function closeFiles() {
  if (files.editor && files.editor.dirty) {
    const ok = await confirmDialog({ title: "Close without saving?", body: `Your changes to ${files.editor.name} will be lost.`, button: "Close", destructive: true });
    if (!ok) return;
  }
  files.editor = null;
  closeWindow("files");
}

// --------------------------------------------------------------- folder

async function showFolder(path) {
  const { status, body } = await api(`/api/files?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status === 404 && body?.error === "no storage folder is mounted") {
    files.view = "folder";
    files.entries = [];
    $("files-side").replaceChildren();
    $("files-list").replaceChildren(el("p", { class: "store-error" }, "adlerOS can't see a storage folder. Set STORAGE_DIR (in .env, or homelab.env) and run ./install.sh again."));
    return;
  }
  if (status !== 200) {
    toast(body?.error || "Can't open that folder.");
    if (path !== "/user" && path !== "/") return showFolder(files.places.length ? `/${files.places[0].place}` : "/");
    return;
  }
  Object.assign(files, {
    view: "folder", editor: null, path: body.path, place: body.place, places: body.places, entries: body.entries,
    writable: body.writable, admin: Boolean(body.admin), rootAllowed: Boolean(body.rootAllowed),
  });
  if (!files.admin) files.rootOk = false; // the warning again, next time admin mode is on

  renderFiles();
}

function crumbs() {
  const parts = files.path.split("/").filter(Boolean);
  const nodes = [];
  parts.forEach((part, i) => {
    const b = el("button", { type: "button", class: "crumb" }, i === 0 ? PLACE_NAMES[part] || part : part);
    b.addEventListener("click", () => showFolder(`/${parts.slice(0, i + 1).join("/")}`));
    if (i) nodes.push(el("span", { class: "crumb-sep", "aria-hidden": "true" }, "/"));
    nodes.push(b);
  });
  return nodes.length ? nodes : [el("span", { class: "crumb current" }, "Files")];
}

function renderPlaces() {
  const item = (id, label, current, run) => {
    const b = el("button", { type: "button", class: `files-place${current ? " current" : ""}`, "aria-current": current ? "true" : "false",
      ...(id === "trash" ? { "data-trash": "1" } : { "data-path": `/${id}` }) },
      el("span", { class: "files-place-icon", "aria-hidden": "true" }, svg(PLACE_ICONS[id])), el("span", {}, label));
    b.addEventListener("click", run);
    return b;
  };
  $("files-side").replaceChildren(
    ...files.places.map((p) => item(p.place, p.name, files.view === "folder" && files.place === p.place, () => showFolder(`/${p.place}`))),
    item("trash", "Trash", files.view === "trash", showTrash));
}

// What Root says about itself: look, don't touch (and how to, if you must).
function renderNote() {
  const note = $("files-note");
  if (files.view !== "folder" || files.place !== "root") {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  note.classList.toggle("warn", files.writable);
  note.textContent = files.writable
    ? "Admin mode: you can change Root, your homelab's own files. A wrong edit here can stop your apps; git and the terminal are safer."
    : !files.admin
      ? "Root is your homelab's own folder: look around, copy things out. It's read-only; changing it needs admin mode."
      : "Root is read-only on this machine. Changing it also needs ADLEROS_TERMINAL=on (like the terminal).";
}

function renderFiles() {
  $("files").classList.toggle("editing", files.view === "editor");
  renderPlaces();
  renderNote();
  renderTools();
  if (files.view === "trash") return renderTrash();
  if (files.view === "editor") return;
  $("files-crumbs").replaceChildren(...crumbs());
  $("files-up").disabled = files.path.split("/").filter(Boolean).length < 2;
  const rows = files.entries.filter((e) => hiddenShown() || !e.name.startsWith(".")).map((entry) => {
    const path = entry.place && files.path === "/" ? `/${entry.place}` : join(files.path, entry.name);
    const row = el("button", { type: "button", class: `file-row${entry.outside ? " outside" : ""}`, "data-file": path,
      ...(entry.dir ? { "data-dir": "1" } : {}), ...(entry.place ? { "data-place": entry.place } : {}),
      title: entry.outside ? "A link to somewhere outside this place" : entry.place ? `${entry.name}: your ${PLACE_NAMES[entry.place]}` : entry.name },
    el("span", { class: `file-icon ${entry.kind}` }, svg(entry.place ? PLACE_ICONS[entry.place] : FILE_ICONS[entry.kind] || FILE_ICONS.file)),
    el("span", { class: "file-name" }, entry.name, entry.place && files.path !== "/" ? el("span", { class: "file-from" }, `Your ${PLACE_NAMES[entry.place]}`) : ""),
    el("span", { class: "file-size" }, entry.dir ? "" : bytes(entry.size)),
    el("span", { class: "file-date" }, entry.mtime ? when(entry.mtime) : ""));
    // A click picks it, a double click opens it, like any file manager. Enter
    // (a click with no mouse in it) and a tap on a touch screen open it too.
    row.addEventListener("click", (e) => {
      if (e.detail === 0 || matchMedia("(pointer: coarse)").matches) return openEntry(entry, path);
      selectRow(row);
    });
    row.addEventListener("dblclick", () => openEntry(entry, path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, entryMenu(entry, path));
    });
    row.addEventListener("keydown", (e) => entryKeys(e, entry, path, row));
    return row;
  });
  const empty = files.writable ? "Empty. Drop files here, or Upload." : "Empty.";
  $("files-list").replaceChildren(...(rows.length ? rows : [el("p", { class: "no-results" }, empty)]));
}

function renderTools() {
  const inFolder = files.view === "folder" && files.path !== "/";
  const canChange = inFolder && files.writable;
  $("files-new-folder").hidden = $("files-new-file").hidden = !canChange;
  $("files-upload").hidden = !canChange || files.place === "root";
  const hidden = $("files-hidden");
  hidden.hidden = !inFolder || !files.admin;
  hidden.textContent = files.showHidden ? "Hide hidden files" : "Show hidden files";
  hidden.setAttribute("aria-pressed", String(files.showHidden));
  const paste = $("files-paste");
  paste.hidden = !files.clip || !canChange;
  if (files.clip) paste.textContent = `${files.clip.copy ? "Paste copy of" : "Move"} ${files.clip.label} here`;
}

// The keys for a file or folder in the list.
function entryKeys(e, entry, path, row) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Delete") { e.preventDefault(); return deletePaths([path]); }
  if (e.key === "F2") { e.preventDefault(); return renamePath(entry, path); }
  if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); return clip(entry, path, true); }
  if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); return clip(entry, path, false); }
  if (e.key === "m" || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    const r = row.getBoundingClientRect();
    openMenu(r.left + 40, r.bottom, entryMenu(entry, path));
  }
}

function selectRow(row) {
  for (const r of $("files-list").querySelectorAll(".file-row.selected")) r.classList.remove("selected");
  row?.classList.add("selected");
}

function entryMenu(entry, path) {
  if (entry.outside) return [{ label: "Can't open: it leads outside this place", run: () => {} }];
  const items = [{ label: "Open", run: () => openEntry(entry, path) }];
  if (entry.place) return items; // a place itself: open it, nothing else
  if (entry.kind === "text" || (!entry.dir && entry.size < 2 * 1024 * 1024 && entry.kind === "file")) {
    items.push({ label: files.writable ? "Edit as text" : "View as text", run: () => editFile(path) });
  }
  if (!entry.dir) items.push({ label: "Download", run: () => downloadFile(path) });
  items.push({ label: "Copy", run: () => clip(entry, path, true) });
  if (files.writable) {
    items.push({ label: "Cut", run: () => clip(entry, path, false) });
    items.push({ label: "Rename…", run: () => renamePath(entry, path) });
    items.push({ label: "Delete", run: () => deletePaths([path]), destructive: true });
  }
  return items;
}

function openEntry(entry, path) {
  if (entry.outside) return toast("That link leads outside its place, so adlerOS won't open it.");
  if (entry.dir) return isOpen("files") ? showFolder(path) : openFiles(path);
  if (entry.kind === "text") return editFile(path);
  if (["image", "video", "audio", "pdf"].includes(entry.kind)) return previewFile(entry, path);
  return downloadFile(path);
}

function downloadFile(path) {
  const a = el("a", { href: fileUrl(path, false), download: "" });
  document.body.append(a);
  a.click();
  a.remove();
}

function previewFile(entry, path) {
  if (entry.kind === "pdf") return window.open(fileUrl(path, true), "_blank", "noopener");
  const url = fileUrl(path, true);
  const media = entry.kind === "image" ? el("img", { src: url, alt: entry.name, class: "preview-media" })
    : el(entry.kind, { src: url, controls: "", autoplay: "", class: "preview-media" });
  const close = el("button", { type: "button", class: "button-secondary" }, "Close");
  const download = el("button", { type: "button", class: "button-primary" }, "Download");
  close.addEventListener("click", closeModal);
  download.addEventListener("click", () => downloadFile(path));
  openModal(el("div", { class: "dialog material preview", role: "dialog", "aria-modal": "true", "aria-label": entry.name },
    el("h2", {}, entry.name), media, el("div", { class: "dialog-actions" }, close, download)));
  close.focus();
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
  if (status !== 200) {
    toast(reply?.error || "That didn't work.");
    return null;
  }
  return reply;
}

async function newFolder(dir = files.path) {
  if (!(await rootOk([dir]))) return;
  const name = await nameDialog({ title: "New folder", button: "Create" });
  if (name && await filesPost("mkdir", { path: dir, name })) refreshFiles();
}

async function newTextFile(dir = files.path) {
  if (!(await rootOk([dir]))) return;
  const name = await nameDialog({ title: "New text file", value: "untitled.txt", button: "Create" });
  if (!name) return;
  const reply = await filesPost("text", { path: join(dir, name), text: "" });
  if (!reply) return;
  refreshFiles();
  editFile(reply.path || join(dir, name));
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

// Whatever shows files (the window, the desktop) looks again.
function refreshFiles() {
  if (filesOpen() && files.view === "folder") showFolder(files.path);
  if (typeof refreshDesk === "function") refreshDesk();
}

// --------------------------------------------------- cut, copy and paste

function clip(entry, path, copy) {
  files.clip = { paths: [path], label: entry.name, copy };
  toast(`${copy ? "Copied" : "Cut"} ${entry.name}. Go to a folder and paste it there (Ctrl+V).`);
  renderTools();
}

async function paste(into = files.path) {
  const c = files.clip;
  if (!c) return;
  if (!(await rootOk([into, ...(c.copy ? [] : c.paths)]))) return;
  const reply = await filesPost(c.copy ? "copy" : "move", { paths: c.paths, to: into });
  if (!reply) return;
  if (!c.copy) files.clip = null;
  if (reply.task) watchTask(reply.task);
  else toast(c.copy ? `Copied ${c.label}.` : `Moved ${c.label}.`);
  refreshFiles();
}

// A long copy or move: its progress under the list, until it's done.
function watchTask(task) {
  if (files.tasks.has(task.id)) return;
  const line = el("div", { class: "upload" }, el("span", { class: "upload-name" }, task.label), el("span", { class: "upload-pct" }, "…"));
  $("files-uploads").append(line);
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

function uploadFiles(list, dir = files.path) {
  if (placeOf(dir) === "root") return toast("Root takes no uploads: upload to the Desktop or User, then move it.");
  for (const file of list) {
    const status = el("div", { class: "upload" }, el("span", { class: "upload-name" }, file.name), el("span", { class: "upload-pct" }, "0%"));
    $("files-uploads").append(status);
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
      if (filesOpen() && files.path === dir && files.view === "folder") showFolder(dir);
      if (typeof refreshDesk === "function" && placeOf(dir) === "desktop") refreshDesk();
    };
    xhr.send(file);
  }
}

// ---------------------------------------------------------------- trash

async function showTrash() {
  const { status, body } = await api("/api/files/trash").catch(() => ({ status: 0 }));
  if (status !== 200) return toast("Can't open the Trash.");
  files.view = "trash";
  files.trash = body.items;
  renderFiles();
}

function fromLabel(from) {
  const parts = from.split("/").filter(Boolean);
  return [PLACE_NAMES[parts[0]] || parts[0], ...parts.slice(1, -1)].join(" / ");
}

function renderTrash() {
  $("files-crumbs").replaceChildren(el("span", { class: "crumb current" }, "Trash"));
  $("files-up").disabled = false;
  const rows = files.trash.map((item) => {
    const restore = el("button", { type: "button", class: "chip-button" }, "Restore");
    restore.addEventListener("click", async () => {
      if (!(await rootOk([item.from]))) return;
      if (await filesPost("restore", { ids: [item.id] })) {
        toast(`${item.name} is back in ${fromLabel(item.from)}.`);
        showTrash();
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
    if (ok && await filesPost("empty-trash", {})) showTrash();
  });
  $("files-list").replaceChildren(...(rows.length ? [...rows, el("div", { class: "trash-actions" }, empty)] : [el("p", { class: "no-results" }, "The Trash is empty.")]));
}

// --------------------------------------------------------------- editor

async function editFile(path) {
  const { status, body } = await api(`/api/files/text?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) return toast(body?.error || "Can't open that file.");
  if (!filesOpen()) {
    openWindow("files");
    files.path = parentOf(body.path);
  }
  files.view = "editor";
  files.editor = { path: body.path, name: body.path.split("/").pop(), mtime: body.mtime, dirty: false, writable: body.writable };
  const area = $("editor-text");
  area.value = body.text;
  area.readOnly = !body.writable;
  $("editor-name").textContent = files.editor.name;
  $("editor-path").textContent = body.path;
  $("editor-save").hidden = !body.writable;
  setDirty(false);
  renderFiles();
  area.focus();
  area.setSelectionRange(0, 0);
  area.scrollTop = 0;
}

function setDirty(dirty) {
  if (!files.editor) return;
  files.editor.dirty = dirty;
  $("editor-state").textContent = !files.editor.writable ? "Read-only" : dirty ? "Not saved" : "Saved";
  $("editor-state").classList.toggle("dirty", dirty);
}

async function saveFile(overwrite = false) {
  const ed = files.editor;
  if (!ed || !ed.writable) return;
  if (!(await rootOk([ed.path]))) return;
  const reply = await filesPost("text", { path: ed.path, text: $("editor-text").value, mtime: overwrite ? undefined : ed.mtime });
  if (reply?.conflict) {
    const ok = await confirmDialog({ title: `${ed.name} changed`, body: "Something else changed it since you opened it. Save yours over it anyway?", button: "Overwrite", destructive: true });
    if (ok) saveFile(true);
    return;
  }
  if (!reply) return;
  ed.mtime = reply.mtime;
  setDirty(false);
  toast(`Saved ${ed.name}.`);
}

async function leaveEditor() {
  if (files.editor?.dirty) {
    const ok = await confirmDialog({ title: "Leave without saving?", body: `Your changes to ${files.editor.name} will be lost.`, button: "Leave", destructive: true });
    if (!ok) return;
  }
  const back = parentOf(files.editor?.path || join(files.path, "x"));
  files.editor = null;
  await showFolder(back);
}

// ------------------------------------------------- dragging a file away

// With a mouse: drop it on a folder in the list, a place down the side, the
// Trash, or (desktop mode) the desktop. From a folder you can't change
// (Root), it's a copy; otherwise it moves.
const fileDrag = { row: null, suppress: false };

function fileDown(e) {
  const row = e.target.closest("#files-list .file-row[data-file]");
  if (!row || row.dataset.place || e.button !== 0 || e.pointerType !== "mouse" || files.view !== "folder") return;
  Object.assign(fileDrag, { row, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, over: null });
}

function fileDropTarget(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const row = under?.closest("#files-list .file-row[data-dir]");
  if (row && row !== fileDrag.row) return { node: row, to: row.dataset.file };
  const place = under?.closest("#files-side [data-path]");
  if (place) return { node: place, to: place.dataset.path };
  const trash = under?.closest("#files-side [data-trash]");
  if (trash && files.writable) return { node: trash, trash: true };
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
    d.ghost = el("div", { class: "file-ghost material" }, d.row.querySelector(".file-icon").cloneNode(true),
      el("span", {}, d.row.querySelector(".file-name").firstChild?.textContent || ""));
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
  const d = fileDrag;
  if (!d.row || e.pointerId !== d.pointerId) return;
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
  const name = path.split("/").pop();
  if (t.trash) return deletePaths([path]);
  if (!t.to || t.to === parentOf(path) || t.to === path) return;
  if (!(await rootOk([t.to, ...(files.writable ? [path] : [])]))) return;
  const copy = !files.writable;
  const reply = await filesPost(copy ? "copy" : "move", { paths: [path], to: t.to });
  if (!reply) return;
  if (t.desk) rememberDeskPlace(name, deskCellAt(e.clientX, e.clientY));
  if (reply.task) watchTask(reply.task);
  else toast(`${copy ? "Copied" : "Moved"} ${name} to ${t.desk ? "the Desktop" : fromLabel(`${t.to}/x`) || "it"}.`);
  refreshFiles();
}

// ---------------------------------------------------------------- wiring

registerWindow("files", { title: "Files", close: closeFiles, dock: "files", size: [980, 640] });
$("files-close").addEventListener("click", closeFiles);
$("files-list").addEventListener("pointerdown", fileDown);
document.addEventListener("pointermove", fileMove);
document.addEventListener("pointerup", fileUp);
document.addEventListener("pointercancel", fileUp);
$("files-list").addEventListener("click", (e) => {
  if (!fileDrag.suppress) return;
  e.preventDefault();
  e.stopPropagation();
}, true);
$("files-up").addEventListener("click", () => {
  if (files.view !== "folder") return showFolder(files.path);
  showFolder(parentOf(files.path));
});
$("files-new-folder").addEventListener("click", () => newFolder());
$("files-new-file").addEventListener("click", () => newTextFile());
$("files-paste").addEventListener("click", () => paste());
$("files-hidden").addEventListener("click", () => {
  files.showHidden = !files.showHidden;
  try { localStorage.setItem(HIDDEN_KEY, files.showHidden ? "1" : "0"); } catch { /* not kept */ }
  renderFiles();
});
$("files-upload").addEventListener("click", () => {
  files.uploadTo = null;
  $("files-picker").click();
});
// The picker is shared: the desktop's Upload… sets where it goes.
$("files-picker").addEventListener("change", (e) => {
  uploadFiles(e.target.files, files.uploadTo || files.path);
  files.uploadTo = null;
  e.target.value = "";
});
const drop = $("files");
drop.addEventListener("dragover", (e) => {
  if (files.view !== "folder" || !files.writable || files.place === "root" || !e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  drop.classList.add("dropping");
});
drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("dropping"); });
drop.addEventListener("drop", (e) => {
  drop.classList.remove("dropping");
  if (files.view !== "folder" || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  uploadFiles(e.dataTransfer.files);
});
// Ctrl+V in the window pastes into the folder you're in.
drop.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && files.clip && files.view === "folder" && !e.target.matches("textarea, input")) {
    e.preventDefault();
    paste();
  }
});
const editorText = $("editor-text");
editorText.addEventListener("input", () => setDirty(true));
editorText.addEventListener("keydown", (e) => {
  // Tab indents, Ctrl+S saves; neither leaves the editor.
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !editorText.readOnly) {
    e.preventDefault();
    e.stopPropagation();
    document.execCommand("insertText", false, "\t") || editorText.setRangeText("\t", editorText.selectionStart, editorText.selectionEnd, "end");
    setDirty(true);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    e.stopPropagation();
    saveFile();
  }
});
$("editor-save").addEventListener("click", () => saveFile());
$("editor-back").addEventListener("click", leaveEditor);
// Escape: out of the editor first, then out of Files.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !isActive("files") || !$("modal").hidden || !$("menu").hidden) return;
  e.stopImmediatePropagation();
  if (files.view === "editor") leaveEditor();
  else if (files.view === "trash") showFolder(files.path);
  else closeFiles();
}, true);
window.addEventListener("beforeunload", (e) => {
  if (files.editor?.dirty || files.uploads || files.tasks.size) e.preventDefault();
});
