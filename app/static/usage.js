// Live Usage: CPU, memory, storage and temperature as they change, and which
// apps use the most. The machine's numbers come from GET /api/widgets every
// 2 seconds; each app's share from the helper's app-usage action (one
// `docker stats` sample) every 10. Charts are single-series lines, white on
// the window's glass like everything else here.
// Uses $, el, api, toast, state, plateFor, appById, isOpen, markDockOpen,
// closeSettings, closeStore, showLock (app.js / settings.js / store.js) and
// bytes, postAction, waitForJob.
"use strict";

const USAGE_TICK_MS = 2000;
const USAGE_APPS_MS = 10000;
const USAGE_HISTORY = 90; // samples: 3 minutes at 2 s

const usage = {
  timer: null,
  appsTimer: null,
  history: { cpu: [], memory: [], temperature: [] }, // {t, v}
  latest: null, // the system numbers
  apps: null, // from app-usage
  appsError: null,
  measuring: false,
  tab: "cpu", // the By app list: cpu or memory
  tiles: {}, // id -> {update(), ...}
};

// ------------------------------------------------------- open and close

function toggleUsage() { toggleWindow("usage", openUsage); }

function openUsage() {
  openWindow("usage");
  history.replaceState(null, "", "#usage");
  if (!usage.tiles.cpu) buildUsage();
  tickUsage();
  measureApps();
  clearInterval(usage.timer);
  clearInterval(usage.appsTimer);
  usage.timer = setInterval(() => { if (!document.hidden) tickUsage(); }, USAGE_TICK_MS);
  usage.appsTimer = setInterval(() => { if (!document.hidden) measureApps(); }, USAGE_APPS_MS);
}

function closeUsage() {
  if (!isOpen("usage")) return;
  clearInterval(usage.timer);
  clearInterval(usage.appsTimer);
  closeWindow("usage");
  history.replaceState(null, "", location.pathname);
}

// ------------------------------------------------------------- numbers

const percent = (used, total) => (total ? (100 * used) / total : null);

function push(series, value) {
  if (value == null || Number.isNaN(value)) return;
  const list = usage.history[series];
  list.push({ t: Date.now(), v: value });
  if (list.length > USAGE_HISTORY) list.splice(0, list.length - USAGE_HISTORY);
}

async function tickUsage() {
  let result;
  try {
    result = await api("/api/widgets");
  } catch {
    return;
  }
  if (result.status === 401) return showLock();
  if (result.status !== 200 || !result.body) return;
  const s = result.body.data.system;
  usage.latest = s;
  push("cpu", s.cpu);
  push("memory", s.memory && percent(s.memory.used, s.memory.total));
  push("temperature", s.temperature);
  for (const tile of Object.values(usage.tiles)) tile.update();
}

async function measureApps() {
  if (usage.measuring) return;
  usage.measuring = true;
  try {
    const { status, body } = await postAction("app-usage");
    if (status === 401) return showLock();
    if (status !== 202 || !body) {
      usage.appsError = status === 400 ? "This homelab's helper doesn't measure apps yet: re-run ./install.sh." : "Can't reach your homelab right now.";
      return renderByApp();
    }
    const job = await waitForJob(body);
    if (!job) return;
    if (job.status === "failed") usage.appsError = `The helper couldn't measure your apps: ${job.error || "see Settings"}.`;
    else if (job.result?.error) usage.appsError = job.result.error;
    else {
      usage.appsError = null;
      usage.apps = job.result;
    }
    renderByApp();
  } finally {
    usage.measuring = false;
  }
}

