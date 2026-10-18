// The App Store: every app on your home screen with what its containers are
// doing, and buttons to start, stop, restart or delete them; then the apps
// you can install. Each button is an action from scripts/agent/actions.json
// (app-start, ...), which the homelab helper runs with scripts/agent/apps.py
// on the host.
// Uses $, el, svg, api, toast, state, plateFor, groupApps, openApp from
// app.js and confirmDialog, jobDialog from settings.js.
"use strict";

const STORE_REFRESH_MS = 15000;

const store = {
  status: null, // app id -> {state, containers, files}, from the helper
  error: null, // why there's no status, when there isn't
  busy: {}, // app id -> {action, job id} while one runs
  filter: "all",
  query: "",
  timer: null,
  checking: false,
  expanded: new Set(), // app ids showing their containers
  view: "apps", // or "import"
  updates: null, // Set of images with a newer version (from Cup), or null
};

// Same spelling as the server's normalize_image: redis -> redis:latest.
function normImage(ref) {
  let r = String(ref || "").trim().replace(/^(index\.)?docker\.io\/(library\/)?/, "").replace(/^library\//, "");
  const name = r.split("@")[0];
  if (!r.includes("@") && !name.split("/").pop().includes(":")) r += ":latest";
  return r;
}

async function checkUpdates() {
  const { status, body } = await api("/api/updates").catch(() => ({ status: 0 }));
  if (status === 200 && body?.checked) {
    store.updates = new Set(body.images);
    renderApps();
  }
}

function hasUpdate(app) {
  const s = store.status?.[app.id];
  return Boolean(store.updates && s?.containers.some((c) => store.updates.has(normImage(c.image))));
}

const STATE_TEXT = {
  running: "Running",
  partial: "Partly running",
  stopped: "Stopped",
  restarting: "Restarting",
  unhealthy: "Running, unhealthy",
  removed: "No containers",
  "no-compose": "No compose file",
};

const VERBS = {
  "app-start": "Starting",
  "app-stop": "Stopping",
  "app-restart": "Restarting",
  "app-delete": "Deleting",
  "app-forget": "Removing",
  "app-install": "Installing",
  "app-update": "Updating",
};

// ------------------------------------------------------- open and close

function isOpen(id) {
  const sheet = $(id);
  return Boolean(sheet) && !sheet.hidden && !sheet.classList.contains("closing");
}

function toggleStore() { toggleWindow("store", openStore); }

function openStore() {
  openWindow("store");
  history.replaceState(null, "", "#store");
  $("store-search").value = store.query = "";
  store.view = "apps";
  renderStore();
  checkApps();
  checkUpdates();
  clearInterval(store.timer);
  store.timer = setInterval(() => { if (!document.hidden) checkApps(); }, STORE_REFRESH_MS);
}

function closeStore() {
  if (!isOpen("store")) return;
  clearInterval(store.timer);
  closeWindow("store");
  history.replaceState(null, "", location.pathname);
}

// ------------------------------------------------------------ status

// Polls a job until it ends; resolves with the finished job (or null).
async function waitForJob(job, onUpdate) {
  let since = Date.now();
  for (;;) {
    if (job.status === "done" || job.status === "failed") return job;
    // Still waiting after 20s: fine if the helper is busy with something
    // else (a backup, a big download); otherwise it isn't running.
    if (job.status === "queued" && Date.now() - since > 20000) {
      const { body } = await api("/api/jobs").catch(() => ({ body: null }));
      if (body?.jobs?.some((j) => j.status === "running")) since = Date.now();
      else return { ...job, status: "failed", error: `the helper didn't pick it up (check: systemctl status ${helperUnit()})` };
    }
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const { status, body } = await api(`/api/jobs/${job.id}`);
      if (status === 401) { showLock(); return null; }
      if (status === 200 && body) {
        job = body;
        onUpdate?.(job);
      }
    } catch { /* keep trying */ }
  }
}

async function postAction(action, params = {}) {
  try {
    return await api("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params }),
    });
  } catch {
    return { status: 0, body: null };
  }
}

