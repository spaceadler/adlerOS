// Live TV: the channels in your M3U playlists (an address from your
// provider, a .m3u file in your storage, or iptv-org's free channels by
// country), by group, with favorites and a search; one plays at the top of
// the window, and Up/Down (or Page Up/Down) zap through the list you're in.
// Streams come through adlerOS's server (/api/iptv/via: IPTV is rarely
// HTTPS and never lets another page in); HLS plays natively where the
// browser can, else with hls.js (vendor/hls.js, loaded on the first play).
// Uses $, el, svg, api, toast, showLock, openWindow, closeWindow,
// registerWindow, toggleWindow, sideToggle.
"use strict";

const LT_ICONS = {
  tv: ["M3 6h18v12H3z", "M8 21h8", "M12 18v3"],
  star: ["M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  plus: ["M12 5v14", "M5 12h14"],
};
const LT_PAGE = 240; // channels drawn at a time
// iptv-org's free, legal channels, one playlist per country.
const LT_FREE = "https://iptv-org.github.io/iptv/countries/";

const iptv = { built: false, channels: [], errors: [], favorites: new Set(), playlists: [], view: { kind: "all" }, q: "", shown: LT_PAGE,
  playing: null, hls: null, hlsLoading: null };

async function ltGet(path) {
  const { status, body } = await api(`/api/iptv/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status !== 200) throw new Error(body?.error || "Live TV can't reach the server right now.");
  return body;
}
async function ltPost(what, body) {
  const { status, body: got } = await api(`/api/iptv/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  return got || { ok: false, error: "No answer from the server." };
}

// ------------------------------------------------------------- the window

async function openIptv() {
  ltBuild();
  openWindow("iptv");
  await ltLoad();
}
function toggleIptv() { toggleWindow("iptv", () => openIptv()); }
function closeIptv() {
  ltStop();
  closeWindow("iptv");
}

function ltBuild() {
  if (iptv.built) return;
  iptv.built = true;
  const close = el("button", { class: "sheet-close mu-close", type: "button", "aria-label": "Close Live TV" }, svg(LT_ICONS.close));
  close.addEventListener("click", closeIptv);
  const search = el("input", { class: "field-input mu-search", id: "lt-search", type: "search", placeholder: "Search channels", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { iptv.q = search.value.trim().toLowerCase(); iptv.shown = LT_PAGE; ltRender(); }, 200);
  });
  const section = el("section", { id: "iptv", class: "sheet music-app iptv-app", "aria-label": "Live TV", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "mu-shell", id: "lt-shell" },
      el("aside", { class: "mu-side", id: "lt-side" }, el("label", { class: "mu-search-box" }, svg(LT_ICONS.search), search),
        el("nav", { class: "mu-side-nav lt-groups", id: "lt-nav", "aria-label": "Groups" }), el("div", { class: "vd-source", id: "lt-source" })),
      el("main", { class: "mu-main lt-main", id: "lt-main", tabindex: "-1" },
        el("div", { class: "mu-page lt-page" }, el("div", { class: "lt-stage", id: "lt-stage", hidden: "" }), el("div", { id: "lt-list" })))));
  document.body.insertBefore(section, $("modal"));
  $("lt-shell").append(sideToggle(section, "iptv"));
  registerWindow("iptv", { title: "Live TV", close: closeIptv, hide: () => closeWindow("iptv"), dock: "iptv", size: [1180, 760] });
  section.addEventListener("keydown", ltKeys);
  $("lt-list").replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, "Tuning in…")));
}

async function ltLoad(again = false) {
  try {
    const st = await ltGet("settings");
    iptv.playlists = st.playlists;
    iptv.favorites = new Set(st.favorites);
    if (!iptv.playlists.length) {
      iptv.view = { kind: "playlists", auto: true }; // nothing to watch yet: where to add some
    } else {
      if (iptv.view.auto) iptv.view = { kind: "all" };
      $("lt-list")?.replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, "Reading your playlists…")));
      const got = await ltGet(`channels${again ? "?again=1" : ""}`);
      iptv.channels = got.channels;
      iptv.errors = got.errors;
    }
    iptv.at = Date.now(); // when it was read: the TV's and car's Live TV read it again after a while
  } catch (e) {
    iptv.errors = [e.message];
  }
  ltSide();
  ltRender();
}

