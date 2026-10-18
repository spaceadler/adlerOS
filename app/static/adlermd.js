// adlerMD: Markdown notes in vaults, Obsidian's way, so one vault works in
// both (Obsidian on a laptop through Syncthing, and here). A vault is a
// folder: its notes, its attachments, and the .obsidian settings it reads
// (how links are written, where attachments and new notes go, line breaks,
// daily notes, templates, the graph's) and never writes. Files down the
// side, with search and tags; notes in tabs, to edit, read, or both side by
// side, saved as you go; backlinks, outgoing links and the outline; the
// graph (mdgraph.js); Bases (mdbases.js).
// Opening adlerMD (All apps, the dock, the desktop) opens your vault. A
// Markdown file opened from My Computer is Notepad's quick look instead,
// and its File → Load vault comes here (notepad.js).
// Uses $, el, svg, api, toast, registerWindow, openWindow, closeWindow,
// isOpen, toggleWindow, openMenu, openModal, closeModal, confirmDialog,
// choiceDialog, filePicker, filesPost, fileUrl, mdRender, mdFrontmatter,
// yamlParse, mdGraph, mdBase, winLoad, winSave, openInFirefox, openEntry,
// continueList, titleWindow, showLock, padKind, normalizePath.
"use strict";

const adler = {
  vault: null, vaults: [], index: null, names: new Set(), notes: new Map(), backlinks: new Map(), tags: new Map(),
  tabs: [], active: -1, pane: "files", right: winLoad("adleros.mdRight", true) !== false, expanded: new Set(),
  texts: new Map(), refreshTimer: null, built: false,
};
const MD_MODE_KEY = "adleros.mdMode";
const mdIsNote = (p) => /\.md$/i.test(p);
const mdNoteName = (p) => p.split("/").pop().replace(/\.md$/i, "");
const mdFolderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const mdFull = (rel) => `${adler.vault}/${rel}`; // its path in My Computer
const mdSetting = (file) => adler.index?.obsidian?.[file] || {};
const mdTab = () => adler.tabs[adler.active] || null;
function mdRel(path) { return path.startsWith(`${adler.vault}/`) ? path.slice(adler.vault.length + 1) : null; }
function mdNorm(path) { return normalizePath(path).slice(1); } // in the vault: no leading /

// ---------------------------------------------------------------- links