// Ask the helper what every app's containers are doing.
async function checkApps() {
  if (store.checking) return;
  store.checking = true;
  try {
    const { status, body } = await postAction("app-status");
    if (status === 401) return showLock();
    if (status !== 202 || !body) {
      store.error = status === 400 ? "This homelab's helper doesn't know about the App Store yet: re-run ./install.sh."
        : "Can't reach your homelab right now.";
      return renderApps();
    }
    const job = await waitForJob(body);
    if (!job) return;
    if (job.status === "failed") {
      store.error = `The helper couldn't check your apps: ${job.error || "see Settings"}.`;
    } else if (job.result?.error) {
      store.error = job.result.error;
    } else {
      store.error = null;
      store.status = job.result?.apps || {};
    }
    renderApps();
  } finally {
    store.checking = false;
  }
}

// ------------------------------------------------------------ actions

async function appAction(app, action) {
  const name = app.name;
  if (action === "app-forget") {
    const ok = await confirmDialog({
      title: `Remove ${name} from adlerOS?`,
      body: "It leaves your home screen and the App Store. Its containers keep running and its files stay where they are; you can import it again.",
      button: "Remove",
      destructive: true,
    });
    if (!ok) return;
  }
  if (action === "app-stop") {
    const ok = await confirmDialog({ title: `Stop ${name}?`, body: "It goes offline until you start it again. Its data stays as it is.", button: "Stop" });
    if (!ok) return;
  }
  if (action === "app-delete") {
    const ok = await confirmDialog({
      title: `Delete ${name}?`,
      body: "Its containers are removed and it leaves your home screen. Its data, settings and compose files stay, so Install brings it back as it was."
        + (app.imported ? "" : " This re-runs install.sh, which takes a minute or two."),
      button: "Delete",
      destructive: true,
    });
    if (!ok) return;
  }
  if (action === "app-update") {
    const ok = await confirmDialog({
      title: `Update ${name}?`,
      body: "It pulls the newest images and recreates its containers on them, so it's offline for a moment. Its data stays. Check the app's release notes first if you like (Cup links them).",
      button: "Update",
    });
    if (!ok) return;
  }
  if (action === "app-install" && !app.imported) {
    const ok = await confirmDialog({
      title: `Install ${name}?`,
      body: app.store
        ? "adlerOS sets it up in its apps folder, with new passwords and a free port, and starts it. Longer the first time, while its images download."
        : "install.sh sets it up (its passwords, its address, its dashboard entry) and starts it. It takes a minute or two, longer if its images need downloading.",
      button: "Install",
    });
    if (!ok) return;
  }
  const { status, body } = await postAction(action, { app: app.id });
  if (status === 401) return showLock();
  if (status === 409) return toast(`Wait for "${body?.job?.label || "the current job"}" to finish first.`);
  if (status === 403 && body?.admin) return toast("That needs admin mode: Settings → System → Admin mode.");
  if (status !== 202 || !body) return toast(body?.error || "That didn't work.");
  store.busy[app.id] = { action, job: body };
  renderStore();
  const job = await waitForJob(body);
  delete store.busy[app.id];
  if (job?.status === "failed") {
    toast(`${VERBS[action] || "That"} ${name} didn't work; here's what happened.`);
    jobDialog(job, {});
  } else if (job) {
    const done = { "app-start": "started", "app-stop": "stopped", "app-restart": "restarted",
      "app-delete": "deleted", "app-forget": "removed from adlerOS", "app-install": "installed", "app-update": "updated" };
    if (action === "app-update") {
      // What Cup knew is now out of date for this app.
      for (const c of store.status?.[app.id]?.containers || []) store.updates?.delete(normImage(c.image));
    }
    toast(`${name}: ${done[action]}.`);
    // These change what's installed: the desktop and both lists move it.
    if (["app-forget", "app-delete", "app-install"].includes(action)) await refresh();
  }
  renderApps();
  checkApps();
  setTimeout(refresh, 1500); // the desktop's up/offline marks
}

// --------------------------------------------------------------- render

// Status updates redraw the app list, never an import you're filling in.
function renderApps() {
  if (store.view === "apps") renderStore();
}

function storeMatches(app) {
  const q = store.query.trim().toLowerCase();
  return !q || app.name.toLowerCase().includes(q) || app.about.toLowerCase().includes(q) || app.id.includes(q);
}

