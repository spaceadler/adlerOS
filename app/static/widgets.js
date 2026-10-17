// Desktop widgets, after umbrelOS's: the kinds of widget (TYPES) are code,
// the widgets themselves are data in widgets-catalog.json, and what they show
// comes from GET /api/widgets every few seconds.
// Uses $, el, svg, api, toast, openSettings, bytes and duration from the
// other scripts.
"use strict";

const WIDGET_REFRESH_MS = 5000;

const widgets = {
  catalog: null,
  selected: null, // ids, once the server has said which
  data: null,
  slots: 0, // how many fit on this screen, from layout()
  timer: null,
  live: [], // refreshers for what's on screen: (data) => void
};

// ------------------------------------------------------------- values

const pct = (used, total) => (total ? used / total : 0);
const DASH = "–";

// Named values the catalog refers to: data -> {text, subtext, progress, label}.
const VALUES = {
  cpu: (d) => (d.system.cpu == null ? { text: DASH } : { text: `${Math.round(d.system.cpu)}%`, progress: d.system.cpu / 100 }),
  temperature: (d) => (d.system.temperature == null ? { text: DASH }
    : { text: `${Math.round(d.system.temperature)}°`, subtext: "C", progress: Math.min(1, d.system.temperature / 85) }),
  "memory-used": (d) => (d.system.memory ? { text: bytes(d.system.memory.used), subtext: `/ ${bytes(d.system.memory.total)}` } : { text: DASH }),
  "storage-free": (d) => (d.system.disk ? { text: bytes(d.system.disk.total - d.system.disk.used), subtext: "free" } : { text: DASH }),
  memory: (d) => {
    const m = d.system.memory;
    if (!m) return { title: "Memory", text: DASH };
    return { title: "Memory", text: bytes(m.used), subtext: `/ ${bytes(m.total)}`, progress: pct(m.used, m.total),
      label: `${bytes(m.total - m.used)} available` };
  },
  storage: (d) => {
    const s = d.system.disk;
    if (!s) return { title: "Storage", text: DASH };
    return { title: "Storage", text: bytes(s.used), subtext: `/ ${bytes(s.total)}`, progress: pct(s.used, s.total),
      label: `${bytes(s.total - s.used)} left` };
  },
  "apps-up": (d) => ({ text: String(d.apps.up), subtext: "Up" }),
  "apps-offline": (d) => ({ text: String(d.apps.total - d.apps.up), subtext: "Offline" }),
  "apps-total": (d) => ({ text: String(d.apps.total), subtext: "Apps" }),
  "offline-apps": (d) => ({ items: d.apps.offline.map((name) => ({ text: name, subtext: "Not answering" })) }),
  "last-backup": (d) => {
    const b = d.backups;
    if (!b.readable) return { title: "Last backup", text: "Unknown", subtext: "run one first" };
    if (!b.last) return { title: "Last backup", text: "Never" };
    const days = Math.round((Date.now() - new Date(`${b.last}T12:00:00`)) / 86400000);
    const when = days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
    return { title: "Last backup", text: when, subtext: `${b.count} kept` };
  },
};

function value(name, data) {
  if (!data || !VALUES[name]) return { text: DASH };
  try {
    return VALUES[name](data);
  } catch {
    return { text: DASH };
  }
}