// Where a link in note `from` leads, Obsidian's way: from the note's folder,
// then from the vault's top, then a file of that name anywhere (the
// shortest path). { path, exists, heading }.
function mdResolve(from, href, wiki) {
  let raw = String(href).trim();
  const hash = raw.search(/[#^]/);
  const heading = hash >= 0 ? raw.slice(hash + 1) : "";
  raw = hash >= 0 ? raw.slice(0, hash) : raw;
  try { raw = decodeURIComponent(raw); } catch { /* as it is */ }
  if (!raw) return { path: from, exists: true, heading, self: true };
  const tries = wiki ? [] : [mdNorm(`${mdFolderOf(from)}/${raw}`)];
  tries.push(mdNorm(raw));
  for (const c of tries) for (const x of [c, `${c}.md`]) if (adler.names.has(x)) return { path: x, exists: true, heading };
  const base = raw.split("/").pop().toLowerCase();
  let best = null;
  for (const n of adler.names) {
    const b = n.split("/").pop().toLowerCase();
    if ((b === base || b === `${base}.md`) && (!best || n.length < best.length)) best = n;
  }
  if (best) return { path: best, exists: true, heading };
  const guess = wiki ? `${raw}${/\.\w+$/.test(raw) ? "" : ".md"}` : mdNorm(`${mdFolderOf(from)}/${raw}`);
  return { path: guess, exists: false, heading };
}

// A link from note `from` to `to`, as this vault writes them: [text](path)
// or [[name]], the path relative, absolute or the shortest.
function mdLinkTo(from, to, text, embed = false) {
  const app = mdSetting("app");
  const format = app.newLinkFormat || "shortest";
  const unique = [...adler.names].filter((n) => n.split("/").pop() === to.split("/").pop()).length <= 1;
  let path = format === "relative" ? mdRelative(mdFolderOf(from), to) : format === "absolute" || !unique ? to : to.split("/").pop();
  if (app.useMarkdownLinks) {
    path = path.split("/").map((p) => encodeURIComponent(p).replace(/%2C/g, ",")).join("/");
    return `${embed ? "!" : ""}[${embed ? "" : text}](${path})`;
  }
  const name = path.replace(/\.md$/i, "");
  return `${embed ? "!" : ""}[[${name}${!embed && text && text !== mdNoteName(to) ? `|${text}` : ""}]]`;
}

function mdRelative(fromDir, to) {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  return [...a.slice(k).map(() => ".."), ...b.slice(k)].join("/");
}

// ---------------------------------------------------------------- vaults

// Opening adlerMD: its window, your vault in it; `path` (a file in My
// Computer, from Notepad's Load vault): its vault, and it open.
async function openAdlermd(path = null) {
  mdBuild();
  openWindow("adlermd");
  const { status, body } = await api("/api/notes/vaults").catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) return toast(body?.error || "Can't reach your notes right now.");
  adler.vaults = body.vaults || [];
  const holding = path && adler.vaults.find((v) => path.startsWith(`${v.path}/`));
  const vault = holding?.path || (adler.vault && adler.vaults.some((v) => v.path === adler.vault) ? adler.vault : body.current);
  if (!vault) return mdWelcome();
  if (vault !== adler.vault || !adler.index) await mdLoadVault(vault);
  if (holding) mdOpen(mdRel(path));
}
function toggleAdlermd() { toggleWindow("adlermd", () => openAdlermd()); }

async function mdLoadVault(vault) {
  if (adler.vault && adler.vault !== vault) await mdSaveAll();
  const { status, body } = await api(`/api/notes/index?vault=${encodeURIComponent(vault)}`).catch(() => ({ status: 0 }));
  if (status !== 200) return toast(body?.error || "Can't open that vault.");
  const fresh = adler.vault !== vault;
  adler.vault = vault;
  adler.index = body;
  mdIndex();
  if (fresh) {
    adler.tabs = [];
    adler.active = -1;
    adler.expanded = new Set(winLoad(`adleros.mdFolders:${vault}`, []) || []);
    api("/api/notes/vaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use: vault }) }).catch(() => {});
    const saved = winLoad(`adleros.mdTabs:${vault}`, null);
    for (const t of saved?.tabs || []) if (t.kind === "graph" || adler.names.has(t.path)) adler.tabs.push(mdNewTab(t.kind, t.path));
    adler.active = Math.min(saved?.active ?? 0, adler.tabs.length - 1);
  }
  mdApplyLook();
  mdDrawAll();
  const tab = mdTab();
  if (tab && tab.text === null) mdLoadTab(tab);
  clearInterval(adler.refreshTimer);
  adler.refreshTimer = setInterval(() => { if (isOpen("adlermd") && !document.hidden) mdRefreshIndex(); }, 30000);
}

// The index again (after a save, a rename, every half minute): notes that
// changed elsewhere and aren't being edited here come back as they are now.
async function mdRefreshIndex() {
  if (!adler.vault) return;
  const { status, body } = await api(`/api/notes/index?vault=${encodeURIComponent(adler.vault)}`).catch(() => ({ status: 0 }));
  if (status !== 200 || body.vault !== adler.vault) return;
  adler.index = body;
  mdIndex();
  for (const tab of adler.tabs) {
    const f = adler.index.files.find((x) => x.path === tab.path);
    if (tab.kind === "note" && f && tab.mtime && Math.abs(f.mtime - tab.mtime) > 0.001 && !tab.dirty && !tab.saving) mdLoadTab(tab);
  }
  // Not while you're typing a search: it'd start over under you.
  if (document.activeElement?.id !== "md-search-input") mdRenderSide();
  mdRenderRight();
}

// What the index says, ready to use: names, each note's properties, tags
// and resolved links, and who links to whom.
function mdIndex() {
  adler.names = new Set(adler.index.files.map((f) => f.path));
  adler.notes = new Map();
  adler.backlinks = new Map();
  adler.tags = new Map();
  for (const f of adler.index.files) {
    if (!mdIsNote(f.path)) continue;
    let props = {};
    try { props = f.front ? yamlParse(f.front) || {} : {}; } catch { props = {}; }
    if (typeof props !== "object" || Array.isArray(props)) props = {};
    const fromProps = [].concat(props.tags ?? props.tag ?? []).flatMap((t) => String(t).split(/[\s,]+/)).filter(Boolean).map((t) => t.replace(/^#/, ""));
    const tags = [...new Set([...(f.tags || []), ...fromProps])];
    const links = (f.links || []).map((l) => ({ ...l, ...mdResolve(f.path, l.to, l.wiki) }));
    adler.notes.set(f.path, { ...f, props, tags, links });
    for (const t of tags) adler.tags.set(t, (adler.tags.get(t) || 0) + 1);
  }
  for (const [from, note] of adler.notes) {
    for (const l of note.links) {
      if (!l.exists || l.path === from) continue;
      if (!adler.backlinks.has(l.path)) adler.backlinks.set(l.path, new Set());
      adler.backlinks.get(l.path).add(from);
    }
  }
}

function mdApplyLook() {
  const look = mdSetting("appearance");
  const box = $("adlermd");
  box.style.setProperty("--md-accent", look.accentColor || "#8b7cf6");
  box.style.setProperty("--md-font-size", `${Number(look.baseFontSize) || 16}px`);
  box.classList.toggle("md-readable", mdSetting("app").readableLineLength !== false);
}

// No vault yet (a new install without NOTES_DIR): make one or open one.
function mdWelcome() {
  adler.vault = null;
  adler.index = null;
  const make = el("button", { type: "button", class: "button-primary" }, "Create a vault");
  const open = el("button", { type: "button", class: "button-secondary" }, "Open a folder as a vault");
  make.addEventListener("click", mdCreateVault);
  open.addEventListener("click", mdOpenFolderVault);
  $("md-main").replaceChildren(el("div", { class: "md-welcome" },
    el("img", { src: "/static/dock/adlermd.svg", alt: "", class: "md-welcome-icon" }),
    el("h2", {}, "adlerMD"),
    el("p", {}, "A vault is a folder of notes. Make a new one, or open a folder you have (an Obsidian vault works as it is)."),
    el("div", { class: "md-welcome-actions" }, make, open)));
  $("md-side").replaceChildren();
  $("md-right").replaceChildren();
  $("md-tabs").replaceChildren();
}

async function mdCreateVault() {
  const where = await filePicker({ title: "Where the vault goes", folder: true, start: "/user" });
  if (!where) return;
  const name = await nameDialog({ title: "Name the vault", value: "Notes", button: "Create" });
  if (!name) return;
  const reply = await mdPost("vaults", { create: { in: where, name } });
  if (reply?.vault) return openAdlermd().then(() => mdLoadVault(reply.vault));
}

async function mdOpenFolderVault() {
  const where = await filePicker({ title: "Open a folder as a vault", folder: true, start: "/user" });
  if (!where) return;
  const reply = await mdPost("vaults", { add: where, use: true });
  if (reply?.vault) {
    await openAdlermd();
    mdLoadVault(reply.vault);
  }
}

async function mdPost(what, body) {
  const { status, body: reply } = await api(`/api/notes/${what}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  if (status !== 200) { toast(reply?.error || "That didn't work."); return null; }
  return reply;
}

function mdVaultMenu(x, y) {
  openMenu(x, y, [
    ...adler.vaults.map((v) => ({ label: `${v.path === adler.vault ? "✓ " : " "}${v.name}${v.default ? " (your first)" : ""}`, run: () => mdLoadVault(v.path) })),
    { label: "Create a vault…", run: mdCreateVault },
    { label: "Open a folder as a vault…", run: mdOpenFolderVault },
    ...(adler.vault && !adler.vaults.find((v) => v.path === adler.vault)?.default
      ? [{ label: "Take this vault off the list (its folder stays)", run: async () => {
        await mdPost("vaults", { remove: adler.vault });
        adler.vault = null;
        openAdlermd();
      } }] : []),
    { label: "Show the vault in My Computer", run: () => openFiles(adler.vault) },
  ]);
}

// ------------------------------------------------------------- the window

function mdBuild() {
  if (adler.built) return;
  adler.built = true;
  const ribbonButton = (label, paths, run) => {
    const b = el("button", { type: "button", class: "md-ribbon-button", title: label, "aria-label": label }, svg(paths));
    b.addEventListener("click", run);
    return b;
  };
  const close = el("button", { class: "sheet-close md-close", type: "button", "aria-label": "Close adlerMD" }, svg(["M18 6 6 18", "m6 6 12 12"]));
  close.addEventListener("click", closeAdlermd);
  const section = el("section", { id: "adlermd", class: "sheet md-sheet", "aria-label": "adlerMD", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "md-shell" },
      el("nav", { class: "md-ribbon", "aria-label": "adlerMD" },
        ribbonButton("Files", ["M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"], () => mdPane("files")),
        ribbonButton("Search (Ctrl+Shift+F)", ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"], () => mdPane("search")),
        ribbonButton("Tags", ["M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z", "M7 7h.01"], () => mdPane("tags")),
        ribbonButton("Graph (Ctrl+G)", ["M5 6a2 2 0 1 0 0-.01", "M19 6a2 2 0 1 0 0-.01", "M12 19a2 2 0 1 0 0-.01", "M7 6h10", "m6 8 5 9", "m18 8-5 9"], () => mdOpenGraph()),
        ribbonButton("Quick switcher (Ctrl+O)", ["M4 7h16", "M4 12h16", "M4 17h10"], () => mdSwitcher()),
        ribbonButton("New note", ["M12 5v14", "M5 12h14"], () => mdNewNote()),
        ribbonButton("Today's daily note", ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"], () => mdDailyNote()),
        el("span", { class: "md-ribbon-gap" }),
        ribbonButton("Links, outline and tags", ["M3 5h18v14H3z", "M15 5v14"], () => mdToggleRight())),
      el("aside", { class: "md-side", id: "md-side" }),
      el("div", { class: "md-center" }, el("div", { class: "md-tabs", id: "md-tabs", role: "tablist" }), el("div", { class: "md-main", id: "md-main" })),
      el("aside", { class: "md-right", id: "md-right" })));
  document.body.insertBefore(section, $("modal"));
  registerWindow("adlermd", { title: "adlerMD", close: closeAdlermd, hide: () => closeWindow("adlermd"), dock: "adlermd", size: [1180, 760] });
  section.addEventListener("keydown", mdKeys);
  section.classList.toggle("md-no-right", !adler.right);
}

async function closeAdlermd() {
  await mdSaveAll();
  closeWindow("adlermd");
}

function mdKeys(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === "o") { e.preventDefault(); return mdSwitcher(); }
  if (k === "s") { e.preventDefault(); return mdSave(mdTab()); }
  if (k === "e") { e.preventDefault(); const t = mdTab(); if (t?.kind === "note") mdSetMode(t, t.mode === "read" ? "edit" : "read"); return; }
  if (k === "g") { e.preventDefault(); return mdOpenGraph(); }
  if (k === "f" && e.shiftKey) { e.preventDefault(); mdPane("search"); return $("md-search-input")?.focus(); }
}

function mdToggleRight() {
  adler.right = !adler.right;
  winSave("adleros.mdRight", adler.right);
  $("adlermd").classList.toggle("md-no-right", !adler.right);
}

function mdPane(name) {
  adler.pane = name;
  mdRenderSide();
  if (name === "search") requestAnimationFrame(() => $("md-search-input")?.focus());
}

function mdDrawAll() {
  mdRenderSide();
  mdRenderTabs();
  mdRenderMain();
  mdRenderRight();
}

// ---------------------------------------------------------- the sidebar

function mdRenderSide() {
  const side = $("md-side");
  if (!adler.index) return;
  const head = el("div", { class: "md-side-head" });
  const vaultButton = el("button", { type: "button", class: "md-vault-button", title: "Your vaults" }, adler.index.name, el("span", { "aria-hidden": "true" }, " ▾"));
  vaultButton.addEventListener("click", () => { const r = vaultButton.getBoundingClientRect(); mdVaultMenu(r.left, r.bottom + 4); });
  head.append(vaultButton);
  if (adler.pane === "files") {
    const newNote = el("button", { type: "button", class: "md-icon-button", title: "New note", "aria-label": "New note" }, svg(["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"]));
    const newFolder = el("button", { type: "button", class: "md-icon-button", title: "New folder", "aria-label": "New folder" }, svg(["M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M12 10v6", "M9 13h6"]));
    newNote.addEventListener("click", () => mdNewNote());
    newFolder.addEventListener("click", () => mdNewFolder(""));
    head.append(newNote, newFolder);
  }
  const body = el("div", { class: "md-side-body" });
  if (adler.pane === "files") body.append(mdTree());
  else if (adler.pane === "search") body.append(...mdSearchPane());
  else body.append(mdTagsPane());
  side.replaceChildren(head, body);
}

// The vault's folders and files, folders first, names A to Z; a note
// without its .md.
function mdTree() {
  const root = { folders: new Map(), files: [] };
  const at = (path) => {
    let node = root;
    for (const part of path ? path.split("/") : []) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    return node;
  };
  for (const folder of adler.index.folders) at(folder);
  for (const f of adler.index.files) at(mdFolderOf(f.path)).files.push(f.path);
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const current = mdTab()?.path;
  const draw = (node, prefix, depth) => [
    ...[...node.folders.keys()].sort(byName).map((name) => {
      const path = prefix ? `${prefix}/${name}` : name;
      const open = adler.expanded.has(path);
      const row = el("div", { class: `md-tree-row md-tree-folder${open ? " open" : ""}`, style: `--depth:${depth}`, draggable: "true", "data-path": path, tabindex: "0" },
        el("span", { class: "md-tree-caret", "aria-hidden": "true" }, "›"), el("span", { class: "md-tree-name" }, name));
      row.addEventListener("click", () => {
        if (open) adler.expanded.delete(path); else adler.expanded.add(path);
        winSave(`adleros.mdFolders:${adler.vault}`, [...adler.expanded]);
        mdRenderSide();
      });
      row.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, mdFolderMenu(path)); });
      mdDragRow(row, path, true);
      return el("div", { class: "md-tree-group" }, row, ...(open ? draw(node.folders.get(name), path, depth + 1) : []));
    }),
    ...node.files.sort((a, b) => byName(a.split("/").pop(), b.split("/").pop())).map((path) => {
      const note = mdIsNote(path);
      const row = el("div", { class: `md-tree-row md-tree-file${note ? "" : " attachment"}${path === current ? " current" : ""}`, style: `--depth:${depth}`,
        draggable: "true", "data-path": path, tabindex: "0", title: path }, el("span", { class: "md-tree-name" }, note ? mdNoteName(path) : path.split("/").pop()));
      row.addEventListener("click", (e) => mdOpen(path, { newTab: e.ctrlKey || e.metaKey }));
      row.addEventListener("auxclick", (e) => { if (e.button === 1) mdOpen(path, { newTab: true }); });
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") mdOpen(path); });
      row.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, mdFileMenu(path)); });
      mdDragRow(row, path, false);
      return row;
    }),
  ];
  const tree = el("div", { class: "md-tree", role: "tree" }, ...draw(root, "", 0));
  // Dropped on the empty space below: to the vault's top.
  tree.addEventListener("dragover", (e) => { if (e.target === tree) e.preventDefault(); });
  tree.addEventListener("drop", (e) => { if (e.target === tree) { e.preventDefault(); mdMoveInto(e.dataTransfer.getData("text/x-adlermd"), ""); } });
  return tree;
}

// Drag a file or folder onto a folder to move it there (its links follow).
function mdDragRow(row, path, isFolder) {
  row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/x-adlermd", path); e.dataTransfer.effectAllowed = "move"; });
  if (!isFolder) return;
  row.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-adlermd")) { e.preventDefault(); row.classList.add("drop-target"); } });
  row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    row.classList.remove("drop-target");
    mdMoveInto(e.dataTransfer.getData("text/x-adlermd"), path);
  });
}

function mdMoveInto(from, folder) {
  if (!from || from === folder || folder.startsWith(`${from}/`) || mdFolderOf(from) === folder) return;
  mdRename(from, folder ? `${folder}/${from.split("/").pop()}` : from.split("/").pop());
}

function mdFileMenu(path) {
  const items = [{ label: "Open", run: () => mdOpen(path) }, { label: "Open in a new tab", run: () => mdOpen(path, { newTab: true }) }];
  if (adler.index.writable) {
    items.push({ label: "Rename…", run: () => mdRenameDialog(path) },
      { label: "Move to…", run: () => mdMoveDialog(path) },
      { label: "Delete", run: () => mdDelete(path), destructive: true });
  }
  if (mdIsNote(path)) items.push({ label: "Open in Notepad", run: () => openNotepad(mdFull(path), { markdown: false }) });
  items.push({ label: "Show in My Computer", run: () => openFiles(mdFull(mdFolderOf(path) ? mdFolderOf(path) : "").replace(/\/$/, "")) });
  return items;
}

function mdFolderMenu(path) {
  return [
    ...(adler.index.writable ? [{ label: "New note here", run: () => mdNewNote(path) }, { label: "New folder here", run: () => mdNewFolder(path) },
      { label: "Rename…", run: () => mdRenameDialog(path) }, { label: "Delete", run: () => mdDelete(path), destructive: true }] : []),
    { label: "Show in My Computer", run: () => openFiles(mdFull(path)) },
  ];
}

// ----------------------------------------------------------- search, tags

function mdSearchPane() {
  const input = el("input", { id: "md-search-input", class: "field-input md-search-input", type: "search", placeholder: "Search the vault (tag:#name, path:folder)", value: adler.query || "" });
  const results = el("div", { class: "md-search-results" });
  let timer = null;
  const run = async () => {
    const q = input.value.trim();
    adler.query = q;
    if (!q) return results.replaceChildren();
    const tag = q.match(/^tag:#?(\S+)$/i);
    const path = q.match(/^path:(\S+)$/i);
    if (tag || path) {
      const hits = [...adler.notes.values()].filter((n) => (tag ? n.tags.some((t) => t === tag[1] || t.startsWith(`${tag[1]}/`)) : n.path.toLowerCase().includes(path[1].toLowerCase())));
      return results.replaceChildren(...hits.map((n) => mdHitRow(n.path, [])), ...(hits.length ? [] : [el("p", { class: "no-results" }, "Nothing.")]));
    }
    const { status, body } = await api(`/api/notes/search?vault=${encodeURIComponent(adler.vault)}&q=${encodeURIComponent(q)}`).catch(() => ({ status: 0 }));
    if (status !== 200 || input.value.trim() !== q) return;
    results.replaceChildren(...body.hits.map((h) => mdHitRow(h.path, h.lines, q)), ...(body.hits.length ? [] : [el("p", { class: "no-results" }, "Nothing.")]));
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  if (adler.query) setTimeout(run);
  return [input, results];
}

function mdHitRow(path, lines, q = "") {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const mark = (line) => {
    const out = [];
    let rest = line;
    while (rest) {
      let best = -1, len = 0;
      for (const w of words) { const i = rest.toLowerCase().indexOf(w); if (i >= 0 && (best < 0 || i < best)) { best = i; len = w.length; } }
      if (best < 0) { out.push(rest); break; }
      out.push(rest.slice(0, best), el("mark", {}, rest.slice(best, best + len)));
      rest = rest.slice(best + len);
    }
    return out;
  };
  const row = el("button", { type: "button", class: "md-hit" }, el("span", { class: "md-hit-name" }, mdNoteName(path)),
    el("span", { class: "md-hit-path" }, mdFolderOf(path)), ...lines.map((l) => el("span", { class: "md-hit-line" }, ...mark(l))));
  row.addEventListener("click", (e) => mdOpen(path, { newTab: e.ctrlKey || e.metaKey }));
  return row;
}

function mdTagsPane() {
  const tags = [...adler.tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return el("div", { class: "md-tags" }, ...tags.map(([t, n]) => {
    const b = el("button", { type: "button", class: "md-tag-row" }, el("span", {}, `#${t}`), el("span", { class: "md-count" }, String(n)));
    b.addEventListener("click", () => mdSearchFor(`tag:#${t}`));
    return b;
  }), ...(tags.length ? [] : [el("p", { class: "no-results" }, "No tags in this vault yet.")]));
}

function mdSearchFor(q) {
  adler.query = q;
  mdPane("search");
}

// ---------------------------------------------------------------- tabs

function mdNewTab(kind, path) {
  return { kind, path, text: null, mtime: null, dirty: false, saving: false, writable: true,
    mode: kind === "note" ? winLoad(MD_MODE_KEY, "read") : "read", timer: null, scroll: 0 };
}

// A file in a tab: the tab it's in already, else this one (unless its note
// has unsaved changes), or a new one.
async function mdOpen(path, { newTab = false, line = null, mode = null } = {}) {
  if (!path) return;
  const kind = mdIsNote(path) ? "note" : /\.base$/i.test(path) ? "base" : "file";
  let i = adler.tabs.findIndex((t) => t.path === path && t.kind === kind);
  if (i < 0) {
    const tab = mdNewTab(kind, path);
    if (mode) tab.mode = mode;
    const here = mdTab();
    if (!newTab && here && !here.dirty && here.kind !== "graph") {
      await mdSave(here);
      adler.tabs[adler.active] = tab;
      i = adler.active;
    } else {
      adler.tabs.splice(adler.active + 1, 0, tab);
      i = adler.active + 1;
    }
  }
  mdActivate(i);
  if (line !== null) adler.tabs[i].gotoLine = line;
}

async function mdActivate(i) {
  const prev = mdTab();
  if (prev?.kind === "note") prev.scroll = $("md-main").querySelector(".md-scroll")?.scrollTop || 0;
  adler.active = i;
  mdKeepTabs();
  const tab = mdTab();
  mdRenderTabs();
  mdRenderSide();
  if (tab && tab.text === null && tab.kind !== "graph" && tab.kind !== "file") await mdLoadTab(tab);
  else mdRenderMain();
  mdRenderRight();
}

function mdKeepTabs() {
  winSave(`adleros.mdTabs:${adler.vault}`, { tabs: adler.tabs.map((t) => ({ kind: t.kind, path: t.path })), active: adler.active });
}

async function mdCloseTab(i) {
  const tab = adler.tabs[i];
  if (tab) await mdSave(tab);
  adler.tabs.splice(i, 1);
  if (adler.active >= adler.tabs.length) adler.active = adler.tabs.length - 1;
  mdKeepTabs();
  mdDrawAll();
  const now = mdTab();
  if (now && now.text === null && now.kind !== "graph" && now.kind !== "file") mdLoadTab(now);
}

function mdRenderTabs() {
  $("md-tabs").replaceChildren(...adler.tabs.map((t, i) => {
    const name = t.kind === "graph" ? "Graph" : t.kind === "note" ? mdNoteName(t.path) : t.path.split("/").pop();
    const close = el("button", { type: "button", class: "md-tab-close", "aria-label": `Close ${name}` }, "×");
    close.addEventListener("click", (e) => { e.stopPropagation(); mdCloseTab(i); });
    const tab = el("div", { class: `md-tab${i === adler.active ? " active" : ""}`, role: "tab", "aria-selected": String(i === adler.active), title: t.path || "Graph" },
      el("span", { class: "md-tab-name" }, `${t.dirty ? "● " : ""}${name}`), close);
    tab.addEventListener("click", () => mdActivate(i));
    tab.addEventListener("auxclick", (e) => { if (e.button === 1) mdCloseTab(i); });
    return tab;
  }));
  titleWindow("adlermd", mdTab()?.path ? `${mdTab().kind === "note" ? mdNoteName(mdTab().path) : mdTab().path.split("/").pop()} — adlerMD` : "adlerMD");
}

async function mdLoadTab(tab) {
  const { status, body } = await api(`/api/files/text?path=${encodeURIComponent(mdFull(tab.path))}`).catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) {
    toast(body?.error || `Can't open ${tab.path}.`);
    tab.text = "";
    tab.writable = false;
  } else {
    Object.assign(tab, { text: body.text, mtime: body.mtime, writable: body.writable !== false && adler.index.writable, dirty: false });
  }
  if (tab === mdTab()) { mdRenderMain(); mdRenderRight(); mdRenderTabs(); }
}

// ------------------------------------------------------------ a note view

function mdRenderMain() {
  const main = $("md-main");
  const tab = mdTab();
  if (!adler.index) return;
  if (!tab) {
    const make = el("button", { type: "button", class: "button-primary" }, "New note");
    const find = el("button", { type: "button", class: "button-secondary" }, "Find a note (Ctrl+O)");
    make.addEventListener("click", () => mdNewNote());
    find.addEventListener("click", () => mdSwitcher());
    return main.replaceChildren(el("div", { class: "md-empty" }, el("p", {}, `${adler.notes.size} notes in ${adler.index.name}.`), el("div", { class: "md-welcome-actions" }, make, find)));
  }
  if (tab.kind === "graph") return main.replaceChildren(mdGraphView(tab));
  if (tab.kind === "file") return main.replaceChildren(mdFileView(tab));
  if (tab.text === null) return main.replaceChildren(el("p", { class: "md-loading" }, "Opening…"));
  if (tab.kind === "base") return main.replaceChildren(mdBaseView(tab));
  main.replaceChildren(mdNoteView(tab));
}

function mdNoteView(tab) {
  const title = el("input", { class: "md-title", type: "text", value: mdNoteName(tab.path), spellcheck: "false", "aria-label": "The note's name", ...(tab.writable ? {} : { readonly: "" }) });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } if (e.key === "Escape") { title.value = mdNoteName(tab.path); title.blur(); } });
  title.addEventListener("change", () => {
    const name = title.value.trim().replace(/[\\/:]/g, "-");
    if (!name || name === mdNoteName(tab.path)) { title.value = mdNoteName(tab.path); return; }
    const folder = mdFolderOf(tab.path);
    mdRename(tab.path, `${folder ? `${folder}/` : ""}${name}.md`);
  });
  const modes = el("div", { class: "md-modes", role: "group", "aria-label": "View" }, ...[["edit", "Edit"], ["split", "Both"], ["read", "Read"]].map(([m, label]) => {
    const b = el("button", { type: "button", class: `md-mode${tab.mode === m ? " on" : ""}`, "aria-pressed": String(tab.mode === m) }, label);
    b.addEventListener("click", () => mdSetMode(tab, m));
    return b;
  }));
  const more = el("button", { type: "button", class: "md-icon-button", title: "More", "aria-label": "More" }, svg(["M12 12h.01", "M19 12h.01", "M5 12h.01"]));
  more.addEventListener("click", () => { const r = more.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, mdNoteMenu(tab)); });
  const crumbs = el("span", { class: "md-crumbs" }, mdFolderOf(tab.path).replace(/\//g, " › "));
  const head = el("div", { class: "md-note-head" }, crumbs, el("span", { class: "md-note-state" }, !tab.writable ? "Read-only" : tab.saving ? "Saving…" : tab.dirty ? "Not saved yet" : ""), modes, more);

  const source = el("textarea", { class: "md-source", spellcheck: "true", "aria-label": "The note", ...(tab.writable ? {} : { readonly: "" }) });
  source.value = tab.text;
  const read = el("div", { class: "md-read md-view", tabindex: "0" });
  const body = el("div", { class: `md-note-body mode-${tab.mode}` }, source, read);
  const scroll = el("div", { class: "md-scroll" }, el("div", { class: "md-page" }, title, body));
  const draw = () => { read.replaceChildren(mdRender(source.value, mdCtx(tab))); };
  if (tab.mode !== "edit") draw();
  source.addEventListener("input", () => {
    tab.text = source.value;
    mdDirty(tab);
    if (tab.mode !== "edit") { clearTimeout(tab.drawTimer); tab.drawTimer = setTimeout(draw, 150); }
    mdComplete(source, tab);
  });
  source.addEventListener("keydown", (e) => mdSourceKeys(e, source, tab));
  source.addEventListener("blur", () => mdSave(tab));
  source.addEventListener("paste", (e) => mdPasteFiles(e, e.clipboardData?.files, source, tab));
  source.addEventListener("drop", (e) => mdPasteFiles(e, e.dataTransfer?.files, source, tab));
  // Reading: a double click edits there.
  read.addEventListener("dblclick", (e) => {
    if (!tab.writable || e.target.closest("a, input, summary")) return;
    const line = e.target.closest("[data-line]")?.dataset.line;
    mdSetMode(tab, tab.mode === "read" ? "edit" : tab.mode, line === undefined ? null : Number(line));
  });
  requestAnimationFrame(() => {
    scroll.scrollTop = tab.scroll || 0;
    if (tab.gotoLine !== undefined && tab.gotoLine !== null) {
      mdCaretToLine(source, tab.gotoLine);
      tab.gotoLine = null;
    } else if (tab.mode === "edit" && tab.writable) source.focus({ preventScroll: true });
    mdFit(source);
  });
  source.addEventListener("input", () => mdFit(source));
  return el("div", { class: "md-note" }, head, scroll);
}

// The editor grows with its text: the page scrolls, not the box.
function mdFit(area) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
}

