// Books: the PDFs and EPUBs in Media/Books, read like a book. Two ways to
// see one: the Book (paper, two pages side by side where there's room, one
// in a phone's portrait; a page turned by its corner, dragged like a real
// one, or by the arrows, the same fold drawn), and the Text (white on
// black, the words laid out for the screen: a page is what fits, so how
// many there are depends on the window and the size of the letters; a
// swipe or a tap at the edge turns it). A PDF's own pages in the Book; its
// words, taken out once (kept on the server, for every device), in the
// Text. Where you are in each is kept on the server too.
// Uses el, svg, $, api, toast, showLock, registerWindow, openWindow,
// toggleWindow, closeWindow, isOpen, winLoad/winSave, phoneLayout,
// registerNav, sideToggle, openMenu, and Luna's mdPdfJs (pdf.js, one worker).
"use strict";

const BK_KEY = "adleros.books";
const BK_ICONS = {
  close: ["M18 6 6 18", "m6 6 12 12"], back: ["m15 18-6-6 6-6"],
  now: ["M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z", "M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"],
  all: ["M4 4h4v16H4z", "M10 4h4v16h-4z", "m16 5 4-1 3 15-4 1z"],
  pdf: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
  find: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  toc: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  prev: ["m15 18-6-6 6-6"], next: ["m9 18 6-6-6-6"],
  text: ["M4 7V4h16v3", "M9 20h6", "M12 4v16"],
};

const bk = {
  built: false, loaded: false, books: [], dir: "", found: true, view: "now", q: "",
  prefs: { font: 19, view: {}, theme: "dark" },
  r: null, covering: false,
};

const bkEnc = encodeURIComponent;
const bkById = (id) => bk.books.find((b) => b.id === id);

async function bkGet(path) {
  const { status, body } = await api(`/api/books/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status !== 200) throw new Error(body?.error || "adlerOS didn't answer.");
  return body;
}

async function bkPost(what, body) {
  const { status, body: got } = await api(`/api/books/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  return status === 200 ? got : null;
}

function bkSavePrefs() { winSave(BK_KEY, bk.prefs); }

// ------------------------------------------------------------ the window

async function openBooks() {
  bkBuild();
  openWindow("books");
  if (!bk.r) await bkLoad();
  if (!$("books").contains(document.activeElement)) (bk.r ? $("bk-stage") : $("bk-main")).focus({ preventScroll: true });
}

function toggleBooks() { toggleWindow("books", () => openBooks()); }

function closeBooks() {
  bkSaveNow();
  closeWindow("books");
}

function bkBuild() {
  if (bk.built) return;
  bk.built = true;
  const saved = winLoad(BK_KEY, null);
  if (saved && typeof saved === "object") bk.prefs = { ...bk.prefs, ...saved, view: saved.view && typeof saved.view === "object" ? saved.view : {} };
  const close = el("button", { class: "sheet-close bk-close", type: "button", "aria-label": "Close Books" }, svg(BK_ICONS.close));
  close.addEventListener("click", closeBooks);
  const search = el("input", { class: "field-input bk-search", id: "bk-search", type: "search", placeholder: "Search", spellcheck: "false", autocomplete: "off" });
  search.addEventListener("input", () => { bk.q = search.value.trim(); bkRender(); });
  const section = el("section", { id: "books", class: "sheet books-app", "aria-label": "Books", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "bk-shell", id: "bk-shell" },
      el("aside", { class: "bk-side" }, el("label", { class: "bk-search-box" }, svg(BK_ICONS.find), search), el("nav", { class: "bk-nav", id: "bk-nav", "aria-label": "Books" })),
      el("main", { class: "bk-main", id: "bk-main", tabindex: "-1" })),
    el("div", { class: "bk-reader", id: "bk-reader", hidden: "" }));
  document.body.insertBefore(section, $("modal"));
  $("bk-shell").append(sideToggle(section, "books"));
  registerWindow("books", { title: "Books", close: closeBooks, hide: () => { bkSaveNow(); closeWindow("books"); }, dock: "books", size: [1240, 820] });
  registerNav("books", (dir) => { if (dir < 0 && bk.r) bkCloseBook(); });
  section.addEventListener("keydown", bkKeys);
  new ResizeObserver(() => { if (bk.r) bkResizeSoon(); }).observe(section);
  bkRenderSide();
}

async function bkLoad() {
  try {
    const got = await bkGet("list");
    bk.books = got.books || [];
    bk.dir = got.dir;
    bk.found = got.found;
    bk.loaded = true;
  } catch (e) {
    if (e.message !== "login") $("bk-main").replaceChildren(el("div", { class: "bk-empty" }, el("p", {}, e.message)));
    return;
  }
  bkRenderSide();
  bkRender();
  bkCoversSoon();
}

function bkRenderSide() {
  const nav = $("bk-nav");
  if (!nav) return;
  const item = (view, icon, label, n) => {
    const b = el("button", { type: "button", class: `bk-nav-item${bk.view === view ? " on" : ""}` }, svg(icon), el("span", { class: "bk-nav-name" }, label),
      ...(n != null ? [el("span", { class: "bk-nav-count" }, String(n))] : []));
    b.addEventListener("click", () => { bk.view = view; bkRenderSide(); bkRender(); });
    return b;
  };
  const n = (kind) => (bk.loaded ? bk.books.filter((b) => !kind || b.kind === kind).length : null);
  nav.replaceChildren(item("now", BK_ICONS.now, "Reading Now"), el("p", { class: "bk-side-title" }, "Library"),
    item("all", BK_ICONS.all, "All Books", n()), item("pdf", BK_ICONS.pdf, "PDFs", n("pdf")), item("epub", BK_ICONS.all, "EPUBs", n("epub")));
}

function bkRender() {
  const main = $("bk-main");
  if (!main || !bk.loaded) return;
  const page = el("div", { class: "bk-page" });
  main.replaceChildren(page);
  if (!bk.found) {
    page.append(el("div", { class: "bk-empty" }, el("h2", {}, "No Books folder"), el("p", {}, `Put your PDFs and EPUBs in ${bk.dir}.`)));
    return;
  }
  const words = bk.q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (b) => words.every((w) => `${b.title} ${b.author}`.toLowerCase().includes(w));
  const by = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const all = bk.books.filter(match).sort((a, b) => by.compare(a.title, b.title));
  if (bk.q) {
    page.append(el("h1", { class: "bk-h1" }, `“${bk.q}”`), all.length ? bkGrid(all) : el("p", { class: "bk-dim" }, "No book by that name."));
    return;
  }
  if (bk.view === "now") {
    const reading = bk.books.filter((b) => b.at && b.pct < 0.995).sort((a, b) => b.at - a.at);
    const done = bk.books.filter((b) => b.pct >= 0.995).sort((a, b) => b.at - a.at);
    page.append(el("h1", { class: "bk-h1" }, "Reading Now"));
    if (reading.length) page.append(el("div", { class: "bk-hero-row" }, ...reading.slice(0, 3).map(bkHero)));
    else page.append(el("p", { class: "bk-dim bk-lead" }, "Open a book and it waits here, where you left it."));
    if (reading.length > 3) page.append(el("h2", { class: "bk-h2" }, "Also Reading"), bkGrid(reading.slice(3)));
    const fresh = [...bk.books].sort((a, b) => b.added - a.added).slice(0, 12);
    page.append(el("h2", { class: "bk-h2" }, "Recently Added"), bkGrid(fresh));
    if (done.length) page.append(el("h2", { class: "bk-h2" }, "Finished"), bkGrid(done));
    return;
  }
  const list = bk.view === "all" ? all : all.filter((b) => b.kind === bk.view);
  page.append(el("h1", { class: "bk-h1" }, bk.view === "pdf" ? "PDFs" : bk.view === "epub" ? "EPUBs" : "All Books"),
    el("p", { class: "bk-dim bk-lead" }, `${list.length} book${list.length === 1 ? "" : "s"}`), bkGrid(list));
}

