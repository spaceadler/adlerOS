// Videos: your films, shows and documentaries. Online: Jellyfin's, through
// adlerOS's server (a key pasted once, in Connect; the key never reaches
// the browser): Continue watching, Next up, what's new in each library,
// a show's seasons and episodes, and where you got to, back to Jellyfin
// as you watch (its apps on the TV and your phone see it). Offline: the
// video files in your Media folders (Documentaries, Movies, Shows,
// Videos), played as they are, your place kept by adlerOS.
// Uses $, el, svg, api, toast, showLock, openWindow, closeWindow,
// registerWindow, toggleWindow, sideToggle, fileUrl, openMenu, phoneLayout.
"use strict";

const VD_ICONS = {
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  film: ["M3 5h18v14H3z", "M7 5v14", "M17 5v14", "M3 9h4", "M3 15h4", "M17 9h4", "M17 15h4"],
  tv: ["M3 6h18v12H3z", "M8 21h8"],
  folder: ["M3 6h6l2 2h10v11H3z"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  play: ["M7 4l13 8-13 8z"],
  check: ["M20 6 9 17l-5-5"],
  back: ["M15 18l-6-6 6-6"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
};

const vd = {
  built: false, status: null, home: null, local: null, view: { kind: "home" }, back: [],
  player: null, // { item, queue, at, timer }
};

const vdTime = (s) => {
  if (!Number.isFinite(s) || s <= 0) return "";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
};
const vdOnline = () => vd.status?.source === "jellyfin";

async function vdGet(path) {
  const { status, body } = await api(`/api/videos/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status === 409 && body?.status) { vd.status = body.status; throw new Error(body.error || "Jellyfin isn't connected"); }
  if (status !== 200) throw new Error(body?.error || "Videos can't reach the server right now.");
  return body;
}
async function vdPost(what, body) {
  const { status, body: got } = await api(`/api/videos/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  return got || { ok: false, error: "No answer from the server." };
}

// ------------------------------------------------------------- the window

async function openVideos() {
  vdBuild();
  openWindow("videos");
  await vdLoad();
}
function toggleVideos() { toggleWindow("videos", () => openVideos()); }
function closeVideos() {
  vdStop();
  closeWindow("videos");
}

function vdBuild() {
  if (vd.built) return;
  vd.built = true;
  const close = el("button", { class: "sheet-close mu-close", type: "button", "aria-label": "Close Videos" }, svg(VD_ICONS.close));
  close.addEventListener("click", closeVideos);
  const search = el("input", { class: "field-input mu-search", id: "vd-search", type: "search", placeholder: "Search", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (search.value.trim()) vdShow({ kind: "search", q: search.value.trim() }, true); }, 250);
  });
  const section = el("section", { id: "videos", class: "sheet music-app videos-app", "aria-label": "Videos", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "mu-shell", id: "vd-shell" },
      el("aside", { class: "mu-side", id: "vd-side" }, el("label", { class: "mu-search-box" }, svg(VD_ICONS.search), search),
        el("nav", { class: "mu-side-nav", id: "vd-nav", "aria-label": "Videos" }), el("div", { class: "vd-source", id: "vd-source" })),
      el("main", { class: "mu-main", id: "vd-main", tabindex: "-1" })),
    el("div", { class: "vd-player", id: "vd-player", hidden: "" }));
  document.body.insertBefore(section, $("modal"));
  $("vd-shell").append(sideToggle(section, "videos"));
  registerWindow("videos", { title: "Videos", close: closeVideos, hide: () => closeWindow("videos"), dock: "videos", size: [1180, 760] });
  section.addEventListener("keydown", (e) => { if (e.key === "Escape" && vd.player) { e.stopPropagation(); vdStop(); } }, true);
  $("vd-main").replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, "Opening your videos…")));
}

