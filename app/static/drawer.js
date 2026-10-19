// All apps: every app on one screen, A to Z, with a search box: the dock's
// first fixed item (or press A). Type to narrow it down, Enter opens the
// first match, arrows move between apps, Escape closes it.
// Uses $, el, state, plateFor, openApp, closeSearch, closeMenu from app.js.
"use strict";

const drawer = { opener: null, folder: null }; // folder: a collection opened in the App Library

function drawerOpen() { return !$("drawer").hidden; }

function toggleDrawer() {
  if (drawerOpen()) closeDrawer();
  else openDrawer();
}

function openDrawer() {
  closeSearch();
  closeMenu();
  drawer.opener = document.activeElement;
  drawer.folder = null;
  $("drawer").hidden = false;
  $("drawer-search").placeholder = phoneLayout() ? "App Library" : "Search apps";
  document.body.classList.add("drawer-open");
  markDockOpen("app-drawer", true);
  $("drawer-search").value = "";
  renderDrawer();
  $("drawer-search").focus();
}

function closeDrawer() {
  if (!drawerOpen()) return;
  $("drawer").hidden = true;
  document.body.classList.remove("drawer-open");
  markDockOpen("app-drawer", false);
  if (drawer.opener?.isConnected) drawer.opener.focus({ preventScroll: true });
}

