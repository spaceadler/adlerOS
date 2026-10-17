// Folders on the home screen, like an iPhone's. Drop an app on another and
// hold to make one; drop it on a folder to add it. Open one to use its apps,
// or to rename it; drag an app out of it (or its menu: Remove from folder)
// to put it back on the page. A folder lives in one collection; adlerOS
// keeps them in its settings ("folders"), and the page's order says where
// each goes ("folder:<id>"). One emptied is gone.
// Uses $, el, api, toast, state, plateFor, appById, refresh, layout,
// collectionOrder, openApp, openModal, closeModal, nameDialog, showLock.
"use strict";

const folderView = { id: null };

function folderTile(folder, index) {
  const minis = folder.apps.slice(0, 9).map((a) => el("span", { class: "folder-mini" }, plateFor(a)));
  const tile = el("button", { type: "button", class: "app folder", "data-folder": folder.id, title: folder.name,
    "aria-label": `${folder.name}, a folder of ${folder.apps.length}` },
  el("span", { class: "app-icon folder-icon" }, el("span", { class: "folder-grid" }, ...minis)),
  el("span", { class: "app-label" }, folder.name));
  tile.addEventListener("click", () => openFolder(folder.id));
  tile.style.animationDelay = `${index * 10}ms`;
  tile.addEventListener("animationend", () => { tile.style.animation = "none"; }, { once: true });
  return tile;
}

// ------------------------------------------------------------- changing

// Every folder at once (and, with it, a collection's order or an app's new
// collection); then the page as the server has it.
async function saveFolders(folders, order, place) {
  const body = { folders, ...(order ? { order } : {}), ...(place ? { place } : {}) };
  const { status, body: reply } = await api("/api/settings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => ({ status: 0 }));
  if (status === 401) {
    showLock();
    return false;
  }
  if (status !== 200) {
    toast(reply?.error || "Couldn't change the folder.");
    layout(true);
    return false;
  }
  await refresh();
  if (folderView.id) renderFolder();
  return true;
}

// A collection's order: as the page shows it, else as it was saved.
function orderOf(collection) {
  const shown = collectionOrder(collection);
  return shown.length ? shown : [...(state.order[collection] || [])];
}

const copyFolders = () => Object.fromEntries(Object.entries(state.folders || {}).map(([id, f]) => [id, { ...f, apps: [...f.apps] }]));

function newFolderId(folders) {
  let id;
  do id = Math.random().toString(36).slice(2, 10); while (folders[id]);
  return id;
}

// An app dropped on another (or on a folder), on a collection's page.
function mergeOnto(target, appId, collection) {
  const app = appById(appId);
  if (!app || target.dataset.app === appId) return layout(true);
  const folders = copyFolders();
  const order = orderOf(collection).filter((k) => k !== appId);
  // Dragged here from another collection's page: it moves there too.
  const place = app.genre !== collection ? { app: appId, collection } : undefined;
  if (target.dataset.folder) {
    folders[target.dataset.folder]?.apps.push(appId);
    return saveFolders(folders, { [collection]: order }, place);
  }
  const id = newFolderId(folders);
  folders[id] = { name: "Folder", collection, apps: [target.dataset.app, appId] };
  saveFolders(folders, { [collection]: order.map((k) => (k === target.dataset.app ? `folder:${id}` : k)) }, place)
    .then((ok) => { if (ok) toast("A folder. Open it to give it a name."); });
}

function addToFolder(id, app) {
  const folders = copyFolders();
  const order = orderOf(app.genre).filter((k) => k !== app.id);
  folders[id].apps.push(app.id);
  return saveFolders(folders, { [app.genre]: order });
}

// Back on the page, just after the folder (where the folder was, if it's
// the last one out).
function removeFromFolder(id, appId) {
  const folders = copyFolders();
  const f = folders[id];
  if (!f) return;
  f.apps = f.apps.filter((a) => a !== appId);
  const key = `folder:${id}`;
  const order = orderOf(f.collection).filter((k) => k !== appId);
  const at = order.indexOf(key);
  if (!f.apps.length) {
    delete folders[id];
    if (at >= 0) order.splice(at, 1, appId);
    else order.push(appId);
    closeFolder();
  } else if (at >= 0) order.splice(at + 1, 0, appId);
  else order.push(appId);
  return saveFolders(folders, { [f.collection]: order });
}

function dissolveFolder(id) {
  const folders = copyFolders();
  const f = folders[id];
  if (!f) return;
  delete folders[id];
  const order = orderOf(f.collection);
  const at = order.indexOf(`folder:${id}`);
  if (at >= 0) order.splice(at, 1, ...f.apps);
  closeFolder();
  return saveFolders(folders, { [f.collection]: order });
}

function renameFolder(id, name) {
  const folders = copyFolders();
  const clean = name.trim().slice(0, 30);
  if (!folders[id] || !clean || clean === folders[id].name) return;
  folders[id].name = clean;
  return saveFolders(folders);
}

// Its menu's "Add to a folder…": a folder on its page, or a new one.
function folderDialog(app) {
  const here = Object.entries(state.folders || {}).filter(([, f]) => f.collection === app.genre);
  const pick = (run) => () => { closeModal(); run(); };
  const choices = here.map(([id, f]) => {
    const b = el("button", { type: "button", class: "chip-button collection-choice" }, f.name);
    b.addEventListener("click", pick(() => addToFolder(id, app)));
    return b;
  });
  const fresh = el("button", { type: "button", class: "chip-button collection-choice" }, "New folder…");
  fresh.addEventListener("click", pick(async () => {
    const name = await nameDialog({ title: "New folder", value: "Folder", button: "Create" });
    if (!name) return;
    const folders = copyFolders();
    const id = newFolderId(folders);
    folders[id] = { name: name.slice(0, 30), collection: app.genre, apps: [app.id] };
    const order = orderOf(app.genre).map((k) => (k === app.id ? `folder:${id}` : k));
    if (!order.includes(`folder:${id}`)) order.push(`folder:${id}`);
    saveFolders(folders, { [app.genre]: order });
  }));
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material", role: "dialog", "aria-modal": "true", "aria-label": `Add ${app.name} to a folder` },
    el("h2", {}, `Add ${app.name} to a folder`),
    el("p", { class: "dialog-text" }, "Or drag it onto another app and hold: that makes one."),
    el("div", { class: "collection-choices" }, ...choices, fresh),
    el("div", { class: "dialog-actions" }, cancel)));
  (choices[0] || fresh).focus();
}