async function vdLoad() {
  vd.status = await vdGet("status").catch((e) => ({ source: "local", error: e.message }));
  vd.home = null;
  if (vdOnline()) vd.home = await vdGet("home").catch((e) => { toast(e.message); return null; });
  if (!vdOnline() || !vd.home) vd.local = await vdGet("local").then((b) => b.folders).catch(() => []);
  vdSide();
  vdRender();
}

// ------------------------------------------------------------- the side

function vdSide() {
  const nav = $("vd-nav");
  if (!nav) return;
  const item = (view, icon, label) => {
    const on = vd.view.kind === view.kind && (vd.view.id || "") === (view.id || "");
    const b = el("button", { type: "button", class: `mu-nav${on ? " on" : ""}` }, svg(icon), el("span", {}, label));
    b.addEventListener("click", () => vdShow(view));
    return b;
  };
  const libs = vdOnline() && vd.home ? vd.home.libraries.map((l) => item({ kind: "library", id: l.id, name: l.name }, l.kind === "tvshows" ? VD_ICONS.tv : VD_ICONS.film, l.name))
    : (vd.local || []).map((f) => item({ kind: "folder", id: f.path, name: f.name }, VD_ICONS.folder, f.name));
  nav.replaceChildren(item({ kind: "home" }, VD_ICONS.home, "Home"), ...libs);
  const src = el("button", { type: "button", class: "mu-nav vd-source-button" }, svg(VD_ICONS.link),
    el("span", {}, vdOnline() ? `Jellyfin${vd.status.user ? `: ${vd.status.user}` : ""}` : "Connect Jellyfin"));
  src.addEventListener("click", () => vdShow({ kind: "connect" }));
  $("vd-source").replaceChildren(src);
}

function vdShow(view, replace = false) {
  if (!replace) vd.back.push(vd.view);
  if (vd.back.length > 30) vd.back.shift();
  vd.view = view;
  vdSide();
  vdRender();
}
function vdBack() { vd.view = vd.back.pop() || { kind: "home" }; vdSide(); vdRender(); }

async function vdRender() {
  const main = $("vd-main");
  if (!main) return;
  const v = vd.view;
  const page = el("div", { class: "mu-page" });
  main.replaceChildren(page);
  main.scrollTop = 0;
  try {
    if (v.kind === "connect") return vdConnectPage(page);
    if (v.kind === "home") return vdOnline() && vd.home ? vdHomePage(page) : vdLocalHome(page);
    if (v.kind === "folder") return vdFolderPage(page, v);
    if (v.kind === "library") return await vdLibraryPage(page, v);
    if (v.kind === "item") return await vdItemPage(page, v);
    if (v.kind === "search") return await vdSearchPage(page, v);
  } catch (e) {
    if (e.message !== "login") page.replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, e.message)));
  }
}

// ------------------------------------------------------------- the pieces

function vdArt(item, { wide = false } = {}) {
  const box = el("span", { class: `vd-art${wide ? " wide" : ""}` }, el("span", { class: "vd-art-name" }, item.series || item.name));
  const id = item.image ? item.id : item.seriesId;
  if (id && !item.local) {
    const img = el("img", { src: `/api/videos/image?id=${id}&w=${wide ? 600 : 300}`, alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("error", () => img.remove());
    box.append(img);
  }
  const frac = item.runtime && item.pos ? Math.min(1, item.pos / item.runtime) : 0;
  if (frac > 0.01) box.append(el("span", { class: "vd-progress" }, el("span", { style: `width: ${Math.round(frac * 100)}%` })));
  if (item.played) box.append(el("span", { class: "vd-seen", title: "Watched" }, svg(VD_ICONS.check)));
  return box;
}

function vdSub(item) {
  if (item.type === "episode") return [item.series, item.season != null && item.episode != null ? `S${item.season} E${item.episode}` : ""].filter(Boolean).join(" · ");
  if (item.type === "series") return item.unplayed ? `${item.unplayed} to watch` : "Series";
  return [item.year, vdTime(item.runtime)].filter(Boolean).join(" · ");
}

function vdCard(item, { wide = false } = {}) {
  const card = el("div", { class: `mu-card vd-card${wide ? " wide" : ""}`, role: "link", tabindex: "0", title: item.name },
    el("div", { class: "mu-card-art" }, vdArt(item, { wide })),
    el("div", { class: "mu-card-title" }, item.type === "episode" && wide ? item.name : item.series || item.name),
    el("div", { class: "mu-card-sub" }, vdSub(item)));
  const open = () => (item.type === "series" || item.type === "folder" ? vdShow({ kind: "item", id: item.id, item }) : wide ? vdPlay(item) : vdShow({ kind: "item", id: item.id, item }));
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  card.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, vdMenu(item)); });
  return card;
}

