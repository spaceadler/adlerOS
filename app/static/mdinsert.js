// Luna's Insert: everything Markdown does, without knowing how it's
// written. A right click on a note (reading or writing it) has the usual
// few (a new page, a file, a picture, a table, a checklist, a link to a
// note) and Insert… for the rest, as a list you search (Ctrl+/ too):
// headings, bold and the like, lists, quotes, code, math, callouts,
// footnotes, comments, tags, dates. What it makes goes where you clicked
// (where the caret is); reading, the note opens to be written there first.
// A new page is a folder in the note's folder with a note named as it is
// inside (Academics: GJU/gju.md), linked here and opened, so pages nest.
// Shift and a right click: the browser's own menu (spelling). Uses el, svg,
// $, toast, openMenu, openModal, closeModal, nameDialog, filesPost, and
// Luna's mdTab, mdSetMode, mdLinkTo, mdPasteFiles, mdCreate, mdOpen,
// mdFileName, mdLineEnd, mdFolderOf, mdFolderNote, mdFull, mdRefreshIndex,
// mdFlowOf (mdflow.js).
"use strict";

// ------------------------------------------------- where it goes, how

// The editor at a point of the note: the one being written in, else one
// opened there (Live: that block, its end; reading: Live at that line).
async function mdEditorAt(tab, target) {
  const main = $("md-main");
  const area = target?.closest?.("textarea.md-source");
  if (area) return area;
  if (tab.mode === "edit" || tab.mode === "split") return main.querySelector("textarea.md-source");
  if (tab.mode === "live") {
    const flow = mdFlowOf(main.querySelector(".md-flow-box"));
    if (!flow) return null;
    // Where you clicked (a right click puts the caret there), else its end.
    if (!target?.closest?.(".md-flow")) flow.atEnd();
    else flow.focus();
    return flow;
  }
  // Reading: written where you clicked, then it's put there.
  const line = target?.closest?.("[data-from]")?.dataset.from;
  mdSetMode(tab, tab.editMode || "live", line === undefined ? null : Number(line));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const now = mdFlowOf(main.querySelector(".md-flow-box")) || main.querySelector("textarea.md-source");
  if (now?.mdFlow) return now; // Live, at that line already
  if (now) { now.focus({ preventScroll: true }); now.setSelectionRange(now.value.length, now.value.length); }
  return now;
}

// The caret, held while a dialog (or a menu) has the focus. Returns () =>
// the editor, its caret back (or null).
function mdHold(area) {
  const caret = [area.selectionStart, area.selectionEnd];
  return () => {
    const a = area.isConnected ? area : mdFlowOf($("md-main").querySelector(".md-flow-box")) || $("md-main").querySelector("textarea.md-source");
    if (!a) return null;
    a.focus({ preventScroll: true });
    a.setSelectionRange(Math.min(caret[0], a.value.length), Math.min(caret[1], a.value.length));
    return a;
  };
}

// Text in at the caret, as typing would (Ctrl+Z takes it back). block: on
// lines of its own; "spaced": with an empty line around it, as a table, a
// code or math block needs to be read as one. pick: [from, to] of what's
// put in, picked after (a placeholder to type over).
function mdPut(area, text, { block = false, pick = null } = {}) {
  area.focus({ preventScroll: true });
  const s = area.selectionStart, e = area.selectionEnd;
  let before = "", after = "";
  if (block === "spaced") {
    const head = area.value.slice(0, s), tail = area.value.slice(e);
    before = !head || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
    after = !tail || tail.startsWith("\n\n") ? "" : tail.startsWith("\n") ? "\n" : "\n\n";
  } else if (block) {
    if (s > 0 && area.value[s - 1] !== "\n") before = "\n";
    if (e < area.value.length && area.value[e] !== "\n") after = "\n";
  }
  const all = `${before}${text}${after}`;
  if (area.mdFlow || !document.execCommand("insertText", false, all)) area.setRangeText(all, s, e, "end");
  if (pick) area.setSelectionRange(s + before.length + pick[0], s + before.length + pick[1]);
  area.dispatchEvent(new Event("input"));
}

// Around what's picked (bold, a link…), or around a word to type over.
function mdWrap(area, left, right, placeholder) {
  const s = area.selectionStart, e = area.selectionEnd;
  const inner = area.value.slice(s, e) || placeholder;
  mdPut(area, `${left}${inner}${right}`, { pick: [left.length, left.length + inner.length] });
}