// What the TV's and car's Live TV need (bigui.js): the playlists, the
// channels and the favorites, read again after ten minutes. ltLoad draws
// only what's there, so no window is needed for it.
async function ltReady() {
  if (!iptv.at || Date.now() - iptv.at > 600000) await ltLoad();
}

// ------------------------------------------------------------- the side

function ltGroups() {
  const counts = new Map();
  for (const c of iptv.channels) counts.set(c.group, (counts.get(c.group) || 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

function ltSide() {
  const nav = $("lt-nav");
  if (!nav) return;
  const item = (view, icon, label, count) => {
    const on = iptv.view.kind === view.kind && (iptv.view.group || "") === (view.group || "");
    const b = el("button", { type: "button", class: `mu-nav${on ? " on" : ""}` }, svg(icon), el("span", {}, label),
      count != null ? el("small", { class: "lt-count" }, String(count)) : "");
    b.addEventListener("click", () => ltShow(view));
    return b;
  };
  nav.replaceChildren(item({ kind: "all" }, LT_ICONS.tv, "All channels", iptv.channels.length),
    item({ kind: "favorites" }, LT_ICONS.star, "Favorites", iptv.favorites.size),
    ...ltGroups().map(([g, n]) => item({ kind: "group", group: g }, LT_ICONS.list, g, n)));
  const set = el("button", { type: "button", class: `mu-nav vd-source-button${iptv.view.kind === "playlists" ? " on" : ""}` }, svg(LT_ICONS.gear), el("span", {}, "Playlists"));
  set.addEventListener("click", () => ltShow({ kind: "playlists" }));
  $("lt-source").replaceChildren(set);
}

function ltShow(view) {
  iptv.view = view;
  iptv.shown = LT_PAGE;
  ltSide();
  ltRender();
}

// What the list shows now: the view, then the search.
function ltVisible() {
  const v = iptv.view;
  let list = v.kind === "favorites" ? iptv.channels.filter((c) => iptv.favorites.has(c.id))
    : v.kind === "group" ? iptv.channels.filter((c) => c.group === v.group) : iptv.channels;
  if (iptv.q) list = list.filter((c) => c.name.toLowerCase().includes(iptv.q) || c.group.toLowerCase().includes(iptv.q));
  return list;
}

function ltRender() {
  const box = $("lt-list");
  if (!box) return;
  if (iptv.view.kind === "playlists") return ltPlaylistsPage(box);
  const list = ltVisible();
  const title = iptv.view.kind === "favorites" ? "Favorites" : iptv.view.kind === "group" ? iptv.view.group : "All channels";
  const errors = iptv.errors.map((e) => el("p", { class: "ga-note" }, `Couldn't read ${e}`));
  if (!list.length) {
    box.replaceChildren(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, title))), ...errors,
      el("p", { class: "vd-dim" }, iptv.q ? "No channel by that name." : iptv.view.kind === "favorites" ? "None yet: the star on a channel keeps it here." : "No channels."));
    return;
  }
  const tiles = list.slice(0, iptv.shown).map((c) => ltTile(c, list));
  const more = list.length > iptv.shown ? el("button", { type: "button", class: "mu-button secondary lt-more" }, `Show more (${list.length - iptv.shown})`) : "";
  if (more) more.addEventListener("click", () => { iptv.shown += LT_PAGE * 2; ltRender(); });
  box.replaceChildren(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, title), el("p", { class: "vd-dim" }, `${list.length.toLocaleString()} channel${list.length === 1 ? "" : "s"}`))),
    ...errors, el("div", { class: "lt-grid" }, ...tiles), more);
}

