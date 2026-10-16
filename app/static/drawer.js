// All apps: every app on one screen, A to Z, with a search box: the dock's
// first fixed item (or press A). Type to narrow it down, Enter opens the
// first match, arrows move between apps, Escape closes it.
// Uses $, el, state, plateFor, openApp, closeSearch, closeMenu from app.js.
"use strict";

const drawer = { opener: null };

function drawerOpen() { return !$("drawer").hidden; }

function toggleDrawer() {
  if (drawerOpen()) closeDrawer();
  else openDrawer();
}

function openDrawer() {
  closeSearch();
  closeMenu();
  drawer.opener = document.activeElement;
  $("drawer").hidden = false;
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
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.about.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderDrawer() {
  const apps = drawerMatches();
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
  $("drawer-grid").replaceChildren(...items);
  $("drawer-empty").hidden = apps.length > 0;
  $("drawer-count").textContent = `${apps.length} app${apps.length === 1 ? "" : "s"}`;
}

$("drawer-search").addEventListener("input", renderDrawer);
$("drawer-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = drawerMatches()[0];
    if (first) {
      openApp(first);
      closeDrawer();
    }
  }
});
// Opening an app from here also puts the drawer away.
$("drawer-grid").addEventListener("click", (e) => {
  const tile = e.target.closest(".drawer-app");
  if (!tile || e.defaultPrevented) return;
  const app = appById(tile.dataset.app);
  if (app && !app.url) {
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