// Small line icons for three-stats.
const WIDGET_ICONS = {
  check: ["M20 6 9 17l-5-5"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"],
  grid: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
};

// ------------------------------------------------------------- types

// A stat line: big text, then a faint subtext.
function statText(v) {
  const text = el("span", { class: "w-text" });
  const sub = el("span", { class: "w-sub" });
  const node = el("div", { class: "w-stat" }, text, " ", sub);
  return [node, (nv) => { text.textContent = nv.text ?? DASH; sub.textContent = nv.subtext || ""; }];
}

function bar() {
  const fill = el("span");
  const node = el("div", { class: "w-bar" }, fill);
  return [node, (p) => {
    fill.style.width = `${Math.round(100 * Math.min(1, Math.max(0, p || 0)))}%`;
    node.classList.toggle("high", p >= 0.9);
  }];
}

// A 270° gauge: a faint track and an arc for the value.
function arc() {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 100 100");
  s.setAttribute("class", "w-arc");
  s.setAttribute("aria-hidden", "true");
  const r = 42;
  const length = 2 * Math.PI * r * 0.75;
  const circle = (cls) => {
    const c = document.createElementNS(ns, "circle");
    for (const [k, v] of Object.entries({ cx: 50, cy: 50, r, class: cls })) c.setAttribute(k, v);
    c.setAttribute("stroke-dasharray", `${length} 1000`);
    return c;
  };
  const value = circle("w-arc-value");
  s.append(circle("w-arc-track"), value);
  return [s, (p) => value.setAttribute("stroke-dasharray", `${length * Math.min(1, Math.max(0, p || 0))} 1000`)];
}

// Each type: (widget) -> {node, update(data)}.
const TYPES = {
  "four-stats": (w) => {
    const cells = w.items.slice(0, 4).map((item) => {
      const [stat, set] = statText();
      return { node: el("div", { class: "w-cell" }, el("div", { class: "w-title" }, item.title), stat), set, item };
    });
    return {
      node: el("div", { class: "w-four" }, ...cells.map((c) => c.node)),
      update: (d) => cells.forEach((c) => c.set(value(c.item.value, d))),
    };
  },
  "three-stats": (w) => {
    const cells = w.items.slice(0, 3).map((item) => {
      const text = el("div", { class: "w-text" });
      const sub = el("div", { class: "w-title" });
      const node = el("div", { class: "w-pill" }, svg(WIDGET_ICONS[item.icon] || WIDGET_ICONS.grid), el("div", {}, sub, text));
      return { node, item, set: (v) => { text.textContent = v.text ?? DASH; sub.textContent = v.subtext || ""; } };
    });
    return {
      node: el("div", { class: "w-three" }, ...cells.map((c) => c.node)),
      update: (d) => cells.forEach((c) => c.set(value(c.item.value, d))),
    };
  },
  progress: (w) => {
    const title = el("div", { class: "w-title" });
    const [stat, setStat] = statText();
    const label = el("div", { class: "w-title" });
    const [barNode, setBar] = bar();
    return {
      node: el("div", { class: "w-progress" }, title, stat, el("div", { class: "w-grow" }), label, barNode),
      update: (d) => {
        const v = value(w.value, d);
        title.textContent = v.title || w.label;
        setStat(v);
        label.textContent = v.label || DASH;
        setBar(v.progress);
      },
    };
  },
  gauges: (w) => {
    const gauges = w.items.slice(0, 2).map((item) => {
      const [arcNode, setArc] = arc();
      const text = el("div", { class: "w-gauge-text" });
      const node = el("div", { class: "w-gauge" }, arcNode, el("div", { class: "w-gauge-label" }, text, el("div", { class: "w-title" }, item.title)));
      return { node, item, set: (v) => { text.textContent = `${v.text ?? DASH}${v.subtext && v.subtext.length < 3 ? v.subtext : ""}`; setArc(v.progress); } };
    });
    return {
      node: el("div", { class: "w-gauges" }, ...gauges.map((g) => g.node)),
      update: (d) => gauges.forEach((g) => g.set(value(g.item.value, d))),
    };
  },
  list: (w) => {
    const list = el("div", { class: "w-list" });
    return {
      node: list,
      update: (d) => {
        const items = value(w.value, d).items || [];
        if (!items.length) return list.replaceChildren(el("div", { class: "w-empty" }, w.empty || "Nothing to show."));
        list.replaceChildren(...items.slice(0, 5).map((item) =>
          el("div", { class: "w-item" }, el("div", { class: "w-title" }, item.subtext || ""), el("div", { class: "w-item-text" }, item.text))));
      },
    };
  },
  "text-button": (w) => {
    const title = el("div", { class: "w-title" });
    const [stat, setStat] = statText();
    const button = el("span", { class: "w-button" }, w.button || "Open");
    return {
      node: el("div", { class: "w-progress" }, title, stat, el("div", { class: "w-grow" }), button),
      update: (d) => {
        const v = value(w.value, d);
        title.textContent = v.title || w.label;
        setStat(v);
      },
    };
  },
  // A web search bar (the desktop's, in desktop mode): your search engine,
  // in a new tab. In the picker, just its look.
  search: (w, preview) => {
    const input = el(preview ? "span" : "input", preview ? { class: "w-search-input" }
      : { class: "w-search-input", type: "search", placeholder: "Search the web", "aria-label": "Search the web", autocomplete: "off", enterkeyhint: "search" },
    preview ? "Search the web" : "");
    const form = el(preview ? "div" : "form", { class: "w-search", ...(preview ? {} : { role: "search" }) },
      svg(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"]), input);
    if (!preview) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        window.open(state.searchUrl.replaceAll("{QUERY}", encodeURIComponent(q)), "_blank", "noopener,noreferrer");
        input.value = "";
      });
    }
    return { node: form, update: () => {} };
  },
  clock: () => {
    const time = el("div", { class: "w-clock" });
    const date = el("div", { class: "w-title" });
    const tick = () => {
      const now = new Date();
      time.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      date.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    };
    tick();
    return { node: el("div", { class: "w-clockface" }, time, date), update: tick };
  },
};

