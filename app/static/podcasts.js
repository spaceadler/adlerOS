// Podcasts: your audiobooks and podcasts. Listen Now (where you got to in
// each, new episodes, what's new), the library (books, shows), a book's
// chapters or a show's episodes, and the player: 15 s back, 30 s on, the
// speed (0.5 to 3), a sleep timer (minutes, or the end of the chapter), the
// chapters beside it. From Audiobookshelf when it's connected (its API key
// pasted here once: the server keeps it, the page never sees it), with
// where you got to kept there and subscriptions it fetches new episodes
// for; else from the folders themselves (Media/Audiobooks, Media/Podcasts),
// where you got to kept in adlerOS. In the menu bar's Control Center and on
// a phone's lock screen like Music, and never both at once.
// Uses el, svg, $, api, toast, showLock, registerWindow, openWindow,
// toggleWindow, closeWindow, isOpen, winLoad/winSave, phoneLayout,
// registerNav, sideToggle, openMenu, openModal, closeModal, settingsFile,
// and Music's music, musicNowPlaying.
"use strict";

const PC_KEY = "adleros.podcasts";
const PC_RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const PC_SLEEP = [[5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1 hour 30"]];
const PC_ICONS = {
  close: ["M18 6 6 18", "m6 6 12 12"],
  now: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m10 8 6 4-6 4z"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  show: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M7.8 16.2a6 6 0 0 1 0-8.4", "M16.2 7.8a6 6 0 0 1 0 8.4", "M4.9 19.1a10 10 0 0 1 0-14.2", "M19.1 4.9a10 10 0 0 1 0 14.2"],
  find: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  play: ["M7 4v16l13-8z"], pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"],
  back: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"], ahead: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"], check: ["M20 6 9 17l-5-5"],
  chevron: ["m15 18-6-6 6-6"], volume: ["M11 5 6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  muted: ["M11 5 6 9H2v6h4l5 4z", "m23 9-6 6", "m17 9 6 6"], refresh: ["M21 12a9 9 0 1 1-2.6-6.4", "M21 3v6h-6"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
};

const pc = {
  built: false, loaded: false, status: null, source: "local", items: [], byId: new Map(), episodes: [], progress: {}, libraries: [],
  details: new Map(), view: { kind: "now" }, back: [], fwd: [], panel: false, owner: false,
  audio: new Audio(), np: null, listened: 0, lastTick: 0, syncedAt: 0, sleep: null, sleepTimer: null,
  prefs: { rate: 1, volume: 1, sortBooks: "title", sortShows: "title" },
};
pc.audio.preload = "auto";

const pcKey = (id, ep) => `${id}|${ep || ""}`;
const pcEnc = encodeURIComponent;

function pcTime(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// 15 h 40 min, 45 min, 30 s.
function pcLong(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  return m ? `${m} min` : `${s} s`;
}

function pcDate(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((today - day) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

// Where you are in it: 3 h 12 min left, Played, or nothing yet.
function pcState(id, ep, duration) {
  const p = pc.progress[pcKey(id, ep)];
  if (p?.done) return { done: true, text: "Played", frac: 1 };
  if (p && p.t > 5) {
    const d = p.d || duration || 0;
    return { started: true, text: d ? `${pcLong(d - p.t)} left` : pcTime(p.t), frac: d ? Math.min(1, p.t / d) : 0 };
  }
  return { text: duration ? pcLong(duration) : "", frac: 0 };
}

async function pcGet(path) {
  const { status, body } = await api(`/api/podcasts/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status !== 200) throw new Error(body?.error || "adlerOS didn't answer.");
  return body;
}

async function pcPost(what, body, { quiet = false } = {}) {
  const { status, body: got } = await api(`/api/podcasts/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => ({ status: 0 }));
  if (status === 401) { if (!quiet) showLock(); return null; }
  if (status !== 200) { if (!quiet) toast(got?.error || "That didn't work."); return null; }
  return got;
}

// ------------------------------------------------------------ the window

async function openPodcasts() {
  pcBuild();
  openWindow("podcasts");
  if (!pc.loaded) await pcLoad();
  else pcLoad(true);
  if (!$("podcasts").contains(document.activeElement)) $("pc-main").focus({ preventScroll: true });
}

function togglePodcasts() { toggleWindow("podcasts", () => openPodcasts()); }

// Closing it stops it (and Audiobookshelf hears where you got to); putting
// it away doesn't (on a phone, in the car or on the TV, closing is putting
// it away: music.js mediaKeepsPlaying).
function closePodcasts() {
  if (!mediaKeepsPlaying() && pc.np) {
    pc.audio.pause();
    pcSync(true);
  }
  closeWindow("podcasts");
}

function pcBuild() {
  if (pc.built) return;
  pc.built = true;
  const saved = winLoad(PC_KEY, null);
  if (saved && typeof saved === "object") pc.prefs = { ...pc.prefs, ...saved };
  pc.audio.volume = Math.min(1, Math.max(0, Number(pc.prefs.volume) || 1));
  const close = el("button", { class: "sheet-close pc-close", type: "button", "aria-label": "Close Podcasts" }, svg(PC_ICONS.close));
  close.addEventListener("click", closePodcasts);
  const search = el("input", { class: "field-input pc-search", id: "pc-search", type: "search", placeholder: "Search your library", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = search.value.trim();
      if (q) pcShow({ kind: "find", q }, { replace: pc.view.kind === "find" });
      else if (pc.view.kind === "find") pcShow({ kind: "now" });
    }, 200);
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; search.dispatchEvent(new Event("input")); } });
  const section = el("section", { id: "podcasts", class: "sheet podcasts-app", "aria-label": "Podcasts", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "pc-shell", id: "pc-shell" },
      el("aside", { class: "pc-side", id: "pc-side" }, el("label", { class: "pc-search-box" }, svg(PC_ICONS.find), search),
        el("nav", { class: "pc-nav", id: "pc-nav", "aria-label": "Podcasts" }), el("div", { class: "pc-source", id: "pc-source" })),
      el("main", { class: "pc-main", id: "pc-main", tabindex: "-1" }),
      el("aside", { class: "pc-panel", id: "pc-panel", "aria-label": "Chapters" }),
      pcBar()));
  document.body.insertBefore(section, $("modal"));
  $("pc-shell").append(sideToggle(section, "podcasts"));
  registerWindow("podcasts", { title: "Podcasts", close: closePodcasts, hide: () => closeWindow("podcasts"), dock: "podcasts", size: [1180, 780] });
  registerNav("podcasts", (dir) => pcNav(dir));
  section.addEventListener("keydown", pcKeys);
  pcRenderSide();
  pcMessage("Opening your library…");
  pcBarUpdate();
}

function pcKeys(e) {
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " " && pc.np && !e.target.closest("button, a")) { e.preventDefault(); pcToggle(); }
}

function pcSavePrefs() { winSave(PC_KEY, pc.prefs); }

function pcMessage(text) {
  if (pc.built) $("pc-main").replaceChildren(el("div", { class: "pc-empty" }, el("p", {}, text)));
}

async function pcLoad(again = false) {
  try {
    pc.status = await pcGet("status");
  } catch (e) {
    if (e.message === "login") return;
    pc.status = { source: "local", error: "unreachable" };
  }
  let lib;
  try {
    lib = await pcGet("library");
  } catch (e) {
    if (e.message === "login") return;
    // Audiobookshelf said yes, then didn't answer: the folders meanwhile.
    lib = await pcGet("library?source=local").catch(() => null);
    if (lib) pc.status = { ...pc.status, source: "local", error: "unreachable" };
  }
  if (!lib) { if (!again) pcMessage("Your library didn't open. Try again in a moment."); return; }
  pc.loaded = true;
  pc.source = lib.source;
  pc.items = lib.items || [];
  pc.byId = new Map(pc.items.map((i) => [i.id, i]));
  pc.episodes = lib.episodes || [];
  pc.progress = lib.progress || {};
  pc.libraries = lib.libraries || [];
  if (pc.view.kind === "item" && !pc.byId.has(pc.view.id)) pc.view = { kind: "now" };
  pcRenderSide();
  pcRender();
}

