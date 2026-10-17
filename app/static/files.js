// Files: your storage folder in a window. Browse, upload (button or drop),
// download, make folders, rename, delete into the Trash (and restore), and
// edit text files. Nothing outside the storage folder is reachable.
// Uses $, el, svg, api, toast, state, isOpen, openModal, closeModal,
// confirmDialog, closeSettings, closeStore, closeUsage, hideTerminal,
// closeDrawer, closeSearch, closeMenu, openMenu, bytes.
"use strict";

const files = { path: "/", entries: [], view: "folder", editor: null, uploads: 0 };

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

const join = (dir, name) => `${dir.replace(/\/$/, "")}/${name}`;
const fileUrl = (path, inline) => `/api/files/raw?path=${encodeURIComponent(path)}&inline=${inline ? 1 : 0}`;

function when(seconds) {
  const d = new Date(seconds * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

// ------------------------------------------------------- open and close

function filesOpen() { return isOpen("files"); }

function toggleFiles() {
  if (filesOpen()) closeFiles();
  else openFiles();
}

async function openFiles(path) {
  closeSearch();
  closeMenu();
  closeDrawer();
  if (isOpen("settings")) closeSettings();
  if (isOpen("store")) closeStore();
  if (isOpen("usage")) closeUsage();
  hideTerminal();
  const sheet = $("files");
  sheet.classList.remove("closing");
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  await showFolder(path || files.path);
  ($("files-list").querySelector(".file-row") || $("files-up")).focus({ preventScroll: true });
}

async function closeFiles() {
  if (files.editor && files.editor.dirty) {
    const ok = await confirmDialog({ title: "Close without saving?", body: `Your changes to ${files.editor.name} will be lost.`, button: "Close", destructive: true });
    if (!ok) return;
  }
  files.editor = null;
  const sheet = $("files");
  if (sheet.hidden) return;
  sheet.classList.add("closing");
  if (!isOpen("settings") && !isOpen("store") && !isOpen("usage") && !isOpen("terminal")) document.body.classList.remove("sheet-open");
  setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("closing");
  }, 280);
}

// --------------------------------------------------------------- folder