// ------------------------------------------------------------ open one

function openFolder(id) {
  if (!state.folders?.[id]) return;
  folderView.id = id;
  $("folder").hidden = false;
  renderFolder();
  requestAnimationFrame(() => ($("folder-apps").querySelector(".app") || $("folder-name")).focus({ preventScroll: true }));
}

function closeFolder() {
  if ($("folder").hidden) return;
  const name = $("folder-name");
  if (document.activeElement === name) name.blur(); // saves a rename in progress
  $("folder").hidden = true;
  $("folder").classList.remove("dragging-out");
  const id = folderView.id;
  folderView.id = null;
  document.querySelector(`#pages [data-folder="${CSS.escape(id || "")}"]`)?.focus({ preventScroll: true });
}

function renderFolder() {
  const f = state.folders?.[folderView.id];
  if (!f) return closeFolder();
  if (document.activeElement !== $("folder-name")) $("folder-name").value = f.name;
  $("folder-apps").replaceChildren(...f.apps.map(appById).filter(Boolean).map((app) => {
    const tile = el("a", { class: `app${app.up ? "" : " offline"}`, href: app.url || "#store", target: "_blank",
      rel: "noopener noreferrer", draggable: "false", "data-app": app.id, title: app.about },
    el("span", { class: "app-icon" }, plateFor(app)), el("span", { class: "app-label" }, app.up ? app.name : "Offline"));
    tile.addEventListener("click", (e) => {
      if (!app.url || desktopMode()) {
        e.preventDefault();
        openApp(app);
      }
      closeFolder();
    });
    return tile;
  }));
}

// The end of a drag inside an open folder: out of it (back on the page), or
// in a new place within it.
function folderDragEnd(appId, out) {
  if (out) return removeFromFolder(folderView.id, appId);
  const folders = copyFolders();
  const f = folders[folderView.id];
  if (!f) return;
  const now = [...$("folder-apps").querySelectorAll(".app")].map((a) => a.dataset.app);
  if (now.join() === f.apps.join()) return;
  f.apps = now;
  saveFolders(folders);
}

// ---------------------------------------------------------------- wiring

$("folder").addEventListener("pointerdown", (e) => { if (e.target === $("folder")) closeFolder(); });
$("folder").addEventListener("contextmenu", onContextMenu);
$("folder-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.target.blur();
  }
});
$("folder-name").addEventListener("blur", (e) => { if (folderView.id) renameFolder(folderView.id, e.target.value); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("folder").hidden || !$("menu").hidden || !$("modal").hidden) return;
  e.stopImmediatePropagation();
  closeFolder();
}, true);