function mdCaretToLine(area, line) {
  const lines = area.value.split("\n");
  const at = lines.slice(0, Math.max(0, line)).join("\n").length + (line > 0 ? 1 : 0);
  area.focus({ preventScroll: true });
  area.setSelectionRange(at, at);
  const top = area.offsetTop + (line / Math.max(1, lines.length)) * area.scrollHeight;
  area.closest(".md-scroll")?.scrollTo({ top: Math.max(0, top - 120) });
}

function mdSetMode(tab, mode, line = null) {
  tab.mode = mode;
  if (tab.kind === "note") winSave(MD_MODE_KEY, mode); // the next note opens the way you last chose
  if (line !== null) tab.gotoLine = line;
  mdRenderMain();
}

function mdNoteMenu(tab) {
  const items = [];
  if (tab.writable) {
    items.push({ label: "Rename…", run: () => mdRenameDialog(tab.path) }, { label: "Move to…", run: () => mdMoveDialog(tab.path) });
    const tpl = mdSetting("templates").folder;
    if (tpl) items.push({ label: "Insert a template…", run: () => mdInsertTemplate(tab) });
  }
  items.push({ label: "This note's graph", run: () => mdOpenGraph(tab.path) },
    { label: "Copy a link to it", run: () => navigator.clipboard?.writeText(mdLinkTo(tab.path, tab.path, mdNoteName(tab.path))).then(() => toast("Copied.")) },
    { label: "Open in Notepad", run: () => openNotepad(mdFull(tab.path), { markdown: false }) },
    { label: "Show in My Computer", run: () => openFiles(mdFull(mdFolderOf(tab.path)).replace(/\/$/, "")) });
  if (tab.writable) items.push({ label: "Delete", run: () => mdDelete(tab.path), destructive: true });
  return items;
}