function drawerMatches() {
  const q = $("drawer-search").value.trim().toLowerCase();
  return state.apps
    .filter((a) => a.genre !== "background") // agents: only in the App Store
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.about.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// adlerOS's own apps, first: Files, and the Terminal (admin mode).
// adlerOS's own, here like any app: pinned to the dock or put on the desktop
// from here (their menus), opened from here.
const BUILT_IN = [
  { id: "files", name: "My Computer", about: "Your files: Desktop, User and Root", open: () => openFiles(), keywords: "files folders storage documents computer finder explorer" },
  { id: "app-store", name: "App Store", about: "Your apps, and more to install", open: () => openStore(), keywords: "store apps install" },
  { id: "settings", name: "Settings", about: "adlerOS and this machine", open: () => openSettings(), keywords: "settings preferences" },
  { id: "live-usage", name: "Live Usage", about: "CPU, memory, storage, temperature", open: () => openUsage(), keywords: "usage cpu memory stats" },
  { id: "terminal", name: "Terminal", about: "A shell on this machine (admin mode)", open: () => openTerminal(), keywords: "terminal shell console ssh" },
  { id: "notepad", name: "Notepad", about: "Text files, one a window", open: () => openNotepad(), keywords: "notepad text editor edit write txt" },
  { id: "adlermd", name: "adlermd", about: "Your notes, in vaults (Obsidian's work too)", open: () => openAdlermd(), keywords: "adlermd notes markdown obsidian vault" },
  { id: "music", name: "Music", about: "Your songs, albums, playlists and radio", open: () => openMusic(), keywords: "music songs albums artists playlists radio lyrics" },
  { id: "gallery", name: "Gallery", about: "Your photos and videos, from Immich", open: () => openGallery(), keywords: "gallery photos pictures albums people immich" },
];
// The terminal only in admin mode.
const builtIns = () => BUILT_IN.filter((b) => b.id !== "terminal" || state.admin);

function builtInTile(b) {
  // Each carries its pin's id, for its menu and for dragging to the dock.
  const pinId = BUILTIN_PINS[`adleros:${b.id}`] ? { "data-app": `adleros:${b.id}` } : {};
  const tile = el("button", { type: "button", class: "app drawer-app built-in", title: b.about, "aria-label": b.name, ...pinId },
    el("span", { class: "drawer-letter", "aria-hidden": "true" }),
    el("span", { class: "app-icon builtin-icon" }, el("img", { src: `/static/dock/${b.id}.svg`, alt: "", draggable: "false" })),
    el("span", { class: "app-label" }, b.name));
  tile.addEventListener("click", () => {
    closeDrawer();
    b.open();
  });
  return tile;
}

// ------------------------------------------------------ the App Library

// A phone, with nothing typed: each collection a folder of four, like the
// iPhone's App Library. Three apps open from it; the fourth corner, when
// there are more, opens the whole collection.
function renderLibrary() {
  const open = (run) => () => { closeDrawer(); run(); };
  const icon = (item) => {
    const pinId = item.app ? item.app.id : BUILTIN_PINS[`adleros:${item.id}`] ? `adleros:${item.id}` : null;
    const b = el("button", { type: "button", class: "lib-icon", "aria-label": item.name, title: item.name, ...(pinId ? { "data-app": pinId } : {}) },
      item.app ? el("span", { class: "app-icon" }, plateFor(item.app))
        : el("span", { class: "app-icon builtin-icon" }, el("img", { src: `/static/dock/${item.id}.svg`, alt: "", draggable: "false" })));
    b.addEventListener("click", open(() => (item.app ? openApp(item.app) : item.open())));
    return b;
  };
  const folder = (name, items, id) => {
    const shown = items.length > 4 ? items.slice(0, 3) : items;
    const tiles = shown.map(icon);
    if (items.length > 4) {
      const more = el("button", { type: "button", class: "lib-more", "aria-label": `All of ${name} (${items.length})` },
        ...items.slice(3, 7).map((item) => el("span", { class: "app-icon" }, item.app ? plateFor(item.app)
          : el("img", { src: `/static/dock/${item.id}.svg`, alt: "" }))));
      more.addEventListener("click", () => { drawer.folder = id; renderDrawer(); });
      tiles.push(more);
    }
    return el("div", { class: "lib-folder" }, el("div", { class: "lib-tiles" }, ...tiles), el("span", { class: "lib-name" }, name));
  };
  const own = builtIns().map((b) => ({ ...b }));
  const folders = [folder("adlerOS", own, "adleros"),
    ...groupApps().map((c) => folder(c.name, c.apps.map((app) => ({ app, name: app.name })), c.id))];
  $("drawer-grid").classList.add("library");
  $("drawer-grid").replaceChildren(...folders);
  $("drawer-empty").hidden = true;
  $("drawer-count").textContent = "";
}

function renderDrawer() {
  $("drawer-grid").classList.remove("library");
  if (phoneLayout() && !$("drawer-search").value.trim() && !drawer.folder) return renderLibrary();
  let apps = drawerMatches();
  if (drawer.folder && drawer.folder !== "adleros") apps = apps.filter((a) => groupApps().find((c) => c.id === drawer.folder)?.apps.includes(a));
  let letter = "";
  const items = [];
  for (const app of apps) {
    // A small letter wherever the first letter changes, like a phone's app list.
    const first = app.name[0].toUpperCase();
    const mark = first !== letter ? first : "";
    letter = first;
    const warning = el("span", { class: "warning", hidden: "" },
      svg(["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"]));
    warning.hidden = app.up;
    items.push(el("a", {
      class: `app drawer-app${app.up ? "" : " offline"}`, href: app.url || "#store", target: app.url ? "_blank" : "_self", rel: "noopener noreferrer",
      draggable: "false", "data-app": app.id, title: app.about, "aria-label": app.up ? app.name : `${app.name} (offline)`,
    }, el("span", { class: "drawer-letter", "aria-hidden": "true" }, mark),
    el("span", { class: "app-icon" }, plateFor(app), warning),
    el("span", { class: "app-label" }, app.up ? app.name : `${app.name} · Offline`)));
  }
  const q = $("drawer-search").value.trim().toLowerCase();
  const own = (drawer.folder && drawer.folder !== "adleros" ? [] : builtIns())
    .filter((b) => !q || `${b.name} ${b.keywords}`.toLowerCase().includes(q)).map(builtInTile);
  if (drawer.folder === "adleros") items.length = 0;
  // An opened folder: its name, and the way back to the App Library.
  const head = drawer.folder ? [(() => {
    const back = el("button", { type: "button", class: "lib-back" }, "‹ App Library");
    back.addEventListener("click", () => { drawer.folder = null; renderDrawer(); });
    const name = drawer.folder === "adleros" ? "adlerOS" : groupApps().find((c) => c.id === drawer.folder)?.name || "";
    return el("div", { class: "lib-head" }, back, el("h2", {}, name));
  })()] : [];
  $("drawer-grid").replaceChildren(...head, ...own, ...items);
  $("drawer-empty").hidden = items.length + own.length > 0;
  $("drawer-count").textContent = `${apps.length} app${apps.length === 1 ? "" : "s"}`;
}

$("drawer-search").addEventListener("input", renderDrawer);
$("drawer-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = drawerMatches()[0];
    const q = $("drawer-search").value.trim().toLowerCase();
    const builtIn = q && builtIns().find((b) => `${b.name} ${b.keywords}`.toLowerCase().includes(q));
    if (first) {
      openApp(first);
      closeDrawer();
    } else if (builtIn) {
      closeDrawer();
      builtIn.open();
    }
  }
});
// Opening an app from here also puts the drawer away.
$("drawer-grid").addEventListener("click", (e) => {
  const tile = e.target.closest(".drawer-app");
  if (!tile || e.defaultPrevented) return;
  const app = appById(tile.dataset.app);
  // In a window (opensHere); Ctrl+click, a tab as ever.
  if (app && opensHere(e, app)) {
    e.preventDefault();
    closeDrawer();
    return openApp(app);
  }
  setTimeout(closeDrawer, 0);
});
// A click on the backdrop, not on an app or the search box, closes it.
$("drawer").addEventListener("pointerdown", (e) => {
  if (e.target === $("drawer") || e.target === $("drawer-grid")) closeDrawer();
});
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer").addEventListener("contextmenu", onContextMenu);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !drawerOpen() || !$("menu").hidden || !$("modal").hidden) return;
  e.stopImmediatePropagation();
  closeDrawer();
}, true);