// ------------------------------------------------------------- desktop

function widgetDef(id) {
  return widgets.catalog?.widgets.find((w) => w.id === id);
}

function openWidget(w) {
  const target = w.open || "";
  if (target === "app-store") return openStore();
  if (target === "live-usage") return openUsage();
  if (target === "settings") return openSettings();
  if (target.startsWith("settings:")) return openSettings(target.slice("settings:".length));
}

// One widget as it sits on the desktop (or, `preview`, in the picker).
function widgetNode(w, { preview = false } = {}) {
  const type = TYPES[w.type];
  if (!type) return null;
  const body = type(w, preview);
  // A widget you type into (search) isn't a button.
  const typed = w.type === "search";
  const panel = el(preview || typed ? "div" : "button", { class: "widget-panel", "data-widget": w.id, "data-type": w.type }, body.node);
  if (!preview && !typed) {
    panel.type = "button";
    panel.setAttribute("aria-label", w.label);
    if (w.open) panel.addEventListener("click", () => openWidget(w));
    else panel.classList.add("static");
  }
  body.update(widgets.data);
  return { node: el("div", { class: "widget" }, panel, el("span", { class: "widget-label" }, w.label)), update: body.update };
}

// Called by layout() with how many widgets fit; draws them when that or the
// selection changes.
let drawnKey = "";
function drawWidgets(fit) {
  widgets.slots = fit;
  if (!widgets.catalog || !widgets.selected) return;
  const chosen = widgets.selected.map(widgetDef).filter((w) => w && !w.desk).slice(0, fit); // "desk": desktop mode's only
  const key = `${fit}:${chosen.map((w) => w.id).join(",")}`;
  if (key === drawnKey) return;
  drawnKey = key;
  widgets.live = [];
  const nodes = [];
  for (const w of chosen) {
    const made = widgetNode(w);
    if (!made) continue;
    widgets.live.push(made.update);
    nodes.push(made.node);
  }
  // Nothing chosen: one slot that says how to add some.
  if (!nodes.length && fit > 0) {
    const panel = el("button", { class: "widget-panel", type: "button", "aria-label": "Add widgets" },
      el("span", { class: "widget-empty" }, svg(["M12 5v14", "M5 12h14"]), "Add widgets"));
    panel.addEventListener("click", editWidgets);
    nodes.push(el("div", { class: "widget" }, panel, el("span", { class: "widget-label" }, "Widgets")));
  }
  $("widgets").replaceChildren(...nodes);
}

