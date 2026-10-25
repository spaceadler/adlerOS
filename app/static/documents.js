// Documents: your papers as Paperless-ngx has them: titles, correspondents,
// types, tags and dates, and the words it read in them (search finds a
// document by what it says). A document opens with its preview beside what
// Paperless knows (its notes, its text too); files dropped on the window (or
// Add documents) go to Paperless to read. adlerOS's server asks Paperless
// (PAPERLESS_TOKEN): the page never sees the token. Before it's connected
// (or while Paperless is off), the files themselves, from your Documents
// folder, with what connecting adds. Uses el, svg, $, api, toast, openApp,
// openFiles, fileUrl, downloadFile, registerWindow, registerNav, bytes,
// winLoad/winSave.
"use strict";

const DOCS_KEY = "adleros.documents";
const DOC_ICONS = {
  all: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  close: ["M18 6 6 18", "m6 6 12 12"], back: ["m15 18-6-6 6-6"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  add: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
  open: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  rows: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
};
const DOC_SORTS = [["-created", "Newest first"], ["created", "Oldest first"], ["-added", "Recently added"], ["title", "Title"], ["correspondent__name", "Correspondent"]];

const docs = {
  built: false, status: null, meta: null,
  view: { kind: "list", filter: {} }, back: [], fwd: [],
  list: null, prefs: { sort: "-created", mode: "grid", allTags: false },
};

async function docGet(path) {
  const { status, body } = await api(`/api/paperless/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status !== 200) throw new Error(body?.error || "Paperless didn't answer");
  return body;
}

const docDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const docColor = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : fallback);

// ------------------------------------------------------------ the window

async function openDocuments() {
  docsBuild();
  openWindow("documents");
  if (!docs.status?.ok) await docsCheck();
}

function toggleDocuments() { toggleWindow("documents", () => openDocuments()); }

function closeDocuments() { closeWindow("documents"); }

function docsBuild() {
  if (docs.built) return;
  docs.built = true;
  const saved = winLoad(DOCS_KEY, null);
  if (saved && typeof saved === "object") docs.prefs = { ...docs.prefs, ...saved };
  const close = el("button", { class: "sheet-close doc-close", type: "button", "aria-label": "Close Documents" }, svg(DOC_ICONS.close));
  close.addEventListener("click", closeDocuments);
  const search = el("input", { class: "field-input doc-search", id: "doc-search", type: "search", placeholder: "Search inside them", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const query = search.value.trim();
      if (query) docShow({ kind: "list", filter: { query } }, docs.view.filter?.query === undefined);
      else if (docs.view.filter?.query) docShow({ kind: "list", filter: {} });
    }, 300);
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; search.dispatchEvent(new Event("input")); } });
  const picker = el("input", { type: "file", multiple: "", hidden: "", id: "doc-picker" });
  picker.addEventListener("change", () => { docUpload([...picker.files]); picker.value = ""; });
  const section = el("section", { id: "documents", class: "sheet documents-app", "aria-label": "Documents", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close, picker,
    el("div", { class: "doc-shell" },
      el("aside", { class: "doc-side" }, el("label", { class: "doc-search-box" }, svg(DOC_ICONS.search), search),
        el("nav", { class: "doc-side-nav", id: "doc-side-nav", "aria-label": "Documents" })),
      el("main", { class: "doc-main", id: "doc-main", tabindex: "-1" })));
  document.body.insertBefore(section, $("modal"));
  section.querySelector(".doc-shell").append(sideToggle(section, "documents"));
  registerWindow("documents", { title: "Documents", close: closeDocuments, hide: () => closeWindow("documents"), dock: "documents", size: [1180, 780] });
  // Files dropped on it: to Paperless.
  section.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files") && docs.status?.ok) { e.preventDefault(); section.classList.add("doc-dropping"); } });
  section.addEventListener("dragleave", (e) => { if (!section.contains(e.relatedTarget)) section.classList.remove("doc-dropping"); });
  section.addEventListener("drop", (e) => {
    section.classList.remove("doc-dropping");
    if (!e.dataTransfer?.files.length || !docs.status?.ok) return;
    e.preventDefault();
    docUpload([...e.dataTransfer.files]);
  });
  section.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); search.focus(); }
    if (e.key === "Escape" && docs.view.kind === "doc" && !e.target.closest("input")) { e.preventDefault(); docNav(-1); }
  });
  docRenderSide();
}

async function docsCheck() {
  $("doc-main").replaceChildren(el("div", { class: "doc-empty" }, el("p", {}, "Asking Paperless…")));
  docs.status = await docGet("status").catch((e) => ({ error: e.message }));
  if (docs.status.ok) docs.meta = docIndexMeta(await docGet("meta").catch(() => ({ tags: [], correspondents: [], types: [] })));
  else docs.local = await docGet("local").catch(() => null);
  docRenderSide();
  docRender();
}

function docIndexMeta(m) {
  const by = (list) => new Map(list.map((x) => [x.id, x]));
  return { ...m, tag: by(m.tags), correspondent: by(m.correspondents), type: by(m.types), inbox: m.tags.filter((t) => t.is_inbox_tag).map((t) => t.id) };
}

function docSavePrefs() { winSave(DOCS_KEY, docs.prefs); }

// ------------------------------------------------------------- the side

function docRenderSide() {
  const nav = $("doc-side-nav");
  if (!nav) return;
  const f = docs.view.kind === "list" ? docs.view.filter || {} : {};
  const item = (label, icon, filter, count = null, color = null) => {
    const on = docs.view.kind === "list" && JSON.stringify(f) === JSON.stringify(filter);
    const mark = color ? el("span", { class: "doc-dot" }) : svg(DOC_ICONS[icon]);
    if (color) mark.style.background = docColor(color, "#888");
    const b = el("button", { type: "button", class: `doc-nav${on ? " on" : ""}` }, mark, el("span", { class: "doc-nav-name" }, label),
      ...(count !== null ? [el("span", { class: "doc-nav-count" }, String(count))] : []));
    b.addEventListener("click", () => docShow({ kind: "list", filter }));
    return b;
  };
  $("doc-search").placeholder = docs.status?.ok ? "Search inside them" : "Find by name";
  if (!docs.status?.ok) {
    const all = item("All documents", "all", {}, docs.local?.items.length ?? null);
    const connect = el("button", { type: "button", class: `doc-nav doc-nav-connect${docs.view.kind === "connect" ? " on" : ""}` }, svg(DOC_ICONS.open), el("span", {}, "Connect Paperless"));
    connect.addEventListener("click", () => docShow({ kind: "connect" }));
    return nav.replaceChildren(all, connect);
  }
  const m = docs.meta;
  const parts = [item("All documents", "all", {}, docs.status?.count ?? null)];
  if (m?.inbox.length) parts.push(item("Inbox", "inbox", { inbox: true }));
  const group = (title, list, make, limit = 8, key = null) => {
    if (!list?.length) return;
    const sorted = [...list].sort((a, b) => (b.document_count || 0) - (a.document_count || 0) || a.name.localeCompare(b.name));
    const all = key && docs.prefs[key];
    parts.push(el("h3", { class: "doc-side-title" }, title), ...sorted.slice(0, all ? sorted.length : limit).map(make));
    if (key && sorted.length > limit) {
      const more = el("button", { type: "button", class: "doc-more" }, all ? "Fewer" : `All ${sorted.length}`);
      more.addEventListener("click", () => { docs.prefs[key] = !all; docSavePrefs(); docRenderSide(); });
      parts.push(more);
    }
  };
  group("Tags", m?.tags.filter((t) => t.document_count), (t) => item(t.name, null, { tag: t.id }, t.document_count, t.color), 10, "allTags");
  group("Correspondents", m?.correspondents.filter((c) => c.document_count), (c) => item(c.name, "all", { correspondent: c.id }, c.document_count), 8, "allPeople");
  group("Types", m?.types.filter((t) => t.document_count), (t) => item(t.name, "all", { type: t.id }, t.document_count), 8, "allTypes");
  const add = el("button", { type: "button", class: "doc-nav doc-nav-add" }, svg(DOC_ICONS.add), el("span", {}, "Add documents"));
  add.addEventListener("click", () => $("doc-picker").click());
  const app = typeof appById === "function" ? appById("paperless-ngx") || appById("paperless") : null;
  const out = app ? el("button", { type: "button", class: "doc-nav doc-nav-out" }, svg(DOC_ICONS.open), el("span", {}, "Open Paperless")) : null;
  out?.addEventListener("click", () => openApp(app));
  nav.replaceChildren(...parts, ...(docs.status?.ok ? [add] : []), ...(out ? [out] : []));
}

// ------------------------------------------------------- moving around

function docShow(view, push = true) {
  if (push && JSON.stringify(view) !== JSON.stringify({ kind: docs.view.kind, filter: docs.view.filter, id: docs.view.id })) {
    docs.back = [...docs.back, { ...docs.view, scroll: $("doc-main").scrollTop }].slice(-50);
    docs.fwd = [];
  }
  docs.view = { ...view };
  if (view.kind === "list" && !view.filter?.query) $("doc-search").value = "";
  docRender();
  docRenderSide();
}

function docNav(dir) {
  const to = (dir < 0 ? docs.back : docs.fwd).pop();
  if (!to) return;
  (dir < 0 ? docs.fwd : docs.back).push({ ...docs.view, scroll: $("doc-main").scrollTop });
  docs.view = to;
  $("doc-search").value = to.filter?.query || "";
  docRender(to.scroll || 0);
  docRenderSide();
}
registerNav("documents", (dir) => docNav(dir));

function docRender(scroll = 0) {
  const main = $("doc-main");
  docs.list?.observer?.disconnect();
  docs.list = null;
  const local = !docs.status?.ok;
  if (local && (docs.view.kind === "connect" || !docs.local?.found)) return main.replaceChildren(docSetupPage());
  const page = el("div", { class: "doc-page" });
  main.replaceChildren(page);
  main.scrollTop = 0;
  const done = local ? (docs.view.kind === "doc" ? docLocalDoc(page, docs.view.id) : docLocalList(page, docs.view.filter || {}))
    : docs.view.kind === "doc" ? docDocView(page, docs.view.id) : docListView(page, docs.view.filter || {});
  Promise.resolve(done).then(() => { if (scroll) requestAnimationFrame(() => { main.scrollTop = scroll; }); })
    .catch((e) => { if (e.message !== "login") page.replaceChildren(el("div", { class: "doc-empty" }, el("p", {}, e.message))); });
}

function docSetupPage() {
  const s = docs.status || {};
  const retry = el("button", { type: "button", class: "button-primary" }, "Try again");
  retry.addEventListener("click", docsCheck);
  const body = s.error === "nopaperless"
    ? [el("h2", {}, "Documents shows your papers from Paperless"), el("p", {}, `Paperless-ngx isn't among your apps here. If it runs elsewhere, set PAPERLESS_URL in ${settingsFile()} to its address.`)]
    : s.error === "notoken"
      ? [el("h2", {}, "Documents shows your papers from Paperless"),
        el("p", {}, "Paperless keeps their titles, tags and dates (the files themselves are only numbers). Documents needs a token from it: in Paperless, your name (top right) → My Profile → API Auth Token."),
        el("p", {}, `Put it in ${settingsFile()} as PAPERLESS_TOKEN=…${settingsThen()}.`),
        el("p", { class: "doc-dim" }, `It'll ask Paperless at ${s.url}.`)]
      : s.error === "refused"
        ? [el("h2", {}, "Paperless didn't take the token"), el("p", {}, `PAPERLESS_TOKEN in ${settingsFile()} isn't one Paperless knows: make a new one (My Profile → API Auth Token).`)]
        : [el("h2", {}, "Can't reach Paperless"), el("p", {}, `${s.url || "Paperless"} didn't answer. Is it running? (The App Store starts it.)`),
          ...(s.error ? [el("p", { class: "doc-dim" }, s.error)] : [])];
  const files = el("button", { type: "button", class: "button-secondary" }, "See the files meanwhile");
  files.addEventListener("click", () => docShow({ kind: "list", filter: {} }));
  return el("div", { class: "doc-empty doc-setup" }, ...body, el("div", { class: "doc-setup-actions" }, ...(docs.local?.found ? [files] : []), retry));
}

// --------------------------------------------------------------- the list

function docTitleFor(f) {
  const m = docs.meta;
  if (f.query) return { kicker: "Search", title: `“${f.query}”` };
  if (f.inbox) return { kicker: "", title: "Inbox" };
  if (f.tag) return { kicker: "Tag", title: m?.tag.get(f.tag)?.name || "A tag" };
  if (f.correspondent) return { kicker: "Correspondent", title: m?.correspondent.get(f.correspondent)?.name || "Someone" };
  if (f.type) return { kicker: "Type", title: m?.type.get(f.type)?.name || "A type" };
  return { kicker: "", title: "All documents" };
}

function docParams(f, page) {
  const p = new URLSearchParams({ page: String(page), page_size: "50" });
  if (!f.query) p.set("ordering", docs.prefs.sort);
  if (f.query) p.set("query", f.query);
  if (f.tag) p.set("tags__id__all", String(f.tag));
  if (f.correspondent) p.set("correspondent__id", String(f.correspondent));
  if (f.type) p.set("document_type__id", String(f.type));
  if (f.inbox) p.set("is_in_inbox", "true");
  return p.toString();
}

async function docListView(page, f) {
  const { kicker, title } = docTitleFor(f);
  const count = el("p", { class: "doc-dim" }, "…");
  const sort = el("select", { class: "field-input doc-sort", "aria-label": "Sort by", ...(f.query ? { disabled: "", title: "A search is best match first" } : {}) },
    ...DOC_SORTS.map(([v, label]) => el("option", { value: v, ...(v === docs.prefs.sort ? { selected: "" } : {}) }, label)));
  sort.addEventListener("change", () => { docs.prefs.sort = sort.value; docSavePrefs(); docRender(); });
  const mode = el("button", { type: "button", class: "doc-icon", title: docs.prefs.mode === "grid" ? "As a list" : "As a grid",
    "aria-label": docs.prefs.mode === "grid" ? "As a list" : "As a grid" }, svg(DOC_ICONS[docs.prefs.mode === "grid" ? "rows" : "grid"]));
  mode.addEventListener("click", () => { docs.prefs.mode = docs.prefs.mode === "grid" ? "rows" : "grid"; docSavePrefs(); docRender(); });
  const chips = docFilterChips(f);
  page.append(el("header", { class: "doc-head" }, el("div", {}, ...(kicker ? [el("p", { class: "doc-kicker" }, kicker)] : []), el("h1", {}, title), count),
    el("div", { class: "doc-head-tools" }, sort, mode)), ...(chips ? [chips] : []));
  const box = el("div", { class: docs.prefs.mode === "grid" ? "doc-grid" : "doc-rows" });
  const end = el("div", { class: "doc-end" });
  page.append(box, end);
  const list = { f, page: 1, more: true, loading: false, total: 0, box, end, count };
  docs.list = list;
  await docMore(list);
  list.observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) docMore(list); }, { root: $("doc-main"), rootMargin: "600px" });
  list.observer.observe(end);
}