// The start of the caret's line (or each picked line): "# ", "- ", "> "…
// add: a list's or a quote's: with nothing picked, on a line that has
// something on it (a table's row, a sentence), a new line of its own.
function mdLines(area, prefix, { strip = /^(#{1,6} |[-*+] (\[.\] )?|\d+\. |> )/, add = false } = {}) {
  const v = area.value;
  if (add && area.selectionStart === area.selectionEnd) {
    const ls = v.lastIndexOf("\n", area.selectionStart - 1) + 1;
    let le = v.indexOf("\n", area.selectionStart);
    if (le < 0) le = v.length;
    if (v.slice(ls, le).trim()) {
      area.setSelectionRange(le, le);
      const first = typeof prefix === "function" ? prefix(0) : prefix;
      return mdPut(area, `\n${first}`, { pick: [first.length + 1, first.length + 1] });
    }
  }
  const s = v.lastIndexOf("\n", area.selectionStart - 1) + 1;
  let e = v.indexOf("\n", area.selectionEnd);
  if (e < 0) e = v.length;
  const lines = v.slice(s, e).split("\n").map((l, i) => {
    const p = typeof prefix === "function" ? prefix(i) : prefix;
    const bare = l.replace(strip, "");
    return `${p}${bare}`;
  });
  area.setSelectionRange(s, e);
  const text = lines.join("\n");
  mdPut(area, text, { pick: [text.length, text.length] });
}

// --------------------------------------------------------- what there is

const MD_CALLOUTS = [["note", "Note"], ["info", "Info"], ["tip", "Tip"], ["important", "Important"], ["success", "Done"], ["question", "Question"],
  ["warning", "Warning"], ["caution", "Caution"], ["danger", "Danger"], ["bug", "Bug"], ["example", "Example"], ["quote", "Quote"], ["abstract", "Summary"], ["todo", "To do"]];

// Each thing Insert makes: [group, label, what it is, words it's found by, run(area, tab)].
const MD_INSERTS = [
  ["Pages and files", "New page…", "A page inside this one: its own folder and note, linked here", "subpage folder nest child note", (a, t) => mdNewPage(a, t)],
  ["Pages and files", "Attach a file…", "A file from this device, into files/, linked here", "file pdf upload attachment embed document", (a, t) => mdPickFiles(a, t, false)],
  ["Pages and files", "Insert a picture…", "A picture from this device, shown in the note", "image photo picture embed screenshot", (a, t) => mdPickFiles(a, t, true)],
  ["Pages and files", "Show a PDF or picture…", "One from this device, into files/, shown right in the note (scroll on past it)", "embed pdf show inline preview document picture photo view read",
    (a, t) => mdPickFiles(a, t, false, true)],
  ["Pages and files", "Show a file from the vault…", "A PDF, picture or video already in the vault, shown in the note", "embed pdf show vault existing attachment picture",
    (a, t) => mdVaultFilePick(a, t)],
  ["Pages and files", "Link to a note…", "A link to another note in the vault", "link note wiki internal", (a, t) => mdNoteLink(a, t)],
  ["Pages and files", "Web link", "A link to a web page: [text](https://…)", "url link web address href", (a) => mdWrap(a, "[", "](https://)", "text")],
  ["Pages and files", "Picture from the web", "A picture from an address: ![](https://…)", "image url embed remote", (a) => mdPut(a, "![](https://)", { block: true, pick: [4, 12] })],
  ["Headings", "Heading 1", "The biggest title: # ", "title h1 header", (a) => mdLines(a, "# ")],
  ["Headings", "Heading 2", "A section: ## ", "subtitle h2 header section", (a) => mdLines(a, "## ")],
  ["Headings", "Heading 3", "A part of a section: ### ", "h3 header", (a) => mdLines(a, "### ")],
  ["Headings", "Heading 4", "Smaller still: #### ", "h4 header", (a) => mdLines(a, "#### ")],
  ["Headings", "Plain text", "No heading, list or quote: just the line", "paragraph normal body text clear", (a) => mdLines(a, "")],
  ["Text", "Bold", "**strong**", "strong bold heavy", (a) => mdWrap(a, "**", "**", "bold")],
  ["Text", "Italic", "*slanted*", "italic emphasis em", (a) => mdWrap(a, "*", "*", "italic")],
  ["Text", "Strikethrough", "~~crossed out~~", "strike delete crossed", (a) => mdWrap(a, "~~", "~~", "crossed out")],
  ["Text", "Highlight", "==marked==, like a highlighter", "mark highlight yellow", (a) => mdWrap(a, "==", "==", "highlighted")],
  ["Text", "Inline code", "`code` in a sentence", "code monospace inline backtick", (a) => mdWrap(a, "`", "`", "code")],
  ["Text", "Inline math", "$x^2$, written as it is", "math formula latex equation inline", (a) => mdWrap(a, "$", "$", "x^2")],
  ["Text", "Footnote", "A number here, its note below: [^1]", "footnote reference note citation", (a, t) => mdFootnote(a, t)],
  ["Text", "Comment", "%%only you see it, writing%%", "comment hidden private note", (a) => mdWrap(a, "%%", "%%", "a comment")],
  ["Text", "Tag", "#tag: notes found by it", "tag hashtag label category", (a) => mdWrap(a, "#", "", "tag")],
  ["Text", "Today's date", "As YYYY-MM-DD", "date today day", (a) => mdPut(a, new Date().toLocaleDateString("sv-SE"))],
  ["Text", "The time", "As HH:MM", "time now clock", (a) => mdPut(a, new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }))],
  ["Lists", "Bulleted list", "- one\n- two", "bullet list unordered ul points", (a) => mdLines(a, "- ", { add: true })],
  ["Lists", "Numbered list", "1. first\n2. second", "numbered ordered list ol steps", (a) => mdLines(a, (i) => `${i + 1}. `, { add: true })],
  ["Lists", "Checklist", "- [ ] something to do (tick it in the note)", "todo task checkbox check list", (a) => mdLines(a, "- [ ] ", { add: true })],
  ["Blocks", "Table…", "Rows and columns", "table grid columns rows spreadsheet", (a) => mdTableDialog(a)],
  ["Blocks", "Quote", "> Someone said…", "quote blockquote citation", (a) => mdLines(a, "> ", { add: true })],
  ["Blocks", "Divider", "A line across: ---", "divider rule line separator hr horizontal", (a) => mdPut(a, "\n---\n", { block: true })],
  ["Blocks", "Code block", "```\nlines of code\n```", "code block fence program snippet pre", (a) => mdPut(a, "```\n\n```", { block: "spaced", pick: [4, 4] })],
  ["Blocks", "Math block", "$$ a formula on its own lines $$", "math formula block latex equation display", (a) => mdPut(a, "$$\n\n$$", { block: "spaced", pick: [3, 3] })],
  ...MD_CALLOUTS.map(([kind, name]) => ["Callouts", `${name} callout`, `A box: > [!${kind}]`, `callout admonition box ${kind} ${name.toLowerCase()}`,
    (a) => mdPut(a, `> [!${kind}] ${name}\n> `, { block: true, pick: [`> [!${kind}] ${name}\n> `.length, `> [!${kind}] ${name}\n> `.length] })]),
  ["Callouts", "Folding callout", "A box that opens with a click: > [!note]-", "collapsible fold toggle details callout", (a) => mdPut(a, "> [!note]- Title\n> ", { block: true, pick: [11, 16] })],
];

