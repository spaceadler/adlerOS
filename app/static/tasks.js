// Tasks: your to-dos as Vikunja has them: Today (and what's overdue), the
// next days, and your projects, each a list (in your order, ticked off)
// or a board of buckets (Vikunja's kanban: To-Do, Doing, Done, yours),
// cards dragged between them. A task opens beside them: its name, when
// it's due, priority, labels, how it repeats, its project, notes; each
// change saved as you make it. adlerOS's server asks Vikunja (VIKUNJA_TOKEN,
// or VIKUNJA_USER and VIKUNJA_PASSWORD): the page never sees them. Before
// it's connected, the same kept in adlerOS, and moved to Vikunja once it is.
// Uses el, svg, $, api, toast, showLock, registerWindow, openWindow,
// toggleWindow, closeWindow, isOpen, winLoad/winSave, phoneLayout, appById,
// openApp, openMenu, openModal, closeModal, confirmDialog, settingsFile,
// settingsThen.
"use strict";

const TASKS_KEY = "adleros.tasks";
const TK_ICONS = {
  close: ["M18 6 6 18", "m6 6 12 12"], plus: ["M12 5v14", "M5 12h14"],
  today: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M12 14h.01"],
  upcoming: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "m10 14 2 2 4-4"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  board: ["M4 4h4v16H4z", "M10 4h4v10h-4z", "M16 4h4v13h-4z"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"], repeat: ["m17 2 4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "m7 22-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  open: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  flag: ["M4 22V4", "M4 4h13l-2 4 2 4H4"], trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6"], notes: ["M4 6h16", "M4 12h16", "M4 18h10"],
};
const TK_PRIORITY = [[0, "None"], [1, "Low"], [2, "Medium"], [3, "High"], [4, "Urgent"], [5, "Do now"]];
const TK_REPEATS = [["", "Never"], ["daily", "Every day"], ["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"], ["days", "Every so many days…"]];

const tk = {
  built: false, status: null, projects: [], labels: [], view: { kind: "today" }, tasks: [], buckets: null, done: null,
  showDone: false, open: null, selected: null, prefs: { mode: {}, last: null }, loading: 0,
};

async function tkGet(path) {
  const { status, body } = await api(`/api/tasks/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status !== 200) throw new Error(body?.error || "Vikunja didn't answer.");
  return body;
}

async function tkSend(body) {
  const { status, body: got } = await api("/api/tasks/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  if (status !== 200) { toast(got?.error || "Vikunja didn't answer."); return null; }
  return got;
}

const tkProject = (id) => tk.projects.find((p) => p.id === id);
const tkLabel = (id) => tk.labels.find((l) => l.id === id);
const tkColor = (c) => (/^#?[0-9a-f]{6}$/i.test(c || "") ? `#${c.replace("#", "")}` : "");
const tkMode = () => (tk.view.kind === "project" ? tk.prefs.mode[tk.view.id] || "list" : "list");
const tkYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tkZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

// When it's due, said: Today 18:00, Tomorrow, Fri 30 Oct; late ones red.
function tkDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86400000);
  const time = d.getHours() || d.getMinutes() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const name = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday"
    : Math.abs(days) < 7 ? d.toLocaleDateString([], { weekday: "long" })
      : d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  return { text: time && Math.abs(days) <= 1 ? `${name} ${time}` : name, late: d < new Date(), today: days === 0 };
}

// ------------------------------------------------------------ the window

async function openTasks() {
  tkBuild();
  openWindow("tasks");
  await tkCheck();
  if (!$("tasks").contains(document.activeElement)) $("tk-main").focus({ preventScroll: true });
}

function toggleTasks() { toggleWindow("tasks", () => openTasks()); }

function closeTasks() { closeWindow("tasks"); }

function tkBuild() {
  if (tk.built) return;
  tk.built = true;
  const saved = winLoad(TASKS_KEY, null);
  if (saved && typeof saved === "object") tk.prefs = { ...tk.prefs, ...saved, mode: saved.mode && typeof saved.mode === "object" ? saved.mode : {} };
  const close = el("button", { class: "sheet-close tk-close", type: "button", "aria-label": "Close Tasks" }, svg(TK_ICONS.close));
  close.addEventListener("click", closeTasks);
  const search = el("input", { class: "field-input tk-search", id: "tk-search", type: "search", placeholder: "Search", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { const q = search.value.trim(); if (q) tkShow({ kind: "search", q }); else if (tk.view.kind === "search") tkShow({ kind: "today" }); }, 300);
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; search.dispatchEvent(new Event("input")); } });
  const section = el("section", { id: "tasks", class: "sheet tasks-app", "aria-label": "Tasks", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "tk-shell", id: "tk-shell" },
      el("aside", { class: "tk-side" }, el("label", { class: "tk-search-box" }, svg(TK_ICONS.search), search), el("nav", { class: "tk-nav", id: "tk-nav", "aria-label": "Tasks" })),
      el("div", { class: "tk-body" }, el("div", { class: "tk-note", id: "tk-note", hidden: "" }), el("main", { class: "tk-main", id: "tk-main", tabindex: "-1" })),
      el("aside", { class: "tk-detail", id: "tk-detail", tabindex: "-1", hidden: "" })));
  document.body.insertBefore(section, $("modal"));
  registerWindow("tasks", { title: "Tasks", close: closeTasks, hide: () => closeWindow("tasks"), dock: "tasks", size: [1180, 780] });
  section.addEventListener("keydown", tkKeys);
}