function vdMenu(item) {
  const items = [];
  if (item.type !== "series" && item.type !== "folder") {
    items.push({ label: item.pos > 10 ? "Resume" : "Play", run: () => vdPlay(item) });
    if (item.pos > 10) items.push({ label: "Play from the start", run: () => vdPlay(item, { from: 0 }) });
    items.push({ label: item.played ? "Mark as not watched" : "Mark as watched", run: () => vdMark(item, !item.played) });
  }
  items.push({ label: "Details", run: () => vdShow({ kind: "item", id: item.id, item }) });
  return items;
}

function vdShelf(title, items, wide = false) {
  if (!items?.length) return "";
  return el("section", { class: "mu-shelf" }, el("div", { class: "mu-shelf-head" }, el("h2", {}, title)),
    el("div", { class: `mu-shelf-row vd-row${wide ? " wide" : ""}` }, ...items.map((i) => vdCard(i, { wide }))));
}

// ------------------------------------------------------------- pages

function vdHomePage(page) {
  const h = vd.home;
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, "Videos"), el("p", { class: "mu-head-sub" }, "From Jellyfin"))));
  const shelves = [vdShelf("Continue watching", h.resume, true), vdShelf("Next up", h.next, true),
    ...h.latest.map((s) => vdShelf(`New in ${s.library.name}`, s.items))].filter(Boolean);
  page.append(...(shelves.length ? shelves : [el("p", { class: "mu-empty-line" }, "Jellyfin's libraries are empty. Put your videos in their folders, then let Jellyfin scan them.")]));
}

function vdLocalHome(page) {
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, "Videos"),
    el("p", { class: "mu-head-sub" }, vd.status?.error === "unreachable" ? "Jellyfin isn't answering: your files, played from here" : "Your video files, played from here"))));
  const watching = (vd.local || []).flatMap((f) => f.items.flatMap((i) => i.type === "series" ? i.seasons[0].episodes : [i])).filter((i) => i.pos > 10 && !i.played);
  const shelves = [vdShelf("Continue watching", watching, true), ...(vd.local || []).map((f) => vdShelf(f.name, f.items))].filter(Boolean);
  if (shelves.length) return page.append(...shelves);
  page.append(el("div", { class: "mu-empty-line vd-none" },
    el("p", {}, "No videos yet. Put them in Media/Documentaries, Movies, Shows or Videos in your storage (a folder of episodes is a series), or connect Jellyfin.")));
}

function vdFolderPage(page, v) {
  const f = (vd.local || []).find((x) => x.path === v.id);
  if (!f) return page.append(el("p", { class: "mu-empty-line" }, "That folder isn't there any more."));
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, f.name), el("p", { class: "mu-head-sub" }, `${f.items.length} in ${f.path}`))),
    f.items.length ? el("div", { class: "mu-wrap vd-wrap" }, ...f.items.map((i) => vdCard(i))) : el("p", { class: "mu-empty-line" }, "Nothing in it yet."));
}

