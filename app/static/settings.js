// Settings: a window over the desktop, after umbrelOS's settings sheet.
// The rows come from settings-catalog.json; anything that changes the
// machine is an action from scripts/agent/actions.json, carried out by the
// homelab helper on the host while this page shows its progress.
// Uses $, el, svg, api, toast and state from app.js.
"use strict";

// Line icons for rows, by the names settings-catalog.json uses.
const ICONS = {
  user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  key: ["M2.6 18.4 9 12", "M7.5 21.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z", "m21 2-9.6 9.6", "m15.5 7.5 3 3L22 7l-3-3"],
  image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "m21 15-5-5L5 21", "M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  windows: ["M3 4h11v9H3z", "M3 7h11", "M10 11h11v9H10z", "M10 14h11"],
  compass: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "m15.5 8.5-2 5-5 2 2-5z"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h20", "M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  lock: ["M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z", "M8 11V7a4 4 0 0 1 8 0v4"],
  network: ["M5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M19 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "m6.5 6.5 4 4", "m17.5 6.5-4 4", "m6.5 17.5 4-4", "m17.5 17.5-4-4"],
  drive: ["M22 12H2", "M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z", "M6 16h.01", "M10 16h.01"],
  archive: ["M3 4h18v4H3z", "M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8", "M10 12h4"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  cpu: ["M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M9 9h6v6H9z", "M9 2v3", "M15 2v3", "M9 19v3", "M15 19v3", "M2 9h3", "M2 15h3", "M19 9h3", "M19 15h3"],
  restart: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
  power: ["M12 2v10", "M18.4 6.6a9 9 0 1 1-12.8 0"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
  terminal: ["m4 17 6-6-6-6", "M12 19h8"],
};

// What an "open" row opens.
const OPENERS = { terminal: () => openTerminal(), welcome: () => { closeSettings(); openWelcome(); } };

// Named read-only values for "info" rows.
const FORMATTERS = {
  https: (d) => (d.config.URL_SCHEME === "https" ? "On for every app" : "Vaultwarden only, via Tailscale"),
  device: (d) => [d.device.model, d.device.os].filter(Boolean).join("\n") || d.device.hostname, // a line each
};

const settings = {
  catalog: null,
  data: null,
  filter: "all",
  query: "",
  pending: {}, // homelab.env key -> new value, not applied yet
  live: [], // functions that refresh the parts of rows that change on their own
  timer: null,
};

// ------------------------------------------------------------- helpers

function icon(name) {
  return svg(ICONS[name] || ICONS.cpu);
}

function bytes(n) {
  if (n == null) return "–";
  const gb = n / 1e9;
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

function duration(seconds) {
  if (seconds == null) return "–";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} day${d === 1 ? "" : "s"}, ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

function lookup(path, data) {
  if (FORMATTERS[path]) return FORMATTERS[path](data);
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), data) ?? "–";
}

async function loadCatalog() {
  if (!settings.catalog) {
    const response = await fetch("/static/settings-catalog.json", { credentials: "same-origin" });
    settings.catalog = await response.json();
  }
  return settings.catalog;
}

// --------------------------------------------------------- open / close

async function openSettings(rowId) {
  await loadCatalog();
  openWindow("settings");
  // #settings in the address: a reload comes back here, and it can be linked.
  history.replaceState(null, "", rowId ? `#settings/${rowId}` : "#settings");
  if (!(await loadSettings())) return;
  settings.query = "";
  $("settings-search").value = "";
  if (rowId) settings.filter = "all";
  renderFilters();
  renderRows();
  clearInterval(settings.timer);
  settings.timer = setInterval(() => { if (!document.hidden) refreshLive(); }, 5000);
  if (rowId) {
    const row = $(`row-${rowId}`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.classList.add("flash");
  }
}

function closeSettings() {
  if (!isOpen("settings")) return;
  clearInterval(settings.timer);
  closeWindow("settings");
  history.replaceState(null, "", location.pathname);
}

// The little line under a dock item whose window is open.
function markDockOpen(id, open) {
  $("dock").querySelector(`[data-dock="${id}"]`)?.classList.toggle("open", open);
}

async function loadSettings() {
  let result;
  try {
    result = await api("/api/settings");
  } catch {
    toast("Can't reach your homelab right now.");
    return false;
  }
  if (result.status === 401) {
    closeSettings();
    showLock();
    return false;
  }
  if (result.status !== 200) return false;
  settings.data = result.body;
  renderSide();
  return true;
}

async function refreshLive() {
  if ($("settings").hidden) return;
  if (await loadSettings()) settings.live.forEach((update) => update(settings.data));
}

// --------------------------------------------------------- owner column

function renderSide() {
  const d = settings.data;
  const wallpaperUrl = `url("/api/wallpaper?id=${encodeURIComponent(d.wallpaper.selected)}")`;
  document.documentElement.style.setProperty("--wallpaper", wallpaperUrl);

  // A small picture of the desktop: wallpaper, greeting, widgets, apps, dock.
  const preview = $("settings-preview");
  preview.style.backgroundImage = wallpaperUrl;
  const apps = el("div", { class: "preview-apps" }, ...(groupApps()[0]?.apps || []).slice(0, 12).map((app) => {
    const tile = el("span");
    if (app.hasIcon) tile.style.backgroundImage = `url("/api/icon/${encodeURIComponent(app.id)}?v=${encodeURIComponent(app.icon || "")}")`;
    return tile;
  }));
  const pins = state.dock.map(appById).filter(Boolean).map((app) => {
    const s = el("span", { class: "pin" });
    if (app.hasIcon) s.style.backgroundImage = `url("/api/icon/${encodeURIComponent(app.id)}?v=${encodeURIComponent(app.icon || "")}")`;
    return s;
  });
  const dockIcons = [...pins, ...DOCK_FIXED.map((item) => {
    const s = el("span");
    s.style.backgroundImage = `url("/api/dock-icon/${item.id}")`;
    return s;
  })];
  preview.replaceChildren(
    el("div", { class: "preview-greeting" }, greeting()),
    el("div", { class: "preview-widgets" }, el("span"), el("span"), el("span")),
    apps,
    el("div", { class: "preview-dock" }, ...dockIcons));

  const first = (d.name || "").split(/\s+/)[0];
  $("owner-name").textContent = first ? `${first}’s` : "";
  // Restart and Shut down are only offered in admin mode.
  document.querySelectorAll(".side-buttons [data-row]").forEach((b) => { b.hidden = !d.admin; });

  // A homelab: its domain and Tailscale address; on its own: its address.
  const summary = [
    ...(d.mode === "standalone"
      ? [["Address", d.config.ADLEROS_HOST || location.hostname]]
      : [["Domain", d.config.DOMAIN || "–"], ["Tailscale", d.config.TS_IP || "–"]]),
    ["Uptime", duration(d.device.uptime)],
    ["Apps", String(d.appCount)],
  ];
  $("settings-summary").replaceChildren(...summary.flatMap(([k, v]) => [el("dt", {}, k), el("dd", { title: v }, v)]));

  const dev = d.device;
  const pct = (used, total) => (total ? Math.round((100 * used) / total) : 0);
  const card = (label, value, small, percent) => {
    const bar = el("div", { class: `bar${percent >= 90 ? " high" : percent >= 75 ? " warn" : ""}` }, el("span"));
    bar.firstChild.style.width = `${Math.min(100, percent || 0)}%`;
    return el("div", { class: "usage-card" }, el("div", { class: "label" }, label),
      el("div", { class: "value" }, value, " ", el("small", {}, small)), percent == null ? "" : bar);
  };
  const cards = [];
  if (dev.disk) cards.push(card("Storage", bytes(dev.disk.used), `of ${bytes(dev.disk.total)}`, pct(dev.disk.used, dev.disk.total)));
  if (dev.memory) cards.push(card("Memory", bytes(dev.memory.used), `of ${bytes(dev.memory.total)}`, pct(dev.memory.used, dev.memory.total)));
  if (dev.cpu != null) cards.push(card("CPU", `${Math.round(dev.cpu)}%`, `${dev.cpus} cores`, dev.cpu));
  if (dev.temperature != null) cards.push(card("Temperature", `${Math.round(dev.temperature)} °C`, dev.temperature >= 75 ? "hot" : "normal", null));
  $("usage-cards").replaceChildren(...cards);
}

// ------------------------------------------------------------------ rows

// Rows for the other kind of install (homelab or standalone) aren't shown.
function forMode(row) {
  const mode = settings.data?.mode || state.mode || "homelab";
  // "device": "computer": not on a phone (desktop mode). "admin": "hide":
  // only there in admin mode (the terminal).
  const admin = settings.data?.admin ?? state.admin;
  return (!row.mode || row.mode === mode) && (row.device !== "computer" || computerScreen()) && (row.admin !== "hide" || admin);
}

function categoryLabel(c) {
  return (settings.data?.mode || state.mode) === "standalone" && c.labelStandalone ? c.labelStandalone : c.label;
}

function renderFilters() {
  const tabs = [{ id: "all", label: "All" }, ...settings.catalog.categories.map((c) => ({ ...c, label: categoryLabel(c) }))];
  $("settings-filters").replaceChildren(...tabs.map((t) => {
    const b = el("button", { type: "button", class: "filter", role: "tab", "aria-selected": String(settings.filter === t.id) }, t.label);
    b.addEventListener("click", () => {
      settings.filter = t.id;
      renderFilters();
      renderRows();
    });
    return b;
  }));
}

function matches(row) {
  if (!forMode(row)) return false;
  if (settings.filter !== "all" && row.category !== settings.filter) return false;
  const q = settings.query.trim().toLowerCase();
  if (!q) return true;
  return [row.title, row.description, row.keywords || ""].join(" ").toLowerCase().includes(q);
}

function renderRows() {
  settings.live = [];
  const container = $("settings-rows");
  const nodes = [];
  for (const category of settings.catalog.categories) {
    const rows = settings.catalog.rows.filter((r) => r.category === category.id && matches(r));
    if (!rows.length) continue;
    nodes.push(el("h3", { class: "group-title" }, categoryLabel(category)));
    nodes.push(el("div", { class: "group" }, ...rows.map(buildRow)));
  }
  if (!nodes.length) nodes.push(el("p", { class: "no-results" }, "No settings match."));
  container.replaceChildren(...nodes);
  updateApplyBar();
}

function buildRow(row) {
  const description = el("div", { class: "row-description" }, row.description || "");
  const textBlock = el("div", {}, el("div", { class: "row-title" }, row.title), description);
  const control = el("div", { class: "row-control" });
  const c = row.control || {};
  const d = settings.data;

  if (c.type === "setting-text") {
    const input = el("input", { class: "field-input", type: "text", value: d[c.key] || "", placeholder: c.placeholder || "", maxlength: String(c.maxLength || 60), "aria-label": row.title });
    const tick = el("span", { class: "saved-tick", "aria-live": "polite" }, "Saved");
    const save = async () => {
      if (input.value.trim() === (settings.data[c.key] || "")) return;
      const { status, body } = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [c.key]: input.value.trim() }) });
      if (status !== 200) return toast(body?.error || "Couldn't save that.");
      settings.data[c.key] = input.value.trim();
      tick.classList.add("show");
      setTimeout(() => tick.classList.remove("show"), 1500);
      if (c.key === "name") { state.name = settings.data.name; $("greeting").textContent = greeting(); renderSide(); }
      if (c.key === "searchUrl") state.searchUrl = settings.data.searchUrl;
    };
    input.addEventListener("change", save);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    control.append(tick, input);
  } else if (c.type === "password") {
    const b = el("button", { type: "button", class: "chip-button" }, "Change…");
    b.addEventListener("click", passwordDialog);
    control.append(b);
  } else if (c.type === "wallpaper") {
    control.append(wallpaperPicker());
  } else if (c.type === "config") {
    control.append(configInput(row, c));
  } else if (c.type === "admin") {
    control.append(adminSwitch());
  } else if (c.type === "desktop-mode") {
    // Kept in this browser, not on the server: each device picks.
    const sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(desktopMode()), "aria-label": "Desktop mode" }, el("span"));
    sw.addEventListener("click", () => setDesktopMode(!desktopMode()));
    control.append(sw);
  } else if (c.type === "glass") {
    // This device's, like desktop mode.
    const value = el("span", { class: "glass-value" }, glassLevel().toFixed(2));
    const range = el("input", { type: "range", class: "glass-range", min: "0", max: "1", step: "0.05", value: String(glassLevel()), "aria-label": row.title });
    range.addEventListener("input", () => {
      setGlass(Number(range.value));
      value.textContent = Number(range.value).toFixed(2);
    });
    control.append(range, value);
  } else if (c.type === "open-apps") {
    const select = el("select", { class: "field-input", "aria-label": row.title },
      el("option", { value: "here" }, "In a window here"), el("option", { value: "tab" }, "In a new tab"));
    select.value = appsInTabs() ? "tab" : "here";
    select.addEventListener("change", () => winSave(OPEN_APPS_KEY, select.value));
    control.append(select);
  } else if (c.type === "open") {
    // Opens one of adlerOS's windows (the terminal, say).
    const b = el("button", { type: "button", class: "chip-button" }, c.label || "Open");
    b.addEventListener("click", () => OPENERS[c.target]?.());
    if (row.admin && !d.admin) {
      b.disabled = true;
      textBlock.append(el("div", { class: "row-detail locked" }, "Turn on admin mode (above) to use this."));
    }
    control.append(b);
  } else if (c.type === "action") {
    const b = el("button", { type: "button", class: `chip-button${c.destructive ? " destructive" : ""}` }, c.label || row.title);
    b.addEventListener("click", () => runAction(row));
    if (row.admin && !d.admin) {
      b.disabled = true;
      textBlock.append(el("div", { class: "row-detail locked" }, "Turn on admin mode (above) to use this."));
    }
    control.append(b);
    if (c.detail === "backups") {
      const detail = el("div", { class: "row-detail" });
      const update = (data) => {
        const b2 = data.backups;
        detail.textContent = !b2.readable ? "Last backup: not readable (run a backup first)"
          : b2.last ? `Last backup: ${b2.last} · ${b2.count} kept` : "No backups yet";
      };
      update(d);
      settings.live.push(update);
      textBlock.append(detail);
    }
  } else if (c.type === "info") {
    const value = el("span", { class: "row-value" });
    const update = (data) => {
      value.textContent = String(lookup(c.value, data));
      value.title = value.textContent;
    };
    update(d);
    settings.live.push(update);
    control.append(value);
  }
  return el("div", { class: "row", id: `row-${row.id}` },
    el("div", { class: "row-text" }, el("span", { class: "row-icon" }, icon(row.icon)), textBlock), control);
}