// A book's cover: its own (an EPUB's, a PDF's first page once drawn), else
// one drawn: its title on a cloth of its own color.
function bkCover(b) {
  let hash = 0;
  for (const ch of b.title) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  const box = el("span", { class: "bk-cover", "data-id": b.id },
    el("span", { class: "bk-cover-drawn" }, el("span", { class: "bk-cover-title" }, b.title), ...(b.author ? [el("span", { class: "bk-cover-by" }, b.author)] : [])));
  box.firstChild.style.cssText = `--h: ${Math.abs(hash) % 360}`;
  if (b.cover) bkCoverImg(box, b);
  return box;
}

function bkCoverImg(box, b) {
  const img = el("img", { src: `/api/books/cover?id=${bkEnc(b.id)}&v=${Math.round(b.size)}`, alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("load", () => box.classList.add("has-img"));
  img.addEventListener("error", () => img.remove());
  box.append(img);
}

function bkGrid(list) {
  return el("div", { class: "bk-grid" }, ...list.map((b) => {
    const t = el("button", { type: "button", class: "bk-tile" }, bkCover(b),
      el("span", { class: "bk-tile-title" }, b.title), el("span", { class: "bk-tile-sub" }, b.pct >= 0.995 ? "Finished" : b.pct > 0 ? `${Math.max(1, Math.round(b.pct * 100))}%` : b.author || b.kind.toUpperCase()));
    if (b.pct > 0 && b.pct < 0.995) t.querySelector(".bk-cover").append(el("span", { class: "bk-cover-bar" }, el("span", {})));
    t.querySelector(".bk-cover-bar > span")?.style.setProperty("width", `${Math.round(b.pct * 100)}%`);
    t.addEventListener("click", () => bkOpenBook(b.id));
    return t;
  }));
}

function bkHero(b) {
  const card = el("button", { type: "button", class: "bk-hero" }, bkCover(b),
    el("span", { class: "bk-hero-text" }, el("span", { class: "bk-tile-title" }, b.title), el("span", { class: "bk-tile-sub" }, b.author),
      el("span", { class: "bk-hero-pct" }, `${Math.max(1, Math.round(b.pct * 100))}%`), el("span", { class: "bk-cover-bar" }, el("span", {}))));
  card.querySelector(".bk-hero-text .bk-cover-bar > span").style.setProperty("width", `${Math.round(b.pct * 100)}%`);
  card.addEventListener("click", () => bkOpenBook(b.id));
  return card;
}

// PDFs without a cover yet: their first page, drawn here once and kept on
// the server (a few at a time, while the library's open).
function bkCoversSoon() {
  if (bk.covering) return;
  const todo = bk.books.filter((b) => b.kind === "pdf" && !b.cover && !b.coverFailed);
  if (!todo.length) return;
  bk.covering = true;
  (async () => {
    for (const b of todo) {
      if (!isOpen("books") || bk.r) break;
      try {
        const jpeg = await bkDrawCover(b);
        if (jpeg && await bkPost("cover", { id: b.id, jpeg })) {
          b.cover = true;
          for (const box of document.querySelectorAll(`#bk-main .bk-cover[data-id="${CSS.escape(b.id)}"]`)) bkCoverImg(box, b);
        } else b.coverFailed = true;
      } catch { b.coverFailed = true; }
    }
    bk.covering = false;
  })();
}

async function bkPdfOpen(url) {
  const { lib, worker } = await mdPdfJs();
  return lib.getDocument({ url, worker, wasmUrl: "/static/vendor/", standardFontDataUrl: "/static/vendor/", useSystemFonts: false,
    disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 }).promise;
}

async function bkDrawCover(b) {
  const doc = await bkPdfOpen(`/api/books/file?id=${bkEnc(b.id)}`);
  try {
    const page = await doc.getPage(1);
    const one = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 400 / one.width });
    const canvas = el("canvas", { width: String(Math.floor(viewport.width)), height: String(Math.floor(viewport.height)) });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const data = canvas.toDataURL("image/jpeg", 0.8);
    return data.slice(data.indexOf(",") + 1);
  } finally {
    doc.loadingTask?.destroy();
  }
}

// ------------------------------------------------------------ the reader

// A book open: its pages ("book": a PDF's own, else the words laid out on
// paper; "text": the words, white on black). r.at: the first page of the
// spread shown, in r's pages.
async function bkOpenBook(id) {
  const b = bkById(id);
  if (!b) return;
  bkSaveNow();
  const reader = $("bk-reader");
  $("bk-shell").hidden = true;
  reader.hidden = false;
  reader.replaceChildren(el("div", { class: "bk-loading" }, el("p", {}, `Opening ${b.title}…`)));
  let info;
  try { info = await bkGet(`info?id=${bkEnc(id)}`); } catch (e) { if (e.message !== "login") bkCloseBook(e.message); return; }
  const r = { b, info, kind: info.kind, view: bk.prefs.view[id] || info.view || (phoneLayout() ? "text" : "book"), at: 0, total: 0, spread: 1,
    flow: null, doc: null, canvases: new Map(), turning: null, gen: 0 };
  bk.r = r;
  bkReaderBuild(r);
  if (r.kind === "pdf") {
    try {
      r.doc = await bkPdfOpen(`/api/books/file?id=${bkEnc(id)}`);
    } catch {
      return bkCloseBook("This PDF can't be opened (is it damaged?).");
    }
    r.pages = r.doc.numPages;
    const one = (await r.doc.getPage(1)).getViewport({ scale: 1 });
    r.ratio = one.width / one.height;
    r.outline = null;
  }
  if (r.kind === "pdf" && r.view === "text" && !(await bkPdfText(r))) r.view = "book";
  await bkLayout(r, info.pos || null);
}

function bkCloseBook(why) {
  const r = bk.r;
  if (r) {
    bkSaveNow();
    r.gen++;
    r.doc?.loadingTask?.destroy();
  }
  bk.r = null;
  $("bk-reader").hidden = true;
  $("bk-reader").replaceChildren();
  $("bk-shell").hidden = false;
  if (why) toast(why);
  bkLoad();
}