async function tkCheck() {
  tk.status = await tkGet("status").catch((e) => ({ error: e.message, local: true }));
  if (tk.status.moved) toast(`${tk.status.moved} task${tk.status.moved === 1 ? "" : "s"} kept in adlerOS moved to Vikunja.`);
  await tkLoadMeta();
  if (tk.view.kind === "project" && !tkProject(tk.view.id)) tk.view = { kind: "today" };
  if (tk.prefs.last && tk.view.kind === "today" && !tk.shownOnce && tkProject(tk.prefs.last)) tk.view = { kind: "project", id: tk.prefs.last };
  tk.shownOnce = true;
  tkRenderNote();
  tkShow(tk.view);
}

async function tkLoadMeta() {
  const [p, l] = await Promise.all([tkGet("projects").catch(() => ({ projects: [] })), tkGet("labels").catch(() => ({ labels: [] }))]);
  tk.projects = p.projects || [];
  tk.labels = l.labels || [];
  tkRenderSide();
}

function tkSave() { winSave(TASKS_KEY, tk.prefs); }

// Above it: kept here until Vikunja's connected (or why it isn't answering).
function tkRenderNote() {
  const note = $("tk-note");
  const s = tk.status || {};
  if (s.ok) { note.hidden = true; return; }
  const file = settingsFile();
  const text = s.error === "novikunja"
    ? `Kept in adlerOS for now. Vikunja isn't among your apps here: install it (the App Store has it), or set VIKUNJA_URL in ${file} to where it runs; then they move to it.`
    : s.error === "nologin"
      ? `Kept in adlerOS for now: connect Vikunja and they move there. In Vikunja: Settings → API Tokens → a new token (tasks, projects, labels), put in ${file} as VIKUNJA_TOKEN=…${settingsThen()}. Or your login, as VIKUNJA_USER and VIKUNJA_PASSWORD.`
      : s.error === "refused"
        ? `Vikunja didn't take the token (or login) in ${file}: make a new one (Settings → API Tokens).`
        : `Vikunja isn't answering${s.url ? ` at ${s.url}` : ""}. Is it running? (The App Store starts it.) Until it is, Tasks can't show what's there.`;
  const retry = el("button", { type: "button", class: "chip-button" }, "Check again");
  retry.addEventListener("click", tkCheck);
  note.replaceChildren(el("p", {}, text), retry);
  note.hidden = false;
}

// The side: Today, Upcoming, your projects (+), Vikunja itself.
function tkRenderSide() { tkKeepFocus(tkRenderSideNow); }

function tkRenderSideNow() {
  const nav = $("tk-nav");
  if (!nav) return;
  const item = (label, icon, view, color = null, count = null) => {
    const on = tk.view.kind === view.kind && tk.view.id === view.id;
    const mark = color !== null ? el("span", { class: "tk-dot" }) : svg(TK_ICONS[icon]);
    if (color !== null) mark.style.background = tkColor(color) || "rgb(255 255 255 / 0.4)";
    const b = el("button", { type: "button", class: `tk-nav-item${on ? " on" : ""}`, "data-view": view.kind, ...(view.id ? { "data-id": view.id } : {}) },
      mark, el("span", { class: "tk-nav-name" }, label), ...(count ? [el("span", { class: "tk-nav-count" }, String(count))] : []));
    b.addEventListener("click", () => tkShow(view));
    if (view.kind === "project") {
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, tkProjectMenu(tkProject(view.id))); });
      tkDropOnProject(b, view.id);
    }
    return b;
  };
  const add = el("button", { type: "button", class: "tk-nav-item tk-nav-add" }, svg(TK_ICONS.plus), el("span", {}, "New project"));
  add.addEventListener("click", tkNewProject);
  const app = typeof appById === "function" ? appById("vikunja") : null;
  const out = tk.status?.ok && app ? el("button", { type: "button", class: "tk-nav-item tk-nav-out" }, svg(TK_ICONS.open), el("span", {}, "Open Vikunja")) : null;
  out?.addEventListener("click", () => openApp(app));
  const top = tk.projects.filter((p) => !p.parent);
  const kids = (id) => tk.projects.filter((p) => p.parent === id);
  const rows = [];
  const walk = (list, depth) => { for (const p of list) { const r = item(p.title, null, { kind: "project", id: p.id }, p.color || ""); r.style.paddingLeft = `${10 + depth * 14}px`; rows.push(r); walk(kids(p.id), depth + 1); } };
  walk(top, 0);
  for (const p of tk.projects) if (p.parent && !tkProject(p.parent)) rows.push(item(p.title, null, { kind: "project", id: p.id }, p.color || ""));
  nav.replaceChildren(item("Today", "today", { kind: "today" }), item("Upcoming", "upcoming", { kind: "upcoming" }),
    el("h3", { class: "tk-side-title" }, "Projects"), ...rows, add, ...(out ? [out] : []));
}