// What the renderer needs of the vault: where links go, what embeds show.
function mdCtx(tab) {
  return {
    strictLineBreaks: mdSetting("app").strictLineBreaks === true,
    properties: mdSetting("app").propertiesInDocument !== "hidden",
    resolve: (href, wiki) => mdResolve(tab.path, href, wiki),
    open: (link, e) => mdFollow(link, e, tab),
    tag: (t) => mdSearchFor(`tag:#${t}`),
    toggleTask: tab.writable ? (line, done) => {
      const lines = tab.text.split("\n");
      lines[line] = lines[line].replace(/\[(.)\]/, done ? "[x]" : "[ ]");
      tab.text = lines.join("\n");
      mdDirty(tab, 300);
      const src = $("md-main").querySelector(".md-source");
      if (src) src.value = tab.text;
    } : null,
    embed: (target, opts) => mdVaultEmbed(tab, target, opts),
    base: (yaml) => mdBase(yaml, mdBaseCtx(tab)),
  };
}

async function mdFollow(link, e, tab) {
  if (link.external) {
    if (!(await openInFirefox(link.href, "the link"))) window.open(link.href, "_blank", "noopener,noreferrer");
    return;
  }
  const t = link.target;
  if (!t) return;
  if (t.self) return mdScrollToHeading(t.heading);
  const newTab = e?.ctrlKey || e?.metaKey;
  if (!t.exists) {
    // A link to nothing yet: Obsidian makes the note.
    if (!mdIsNote(t.path)) return toast(`${t.path} isn't in the vault.`);
    if (!tab.writable) return toast("This vault is read-only here.");
    const made = await mdCreate(t.path, "");
    if (made) mdOpen(made, { newTab, mode: "edit" });
    return;
  }
  await mdOpen(t.path, { newTab });
  if (t.heading) setTimeout(() => mdScrollToHeading(t.heading), 200);
}