function ltTile(c, list) {
  const logo = c.logo ? el("img", { src: c.logo, alt: "", loading: "lazy", decoding: "async" }) : el("span", { class: "lt-initial" }, c.name.slice(0, 2));
  if (c.logo) logo.addEventListener("error", () => logo.replaceWith(el("span", { class: "lt-initial" }, c.name.slice(0, 2))));
  const fav = iptv.favorites.has(c.id);
  const star = el("button", { type: "button", class: `lt-fav${fav ? " on" : ""}`, "aria-label": fav ? `Unfavorite ${c.name}` : `Favorite ${c.name}`, "aria-pressed": String(fav) }, svg(LT_ICONS.star));
  star.addEventListener("click", async (e) => {
    e.stopPropagation();
    const on = !iptv.favorites.has(c.id);
    const got = await ltPost("favorite", { id: c.id, on });
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    iptv.favorites = new Set(got.favorites);
    ltSide();
    ltRender();
  });
  const playing = iptv.playing?.c.id === c.id;
  const tile = el("div", { class: `lt-tile${playing ? " on" : ""}`, role: "button", tabindex: "0", "data-id": c.id, "aria-label": c.name },
    el("span", { class: "lt-logo" }, logo), el("span", { class: "lt-name" }, c.name), star);
  tile.addEventListener("click", () => ltPlay(c, list));
  tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ltPlay(c, list); } });
  return tile;
}

// ------------------------------------------------------------- playing

function ltHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  iptv.hlsLoading ||= new Promise((resolve, reject) => {
    const s = el("script", { src: "/static/vendor/hls.js" });
    s.addEventListener("load", () => resolve(window.Hls));
    s.addEventListener("error", () => { iptv.hlsLoading = null; reject(new Error("couldn't load the player")); });
    document.head.append(s);
  });
  return iptv.hlsLoading;
}

const LT_WONT = "the stream isn't one a browser can play (an MPEG-TS stream, say: a TV app or VLC plays those)";

// A channel into a <video>: natively where the browser plays HLS (Safari),
// else with hls.js. `fail(why)` hears why it won't play; `still()` says
// whether it's still wanted (another channel may have been picked while
// hls.js loaded). Resolves with the hls.js player, to destroy when done, or
// null. The window and the TV's and car's Live TV (bigui.js) both use it.
async function ltTune(video, c, fail, still) {
  video.addEventListener("error", () => fail(LT_WONT));
  if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = c.play; return null; }
  let Hls;
  try {
    Hls = await ltHls();
  } catch (e) {
    fail(e.message);
    return null;
  }
  if (!still()) return null;
  if (!Hls?.isSupported()) { video.src = c.play; return null; }
  const hls = new Hls({ enableWorker: false, lowLatencyMode: false, backBufferLength: 30 });
  hls.on(Hls.Events.ERROR, (_, d) => {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
    fail(d.type === Hls.ErrorTypes.NETWORK_ERROR ? "its stream didn't answer (offline, or only for some countries)" : LT_WONT);
    hls.destroy();
  });
  hls.loadSource(c.play);
  hls.attachMedia(video);
  return hls;
}

async function ltPlay(c, list = ltVisible()) {
  ltStop(false);
  if (typeof bigLiveClose === "function") bigLiveClose(); // one channel at a time
  const stage = $("lt-stage");
  const video = el("video", { class: "lt-video", controls: "", autoplay: "", playsinline: "" });
  const say = el("p", { class: "lt-say" }, `Tuning in to ${c.name}…`);
  const x = el("button", { type: "button", class: "lt-close", "aria-label": "Stop" }, svg(LT_ICONS.close));
  x.addEventListener("click", () => ltStop());
  stage.replaceChildren(video, el("div", { class: "lt-now" }, el("strong", {}, c.name), el("span", { class: "vd-dim" }, c.group)), say, x);
  stage.hidden = false;
  iptv.playing = { c, list };
  document.querySelectorAll("#lt-list .lt-tile.on").forEach((t) => t.classList.remove("on"));
  document.querySelector(`#lt-list .lt-tile[data-id="${c.id}"]`)?.classList.add("on");
  $("lt-main").scrollTo({ top: 0, behavior: "smooth" });
  const fail = (why) => { if (iptv.playing?.c === c) say.textContent = `${c.name} won't play here: ${why}.`; };
  const tuned = () => { if (video.currentTime > 0 || video.readyState >= 3) say.textContent = ""; };
  for (const ev of ["playing", "timeupdate", "canplay"]) video.addEventListener(ev, tuned);
  const hls = await ltTune(video, c, fail, () => iptv.playing?.c === c);
  if (iptv.playing?.c === c) iptv.hls = hls;
  else hls?.destroy();
}