// ------------------------------------------------------------- showing

async function tkShow(view) {
  tk.view = view;
  if (view.kind === "project") { tk.prefs.last = view.id; tkSave(); }
  if (view.kind !== "search" && $("tk-search").value) $("tk-search").value = "";
  tkRenderSide();
  const main = $("tk-main");
  const ask = ++tk.loading;
  if (!main.firstChild) main.replaceChildren(el("p", { class: "tk-empty" }, "…"));
  try {
    if (view.kind === "project" && tkMode() === "board") {
      const got = await tkGet(`board?project=${encodeURIComponent(view.id)}`);
      if (ask !== tk.loading) return;
      tk.buckets = got.buckets;
      tk.tasks = got.buckets.flatMap((b) => b.tasks);
    } else if (view.kind === "project") {
      const got = await tkGet(`list?project=${encodeURIComponent(view.id)}`);
      if (ask !== tk.loading) return;
      tk.tasks = got.tasks;
      tk.buckets = null;
      tk.done = tk.showDone ? (await tkGet(`list?project=${encodeURIComponent(view.id)}&done=true`).catch(() => ({ tasks: [] }))).tasks : null;
    } else if (view.kind === "search") {
      const got = await tkGet(`search?q=${encodeURIComponent(view.q)}`);
      if (ask !== tk.loading) return;
      tk.tasks = got.tasks;
    } else {
      const until = new Date(); until.setDate(until.getDate() + (view.kind === "today" ? 1 : 8));
      const got = await tkGet(`due?until=${tkYmd(until)}&tz=${encodeURIComponent(tkZone())}`);
      if (ask !== tk.loading) return;
      tk.tasks = got.tasks;
    }
  } catch (e) {
    if (e.message !== "login" && ask === tk.loading) main.replaceChildren(el("p", { class: "tk-empty" }, e.message));
    return;
  }
  tkRender();
}

function tkRender() { tkKeepFocus(tkRenderNow); }

function tkRenderNow() {
  const main = $("tk-main");
  const v = tk.view;
  const scroll = main.scrollTop;
  const project = v.kind === "project" ? tkProject(v.id) : null;
  const title = v.kind === "today" ? "Today" : v.kind === "upcoming" ? "Upcoming" : v.kind === "search" ? `“${v.q}”` : project?.title || "";
  const head = el("header", { class: "tk-head" }, el("h1", {}, title));
  if (project) {
    const seg = el("div", { class: "tk-modes", role: "tablist" }, ...[["list", "List", "list"], ["board", "Board", "board"]].map(([m, label, icon]) => {
      const b = el("button", { type: "button", class: `tk-mode${tkMode() === m ? " on" : ""}`, title: `${label} (${label[0]})` }, svg(TK_ICONS[icon]), el("span", {}, label));
      b.addEventListener("click", () => tkSetMode(m));
      return b;
    }));
    const more = el("button", { type: "button", class: "tk-icon", "aria-label": "The project's menu", title: "The project" }, svg(TK_ICONS.more));
    more.addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, tkProjectMenu(project)); });
    head.append(el("div", { class: "tk-head-tools" }, seg, more));
  }
  const body = project && tkMode() === "board" ? tkBoard(project) : tkList(project);
  main.replaceChildren(head, body);
  main.scrollTop = scroll;
  tkMarkSelected();
}

function tkSetMode(m) {
  if (tk.view.kind !== "project") return;
  tk.prefs.mode[tk.view.id] = m;
  tkSave();
  tkShow(tk.view);
}

// ------------------------------------------------------------- a list