// ------------------------------------------------------------- the menu

// A note's right click (Shift and a right click: the browser's own).
function mdInsertHooks(node, tab) {
  node.addEventListener("contextmenu", (e) => {
    if (e.shiftKey || !tab.writable) return;
    // A link to a PDF, a picture…: shown here instead; one shown: a link again.
    const link = e.target.closest("a.md-link[data-md]");
    const shown = e.target.closest("[data-md]:is(img, video, audio, .md-embed-shown, .md-embed-pdf-box, .md-embed-note, .md-embed-base)");
    const fileOf = (n) => n?.title || n?.querySelector?.("iframe")?.title || "";
    if (link && !e.target.closest(".md-embed-body") && /^(pdf|image|video|audio)$/.test(padKind(fileOf(link)))) {
      e.preventDefault();
      e.stopPropagation();
      return openMenu(e.clientX, e.clientY, [
        { label: "Open", run: () => link.click() },
        { label: "Show it in the note", run: () => mdSwapEmbed(link, true) },
      ]);
    }
    if (shown && !e.target.closest(".md-embed-body")) {
      e.preventDefault();
      e.stopPropagation();
      return openMenu(e.clientX, e.clientY, [{ label: "Make it a link", run: () => mdSwapEmbed(shown, false) }]);
    }
    if (e.target.closest(".md-note-head, a[href], input, .md-properties")) return;
    e.preventDefault();
    e.stopPropagation();
    const area = e.target.closest("textarea") || (e.target.closest(".md-flow") ? mdFlowOf(e.target.closest(".md-flow-box")) : null);
    const picked = area && area.selectionEnd > area.selectionStart ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
    // The menu takes the focus (and Live puts the block away): the caret's held.
    const back = area ? mdHold(area) : null;
    const editor = async () => (back ? back() : mdEditorAt(tab, e.target));
    const run = (label) => async () => {
      const a = await editor();
      if (!a) return toast("Can't write here.");
      MD_INSERTS.find((x) => x[1] === label)[4](a, tab);
    };
    const items = [
      ...(picked ? [{ label: "Cut", run: async () => { navigator.clipboard?.writeText(picked); const a = await editor(); if (a) mdPut(a, ""); } },
        { label: "Copy", run: () => navigator.clipboard?.writeText(picked).then(() => toast("Copied."), () => toast("The browser won't copy from here: Ctrl+C.")) }] : []),
      ...(area && navigator.clipboard?.readText ? [{ label: "Paste", run: () => navigator.clipboard.readText().then(async (t) => { const a = await editor(); if (a) mdPut(a, t); }, () => toast("The browser won't paste from here: Ctrl+V.")) }] : []),
      { label: "New page…", run: run("New page…") },
      { label: "Attach a file…", run: run("Attach a file…") },
      { label: "Insert a picture…", run: run("Insert a picture…") },
      { label: "Link to a note…", run: run("Link to a note…") },
      { label: "Table…", run: run("Table…") },
      { label: "Checklist", run: run("Checklist") },
      ...(picked ? [{ label: "Bold", run: run("Bold") }, { label: "Highlight", run: run("Highlight") }] : []),
      { label: "Insert… (Ctrl+/)", run: async () => mdInsertPalette(tab, await editor()) },
    ];
    openMenu(e.clientX, e.clientY, items);
  });
}