// ------------------------------------------------------------- the side

function pcRenderSide() {
  const nav = $("pc-nav");
  if (!nav) return;
  const count = (kind) => pc.items.filter((i) => i.kind === kind).length;
  const item = (view, icon, label, extra = "") => {
    const on = pc.view.kind === view.kind || (pc.view.kind === "item" && view.kind === (pc.byId.get(pc.view.id)?.kind === "podcast" ? "shows" : "books"));
    const b = el("button", { type: "button", class: `pc-nav-item${on ? " on" : ""}` }, svg(icon), el("span", { class: "pc-nav-name" }, label),
      ...(extra !== "" ? [el("span", { class: "pc-nav-count" }, String(extra))] : []));
    b.addEventListener("click", () => { $("pc-search").value = ""; pcShow(view); });
    return b;
  };
  nav.replaceChildren(
    item({ kind: "now" }, PC_ICONS.now, "Listen Now"),
    el("p", { class: "pc-side-title" }, "Library"),
    item({ kind: "books" }, PC_ICONS.book, "Audiobooks", pc.loaded ? count("book") : ""),
    item({ kind: "shows" }, PC_ICONS.show, "Podcasts", pc.loaded ? count("podcast") : ""),
    el("p", { class: "pc-side-title" }, "More"),
    item({ kind: "discover" }, PC_ICONS.find, "Find Podcasts"));
  const s = pc.status || {};
  const src = $("pc-source");
  const abs = pc.source === "abs";
  const b = el("button", { type: "button", class: `pc-source-button${pc.view.kind === "connect" ? " on" : ""}` },
    el("span", { class: `pc-dot${abs ? " on" : ""}` }),
    el("span", { class: "pc-source-text" }, el("span", {}, abs ? "Audiobookshelf" : "This computer's folders"),
      el("span", { class: "pc-dim" }, abs ? (s.user ? `Signed in as ${s.user}` : "Connected") : s.error === "unreachable" ? "Audiobookshelf isn't answering" : "Connect Audiobookshelf")));
  b.addEventListener("click", () => pcShow({ kind: "connect" }));
  src.replaceChildren(b);
}

// ------------------------------------------------------------ the views

function pcShow(view, { replace = false } = {}) {
  if (!replace && JSON.stringify(view) !== JSON.stringify(pc.view)) { pc.back.push({ view: pc.view, scroll: $("pc-main").scrollTop }); pc.fwd = []; }
  pc.view = view;
  pcRenderSide();
  pcRender();
}

function pcNav(dir) {
  const from = dir < 0 ? pc.back : pc.fwd;
  const to = dir < 0 ? pc.fwd : pc.back;
  const step = from.pop();
  if (!step) return;
  to.push({ view: pc.view, scroll: $("pc-main").scrollTop });
  pc.view = step.view;
  pcRenderSide();
  pcRender(step.scroll);
}

function pcRender(scroll = 0) {
  const main = $("pc-main");
  if (!main) return;
  if (!pc.loaded && pc.view.kind !== "connect") return;
  const page = el("div", { class: "pc-page" });
  main.replaceChildren(page);
  main.scrollTop = 0;
  const v = pc.view;
  const done = v.kind === "item" ? pcItemPage(page, v.id)
    : v.kind === "books" ? pcLibraryPage(page, "book")
      : v.kind === "shows" ? pcLibraryPage(page, "podcast")
        : v.kind === "find" ? pcFindPage(page, v.q)
          : v.kind === "discover" ? pcDiscoverPage(page)
            : v.kind === "connect" ? pcConnectPage(page)
              : pcNowPage(page);
  Promise.resolve(done).then(() => { if (scroll) requestAnimationFrame(() => { main.scrollTop = scroll; }); })
    .catch((e) => { if (e.message !== "login") page.replaceChildren(el("div", { class: "pc-empty" }, el("p", {}, e.message))); });
}

function pcHead(title, sub = "", ...tools) {
  return el("header", { class: "pc-head" }, el("div", {}, el("h1", {}, title), ...(sub ? [el("p", { class: "pc-head-sub" }, sub)] : [])),
    ...(tools.length ? [el("div", { class: "pc-head-tools" }, ...tools)] : []));
}

// A book's or a show's picture, or one drawn for it: its name on a color of its own.
function pcArt(item, size = 400) {
  const name = item?.title || "";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const box = el("span", { class: "pc-art" });
  const drawn = el("span", { class: "pc-art-drawn" }, el("span", { class: "pc-art-title" }, name), ...(item?.author ? [el("span", { class: "pc-art-by" }, item.author)] : []));
  drawn.style.cssText = `--h1: ${hue}; --h2: ${(hue + 40) % 360}`;
  box.append(drawn);
  if (item?.cover) {
    const img = el("img", { src: `/api/podcasts/cover?id=${pcEnc(item.id)}&w=${size}`, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("load", () => box.classList.add("has-img"));
    img.addEventListener("error", () => img.remove());
    box.append(img);
  }
  return box;
}

function pcBarLine(frac) {
  const bar = el("span", { class: "pc-progress" }, el("span", {}));
  bar.firstChild.style.cssText = `width: ${Math.round(frac * 100)}%`;
  return bar;
}

// A cover in a grid: the book or the show, where you are in it.
function pcTile(item) {
  const st = item.kind === "book" ? pcState(item.id, "", item.duration) : null;
  const sub = item.kind === "book" ? (st.done ? "Finished" : st.started ? st.text : item.author || pcLong(item.duration))
    : `${item.author ? `${item.author} · ` : ""}${item.count} episode${item.count === 1 ? "" : "s"}`;
  const art = pcArt(item);
  if (st?.started) art.append(pcBarLine(st.frac));
  if (st?.done) art.append(el("span", { class: "pc-art-done" }, svg(PC_ICONS.check)));
  const b = el("button", { type: "button", class: "pc-tile", "data-id": item.id }, art,
    el("span", { class: "pc-tile-title" }, item.title), el("span", { class: "pc-tile-sub" }, sub));
  b.addEventListener("click", () => pcShow({ kind: "item", id: item.id }));
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); pcItemMenu(item, e.clientX, e.clientY); });
  return b;
}

function pcItemMenu(item, x, y) {
  const items = [{ label: "Open", run: () => pcShow({ kind: "item", id: item.id }) }];
  if (item.kind === "book") {
    const st = pcState(item.id, "", item.duration);
    items.unshift({ label: st.started ? "Resume" : "Play", run: () => pcPlay(item.id) });
    items.push(st.done ? { label: "Mark as Not Finished", run: () => pcMarkPlayed(item.id, "", false) } : { label: "Mark as Finished", run: () => pcMarkPlayed(item.id, "", true) });
  }
  openMenu(x, y, items);
}

function pcShelf(title, nodes, more = null) {
  if (!nodes.length) return null;
  const head = el("div", { class: "pc-shelf-head" }, el("h2", {}, title));
  if (more) {
    const b = el("button", { type: "button", class: "pc-link" }, "See All");
    b.addEventListener("click", more);
    head.append(b);
  }
  return el("section", { class: "pc-shelf" }, head, ...nodes);
}

// ---------------------------------------------------------- Listen Now

function pcContinueList() {
  return Object.entries(pc.progress)
    .filter(([, p]) => p && p.t > 5 && !p.done && !p.hide)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .map(([key, p]) => { const i = key.lastIndexOf("|"); return { id: key.slice(0, i), ep: key.slice(i + 1), p }; })
    .filter((x) => pc.byId.has(x.id))
    .slice(0, 12);
}