async function vdLibraryPage(page, v) {
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, v.name || "Library"))), el("p", { class: "mu-empty-line" }, "Opening…"));
  const got = await vdGet(`library?id=${v.id}&sort=${vd.sort || "name"}`);
  if (vd.view !== v) return;
  const sort = el("select", { class: "field-input mu-sort", "aria-label": "Sort" }, ...[["name", "Name"], ["added", "Recently added"], ["year", "Year"]].map(([k, l]) => el("option", { value: k }, l)));
  sort.value = vd.sort || "name";
  sort.addEventListener("change", () => { vd.sort = sort.value; vdRender(); });
  page.replaceChildren(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, v.name || "Library"), el("p", { class: "mu-head-sub" }, `${got.total.toLocaleString()} ${got.total === 1 ? "title" : "titles"}`)),
    el("div", { class: "mu-head-actions" }, sort)),
  got.items.length ? el("div", { class: "mu-wrap vd-wrap" }, ...got.items.map((i) => vdCard(i))) : el("p", { class: "mu-empty-line" }, "Nothing here yet."));
}

async function vdSearchPage(page, v) {
  if (!vdOnline()) {
    const q = v.q.toLowerCase();
    const all = (vd.local || []).flatMap((f) => f.items.flatMap((i) => (i.type === "series" ? [i, ...i.seasons[0].episodes] : [i])));
    const hits = all.filter((i) => i.name.toLowerCase().includes(q));
    return page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, `“${v.q}”`))),
      hits.length ? el("div", { class: "mu-wrap vd-wrap" }, ...hits.map((i) => vdCard(i))) : el("p", { class: "mu-empty-line" }, "Nothing called that."));
  }
  const got = await vdGet(`search?q=${encodeURIComponent(v.q)}`);
  if (vd.view !== v) return;
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, `“${v.q}”`))),
    got.items.length ? el("div", { class: "mu-wrap vd-wrap" }, ...got.items.map((i) => vdCard(i))) : el("p", { class: "mu-empty-line" }, "Nothing called that."));
}

async function vdItemPage(page, v) {
  let item = v.item;
  if (!v.id.startsWith("l:")) {
    page.append(el("p", { class: "mu-empty-line" }, "Opening…"));
    item = await vdGet(`item?id=${v.id}`);
    if (vd.view !== v) return;
    page.replaceChildren();
  }
  if (!item) return page.append(el("p", { class: "mu-empty-line" }, "That isn't there any more."));
  const back = el("button", { type: "button", class: "mu-button secondary vd-back" }, svg(VD_ICONS.back), el("span", {}, "Back"));
  back.addEventListener("click", vdBack);
  const eps = item.seasons ? item.seasons.flatMap((s) => s.episodes) : [];
  const next = eps.find((e) => e.pos > 10 && !e.played) || eps.find((e) => !e.played) || eps[0];
  const actions = [];
  if (item.type === "series") {
    if (next) actions.push(vdButton(next.pos > 10 ? `Resume ${vdEpLabel(next)}` : `Play ${vdEpLabel(next)}`, () => vdPlay(next, { queue: eps })));
  } else if (item.type !== "folder") {
    actions.push(vdButton(item.pos > 10 ? `Resume (${vdClock(item.pos)})` : "Play", () => vdPlay(item)));
    if (item.pos > 10) actions.push(vdButton("From the start", () => vdPlay(item, { from: 0 }), "secondary"));
    actions.push(vdButton(item.played ? "Not watched" : "Watched", async () => { await vdMark(item, !item.played); vdRender(); }, "secondary"));
  }
  page.append(back, el("header", { class: "mu-hero vd-hero" }, vdArt(item),
    el("div", { class: "mu-hero-text" }, el("p", { class: "mu-kicker" }, { movie: "Film", series: "Series", episode: "Episode", folder: "Collection" }[item.type] || "Video"),
      el("h1", {}, item.name), el("p", { class: "mu-head-sub" }, vdSub(item)), el("div", { class: "mu-head-actions" }, ...actions))),
  ...(item.overview ? [el("p", { class: "vd-overview" }, item.overview)] : []));
  for (const s of item.seasons || []) {
    page.append(el("h2", { class: "mu-section" }, s.name), el("div", { class: "vd-episodes" }, ...s.episodes.map((e) => vdEpisodeRow(e, eps))));
  }
  if (item.items?.length) page.append(el("div", { class: "mu-wrap vd-wrap" }, ...item.items.map((i) => vdCard(i))));
}