// Insert…: everything, by group; type to narrow it down; ↑ ↓, Enter.
function mdInsertPalette(tab, area) {
  if (!tab?.writable) return toast("This note is read-only here.");
  if (!area) return toast("Can't write here.");
  const back = mdHold(area);
  const search = el("input", { class: "field-input md-ins-search", type: "search", placeholder: "Insert: heading, table, callout, checklist…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "md-ins-list", role: "listbox" });
  let shown = [], at = 0, picked = false;
  const pick = (item) => {
    picked = true;
    closeModal();
    const a = back();
    if (a) item[4](a, tab);
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    shown = MD_INSERTS.filter((x) => !q || `${x[1]} ${x[2]} ${x[3]} ${x[0]}`.toLowerCase().includes(q));
    at = Math.min(at, Math.max(0, shown.length - 1));
    const rows = [];
    let group = "";
    shown.forEach((x, i) => {
      if (x[0] !== group) { group = x[0]; rows.push(el("div", { class: "md-ins-group" }, group)); }
      const b = el("button", { type: "button", class: `md-ins-item${i === at ? " on" : ""}`, role: "option", "aria-selected": String(i === at) },
        el("span", { class: "md-ins-label" }, x[1]), el("span", { class: "md-ins-what" }, x[2]));
      b.addEventListener("click", () => pick(x));
      b.addEventListener("pointermove", () => { if (at !== i) { at = i; draw(); } });
      rows.push(b);
    });
    list.replaceChildren(...(rows.length ? rows : [el("p", { class: "md-ins-none" }, "Nothing called that.")]));
    list.querySelector(".md-ins-item.on")?.scrollIntoView({ block: "nearest" });
  };
  search.addEventListener("input", () => { at = 0; draw(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
    else if (e.key === "Enter" && shown[at]) { e.preventDefault(); pick(shown[at]); }
  });
  openModal(el("div", { class: "dialog material md-ins", role: "dialog", "aria-modal": "true", "aria-label": "Insert" }, search, list),
    { onClose: () => { if (!picked) back(); } });
  draw();
  search.focus();
}

// ------------------------------------------------------------ the bigger ones

// A table: so many columns and rows, its first row the headings.
function mdTableDialog(area) {
  const back = mdHold(area);
  const cols = el("input", { class: "field-input", type: "number", min: "1", max: "20", value: "3", "aria-label": "Columns" });
  const rows = el("input", { class: "field-input", type: "number", min: "1", max: "100", value: "3", "aria-label": "Rows" });
  const make = el("button", { type: "button", class: "button-primary wide" }, "Insert");
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  const go = () => {
    const c = Math.max(1, Math.min(20, Number(cols.value) || 3)), r = Math.max(1, Math.min(100, Number(rows.value) || 3));
    const head = `| ${Array.from({ length: c }, (_, i) => `Column ${i + 1}`).join(" | ")} |`;
    const line = `| ${Array(c).fill("---").join(" | ")} |`;
    const body = Array.from({ length: r }, () => `| ${Array(c).fill("   ").join(" | ")} |`);
    closeModal();
    const a = back();
    if (a) mdPut(a, [head, line, ...body].join("\n"), { block: "spaced", pick: [2, 10] });
  };
  make.addEventListener("click", go);
  for (const i of [cols, rows]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  openModal(el("div", { class: "dialog material md-table-dialog", role: "dialog", "aria-modal": "true" },
    el("h2", {}, "A table"),
    el("div", { class: "md-table-size" }, el("label", {}, el("span", {}, "Columns"), cols), el("label", {}, el("span", {}, "Rows"), rows)),
    el("p", {}, "The first row is the headings; type over them."),
    el("div", { class: "dialog-actions" }, cancel, make)));
  cols.select();
}

// A page inside this one: a folder in the note's folder, named as you
// typed it (spaces as hyphens: Second-Year), with its own note inside
// (second-year.md, as the vault names them), its title at the top; a
// link to it here, then it opens, ready to have pages of its own.
async function mdNewPage(area, tab) {
  const back = mdHold(area);
  const name = (await nameDialog({ title: "A new page, inside this one", button: "Create" }))?.trim();
  if (!name) return back();
  const base = mdFolderOf(tab.path);
  const folder = name.replace(/[\\/]+/g, "-").replace(/\s+/g, "-").replace(/^\.+/, "") || "Page";
  const where = base ? `${base}/${folder}` : folder;
  const file = mdFileName(`${name}.md`).replace(/\.md$/i, "") + ".md";
  const end = mdLineEnd(tab.text || "");
  if (!adler.index.folders.includes(where) && !await filesPost("mkdir", { path: mdFull(base).replace(/\/$/, "") || adler.vault, name: folder })) return;
  const made = await mdCreate(`${where}/${file}`, `# ${name}${end}\n`);
  if (!made) return;
  const a = back();
  if (a) mdPut(a, `${mdLinkTo(tab.path, made, name)}${end}`, { block: true });
  adler.expanded.add(where);
  await mdSave(tab);
  await mdOpen(made);
  toast(`${name}: a page of its own, in ${where}.`);
}

// Files from this device: into the attachment folder, linked (a picture shown).
function mdPickFiles(area, tab, picture, show = false) {
  const back = mdHold(area);
  const picker = el("input", { type: "file", multiple: "", hidden: "", ...(picture ? { accept: "image/*" } : show ? { accept: "application/pdf,image/*,video/*,audio/*" } : {}) });
  picker.addEventListener("change", () => {
    if (picker.files.length) mdPasteFiles({ preventDefault() {} }, picker.files, back(), tab, { dropped: !picture && !show, show });
    picker.remove();
  });
  document.body.append(picker);
  picker.click();
}

// A link to a note: the notes, searched by name.
function mdNoteLink(area, tab) {
  const back = mdHold(area);
  const was = area.value.slice(area.selectionStart, area.selectionEnd);
  const notes = [...adler.names].filter((n) => /\.md$/i.test(n) && n !== tab.path).sort((a, b) => a.localeCompare(b));
  const search = el("input", { class: "field-input md-ins-search", type: "search", placeholder: "Which note?", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "md-ins-list", role: "listbox" });
  let shown = [], at = 0;
  const pick = (n) => {
    closeModal();
    const a = back();
    if (a) mdPut(a, mdLinkTo(tab.path, n, was || n.split("/").pop().replace(/\.md$/i, "")));
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    shown = notes.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 80);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((n, i) => {
      const b = el("button", { type: "button", class: `md-ins-item${i === at ? " on" : ""}`, role: "option" },
        el("span", { class: "md-ins-label" }, n.split("/").pop().replace(/\.md$/i, "")), el("span", { class: "md-ins-what" }, mdFolderOf(n) || "the vault's top"));
      b.addEventListener("click", () => pick(n));
      return b;
    }));
    list.querySelector(".md-ins-item.on")?.scrollIntoView({ block: "nearest" });
  };
  search.addEventListener("input", () => { at = 0; draw(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
    else if (e.key === "Enter" && shown[at]) { e.preventDefault(); pick(shown[at]); }
  });
  openModal(el("div", { class: "dialog material md-ins", role: "dialog", "aria-modal": "true", "aria-label": "Link to a note" }, search, list));
  draw();
  search.focus();
}

// A footnote: its number here, and its line under this block.
function mdFootnote(area, tab) {
  const used = [...(tab.text || "").matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  const s = area.selectionEnd;
  mdPut(area, `[^${n}]`);
  const v = area.value;
  const lineEnd = v.indexOf("\n", s);
  area.setSelectionRange(lineEnd < 0 ? v.length : lineEnd, lineEnd < 0 ? v.length : lineEnd);
  const def = `\n\n[^${n}]: `;
  mdPut(area, def, { pick: [def.length, def.length] });
}

// A link (as written: [Lab 1](files/lab-1.pdf)) shown in the note instead
// (![Lab 1](…)), or one shown made a link again: changed in the note where
// it's written (the lines of the block it's in), then drawn again.
function mdSwapEmbed(node, show) {
  const tab = mdTab();
  const raw = node?.closest("[data-md]")?.dataset.md;
  if (!tab?.writable || !raw || tab.text === null) return;
  const block = node.closest("[data-from]");
  const lines = tab.text.split("\n");
  const from = block ? Number(block.dataset.from) : 0;
  const to = block ? Math.max(from + 1, Number(block.dataset.to) || from + 1) : lines.length;
  const part = lines.slice(from, to).join("\n");
  let at = -1;
  for (let i = part.indexOf(raw); i >= 0; i = part.indexOf(raw, i + 1)) {
    if (show ? part[i - 1] !== "!" : true) { at = i; break; }
  }
  if (at < 0) return toast("Can't find it in the note to change it.");
  const now = show ? `!${raw}` : raw.replace(/^!/, "");
  const changed = part.slice(0, at) + now + part.slice(at + raw.length);
  lines.splice(from, to - from, ...changed.split("\n"));
  tab.text = lines.join("\n");
  mdDirty(tab, 300);
  mdRenderMain();
}

// A file in the vault (not a note) to show here: picked by name.
function mdVaultFilePick(area, tab) {
  const back = mdHold(area);
  const files = [...adler.names].filter((n) => /^(pdf|image|video|audio)$/.test(padKind(n))).sort((a, b) => a.split("/").pop().localeCompare(b.split("/").pop()));
  const search = el("input", { class: "field-input md-ins-search", type: "search", placeholder: "Which file? (a PDF, a picture…)", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "md-ins-list", role: "listbox" });
  let shown = [], at = 0;
  const pick = (f) => {
    closeModal();
    const a = back();
    if (a) mdPut(a, mdLinkTo(tab.path, f, f.split("/").pop().replace(/\.[^.]+$/, ""), true), { block: true });
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    shown = files.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 80);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((n, i) => {
      const b = el("button", { type: "button", class: `md-ins-item${i === at ? " on" : ""}`, role: "option" },
        el("span", { class: "md-ins-label" }, n.split("/").pop()), el("span", { class: "md-ins-what" }, mdFolderOf(n) || "the vault's top"));
      b.addEventListener("click", () => pick(n));
      return b;
    }) : [el("p", { class: "md-ins-none" }, files.length ? "Nothing called that." : "No PDFs or pictures in the vault yet.")]));
    list.querySelector(".md-ins-item.on")?.scrollIntoView({ block: "nearest" });
  };
  search.addEventListener("input", () => { at = 0; draw(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
    else if (e.key === "Enter" && shown[at]) { e.preventDefault(); pick(shown[at]); }
  });
  openModal(el("div", { class: "dialog material md-ins", role: "dialog", "aria-modal": "true", "aria-label": "Show a file" }, search, list));
  draw();
  search.focus();
}