async function showFolder(path) {
  const { status, body } = await api(`/api/files?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status === 404 && body?.error === "no storage folder is mounted") {
    files.view = "folder";
    files.entries = [];
    $("files-list").replaceChildren(el("p", { class: "store-error" }, "adlerOS can't see a storage folder. Set STORAGE_DIR (in .env, or homelab.env) and run ./install.sh again."));
    return;
  }
  if (status !== 200) {
    toast(body?.error || "Can't open that folder.");
    if (path !== "/") return showFolder("/");
    return;
  }
  files.view = "folder";
  files.editor = null;
  files.path = body.path;
  files.entries = body.entries;
  renderFiles();
}

function crumbs() {
  const parts = files.path.split("/").filter(Boolean);
  const nodes = [];
  const home = el("button", { type: "button", class: "crumb" }, "Storage");
  home.addEventListener("click", () => showFolder("/"));
  nodes.push(home);
  parts.forEach((part, i) => {
    const b = el("button", { type: "button", class: "crumb" }, part);
    b.addEventListener("click", () => showFolder(`/${parts.slice(0, i + 1).join("/")}`));
    nodes.push(el("span", { class: "crumb-sep", "aria-hidden": "true" }, "/"), b);
  });
  return nodes;
}

function renderFiles() {
  $("files").classList.toggle("editing", files.view === "editor");
  if (files.view === "trash") return renderTrash();
  if (files.view === "editor") return;
  $("files-crumbs").replaceChildren(...crumbs());
  $("files-up").disabled = files.path === "/";
  const rows = files.entries.map((entry) => {
    const path = join(files.path, entry.name);
    const row = el("button", { type: "button", class: `file-row${entry.outside ? " outside" : ""}`, "data-file": path,
      title: entry.outside ? "A link to somewhere outside your storage folder" : entry.name },
    el("span", { class: `file-icon ${entry.kind}` }, svg(FILE_ICONS[entry.kind] || FILE_ICONS.file)),
    el("span", { class: "file-name" }, entry.name),
    el("span", { class: "file-size" }, entry.dir ? "" : bytes(entry.size)),
    el("span", { class: "file-date" }, when(entry.mtime)));
    row.addEventListener("click", () => openEntry(entry, path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, entryMenu(entry, path));
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Delete") { e.preventDefault(); deletePaths([path]); }
      if (e.key === "F2") { e.preventDefault(); renamePath(entry, path); }
      if (e.key === "m" || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        const r = row.getBoundingClientRect();
        openMenu(r.left + 40, r.bottom, entryMenu(entry, path));
      }
    });
    return row;
  });
  $("files-list").replaceChildren(...(rows.length ? rows : [el("p", { class: "no-results" }, "Empty. Drop files here, or Upload.")]));
}

function entryMenu(entry, path) {
  if (entry.outside) return [{ label: "Can't open: it leads outside your storage folder", run: () => {} }];
  const items = [{ label: "Open", run: () => openEntry(entry, path) }];
  if (entry.kind === "text" || (!entry.dir && entry.size < 2 * 1024 * 1024 && entry.kind === "file")) {
    items.push({ label: "Edit as text", run: () => editFile(path) });
  }
  if (!entry.dir) items.push({ label: "Download", run: () => downloadFile(path) });
  items.push({ label: "Rename…", run: () => renamePath(entry, path) });
  items.push({ label: "Delete", run: () => deletePaths([path]), destructive: true });
  return items;
}

function openEntry(entry, path) {
  if (entry.outside) return toast("That link leads outside your storage folder, so adlerOS won't open it.");
  if (entry.dir) return showFolder(path);
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

async function filesPost(what, body) {
  const { status, body: reply } = await api(`/api/files/${what}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => ({ status: 0 }));
  if (status === 401) showLock();
  else if (status !== 200) toast(reply?.error || "That didn't work.");
  return status === 200 ? reply : null;
}

async function newFolder() {
  const name = await nameDialog({ title: "New folder", button: "Create" });
  if (name && await filesPost("mkdir", { path: files.path, name })) showFolder(files.path);
}

async function newTextFile() {
  const name = await nameDialog({ title: "New text file", value: "untitled.txt", button: "Create" });
  if (!name) return;
  const reply = await filesPost("text", { path: join(files.path, name), text: "" });
  if (reply) editFile(reply.path);
}

async function renamePath(entry, path) {
  const name = await nameDialog({ title: `Rename ${entry.name}`, value: entry.name, button: "Rename" });
  if (name && name !== entry.name && await filesPost("rename", { path, name })) showFolder(files.path);
}