function bkReaderBuild(r) {
  const reader = $("bk-reader");
  const back = el("button", { type: "button", class: "bk-tool bk-tool-back", "aria-label": "Library" }, svg(BK_ICONS.back), el("span", {}, "Library"));
  back.addEventListener("click", () => bkCloseBook());
  const toc = el("button", { type: "button", class: "bk-tool", "aria-label": "Contents", title: "Contents" }, svg(BK_ICONS.toc));
  toc.addEventListener("click", () => bkContents());
  const views = el("div", { class: "bk-views", role: "group", "aria-label": "How to show it" },
    ...[["book", "Book"], ["text", "Text"]].map(([v, label]) => {
      const b = el("button", { type: "button", class: "bk-view", "data-view": v }, label);
      b.addEventListener("click", () => bkSetView(v));
      return b;
    }));
  const smaller = el("button", { type: "button", class: "bk-tool bk-font", "aria-label": "Smaller text", title: "Smaller text" }, "A");
  const bigger = el("button", { type: "button", class: "bk-tool bk-font big", "aria-label": "Bigger text", title: "Bigger text" }, "A");
  smaller.addEventListener("click", () => bkFont(-1));
  bigger.addEventListener("click", () => bkFont(1));
  const slider = el("input", { class: "bk-slider", id: "bk-slider", type: "range", min: "0", max: "1", step: "1", value: "0", "aria-label": "Page" });
  slider.addEventListener("input", () => { $("bk-count").textContent = bkCountText(r, Number(slider.value)); });
  slider.addEventListener("change", () => bkGo(Number(slider.value), { flip: false }));
  const prev = el("button", { type: "button", class: "bk-arrow prev", "aria-label": "Previous page" }, svg(BK_ICONS.prev));
  const next = el("button", { type: "button", class: "bk-arrow next", "aria-label": "Next page" }, svg(BK_ICONS.next));
  prev.addEventListener("click", () => bkTurn(-1));
  next.addEventListener("click", () => bkTurn(1));
  const stage = el("div", { class: "bk-stage", id: "bk-stage", tabindex: "-1" }, el("div", { class: "bk-spread", id: "bk-spread" }));
  reader.replaceChildren(
    el("header", { class: "bk-top" }, back, el("div", { class: "bk-top-title" }, el("span", {}, r.b.title), el("span", { class: "bk-dim" }, r.b.author || "")),
      el("div", { class: "bk-top-tools" }, smaller, bigger, views, toc)),
    el("div", { class: "bk-body" }, prev, stage, next),
    el("footer", { class: "bk-foot" }, slider, el("span", { class: "bk-count", id: "bk-count" }, "")),
    el("aside", { class: "bk-toc", id: "bk-toc", hidden: "" }),
    el("div", { class: "bk-measure", id: "bk-measure", "aria-hidden": "true" }));
  bkPointer(stage);
}

function bkSetView(v) {
  const r = bk.r;
  if (!r || r.view === v || r.turning) return;
  (async () => {
    const pos = await bkPosExact(r);
    if (v === "text" && r.kind === "pdf" && !(await bkPdfText(r))) return;
    r.view = v;
    bk.prefs.view[r.b.id] = v;
    bkSavePrefs();
    await bkLayout(r, pos);
    bkSaveSoon();
  })();
}

function bkFont(step) {
  const r = bk.r;
  if (!r || r.turning || (r.view === "book" && r.kind === "pdf")) return;
  const size = Math.max(13, Math.min(34, bk.prefs.font + step * 2));
  if (size === bk.prefs.font) return;
  bkPosExact(r).then((pos) => {
    bk.prefs.font = size;
    bkSavePrefs();
    bkLayout(r, pos);
  });
}

let bkResizeTimer = null;
function bkResizeSoon() {
  clearTimeout(bkResizeTimer);
  bkResizeTimer = setTimeout(() => {
    const r = bk.r;
    if (!r || r.turning || !r.box) return;
    const stage = $("bk-stage");
    if (Math.abs(stage.clientWidth - r.box.sw) < 4 && Math.abs(stage.clientHeight - r.box.sh) < 4) return;
    bkPosExact(r).then((pos) => bkLayout(r, pos));
  }, 180);
}

// The pages' size for this window: a spread of two where there's room for
// two (wide, and not a phone), else one.
function bkMeasureBox(r) {
  const stage = $("bk-stage");
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const paper = r.view === "book";
  const ratio = r.kind === "pdf" && paper ? r.ratio : paper ? 0.68 : null;
  let spread = sw > 760 && sw / sh > 1.05 && !phoneLayout() ? 2 : 1;
  let w, h;
  if (ratio) {
    h = sh;
    w = h * ratio;
    if (w * spread > sw) { w = sw / spread; h = w / ratio; }
  } else {
    w = spread === 2 ? sw / 2 : sw;
    h = sh;
    w = Math.min(w, spread === 2 ? 620 : 760); // lines not too long to read
  }
  return { sw, sh, w: Math.floor(w), h: Math.floor(h), spread };
}

// (Re)lays the book out for its view and the window, at pos.
async function bkLayout(r, pos) {
  const gen = ++r.gen;
  r.exact = false;
  $("books").classList.toggle("bk-dark", r.view === "text");
  for (const b of document.querySelectorAll("#bk-reader .bk-view")) b.classList.toggle("on", b.dataset.view === r.view);
  for (const b of document.querySelectorAll("#bk-reader .bk-font")) b.disabled = r.view === "book" && r.kind === "pdf";
  r.box = bkMeasureBox(r);
  r.spread = r.box.spread;
  const spread = $("bk-spread");
  spread.style.width = `${r.box.w * r.spread}px`;
  spread.style.height = `${r.box.h}px`;
  spread.className = `bk-spread ${r.view === "book" ? "paper" : "dark"} n${r.spread}`;
  if (r.view === "book" && r.kind === "pdf") {
    r.total = r.pages;
    r.flow = null;
    bkShow(r, bkStart(r, Math.max(0, Math.min(r.pages - 1, (pos?.page || 1) - 1))));
    return;
  }
  spread.replaceChildren(el("div", { class: "bk-loading" }, el("p", {}, "Laying out the pages…")));
  if (!r.sections) await bkSections(r);
  if (gen !== r.gen) return;
  await bkFlow(r, pos, gen);
}

// The first page of the spread that page i is in.
function bkStart(r, i) { return r.spread === 2 ? i - (i % 2) : i; }

// ------------------------------------------------- the words, laid out