function wallpaperPicker() {
  const strip = el("div", { class: "wallpapers", role: "group", "aria-label": "Wallpapers" });
  const draw = () => {
    strip.replaceChildren(...settings.data.wallpaper.options.map((w) => {
      // Only the ones scrolled into view load (a folder can hold hundreds).
      const b = el("button", { type: "button", class: "wallpaper-option", title: w.name, "aria-label": w.name, "aria-pressed": String(w.id === settings.data.wallpaper.selected) },
        el("img", { src: `/api/wallpaper?id=${encodeURIComponent(w.id)}`, alt: "", loading: "lazy", decoding: "async", draggable: "false" }));
      b.addEventListener("click", async () => {
        const { status, body } = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallpaper: w.id }) });
        if (status !== 200) return toast(body?.error || "Couldn't change the wallpaper.");
        settings.data.wallpaper.selected = w.id;
        draw();
        renderSide();
        loadWallpaper(w.id);
      });
      return b;
    }));
  };
  draw();
  requestAnimationFrame(() => strip.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" }));
  return strip;
}

function configInput(row, c) {
  const current = settings.data.config[c.key] || "";
  let input;
  if (c.input === "timezone" && typeof Intl.supportedValuesOf === "function") {
    const zones = Intl.supportedValuesOf("timeZone");
    if (current && !zones.includes(current)) zones.unshift(current);
    input = el("select", { class: "field-input", "aria-label": row.title }, ...zones.map((z) => el("option", { value: z }, z.replaceAll("_", " "))));
  } else {
    input = el("input", { class: "field-input", type: "text", spellcheck: "false", autocapitalize: "off", "aria-label": row.title });
  }
  input.value = settings.pending[c.key] ?? current;
  input.classList.toggle("changed", c.key in settings.pending);
  const rule = settings.data.actions[c.action]?.params?.[c.key];
  input.addEventListener("input", () => {
    const value = input.value.trim();
    const valid = !rule || (new RegExp(rule.pattern).test(value) && value.length <= (rule.maxLength || 256));
    input.classList.toggle("invalid", !valid);
    if (value === current) delete settings.pending[c.key];
    else settings.pending[c.key] = value;
    input.classList.toggle("changed", c.key in settings.pending);
    updateApplyBar();
  });
  return input;
}