function renderStore() {
  if ($("store").hidden) return;
  $("store").classList.toggle("importing", store.view === "import");
  if (store.view === "import") return renderImport();
  const groups = groupApps();
  // Filter tabs: All, then each collection.
  const tabs = [{ id: "all", name: "All" }, ...groups];
  // Collections with nothing installed yet still get a tab for their apps.
  for (const a of state.available || []) {
    const id = a.imported ? "extras" : a.genre;
    if (!tabs.some((t) => t.id === id)) {
      tabs.push({ id, name: (state.collections.find((c) => c.id === id) || {}).name || (a.imported ? "Extras" : id[0].toUpperCase() + id.slice(1)) });
    }
  }
  if (!tabs.some((t) => t.id === store.filter)) store.filter = "all";
  $("store-filters").replaceChildren(...tabs.map((t) => {
    const b = el("button", { type: "button", class: "filter", role: "tab", "aria-selected": String(store.filter === t.id) }, t.name);
    b.addEventListener("click", () => { store.filter = t.id; renderStore(); });
    return b;
  }));

  const nodes = [];
  let shown = 0;
  if (store.error) nodes.push(el("p", { class: "store-error" }, store.error));
  if (!state.admin) {
    const core = state.apps.filter((a) => (a.home || a.genre) === "core").map((a) => a.name);
    nodes.push(el("p", { class: "store-admin-note" }, `Deleting apps${core.length ? `, and stopping, restarting or updating ${core.join(", ")} (what your network needs),` : ""} needs admin mode: Settings → System → Admin mode.`));
  }
  for (const g of groups) {
    if (store.filter !== "all" && store.filter !== g.id) continue;
    const apps = g.apps.filter(storeMatches);
    if (!apps.length) continue;
    shown += apps.length;
    nodes.push(el("h3", { class: "group-title" }, g.name));
    nodes.push(el("div", { class: "store-grid" }, ...apps.map(storeCard)));
  }
  const available = (state.available || [])
    .filter((a) => (store.filter === "all" || a.genre === store.filter || (store.filter === "extras" && a.imported)) && storeMatches(a))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (available.length) {
    shown += available.length;
    nodes.push(el("h3", { class: "group-title" }, "Not installed"));
    nodes.push(el("div", { class: "store-grid" }, ...available.map(availableCard)));
  }
  if (!shown) nodes.push(el("p", { class: "no-results" }, "No apps match."));
  $("store-apps").replaceChildren(...nodes);
}

function button(label, cls, onClick, disabled = false) {
  const b = el("button", { type: "button", class: `chip-button ${cls}` }, label);
  if (disabled) b.disabled = true;
  b.addEventListener("click", onClick);
  return b;
}