// An EPUB's chapters; a PDF's pages' words, a few pages a section (with
// where each page starts, to go between the two views).
async function bkSections(r) {
  if (r.kind === "epub") {
    r.sections = r.info.sections.map((chars, i) => ({ i, chars, html: null, href: r.info.hrefs[i] }));
    return;
  }
  const pages = r.textPages;
  const sections = [];
  let cur = null;
  pages.forEach((text, p) => {
    if (!cur || (cur.pages.length >= 8 && /[.!?:"”)]\s*$/.test(cur.text))) {
      cur = { i: sections.length, pages: [], text: "", html: null };
      sections.push(cur);
    }
    cur.pages.push({ page: p + 1, off: cur.text.length });
    const t = text.trim();
    if (!t) return;
    // A paragraph going on over the page: joined.
    const joins = cur.text && !/[.!?:;"”)\]]\s*$/.test(cur.text) && /^[a-z(,;]/.test(t);
    cur.text += cur.text ? (joins ? " " : "\n\n") + t : t;
  });
  for (const s of sections) {
    s.chars = s.text.length;
    s.html = s.text.split(/\n\n+/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("");
  }
  r.sections = sections;
}

async function bkSectionHtml(r, k) {
  const s = r.sections[k];
  if (s.html == null) {
    try { s.html = (await bkGet(`section?id=${bkEnc(r.b.id)}&n=${k}`)).html; } catch { s.html = "<p>This chapter didn't open.</p>"; }
  }
  return s.html;
}

// The measuring box: one section laid out in columns a page wide.
function bkFlowEl(r) {
  const f = el("div", { class: "bk-flow" });
  const { iw, ih, gap } = r.inner;
  f.style.cssText = `width: ${iw}px; height: ${ih}px; column-width: ${iw}px; column-gap: ${gap}px; font-size: ${bk.prefs.font}px`;
  return f;
}

async function bkPlace(r, k) {
  const m = $("bk-measure");
  if (m.dataset.k === String(k) && m.dataset.gen === String(r.gen)) return m.firstChild;
  const f = bkFlowEl(r);
  f.innerHTML = await bkSectionHtml(r, k);
  for (const img of f.querySelectorAll("img")) {
    img.style.maxHeight = `${r.inner.ih - 10}px`;
    if (!img.complete) await new Promise((go) => { img.onload = img.onerror = go; setTimeout(go, 3000); });
  }
  m.replaceChildren(f);
  m.dataset.k = String(k);
  m.dataset.gen = String(r.gen);
  return f;
}

function bkColumns(r, f) { return Math.max(1, Math.round((f.scrollWidth + r.inner.gap) / (r.inner.iw + r.inner.gap))); }

async function bkFlow(r, pos, gen) {
  const paper = r.view === "book";
  const { w, h } = r.box;
  const padX = paper ? Math.round(w * 0.1) : Math.max(22, Math.round(w * 0.08));
  const padY = paper ? Math.round(h * 0.08) : Math.max(28, Math.round(h * 0.06));
  r.inner = { iw: w - padX * 2, ih: h - padY * 2 - (paper ? 0 : 0), gap: padX * 2, padX, padY };
  $("bk-measure").dataset.k = "";
  const counts = new Array(r.sections.length).fill(null);
  r.counts = counts;
  // Where to start: its section first, so it shows straight away.
  const at = bkPosSection(r, pos);
  const order = [at.k, ...r.sections.map((_, i) => i).filter((i) => i !== at.k)];
  let shown = false;
  for (const k of order) {
    if (gen !== r.gen) return;
    const f = await bkPlace(r, k);
    if (gen !== r.gen) return;
    counts[k] = bkColumns(r, f);
    if (!shown) {
      const col = await bkColumnOf(r, k, at);
      bkRecount(r);
      shown = true;
      bkShow(r, bkStart(r, r.starts[k] + col));
    } else if (k % 6 === 0) {
      bkRecount(r);
      bkFootUpdate(r);
      await new Promise((go) => setTimeout(go, 0));
    }
  }
  if (gen !== r.gen) return;
  // Every section's count known: where the page shown is, in them.
  const keep = bkPosNow(r);
  bkRecount(r);
  r.exact = true;
  const k2 = bkPosSection(r, keep);
  bkShow(r, bkStart(r, r.starts[k2.k] + (await bkColumnOf(r, k2.k, k2))));
}

// Sections not laid out yet count as their share of the words.
function bkRecount(r) {
  const known = r.counts.map((c, k) => (c ? [c, r.sections[k].chars] : null)).filter(Boolean);
  const per = known.reduce((a, [c, ch]) => a + ch, 0) / Math.max(1, known.reduce((a, [c]) => a + c, 0)) || 1500;
  r.starts = [];
  let n = 0;
  r.counts.forEach((c, k) => { r.starts.push(n); n += c || Math.max(1, Math.round(r.sections[k].chars / per)); });
  r.total = n;
}

// pos → {k: section, off: its nth character, anchor?}
function bkPosSection(r, pos) {
  if (!pos) return { k: 0, off: 0 };
  if (r.kind === "pdf") {
    const page = pos.page || 1;
    for (let k = r.sections.length - 1; k >= 0; k--) {
      const hit = r.sections[k].pages.find((p) => p.page === page);
      if (hit) return { k, off: hit.off + (pos.within ? Math.round(pos.within) : 0) };
      if (r.sections[k].pages[0].page < page) return { k, off: r.sections[k].chars };
    }
    return { k: 0, off: 0 };
  }
  const k = Math.max(0, Math.min(r.sections.length - 1, pos.sec || 0));
  return { k, off: pos.off || 0, anchor: pos.anchor };
}

// The text nodes of a laid-out section, with where each starts.
function bkTextNodes(f) {
  const nodes = [];
  let n = 0;
  const walk = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    nodes.push({ t, at: n });
    n += t.length;
  }
  return { nodes, total: n };
}

function bkColOfRect(r, f, rect) {
  const left = f.getBoundingClientRect().left;
  return Math.max(0, Math.floor((rect.left - left + 1) / (r.inner.iw + r.inner.gap)));
}

// The column (page in its section) its nth character is on.
async function bkColumnOf(r, k, at) {
  const f = await bkPlace(r, k);
  if (at.anchor) {
    const a = f.querySelector(`[data-anchor="${CSS.escape(at.anchor)}"]`);
    if (a) {
      const rect = a.getClientRects()[0] || a.getBoundingClientRect();
      return Math.min(r.counts[k] - 1, bkColOfRect(r, f, rect));
    }
  }
  const { nodes, total } = bkTextNodes(f);
  if (!nodes.length || !at.off) return 0;
  const off = Math.min(at.off, total - 1);
  let i = nodes.length - 1;
  while (i > 0 && nodes[i].at > off) i--;
  const range = document.createRange();
  const o = Math.min(off - nodes[i].at, nodes[i].t.length - 1);
  range.setStart(nodes[i].t, Math.max(0, o));
  range.setEnd(nodes[i].t, Math.max(0, o) + 1);
  const rect = range.getClientRects()[0];
  return rect ? Math.min((r.counts[k] || 1) - 1, bkColOfRect(r, f, rect)) : 0;
}

// The first character on column c of section k.
async function bkOffsetOf(r, k, c) {
  if (!c) return 0;
  const f = await bkPlace(r, k);
  const { nodes, total } = bkTextNodes(f);
  const range = document.createRange();
  const colAt = (off) => {
    let i = nodes.length - 1;
    while (i > 0 && nodes[i].at > off) i--;
    const o = off - nodes[i].at;
    range.setStart(nodes[i].t, o);
    range.setEnd(nodes[i].t, Math.min(o + 1, nodes[i].t.length));
    const rect = range.getClientRects()[0];
    return rect ? bkColOfRect(r, f, rect) : -1;
  };
  let lo = 0, hi = total;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c2 = colAt(mid);
    if (c2 >= c) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// Page i → its section and column.
function bkWhere(r, i) {
  let k = r.starts.length - 1;
  while (k > 0 && r.starts[k] > i) k--;
  return { k, c: i - r.starts[k] };
}

// Where you are, to the character: the first one on the page shown.
async function bkPosExact(r) {
  // (Only once it's all laid out: the measuring box is busy till then.)
  if (r.exact && r.starts && r.sections && !(r.kind === "pdf" && r.view === "book")) {
    const { k, c } = bkWhere(r, r.at);
    r.offAt = await bkOffsetOf(r, k, c);
    r.offAtPage = r.at;
  }
  return bkPosNow(r);
}

// Where you are, as kept: a PDF's page (and how far into its words), an
// EPUB's chapter and character.
function bkPosNow(r) {
  if (!r) return null;
  if (r.kind === "pdf" && (r.view === "book" || !r.sections)) return { page: (r.at || 0) + 1 };
  if (!r.starts) return r.lastPos || null;
  const { k, c } = bkWhere(r, r.at);
  const off = r.offAt != null && r.offAtPage === r.at ? r.offAt : Math.round(((r.sections[k].chars || 0) * c) / Math.max(1, r.counts[k] || 1));
  if (r.kind === "pdf") {
    const pages = r.sections[k].pages;
    let p = pages[0];
    for (const x of pages) if (x.off <= off) p = x;
    return { page: p.page, within: off - p.off };
  }
  return { sec: k, off };
}

// ------------------------------------------------------- showing pages

function bkFace(r, i) {
  const face = el("div", { class: "bk-face", "data-page": String(i) });
  face.style.width = `${r.box.w}px`;
  face.style.height = `${r.box.h}px`;
  if (i < 0 || i >= r.total) { face.classList.add("blank"); return face; }
  if (r.view === "book" && r.kind === "pdf") {
    bkPdfFace(r, i, face);
  } else {
    const { k, c } = bkWhere(r, i);
    const text = el("div", { class: "bk-text" });
    text.style.cssText = `left: ${r.inner.padX}px; top: ${r.inner.padY}px; width: ${r.inner.iw}px; height: ${r.inner.ih}px`;
    const f = bkFlowEl(r);
    f.style.transform = `translateX(${-c * (r.inner.iw + r.inner.gap)}px)`;
    const s = r.sections[k];
    if (s.html != null) f.innerHTML = s.html;
    else bkSectionHtml(r, k).then((h) => { f.innerHTML = h; });
    for (const img of f.querySelectorAll("img")) img.style.maxHeight = `${r.inner.ih - 10}px`;
    text.append(f);
    face.append(text);
    if (r.view === "book") face.append(el("span", { class: "bk-folio" }, String(i + 1)));
  }
  return face;
}

// A PDF's page: drawn once at this size, then copied wherever it's shown.
function bkPdfFace(r, i, face) {
  const got = r.canvases.get(i);
  const put = (src) => {
    const c = el("canvas", { width: String(src.width), height: String(src.height) });
    c.getContext("2d").drawImage(src, 0, 0);
    face.replaceChildren(c);
  };
  if (got && got.w === r.box.w) return put(got.canvas);
  face.classList.add("drawing");
  bkPdfDraw(r, i).then((g) => { if (g) { face.classList.remove("drawing"); put(g.canvas); } });
}

const bkDrawing = new Map();
async function bkPdfDraw(r, i) {
  const key = `${r.gen}:${i}:${r.box.w}`;
  if (bkDrawing.has(key)) return bkDrawing.get(key);
  const job = (async () => {
    try {
      const page = await r.doc.getPage(i + 1);
      const one = page.getViewport({ scale: 1 });
      const fit = Math.min(r.box.w / one.width, r.box.h / one.height);
      const viewport = page.getViewport({ scale: fit * Math.min(devicePixelRatio || 1, 2) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const g = { canvas, w: r.box.w };
      r.canvases.set(i, g);
      // Keep the ones near: a phone hasn't room for every page.
      if (r.canvases.size > 14) {
        for (const n of [...r.canvases.keys()].sort((a, b) => Math.abs(b - r.at) - Math.abs(a - r.at)).slice(0, r.canvases.size - 14)) r.canvases.delete(n);
      }
      return g;
    } catch {
      return null;
    } finally {
      bkDrawing.delete(key);
    }
  })();
  bkDrawing.set(key, job);
  return job;
}

// The spread at page i, still.
function bkShow(r, i) {
  r.at = Math.max(0, Math.min(i, Math.max(0, r.total - 1)));
  r.at = bkStart(r, r.at);
  const spread = $("bk-spread");
  const faces = [];
  for (let n = 0; n < r.spread; n++) {
    const f = bkFace(r, r.at + n);
    f.classList.add("still", r.spread === 2 ? (n === 0 ? "left" : "right") : "single");
    f.style.left = `${n * r.box.w}px`;
    faces.push(f);
  }
  spread.replaceChildren(...faces);
  bkFootUpdate(r);
  bkSaveSoon();
  // The next spreads (and the one before) drawn meanwhile.
  if (r.view === "book" && r.kind === "pdf") {
    const near = [r.at + r.spread, r.at + r.spread + 1, r.at + 2 * r.spread, r.at - 1, r.at - r.spread];
    setTimeout(() => { for (const n of near) if (n >= 0 && n < r.total && !r.canvases.has(n)) bkPdfDraw(r, n); }, 60);
  }
}

function bkCountText(r, i) {
  const last = Math.min(r.total, i + r.spread);
  const pages = r.spread === 2 && last > i + 1 ? `${i + 1}–${last}` : `${i + 1}`;
  return `${pages} of ${r.exact || r.view === "book" && r.kind === "pdf" ? "" : "~"}${r.total}`;
}

function bkFootUpdate(r) {
  const slider = $("bk-slider");
  if (!slider) return;
  slider.max = String(Math.max(0, r.total - 1));
  slider.value = String(r.at);
  slider.style.setProperty("--done", `${(r.at / Math.max(1, r.total - 1)) * 100}%`);
  $("bk-count").textContent = bkCountText(r, r.at);
  $("bk-reader").querySelector(".bk-arrow.prev").disabled = r.at <= 0;
  $("bk-reader").querySelector(".bk-arrow.next").disabled = r.at + r.spread >= r.total;
}

// To page i: the pages between turned over (one fold drawn), or straight there.
function bkGo(i, { flip = true } = {}) {
  const r = bk.r;
  if (!r || r.turning) return;
  const target = bkStart(r, Math.max(0, Math.min(r.total - 1, i)));
  if (target === r.at) return bkShow(r, target);
  r.offAt = null;
  if (!flip) return bkShow(r, target);
  bkTurn(target > r.at ? 1 : -1, { to: target });
}

// ------------------------------------------------------- turning a page

function bkTurn(dir, { to = null } = {}) {
  const r = bk.r;
  if (!r || r.turning) return;
  const target = to ?? r.at + dir * r.spread;
  if (target < 0 || target >= r.total) return;
  r.offAt = null;
  if (r.view === "book") bkCurlAuto(r, dir, target);
  else bkSlideAuto(r, dir, target);
}

// The fold. In a turning page's own terms: x from the spine (0) to its
// outer edge (w), y down; c: the corner held; p: where it is now. The fold
// is the line halfway between them, square to them; the part past it is
// the leaf, turned over and lying on the rest.
function bkFold(w, h, c, p) {
  // The page is held at the spine: the corner can't go further from the
  // spine's end on its edge than the page is wide.
  const pin = { x: 0, y: c.y };
  const far = { x: 0, y: h - c.y };
  let q = { ...p };
  const d1 = Math.hypot(q.x - pin.x, q.y - pin.y);
  if (d1 > w) q = { x: pin.x + ((q.x - pin.x) * w) / d1, y: pin.y + ((q.y - pin.y) * w) / d1 };
  const diag = Math.hypot(w, h);
  const d2 = Math.hypot(q.x - far.x, q.y - far.y);
  if (d2 > diag) q = { x: far.x + ((q.x - far.x) * diag) / d2, y: far.y + ((q.y - far.y) * diag) / d2 };
  const dx = c.x - q.x, dy = c.y - q.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return null;
  const n = { x: dx / len, y: dy / len };
  const m = { x: (c.x + q.x) / 2, y: (c.y + q.y) / 2 };
  const side = (x, y) => (x - m.x) * n.x + (y - m.y) * n.y;
  const rect = [[0, 0], [w, 0], [w, h], [0, h]];
  const clip = (keep) => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = rect[i], b = rect[(i + 1) % 4];
      const sa = side(...a), sb = side(...b);
      const ina = keep(sa), inb = keep(sb);
      if (ina) out.push(a);
      if (ina !== inb) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  };
  const reflect = (x, y) => { const s = side(x, y); return [x - 2 * s * n.x, y - 2 * s * n.y]; };
  return { n, m, front: clip((s) => s <= 0), leaf: clip((s) => s > 0), reflect, q };
}

const bkPoly = (pts) => (pts.length < 3 ? "polygon(0 0, 0 0, 0 0)" : `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`);

// A shadow along the fold: a band from the fold's line (through f, in the
// element's terms) out along dir, fading over len.
function bkShade(cls, f, dir, len, alpha) {
  const band = el("div", { class: `bk-shade ${cls}` });
  const angle = Math.atan2(dir.y, dir.x);
  band.style.cssText = `width: ${len}px; height: 6000px; left: ${f.x}px; top: ${f.y - 3000}px; transform-origin: 0 50%; transform: rotate(${angle}rad);`
    + `background: linear-gradient(to right, rgb(0 0 0 / ${alpha}), rgb(0 0 0 / 0))`;
  return band;
}

// A turn under way: the page turning (its front, the leaf: its back), what's
// under it, and the page staying.
function bkCurlStart(r, dir) {
  const { w, h } = r.box;
  const two = r.spread === 2;
  // One page at a time, back: the page before comes back over from the left
  // (a forward turn, undone).
  const undo = !two && dir < 0;
  const side = two && dir < 0 ? "left" : "right";
  const spine = two ? w : 0;
  const t = {
    dir, undo, side, spine, w, h,
    front: bkFace(r, undo ? r.at - 1 : two ? (dir > 0 ? r.at + 1 : r.at) : r.at),
    back: two ? bkFace(r, dir > 0 ? r.at + 2 : r.at - 1) : el("div", { class: "bk-face leafback" }),
    under: bkFace(r, undo ? r.at : two ? (dir > 0 ? r.at + 3 : r.at - 2) : r.at + 1),
    stay: two ? bkFace(r, dir > 0 ? r.at : r.at + 1) : null,
  };
  t.back.style.width = `${w}px`;
  t.back.style.height = `${h}px`;
  const slot = (face, n) => { face.style.left = `${n * w}px`; return face; };
  const at = two ? (side === "left" ? 0 : 1) : 0;
  t.front.classList.add("turning-front", two ? side : "single");
  t.under.classList.add(two ? side : "single", "under");
  t.back.classList.add("turning-back", two ? (side === "left" ? "right" : "left") : "single");
  t.shadeUnder = el("div", { class: "bk-shade-box" });
  t.shadeFront = el("div", { class: "bk-shade-box" });
  t.shadeBack = el("div", { class: "bk-shade-box" });
  t.under.append(t.shadeUnder);
  t.front.append(t.shadeFront);
  t.back.append(t.shadeBack);
  const parts = [slot(t.under, at), slot(t.front, at), t.back];
  if (t.stay) parts.unshift(slot(t.stay, side === "left" ? 1 : 0));
  t.stay?.classList.add("still", side === "left" ? "right" : "left");
  $("bk-spread").replaceChildren(...parts);
  t.back.style.left = "0px";
  t.back.style.transformOrigin = "0 0";
  r.turning = t;
  return t;
}

// Draws the turn with the corner c held at p (both in the page's own terms).
function bkCurlDraw(t, c, p) {
  const { w, h, side, spine } = t;
  const fold = bkFold(w, h, c, p);
  const toEl = side === "right" ? (x) => x : (x) => w - x; // a page's terms → its element's
  if (!fold) {
    t.front.style.clipPath = "";
    t.back.style.visibility = "hidden";
    t.shadeUnder.replaceChildren();
    t.shadeFront.replaceChildren();
    return;
  }
  t.front.style.clipPath = bkPoly(fold.front.map(([x, y]) => [toEl(x), y]));
  if (!fold.leaf.length) { t.back.style.visibility = "hidden"; return; }
  t.back.style.visibility = "";
  // The leaf's back: a point (u, v) of it is the page's (w - u, v) (right)
  // or (u, v) (left), turned over the fold, then put in the spread.
  const sheet = side === "right" ? (u, v) => [w - u, v] : (u, v) => [u, v];
  const toSpread = side === "right" ? ([x, y]) => [spine + x, y] : ([x, y]) => [spine - x, y];
  const map = (u, v) => toSpread(fold.reflect(...sheet(u, v)));
  const o = map(0, 0), a = map(1, 0), b = map(0, 1);
  t.back.style.transform = `matrix(${a[0] - o[0]}, ${a[1] - o[1]}, ${b[0] - o[0]}, ${b[1] - o[1]}, ${o[0]}, ${o[1]})`;
  const fromSheet = side === "right" ? ([x, y]) => [w - x, y] : ([x, y]) => [x, y];
  t.back.style.clipPath = bkPoly(fold.leaf.map(fromSheet));
  // Shadows: on the leaf at the fold, on the page under it, on the front.
  const lenF = Math.hypot(c.x - fold.q.x, c.y - fold.q.y);
  const shade = Math.min(1, lenF / w);
  const fEl = { x: toEl(fold.m.x), y: fold.m.y };
  const nEl = side === "right" ? fold.n : { x: -fold.n.x, y: fold.n.y };
  t.shadeUnder.style.clipPath = bkPoly(fold.leaf.map(([x, y]) => [toEl(x), y]));
  t.shadeUnder.replaceChildren(bkShade("under", fEl, nEl, Math.max(30, w * 0.35 * (1 - shade * 0.4)), 0.38 * (1 - shade * 0.5)));
  t.shadeFront.replaceChildren(bkShade("front", fEl, { x: -nEl.x, y: -nEl.y }, Math.max(20, w * 0.12), 0.14));
  const bm = fromSheet([fold.m.x, fold.m.y]);
  const bn = side === "right" ? { x: -fold.n.x, y: fold.n.y } : fold.n;
  t.shadeBack.replaceChildren(bkShade("back", { x: bm[0], y: bm[1] }, bn, Math.max(30, w * 0.3), 0.22));
}

// Animates the held corner from p to the end (turned over, or back flat).
function bkCurlAnimate(t, c, from, to, ms, done) {
  const start = performance.now();
  const lift = Math.min(t.h * 0.12, 80) * (c.y > t.h / 2 ? 1 : -1);
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    const p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * e) * lift * (Math.abs(to.x - from.x) > t.w ? 1 : 0.3) };
    bkCurlDraw(t, c, p);
    if (k < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
}

function bkCurlAuto(r, dir, target) {
  const t = bkCurlStart(r, dir);
  const c = { x: t.w, y: t.h };
  const flat = { x: t.w, y: t.h };
  const over = { x: -t.w, y: t.h };
  // A jump of several pages: the next spread's faces are the target's.
  if (target !== r.at + dir * r.spread) bkCurlRetarget(r, t, target);
  if (t.undo) {
    bkCurlDraw(t, c, over);
    bkCurlAnimate(t, c, over, flat, 620, () => bkCurlEnd(r, target));
  } else {
    bkCurlAnimate(t, c, { x: t.w - 1, y: t.h - 1 }, over, 620, () => bkCurlEnd(r, target));
  }
}

// Turning straight to a page far off: what's on the leaf's back and under
// it are that spread's.
function bkCurlRetarget(r, t, target) {
  const two = r.spread === 2;
  const swap = (old, i) => {
    const f = bkFace(r, i);
    f.className = old.className;
    f.style.cssText = old.style.cssText;
    const shade = old.querySelector(".bk-shade-box");
    if (shade) f.append(shade);
    old.replaceWith(f);
    return f;
  };
  if (two) {
    t.back = swap(t.back, t.dir > 0 ? target : target + 1);
    t.under = swap(t.under, t.dir > 0 ? target + 1 : target);
  } else if (!t.undo) {
    t.under = swap(t.under, target);
  } else {
    t.front = swap(t.front, target);
  }
}

function bkCurlEnd(r, target) {
  r.turning = null;
  if (target != null) r.at = target;
  bkShow(r, r.at);
}

// ------------------------------------------- the Text: sliding pages

function bkSlideAuto(r, dir, target) {
  const spread = $("bk-spread");
  const W = r.box.w * r.spread;
  const cur = [...spread.children];
  const next = [];
  for (let n = 0; n < r.spread; n++) {
    const f = bkFace(r, target + n);
    f.classList.add("still");
    f.style.left = `${n * r.box.w + dir * W}px`;
    next.push(f);
  }
  spread.append(...next);
  r.turning = { slide: true };
  const all = [...cur, ...next];
  for (const f of all) { f.style.transition = "transform 0.32s cubic-bezier(.2,.8,.2,1)"; }
  requestAnimationFrame(() => { for (const f of all) f.style.transform = `translateX(${-dir * W}px)`; });
  setTimeout(() => { r.turning = null; bkShow(r, target); }, 340);
}

// ---------------------------------------------- the hand: drag and tap

function bkPointer(stage) {
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    const r = bk.r;
    if (!r || r.turning || e.button !== 0 || !r.total) return;
    if (e.target.closest("a[data-go], a[data-web]")) return;
    const box = $("bk-spread").getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const W = r.box.w * r.spread;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: x, by: y, moved: false, box, dir: 0, t: null, c: null, at: performance.now() };
    // Where it was taken hold of: the outer part of a page turns it.
    const edge = r.box.w * (r.view === "book" ? 0.42 : 0.5);
    drag.zone = x > W - edge ? 1 : x < edge ? -1 : 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    const r = bk.r;
    if (!drag || e.pointerId !== drag.id || !r) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      // Which way: the side it was held by, else the way it's pulled.
      let dir = drag.zone || (dx < 0 ? 1 : -1);
      if (r.view === "text") dir = dx < 0 ? 1 : -1;
      const target = r.at + dir * r.spread;
      if (target < 0 || target >= r.total) { drag.dead = true; return; }
      drag.dir = dir;
      if (r.view === "book") {
        drag.t = bkCurlStart(r, dir);
        const t = drag.t;
        const local = bkLocal(t, drag.bx, drag.by);
        // Held by the nearer corner, top or bottom.
        drag.c = { x: t.w, y: drag.by < t.h / 2 ? 0 : t.h };
        drag.off = t.undo ? { x: -t.w - local.x, y: drag.c.y - local.y } : { x: drag.c.x - local.x, y: drag.c.y - local.y };
        drag.p = t.undo ? { x: -t.w, y: drag.c.y } : { ...drag.c };
        bkCurlDraw(t, drag.c, drag.p);
      } else {
        drag.slide = bkSlideStart(r, dir);
      }
    }
    if (drag.dead) return;
    const x = e.clientX - drag.box.left;
    const y = e.clientY - drag.box.top;
    if (drag.t) {
      const l = bkLocal(drag.t, x, y);
      drag.p = { x: l.x + drag.off.x, y: l.y + drag.off.y };
      bkCurlDraw(drag.t, drag.c, drag.p);
    } else if (drag.slide) {
      bkSlideMove(drag.slide, dx);
    }
  });
  const up = (e) => {
    const r = bk.r;
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!r) return;
    if (!d.moved) {
      // A tap: at the sides, a page on (or back); in the middle, nothing.
      if (d.zone) bkTurn(d.zone);
      return;
    }
    if (d.dead) return;
    const fast = (performance.now() - d.at) < 300;
    if (d.t) {
      const t = d.t;
      const p = d.p || d.c;
      // Over the middle of the spine's side (or flicked that way): it goes.
      const go = t.undo ? p.x > -t.w * 0.5 || (fast && e.clientX - d.x0 > 30) : p.x < t.w * 0.49 || (fast && d.x0 - e.clientX > 30);
      const flat = { x: t.w, y: d.c.y };
      const over = { x: -t.w, y: d.c.y };
      const target = r.at + d.dir * r.spread;
      if (t.undo) bkCurlAnimate(t, d.c, p, go ? flat : over, 380, () => bkCurlEnd(r, go ? target : null));
      else bkCurlAnimate(t, d.c, p, go ? over : flat, 380, () => bkCurlEnd(r, go ? target : null));
    } else if (d.slide) {
      const dx = e.clientX - d.x0;
      const W = r.box.w * r.spread;
      const go = Math.abs(dx) > W * 0.25 || (fast && Math.abs(dx) > 30);
      bkSlideEnd(r, d.slide, go && Math.sign(-dx) === d.dir);
    }
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  // Links in an EPUB: within the book, there; out of it, a new tab.
  stage.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-go], a[data-web]");
    if (!a || !bk.r) return;
    e.preventDefault();
    if (a.dataset.web) return window.open(a.dataset.web, "_blank", "noopener");
    bkFollow(bk.r, a.dataset.go);
  });
}