function redrawWidgets() {
  drawnKey = "";
  drawWidgets(widgets.slots);
}

async function loadWidgetCatalog() {
  if (widgets.catalog) return widgets.catalog;
  const response = await fetch("/static/widgets-catalog.json", { credentials: "same-origin" });
  widgets.catalog = await response.json();
  return widgets.catalog;
}

async function refreshWidgets() {
  let result;
  try {
    await loadWidgetCatalog();
    result = await api("/api/widgets");
  } catch {
    return;
  }
  if (result.status === 401) return showLock();
  if (result.status !== 200 || !result.body) return;
  widgets.data = result.body.data;
  const selected = result.body.selected;
  if (!widgets.selected || selected.join(",") !== widgets.selected.join(",")) {
    widgets.selected = selected;
    redrawWidgets();
  }
  widgets.live.forEach((update) => update(widgets.data));
  updateDeskWidgets(widgets.data);
}

function startWidgets() {
  stopWidgets();
  refreshWidgets();
  widgets.timer = setInterval(() => {
    // In desktop mode the desktop's widgets sit beside open windows: still live.
    if (!document.hidden && !$("desktop").hidden && (desktopMode() || !document.body.classList.contains("sheet-open"))) refreshWidgets();
  }, WIDGET_REFRESH_MS);
}

function stopWidgets() {
  clearInterval(widgets.timer);
  widgets.timer = null;
}

async function saveWidgets(next) {
  const { status, body } = await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widgets: next }),
  }).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) {
    toast(body?.error || "Couldn't save your widgets.");
    return false;
  }
  widgets.selected = next;
  redrawWidgets();
  if (typeof renderSide === "function" && !$("settings").hidden) renderSide();
  return true;
}

function removeWidget(id) {
  saveWidgets(widgets.selected.filter((w) => w !== id));
}

// ----------------------------------------------------------- the picker

// Every widget with live data; click to add or remove, up to `max`.
async function editWidgets() {
  closeMenu();
  await loadWidgetCatalog();
  if (!widgets.data) await refreshWidgets();
  widgets.selected ||= [];
  const max = widgets.catalog.max || 3;
  const count = el("span", { class: "picker-count" });
  const grid = el("div", { class: "picker-grid" });
  const draw = () => {
    count.textContent = `${widgets.selected.length} of ${max} chosen`;
    grid.replaceChildren(...widgets.catalog.widgets.filter((w) => !w.desk).map((w) => {
      const made = widgetNode(w, { preview: true });
      if (!made) return "";
      const position = widgets.selected.indexOf(w.id);
      const option = el("button", { type: "button", class: "picker-option", "aria-pressed": String(position >= 0),
        title: w.description || w.label }, made.node,
      el("span", { class: "picker-check", "aria-hidden": "true" }, position >= 0 ? String(position + 1) : ""));
      option.addEventListener("click", async () => {
        let next;
        if (position >= 0) next = widgets.selected.filter((id) => id !== w.id);
        else if (widgets.selected.length >= max) return toast(`Up to ${max} widgets. Remove one first.`);
        else next = [...widgets.selected, w.id];
        if (await saveWidgets(next)) draw();
      });
      return option;
    }));
  };
  draw();
  const done = el("button", { type: "button", class: "button-primary wide" }, "Done");
  done.addEventListener("click", closeModal);
  const dialog = el("div", { class: "dialog material widget-picker", role: "dialog", "aria-modal": "true", "aria-label": "Edit widgets" },
    el("div", { class: "picker-head" }, el("h2", {}, "Widgets"), count),
    el("p", { class: "picker-note" }, "Pick what your desktop shows. They fill in from left to right in the order you pick them."),
    grid, el("div", { class: "dialog-actions" }, done));
  openModal(dialog);
}