function pcEpisodeTitle(id, ep) {
  return pc.episodes.find((e) => e.id === id && e.ep === ep)?.title || pc.details.get(id)?.episodes?.find((e) => e.ep === ep)?.title || "";
}

function pcContinueCard(x) {
  const item = pc.byId.get(x.id);
  const title = x.ep ? pcEpisodeTitle(x.id, x.ep) : item.title;
  const d = x.p.d || item.duration;
  const art = pcArt(item);
  const titleNode = el("span", { class: "pc-card-title" }, title || item.title);
  const card = el("button", { type: "button", class: "pc-card" }, art,
    el("span", { class: "pc-card-text" }, el("span", { class: "pc-card-kicker" }, x.ep ? item.title : item.author || "Audiobook"), titleNode,
      el("span", { class: "pc-card-sub" }, el("span", { class: "pc-card-play" }, svg(PC_ICONS.play)), d ? `${pcLong(d - x.p.t)} left` : pcTime(x.p.t)),
      pcBarLine(d ? x.p.t / d : 0)));
  if (x.ep && !title) pcDetail(x.id).then((dt) => { const t = dt?.episodes?.find((e) => e.ep === x.ep)?.title; if (t) titleNode.textContent = t; }).catch(() => {});
  card.addEventListener("click", () => pcPlay(x.id, x.ep));
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: "Resume", run: () => pcPlay(x.id, x.ep) },
      { label: x.ep ? "Go to Podcast" : "Go to Book", run: () => pcShow({ kind: "item", id: x.id }) },
      { label: "Mark as Played", run: () => pcMarkPlayed(x.id, x.ep, true) },
      { label: "Remove from Continue", run: () => pcHide(x.id, x.ep) },
    ]);
  });
  return card;
}

function pcNowPage(page) {
  page.append(pcHead("Listen Now"));
  if (!pc.items.length) return pcNothingYet(page);
  const cont = pcContinueList();
  const shelves = [
    pcShelf("Continue", cont.length ? [el("div", { class: "pc-cards" }, ...cont.map(pcContinueCard))] : []),
    pcShelf("New Episodes", pc.episodes.length ? [el("div", { class: "pc-eps" }, ...pc.episodes.slice(0, 8).map((e) => pcEpisodeRow(e, { show: true })))] : []),
    pcShelf("Recently Added", [el("div", { class: "pc-grid pc-grid-row" }, ...[...pc.items].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 8).map(pcTile))]),
  ].filter(Boolean);
  page.append(...shelves);
}

function pcNothingYet(page) {
  const roots = (pc.status?.local || []).map((r) => r.path).join(" and ") || "/user/Media/Audiobooks and /user/Media/Podcasts";
  const b = el("button", { type: "button", class: "pc-button primary" }, "Connect Audiobookshelf");
  b.addEventListener("click", () => pcShow({ kind: "connect" }));
  page.append(el("div", { class: "pc-empty" }, el("h2", {}, "Nothing to listen to yet"),
    el("p", {}, pc.source === "abs" ? "Audiobookshelf's libraries are empty. Add books there, or find a podcast to subscribe to."
      : `Put a book in ${roots}: a folder a book, its files the chapters (a podcast: a folder of episodes).`),
    ...(pc.source === "abs" ? [] : [b])));
}

// ------------------------------------------------------------- library

function pcSorted(list, how) {
  const by = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const out = [...list];
  if (how === "added") out.sort((a, b) => (b.added || 0) - (a.added || 0));
  else if (how === "author") out.sort((a, b) => by.compare(a.author || "~", b.author || "~") || by.compare(a.title, b.title));
  else if (how === "recent") out.sort((a, b) => (pc.progress[pcKey(b.id, "")]?.at || 0) - (pc.progress[pcKey(a.id, "")]?.at || 0) || by.compare(a.title, b.title));
  else out.sort((a, b) => by.compare(a.title, b.title));
  return out;
}

function pcLibraryPage(page, kind) {
  const pref = kind === "book" ? "sortBooks" : "sortShows";
  const list = pc.items.filter((i) => i.kind === kind);
  const sort = el("select", { class: "field-input pc-sort", "aria-label": "Sort by" },
    ...[["title", "Title"], ["author", kind === "book" ? "Author" : "Publisher"], ["added", "Recently added"], ...(kind === "book" ? [["recent", "Recently played"]] : [])]
      .map(([v, label]) => el("option", { value: v, ...(v === pc.prefs[pref] ? { selected: "" } : {}) }, label)));
  sort.addEventListener("change", () => { pc.prefs[pref] = sort.value; pcSavePrefs(); pcRender(); });
  const hours = list.reduce((a, i) => a + (i.duration || 0), 0);
  page.append(pcHead(kind === "book" ? "Audiobooks" : "Podcasts",
    list.length ? `${list.length} ${kind === "book" ? `book${list.length === 1 ? "" : "s"}` : `show${list.length === 1 ? "" : "s"}`}${hours ? `, ${pcLong(hours)}` : ""}` : "", sort));
  if (!list.length) {
    page.append(el("div", { class: "pc-empty pc-empty-small" }, el("p", {}, kind === "book" ? "No audiobooks here yet."
      : pc.source === "abs" ? "No podcasts yet: find one to subscribe to." : "No podcasts here yet. A folder of episodes in Media/Podcasts is one.")));
    if (kind === "podcast" && pc.source === "abs") {
      const b = el("button", { type: "button", class: "pc-button primary" }, "Find Podcasts");
      b.addEventListener("click", () => pcShow({ kind: "discover" }));
      page.lastChild.append(b);
    }
    return;
  }
  page.append(el("div", { class: "pc-grid" }, ...pcSorted(list, pc.prefs[pref]).map(pcTile)));
}

function pcFindPage(page, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s) => { const t = String(s || "").toLowerCase(); return words.every((w) => t.includes(w)); };
  const items = pc.items.filter((i) => hit(`${i.title} ${i.author}`));
  const eps = pc.episodes.filter((e) => hit(`${e.title} ${e.show}`));
  for (const d of pc.details.values()) for (const e of d.episodes || []) if (hit(`${e.title} ${d.title}`) && !eps.some((x) => x.id === e.id && x.ep === e.ep)) eps.push({ ...e, show: d.title });
  page.append(pcHead(`“${q}”`, items.length + eps.length ? "" : "Nothing in your library by that name."));
  const shelves = [pcShelf("Books and Shows", items.length ? [el("div", { class: "pc-grid" }, ...items.map(pcTile))] : []),
    pcShelf("Episodes", eps.length ? [el("div", { class: "pc-eps" }, ...eps.slice(0, 40).map((e) => pcEpisodeRow(e, { show: true })))] : [])].filter(Boolean);
  page.append(...shelves);
}

// --------------------------------------------------- a book or a show

async function pcDetail(id, fresh = false) {
  if (!fresh && pc.details.has(id)) return pc.details.get(id);
  const d = await pcGet(`item?id=${pcEnc(id)}`);
  pc.details.set(id, d);
  return d;
}

async function pcItemPage(page, id) {
  const item = pc.byId.get(id);
  const back = el("button", { type: "button", class: "pc-back" }, svg(PC_ICONS.chevron), item?.kind === "podcast" ? "Podcasts" : "Audiobooks");
  back.addEventListener("click", () => (pc.back.length ? pcNav(-1) : pcShow({ kind: item?.kind === "podcast" ? "shows" : "books" })));
  page.append(back);
  const cached = pc.details.get(id);
  if (cached) pcItemDraw(page, cached);
  else page.append(el("p", { class: "pc-dim pc-loading" }, "…"));
  const d = await pcDetail(id, true);
  if (pc.view.kind !== "item" || pc.view.id !== id || !page.isConnected) return;
  page.replaceChildren(back);
  pcItemDraw(page, d);
}