// The spread's terms → the turning page's (x from the spine).
function bkLocal(t, x, y) { return { x: t.side === "right" ? x - t.spine : t.spine - x, y }; }

function bkSlideStart(r, dir) {
  const spread = $("bk-spread");
  const W = r.box.w * r.spread;
  const target = r.at + dir * r.spread;
  const cur = [...spread.children];
  const next = [];
  for (let n = 0; n < r.spread; n++) {
    const f = bkFace(r, target + n);
    f.classList.add("still");
    f.style.left = `${n * r.box.w + dir * W}px`;
    next.push(f);
  }
  spread.append(...next);
  r.turning = { slide: true };
  return { all: [...cur, ...next], dir, target, W };
}

function bkSlideMove(s, dx) {
  const x = s.dir > 0 ? Math.min(0, dx) : Math.max(0, dx);
  for (const f of s.all) { f.style.transition = "none"; f.style.transform = `translateX(${x}px)`; }
}

function bkSlideEnd(r, s, go) {
  for (const f of s.all) { f.style.transition = "transform 0.26s cubic-bezier(.2,.8,.2,1)"; f.style.transform = go ? `translateX(${-s.dir * s.W}px)` : "translateX(0)"; }
  setTimeout(() => { r.turning = null; bkShow(r, go ? s.target : r.at); }, 280);
}