// ------------------------------------------------------- apply homelab.env

function configRows() {
  return settings.catalog.rows.filter((r) => r.control?.type === "config");
}

function updateApplyBar() {
  const changed = configRows().filter((r) => r.control.key in settings.pending);
  $("apply-bar").hidden = !changed.length;
  if (changed.length) $("apply-text").textContent = `${changed.map((r) => r.title).join(" and ")} changed`;
}

function discardPending() {
  settings.pending = {};
  renderRows();
}

async function applyPending() {
  const changed = configRows().filter((r) => r.control.key in settings.pending);
  if (!changed.length) return;
  const action = changed[0].control.action;
  const params = {};
  for (const r of changed) {
    const rule = settings.data.actions[action]?.params?.[r.control.key];
    const value = settings.pending[r.control.key];
    if (rule && !new RegExp(rule.pattern).test(value)) return toast(`${r.title}: that doesn't look right.`);
    params[r.control.key] = value;
  }
  const newDomain = params.DOMAIN;
  const ok = await confirmDialog({
    title: "Apply these changes?",
    body: "install.sh runs again and restarts the apps that use these settings. It takes a few minutes."
      + (newDomain ? ` Afterwards your home screen is at os.${newDomain}.` : ""),
    button: "Apply",
  });
  if (!ok) return;
  startAction(action, params, {
    onDone: () => {
      settings.pending = {};
      renderRows();
      if (newDomain) {
        const scheme = settings.data.config.URL_SCHEME || "http";
        return `Done. Your home screen is now at ${scheme}://os.${newDomain} (this address keeps working until you leave it).`;
      }
      return "Done. Every app has the new settings.";
    },
  });
}