async function deletePaths(paths) {
  const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} items`;
  const ok = await confirmDialog({ title: `Delete ${label}?`, body: "It goes to the Trash, where you can restore it until you empty it.", button: "Delete", destructive: true });
  if (ok && await filesPost("delete", { paths })) {
    toast(`${label} moved to the Trash.`);
    showFolder(files.path);
  }
}

// --------------------------------------------------------------- upload

function uploadFiles(list) {
  for (const file of list) {
    const status = el("div", { class: "upload" }, el("span", { class: "upload-name" }, file.name), el("span", { class: "upload-pct" }, "0%"));
    $("files-uploads").append(status);
    files.uploads++;
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/files/upload?dir=${encodeURIComponent(files.path)}&name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) status.lastChild.textContent = `${Math.round((100 * e.loaded) / e.total)}%`;
    };
    const dir = files.path;
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

function renderTrash() {
  $("files-crumbs").replaceChildren(el("span", { class: "crumb current" }, "Trash"));
  $("files-up").disabled = false;
  const rows = files.trash.map((item) => {
    const restore = el("button", { type: "button", class: "chip-button" }, "Restore");
    restore.addEventListener("click", async () => {
      if (await filesPost("restore", { ids: [item.id] })) {
        toast(`${item.name} is back in ${item.from.split("/").slice(0, -1).join("/") || "Storage"}.`);
        showTrash();
      }
    });
    return el("div", { class: "file-row trash-row" },
      el("span", { class: `file-icon ${item.dir ? "folder" : "file"}` }, svg(FILE_ICONS[item.dir ? "folder" : "file"])),
      el("span", { class: "file-name" }, item.name, el("span", { class: "file-from" }, `from ${item.from}`)),
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
  files.view = "editor";
  files.editor = { path: body.path, name: body.path.split("/").pop(), mtime: body.mtime, dirty: false };
  const area = $("editor-text");
  area.value = body.text;
  $("editor-name").textContent = files.editor.name;
  $("editor-path").textContent = body.path;
  setDirty(false);
  renderFiles();
  area.focus();
  area.setSelectionRange(0, 0);
  area.scrollTop = 0;
}

function setDirty(dirty) {
  if (!files.editor) return;
  files.editor.dirty = dirty;
  $("editor-state").textContent = dirty ? "Not saved" : "Saved";
  $("editor-state").classList.toggle("dirty", dirty);
}

async function saveFile(overwrite = false) {
  const ed = files.editor;
  if (!ed) return;
  const { status, body } = await api("/api/files/text", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ed.path, text: $("editor-text").value, mtime: overwrite ? undefined : ed.mtime }),
  }).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status === 409 && body?.conflict) {
    const ok = await confirmDialog({ title: `${ed.name} changed`, body: "Something else changed it since you opened it. Save yours over it anyway?", button: "Overwrite", destructive: true });
    if (ok) saveFile(true);
    return;
  }
  if (status !== 200) return toast(body?.error || "Couldn't save it.");
  ed.mtime = body.mtime;
  setDirty(false);
  toast(`Saved ${ed.name}.`);
}

async function leaveEditor() {
  if (files.editor?.dirty) {
    const ok = await confirmDialog({ title: "Leave without saving?", body: `Your changes to ${files.editor.name} will be lost.`, button: "Leave", destructive: true });
    if (!ok) return;
  }
  const back = files.path;
  files.editor = null;
  await showFolder(back);
}

// ---------------------------------------------------------------- wiring

$("files-close").addEventListener("click", closeFiles);
$("files-up").addEventListener("click", () => {
  if (files.view !== "folder") return showFolder(files.path);
  showFolder(files.path.split("/").slice(0, -1).join("/") || "/");
});
$("files-new-folder").addEventListener("click", newFolder);
$("files-new-file").addEventListener("click", newTextFile);
$("files-upload").addEventListener("click", () => $("files-picker").click());
$("files-picker").addEventListener("change", (e) => {
  uploadFiles(e.target.files);
  e.target.value = "";
});
$("files-trash").addEventListener("click", () => (files.view === "trash" ? showFolder(files.path) : showTrash()));
const drop = $("files");
drop.addEventListener("dragover", (e) => {
  if (files.view !== "folder" || !e.dataTransfer?.types.includes("Files")) return;
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
const editorText = $("editor-text");
editorText.addEventListener("input", () => setDirty(true));
editorText.addEventListener("keydown", (e) => {
  // Tab indents, Ctrl+S saves; neither leaves the editor.
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
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
  if (e.key !== "Escape" || !filesOpen() || !$("modal").hidden || !$("menu").hidden) return;
  e.stopImmediatePropagation();
  if (files.view === "editor") leaveEditor();
  else if (files.view === "trash") showFolder(files.path);
  else closeFiles();
}, true);
window.addEventListener("beforeunload", (e) => {
  if (files.editor?.dirty || files.uploads) e.preventDefault();
});