function mdScrollToHeading(heading) {
  if (!heading) return;
  const id = `h-${mdSlug(heading.replace(/^\^/, ""))}`;
  const node = $("md-main").querySelector(`[id="${CSS.escape(id)}"]`);
  node?.scrollIntoView({ block: "start", behavior: "smooth" });
}

// ![[…]] and ![](…): a picture, another note (or its section), a PDF, a
// video or a song, a Base.
function mdVaultEmbed(tab, target, opts) {
  const r = mdResolve(tab.path, target, opts.wiki);
  if (!r.exists) return el("span", { class: "md-embed-missing" }, `${target} isn't in the vault`);
  const url = fileUrl(mdFull(r.path), true);
  const kind = padKind(r.path);
  if (kind === "image") return el("img", { class: "md-embed-image", src: url, alt: opts.alt || "", loading: "lazy", ...(opts.width ? { width: opts.width } : {}) });
  if (kind === "video") return el("video", { class: "md-embed-media", src: url, controls: "" });
  if (kind === "audio") return el("audio", { class: "md-embed-media", src: url, controls: "" });
  if (kind === "pdf") return el("iframe", { class: "md-embed-pdf", src: url, title: r.path });
  if (/\.base$/i.test(r.path)) {
    const box = el("div", { class: "md-embed-base" }, "…");
    mdText(r.path).then((text) => box.replaceChildren(mdBase(text, mdBaseCtx(tab))));
    return box;
  }
  if (!mdIsNote(r.path) || (opts.depth || 0) > 2) return null;
  const box = el("div", { class: "md-embed-note" }, el("div", { class: "md-embed-title" }, mdNoteName(r.path)));
  box.addEventListener("dblclick", () => mdOpen(r.path));
  mdText(r.path).then((text) => {
    let part = text;
    if (r.heading && !r.heading.startsWith("^")) {
      // Just that heading's section.
      const lines = text.split("\n");
      const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && mdSlug(l.replace(/^#+\s*/, "")) === mdSlug(r.heading));
      if (start >= 0) {
        const level = lines[start].match(/^#+/)[0].length;
        const end = lines.findIndex((l, k) => k > start && new RegExp(`^#{1,${level}}\\s`).test(l));
        part = lines.slice(start, end < 0 ? undefined : end).join("\n");
      }
    }
    const ctx = { ...mdCtx({ ...tab, path: r.path, writable: false }), properties: false };
    box.append(el("div", { class: "md-embed-body md-view" }, mdRender(part, ctx)));
  });
  return box;
}

async function mdText(rel) {
  const f = adler.index.files.find((x) => x.path === rel);
  const key = `${rel}:${f?.mtime}`;
  if (adler.texts.has(key)) return adler.texts.get(key);
  const open = adler.tabs.find((t) => t.path === rel && t.text !== null);
  if (open) return open.text;
  const { status, body } = await api(`/api/files/text?path=${encodeURIComponent(mdFull(rel))}`).catch(() => ({ status: 0 }));
  const text = status === 200 ? body.text : "";
  adler.texts.set(key, text);
  return text;
}

function mdFileView(tab) {
  const url = fileUrl(mdFull(tab.path), true);
  const kind = padKind(tab.path);
  const media = kind === "image" ? el("img", { src: url, alt: tab.path }) : kind === "video" ? el("video", { src: url, controls: "" })
    : kind === "audio" ? el("audio", { src: url, controls: "" }) : kind === "pdf" ? el("iframe", { src: url, title: tab.path }) : null;
  if (!media) {
    const open = el("button", { type: "button", class: "button-secondary" }, "Open it");
    open.addEventListener("click", () => openEntry({ name: tab.path.split("/").pop(), dir: false, kind: padKind(tab.path), size: 0 }, mdFull(tab.path)));
    return el("div", { class: "md-empty" }, el("p", {}, tab.path), open);
  }
  return el("div", { class: `md-file md-file-${kind}` }, media);
}

// ------------------------------------------------------------- editing

function mdSourceKeys(e, area, tab) {
  if (adler.complete && mdCompleteKeys(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Tab" && !mod && !e.altKey && !area.readOnly) {
    e.preventDefault();
    e.stopPropagation();
    // In a list: the whole item in (or, with Shift, out); else a tab.
    const start = area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
    const line = area.value.slice(start, area.value.indexOf("\n", start) < 0 ? undefined : area.value.indexOf("\n", start));
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      const caret = area.selectionStart;
      if (e.shiftKey) {
        const cut = line.match(/^(\t| {1,4})/)?.[0].length || 0;
        area.setRangeText("", start, start + cut, "preserve");
        area.setSelectionRange(Math.max(start, caret - cut), Math.max(start, caret - cut));
      } else {
        area.setRangeText("\t", start, start, "preserve");
        area.setSelectionRange(caret + 1, caret + 1);
      }
    } else if (!e.shiftKey) document.execCommand("insertText", false, "\t");
    area.dispatchEvent(new Event("input"));
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !mod && !area.readOnly && continueList(area)) {
    e.preventDefault();
    area.dispatchEvent(new Event("input"));
    return;
  }
  if (mod && !e.shiftKey && (e.key === "b" || e.key === "i")) {
    e.preventDefault();
    const mark = e.key === "b" ? "**" : "*";
    const [a, b] = [area.selectionStart, area.selectionEnd];
    const sel = area.value.slice(a, b);
    document.execCommand("insertText", false, `${mark}${sel}${mark}`);
    if (!sel) area.setSelectionRange(a + mark.length, a + mark.length);
    area.dispatchEvent(new Event("input"));
  }
}

// Typing [[: the notes whose names match, to link to (this vault's way).
function mdComplete(area, tab) {
  const before = area.value.slice(0, area.selectionStart);
  const m = before.match(/\[\[([^\]\n]*)$/);
  if (!m) return mdCompleteClose();
  const q = m[1].toLowerCase();
  const matches = [...adler.notes.keys()].filter((p) => mdNoteName(p).toLowerCase().includes(q) || p.toLowerCase().includes(q))
    .sort((a, b) => (mdNoteName(a).toLowerCase().startsWith(q) ? 0 : 1) - (mdNoteName(b).toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 8);
  if (!matches.length) return mdCompleteClose();
  const box = adler.complete?.box || el("div", { class: "md-complete material", role: "listbox" });
  document.body.append(box);
  const r = area.getBoundingClientRect();
  const lineNo = before.split("\n").length - 1;
  const lh = parseFloat(getComputedStyle(area).lineHeight) || 24;
  Object.assign(box.style, { left: `${r.left + 24}px`, top: `${Math.min(innerHeight - 260, r.top + (lineNo + 1) * lh + 18)}px` });
  adler.complete = { box, area, tab, start: area.selectionStart - m[0].length, matches, at: 0 };
  mdCompleteDraw();
}
function mdCompleteDraw() {
  const c = adler.complete;
  c.box.replaceChildren(...c.matches.map((p, i) => {
    const row = el("button", { type: "button", class: `md-complete-row${i === c.at ? " on" : ""}` }, el("span", {}, mdNoteName(p)), el("span", { class: "md-hit-path" }, mdFolderOf(p)));
    row.addEventListener("mousedown", (e) => { e.preventDefault(); c.at = i; mdCompletePick(); });
    return row;
  }));
}
function mdCompleteKeys(e) {
  const c = adler.complete;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    c.at = (c.at + (e.key === "ArrowDown" ? 1 : -1) + c.matches.length) % c.matches.length;
    mdCompleteDraw();
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); mdCompletePick(); return true; }
  if (e.key === "Escape") { e.preventDefault(); mdCompleteClose(); return true; }
  return false;
}
function mdCompletePick() {
  const c = adler.complete;
  const target = c.matches[c.at];
  c.area.setSelectionRange(c.start, c.area.selectionStart);
  document.execCommand("insertText", false, mdLinkTo(c.tab.path, target, mdNoteName(target)));
  mdCompleteClose();
  c.area.dispatchEvent(new Event("input"));
}
function mdCompleteClose() {
  adler.complete?.box.remove();
  adler.complete = null;
}

// Pictures (or any file) pasted or dropped into a note: into the vault's
// attachment folder, and a link to them where the caret is.
async function mdPasteFiles(e, list, area, tab) {
  if (!list?.length || !tab.writable) return;
  e.preventDefault();
  const dir = mdAttachmentDir(tab.path);
  for (const file of list) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const name = file.name && file.name !== "image.png" ? file.name : `Pasted image ${stamp}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
    const where = mdFull(dir).replace(/\/$/, "");
    const reply = await mdUpload(file, where, name);
    if (!reply) continue;
    const rel = `${dir ? `${dir}/` : ""}${reply.name}`;
    adler.names.add(rel);
    document.execCommand("insertText", false, `${mdLinkTo(tab.path, rel, reply.name, true)}\n`);
  }
  area.dispatchEvent(new Event("input"));
  mdRefreshIndex();
}

function mdUpload(file, dir, name) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`);
    xhr.onloadend = () => {
      if (xhr.status === 200) return resolve(JSON.parse(xhr.responseText));
      let error = "it didn't upload";
      try { error = JSON.parse(xhr.responseText).error || error; } catch { /* not JSON */ }
      toast(`${name}: ${error}`);
      resolve(null);
    };
    xhr.send(file);
  });
}