const vdClock = (s) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const vdEpLabel = (e) => (e.episode != null ? `E${e.episode}` : e.name);

function vdButton(label, run, kind = "primary") {
  const b = el("button", { type: "button", class: `mu-button ${kind}${kind === "primary" ? " fill" : ""}` }, ...(kind === "primary" ? [svg(VD_ICONS.play)] : []), el("span", {}, label));
  b.addEventListener("click", run);
  return b;
}

function vdEpisodeRow(e, queue) {
  const row = el("button", { type: "button", class: `vd-ep${e.played ? " seen" : ""}` }, vdArt(e, { wide: true }),
    el("span", { class: "vd-ep-text" }, el("span", { class: "vd-ep-title" }, `${e.episode != null ? `${e.episode}. ` : ""}${e.name}`),
      el("span", { class: "vd-ep-sub" }, [vdTime(e.runtime), e.played ? "Watched" : e.pos > 10 ? `${vdClock(e.pos)} in` : ""].filter(Boolean).join(" · ")),
      ...(e.overview ? [el("span", { class: "vd-ep-about" }, e.overview)] : [])));
  row.addEventListener("click", () => vdPlay(e, { queue }));
  row.addEventListener("contextmenu", (ev) => { ev.preventDefault(); openMenu(ev.clientX, ev.clientY, vdMenu(e)); });
  return row;
}

async function vdMark(item, played) {
  const got = await vdPost("progress", { id: item.id, pos: 0, dur: item.runtime, done: played });
  if (!got?.ok) return toast(got?.error || "Couldn't mark it.");
  Object.assign(item, { played, pos: 0 });
  toast(played ? "Marked as watched." : "Marked as not watched.");
}

// ------------------------------------------------------------- connect

function vdConnectPage(page) {
  const s = vd.status || {};
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, "Jellyfin"))));
  const box = el("div", { class: "vd-connect" });
  page.append(box);
  if (vdOnline()) {
    const off = el("button", { type: "button", class: "mu-button secondary" }, "Disconnect");
    off.addEventListener("click", async () => {
      const got = await vdPost("connect", { token: "" });
      if (got?.ok) { toast("Disconnected. Videos plays your files now."); await vdLoad(); vdShow({ kind: "home" }, true); }
    });
    box.append(el("p", {}, `Connected${s.user ? ` as ${s.user}` : ""}. What you watch and where you got to are Jellyfin's, so its apps on your TV and phone carry on from the same place.`), off);
    return;
  }
  const why = s.error === "nojellyfin" ? "Jellyfin isn't among your apps here. Install it from the App Store first."
    : s.error === "refused" ? "Jellyfin no longer takes the key you gave. Paste a new one."
      : s.error === "unreachable" ? "Jellyfin isn't answering right now, so Videos plays your files. The key is kept."
        : "Videos can play from Jellyfin: its libraries, what you were watching, and the next episode, the same as its apps on your TV and phone.";
  const input = el("input", { class: "field-input vd-key", type: "password", placeholder: "Jellyfin API key", autocomplete: "off", spellcheck: "false", "aria-label": "Jellyfin API key" });
  const go = el("button", { type: "button", class: "mu-button primary" }, "Connect");
  const run = async () => {
    const token = input.value.trim();
    if (!token) return input.focus();
    go.disabled = true;
    const got = await vdPost("connect", { token });
    go.disabled = false;
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    toast(`Connected${got.user ? ` as ${got.user}` : ""}.`);
    await vdLoad();
    vdShow({ kind: "home" }, true);
  };
  go.addEventListener("click", run);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  box.append(el("p", {}, why), ...(s.error === "nojellyfin" ? [] : [
    el("ol", { class: "vd-steps" }, el("li", {}, "Open Jellyfin, then Dashboard (in its menu)."), el("li", {}, "API Keys, then the + button. Call it adlerOS."), el("li", {}, "Copy the key and paste it here.")),
    el("div", { class: "vd-key-row" }, input, go)]),
  el("p", { class: "vd-dim" }, "Without Jellyfin, Videos plays the files in Media/Documentaries, Movies, Shows and Videos."));
}