function tkList(project) {
  const box = el("div", { class: "tk-list" });
  if (project) box.append(tkAddRow(project));
  const v = tk.view;
  const tasks = tk.tasks;
  if (v.kind === "today" || v.kind === "upcoming") {
    // By day: what's late first, then each day.
    const groups = new Map();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const t of tasks) {
      const d = new Date(t.due);
      const key = d < today ? "late" : tkYmd(d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    if (v.kind === "upcoming") for (let i = 0; i < 8; i++) { const d = new Date(today); d.setDate(d.getDate() + i); if (!groups.has(tkYmd(d))) groups.set(tkYmd(d), []); }
    const keys = [...groups.keys()].sort((a, b) => (a === "late" ? -1 : b === "late" ? 1 : a.localeCompare(b)));
    for (const k of keys) {
      const list = groups.get(k);
      if (v.kind === "today" && !list.length) continue;
      const d = k === "late" ? null : new Date(`${k}T00:00:00`);
      const label = k === "late" ? "Overdue" : tkDue(d.toISOString()).text.replace(/ .*/, "") === "Today" ? "Today"
        : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
      box.append(el("h2", { class: `tk-group${k === "late" ? " late" : ""}` }, label, el("span", { class: "tk-group-count" }, list.length ? String(list.length) : "")),
        ...list.map((t) => tkRow(t, { showProject: true })));
    }
    if (!tasks.length) box.append(el("p", { class: "tk-empty" }, v.kind === "today" ? "Nothing due today, nothing late." : "Nothing due in the next week."));
    return box;
  }
  if (v.kind === "search") {
    box.append(...tasks.map((t) => tkRow(t, { showProject: true })));
    if (!tasks.length) box.append(el("p", { class: "tk-empty" }, "No open task matches."));
    return box;
  }
  const rows = el("div", { class: "tk-rows" }, ...tasks.map((t) => tkRow(t)));
  tkReorder(rows, project);
  box.append(rows);
  if (!tasks.length) box.append(el("p", { class: "tk-empty" }, "Nothing to do here. Add a task above (or press N)."));
  const toggle = el("button", { type: "button", class: "tk-link tk-show-done" }, tk.showDone ? "Hide done" : "Show done");
  toggle.addEventListener("click", () => { tk.showDone = !tk.showDone; tkShow(tk.view); });
  box.append(toggle);
  if (tk.showDone && tk.done) box.append(el("div", { class: "tk-rows tk-done-rows" }, ...tk.done.map((t) => tkRow(t))));
  return box;
}

// "Add a task": Enter adds it (to the top of what's to come).
function tkAddRow(project, bucket = null) {
  const input = el("input", { class: "tk-add-input", type: "text", placeholder: bucket ? "Add a card" : "Add a task", maxlength: "250", "aria-label": "A new task" });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { input.value = ""; input.blur(); return; }
    if (e.key !== "Enter" || !input.value.trim()) return;
    e.preventDefault();
    const title = input.value.trim();
    input.value = "";
    const task = { title };
    if (tk.view.kind === "today") { const d = new Date(); d.setHours(23, 59, 0, 0); task.due = d.toISOString(); }
    const got = await tkSend({ action: "task-create", project: project.id, task, ...(bucket ? { bucket: bucket.id } : {}) });
    if (!got) return;
    await tkShow(tk.view);
    const again = bucket ? document.querySelector(`#tasks .tk-column[data-id="${CSS.escape(bucket.id)}"] .tk-add-input`) : document.querySelector("#tasks .tk-list .tk-add-input");
    again?.focus();
  });
  return el("label", { class: "tk-add" }, svg(TK_ICONS.plus), input);
}

function tkRow(t, { showProject = false } = {}) {
  const check = el("button", { type: "button", class: `tk-check${t.done ? " on" : ""}`, role: "checkbox", "aria-checked": String(t.done), "aria-label": t.done ? "Not done" : "Done" });
  check.addEventListener("click", (e) => { e.stopPropagation(); tkToggleDone(t, check.closest(".tk-row")); });
  const due = tkDue(t.due);
  const project = showProject ? tkProject(t.project) : null;
  const meta = [
    ...(due ? [el("span", { class: `tk-due${due.late && !t.done ? " late" : due.today ? " today" : ""}` }, due.text)] : []),
    ...(t.repeat ? [el("span", { class: "tk-meta-icon", title: "Repeats" }, svg(TK_ICONS.repeat))] : []),
    ...(t.description ? [el("span", { class: "tk-meta-icon", title: "Notes" }, svg(TK_ICONS.notes))] : []),
    ...t.labels.map((id) => tkLabelChip(tkLabel(id))).filter(Boolean),
    ...(project ? [el("span", { class: "tk-proj" }, el("span", { class: "tk-dot" }), project.title)] : []),
  ];
  if (project) meta[meta.length - 1].querySelector(".tk-dot").style.background = tkColor(project.color) || "rgb(255 255 255 / 0.4)";
  const row = el("div", { class: `tk-row${t.done ? " done" : ""}`, tabindex: "0", "data-id": t.id, draggable: !showProject && !t.done ? "true" : "false" },
    check, el("div", { class: "tk-row-main" }, el("span", { class: "tk-row-title" }, t.title), ...(meta.length ? [el("span", { class: "tk-row-meta" }, ...meta)] : [])),
    ...(t.priority >= 2 ? [el("span", { class: `tk-prio p${t.priority}`, title: TK_PRIORITY[t.priority][1] }, "!".repeat(Math.min(3, t.priority - 1)))] : []));
  row._task = t;
  row.addEventListener("click", () => tkOpen(t));
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, tkTaskMenu(t)); });
  return row;
}

function tkLabelChip(l) {
  if (!l) return null;
  const chip = el("span", { class: "tk-label" }, l.title);
  const c = tkColor(l.color);
  if (c) chip.style.setProperty("--c", c);
  return chip;
}