// --------------------------------------------------------------- charts

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// A single-series line over the last few minutes: a 2px line, a faint wash
// under it, a dot on the latest value, two recessive gridlines. Hovering
// shows a crosshair and the value at that moment.
function lineChart({ min, max, format, label }) {
  const W = 300;
  const H = 72;
  const svg = svgEl("svg", { class: "u-chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img" });
  const grid = [0, 0.5, 1].map((f) => svgEl("line", { x1: 0, x2: W, y1: H - f * (H - 4) - 2, y2: H - f * (H - 4) - 2, class: "u-grid" }));
  const area = svgEl("path", { class: "u-area" });
  const line = svgEl("path", { class: "u-line" });
  const cross = svgEl("line", { class: "u-cross", y1: 0, y2: H, visibility: "hidden" });
  svg.append(...grid, area, line, cross);
  const dot = el("span", { class: "u-dot", hidden: "" });
  const tip = el("span", { class: "u-tip", hidden: "" }, el("strong"), el("span"));
  const top = el("span", { class: "u-tick top" }, format(max));
  const bottom = el("span", { class: "u-tick bottom" }, format(min));
  const box = el("div", { class: "u-chart-box" }, svg, dot, tip, top, bottom);
  let points = [];

  const xy = (i, v, n) => {
    const x = n <= 1 ? W : (i / (USAGE_HISTORY - 1)) * W + (USAGE_HISTORY - n) * (W / (USAGE_HISTORY - 1));
    const y = H - 2 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (H - 4);
    return [x, y];
  };
  const place = (node, x, y) => {
    node.style.left = `${(100 * x) / W}%`;
    node.style.top = `${(100 * y) / H}%`;
  };
  const update = (series) => {
    points = series.map((p, i) => [...xy(i, p.v, series.length), p]);
    if (!points.length) {
      line.setAttribute("d", "");
      area.setAttribute("d", "");
      dot.hidden = true;
      return;
    }
    const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    line.setAttribute("d", d);
    area.setAttribute("d", `${d}L${points.at(-1)[0].toFixed(1)},${H}L${points[0][0].toFixed(1)},${H}Z`);
    const [x, y] = points.at(-1);
    place(dot, x, y);
    dot.hidden = false;
    svg.setAttribute("aria-label", `${label}: ${format(points.at(-1)[2].v)} now, over the last ${Math.round(points.length * USAGE_TICK_MS / 1000)} seconds`);
  };
  // The crosshair finds the nearest sample to the pointer.
  box.addEventListener("pointermove", (e) => {
    if (!points.length) return;
    const r = box.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const [px, py, p] = points.reduce((best, pt) => (Math.abs(pt[0] - x) < Math.abs(best[0] - x) ? pt : best));
    cross.setAttribute("x1", px);
    cross.setAttribute("x2", px);
    cross.setAttribute("visibility", "visible");
    const ago = Math.round((Date.now() - p.t) / 1000);
    tip.firstChild.textContent = format(p.v);
    tip.lastChild.textContent = ago < 3 ? "now" : `${ago} s ago`;
    tip.hidden = false;
    place(tip, px, py);
    tip.classList.toggle("left", px > W * 0.6);
  });
  box.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
  return { node: box, update };
}

// ---------------------------------------------------------------- tiles

function usageMeter() {
  const fill = el("span");
  const node = el("div", { class: "u-meter" }, fill);
  return { node, set: (p) => {
    fill.style.width = `${Math.max(0, Math.min(100, p || 0))}%`;
    node.classList.toggle("warn", p >= 75 && p < 90);
    node.classList.toggle("high", p >= 90);
  } };
}

function usageTile(title) {
  const value = el("span", { class: "u-value" });
  const sub = el("span", { class: "u-sub" });
  const note = el("span", { class: "u-note" });
  const node = el("section", { class: "u-tile", "aria-label": title },
    el("div", { class: "u-head" }, el("h3", { class: "u-title" }, title), note),
    el("div", { class: "u-figure" }, value, sub));
  return { node, value, sub, note };
}

// A state word next to the color, never color alone.
function usageLevel(p, words = ["Normal", "Busy", "High"]) {
  return p >= 90 ? words[2] : p >= 75 ? words[1] : words[0];
}