function mdAttachmentDir(noteRel) {
  const a = (mdSetting("app").attachmentFolderPath ?? "/").trim();
  if (a === "/" || a === "") return "";
  if (a === "./" || a === ".") return mdFolderOf(noteRel);
  if (a.startsWith("./")) return mdNorm(`${mdFolderOf(noteRel)}/${a.slice(2)}`);
  return a.replace(/^\/+|\/+$/g, "");
}

// ------------------------------------------------------------- saving

// Saved a moment after you stop typing (and when you leave the note), as
// Obsidian does.
function mdDirty(tab, wait = 1200) {
  if (!tab.dirty) {
    tab.dirty = true;
    mdRenderTabs();
  }
  clearTimeout(tab.timer);
  tab.timer = setTimeout(() => mdSave(tab), wait);
}

async function mdSave(tab) {
  if (!tab || tab.kind === "graph" || tab.kind === "file" || !tab.dirty || tab.saving || !tab.writable) return true;
  clearTimeout(tab.timer);
  tab.saving = true;
  const text = tab.text;
  const reply = await filesPost("text", { path: mdFull(tab.path), text, mtime: tab.mtime ?? undefined });
  tab.saving = false;
  if (reply?.conflict) {
    const answer = await choiceDialog({
      title: `${mdNoteName(tab.path)} changed somewhere else`,
      body: "Obsidian, Syncthing or another window changed it since you opened it here.",
      choices: [{ label: "Keep both (mine as a copy)", value: "copy" }, { label: "Use theirs", value: "theirs", kind: "destructive" }, { label: "Keep mine", value: "mine", kind: "primary" }],
    });
    if (answer === "mine") { tab.mtime = null; tab.saving = false; return mdSave(tab); }
    if (answer === "theirs") { tab.dirty = false; await mdLoadTab(tab); return true; }
    if (answer === "copy") {
      const copy = await mdCreate(tab.path.replace(/\.md$/i, " (conflict).md"), text);
      tab.dirty = false;
      await mdLoadTab(tab);
      if (copy) mdOpen(copy, { newTab: true });
    }
    return false;
  }
  if (!reply) return false;
  tab.mtime = reply.mtime;
  if (tab.text === text) tab.dirty = false;
  mdRenderTabs();
  const state = $("md-main").querySelector(".md-note-state");
  if (state && tab === mdTab()) state.textContent = tab.dirty ? "Not saved yet" : "";
  clearTimeout(adler.reindex);
  adler.reindex = setTimeout(mdRefreshIndex, 1500);
  return true;
}

async function mdSaveAll() { for (const t of adler.tabs) await mdSave(t); }

// --------------------------------------------- notes, folders, renames

async function mdCreate(rel, text) {
  let path = rel;
  for (let n = 1; adler.names.has(path); n++) path = rel.replace(/(\.\w+)$/, ` ${n}$1`);
  const reply = await filesPost("text", { path: mdFull(path), text, create: true });
  if (!reply) return null;
  adler.names.add(path);
  adler.index.files.push({ path, size: text.length, mtime: reply.mtime, links: [], tags: [], headings: [], front: "" });
  mdIndex();
  mdRenderSide();
  mdRefreshIndex();
  return path;
}