async function tkToggleDone(t, row) {
  const done = !t.done;
  t.done = done;
  row?.classList.toggle("done", done);
  row?.querySelector(".tk-check")?.classList.toggle("on", done);
  const got = await tkSend({ action: "task-update", id: t.id, task: { done } });
  if (!got) { t.done = !done; return tkShow(tk.view); }
  if (done && t.repeat) toast(`${t.title}: done, and again ${tkDue(got.task.due)?.text?.toLowerCase() || "next time"}.`);
  // A moment to see it ticked, then where it belongs.
  setTimeout(() => tkShow(tk.view), done ? 450 : 0);
  if (tk.open?.id === t.id) tkOpen(got.task);
}

// A project's list, dragged into a new order (Vikunja's position: between its neighbours).
function tkReorder(rows, project) {
  let dragged = null;
  rows.addEventListener("dragstart", (e) => {
    dragged = e.target.closest(".tk-row");
    if (!dragged) return;
    e.dataTransfer.setData("text/x-adleros-task", dragged.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    dragged.classList.add("dragging");
  });
  rows.addEventListener("dragover", (e) => {
    if (!dragged) return;
    e.preventDefault();
    const over = e.target.closest(".tk-row");
    if (!over || over === dragged) return;
    const r = over.getBoundingClientRect();
    rows.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
  });
  rows.addEventListener("dragend", async () => {
    if (!dragged) return;
    const row = dragged;
    dragged = null;
    row.classList.remove("dragging");
    const prev = row.previousElementSibling?._task, next = row.nextElementSibling?._task;
    const t = row._task;
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 65536 : next ? next.position / 2 : t.position;
    if (position === t.position) return;
    t.position = position;
    await tkSend({ action: "task-move", id: t.id, project: project.id, position, view: "list" });
  });
}

// --------------------------------------------------------------- a board

function tkBoard(project) {
  const board = el("div", { class: "tk-board" });
  for (const b of [...(tk.buckets || [])].sort((x, y) => x.position - y.position)) {
    const title = el("h2", { class: "tk-col-title", title: "Double-click to rename" }, b.title, el("span", { class: "tk-group-count" }, String(b.tasks.length)));
    title.addEventListener("dblclick", () => tkRenameBucket(project, b));
    const more = el("button", { type: "button", class: "tk-icon tk-col-more", "aria-label": `${b.title}: its menu` }, svg(TK_ICONS.more));
    more.addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, tkBucketMenu(project, b)); });
    const cards = el("div", { class: "tk-cards" }, ...b.tasks.map((t) => tkCard(t)));
    const col = el("section", { class: `tk-column${project.doneBucket === b.id ? " done-col" : ""}`, "data-id": b.id },
      el("div", { class: "tk-col-head" }, title, more), cards, tkAddRow(project, b));
    tkDropColumn(col, cards, project, b);
    board.append(col);
  }
  const add = el("button", { type: "button", class: "tk-add-col" }, svg(TK_ICONS.plus), el("span", {}, "Add a bucket"));
  add.addEventListener("click", () => tkNewBucket(project));
  board.append(add);
  return board;
}

function tkCard(t) {
  const due = tkDue(t.due);
  const card = el("div", { class: `tk-card${t.done ? " done" : ""}`, tabindex: "0", draggable: "true", "data-id": t.id },
    el("span", { class: "tk-card-title" }, t.title),
    el("span", { class: "tk-row-meta" },
      ...(due ? [el("span", { class: `tk-due${due.late && !t.done ? " late" : due.today ? " today" : ""}` }, due.text)] : []),
      ...(t.priority >= 2 ? [el("span", { class: `tk-prio p${t.priority}` }, "!".repeat(Math.min(3, t.priority - 1)))] : []),
      ...(t.repeat ? [el("span", { class: "tk-meta-icon" }, svg(TK_ICONS.repeat))] : []),
      ...t.labels.map((id) => tkLabelChip(tkLabel(id))).filter(Boolean)));
  const c = tkColor(t.color);
  if (c) card.style.setProperty("--c", c);
  card._task = t;
  card.addEventListener("click", () => tkOpen(t));
  card.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, tkTaskMenu(t)); });
  card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/x-adleros-task", t.id); e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); tk.dragging = card; });
  card.addEventListener("dragend", () => { card.classList.remove("dragging"); tk.dragging = null; });
  return card;
}