async function docMore(list) {
  if (list.loading || !list.more || docs.list !== list) return;
  list.loading = true;
  const got = await docGet(`list?${docParams(list.f, list.page)}`).catch((e) => { toast(e.message); return null; });
  list.loading = false;
  if (!got || docs.list !== list) return;
  list.total = got.count;
  list.count.textContent = `${got.count.toLocaleString()} ${got.count === 1 ? "document" : "documents"}`;
  list.box.append(...got.results.map((d) => (docs.prefs.mode === "grid" ? docCard(d) : docRow(d))));
  list.more = Boolean(got.next);
  list.page++;
  if (!got.count) list.box.replaceWith(el("p", { class: "doc-dim doc-none" }, list.f.query ? "Nothing says that." : "No documents here."));
}

function docFilterChips(f) {
  const m = docs.meta;
  const chips = [];
  const chip = (label, without) => {
    const b = el("button", { type: "button", class: "doc-filter" }, label, svg(DOC_ICONS.close));
    b.addEventListener("click", () => { const next = { ...f }; delete next[without]; docShow({ kind: "list", filter: next }); });
    chips.push(b);
  };
  const n = Object.keys(f).length;
  if (n < 2) return null;
  if (f.tag) chip(`Tag: ${m?.tag.get(f.tag)?.name}`, "tag");
  if (f.correspondent) chip(`From: ${m?.correspondent.get(f.correspondent)?.name}`, "correspondent");
  if (f.type) chip(`Type: ${m?.type.get(f.type)?.name}`, "type");
  if (f.query) chip(`Says: ${f.query}`, "query");
  return el("div", { class: "doc-filters" }, ...chips);
}