function storeCard(app) {
  const s = store.status?.[app.id];
  const busy = store.busy[app.id];
  const st = busy ? "busy" : s ? s.state : "checking";
  const update = !busy && hasUpdate(app);
  const label = busy ? `${VERBS[busy.action]}…` : s
    ? `${s.state === "partial" ? `Partly running (${s.containers.filter((c) => c.state === "running").length} of ${s.containers.length})` : STATE_TEXT[s.state] || s.state}${update ? " · Update available" : ""}`
    : store.error ? (app.up ? "Answering" : "Not answering") : "Checking…";

  const running = s && ["running", "partial", "restarting", "unhealthy"].includes(s.state);
  const actions = el("div", { class: "store-actions" });
  if (busy) {
    actions.append(button("Details", "", () => jobDialog(busy.job, {})));
  } else {
    // A core app (DNS, your proxy, passwords) is only stopped, restarted or
    // updated in admin mode, wherever you've put it; Delete always is.
    const core = (app.home || app.genre) === "core";
    const locked = core && !state.admin;
    if (running && !locked) actions.append(button("Stop", "", () => appAction(app, "app-stop")));
    if (s && !running && s.state !== "no-compose") actions.append(button("Start", "primary", () => appAction(app, "app-start")));
    if (s && s.state !== "no-compose" && !locked) actions.append(button("Restart", "", () => appAction(app, "app-restart")));
    if (s && s.state !== "no-compose" && !locked) actions.append(button("Update", update ? "primary" : "", () => appAction(app, "app-update")));
    if (s?.containers.length) actions.append(button("Logs", "", () => logsDialog(app)));
    // Core apps (Pi-hole, Vaultwarden) are always installed.
    if (s && !core && state.admin) actions.append(button("Delete", "destructive", () => appAction(app, "app-delete")));
  }
  const open = app.url ? el("a", { class: "chip-button", href: app.url, target: "_blank", rel: "noopener noreferrer" }, "Open") : "";

  const head = el("div", { class: "store-head" },
    el("span", { class: "store-icon" }, plateFor(app)),
    el("div", { class: "store-name" }, el("div", { class: "row-title" }, app.name),
      el("div", { class: `store-state ${st}` }, label)),
    open);

  const card = el("div", { class: "store-card", "data-app": app.id }, head,
    el("p", { class: "row-description" }, app.about),
    app.note ? el("p", { class: "store-note" }, `First time: ${app.note}`) : "", actions);

  if (s?.containers.length) {
    const shown = store.expanded.has(app.id);
    const toggle = el("button", { type: "button", class: "store-more", "aria-expanded": String(shown) },
      `${s.containers.length} container${s.containers.length === 1 ? "" : "s"}${s.files > 1 ? ` · ${s.files} compose files` : ""}`);
    toggle.addEventListener("click", () => {
      if (store.expanded.has(app.id)) store.expanded.delete(app.id);
      else store.expanded.add(app.id);
      renderStore();
    });
    card.append(toggle);
    if (shown) {
      card.append(el("ul", { class: "store-containers" }, ...s.containers.map((c) =>
        el("li", {}, el("span", { class: `dot ${c.state}` }), el("span", { class: "c-name" }, c.name), el("span", { class: "c-status" }, c.status)))));
    }
  }
  return card;
}

// ------------------------------------------------------------------ logs

// The app's recent logs (docker compose logs, through the helper).
async function logsDialog(app) {
  const log = el("pre", { class: "job-log logs-text", tabindex: "0", "aria-label": `${app.name} logs` }, "Reading the logs…");
  const note = el("p", { class: "job-note" });
  const refresh = el("button", { type: "button", class: "button-secondary" }, "Refresh");
  const close = el("button", { type: "button", class: "button-primary" }, "Close");
  const dialog = el("div", { class: "dialog material job logs", role: "dialog", "aria-modal": "true" },
    el("div", { class: "job-head" }, el("h2", {}, `${app.name} logs`)), note, log, el("div", { class: "dialog-actions" }, refresh, close));
  close.addEventListener("click", closeModal);
  const load = async () => {
    refresh.disabled = true;
    const { status, body } = await postAction("app-logs", { app: app.id });
    if (status === 401) return showLock();
    const job = status === 202 && body ? await waitForJob(body) : null;
    refresh.disabled = false;
    const r = job?.result;
    if (!r || job.status === "failed" || r.error) {
      log.textContent = "";
      note.textContent = `Couldn't read the logs: ${r?.error || job?.error || "the helper didn't answer"}.`;
      return;
    }
    log.textContent = r.lines.join("\n") || "(Nothing logged yet.)";
    note.textContent = `The last ${r.lines.length} lines, newest at the bottom.`;
    log.scrollTop = log.scrollHeight;
  };
  refresh.addEventListener("click", load);
  openModal(dialog);
  close.focus();
  load();
}

// An app you can install: from the catalog, or one you imported and deleted.
function availableCard(app) {
  const busy = store.busy[app.id];
  const actions = el("div", { class: "store-actions" });
  if (busy) actions.append(button("Details", "", () => jobDialog(busy.job, {})));
  else {
    actions.append(button("Install", "primary", () => appAction(app, "app-install")));
    if (app.imported) actions.append(button("Remove", "destructive", () => appAction(app, "app-forget")));
  }
  const head = el("div", { class: "store-head" },
    el("span", { class: "store-icon" }, plateFor(app)),
    el("div", { class: "store-name" }, el("div", { class: "row-title" }, app.name),
      el("div", { class: `store-state ${busy ? "busy" : "available"}` }, busy ? `${VERBS[busy.action]}…` : "Not installed")));
  return el("div", { class: "store-card", "data-app": app.id }, head,
    el("p", { class: "row-description" }, app.about), actions);
}

// ---------------------------------------------------------------- import

