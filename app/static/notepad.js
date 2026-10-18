// Notepad: a text file in a window of its own, one window a file (like
// Windows'). File: New, Open…, Save, Save as…; View: word wrap. A Markdown
// file opened from My Computer (or the desktop) is a Notepad too, with its
// preview beside it or instead (Edit, Read, Split) and File → Load vault,
// for adlerMD's whole vault. Opening adlerMD itself is the vault.
// Also the file picker (Open…, Save as…) adlerMD uses too.
// Uses $, el, svg, api, toast, state, registerWindow, openWindow,
// closeWindow, isOpen, openMenu, openModal, closeModal, confirmDialog,
// showLock, desktopMode, winLoad, winSave, mdRender, fileUrl, parentOf,
// join, placeOf, openEntry, openAdlermd.
"use strict";

const pads = new Map(); // window id -> its file
const PAD_WRAP_KEY = "adleros.padWrap";
const PAD_MODE_KEY = "adleros.padMode"; // a Markdown file's: edit, read, split
let padCount = 0;

// A file in Notepad: the window it's in already, or a new one. No path: the
// Notepad you used last (one that's hidden behind another window, say), or
// an empty one. markdown: adlerMD's quick look at a Markdown file.
async function openNotepad(path = null, { markdown = path ? /\.(md|markdown)$/i.test(path) : false } = {}) {
  if (path) {
    const open = [...pads.values()].find((p) => p.path === path);
    if (open) return showPad(open);
  } else {
    // One put away behind another window (the home screen), else an empty one.
    const hidden = [...pads.values()].reverse().find((p) => !isOpen(p.id) && p.markdown === markdown);
    if (hidden) return showPad(hidden);
    const blank = [...pads.values()].find((p) => !p.path && !p.dirty && !p.area.value && p.markdown === markdown);
    if (blank) return showPad(blank);
  }
  let text = "";
  let file = null;
  if (path) {
    const { status, body } = await api(`/api/files/text?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
    if (status === 401) return showLock();
    if (status !== 200) return toast(body?.error || "Can't open that file.");
    file = body;
    text = body.text;
  }
  const pad = makePad({ markdown });
  setPadFile(pad, file, text);
  showPad(pad);
  return pad;
}

function makePad({ markdown }) {
  const id = `notepad-${++padCount}`;
  const area = el("textarea", { class: "pad-text", spellcheck: "false", autocapitalize: "off", "aria-label": "Text" });
  const preview = el("div", { class: "pad-preview md-view", hidden: "" });
  const title = el("span", { class: "pad-title" });
  const status = el("span", { class: "pad-status" });
  const menuButton = (label, items) => {
    const b = el("button", { type: "button", class: "pad-menu", "aria-haspopup": "menu" }, label);
    b.addEventListener("click", () => {
      const r = b.getBoundingClientRect();
      openMenu(r.left, r.bottom + 4, items());
    });
    return b;
  };
  const pad = { id, markdown, area, preview, title, status, path: null, name: "Untitled", mtime: null, writable: true, dirty: false,
    mode: markdown ? winLoad(PAD_MODE_KEY, "edit") : "edit" };
  const close = el("button", { class: "sheet-close pad-close", type: "button", "aria-label": "Close" },
    svg(["M18 6 6 18", "m6 6 12 12"]));
  close.addEventListener("click", () => closePad(pad));
  const bar = el("div", { class: "pad-bar" },
    menuButton("File", () => padFileMenu(pad)), menuButton("View", () => padViewMenu(pad)), title, status, close);
  pad.section = el("section", { id, class: `sheet pad-sheet${markdown ? " pad-md" : ""}`, "aria-label": markdown ? "adlerMD" : "Notepad", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    bar, el("div", { class: "pad-body" }, area, preview));
  document.body.insertBefore(pad.section, $("modal"));
  pads.set(id, pad);
  // Closing it (its ✕, Alt+W) asks about unsaved changes and then goes;
  // another window over it on the home screen only hides it.
  registerWindow(id, { title: "Notepad", close: () => closePad(pad), hide: () => closeWindow(id), dock: markdown ? null : "notepad",
    icon: markdown ? "adlermd" : "notepad", size: [820, 600] });
  area.addEventListener("input", () => {
    setPadDirty(pad, true);
    if (pad.markdown && pad.mode !== "edit") renderPadPreview(pad);
  });
  area.addEventListener("keydown", (e) => padKeys(e, pad));
  area.addEventListener("keyup", () => padStatus(pad));
  area.addEventListener("click", () => padStatus(pad));
  pad.section.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); return e.shiftKey ? savePadAs(pad) : savePad(pad); }
    if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); e.stopPropagation(); return padOpenFile(pad); }
    if (mod && e.key.toLowerCase() === "e" && pad.markdown) { e.preventDefault(); return setPadMode(pad, pad.mode === "read" ? "edit" : "read"); }
  });
  setPadWrap(pad, winLoad(PAD_WRAP_KEY, true) !== false);
  setPadMode(pad, pad.mode, false);
  return pad;
}

function showPad(pad) {
  openWindow(pad.id);
  requestAnimationFrame(() => (pad.mode === "read" ? pad.preview : pad.area).focus({ preventScroll: true }));
  return pad;
}

function setPadFile(pad, file, text) {
  pad.area.value = text;
  pad.path = file?.path || null;
  pad.name = pad.path ? pad.path.split("/").pop() : pad.markdown ? "Untitled.md" : "Untitled";
  pad.mtime = file?.mtime ?? null;
  pad.writable = file ? file.writable !== false : true;
  pad.area.readOnly = !pad.writable;
  setPadDirty(pad, false);
  if (pad.markdown) renderPadPreview(pad);
  pad.area.setSelectionRange(0, 0);
  pad.area.scrollTop = 0;
}

function setPadDirty(pad, dirty) {
  pad.dirty = dirty;
  const where = pad.path ? parentOf(pad.path).replace(/^\/(user|desktop|root)/, (_, p) => ({ user: "User", desktop: "Desktop", root: "Root" })[p]) : "";
  pad.title.textContent = `${dirty ? "● " : ""}${pad.name}`;
  pad.title.title = pad.path || "Not saved anywhere yet";
  titleWindow(pad.id, `${pad.name}${where ? ` — ${where}` : ""}`);
  padStatus(pad);
}

function padStatus(pad) {
  const before = pad.area.value.slice(0, pad.area.selectionStart);
  const line = before.split("\n").length;
  const col = before.length - before.lastIndexOf("\n");
  pad.status.textContent = `${!pad.writable ? "Read-only · " : pad.dirty ? "Not saved · " : ""}Ln ${line}, Col ${col}`;
}

function padFileMenu(pad) {
  return [
    { label: "New", run: () => openNotepad(null, { markdown: pad.markdown }).then((p) => p && showPad(p)) },
    { label: "Open…", run: () => padOpenFile(pad) },
    { label: "Save", run: () => savePad(pad) },
    { label: "Save as…", run: () => savePadAs(pad) },
    ...(pad.markdown ? [{ label: "Load vault", run: () => padLoadVault(pad) }] : []),
    ...(pad.path ? [{ label: "Show in My Computer", run: () => openFiles(parentOf(pad.path)) }] : []),
    { label: "Close", run: () => closePad(pad) },
  ];
}

function padViewMenu(pad) {
  const tick = (on, label) => `${on ? "✓ " : " "}${label}`;
  return [
    { label: tick(pad.wrap, "Word wrap"), run: () => { setPadWrap(pad, !pad.wrap); winSave(PAD_WRAP_KEY, pad.wrap); } },
    ...(pad.markdown ? [
      { label: tick(pad.mode === "edit", "Edit"), run: () => setPadMode(pad, "edit") },
      { label: tick(pad.mode === "read", "Read (Ctrl+E)"), run: () => setPadMode(pad, "read") },
      { label: tick(pad.mode === "split", "Edit and read, side by side"), run: () => setPadMode(pad, "split") },
    ] : []),
  ];
}

function setPadWrap(pad, on) {
  pad.wrap = on;
  pad.area.classList.toggle("nowrap", !on);
}

function setPadMode(pad, mode, keep = true) {
  pad.mode = pad.markdown ? mode : "edit";
  pad.section.dataset.mode = pad.mode;
  pad.preview.hidden = pad.mode === "edit";
  pad.area.hidden = pad.mode === "read";
  if (pad.mode !== "edit") renderPadPreview(pad);
  if (keep && pad.markdown) winSave(PAD_MODE_KEY, pad.mode);
}

// The Markdown, as it reads: its links lead to files next to it.
function renderPadPreview(pad) {
  clearTimeout(pad.renderTimer);
  pad.renderTimer = setTimeout(() => {
    const dir = pad.path ? parentOf(pad.path) : null;
    const resolve = (href) => {
      if (!dir) return { path: null, exists: false };
      const clean = decodeURIComponent(href.split("#")[0]);
      return { path: clean.startsWith("/") ? clean : normalizePath(join(dir, clean)), exists: true };
    };
    pad.preview.replaceChildren(mdRender(pad.area.value, {
      resolve,
      open: (link) => {
        if (link.external) return window.open(link.href, "_blank", "noopener,noreferrer");
        if (!link.target?.path) return;
        const name = link.target.path.split("/").pop();
        openEntry({ name, dir: !/\.[^./]+$/.test(name), kind: padKind(name), size: 0 }, link.target.path);
      },
      embed: (target, opts) => {
        const r = resolve(target);
        if (!r.path || !/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(r.path)) return null;
        return el("img", { class: "md-embed-image", src: fileUrl(r.path, true), alt: opts.alt || "", ...(opts.width ? { width: opts.width } : {}) });
      },
      toggleTask: (line, done) => {
        const lines = pad.area.value.split("\n");
        lines[line] = lines[line].replace(/\[(.)\]/, done ? "[x]" : "[ ]");
        pad.area.value = lines.join("\n");
        setPadDirty(pad, true);
      },
    }));
  }, pad.preview.childElementCount ? 120 : 0);
}

function normalizePath(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return `/${out.join("/")}`;
}

function padKind(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "heic"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) return "video";
  if (["mp3", "flac", "ogg", "opus", "m4a", "wav", "aac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "text";
}

// Tab indents; Enter keeps a list going (Markdown).
function padKeys(e, pad) {
  const area = pad.area;
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !area.readOnly) {
    e.preventDefault();
    e.stopPropagation();
    document.execCommand("insertText", false, "\t") || area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end");
    setPadDirty(pad, true);
  } else if (e.key === "Enter" && pad.markdown && !e.shiftKey && !area.readOnly && continueList(area)) {
    e.preventDefault();
    setPadDirty(pad, true);
    if (pad.mode !== "edit") renderPadPreview(pad);
  }
}

// Enter in a list item (- , 1. , - [ ] , > ): the next one; in an empty one,
// out of the list. True if it did.
function continueList(area) {
  const at = area.selectionStart;
  if (at !== area.selectionEnd) return false;
  const start = area.value.lastIndexOf("\n", at - 1) + 1;
  const line = area.value.slice(start, at);
  const m = line.match(/^(\s*)([-*+]|\d+[.)]|>)(\s+)(\[[ xX]\]\s+)?/);
  if (!m) return false;
  if (line.trim() === m[0].trim()) {
    area.setRangeText("", start, at, "end"); // an empty item: the list ends
    return true;
  }
  const num = m[2].match(/^(\d+)([.)])$/);
  const marker = num ? `${Number(num[1]) + 1}${num[2]}` : m[2];
  const next = `\n${m[1]}${marker}${m[3]}${m[4] ? "[ ] " : ""}`;
  document.execCommand("insertText", false, next) || area.setRangeText(next, at, at, "end");
  return true;
}

// ----------------------------------------------------------- saving

async function savePad(pad) {
  if (!pad.path) return savePadAs(pad);
  if (!pad.writable) return toast("That file is read-only here: Save as… puts a copy somewhere you can change.");
  const reply = await filesPost("text", { path: pad.path, text: pad.area.value, mtime: pad.mtime ?? undefined });
  if (reply?.conflict) {
    const ok = await confirmDialog({ title: `${pad.name} changed`, body: "Something else changed it since you opened it. Save yours over it anyway?", button: "Overwrite", destructive: true });
    if (!ok) return false;
    pad.mtime = null;
    return savePad(pad);
  }
  if (!reply) return false;
  pad.mtime = reply.mtime;
  setPadDirty(pad, false);
  refreshFiles();
  return true;
}

async function savePadAs(pad) {
  const path = await filePicker({ title: "Save as", save: true, start: pad.path ? parentOf(pad.path) : "/user", name: pad.name });
  if (!path) return false;
  let reply = await filesPost("text", { path, text: pad.area.value, create: true });
  if (reply?.exists) {
    const ok = await confirmDialog({ title: `Replace ${path.split("/").pop()}?`, body: "There's a file by that name there already.", button: "Replace", destructive: true });
    if (!ok) return false;
    reply = await filesPost("text", { path, text: pad.area.value });
  }
  if (!reply) return false;
  Object.assign(pad, { path: reply.path || path, mtime: reply.mtime, writable: true });
  pad.name = pad.path.split("/").pop();
  pad.area.readOnly = false;
  setPadDirty(pad, false);
  refreshFiles();
  return true;
}

// Unsaved changes: "Save", "Don't save", or Cancel. True to go on.
async function padMayLeave(pad, doing) {
  if (!pad.dirty) return true;
  const answer = await choiceDialog({
    title: `Save your changes to ${pad.name}?`,
    body: `If you don't, they're lost when you ${doing}.`,
    choices: [{ label: "Cancel", value: null }, { label: "Don't save", value: "drop", kind: "destructive" }, { label: `Save and ${doing}`, value: "save", kind: "primary" }],
  });
  if (answer === "save") return savePad(pad);
  return answer === "drop";
}

async function closePad(pad) {
  if (!(await padMayLeave(pad, "close it"))) return;
  pad.dirty = false;
  closeWindow(pad.id);
  pads.delete(pad.id);
  setTimeout(() => {
    if (pads.has(pad.id)) return;
    pad.section.remove();
    wm.windows.delete(pad.id);
    delete wm.geometry[pad.id];
  }, 1100);
}

async function padOpenFile(pad) {
  const path = await filePicker({ title: "Open", start: pad.path ? parentOf(pad.path) : "/user" });
  if (!path) return;
  if (!pad.dirty && !pad.path && !pad.area.value && /\.(md|markdown)$/i.test(path) === pad.markdown) {
    // An empty, untouched one takes the file itself.
    const { status, body } = await api(`/api/files/text?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
    if (status !== 200) return toast(body?.error || "Can't open that file.");
    return setPadFile(pad, body, body.text);
  }
  openNotepad(path);
}

// File → Load vault: adlerMD with its vault (this file's, if it's in one).
async function padLoadVault(pad) {
  if (!(await padMayLeave(pad, "load the vault"))) return;
  const path = pad.path;
  pad.dirty = false;
  closePad(pad);
  openAdlermd(path);
}

// A choice of more than yes or no: resolves with the value picked (Cancel,
// Escape or a click outside: null).
function choiceDialog({ title, body, choices }) {
  return new Promise((resolve) => {
    let answered = false;
    const buttons = choices.map((c) => {
      const b = el("button", { type: "button", class: c.kind === "primary" ? "button-primary" : c.kind === "destructive" ? "button-destructive" : "button-secondary" }, c.label);
      b.addEventListener("click", () => { answered = true; closeModal(); resolve(c.value); });
      return b;
    });
    openModal(el("div", { class: "dialog material choice-dialog", role: "alertdialog", "aria-modal": "true" },
      el("h2", {}, title), body ? el("p", {}, body) : "", el("div", { class: "dialog-actions" }, ...buttons)),
    { onClose: () => { if (!answered) resolve(null); } });
    buttons[buttons.length - 1].focus();
  });
}

// --------------------------------------------------------- the picker

// Open… and Save as…: your places and their folders. Resolves with the
// chosen path, or null. save: a name to type, and folders only to pick.
// folder: a folder itself is what's picked (adlerMD's Open folder as vault).
function filePicker({ title, save = false, folder = false, start = "/user", name = "" }) {
  return new Promise((resolve) => {
    let answered = false;
    let here = start;
    let chosen = null;
    const list = el("div", { class: "picker-list", role: "listbox" });
    const crumbs = el("div", { class: "picker-crumbs" });
    const nameInput = save ? el("input", { class: "field-input picker-name", type: "text", value: name, spellcheck: "false", "aria-label": "Name" }) : null;
    const ok = el("button", { type: "button", class: "button-primary" }, save ? "Save" : folder ? "Use this folder" : "Open");
    const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
    const finish = (value) => { answered = true; closeModal(); resolve(value); };
    async function go(path) {
      const { status, body } = await api(`/api/files?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
      if (status !== 200) return toast(body?.error || "Can't open that folder.");
      here = body.path;
      chosen = null;
      const parts = here.split("/").filter(Boolean);
      crumbs.replaceChildren(...[["My Computer", "/"], ...parts.map((p, i) => [i === 0 ? ({ user: "User", desktop: "Desktop", root: "Root" })[p] || p : p, `/${parts.slice(0, i + 1).join("/")}`])]
        .map(([label, to]) => {
          const b = el("button", { type: "button", class: "crumb" }, label);
          b.addEventListener("click", () => go(to));
          return b;
        }));
      const entries = (body.entries || []).filter((e) => !e.name.startsWith(".") && (e.dir || (!save && !folder)));
      entries.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
      list.replaceChildren(...entries.map((e) => {
        const to = e.place && here === "/" ? `/${e.place}` : join(here, e.name);
        const row = el("button", { type: "button", class: "picker-row", role: "option" },
          el("span", { class: `file-icon ${e.kind}` }, svg(FILE_ICONS[e.kind] || FILE_ICONS.file)), el("span", {}, e.name));
        row.addEventListener("click", () => {
          if (e.dir) return go(to);
          for (const r of list.children) r.classList.remove("selected");
          row.classList.add("selected");
          chosen = to;
        });
        row.addEventListener("dblclick", () => { if (!e.dir) finish(to); });
        return row;
      }), ...(entries.length ? [] : [el("p", { class: "no-results" }, save || folder ? "No folders here." : "Nothing here.")]));
      ok.disabled = !save && !folder ? false : here === "/";
    }
    ok.addEventListener("click", () => {
      if (save) {
        const n = nameInput.value.trim();
        if (!n || n.includes("/")) return toast("A name, without /.");
        if (here === "/") return toast("Pick a place first: Desktop or User.");
        return finish(join(here, n));
      }
      if (folder) return here === "/" ? toast("Pick a folder.") : finish(here);
      if (!chosen) return toast("Pick a file first.");
      finish(chosen);
    });
    cancel.addEventListener("click", () => finish(null));
    nameInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); });
    openModal(el("div", { class: "dialog material picker-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("h2", {}, title), crumbs, list, nameInput || "", el("div", { class: "dialog-actions" }, cancel, ok)),
    { onClose: () => { if (!answered) resolve(null); } });
    go(start).then(() => nameInput?.select());
  });
}