function ltStop(all = true) {
  iptv.hls?.destroy();
  iptv.hls = null;
  const stage = $("lt-stage");
  const v = stage?.querySelector("video");
  if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  if (all && stage) { stage.hidden = true; stage.replaceChildren(); iptv.playing = null;
    document.querySelectorAll("#lt-list .lt-tile.on").forEach((t) => t.classList.remove("on")); }
}

// Up/Down (Page Up/Down on a remote) while one plays: the next channel in
// the list it came from.
function ltKeys(e) {
  if (e.key === "Escape" && iptv.playing) { e.stopPropagation(); return ltStop(); }
  if (!iptv.playing || e.target.matches("input, textarea, select")) return;
  const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (!step || !e.target.closest("#lt-stage, .lt-video") && e.key.startsWith("Arrow")) return;
  e.preventDefault();
  const { c, list } = iptv.playing;
  const i = list.findIndex((x) => x.id === c.id);
  const next = list[(i + step + list.length) % list.length];
  if (next) ltPlay(next, list);
}

// ------------------------------------------------------------- playlists

function ltPlaylistsPage(box) {
  const rows = iptv.playlists.map((p) => ({ ...p }));
  const listBox = el("div", { class: "lt-playlists" });
  const draw = () => listBox.replaceChildren(...(rows.length ? rows.map((p, i) => {
    const x = el("button", { type: "button", class: "ct-x", "aria-label": `Remove ${p.name || p.url}` }, svg(LT_ICONS.close));
    x.addEventListener("click", () => { rows.splice(i, 1); draw(); });
    return el("div", { class: "ct-field" }, el("span", { class: "ct-label" }, p.name || "Playlist"), el("span", { class: "lt-url" }, p.url), x);
  }) : [el("p", { class: "vd-dim" }, "No playlists yet.")]));
  draw();
  const name = el("input", { class: "field-input", type: "text", placeholder: "Name (optional)", maxlength: "60" });
  const url = el("input", { class: "field-input", type: "text", inputmode: "url", placeholder: "https://… .m3u, or /user/… .m3u in your storage", spellcheck: "false", autocapitalize: "off" });
  const add = el("button", { type: "button", class: "mu-button secondary" }, svg(LT_ICONS.plus), "Add");
  add.addEventListener("click", () => {
    if (!url.value.trim()) return url.focus();
    rows.push({ name: name.value.trim(), url: url.value.trim() });
    name.value = url.value = "";
    draw();
  });
  const country = el("input", { class: "field-input lt-cc", type: "text", maxlength: "2", placeholder: "jo", "aria-label": "Country code (two letters)" });
  const free = el("button", { type: "button", class: "mu-button secondary" }, "Add free channels");
  free.addEventListener("click", () => {
    const cc = country.value.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(cc)) return toast("A country's two letters: jo, de, us…");
    rows.push({ name: `Free (${cc.toUpperCase()})`, url: `${LT_FREE}${cc}.m3u` });
    draw();
  });
  const save = el("button", { type: "button", class: "mu-button primary" }, "Save and load");
  save.addEventListener("click", async () => {
    save.disabled = true;
    const got = await ltPost("playlists", { playlists: rows });
    save.disabled = false;
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    toast(`${got.count.toLocaleString()} channels.`);
    iptv.view = { kind: "all" };
    await ltLoad();
  });
  box.replaceChildren(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, "Playlists"))),
    el("div", { class: "vd-connect" },
      el("p", {}, "Live TV plays the channels in M3U playlists: the address your IPTV provider gives you (an M3U or M3U8 link, with your login in it), or a .m3u file in your storage. They're kept on this server."),
      listBox,
      el("div", { class: "ct-add" }, name, url, add),
      el("p", { class: "vd-dim" }, "Or iptv-org's free, legal channels for a country (its two letters):"),
      el("div", { class: "ct-add" }, country, free),
      el("div", { class: "ct-add-row" }, save),
      el("p", { class: "vd-dim" }, "Channels play in the browser when they're HLS (.m3u8), as most are. For a provider that sends MPEG-TS (.ts), ask it for the m3u8 kind of link. There's also an IPTV app in the App Store, with a TV guide.")));
}