function docTagChips(ids) {
  const m = docs.meta;
  return (ids || []).map((id) => m?.tag.get(id)).filter(Boolean).map((t) => {
    const c = el("span", { class: "doc-tag" }, t.name);
    c.style.background = docColor(t.color, "#666");
    c.style.color = docColor(t.text_color, "#fff");
    return c;
  });
}

// Where a search matched, its words marked: Paperless says it in HTML, which
// is read here for its words only.
function docHighlights(hit) {
  const html = hit?.highlights || hit?.note_highlights;
  if (!html) return null;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const out = el("p", { class: "doc-hit" });
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) out.append(n.data);
      else if (n.nodeType === Node.ELEMENT_NODE && n.classList.contains("match")) out.append(el("mark", {}, n.textContent));
      else if (n.nodeType === Node.ELEMENT_NODE) walk(n);
    }
  };
  walk(parsed);
  return out;
}

function docCard(d) {
  const m = docs.meta;
  const img = el("img", { src: `/api/paperless/thumb/${d.id}`, alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.remove());
  const who = m?.correspondent.get(d.correspondent)?.name;
  const card = el("button", { type: "button", class: "doc-card" }, el("span", { class: "doc-thumb" }, img),
    el("span", { class: "doc-card-title" }, d.title || d.original_file_name || `Document ${d.id}`),
    el("span", { class: "doc-card-sub" }, [who, docDate(d.created)].filter(Boolean).join(" · ")),
    ...(d.tags?.length ? [el("span", { class: "doc-tags" }, ...docTagChips(d.tags).slice(0, 4))] : []),
    ...(d.__search_hit__ ? [docHighlights(d.__search_hit__) || ""] : []));
  card.addEventListener("click", () => docShow({ kind: "doc", id: d.id }));
  return card;
}

function docRow(d) {
  const m = docs.meta;
  const img = el("img", { src: `/api/paperless/thumb/${d.id}`, alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.remove());
  const row = el("button", { type: "button", class: "doc-row" }, el("span", { class: "doc-thumb small" }, img),
    el("span", { class: "doc-row-main" }, el("span", { class: "doc-card-title" }, d.title || `Document ${d.id}`),
      el("span", { class: "doc-tags" }, ...docTagChips(d.tags)), ...(d.__search_hit__ ? [docHighlights(d.__search_hit__) || ""] : [])),
    el("span", { class: "doc-row-cell" }, m?.correspondent.get(d.correspondent)?.name || ""),
    el("span", { class: "doc-row-cell" }, m?.type.get(d.document_type)?.name || ""),
    el("span", { class: "doc-row-cell doc-row-date" }, docDate(d.created)));
  row.addEventListener("click", () => docShow({ kind: "doc", id: d.id }));
  return row;
}

// ------------------------------------------------------------ a document

async function docDocView(page, id) {
  const [d, meta] = await Promise.all([docGet(`doc/${id}`), docGet(`metadata/${id}`).catch(() => null)]);
  const m = docs.meta;
  page.classList.add("doc-page-doc");
  const back = el("button", { type: "button", class: "doc-icon", title: "Back", "aria-label": "Back" }, svg(DOC_ICONS.back));
  back.addEventListener("click", () => (docs.back.length ? docNav(-1) : docShow({ kind: "list", filter: {} })));
  const download = el("button", { type: "button", class: "button-secondary doc-button" }, svg(DOC_ICONS.download), "Download");
  download.addEventListener("click", () => {
    const a = el("a", { href: `/api/paperless/download/${id}`, download: d.original_file_name || "" });
    document.body.append(a);
    a.click();
    a.remove();
  });
  const isPdf = /pdf/.test(d.mime_type || "") || meta?.has_archive_version;
  const preview = isPdf
    ? el("iframe", { class: "doc-preview", src: `/api/paperless/preview/${id}`, title: d.title || "The document" })
    : el("img", { class: "doc-preview doc-preview-img", src: `/api/paperless/preview/${id}`, alt: d.title || "" });
  const link = (label, filter) => {
    const b = el("button", { type: "button", class: "doc-link" }, label);
    b.addEventListener("click", () => docShow({ kind: "list", filter }));
    return b;
  };
  const row = (label, ...value) => (value.filter(Boolean).length ? el("div", { class: "doc-irow" }, el("span", { class: "doc-ilabel" }, label), el("span", {}, ...value.filter(Boolean))) : "");
  const who = m?.correspondent.get(d.correspondent);
  const type = m?.type.get(d.document_type);
  const tags = (d.tags || []).map((tid) => m?.tag.get(tid)).filter(Boolean).map((t) => {
    const b = el("button", { type: "button", class: "doc-tag" }, t.name);
    b.style.background = docColor(t.color, "#666");
    b.style.color = docColor(t.text_color, "#fff");
    b.addEventListener("click", () => docShow({ kind: "list", filter: { tag: t.id } }));
    return b;
  });
  const notes = (Array.isArray(d.notes) ? d.notes : []).map((n) => el("div", { class: "doc-note" }, el("p", {}, n.note),
    el("span", { class: "doc-dim" }, [n.user?.username, n.created ? docDate(n.created) : ""].filter(Boolean).join(" · "))));
  const content = d.content?.trim()
    ? el("details", { class: "doc-content" }, el("summary", {}, "What it says (the text Paperless read)"), el("pre", {}, d.content.trim()))
    : "";
  page.append(el("header", { class: "doc-head doc-head-doc" }, back, el("div", { class: "doc-head-title" }, el("h1", {}, d.title || `Document ${id}`),
    el("p", { class: "doc-dim" }, [who?.name, docDate(d.created)].filter(Boolean).join(" · "))), download),
  el("div", { class: "doc-split" }, el("div", { class: "doc-preview-box" }, preview),
    el("aside", { class: "doc-info" },
      row("From", who ? link(who.name, { correspondent: who.id }) : ""),
      row("Type", type ? link(type.name, { type: type.id }) : ""),
      ...(tags.length ? [el("div", { class: "doc-irow" }, el("span", { class: "doc-ilabel" }, "Tags"), el("span", { class: "doc-tags" }, ...tags))] : []),
      row("Dated", docDate(d.created)),
      row("Added", docDate(d.added)),
      row("Pages", d.page_count ? String(d.page_count) : ""),
      row("Number", d.archive_serial_number ? `ASN ${d.archive_serial_number}` : ""),
      row("File", d.original_file_name || "", meta?.original_size ? el("small", {}, `${bytes(meta.original_size)}${meta.original_mime_type ? ` · ${meta.original_mime_type}` : ""}`) : ""),
      ...(notes.length ? [el("div", { class: "doc-irow" }, el("span", { class: "doc-ilabel" }, "Notes"), ...notes)] : []),
      content)));
}

// --------------------------------------------------------------- adding

// Files to Paperless: it reads them (OCR, its rules for tags and the rest),
// then they're here, in a minute or so.
async function docUpload(files) {
  if (!files.length) return;
  let sent = 0;
  for (const file of files) {
    const reply = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/paperless/upload?name=${encodeURIComponent(file.name)}`);
      xhr.onloadend = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        resolve({ status: xhr.status, body });
      };
      xhr.send(file);
    });
    if (reply.status === 200) sent++;
    else toast(`${file.name}: ${reply.body?.error || "Paperless didn't take it"}`);
  }
  if (!sent) return;
  toast(sent === 1 ? `Sent to Paperless: ${files[0].name}. It's reading it; it'll be here in a minute or so.`
    : `Sent ${sent} files to Paperless. It's reading them; they'll be here in a minute or so.`);
  for (const wait of [25000, 70000]) {
    setTimeout(async () => {
      if (!isOpen("documents")) return;
      docs.status = await docGet("status").catch(() => docs.status);
      docs.meta = docIndexMeta(await docGet("meta").catch(() => docs.meta));
      docRenderSide();
      if (docs.view.kind === "list") docRender($("doc-main").scrollTop);
    }, wait);
  }
}

// ------------------------------------------------- the files themselves

// What connecting adds, said once, above the files.
function docLocalNote() {
  const s = docs.status || {};
  const why = s.error === "notoken" ? "These are your documents as files. Paperless keeps their titles, tags and correspondents, and the words it read in them."
    : s.error === "nopaperless" ? "These are the documents in your Documents folder, as they are."
      : s.error === "refused" ? "Paperless didn't take the token, so these are the files as they are."
        : "Paperless isn't answering, so these are the files as they are.";
  const how = s.error === "nopaperless" ? "With Paperless-ngx (the App Store has it), they'd be read, named and tagged, and found by what they say."
    : s.error === "notoken" ? "Connect Documents to Paperless and they'll have their names and tags here, and you can search what they say."
      : s.error === "refused" ? "A new token (Paperless → My Profile → API Auth Token) fixes it."
        : "When it's running again (the App Store starts it), they'll have their names, tags and search back.";
  const more = el("button", { type: "button", class: "doc-link" }, "How");
  more.addEventListener("click", () => docShow({ kind: "connect" }));
  return el("div", { class: "doc-note-bar" }, el("p", {}, why, " ", how, " "), more);
}

const docLocalName = (x) => (x.number ? `Document ${x.number}` : x.name.replace(/\.[^.]+$/, ""));

function docLocalList(page, f) {
  const sorts = [["new", "Newest first"], ["old", "Oldest first"], ["name", "Name"]];
  const by = docs.prefs.localSort || "new";
  const q = (f.query || "").toLowerCase();
  const items = docs.local.items.filter((x) => !q || x.name.toLowerCase().includes(q) || docLocalName(x).toLowerCase().includes(q))
    .sort(by === "name" ? (a, b) => docLocalName(a).localeCompare(docLocalName(b), undefined, { numeric: true }) : by === "old" ? (a, b) => a.mtime - b.mtime : (a, b) => b.mtime - a.mtime);
  const sort = el("select", { class: "field-input doc-sort", "aria-label": "Sort by" },
    ...sorts.map(([v, label]) => el("option", { value: v, ...(v === by ? { selected: "" } : {}) }, label)));
  sort.addEventListener("change", () => { docs.prefs.localSort = sort.value; docSavePrefs(); docRender(); });
  page.append(docLocalNote(), el("header", { class: "doc-head" }, el("div", {},
    ...(q ? [el("p", { class: "doc-kicker" }, "Names with")] : []), el("h1", {}, q ? `“${f.query}”` : "All documents"),
    el("p", { class: "doc-dim" }, `${items.length.toLocaleString()} ${items.length === 1 ? "file" : "files"} in ${docs.local.dir}`)),
  el("div", { class: "doc-head-tools" }, sort)));
  if (!items.length) return page.append(el("p", { class: "doc-dim doc-none" }, q ? "No file's name has that (searching what they say needs Paperless)." : "No documents in that folder."));
  page.append(el("div", { class: "doc-grid" }, ...items.map((x) => {
    const thumb = el("span", { class: "doc-thumb" });
    const src = x.thumb || (/^(png|jpe?g|webp|gif)$/.test(x.suffix) ? x.path : null);
    if (src) {
      const img = el("img", { src: fileUrl(src, true), alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => img.remove());
      thumb.append(img);
    } else thumb.append(el("span", { class: "doc-kind" }, x.suffix.toUpperCase()));
    const card = el("button", { type: "button", class: "doc-card" }, thumb, el("span", { class: "doc-card-title" }, docLocalName(x)),
      el("span", { class: "doc-card-sub" }, [x.number ? x.name : "", new Date(x.mtime * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · ")));
    card.addEventListener("click", () => docShow({ kind: "doc", id: x.path }));
    return card;
  })));
}

function docLocalDoc(page, path) {
  const x = docs.local.items.find((i) => i.path === path);
  if (!x) return page.append(el("p", { class: "doc-dim" }, "That file isn't there any more."));
  page.classList.add("doc-page-doc");
  const back = el("button", { type: "button", class: "doc-icon", title: "Back", "aria-label": "Back" }, svg(DOC_ICONS.back));
  back.addEventListener("click", () => (docs.back.length ? docNav(-1) : docShow({ kind: "list", filter: {} })));
  const download = el("button", { type: "button", class: "button-secondary doc-button" }, svg(DOC_ICONS.download), "Download");
  download.addEventListener("click", () => downloadFile(x.path));
  const shown = x.archive || x.path;
  const pdf = /\.pdf$/i.test(shown);
  const picture = /^(png|jpe?g|webp|gif)$/.test(x.suffix);
  const preview = pdf ? el("iframe", { class: "doc-preview", src: fileUrl(shown, true), title: docLocalName(x) })
    : picture ? el("img", { class: "doc-preview doc-preview-img", src: fileUrl(x.path, true), alt: "" })
      : el("div", { class: "doc-empty" }, el("p", {}, `A .${x.suffix} file: download it to open it.`));
  const row = (label, value) => el("div", { class: "doc-irow" }, el("span", { class: "doc-ilabel" }, label), el("span", {}, value));
  const where = el("button", { type: "button", class: "doc-link" }, "Show in My Computer");
  where.addEventListener("click", () => openFiles(x.path.split("/").slice(0, -1).join("/")));
  page.append(docLocalNote(), el("header", { class: "doc-head doc-head-doc" }, back, el("div", { class: "doc-head-title" }, el("h1", {}, docLocalName(x)),
    el("p", { class: "doc-dim" }, x.name)), download),
  el("div", { class: "doc-split" }, el("div", { class: "doc-preview-box" }, preview),
    el("aside", { class: "doc-info" }, row("File", x.name), row("Size", bytes(x.size)),
      row(x.number ? "Added" : "Changed", new Date(x.mtime * 1000).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })),
      ...(x.archive ? [row("Shown", "Paperless's searchable PDF of it")] : []),
      el("div", { class: "doc-irow" }, where))));
}