// ------------------------------------------------------------- playing

// In the window, over everything; the browser's own controls (full screen,
// picture in picture, the phone's). Where you are goes back every 15 s,
// when you pause, and at the end; then the next episode.
function vdPlay(item, { queue = null, from = null } = {}) {
  vdStop();
  const box = $("vd-player");
  if (!box) return;
  const list = queue && queue.includes(item) ? queue : [item];
  const video = el("video", { class: "vd-video", controls: "", autoplay: "", playsinline: "", preload: "auto" });
  video.src = item.local ? fileUrl(item.local, true) : `/api/videos/stream?id=${item.id}`;
  const start = from ?? (item.pos > 10 && (!item.runtime || item.pos < item.runtime - 30) ? item.pos : 0);
  if (start > 0) video.addEventListener("loadedmetadata", () => { video.currentTime = start; }, { once: true });
  const close = el("button", { type: "button", class: "vd-player-close", "aria-label": "Stop" }, svg(VD_ICONS.close));
  close.addEventListener("click", vdStop);
  const title = el("div", { class: "vd-player-title" }, item.type === "episode" ? `${item.series} · ${vdEpLabel(item)} ${item.name}` : item.name);
  box.replaceChildren(video, el("div", { class: "vd-player-top" }, close, title));
  box.hidden = false;
  vd.player = { item, list, video, timer: setInterval(() => vdSave(false), 15000), sent: -1 };
  video.play().catch(() => {}); // the browser may want a click first (the controls are there)
  video.addEventListener("pause", () => { if (!video.ended) vdSave(false); });
  video.addEventListener("ended", () => {
    vdSave(true);
    const i = list.indexOf(item);
    if (i >= 0 && i < list.length - 1) vdPlay(list[i + 1], { queue: list, from: 0 });
    else vdStop();
  });
  video.addEventListener("error", () => toast("This one won't play here (the browser can't read its format). Jellyfin's own app can."));
}

function vdSave(done) {
  const p = vd.player;
  if (!p) return;
  const pos = Math.floor(p.video.currentTime || 0);
  const dur = Math.floor(p.video.duration || p.item.runtime || 0);
  const finished = done || (dur && pos > dur * 0.95);
  if (!finished && (pos < 5 || pos === p.sent)) return;
  p.sent = pos;
  Object.assign(p.item, { pos: finished ? 0 : pos, played: finished || p.item.played, runtime: p.item.runtime || dur || null });
  vdPost("progress", { id: p.item.id, pos, dur, done: Boolean(finished) });
}

function vdStop() {
  const p = vd.player;
  if (!p) return;
  vdSave(false);
  clearInterval(p.timer);
  p.video.pause();
  p.video.removeAttribute("src");
  p.video.load();
  vd.player = null;
  const box = $("vd-player");
  if (box) { box.hidden = true; box.replaceChildren(); }
  // What you watched shows where you got to.
  if (vdOnline()) vdGet("home").then((h) => { vd.home = h; if (vd.view.kind === "home") vdRender(); }).catch(() => {});
  else vdGet("local").then((b) => { vd.local = b.folders; if (["home", "folder"].includes(vd.view.kind)) vdRender(); }).catch(() => {});
}

window.addEventListener("pagehide", () => { if (vd.player) vdSave(false); });