// --------------------------------------------------------------- actions

async function runAction(row) {
  const c = row.control;
  if (row.admin && !settings.data.admin) return toast("Turn on admin mode in Settings → System first.");
  if (c.confirm) {
    const ok = await confirmDialog({ ...c.confirm, destructive: c.destructive });
    if (!ok) return;
  }
  startAction(c.action, {}, {});
}

async function startAction(action, params, opts) {
  let result;
  try {
    result = await api("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, params }) });
  } catch {
    return toast("Can't reach your homelab right now.");
  }
  if (result.status === 409 && result.body?.job) {
    toast("Something else is still running; here it is.");
    return jobDialog(result.body.job, {});
  }
  if (result.status === 403 && result.body?.admin) return toast("That needs admin mode: Settings → System → Admin mode.");
  if (result.status !== 202) return toast(result.body?.error || "That didn't work.");
  jobDialog(result.body, opts);
}

// ------------------------------------------------------------ admin mode

function adminSwitch() {
  const on = Boolean(settings.data.admin);
  const sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": "Admin mode" }, el("span"));
  sw.addEventListener("click", () => (settings.data.admin ? setAdmin(false) : adminDialog()));
  return sw;
}

async function setAdmin(on, password) {
  const { status, body } = await api("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(on ? { on, password } : { on }),
  }).catch(() => ({ status: 0 }));
  if (status === 200) {
    if (!on) closeTerminal(); // you turned it off: its shells go too
    showAdmin(on);
    armAdmin(body.adminLeft);
    toast(on ? "Admin mode is on for 8 hours. Turn it off when you're done." : "Admin mode is off.");
  }
  return { status, body };
}