// Point it at a folder; it lists the compose files there (two levels down);
// you pick which to bring in, then go through them one at a time. In each,
// you tick the services that are apps of their own (one file can hold
// several: Immich and Navidrome, say) and give each a name, an address and an
// icon; every other service belongs to one of them (its database, say), so it
// starts and stops with that app. Each app lands in Extras, managed like the
// rest. Nothing is copied or moved.
const imp = {
  step: "path", // path, pick, file, run, done
  path: "",
  error: "",
  scanning: false,
  files: [], // from the scan
  chosen: [], // indexes into files, in order
  at: 0, // position in chosen
  answers: {}, // file index -> {skip, apps: {service: {name, url, icon}}, owner: {service: app service or ""}}
  results: {}, // "file index:app service" -> {state, error}
};

// Ports that aren't a web page (SSH, DNS, mail, databases, torrents, games).
const NOT_WEB = new Set([22, 222, 2222, 53, 25, 465, 587, 993, 1883, 3306, 5432, 6379, 6881, 27017, 25565]);
// Services that are rarely the app itself, so not the default pick.
const BACKING = /postgres|mysql|mariadb|redis|valkey|mongo|memcached|elastic|meili|typesense|clickhouse|minio|rabbitmq|nats|db\b/i;

function startImport() {
  Object.assign(imp, { step: "path", error: "", files: [], chosen: [], at: 0, answers: {}, results: {} });
  store.view = "import";
  renderStore();
  $("import-path")?.focus();
}

function leaveImport() {
  store.view = "apps";
  renderStore();
}