function pcItemDraw(page, d) {
  const item = pc.byId.get(d.id) || d;
  const isBook = d.kind === "book";
  const st = isBook ? pcState(d.id, "", d.duration) : null;
  const playing = pc.np?.id === d.id && !pc.np.ep;
  const play = el("button", { type: "button", class: "pc-button primary fill" }, svg(playing && !pc.audio.paused ? PC_ICONS.pause : PC_ICONS.play),
    playing && !pc.audio.paused ? "Pause" : isBook ? (st.started ? `Resume · ${st.text}` : st.done ? "Play Again" : "Play") : "Play Newest");
  play.addEventListener("click", () => {
    if (playing) return pcToggle();
    if (isBook) return pcPlay(d.id, "", st.done ? 0 : null);
    const next = (d.episodes || []).find((e) => !pc.progress[pcKey(d.id, e.ep)]?.done) || d.episodes?.[0];
    if (next) pcPlay(d.id, next.ep);
  });
  const actions = [play];
  if (isBook) {
    const mark = el("button", { type: "button", class: "pc-button secondary" }, st.done ? "Mark as Not Finished" : "Mark as Finished");
    mark.addEventListener("click", () => pcMarkPlayed(d.id, "", !st.done));
    actions.push(mark);
  } else if (pc.source === "abs" && pc.status?.admin && d.feed) {
    const check = el("button", { type: "button", class: "pc-button secondary" }, svg(PC_ICONS.refresh), "Check for New Episodes");
    check.addEventListener("click", async () => {
      check.disabled = true;
      const got = await pcPost("checknew", { id: d.id });
      check.disabled = false;
      if (!got) return;
      toast(got.found ? `${got.found} new episode${got.found === 1 ? "" : "s"}: Audiobookshelf is downloading ${got.found === 1 ? "it" : "them"}.` : "No new episodes.");
      if (got.found) setTimeout(() => pcRefreshItem(d.id), 8000);
    });
    const more = el("button", { type: "button", class: "pc-button secondary" }, svg(PC_ICONS.download), "Older Episodes…");
    more.addEventListener("click", () => pcFeedDialog(d));
    actions.push(check, more);
  }
  const meta = [isBook ? "Audiobook" : "Podcast", d.duration && isBook ? pcLong(d.duration) : "",
    isBook ? `${(d.chapters || []).length} chapter${(d.chapters || []).length === 1 ? "" : "s"}` : `${(d.episodes || []).length} episode${(d.episodes || []).length === 1 ? "" : "s"}`,
    d.year || ""].filter(Boolean).join(" · ");
  const art = pcArt(item, 600);
  if (st?.started) art.append(pcBarLine(st.frac));
  page.append(el("div", { class: "pc-hero" }, art,
    el("div", { class: "pc-hero-text" }, el("p", { class: "pc-kicker" }, meta), el("h1", {}, d.title),
      ...(d.author ? [el("p", { class: "pc-hero-by" }, d.author)] : []), ...(d.narrator ? [el("p", { class: "pc-dim" }, `Read by ${d.narrator}`)] : []),
      el("div", { class: "pc-hero-actions" }, ...actions))));
  if (d.description) page.append(pcAbout(d.description));
  if (isBook) {
    const chapters = d.chapters || [];
    if (chapters.length > 1) page.append(pcShelf("Chapters", [el("ol", { class: "pc-chapters" }, ...chapters.map((c, i) => pcChapterRow(d, c, i)))]));
  } else {
    const eps = d.episodes || [];
    page.append(pcShelf("Episodes", eps.length ? [el("div", { class: "pc-eps" }, ...eps.map((e) => pcEpisodeRow(e)))] : [el("p", { class: "pc-dim" }, "No episodes downloaded yet.")]) || "");
  }
}

function pcAbout(text) {
  const p = el("p", { class: "pc-about clamp" }, text);
  const wrap = el("div", { class: "pc-about-box" }, p);
  requestAnimationFrame(() => {
    if (p.scrollHeight <= p.clientHeight + 2) return p.classList.remove("clamp");
    const more = el("button", { type: "button", class: "pc-link" }, "More");
    more.addEventListener("click", () => { const open = p.classList.toggle("clamp"); more.textContent = open ? "More" : "Less"; });
    wrap.append(more);
  });
  return wrap;
}

function pcChapterRow(d, c, i) {
  const row = el("li", { class: "pc-chapter", "data-start": String(c.start) }, el("span", { class: "pc-chapter-n" }, String(i + 1)),
    el("span", { class: "pc-chapter-title" }, c.title), el("span", { class: "pc-chapter-time" }, pcTime((c.end || 0) - (c.start || 0))));
  row.tabIndex = 0;
  const go = () => (pc.np?.id === d.id && !pc.np.ep ? pcSeek(c.start, true) : pcPlay(d.id, "", c.start));
  row.addEventListener("click", go);
  row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  return row;
}

function pcEpisodeRow(e, { show = false } = {}) {
  const st = pcState(e.id, e.ep, e.duration);
  const now = pc.np?.id === e.id && pc.np.ep === e.ep;
  const playB = el("button", { type: "button", class: "pc-ep-play", "aria-label": now && !pc.audio.paused ? "Pause" : "Play" },
    svg(now && !pc.audio.paused ? PC_ICONS.pause : PC_ICONS.play));
  playB.addEventListener("click", (ev) => { ev.stopPropagation(); if (now) pcToggle(); else pcPlay(e.id, e.ep); });
  const status = el("span", { class: `pc-ep-status${st.done ? " done" : ""}` }, ...(st.done ? [svg(PC_ICONS.check)] : []), st.text);
  const more = el("button", { type: "button", class: "pc-icon pc-ep-more", "aria-label": "More" }, svg(PC_ICONS.more));
  const menu = (x, y) => openMenu(x, y, [
    { label: now ? (pc.audio.paused ? "Play" : "Pause") : st.started ? "Resume" : "Play", run: () => (now ? pcToggle() : pcPlay(e.id, e.ep)) },
    ...(st.started || now ? [{ label: "Play from the Start", run: () => pcPlay(e.id, e.ep, 0) }] : []),
    st.done ? { label: "Mark as Unplayed", run: () => pcMarkPlayed(e.id, e.ep, false) } : { label: "Mark as Played", run: () => pcMarkPlayed(e.id, e.ep, true) },
    ...(show ? [{ label: "Go to Podcast", run: () => pcShow({ kind: "item", id: e.id }) }] : []),
  ]);
  more.addEventListener("click", (ev) => { ev.stopPropagation(); const r = more.getBoundingClientRect(); menu(r.left, r.bottom + 4); });
  const row = el("div", { class: `pc-ep${st.done ? " played" : ""}${now ? " now" : ""}`, "data-key": pcKey(e.id, e.ep), tabindex: "0" },
    ...(show ? [pcArt(pc.byId.get(e.id) || { title: e.show }, 200)] : []),
    el("div", { class: "pc-ep-text" }, el("span", { class: "pc-ep-date" }, [pcDate(e.date), show ? e.show : ""].filter(Boolean).join(" · ")),
      el("span", { class: "pc-ep-title" }, e.title), ...(e.description ? [el("span", { class: "pc-ep-desc" }, e.description)] : []),
      el("span", { class: "pc-ep-foot" }, playB, status, ...(st.started ? [pcBarLine(st.frac)] : []))),
    more);
  row.addEventListener("click", () => (now ? pcToggle() : pcPlay(e.id, e.ep)));
  row.addEventListener("keydown", (ev) => { if (ev.key === "Enter") row.click(); });
  row.addEventListener("contextmenu", (ev) => { ev.preventDefault(); menu(ev.clientX, ev.clientY); });
  return row;
}

async function pcRefreshItem(id) {
  await pcLoad(true);
  if (pc.view.kind === "item" && pc.view.id === id) pcRender($("pc-main").scrollTop);
}