// What only admin mode shows: the terminal, hidden files, the Restart and
// Shut down buttons.
function showAdmin(on) {
  state.admin = on;
  if (settings.data) {
    settings.data.admin = on;
    renderRows();
    renderSide();
  }
  if (!on) hideTerminal();
  dockKey = null;
  buildDock();
  if (drawerOpen()) renderDrawer();
  if (filesOpen() && files.view === "folder") showFolder(files.path);
}

// Admin mode turns itself off 8 hours after it's turned on (adlerOS keeps
// the time): the page goes along then, or when it next hears it's off. A
// shell it timed out on keeps running, for when it's back on.
let adminTimer = null;
function armAdmin(left) {
  clearTimeout(adminTimer);
  if (left > 0) adminTimer = setTimeout(() => noteAdmin(false, 0), left * 1000 + 500);
}
function noteAdmin(on, left) {
  armAdmin(on ? left : 0);
  if (on === Boolean(state.admin)) return;
  const was = state.admin;
  showAdmin(on);
  if (was && !on) toast("Admin mode is off now: it turns itself off 8 hours after you turn it on. A terminal you had keeps running for when it's back on.");
}

function adminDialog() {
  const password = el("input", { class: "field-input", type: "password", placeholder: "Your adlerOS password", autocomplete: "current-password", required: "" });
  const error = el("p", { class: "error", role: "alert" });
  const ok = el("button", { type: "submit", class: "button-destructive wide" }, "Turn on");
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  const form = el("form", {}, password, error);
  const dialog = el("div", { class: "dialog material", role: "dialog", "aria-modal": "true" },
    el("h2", {}, "Turn on admin mode?"),
    el("p", {}, "You'll be able to restart and shut down this machine, delete apps, stop or change the ones your network needs (Pi-hole, Nginx Proxy Manager…), and use the terminal. It's on for every browser until you turn it off, or for 8 hours."),
    form, el("div", { class: "dialog-actions" }, cancel, ok));
  cancel.addEventListener("click", closeModal);
  const submit = async (e) => {
    e.preventDefault();
    error.textContent = "";
    ok.disabled = true;
    const { status, body } = await setAdmin(true, password.value);
    ok.disabled = false;
    if (status === 200) return closeModal();
    error.textContent = status === 401 ? "That password is wrong."
      : status === 429 ? "Too many attempts. Try again in a few minutes." : body?.error || "That didn't work.";
    password.select();
  };
  form.addEventListener("submit", submit);
  ok.addEventListener("click", submit);
  openModal(dialog);
}