function titleCase(text) {
  return text.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function freeServices(file) {
  return (file.services || []).filter((s) => !(file.taken || {})[s.name]);
}

function webPort(svc) {
  return svc?.ports.find((p) => !NOT_WEB.has(p)) ?? svc?.ports[0];
}

// A first guess at an app's name, address and icon from its service.
function appDefaults(file, svc, only) {
  const port = webPort(svc);
  const image = (svc.image || "").split("/").pop().split(":")[0].replace(/-(server|web|app|frontend)$/, "");
  return {
    name: titleCase(only ? file.folder : svc.name).slice(0, 40),
    url: port && state.host?.tsIp ? `http://${state.host.tsIp}:${port}` : "",
    icon: /^[a-z0-9-]+$/.test(image) ? `di:${image}` : "",
  };
}

// Which app a supporting service belongs to: the app that needs it (by
// depends_on, all the way down), else the first app.
function guessOwner(file, service, appServices) {
  const needs = Object.fromEntries((file.services || []).map((s) => [s.name, s.needs || []]));
  const reaches = (from, seen = new Set()) => {
    for (const n of needs[from] || []) {
      if (n === service) return true;
      if (!seen.has(n)) {
        seen.add(n);
        if (reaches(n, seen)) return true;
      }
    }
    return false;
  };
  return appServices.find((a) => reaches(a)) || appServices[0] || "";
}

function reassignOwners(file, a) {
  const appServices = Object.keys(a.apps);
  for (const svc of freeServices(file)) {
    if (a.apps[svc.name]) delete a.owner[svc.name];
    else if (!(svc.name in a.owner) || (a.owner[svc.name] && !a.apps[a.owner[svc.name]])) {
      a.owner[svc.name] = guessOwner(file, svc.name, appServices);
    }
  }
}

function defaultAnswer(file) {
  const free = freeServices(file);
  const main = free.find((s) => s.ports.length && !BACKING.test(s.image)) || free.find((s) => !BACKING.test(s.image)) || free[0];
  const a = { skip: false, apps: {}, owner: {} };
  if (main) a.apps[main.name] = appDefaults(file, main, true);
  reassignOwners(file, a);
  return a;
}

async function scanFolder(path) {
  imp.path = path.trim();
  imp.error = "";
  if (!imp.path.startsWith("/")) {
    imp.error = "Use the full path, starting with /.";
    return renderStore();
  }
  imp.scanning = true;
  renderStore();
  const { status, body } = await postAction("app-import-scan", { path: imp.path });
  if (status === 401) return showLock();
  if (status !== 202 || !body) {
    imp.scanning = false;
    imp.error = status === 400 ? (body?.error === "invalid path" ? "That path has characters it can't use." : "This homelab's helper doesn't know about Import yet: re-run ./install.sh.")
      : "Can't reach your homelab right now.";
    return renderStore();
  }
  const job = await waitForJob(body);
  imp.scanning = false;
  const result = job?.result;
  if (!job || job.status === "failed" || !result) imp.error = `Couldn't look there: ${job?.error || "the helper didn't answer"}.`;
  else if (result.error) imp.error = result.error;
  else if (!result.files.length) imp.error = "No compose files there (it looks two folders deep).";
  else {
    imp.files = result.files;
    imp.chosen = result.files.map((f, i) => i).filter((i) => !result.files[i].error && !result.files[i].already);
    imp.step = "pick";
  }
  renderStore();
}

function renderImport() {
  const steps = { path: importPathStep, pick: importPickStep, file: importFileStep, run: importRunStep, done: importRunStep };
  $("store-apps").replaceChildren(el("div", { class: "import" }, ...steps[imp.step]()));
}

function importHead(title, text) {
  return [el("h3", { class: "import-title" }, title), text ? el("p", { class: "import-text" }, text) : ""];
}

function actionsRow(...buttons) {
  return el("div", { class: "import-actions" }, ...buttons);
}

function importPathStep() {
  const input = el("input", { id: "import-path", class: "field-input", type: "text", spellcheck: "false", autocapitalize: "off",
    placeholder: "/home/you/docker", value: imp.path, "aria-label": "Folder with your compose files" });
  const go = el("button", { type: "submit", class: "button-primary" }, imp.scanning ? "Looking…" : "Find compose files");
  if (imp.scanning) go.disabled = true;
  const form = el("form", { class: "import-path" }, input, go);
  form.addEventListener("submit", (e) => { e.preventDefault(); scanFolder(input.value); });
  return [
    ...importHead("Import apps", "Point adlerOS at a folder with your docker compose files. It looks in that folder and two levels below. Nothing is copied or moved: each app keeps running from where it is, and adlerOS can start, stop and restart it like the rest."),
    form,
    imp.error ? el("p", { class: "store-error" }, imp.error) : "",
    actionsRow(button("Cancel", "", leaveImport)),
  ];
}

function importPickStep() {
  const rows = imp.files.map((f, i) => {
    const disabled = Boolean(f.error || f.already);
    const box = el("input", { type: "checkbox" });
    box.checked = imp.chosen.includes(i);
    box.disabled = disabled;
    box.addEventListener("change", () => {
      imp.chosen = box.checked ? [...imp.chosen, i].sort((a, b) => a - b) : imp.chosen.filter((x) => x !== i);
      renderStore();
    });
    const taken = Object.keys(f.taken || {}).length;
    const note = f.already ? `Already in adlerOS (${f.already})` : f.error ? f.error
      : `${(f.services || []).map((s) => s.name).join(", ") || "no services"}${taken ? ` · ${taken} already in adlerOS` : ""}`;
    return el("label", { class: `import-file${disabled ? " disabled" : ""}` }, box,
      el("span", { class: "import-file-text" }, el("span", { class: "row-title" }, f.folder),
        el("span", { class: "import-file-path" }, f.path), el("span", { class: "row-description" }, note)));
  });
  const next = button(`Go through ${imp.chosen.length} file${imp.chosen.length === 1 ? "" : "s"}`, "primary", () => {
    imp.at = 0;
    for (const i of imp.chosen) imp.answers[i] ||= defaultAnswer(imp.files[i]);
    imp.step = "file";
    renderStore();
  }, !imp.chosen.length);
  return [
    ...importHead(`Found ${imp.files.length} compose file${imp.files.length === 1 ? "" : "s"}`, `In ${imp.path}. Pick the ones to bring in; you'll go through them one by one.`),
    el("div", { class: "import-files" }, ...rows),
    actionsRow(button("Back", "", () => { imp.step = "path"; renderStore(); }), next),
  ];
}

// The apps this file's answer makes: [{service, name, url, icon, services}].
function plannedApps(i) {
  const file = imp.files[i];
  const a = imp.answers[i];
  if (a.skip) return [];
  return Object.entries(a.apps).map(([service, app]) => ({
    service, ...app,
    services: [service, ...freeServices(file).map((s) => s.name).filter((n) => a.owner[n] === service)],
  }));
}

function importFileStep() {
  const index = imp.chosen[imp.at];
  const file = imp.files[index];
  const a = imp.answers[index];
  const total = imp.chosen.length;
  const last = imp.at === total - 1;
  const error = el("p", { class: "store-error", hidden: "" });

  const progress = el("div", { class: "w-bar import-progress" }, el("span"));
  progress.firstChild.style.width = `${Math.round((100 * (imp.at + 1)) / total)}%`;
  const text = el("pre", { class: "compose-text" }, file.text ?? "(Too long to show here.)");

  const field = (label, input) => el("label", { class: "import-field" }, el("span", { class: "row-description" }, label), input);
  const appCount = Object.keys(a.apps).length;
  const rows = (file.services || []).map((svc) => {
    const taken = (file.taken || {})[svc.name];
    const detail = el("span", { class: "row-description" }, `${svc.image}${svc.ports.length ? ` · port ${svc.ports.join(", ")}` : ""}`);
    if (taken) {
      return el("div", { class: "service-option taken" }, el("input", { type: "checkbox", disabled: "" }),
        el("span", {}, el("span", { class: "row-title" }, svc.name), detail, el("span", { class: "row-description" }, `Already part of ${taken}`)));
    }
    const isApp = Boolean(a.apps[svc.name]);
    const box = el("input", { type: "checkbox", "aria-label": `${svc.name} is an app` });
    box.checked = isApp;
    box.addEventListener("change", () => {
      if (box.checked) a.apps[svc.name] = appDefaults(file, svc, false);
      else delete a.apps[svc.name];
      reassignOwners(file, a);
      renderStore();
    });
    const body = el("span", { class: "service-body" }, el("span", { class: "row-title" }, svc.name), detail);
    if (isApp) {
      const app = a.apps[svc.name];
      const input = (key, attrs) => {
        const node = el("input", { class: "field-input", type: "text", spellcheck: "false", autocapitalize: "off", value: app[key], ...attrs });
        node.addEventListener("input", () => { app[key] = key === "name" ? node.value : node.value.trim(); });
        return node;
      };
      body.append(el("span", { class: "service-fields" },
        field("Name", input("name", { maxlength: "40" })),
        field("Address", input("url", { placeholder: "http://100.x.y.z:8080" })),
        field("Icon (di:…)", input("icon", { placeholder: "di:jellyfin" }))));
    } else {
      const select = el("select", { class: "field-input", "aria-label": `${svc.name} belongs to` },
        ...Object.entries(a.apps).map(([service, app]) => el("option", { value: service }, `Part of ${app.name || service}`)),
        el("option", { value: "" }, "Leave it out"));
      select.value = a.owner[svc.name] ?? "";
      select.addEventListener("change", () => { a.owner[svc.name] = select.value; });
      body.append(select);
    }
    return el("div", { class: `service-option${isApp ? " is-app" : ""}` }, box, body);
  });

  const skip = el("input", { type: "checkbox" });
  skip.checked = a.skip;
  const form = el("div", { class: "import-form" },
    el("div", { class: "import-label" }, "Which services are apps?"),
    el("p", { class: "row-description" }, "Tick each one with its own web page; one file can hold several apps. The rest (databases and such) belong to the app that needs them and start and stop with it."),
    el("div", { class: "service-options" }, ...rows),
    el("label", { class: "import-skip" }, skip, "Don't import this file"));
  skip.addEventListener("change", () => {
    a.skip = skip.checked;
    form.classList.toggle("skipped", a.skip);
  });
  form.classList.toggle("skipped", a.skip);

  const valid = () => {
    let problem = "";
    if (!a.skip) {
      const apps = plannedApps(index);
      if (!apps.length) problem = "Tick the service that is the app, or choose not to import this file.";
      for (const app of apps) {
        problem ||= !app.name.trim() ? `Give ${app.service} a name.`
          : !/^https?:\/\/[^\s"'<>\\]{1,300}$/.test(app.url) ? `${app.name}: the address should start with http:// or https://.`
          : app.icon && !/^di:[a-z0-9-]{1,64}$/.test(app.icon) ? `${app.name}: the icon is di: and a name in lowercase, like di:jellyfin.`
          : "";
      }
    }
    error.textContent = problem;
    error.hidden = !problem;
    return !problem;
  };
  const back = button("Back", "", () => {
    if (imp.at === 0) imp.step = "pick";
    else imp.at -= 1;
    renderStore();
  });
  const count = imp.chosen.reduce((n, i) => n + plannedApps(i).length, 0);
  const next = button(last ? `Import ${count} app${count === 1 ? "" : "s"}` : "Next", "primary", () => {
    if (!valid()) return;
    if (!last) {
      imp.at += 1;
      return renderStore();
    }
    runImports();
  });
  return [
    el("div", { class: "import-step-head" }, el("span", { class: "import-count" }, `File ${imp.at + 1} of ${total}`),
      el("span", { class: "import-file-path" }, file.path),
      appCount > 1 ? el("span", { class: "import-badge" }, `${appCount} apps`) : ""),
    progress,
    el("div", { class: "import-step" }, text, form),
    error,
    actionsRow(back, next),
  ];
}

function plannedAll() {
  return imp.chosen.flatMap((i) => plannedApps(i).map((app) => ({ ...app, file: i, key: `${i}:${app.service}` })));
}

async function runImports() {
  imp.step = "run";
  const todo = plannedAll();
  for (const app of todo) imp.results[app.key] = { state: "waiting" };
  renderStore();
  for (const app of todo) {
    imp.results[app.key] = { state: "running" };
    renderStore();
    const svc = (imp.files[app.file].services || []).find((s) => s.name === app.service);
    const params = { name: app.name.trim(), file: imp.files[app.file].path, services: app.services.join(","),
      url: app.url, icon: app.icon, port: String(webPort(svc) ?? "") };
    let response;
    for (let tries = 0; tries < 30; tries++) {
      response = await postAction("app-import", params);
      if (response.status !== 409) break;
      await new Promise((r) => setTimeout(r, 2000)); // something else is running
    }
    if (response.status === 401) return showLock();
    if (response.status !== 202) {
      imp.results[app.key] = { state: "failed", error: response.body?.error || "the helper didn't take it" };
      continue;
    }
    const job = await waitForJob(response.body);
    imp.results[app.key] = job?.status === "done" ? { state: "done" }
      : { state: "failed", error: (job?.log || []).slice(-1)[0] || job?.error || "it didn't work" };
    renderStore();
  }
  imp.step = "done";
  await refresh();
  renderStore();
  checkApps();
}

function importRunStep() {
  const todo = plannedAll();
  const done = todo.filter((app) => imp.results[app.key]?.state === "done").length;
  const label = { waiting: "Waiting", running: "Importing…", done: "Imported", failed: "Didn't work" };
  const rows = todo.map((app) => {
    const r = imp.results[app.key] || { state: "waiting" };
    const what = app.services.length > 1 ? ` · ${app.services.join(", ")}` : "";
    return el("div", { class: "import-file" }, el("span", { class: `dot ${r.state === "done" ? "running" : r.state === "failed" ? "failed" : "busy"}` }),
      el("span", { class: "import-file-text" }, el("span", { class: "row-title" }, app.name),
        el("span", { class: "row-description" }, r.state === "failed" ? `${label.failed}: ${r.error}` : `${label[r.state]}${what}`)));
  });
  const finished = imp.step === "done";
  return [
    ...importHead(finished ? `Imported ${done} of ${todo.length}` : "Importing…",
      finished ? "They're in Extras on your home screen, and here in the App Store." : ""),
    el("div", { class: "import-files" }, ...rows),
    finished ? actionsRow(button("Import more", "", startImport), button("Back to App Store", "primary", leaveImport)) : "",
  ];
}

// ------------------------------------------------------------- wiring

registerWindow("store", { title: "App Store", close: closeStore, dock: "app-store", size: [1100, 780] });
$("store-close").addEventListener("click", closeStore);
$("store-import").addEventListener("click", startImport);
$("store-search").addEventListener("input", (e) => {
  store.query = e.target.value;
  renderStore();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !isActive("store")) return;
  if (!$("modal").hidden || !$("search").hidden || !$("menu").hidden) return;
  e.stopImmediatePropagation();
  closeStore();
}, true);