// Audiobookshelf's: the feed's episodes it hasn't got, to fetch.
async function pcFeedDialog(d) {
  const list = el("div", { class: "pc-feed" }, el("p", { class: "pc-dim" }, "Looking in the feed…"));
  const go = el("button", { type: "button", class: "button-primary", disabled: "" }, "Download");
  const cancel = el("button", { type: "button", class: "button-secondary" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material pc-feed-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Older episodes" },
    el("h2", {}, d.title), el("p", { class: "pc-dim" }, "Episodes from its feed that aren't downloaded. Audiobookshelf fetches the ones you tick."),
    list, el("div", { class: "dialog-actions" }, cancel, go)));
  let eps;
  try {
    eps = (await pcGet(`feed?id=${pcEnc(d.id)}`)).episodes.filter((e) => !e.have && e.url);
  } catch (e) {
    if (e.message !== "login") list.replaceChildren(el("p", {}, e.message));
    return;
  }
  if (!eps.length) return list.replaceChildren(el("p", {}, "You have every episode in the feed."));
  const boxes = eps.slice(0, 200).map((e) => {
    const box = el("input", { type: "checkbox", value: e.url });
    box.addEventListener("change", () => { go.disabled = !list.querySelector("input:checked"); });
    return el("label", { class: "pc-feed-row" }, box, el("span", { class: "pc-feed-text" }, el("span", {}, e.title),
      el("span", { class: "pc-dim" }, [pcDate(e.date), e.duration ? pcLong(e.duration) : ""].filter(Boolean).join(" · "))));
  });
  list.replaceChildren(...boxes);
  go.addEventListener("click", async () => {
    const urls = [...list.querySelectorAll("input:checked")].map((b) => b.value);
    go.disabled = true;
    const got = await pcPost("download", { id: d.id, urls });
    if (!got) { go.disabled = false; return; }
    closeModal();
    toast(`Audiobookshelf is downloading ${got.queued} episode${got.queued === 1 ? "" : "s"}.`);
    setTimeout(() => pcRefreshItem(d.id), 10000);
  });
}

// ------------------------------------------------- finding podcasts