// --------------------------------------------------------------- dialogs

let modalCleanup = null;

function openModal(dialog, { dismissable = true, onClose } = {}) {
  closeModal();
  const modal = $("modal");
  modal.replaceChildren(dialog);
  modal.hidden = false;
  modal.onpointerdown = (e) => { if (dismissable && e.target === modal) closeModal(); };
  modalCleanup = onClose || null;
  dialog.querySelector("input, button.button-primary, button.button-destructive, button")?.focus();
}

function closeModal() {
  const modal = $("modal");
  if (modal.hidden) return;
  modal.hidden = true;
  modal.replaceChildren();
  const cleanup = modalCleanup;
  modalCleanup = null;
  cleanup?.();
}

function confirmDialog({ title, body, button = "OK", destructive = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value) => { answered = true; closeModal(); resolve(value); };
    const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
    const ok = el("button", { type: "button", class: destructive ? "button-destructive wide" : "button-primary wide" }, button);
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    const dialog = el("div", { class: "dialog material", role: "alertdialog", "aria-modal": "true" },
      el("h2", {}, title), body ? el("p", {}, body) : "", el("div", { class: "dialog-actions" }, cancel, ok));
    openModal(dialog, { onClose: () => { if (!answered) resolve(false); } });
    ok.focus();
  });
}