// A card dropped in a bucket: there (done, in Done), in its place among them.
function tkDropColumn(col, cards, project, bucket) {
  col.addEventListener("dragover", (e) => {
    if (!tk.dragging) return;
    e.preventDefault();
    col.classList.add("drop");
    const over = e.target.closest(".tk-card");
    if (over && over !== tk.dragging) {
      const r = over.getBoundingClientRect();
      cards.insertBefore(tk.dragging, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
    } else if (!over && e.target.closest(".tk-cards, .tk-column") && tk.dragging.parentElement !== cards) cards.append(tk.dragging);
  });
  col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop"); });
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    col.classList.remove("drop");
    const card = tk.dragging;
    if (!card) return;
    const t = card._task;
    const prev = card.previousElementSibling?._task, next = card.nextElementSibling?._task;
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 65536 : next ? next.position / 2 : 65536;
    const moved = t.bucket !== bucket.id;
    t.bucket = bucket.id;
    t.position = position;
    const got = await tkSend({ action: "task-move", id: t.id, project: project.id, ...(moved ? { bucket: bucket.id } : {}), position, view: "board" });
    if (got && moved && project.doneBucket && (bucket.id === project.doneBucket) !== t.done) tkShow(tk.view);
    else if (!got) tkShow(tk.view);
  });
}

// A task dragged onto a project in the side: moved there.
function tkDropOnProject(node, id) {
  node.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-adleros-task") && tk.view.id !== id) { e.preventDefault(); node.classList.add("drop"); } });
  node.addEventListener("dragleave", () => node.classList.remove("drop"));
  node.addEventListener("drop", async (e) => {
    e.preventDefault();
    node.classList.remove("drop");
    const tid = e.dataTransfer.getData("text/x-adleros-task");
    if (!tid) return;
    const got = await tkSend({ action: "task-update", id: tid, project: id, task: {} });
    if (got) { toast(`Moved to ${tkProject(id)?.title || "that project"}.`); tkShow(tk.view); }
  });
}

// ----------------------------------------------------------- menus, names

function tkTaskMenu(t) {
  return [
    { label: "Open", run: () => tkOpen(t) },
    { label: t.done ? "Not done" : "Done", run: () => tkToggleDone(t, document.querySelector(`#tasks [data-id="${CSS.escape(t.id)}"]`)) },
    { label: "Due today", run: () => tkPatch(t, { due: tkEndOf(0) }) },
    { label: "Due tomorrow", run: () => tkPatch(t, { due: tkEndOf(1) }) },
    { label: "Delete", run: () => tkDelete(t), destructive: true },
  ];
}

const tkEndOf = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(23, 59, 0, 0); return d.toISOString(); };

async function tkPatch(t, changes) {
  const got = await tkSend({ action: "task-update", id: t.id, task: changes });
  if (got) { Object.assign(t, got.task); tkShow(tk.view); if (tk.open?.id === t.id) tkOpen(got.task); }
  return got;
}

async function tkDelete(t) {
  const ok = await confirmDialog({ title: `Delete “${t.title}”?`, body: tk.status?.ok ? "It goes from Vikunja too." : "It goes for good.", button: "Delete", destructive: true });
  tkFocus();
  if (!ok) return;
  if (tk.open?.id === t.id) tkClose();
  const got = await tkSend({ action: "task-delete", id: t.id });
  if (got) tkShow(tk.view);
}

function tkProjectMenu(p) {
  if (!p) return [];
  return [
    { label: "List", run: () => { tkShow({ kind: "project", id: p.id }).then(() => tkSetMode("list")); } },
    { label: "Board", run: () => { tk.view = { kind: "project", id: p.id }; tkSetMode("board"); } },
    { label: "Rename…", run: () => tkRenameProject(p) },
    { label: "Delete…", run: () => tkDeleteProject(p), destructive: true },
  ];
}

function tkBucketMenu(project, b) {
  return [
    { label: "Rename…", run: () => tkRenameBucket(project, b) },
    { label: "Delete", run: async () => {
      const ok = await confirmDialog({ title: `Delete “${b.title}”?`, body: "Its cards go to the first bucket.", button: "Delete", destructive: true });
      tkFocus();
      if (ok && await tkSend({ action: "bucket-delete", project: project.id, id: b.id })) tkShow(tk.view);
    }, destructive: true },
  ];
}

async function tkAsk(title, value = "", button = "Save") {
  const name = await nameDialog({ title, value, button });
  tkFocus();
  return name?.trim() || null;
}

async function tkNewProject() {
  const title = await tkAsk("New project", "", "Add");
  if (!title) return;
  const got = await tkSend({ action: "project-create", title });
  if (!got) return;
  await tkLoadMeta();
  if (got.project) tkShow({ kind: "project", id: got.project.id });
}

async function tkRenameProject(p) {
  const title = await tkAsk("Rename the project", p.title);
  if (title && await tkSend({ action: "project-update", id: p.id, title })) { await tkLoadMeta(); tkRender(); }
}

async function tkDeleteProject(p) {
  const ok = await confirmDialog({ title: `Delete “${p.title}”?`, body: "The project and all its tasks go for good.", button: "Delete", destructive: true });
  tkFocus();
  if (!ok || !await tkSend({ action: "project-delete", id: p.id })) return;
  await tkLoadMeta();
  tkShow({ kind: "today" });
}

async function tkNewBucket(project) {
  const title = await tkAsk("New bucket", "", "Add");
  if (title && await tkSend({ action: "bucket-create", project: project.id, title })) tkShow(tk.view);
}