async function mdNewNote(folder = null) {
  if (!adler.index?.writable) return toast("This vault is read-only here.");
  const dir = folder ?? mdNewNoteDir(mdTab()?.path);
  if (dir) adler.expanded.add(dir);
  const made = await mdCreate(`${dir ? `${dir}/` : ""}Untitled.md`, "");
  if (!made) return;
  await mdOpen(made, { mode: "edit" });
  requestAnimationFrame(() => { const t = $("md-main").querySelector(".md-title"); t?.focus(); t?.select(); });
}

function mdNewNoteDir(from) {
  const app = mdSetting("app");
  if (app.newFileLocation === "current" && from) return mdFolderOf(from);
  if (app.newFileLocation === "folder") return String(app.newFileFolderPath || "").replace(/^\/+|\/+$/g, "");
  return "";
}

async function mdNewFolder(parent) {
  const name = await nameDialog({ title: "New folder", button: "Create" });
  if (!name) return;
  if (await filesPost("mkdir", { path: mdFull(parent).replace(/\/$/, "") || adler.vault, name })) {
    adler.expanded.add(parent ? `${parent}/${name}` : name);
    mdRefreshIndex();
  }
}

// A rename or a move. Links to it (and its own relative ones) follow, when
// the vault says so (Obsidian's Automatically update internal links); else
// you're asked.
async function mdRename(from, to) {
  if (adler.names.has(to) || adler.index.folders.includes(to)) return toast(`There's already ${to.split("/").pop()} there.`);
  let links = mdSetting("app").alwaysUpdateLinks === true;
  if (!links && (adler.backlinks.get(from)?.size || [...adler.backlinks.keys()].some((k) => k.startsWith(`${from}/`)))) {
    const answer = await choiceDialog({ title: "Update the links to it?", body: "Other notes link to it.",
      choices: [{ label: "Cancel", value: null }, { label: "Don't", value: "no" }, { label: "Update them", value: "yes", kind: "primary" }] });
    if (!answer) return;
    links = answer === "yes";
  }
  for (const t of adler.tabs) if (t.path === from || t.path.startsWith(`${from}/`)) await mdSave(t);
  const reply = await mdPost("rename", { vault: adler.vault, from, to, links });
  if (!reply) return;
  for (const t of adler.tabs) {
    if (t.path === from) t.path = to;
    else if (t.path.startsWith(`${from}/`)) t.path = to + t.path.slice(from.length);
  }
  if (reply.updated) toast(`Moved; ${reply.updated} note${reply.updated === 1 ? "" : "s"} with links to it updated.`);
  await mdRefreshIndex();
  for (const t of adler.tabs) if (t.kind === "note" && !t.dirty) t.text = null;
  mdKeepTabs();
  mdDrawAll();
  const tab = mdTab();
  if (tab && tab.text === null) mdLoadTab(tab);
}

async function mdRenameDialog(path) {
  const isNoteFile = mdIsNote(path);
  const name = await nameDialog({ title: "Rename", value: isNoteFile ? mdNoteName(path) : path.split("/").pop(), button: "Rename" });
  if (!name) return;
  const folder = mdFolderOf(path);
  mdRename(path, `${folder ? `${folder}/` : ""}${name}${isNoteFile && !/\.md$/i.test(name) ? ".md" : ""}`);
}

async function mdMoveDialog(path) {
  const folders = ["", ...adler.index.folders].filter((f) => f !== path && !f.startsWith(`${path}/`) && f !== mdFolderOf(path));
  const pick = await new Promise((resolve) => {
    const list = el("div", { class: "picker-list" }, ...folders.map((f) => {
      const b = el("button", { type: "button", class: "picker-row" }, f || `${adler.index.name} (its top)`);
      b.addEventListener("click", () => { closeModal(); resolve(f); });
      return b;
    }));
    const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
    cancel.addEventListener("click", () => { closeModal(); resolve(null); });
    openModal(el("div", { class: "dialog material picker-dialog", role: "dialog", "aria-modal": "true" }, el("h2", {}, `Move ${path.split("/").pop()} to…`), list,
      el("div", { class: "dialog-actions" }, cancel)), { onClose: () => resolve(null) });
  });
  if (pick !== null) mdMoveInto(path, pick);
}

async function mdDelete(path) {
  const ok = await confirmDialog({ title: `Delete ${path.split("/").pop()}?`, body: "It goes to the Trash (in My Computer), where you can bring it back.", button: "Delete", destructive: true });
  if (!ok || !(await filesPost("delete", { paths: [mdFull(path)] }))) return;
  adler.tabs = adler.tabs.filter((t) => t.path !== path && !t.path?.startsWith(`${path}/`));
  adler.active = Math.min(adler.active, adler.tabs.length - 1);
  mdKeepTabs();
  await mdRefreshIndex();
  mdDrawAll();
}

// ------------------------------------------------- the right-hand side