function passwordDialog() {
  const current = el("input", { class: "field-input", type: "password", placeholder: "Current password", autocomplete: "current-password", required: "" });
  const next = el("input", { class: "field-input", type: "password", placeholder: "New password (8 or more characters)", autocomplete: "new-password", minlength: "8", required: "" });
  const again = el("input", { class: "field-input", type: "password", placeholder: "New password again", autocomplete: "new-password", required: "" });
  const error = el("p", { class: "error", role: "alert" });
  const save = el("button", { type: "submit", class: "button-primary wide" }, "Change password");
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  const form = el("form", {}, current, next, again, error);
  const dialog = el("div", { class: "dialog material", role: "dialog", "aria-modal": "true" },
    el("h2", {}, "Change password"), el("p", {}, "Other browsers are logged out when it changes."),
    form, el("div", { class: "dialog-actions" }, cancel, save));
  cancel.addEventListener("click", closeModal);
  const submit = async (e) => {
    e.preventDefault();
    error.textContent = "";
    if (next.value.length < 8) return (error.textContent = "Use 8 or more characters.");
    if (next.value !== again.value) return (error.textContent = "The new passwords don't match.");
    save.disabled = true;
    const { status, body } = await api("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: current.value, new: next.value }) });
    save.disabled = false;
    if (status === 200) {
      closeModal();
      toast("Password changed.");
      return;
    }
    error.textContent = status === 401 ? "The current password is wrong."
      : status === 429 ? "Too many attempts. Try again in a few minutes." : body?.error || "That didn't work.";
  };
  form.addEventListener("submit", submit);
  save.addEventListener("click", submit);
  openModal(dialog);
}

const STATUS_TEXT = { queued: "Waiting", running: "Running", done: "Done", failed: "Failed" };

function jobDialog(job, { onDone } = {}) {
  const title = el("h2", {}, job.label || job.action);
  const status = el("span", { class: "job-status" });
  const note = el("p", { class: "job-note" });
  const log = el("pre", { class: "job-log" });
  const close = el("button", { type: "button", class: "button-secondary" }, "Close");
  const dialog = el("div", { class: "dialog material job", role: "dialog", "aria-modal": "true" },
    el("div", { class: "job-head" }, title, status), note, log, el("div", { class: "dialog-actions" }, close));
  let timer = null;
  let finished = false;
  const since = Date.now();
  close.addEventListener("click", closeModal);

  const show = (j) => {
    status.className = `job-status ${j.status}`;
    status.textContent = STATUS_TEXT[j.status] || j.status;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.textContent = (j.log || []).join("\n") || " ";
    if (atBottom) log.scrollTop = log.scrollHeight;
    if (j.status === "queued") {
      note.textContent = Date.now() - since > 15000
        ? `Still waiting for the helper. It's set up by ./install.sh (without --no-host); check it with: systemctl status ${helperUnit()}`
        : "Waiting for the helper to pick this up…";
    } else if (j.status === "running") {
      note.textContent = "You can close this; it keeps going in the background.";
    } else if (j.status === "failed") {
      note.textContent = j.error ? `It stopped: ${j.error}.` : "It stopped with an error; the log below says why.";
    }
    if (j.status === "done" && !finished) {
      finished = true;
      if (j.action === "reboot") return waitForRestart(note);
      if (j.action === "shutdown") return (note.textContent = "Shutting down. Your homelab is offline until it's switched back on.");
      if (j.action === "update") {
        note.textContent = "Updated. Reloading adlerOS to show the new version…";
        return setTimeout(() => location.reload(), 2500);
      }
      note.textContent = (onDone && onDone(j)) || "Done.";
      loadSettings().then(() => settings.live.forEach((u) => u(settings.data)));
    }
    if (j.status === "failed") finished = true;
  };

  const poll = async () => {
    try {
      const { status: code, body } = await api(`/api/jobs/${job.id}`);
      if (code === 200 && body) show(body);
    } catch { /* the home screen may be restarting; keep trying */ }
    if (!finished) timer = setTimeout(poll, 1000);
  };
  show(job);
  openModal(dialog, { onClose: () => clearTimeout(timer) });
  poll();
}

// After a restart: wait for the home screen to go away, then come back.
function waitForRestart(note) {
  note.textContent = "Restarting. This page reloads when your homelab is back.";
  let wentDown = false;
  const check = async () => {
    try {
      const r = await fetch("/healthz", { cache: "no-store" });
      if (r.ok && wentDown) return location.reload();
      if (!r.ok) wentDown = true;
    } catch {
      wentDown = true;
    }
    setTimeout(check, 3000);
  };
  setTimeout(check, 3000);
}

// ------------------------------------------------------------- for ⌘K

// Settings rows as search results, so ⌘K finds "timezone" or "back up".
function settingsSearchResults(query) {
  if (!settings.catalog || !query) return [];
  const q = query.toLowerCase();
  return settings.catalog.rows
    .filter((r) => forMode(r) && [r.title, r.description, r.keywords || ""].join(" ").toLowerCase().includes(q))
    .slice(0, 4)
    .map((r) => ({ type: "setting", row: r }));
}

// ------------------------------------------------------------- wiring

$("settings-close").addEventListener("click", closeSettings);
$("settings-search").addEventListener("input", (e) => {
  settings.query = e.target.value;
  renderRows();
});
$("side-logout").addEventListener("click", confirmLogout);
document.querySelectorAll(".side-buttons [data-row]").forEach((b) => {
  b.addEventListener("click", () => {
    const row = settings.catalog?.rows.find((r) => r.id === b.dataset.row);
    if (row) runAction(row);
  });
});
$("apply-discard").addEventListener("click", discardPending);
$("apply-ok").addEventListener("click", applyPending);
// Escape closes the topmost thing: a dialog, then the settings window.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("modal").hidden) {
    e.stopImmediatePropagation();
    closeModal();
  } else if (isActive("settings") && $("search").hidden && $("menu").hidden && $("confirm").hidden) {
    e.stopImmediatePropagation();
    closeSettings();
  }
}, true);
registerWindow("settings", { title: "Settings", close: closeSettings, dock: "settings", size: [1100, 780] });
loadCatalog().catch(() => {});