function buildUsage() {
  const pct = (v) => `${Math.round(v)}%`;
  const deg = (v) => `${Math.round(v)}°C`;

  const cpu = usageTile("CPU");
  const cpuChart = lineChart({ min: 0, max: 100, format: pct, label: "CPU" });
  cpu.node.append(cpuChart.node);
  usage.tiles.cpu = { update: () => {
    const s = usage.latest;
    cpu.value.textContent = s?.cpu == null ? "–" : pct(s.cpu);
    cpu.sub.textContent = s?.cpus ? `of ${s.cpus} cores` : "";
    cpu.note.textContent = s?.cpu == null ? "" : usageLevel(s.cpu);
    cpuChart.update(usage.history.cpu);
  } };

  const mem = usageTile("Memory");
  const memMeter = usageMeter();
  const memChart = lineChart({ min: 0, max: 100, format: pct, label: "Memory in use" });
  mem.node.append(memMeter.node, memChart.node);
  usage.tiles.memory = { update: () => {
    const m = usage.latest?.memory;
    mem.value.textContent = m ? bytes(m.used) : "–";
    mem.sub.textContent = m ? `of ${bytes(m.total)}` : "";
    const p = m && percent(m.used, m.total);
    mem.note.textContent = m ? `${Math.round(p)}% · ${usageLevel(p)}` : "";
    memMeter.set(p);
    memChart.update(usage.history.memory);
  } };

  const disk = usageTile("Storage");
  const diskMeter = usageMeter();
  const diskFree = el("p", { class: "u-detail" });
  disk.node.append(diskMeter.node, diskFree);
  usage.tiles.disk = { update: () => {
    const d = usage.latest?.disk;
    disk.value.textContent = d ? bytes(d.used) : "–";
    disk.sub.textContent = d ? `of ${bytes(d.total)}` : "";
    const p = d && percent(d.used, d.total);
    disk.note.textContent = d ? `${Math.round(p)}% · ${usageLevel(p, ["Plenty left", "Filling up", "Nearly full"])}` : "";
    diskMeter.set(p);
    diskFree.textContent = d ? `${bytes(d.total - d.used)} free on the disk your homelab is on.` : "";
  } };

  const temp = usageTile("Temperature");
  const tempChart = lineChart({ min: 30, max: 90, format: deg, label: "Temperature" });
  temp.node.append(tempChart.node);
  usage.tiles.temperature = { update: () => {
    const t = usage.latest?.temperature;
    temp.value.textContent = t == null ? "–" : deg(t);
    temp.sub.textContent = t == null ? "no sensor" : "";
    temp.note.textContent = t == null ? "" : t >= 80 ? "Hot" : t >= 70 ? "Warm" : "Normal";
    tempChart.update(usage.history.temperature);
  } };

  $("usage-tiles").replaceChildren(cpu.node, mem.node, disk.node, temp.node);
  renderTabs();
}

// --------------------------------------------------------------- by app

function renderTabs() {
  const tabs = [{ id: "cpu", label: "CPU" }, { id: "memory", label: "Memory" }];
  $("usage-tabs").replaceChildren(...tabs.map((t) => {
    const b = el("button", { type: "button", class: "filter", role: "tab", "aria-selected": String(usage.tab === t.id) }, t.label);
    b.addEventListener("click", () => {
      usage.tab = t.id;
      renderTabs();
      renderByApp();
    });
    return b;
  }));
}

// Every installed app, biggest first; ones with nothing running at the end.
// Containers that aren't part of any app here get a line of text, not a bar.
function renderByApp() {
  const list = $("usage-apps");
  if (usage.appsError) return list.replaceChildren(el("p", { class: "store-error" }, usage.appsError));
  if (!usage.apps) return list.replaceChildren(el("p", { class: "no-results" }, "Measuring your apps…"));
  const key = usage.tab;
  const fmt = key === "cpu" ? (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%` : bytes;
  const rows = state.apps.map((app) => {
    const u = usage.apps.apps[app.id] || { cpu: 0, memory: 0, containers: 0 };
    return { app, value: u[key], containers: u.containers };
  }).sort((a, b) => (b.containers > 0) - (a.containers > 0) || b.value - a.value || a.app.name.localeCompare(b.app.name));
  // Bars share one scale: the busiest app is full width.
  const top = Math.max(...rows.map((r) => r.value), key === "cpu" ? 1 : 1e6);
  const items = rows.map((r) => {
    const fill = el("span", { class: "u-bar-fill" });
    fill.style.width = r.containers ? `${Math.max(1.5, (100 * r.value) / top)}%` : "0";
    const title = r.containers
      ? `${r.app.name}: ${fmt(r.value)} across ${r.containers} container${r.containers === 1 ? "" : "s"}`
      : `${r.app.name} has no running containers`;
    return el("li", { class: `u-row${r.containers ? "" : " idle"}`, title },
      el("span", { class: "u-row-icon" }, plateFor(r.app)),
      el("span", { class: "u-row-name" }, r.app.name),
      el("span", { class: "u-bar" }, fill),
      el("span", { class: "u-row-value" }, r.containers ? fmt(r.value) : "Not running"));
  });
  const other = usage.apps.other;
  const note = other?.containers
    ? el("p", { class: "u-other" }, `Plus ${other.containers} container${other.containers === 1 ? "" : "s"} that aren't part of an app in adlerOS, using ${fmt(other.cpu)} CPU and ${bytes(other.memory)} of memory.`)
    : "";
  list.replaceChildren(items.length ? el("ol", { class: "u-rows" }, ...items) : el("p", { class: "no-results" }, "No apps yet."), note);
}

// ------------------------------------------------------------- wiring

registerWindow("usage", { title: "Live Usage", close: closeUsage, dock: "live-usage", size: [1000, 720] });
$("usage-close").addEventListener("click", closeUsage);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !isActive("usage")) return;
  if (!$("modal").hidden || !$("search").hidden || !$("menu").hidden) return;
  e.stopImmediatePropagation();
  closeUsage();
}, true);