function mdRenderRight() {
  const right = $("md-right");
  const tab = mdTab();
  if (!tab || tab.kind !== "note" || !adler.index) return right.replaceChildren(el("p", { class: "md-right-empty" }, "Open a note for its links and outline."));
  const note = adler.notes.get(tab.path);
  const section = (title, items) => el("section", { class: "md-right-section" }, el("h3", {}, title, el("span", { class: "md-count" }, String(items.length))),
    ...(items.length ? items : [el("p", { class: "md-right-empty" }, "None.")]));
  const linkRow = (path, exists = true) => {
    const b = el("button", { type: "button", class: `md-right-row${exists ? "" : " unresolved"}`, title: path }, mdIsNote(path) ? mdNoteName(path) : path.split("/").pop());
    b.addEventListener("click", (e) => {
      if (exists) return mdOpen(path, { newTab: e.ctrlKey || e.metaKey });
      mdFollow({ external: false, target: { path, exists: false } }, e, tab);
    });
    return b;
  };
  const back = [...(adler.backlinks.get(tab.path) || [])].sort();
  const out = [...new Map((note?.links || []).filter((l) => !l.self && !l.embed).map((l) => [l.path, l])).values()];
  const outline = [];
  let code = false;
  (tab.text || "").split("\n").forEach((line, n) => {
    if (/^(```|~~~)/.test(line)) code = !code;
    const m = !code && line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (!m) return;
    const b = el("button", { type: "button", class: "md-right-row", style: `--depth:${m[1].length - 1}` }, m[2]);
    b.addEventListener("click", () => (tab.mode === "edit" ? mdCaretToLine($("md-main").querySelector(".md-source"), n) : mdScrollToHeading(m[2])));
    outline.push(b);
  });
  const tagRows = (note?.tags || []).map((t) => {
    const b = el("button", { type: "button", class: "md-right-row" }, `#${t}`);
    b.addEventListener("click", () => mdSearchFor(`tag:#${t}`));
    return b;
  });
  right.replaceChildren(section("Backlinks", back.map((p) => linkRow(p))), section("Outgoing links", out.map((l) => linkRow(l.path, l.exists))),
    section("Outline", outline), section("Tags", tagRows));
}

// ------------------------------------------------- switcher, daily notes

function mdSwitcher() {
  if (!adler.index) return;
  const input = el("input", { class: "field-input md-switch-input", type: "text", placeholder: "Find or create a note…", spellcheck: "false" });
  const list = el("div", { class: "md-switch-list", role: "listbox" });
  let rows = [];
  let at = 0;
  const fuzzy = (q, s) => { let k = 0; for (const ch of s) if (ch === q[k]) k++; return k === q.length; };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const notes = [...adler.notes.keys()].filter((p) => !q || fuzzy(q, p.toLowerCase()))
      .sort((a, b) => (mdNoteName(a).toLowerCase().startsWith(q) ? 0 : 1) - (mdNoteName(b).toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 50);
    rows = notes.map((p) => ({ path: p }));
    if (q && !notes.some((p) => mdNoteName(p).toLowerCase() === q) && adler.index.writable) rows.push({ create: input.value.trim() });
    at = Math.min(at, Math.max(0, rows.length - 1));
    list.replaceChildren(...rows.map((r, i) => {
      const b = el("button", { type: "button", class: `md-switch-row${i === at ? " on" : ""}` },
        r.create ? el("span", {}, `Create “${r.create}”`) : el("span", {}, mdNoteName(r.path)), el("span", { class: "md-hit-path" }, r.create ? "" : mdFolderOf(r.path)));
      b.addEventListener("click", () => pick(i));
      return b;
    }));
    list.children[at]?.scrollIntoView({ block: "nearest" });
  };
  const pick = async (i) => {
    const r = rows[i];
    if (!r) return;
    closeModal();
    if (r.create) {
      const dir = mdNewNoteDir(mdTab()?.path);
      const made = await mdCreate(`${dir ? `${dir}/` : ""}${r.create.replace(/[\\/:]/g, "-")}.md`, "");
      if (made) mdOpen(made, { mode: "edit" });
    } else mdOpen(r.path);
  };
  input.addEventListener("input", () => { at = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(rows.length - 1, at + 1); draw(); }
    if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
    if (e.key === "Enter") { e.preventDefault(); pick(at); }
  });
  openModal(el("div", { class: "dialog material md-switch", role: "dialog", "aria-modal": "true", "aria-label": "Quick switcher" }, input, list));
  draw();
  input.focus();
}

// A date the way daily notes name them (moment.js's tokens, the usual ones).
function mdDate(format, d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const tokens = { YYYY: d.getFullYear(), YY: pad(d.getFullYear() % 100), MMMM: months[d.getMonth()], MMM: months[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), dddd: days[d.getDay()], ddd: days[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss/g, (t, lit) => (lit !== undefined ? lit : String(tokens[t])));
}

async function mdDailyNote() {
  if (!adler.index) return;
  const cfg = mdSetting("daily-notes");
  const folder = String(cfg.folder || "").replace(/^\/+|\/+$/g, "");
  const rel = `${folder ? `${folder}/` : ""}${mdDate(cfg.format || "YYYY-MM-DD")}.md`;
  if (adler.names.has(rel)) return mdOpen(rel);
  if (!adler.index.writable) return toast("This vault is read-only here.");
  let text = "";
  if (cfg.template) text = mdFill(await mdText(`${cfg.template.replace(/^\/+/, "").replace(/\.md$/i, "")}.md`), mdNoteName(rel));
  const made = await mdCreate(rel, text);
  if (made) mdOpen(made, { mode: "edit" });
}

// A template's {{title}}, {{date}} and {{time}} (with a format, too: {{date:YYYY}}).
function mdFill(text, title) {
  const cfg = mdSetting("templates");
  return String(text).replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/g, (_, what, fmt) =>
    (what === "title" ? title : mdDate(fmt || (what === "date" ? cfg.dateFormat || "YYYY-MM-DD" : cfg.timeFormat || "HH:mm"))));
}

async function mdInsertTemplate(tab) {
  const folder = String(mdSetting("templates").folder || "").replace(/^\/+|\/+$/g, "");
  const list = [...adler.notes.keys()].filter((p) => mdFolderOf(p) === folder || p.startsWith(`${folder}/`));
  if (!list.length) return toast(`No templates in ${folder || "the vault's top"}.`);
  const r = $("md-main").getBoundingClientRect();
  openMenu(r.left + 80, r.top + 60, list.map((p) => ({ label: mdNoteName(p), run: async () => {
    const text = mdFill(await mdText(p), mdNoteName(tab.path));
    const src = $("md-main").querySelector(".md-source");
    if (src && tab.mode !== "read") {
      src.focus();
      document.execCommand("insertText", false, text);
    } else {
      tab.text = `${tab.text}${tab.text.endsWith("\n") || !tab.text ? "" : "\n"}${text}`;
      mdDirty(tab, 300);
      mdRenderMain();
    }
  } })));
}

// ----------------------------------------------------------- the graph

function mdOpenGraph(local = null) {
  if (!adler.index) return;
  let i = adler.tabs.findIndex((t) => t.kind === "graph" && (t.local || null) === local);
  if (i < 0) {
    const tab = mdNewTab("graph", null);
    tab.local = local;
    adler.tabs.splice(adler.active + 1, 0, tab);
    i = adler.active + 1;
  }
  mdActivate(i);
}

function mdGraphView(tab) {
  const cfg = mdSetting("graph");
  const box = el("div", { class: "md-graph" });
  requestAnimationFrame(() => {
    tab.graph?.stop?.();
    tab.graph = mdGraph(box, mdGraphData(cfg, tab.local), {
      settings: cfg, current: adler.tabs.find((t) => t.kind === "note")?.path,
      open: (path, newTab) => (path.startsWith("#") ? mdSearchFor(`tag:${path}`) : mdOpen(path, { newTab })),
    });
  });
  return box;
}

// Nodes and lines, as graph.json says: tags and attachments if it shows
// them, notes linked to nothing (orphans) and links to nothing yet
// (unresolved) unless it hides them. local: one note and what's near it.
function mdGraphData(cfg, local) {
  const nodes = new Map();
  const links = [];
  const add = (id, kind) => { if (!nodes.has(id)) nodes.set(id, { id, kind, label: kind === "tag" ? id : kind === "note" ? mdNoteName(id) : id.split("/").pop(), degree: 0 }); };
  for (const [path, note] of adler.notes) {
    add(path, "note");
    nodes.get(path).tags = note.tags; // for colour groups' tag:
    for (const l of note.links) {
      if (l.self) continue;
      if (!l.exists) {
        if (cfg.hideUnresolved || !mdIsNote(l.path)) continue;
        add(l.path, "unresolved");
      } else if (!mdIsNote(l.path)) {
        if (!cfg.showAttachments) continue;
        add(l.path, "attachment");
      }
      links.push({ source: path, target: l.path });
    }
    if (cfg.showTags) for (const t of note.tags) { add(`#${t}`, "tag"); links.push({ source: path, target: `#${t}` }); }
  }
  if (cfg.showAttachments) for (const f of adler.index.files) if (!mdIsNote(f.path) && !/\.base$/i.test(f.path)) add(f.path, "attachment");
  for (const l of links) { nodes.get(l.source).degree++; nodes.get(l.target).degree++; }
  let keep = [...nodes.values()];
  if (local) {
    const near = new Set([local]);
    for (let d = 0; d < 2; d++) for (const l of links) { if (near.has(l.source)) near.add(l.target); else if (near.has(l.target)) near.add(l.source); }
    keep = keep.filter((n) => near.has(n.id));
  } else if (cfg.showOrphans === false) keep = keep.filter((n) => n.degree > 0);
  const query = String(cfg.search || "").toLowerCase();
  if (query) keep = keep.filter((n) => n.id.toLowerCase().includes(query));
  const ids = new Set(keep.map((n) => n.id));
  return { nodes: keep, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)), groups: (cfg.colorGroups || []).map((g) => ({ query: g.query, color: g.color })) };
}

// ------------------------------------------------------------- Bases

function mdBaseView(tab) {
  const src = el("textarea", { class: "md-source md-base-source", spellcheck: "false", "aria-label": "The Base, as YAML" });
  src.value = tab.text;
  const box = el("div", { class: "md-base-wrap" });
  const draw = () => box.replaceChildren(mdBase(src.value, mdBaseCtx(tab)));
  const toggle = el("button", { type: "button", class: "chip-button" }, tab.mode === "edit" ? "Done" : "Edit its YAML");
  toggle.addEventListener("click", () => mdSetMode(tab, tab.mode === "edit" ? "read" : "edit"));
  src.addEventListener("input", () => { tab.text = src.value; mdDirty(tab); clearTimeout(tab.drawTimer); tab.drawTimer = setTimeout(draw, 300); });
  src.addEventListener("blur", () => mdSave(tab));
  draw();
  return el("div", { class: "md-note" }, el("div", { class: "md-note-head" }, el("span", { class: "md-crumbs" }, tab.path), ...(tab.writable ? [toggle] : [])),
    el("div", { class: "md-scroll" }, el("div", { class: "md-page wide" }, ...(tab.mode === "edit" ? [src] : []), box)));
}

function mdBaseCtx(tab) {
  return {
    notes: [...adler.notes.values()].map((n) => ({ ...n, name: mdNoteName(n.path), folder: mdFolderOf(n.path) })),
    files: adler.index.files,
    thisFile: tab.path,
    open: (path, e) => mdOpen(path, { newTab: e?.ctrlKey || e?.metaKey }),
    image: (value, from) => {
      const r = mdResolve(from, String(value).replace(/^!?\[\[|\]\]$/g, "").replace(/^!\[[^\]]*\]\(|\)$/g, ""), /\[\[/.test(value));
      return r.exists && padKind(r.path) === "image" ? fileUrl(mdFull(r.path), true) : null;
    },
  };
}