async function tkRenameBucket(project, b) {
  const title = await tkAsk("Rename the bucket", b.title);
  if (title && await tkSend({ action: "bucket-update", project: project.id, id: b.id, title })) tkShow(tk.view);
}

// ------------------------------------------------------ a task, opened

function tkClose() {
  tk.open = null;
  $("tk-detail").hidden = true;
  $("tk-shell").classList.remove("with-detail");
  tkMarkSelected();
  tkFocus();
}

function tkMarkSelected() {
  document.querySelectorAll("#tasks .tk-row.open, #tasks .tk-card.open").forEach((n) => n.classList.remove("open"));
  if (tk.open) document.querySelectorAll(`#tasks [data-id="${CSS.escape(tk.open.id)}"]`).forEach((n) => { if (n.matches(".tk-row, .tk-card")) n.classList.add("open"); });
}

// Beside the list (over it, when narrow): every change saved as it's made.
function tkOpen(t) {
  tk.open = t;
  const box = $("tk-detail");
  const saved = el("span", { class: "tk-saved", "aria-live": "polite" });
  const save = async (changes, extra = {}) => {
    saved.textContent = "Saving…";
    const got = await tkSend({ action: "task-update", id: t.id, task: changes, ...extra });
    saved.textContent = got ? "Saved" : "";
    if (got) { Object.assign(t, got.task); tkShow(tk.view); }
    return got;
  };
  const close = el("button", { type: "button", class: "tk-icon tk-detail-close", "aria-label": "Close (Escape)" }, svg(TK_ICONS.close));
  close.addEventListener("click", tkClose);
  const check = el("button", { type: "button", class: `tk-check big${t.done ? " on" : ""}`, role: "checkbox", "aria-checked": String(t.done), "aria-label": "Done" });
  check.addEventListener("click", () => tkToggleDone(t, document.querySelector(`#tasks .tk-row[data-id="${CSS.escape(t.id)}"]`)));
  const title = el("textarea", { class: "tk-detail-title", rows: "1", maxlength: "250", "aria-label": "Its name" }, t.title);
  const grow = () => { title.style.height = "auto"; title.style.height = `${title.scrollHeight}px`; };
  title.addEventListener("input", grow);
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  title.addEventListener("change", () => { if (title.value.trim() && title.value.trim() !== t.title) save({ title: title.value.trim() }); });
  // Due: a day, and a time if you like.
  const d = t.due ? new Date(t.due) : null;
  const dueDay = el("input", { type: "date", class: "field-input", value: d ? tkYmd(d) : "" });
  const dueTime = el("input", { type: "time", class: "field-input", step: "300", value: d && (d.getHours() !== 23 || d.getMinutes() !== 59) ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "" });
  const clearDue = el("button", { type: "button", class: "tk-link" }, "No date");
  const putDue = () => {
    if (!dueDay.value) return save({ due: null });
    const [y, m, dd] = dueDay.value.split("-").map(Number);
    const [h, mi] = dueTime.value ? dueTime.value.split(":").map(Number) : [23, 59];
    save({ due: new Date(y, m - 1, dd, h, mi).toISOString() });
  };
  dueDay.addEventListener("change", putDue);
  dueTime.addEventListener("change", putDue);
  clearDue.addEventListener("click", () => { dueDay.value = ""; dueTime.value = ""; save({ due: null }); });
  const prio = el("select", { class: "field-input" }, ...TK_PRIORITY.map(([v, l]) => el("option", { value: String(v) }, l)));
  prio.value = String(t.priority || 0);
  prio.addEventListener("change", () => save({ priority: Number(prio.value) }));
  const rep = el("select", { class: "field-input" }, ...TK_REPEATS.map(([v, l]) => el("option", { value: v }, l)));
  rep.value = t.repeat?.kind || "";
  const days = el("input", { type: "number", class: "field-input tk-days", min: "1", max: "3650", value: String(t.repeat?.days || 2) });
  const fromDone = el("label", { class: "tk-inline" }, el("input", { type: "checkbox" }), "from when it's done");
  fromDone.firstChild.checked = Boolean(t.repeat?.fromDone);
  const putRepeat = () => {
    days.hidden = rep.value !== "days";
    fromDone.hidden = !rep.value || rep.value === "monthly";
    save({ repeat: rep.value ? { kind: rep.value, ...(rep.value === "days" ? { days: Math.max(1, Number(days.value) || 1) } : {}), ...(fromDone.firstChild.checked ? { fromDone: true } : {}) } : null });
  };
  rep.addEventListener("change", putRepeat);
  days.addEventListener("change", putRepeat);
  fromDone.firstChild.addEventListener("change", putRepeat);
  days.hidden = rep.value !== "days";
  fromDone.hidden = !rep.value || rep.value === "monthly";
  const project = el("select", { class: "field-input" }, ...tk.projects.map((p) => el("option", { value: p.id }, p.title)));
  project.value = t.project;
  project.addEventListener("change", () => save({}, { project: project.value }));
  // Labels: each one on or off, a new one added.
  const labels = el("div", { class: "tk-labels" });
  const drawLabels = () => tkKeepFocus(() => {
    labels.replaceChildren(...tk.labels.map((l) => {
      const on = t.labels.includes(l.id);
      const b = el("button", { type: "button", class: `tk-label tk-label-pick${on ? " on" : ""}`, "aria-pressed": String(on) }, l.title);
      const c = tkColor(l.color);
      if (c) b.style.setProperty("--c", c);
      b.addEventListener("click", async () => {
        const next = on ? t.labels.filter((x) => x !== l.id) : [...t.labels, l.id];
        t.labels = next;
        drawLabels();
        await save({ labels: next });
      });
      return b;
    }), (() => {
      const b = el("button", { type: "button", class: "tk-label tk-label-new" }, "+ Label");
      b.addEventListener("click", async () => {
        const name = await tkAsk("New label", "", "Add");
        if (!name) return;
        const got = await tkSend({ action: "label-create", title: name });
        if (!got) return;
        tk.labels.push(got.label);
        t.labels = [...t.labels, got.label.id];
        drawLabels();
        save({ labels: t.labels });
      });
      return b;
    })());
  });
  drawLabels();
  const notes = el("textarea", { class: "field-input tk-notes", rows: "6", placeholder: "Notes", maxlength: "50000" }, t.description || "");
  notes.addEventListener("change", () => { if (notes.value !== (t.description || "")) save({ description: notes.value }); });
  const del = el("button", { type: "button", class: "tk-link tk-delete" }, svg(TK_ICONS.trash), "Delete");
  del.addEventListener("click", () => tkDelete(t));
  const row = (label, ...fields) => el("div", { class: "tk-field" }, el("span", { class: "tk-field-label" }, label), el("div", { class: "tk-field-input" }, ...fields));
  box.replaceChildren(
    el("div", { class: "tk-detail-head" }, check, title, close),
    row("Due", dueDay, dueTime, ...(t.due ? [clearDue] : [])),
    row("Priority", prio),
    row("Repeat", rep, days, fromDone),
    row("Project", project),
    row("Labels", labels),
    notes,
    el("div", { class: "tk-detail-foot" }, del, saved, ...(t.identifier ? [el("span", { class: "tk-ident" }, t.identifier)] : [])));
  box.hidden = false;
  $("tk-shell").classList.add("with-detail");
  requestAnimationFrame(grow);
  tkMarkSelected();
}