function bkKeys(e) {
  const r = bk.r;
  if (!r || e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const go = { ArrowRight: 1, PageDown: 1, " ": 1, ArrowLeft: -1, PageUp: -1 }[e.key];
  if (go) { e.preventDefault(); return bkTurn(e.shiftKey && e.key === " " ? -1 : go); }
  if (e.key === "Home") { e.preventDefault(); return bkGo(0); }
  if (e.key === "End") { e.preventDefault(); return bkGo(r.total - 1); }
  if (e.key === "Escape" && !$("bk-toc").hidden) { e.preventDefault(); $("bk-toc").hidden = true; }
}

// ------------------------------------------------------- the contents

async function bkContents() {
  const r = bk.r;
  const box = $("bk-toc");
  if (!r) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(el("p", { class: "bk-dim" }, "…"));
  let items = [];
  if (r.kind === "epub") {
    items = (r.info.toc || []).map((x) => ({ title: x.title, go: () => bkGoTo(r, { sec: x.section, off: 0, anchor: x.anchor }) }));
  } else {
    if (r.outline == null) {
      r.outline = [];
      try {
        const walk = async (list, depth) => {
          for (const o of list || []) {
            let page = null;
            try {
              const dest = typeof o.dest === "string" ? await r.doc.getDestination(o.dest) : o.dest;
              if (dest?.[0]) page = (await r.doc.getPageIndex(dest[0])) + 1;
            } catch { /* no page for it */ }
            if (page) r.outline.push({ title: o.title, page, depth });
            if (depth < 2) await walk(o.items, depth + 1);
          }
        };
        await walk(await r.doc.getOutline(), 0);
      } catch { /* none */ }
    }
    items = r.outline.map((x) => ({ title: x.title, depth: x.depth, go: () => bkGoTo(r, { page: x.page }) }));
  }
  const close = el("button", { type: "button", class: "bk-tool", "aria-label": "Close" }, svg(BK_ICONS.close));
  close.addEventListener("click", () => { box.hidden = true; });
  box.replaceChildren(el("div", { class: "bk-toc-head" }, el("h3", {}, "Contents"), close),
    items.length ? el("ol", { class: "bk-toc-list" }, ...items.map((x) => {
      const b = el("button", { type: "button", class: `bk-toc-item d${x.depth || 0}` }, x.title);
      b.addEventListener("click", () => { box.hidden = true; x.go(); });
      return el("li", {}, b);
    })) : el("p", { class: "bk-dim" }, "This book has no contents to go by."));
}

async function bkGoTo(r, pos) {
  if (r.view === "book" && r.kind === "pdf") return bkGo((pos.page || 1) - 1);
  const at = bkPosSection(r, pos);
  const col = await bkColumnOf(r, at.k, at);
  bkGo(r.starts[at.k] + col);
}

function bkFollow(r, go) {
  const [path, anchor] = go.split("#");
  const k = path ? r.sections.findIndex((s) => s.href === path) : bkWhere(r, r.at).k;
  if (k < 0) return;
  bkGoTo(r, { sec: k, off: 0, anchor });
}

// -------------------------------------------------- a PDF's words

// Taken out once (here, with pdf.js), kept on the server for every device.
async function bkPdfText(r) {
  if (r.textPages) return r.noText ? bkNoText() : true;
  if (r.b.text) {
    try { r.textPages = (await bkGet(`text?id=${bkEnc(r.b.id)}`)).pages; } catch { r.textPages = null; }
  }
  if (!r.textPages) {
    const spread = $("bk-spread");
    const note = el("p", {}, "Taking the words out of this PDF, once…");
    spread.replaceChildren(el("div", { class: "bk-loading" }, note));
    const gen = r.gen;
    const pages = [];
    for (let p = 1; p <= r.pages; p++) {
      if (bk.r !== r || gen !== r.gen) return false;
      try {
        const page = await r.doc.getPage(p);
        pages.push(bkPageText(await page.getTextContent()));
        page.cleanup();
      } catch { pages.push(""); }
      if (p % 10 === 0) note.textContent = `Taking the words out of this PDF, once: ${Math.round((p / r.pages) * 100)}%`;
    }
    r.textPages = pages;
    bkPost("text", { id: r.b.id, pages }).then((ok) => { if (ok) r.b.text = true; });
  }
  const words = r.textPages.reduce((a, t) => a + t.length, 0);
  r.noText = words < Math.max(400, r.pages * 30);
  return r.noText ? bkNoText() : true;
}

function bkNoText() {
  toast("This PDF is pictures of its pages, with no words to lay out: only the Book shows it.");
  return false;
}

// A page's words as paragraphs: lines from where pdf.js put each piece,
// joined (a word broken by a hyphen made whole), a paragraph where the gap
// between lines grows or a line starts further in; page numbers left out.
function bkPageText(content) {
  const lines = [];
  let line = null;
  for (const it of content.items) {
    if (!("str" in it)) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    if (!line || Math.abs(y - line.y) > size * 0.5) {
      line = { y, x, size, text: "", right: x };
      lines.push(line);
    }
    line.text += it.str;
    line.right = Math.max(line.right, x + (it.width || 0));
    if (it.hasEOL) line = null;
  }
  const kept = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
  // A number alone at the top or the bottom: the page's number.
  const folio = (l) => /^([0-9]{1,4}|[ivxlcdm]{1,7})$/i.test(l.text);
  while (kept.length && folio(kept[kept.length - 1])) kept.pop();
  while (kept.length && folio(kept[0])) kept.shift();
  if (!kept.length) return "";
  const gaps = [];
  for (let i = 1; i < kept.length; i++) { const g = kept[i - 1].y - kept[i].y; if (g > 0) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)] || kept[0].size * 1.2;
  const left = Math.min(...kept.map((l) => l.x));
  const right = Math.max(...kept.map((l) => l.right));
  const paras = [];
  let cur = "";
  kept.forEach((l, i) => {
    const prev = kept[i - 1];
    const breaks = prev && ((prev.y - l.y) > gap * 1.45 || (prev.y - l.y) < 0
      || (l.x - left > l.size * 0.9 && /[.!?:"”]$/.test(prev.text))
      || (prev.right < right - (right - left) * 0.25 && /[.!?:"”]$/.test(prev.text)));
    if (breaks && cur) { paras.push(cur); cur = ""; }
    if (!cur) cur = l.text;
    else if (/[a-z]-$/.test(cur) && /^[a-z]/.test(l.text)) cur = cur.slice(0, -1) + l.text;
    else cur += ` ${l.text}`;
  });
  if (cur) paras.push(cur);
  return paras.join("\n\n");
}

// ------------------------------------------------------ keeping place

let bkSaveTimer = null;
function bkSaveSoon() {
  clearTimeout(bkSaveTimer);
  bkSaveTimer = setTimeout(() => { const r = bk.r; if (r && !r.turning) bkPosExact(r).then(() => bkSaveNow()); }, 1200);
}

function bkSaveNow() {
  clearTimeout(bkSaveTimer);
  const r = bk.r;
  if (!r || !r.total) return;
  const pos = bkPosNow(r);
  if (!pos) return;
  r.lastPos = pos;
  const pct = r.total <= 1 ? 1 : Math.min(1, (r.at + r.spread) / r.total);
  const b = r.b;
  b.pct = pct;
  b.at = Date.now() / 1000;
  const body = JSON.stringify({ id: b.id, pos, pct, view: r.view });
  if (document.visibilityState === "hidden" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/books/progress", new Blob([body], { type: "application/json" }));
    return;
  }
  api("/api/books/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
}
window.addEventListener("pagehide", () => bkSaveNow());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") bkSaveNow(); });