function pcDiscoverPage(page) {
  page.append(pcHead("Find Podcasts", pc.source === "abs" ? "Search every podcast there is, and subscribe: Audiobookshelf downloads new episodes as they come out." : ""));
  if (pc.source !== "abs") {
    const b = el("button", { type: "button", class: "pc-button primary" }, "Connect Audiobookshelf");
    b.addEventListener("click", () => pcShow({ kind: "connect" }));
    page.append(el("div", { class: "pc-empty pc-empty-small" },
      el("p", {}, "Subscribing needs Audiobookshelf: it looks for new episodes and downloads them. Without it, Podcasts plays what's in your folders."), b));
    return;
  }
  const input = el("input", { class: "field-input pc-discover-input", type: "search", placeholder: "Podcast name or topic", spellcheck: "false", autocomplete: "off", value: pc.view.q || "" });
  const results = el("div", { class: "pc-results" });
  const run = async () => {
    const q = input.value.trim();
    if (!q) return results.replaceChildren();
    pc.view.q = q;
    results.replaceChildren(el("p", { class: "pc-dim" }, "Searching…"));
    let got;
    try { got = await pcGet(`search?q=${pcEnc(q)}`); } catch (e) { if (e.message !== "login") results.replaceChildren(el("p", {}, e.message)); return; }
    if (input.value.trim() !== q) return;
    if (!got.results.length) return results.replaceChildren(el("p", { class: "pc-dim" }, "No podcasts by that name."));
    results.replaceChildren(...got.results.map(pcResult));
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  page.append(el("label", { class: "pc-search-box pc-discover" }, svg(PC_ICONS.find), input), results);
  if (input.value) run();
  requestAnimationFrame(() => input.focus());
}

function pcResult(r) {
  const have = pc.items.find((i) => i.kind === "podcast" && i.title.toLowerCase() === r.title.toLowerCase());
  const art = el("span", { class: "pc-art" });
  if (r.cover) art.append(el("img", { src: r.cover, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
  art.classList.add("has-img");
  const sub = el("button", { type: "button", class: `pc-button ${have ? "secondary" : "primary"}` }, have ? "Subscribed" : "Subscribe");
  if (!pc.status?.admin && !have) { sub.disabled = true; sub.title = "Only an Audiobookshelf admin can subscribe"; }
  sub.addEventListener("click", async () => {
    if (have) return pcShow({ kind: "item", id: have.id });
    sub.disabled = true;
    sub.textContent = "Subscribing…";
    const got = await pcPost("subscribe", { feedUrl: r.feedUrl });
    if (!got) { sub.disabled = false; sub.textContent = "Subscribe"; return; }
    toast(`Subscribed to ${got.title}. Its newest episode is downloading.`);
    await pcLoad(true);
    if (got.id && pc.byId.has(got.id)) pcShow({ kind: "item", id: got.id });
  });
  return el("div", { class: "pc-result" }, art, el("div", { class: "pc-result-text" }, el("span", { class: "pc-tile-title" }, r.title),
    el("span", { class: "pc-tile-sub" }, [r.author, r.count ? `${r.count} episodes` : ""].filter(Boolean).join(" · ")),
    ...(r.description ? [el("span", { class: "pc-ep-desc" }, r.description)] : [])), sub);
}

// --------------------------------------------------------- connecting

function pcConnectPage(page) {
  const s = pc.status || {};
  page.append(pcHead("Audiobookshelf"));
  const box = el("div", { class: "pc-connect" });
  page.append(box);
  const roots = (s.local || []).map((r) => r.path).join(" and ");
  if (s.ok) {
    box.append(el("p", {}, `Connected${s.user ? ` as ${s.user}` : ""}. Your books, where you got to in them and your subscriptions are Audiobookshelf's: on your phone's Audiobookshelf app too.`));
    if (s.keyHere) {
      const off = el("button", { type: "button", class: "pc-button secondary" }, "Disconnect");
      off.addEventListener("click", async () => {
        if (!await confirmDialog({ title: "Disconnect Audiobookshelf?", body: `adlerOS forgets the key. Podcasts goes back to the folders (${roots}), and where you got to is kept here from then on.`, button: "Disconnect", destructive: true })) return;
        if (await pcPost("connect", { token: "" })) { toast("Disconnected."); pc.details.clear(); await pcLoad(true); pcShow({ kind: "connect" }, { replace: true }); }
      });
      box.append(el("div", { class: "pc-hero-actions" }, off));
    } else {
      box.append(el("p", { class: "pc-dim" }, `Its key is in ${settingsFile()} (ABS_TOKEN).`));
    }
    return;
  }
  if (s.error === "noabs") {
    box.append(el("p", {}, `Audiobookshelf isn't among your apps here: install it (the App Store has it), or set ABS_URL in ${settingsFile()} to where it runs.`));
  } else {
    const why = s.error === "refused" ? "Audiobookshelf didn't take the key it has: paste a new one."
      : s.error === "unreachable" ? "Audiobookshelf isn't answering right now. Is it running? The key below replaces the one adlerOS has."
        : "Podcasts can play from Audiobookshelf: your books and podcasts there, where you got to in each (the same on your phone's Audiobookshelf app), and podcasts it subscribes to and downloads.";
    const input = el("input", { class: "field-input pc-key", type: "password", placeholder: "API key", autocomplete: "off", spellcheck: "false", "aria-label": "Audiobookshelf API key" });
    const go = el("button", { type: "button", class: "pc-button primary" }, "Connect");
    const note = el("p", { class: "pc-note", hidden: "" });
    const connect = async () => {
      const token = input.value.trim();
      if (!token) return input.focus();
      go.disabled = true;
      const got = await pcPost("connect", { token }, { quiet: true }).catch(() => null);
      go.disabled = false;
      if (!got?.ok) { note.hidden = false; note.textContent = got?.error || "That key didn't work."; return; }
      input.value = "";
      toast(`Connected to Audiobookshelf${got.user ? ` as ${got.user}` : ""}.`);
      pc.details.clear();
      await pcLoad(true);
      pcShow({ kind: "now" });
    };
    go.addEventListener("click", connect);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
    box.append(el("p", {}, why),
      el("ol", { class: "pc-steps" }, el("li", {}, "Open Audiobookshelf and sign in."), el("li", {}, "Settings, then API Keys, then Add API Key: any name, your user, no expiry."),
        el("li", {}, "Copy the key it shows (only once) and paste it here.")),
      el("div", { class: "pc-key-row" }, input, go), note,
      el("p", { class: "pc-dim" }, "adlerOS keeps the key on the server: this page never sees it again."));
  }
  if (roots) box.append(el("p", { class: "pc-dim" }, `Until then, Podcasts plays what's in ${roots}, and remembers where you got to here.`));
}

// ---------------------------------------------------------- playing

function pcOwnsMedia() { return pc.owner && Boolean(pc.np); }

// What's playing, for Control Center and the bar: its title, under it the
// chapter (a book) or the show (an episode).
function pcNow() {
  const np = pc.np;
  if (!np) return null;
  const ch = pcChapter();
  return { title: np.title, sub: np.ep ? np.show : ch?.title || np.author, item: np.item, paused: pc.audio.paused };
}

async function pcPlay(id, ep = "", at = null) {
  const item = pc.byId.get(id) || pc.details.get(id);
  if (!item) return;
  if (pc.np && (pc.np.id !== id || pc.np.ep !== ep)) { pc.audio.pause(); pcSync(true); }
  if (pc.np?.id === id && pc.np.ep === ep) {
    if (at != null) pcSeek(at, true); else pc.audio.play().catch(() => {});
    return;
  }
  const got = await pcPost("play", { id, ep });
  if (!got) return;
  if (!got.tracks?.length) return toast("There's nothing to play in it.");
  const detail = pc.details.get(id);
  const epInfo = ep ? (detail?.episodes?.find((e) => e.ep === ep) || pc.episodes.find((e) => e.id === id && e.ep === ep)) : null;
  pc.np = {
    id, ep, item, title: ep ? epInfo?.title || got.tracks[0].title || item.title : item.title, show: item.title, author: item.author || "",
    tracks: got.tracks, duration: got.duration, session: got.session, track: -1, notes: epInfo?.description || "",
    chapters: got.chapters?.length ? got.chapters : !ep && detail?.chapters?.length ? detail.chapters
      : got.tracks.length > 1 ? got.tracks.map((t) => ({ title: t.title, start: t.start, end: t.start + t.duration })) : [],
  };
  pc.listened = 0;
  pc.syncedAt = Date.now();
  let start = at ?? got.current ?? 0;
  if (start > got.duration - 5) start = 0;
  pc.owner = true;
  pcSeek(start, true);
  pcBarUpdate();
  pcRenderPanel();
  pcMedia();
  pcMarkRows();
}

function pcTrackAt(t) {
  const tr = pc.np.tracks;
  let i = 0;
  while (i < tr.length - 1 && tr[i + 1].start <= t) i++;
  return i;
}

function pcPos() {
  const np = pc.np;
  if (!np) return 0;
  if (np.track < 0) return np.pending ?? 0;
  if (np.pending != null) return np.tracks[np.track].start + np.pending;
  return np.tracks[np.track].start + (pc.audio.currentTime || 0);
}

// To a place in the whole book (its files one after another).
function pcSeek(t, play = false) {
  const np = pc.np;
  if (!np) return;
  t = Math.max(0, Math.min(t, Math.max(0, np.duration - 0.5)));
  const i = pcTrackAt(t);
  const local = t - np.tracks[i].start;
  // Playing: it goes on playing there (another file's a new src, which stops it).
  play = play || (!pc.audio.paused && np.track >= 0);
  if (i !== np.track) {
    np.track = i;
    np.pending = local;
    pc.audio.src = np.tracks[i].url;
    pc.audio.defaultPlaybackRate = pc.prefs.rate;
    pc.audio.playbackRate = pc.prefs.rate;
  } else {
    pc.audio.currentTime = local;
  }
  if (play) pc.audio.play().catch(() => {});
  // Gone to another chapter yourself: the sleep timer's for that one now.
  if (pc.sleep?.kind === "chapter") pc.sleep.index = pcChapter()?.index ?? null;
  pcBarTime();
}

pc.audio.addEventListener("loadedmetadata", () => {
  const np = pc.np;
  if (np?.pending != null) { try { pc.audio.currentTime = np.pending; } catch { /* not yet */ } np.pending = null; }
  pc.audio.playbackRate = pc.prefs.rate;
  pcBarTime();
  pcPosition();
});

pc.audio.addEventListener("ended", () => {
  const np = pc.np;
  if (!np) return;
  if (np.track < np.tracks.length - 1) {
    // Its next file is its next chapter: a sleep timer for this one stops here.
    const stop = pc.sleep?.kind === "chapter";
    if (stop) { pcSleepOff(); toast("Sleep timer: the chapter's over."); }
    return pcSeek(np.tracks[np.track + 1].start, !stop);
  }
  // The end: played.
  pc.progress[pcKey(np.id, np.ep)] = { ...(pc.progress[pcKey(np.id, np.ep)] || {}), t: np.duration, d: np.duration, done: true, at: Date.now() / 1000 };
  pcSync(true, { at: np.duration });
  if (pc.sleep?.kind === "chapter") pcSleepOff();
  pcBarUpdate();
  pcMarkRows();
});

function pcToggle() {
  if (!pc.np) return;
  if (pc.audio.paused) {
    if (pcPos() >= pc.np.duration - 1) pcSeek(0);
    pc.audio.play().catch(() => {});
  } else {
    pc.audio.pause();
  }
}

function pcSkip(by) { if (pc.np) pcSeek(pcPos() + by); }

function pcRate(r) {
  pc.prefs.rate = r;
  pc.audio.defaultPlaybackRate = r;
  pc.audio.playbackRate = r;
  pcSavePrefs();
  pcBarUpdate();
  pcPosition();
}

function pcChapter() {
  const ch = pc.np?.chapters || [];
  if (!ch.length) return null;
  const t = pcPos();
  let i = 0;
  while (i < ch.length - 1 && ch[i + 1].start <= t + 0.25) i++;
  return { ...ch[i], index: i };
}

// Where you got to, to Audiobookshelf (or kept here): every 15 s while it
// plays, when it stops, when the page goes.
function pcSync(close = false, { beacon = false, at = null } = {}) {
  const np = pc.np;
  if (!np) return;
  const t = Math.round((at ?? pcPos()) * 10) / 10;
  const d = np.duration;
  const body = { id: np.id, ep: np.ep, session: np.session, t, d, listened: Math.round(pc.listened) };
  pc.listened = 0;
  pc.syncedAt = Date.now();
  const key = pcKey(np.id, np.ep);
  pc.progress[key] = { ...(pc.progress[key] || {}), t, d, done: t >= d - 2, hide: false, at: Date.now() / 1000 };
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/podcasts/sync", new Blob([JSON.stringify(body)], { type: "application/json" }));
    return;
  }
  pcPost(close ? "close" : "sync", body, { quiet: true });
}

let pcTimeShown = 0;
pc.audio.addEventListener("timeupdate", () => {
  const now = performance.now();
  if (!pc.audio.paused && pc.lastTick) { const dt = (now - pc.lastTick) / 1000; if (dt < 3) pc.listened += dt; }
  pc.lastTick = now;
  if (pc.sleep?.kind === "chapter" && pc.np) {
    const ch = pcChapter();
    const end = ch?.end || pc.np.duration;
    if (ch && pc.sleep.index !== ch.index && pc.sleep.index != null) { pc.audio.pause(); pcSleepOff(); toast("Sleep timer: the chapter's over."); }
    else if (pcPos() >= end - 0.4) { pc.audio.pause(); pcSleepOff(); toast("Sleep timer: the chapter's over."); }
  }
  if (now - pcTimeShown > 250) { pcTimeShown = now; pcBarTime(); }
  if (Date.now() - pc.syncedAt > 15000 && !pc.audio.paused) pcSync();
});
pc.audio.addEventListener("play", () => {
  pc.lastTick = performance.now();
  pc.owner = true;
  if (typeof music !== "undefined" && !music.audio.paused) music.audio.pause();
  pcBarUpdate();
  pcMedia();
  pcMarkRows();
});
pc.audio.addEventListener("pause", () => {
  pc.lastTick = 0;
  if (pc.np && !pc.audio.ended) pcSync();
  pcBarUpdate();
  pcPosition();
  pcMarkRows();
});
pc.audio.addEventListener("error", () => {
  if (!pc.np || !pc.audio.src) return;
  toast("That didn't play. Is the file still there (or Audiobookshelf answering)?");
});
pc.audio.addEventListener("volumechange", () => { pc.prefs.volume = pc.audio.volume; if (pc.built) pcBarUpdate(); });
// Music starting: this stops (one at a time, like a phone).
if (typeof music !== "undefined") {
  music.audio.addEventListener("play", () => {
    if (!pc.audio.paused) pc.audio.pause();
    if (pc.owner) { pc.owner = false; if (typeof musicNowPlaying === "function") musicNowPlaying(); }
  });
}
window.addEventListener("pagehide", () => { if (pc.np && !pc.audio.paused) pcSync(false, { beacon: true }); });

// ------------------------------------------------------------ sleep timer

function pcSleepOff() {
  clearTimeout(pc.sleepTimer);
  clearInterval(pc.sleepTick);
  pc.sleep = null;
  pcBarUpdate();
}

function pcSleepSet(choice) {
  pcSleepOff();
  if (choice === "chapter") {
    const ch = pcChapter();
    pc.sleep = { kind: "chapter", index: ch ? ch.index : null };
  } else if (choice) {
    pc.sleep = { kind: "min", until: Date.now() + choice * 60000 };
    pc.sleepTimer = setTimeout(pcSleepFade, choice * 60000 - 6000);
    pc.sleepTick = setInterval(pcBarUpdate, 30000);
  }
  pcBarUpdate();
}

// The last seconds quieter and quieter, then it stops.
function pcSleepFade() {
  const start = pc.audio.volume;
  let step = 0;
  const fade = setInterval(() => {
    step++;
    pc.audio.volume = Math.max(0, start * (1 - step / 12));
    if (step >= 12) {
      clearInterval(fade);
      pc.audio.pause();
      pc.audio.volume = start;
      pcSleepOff();
    }
  }, 500);
}

function pcSleepMenu(x, y) {
  const items = PC_SLEEP.map(([m, label]) => ({ label, run: () => pcSleepSet(m) }));
  items.push({ label: "When the Chapter Ends", run: () => pcSleepSet("chapter") });
  if (pc.sleep) items.unshift({ label: "Turn Off Sleep Timer", run: () => pcSleepOff() });
  openMenu(x, y, items);
}

function pcRateMenu(x, y) {
  openMenu(x, y, PC_RATES.map((r) => ({ label: `${r === pc.prefs.rate ? "✓ " : ""}${r}×`, run: () => pcRate(r) })));
}

// ------------------------------------------------------------- the bar

function pcIcon(label, icon, run, cls = "") {
  const b = el("button", { type: "button", class: `pc-icon ${cls}`, "aria-label": label, title: label }, svg(icon));
  b.addEventListener("click", (e) => run(e, b));
  return b;
}

function pcBar() {
  const seek = el("input", { class: "pc-seek", id: "pc-seek", type: "range", min: "0", max: "1000", step: "1", value: "0", "aria-label": "Where in it" });
  seek.addEventListener("input", () => {
    pc.seeking = true;
    const t = (Number(seek.value) / 1000) * (pc.np?.duration || 0);
    $("pc-now-time").textContent = pcTime(t);
    seek.style.setProperty("--done", `${seek.value / 10}%`);
  });
  seek.addEventListener("change", () => { pc.seeking = false; if (pc.np) pcSeek((Number(seek.value) / 1000) * pc.np.duration); });
  const volume = el("input", { class: "pc-volume", id: "pc-volume", type: "range", min: "0", max: "1", step: "0.01", "aria-label": "Volume" });
  volume.addEventListener("input", () => { pc.audio.volume = Number(volume.value); pc.audio.muted = false; pcSavePrefs(); });
  const play = pcIcon("Play", PC_ICONS.play, () => pcToggle(), "pc-play");
  play.id = "pc-play";
  const rate = el("button", { type: "button", class: "pc-icon pc-rate", id: "pc-rate", "aria-label": "Speed", title: "Speed" }, "1×");
  rate.addEventListener("click", () => { const r = rate.getBoundingClientRect(); pcRateMenu(r.left, r.top - 8 - PC_RATES.length * 34); });
  const sleep = el("button", { type: "button", class: "pc-icon pc-sleep", id: "pc-sleep", "aria-label": "Sleep timer", title: "Sleep timer" }, svg(PC_ICONS.moon), el("span", { class: "pc-sleep-left" }));
  sleep.addEventListener("click", () => { const r = sleep.getBoundingClientRect(); pcSleepMenu(r.left - 80, r.top - 8 - (PC_SLEEP.length + 2) * 34); });
  const art = el("button", { type: "button", class: "pc-bar-art", id: "pc-bar-art", "aria-label": "Go to it" });
  art.addEventListener("click", () => { if (pc.np) pcShow({ kind: "item", id: pc.np.id }); });
  return el("footer", { class: "pc-bar", id: "pc-bar", hidden: "" },
    el("div", { class: "pc-bar-now" }, art, el("div", { class: "pc-bar-text" }, el("span", { class: "pc-bar-title", id: "pc-bar-title" }), el("span", { class: "pc-bar-sub", id: "pc-bar-sub" }))),
    el("div", { class: "pc-bar-controls" }, pcIcon("Back 15 seconds", PC_ICONS.back, () => pcSkip(-15), "pc-skip back"), play, pcIcon("Forward 30 seconds", PC_ICONS.ahead, () => pcSkip(30), "pc-skip ahead")),
    el("div", { class: "pc-bar-seek" }, el("span", { class: "pc-bar-time", id: "pc-now-time" }, "0:00"), seek, el("span", { class: "pc-bar-time", id: "pc-left-time" }, "")),
    el("div", { class: "pc-bar-tools" }, rate, sleep, pcIcon("Chapters", PC_ICONS.list, () => pcPanel(!pc.panel), "pc-panel-button"),
      pcIcon("Mute", PC_ICONS.volume, () => { pc.audio.muted = !pc.audio.muted; pcBarUpdate(); }, "pc-mute"), volume));
}

function pcBarUpdate() {
  if (!pc.built) return;
  const np = pc.np;
  const bar = $("pc-bar");
  bar.hidden = !np;
  $("pc-shell").classList.toggle("with-bar", Boolean(np));
  if (!np) return;
  const playing = !pc.audio.paused;
  const play = $("pc-play");
  play.replaceChildren(svg(playing ? PC_ICONS.pause : PC_ICONS.play));
  play.setAttribute("aria-label", playing ? "Pause" : "Play");
  play.title = playing ? "Pause" : "Play";
  const art = $("pc-bar-art");
  if (art.dataset.id !== np.id) { art.dataset.id = np.id; art.replaceChildren(pcArt(np.item, 200)); }
  $("pc-rate").textContent = `${pc.prefs.rate}×`;
  const sleep = $("pc-sleep");
  sleep.classList.toggle("on", Boolean(pc.sleep));
  sleep.querySelector(".pc-sleep-left").textContent = pc.sleep?.kind === "min" ? `${Math.max(1, Math.round((pc.sleep.until - Date.now()) / 60000))}m` : pc.sleep ? "ch" : "";
  bar.querySelector(".pc-panel-button").classList.toggle("on", pc.panel);
  bar.querySelector(".pc-panel-button").setAttribute("aria-label", np.ep ? "Episode notes" : "Chapters");
  bar.querySelector(".pc-mute").replaceChildren(svg(pc.audio.muted || pc.audio.volume === 0 ? PC_ICONS.muted : PC_ICONS.volume));
  $("pc-volume").value = String(pc.audio.muted ? 0 : pc.audio.volume);
  $("pc-volume").style.setProperty("--done", `${(pc.audio.muted ? 0 : pc.audio.volume) * 100}%`);
  pcBarTime();
  if ("mediaSession" in navigator && pc.owner) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

function pcBarTime() {
  if (!pc.built || !pc.np) return;
  const np = pc.np;
  const t = pcPos();
  const now = pcNow();
  $("pc-bar-title").textContent = np.title;
  $("pc-bar-sub").textContent = now.sub || "";
  if (!pc.seeking) {
    const seek = $("pc-seek");
    const frac = np.duration ? t / np.duration : 0;
    seek.value = String(Math.round(frac * 1000));
    seek.style.setProperty("--done", `${frac * 100}%`);
    $("pc-now-time").textContent = pcTime(t);
  }
  // Left at this speed, as the time it'll take.
  $("pc-left-time").textContent = `-${pcTime((np.duration - t) / (pc.prefs.rate || 1))}`;
  const ch = pcChapter();
  if (pc.panel && ch && pc.shownChapter !== ch.index) pcMarkChapter();
  if (pc.shownSub !== now.sub) { pc.shownSub = now.sub; pcMedia(); }
}

// The playing one's row, wherever it's shown.
function pcMarkRows() {
  const main = $("pc-main");
  if (!main) return;
  const key = pc.np ? pcKey(pc.np.id, pc.np.ep) : "";
  const playing = !pc.audio.paused;
  for (const row of main.querySelectorAll(".pc-ep")) {
    const now = row.dataset.key === key;
    row.classList.toggle("now", now);
    const b = row.querySelector(".pc-ep-play");
    if (b) { b.replaceChildren(svg(now && playing ? PC_ICONS.pause : PC_ICONS.play)); b.setAttribute("aria-label", now && playing ? "Pause" : "Play"); }
  }
  pcMarkChapter();
}

// ------------------------------------------------------------ the panel

function pcPanel(open) {
  pc.panel = open;
  $("pc-shell").classList.toggle("with-panel", open);
  pcRenderPanel();
  pcBarUpdate();
}

function pcRenderPanel() {
  const panel = $("pc-panel");
  if (!panel || !pc.panel) return;
  const np = pc.np;
  const close = pcIcon("Close", PC_ICONS.close, () => pcPanel(false), "pc-panel-close");
  if (!np) return panel.replaceChildren(el("div", { class: "pc-panel-head" }, el("h3", {}, "Chapters"), close), el("p", { class: "pc-dim pc-panel-body" }, "Nothing's playing."));
  const head = el("div", { class: "pc-panel-head" }, el("h3", {}, np.ep ? "Episode Notes" : "Chapters"), close);
  if (np.ep || !np.chapters.length) {
    return panel.replaceChildren(head, el("div", { class: "pc-panel-body" }, el("p", { class: "pc-panel-title" }, np.title),
      el("p", { class: "pc-about" }, np.notes || (np.ep ? "No notes for this episode." : "This book has no chapters."))));
  }
  const list = el("ol", { class: "pc-chapters pc-panel-chapters" }, ...np.chapters.map((c, i) => {
    const row = el("li", { class: "pc-chapter", "data-i": String(i), tabindex: "0" }, el("span", { class: "pc-chapter-n" }, String(i + 1)),
      el("span", { class: "pc-chapter-title" }, c.title), el("span", { class: "pc-chapter-time" }, pcTime((c.end || 0) - (c.start || 0))));
    row.addEventListener("click", () => pcSeek(c.start, true));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") pcSeek(c.start, true); });
    return row;
  }));
  panel.replaceChildren(head, el("div", { class: "pc-panel-body" }, list));
  pc.shownChapter = null;
  pcMarkChapter(true);
}

function pcMarkChapter(scroll = false) {
  const ch = pcChapter();
  const index = ch ? ch.index : -1;
  const changed = pc.shownChapter !== index;
  pc.shownChapter = index;
  const panel = $("pc-panel");
  if (panel) for (const row of panel.querySelectorAll(".pc-chapter")) row.classList.toggle("now", Number(row.dataset.i) === index);
  const main = $("pc-main");
  if (main && pc.np && !pc.np.ep && pc.view.kind === "item" && pc.view.id === pc.np.id) {
    const rows = [...main.querySelectorAll(".pc-chapter")];
    rows.forEach((row, i) => row.classList.toggle("now", i === index));
  }
  if ((scroll || changed) && panel) panel.querySelector(".pc-chapter.now")?.scrollIntoView({ block: "nearest" });
}

// ------------------------------------------------ played and Continue

async function pcMarkPlayed(id, ep, done) {
  const got = await pcPost("played", { id, ep, done });
  if (!got) return;
  const key = pcKey(id, ep);
  pc.progress[key] = { ...(pc.progress[key] || {}), done, ...(done ? {} : { t: 0 }), at: Date.now() / 1000 };
  if (pc.np?.id === id && pc.np.ep === ep && done) pc.audio.pause();
  pcRender($("pc-main").scrollTop);
}

async function pcHide(id, ep) {
  const key = pcKey(id, ep);
  const got = await pcPost("hide", { id, ep, pid: pc.progress[key]?.pid || "" });
  if (!got) return;
  pc.progress[key] = { ...(pc.progress[key] || {}), hide: true };
  pcRender($("pc-main").scrollTop);
}

// --------------------------------------- the lock screen and media keys

const pcAction = (action, run) => { try { navigator.mediaSession.setActionHandler(action, run); } catch { /* not this browser */ } };

// Back 15 s and on 30 s (a phone shows those, not previous and next), and
// dragging along the whole book.
function pcMedia() {
  if (!("mediaSession" in navigator) || !pc.np || !pc.owner) return;
  const np = pc.np;
  const now = pcNow();
  navigator.mediaSession.metadata = new MediaMetadata({
    title: np.title, artist: np.ep ? np.show : np.author, album: np.ep ? np.author : now.sub || np.title,
    artwork: np.item?.cover ? [{ src: new URL(`/api/podcasts/cover?id=${pcEnc(np.id)}&w=600`, location.href).href, sizes: "600x600", type: "image/webp" }] : [],
  });
  pcAction("play", () => pc.audio.play().catch(() => {}));
  pcAction("pause", () => pc.audio.pause());
  pcAction("stop", () => pc.audio.pause());
  pcAction("seekbackward", (d) => pcSkip(-(d.seekOffset || 15)));
  pcAction("seekforward", (d) => pcSkip(d.seekOffset || 30));
  pcAction("seekto", (d) => { if (Number.isFinite(d.seekTime)) pcSeek(d.seekTime); });
  pcAction("previoustrack", null);
  pcAction("nexttrack", null);
  navigator.mediaSession.playbackState = pc.audio.paused ? "paused" : "playing";
  pcPosition();
}

function pcPosition() {
  if (!("mediaSession" in navigator) || !pc.np || !pc.owner || !(pc.np.duration > 0)) return;
  try { navigator.mediaSession.setPositionState({ duration: pc.np.duration, position: Math.min(pcPos(), pc.np.duration), playbackRate: pc.prefs.rate || 1 }); } catch { /* not this browser */ }
}
pc.audio.addEventListener("seeked", pcPosition);