// ------------------------------------------------------------- the keys

// A redraw takes away what had the focus: it goes to the window's list (or
// the task opened) instead, so its keys still reach it.
function tkKeepFocus(draw) {
  const inside = $("tasks")?.contains(document.activeElement);
  draw();
  if (inside && !$("tasks").contains(document.activeElement)) (tk.open && !$("tk-detail").hidden ? $("tk-detail") : $("tk-main"))?.focus({ preventScroll: true });
}

function tkFocus() { setTimeout(() => { if (isOpen("tasks") && $("modal").hidden && !$("tasks").contains(document.activeElement)) $("tk-main")?.focus({ preventScroll: true }); }, 0); }

// N a new task, ↑ ↓ (J, K) move through them, Space or X done, Enter opens
// it, E its name, Delete deletes it, L and B list and board, / search,
// Escape closes what's open.
function tkKeys(e) {
  const typing = e.target.closest("input, textarea, select");
  if (e.key === "Escape") {
    if (typing && e.target.closest(".tk-detail")) { e.target.blur(); e.preventDefault(); return; }
    if (tk.open) { e.preventDefault(); e.stopPropagation(); tkClose(); return; }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); $("tk-search").focus(); }
    return;
  }
  const rows = [...document.querySelectorAll("#tk-main .tk-row, #tk-main .tk-card")];
  const at = rows.indexOf(document.activeElement);
  const current = at >= 0 ? rows[at]._task : tk.open;
  const k = e.key.toLowerCase();
  if (k === "n") {
    const add = document.querySelector("#tk-main .tk-add-input");
    if (add) add.focus(); else toast("Pick a project for a new task.");
  } else if (e.key === "ArrowDown" || k === "j") (rows[at + 1] || rows[0])?.focus();
  else if (e.key === "ArrowUp" || k === "k") (rows[at - 1] || rows[rows.length - 1])?.focus();
  else if ((e.key === " " || k === "x") && current) tkToggleDone(current, rows[at] || null);
  else if (e.key === "Enter" && current) tkOpen(current);
  else if (k === "e" && current) { tkOpen(current); $("tk-detail").querySelector(".tk-detail-title")?.focus(); }
  else if ((e.key === "Delete" || e.key === "Backspace") && current) tkDelete(current);
  else if (k === "l") tkSetMode("list");
  else if (k === "b") tkSetMode("board");
  else if (e.key === "/") $("tk-search").focus();
  else return;
  e.preventDefault();
}
