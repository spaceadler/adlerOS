// Music: your songs (MUSIC_DIR in your storage), by song, album, artist and
// playlist (its .m3u8 files), with radio made from your own library (songs
// your playlists put together, the same artists, genre and years), a queue
// (play next, add to queue), shuffle and repeat, and lyrics that follow the
// song (an .lrc beside it, or its own). Closing the window stops it; put
// away (another window over it, minimized) it keeps playing. A song or an
// .m3u8 opened from My Computer plays here. The keyboard's media keys work
// (the Media Session API), and the mouse's side buttons go back and forward.
// Uses el, svg, $, api, toast, openMenu, nameDialog, confirmDialog, fileUrl,
// openFiles, registerWindow, registerNav and winLoad/winSave.
"use strict";

const MUSIC_KEY = "adleros.music";
const muCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const MU_ICONS = {
  play: ["M7 4.5v15l12.5-7.5z"], pause: ["M8 5v14", "M16 5v14"], next: ["M5 5.5v13l9.5-6.5z", "M18.5 5v14"],
  prev: ["M19 5.5v13L9.5 12z", "M5.5 5v14"],
  shuffle: ["M16 3h5v5", "M4 20 21 3", "M21 16v5h-5", "m15 15 6 6", "m4 4 5 5"],
  repeat: ["m17 2 4 4-4 4", "M3 11V10a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"],
  volume: ["M11 5 6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  muted: ["M11 5 6 9H2v6h4l5 4z", "m22 9-6 6", "m16 9 6 6"],
  queue: ["M3 6h13", "M3 12h13", "M3 18h8", "M18 14v7", "M14.5 17.5h7"],
  lyrics: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", "M8 9h8", "M8 13h5"],
  home: ["M3 10.5 12 3l9 7.5", "M5 9v11h14V9"],
  radio: ["M12 12h.01", "M16.2 7.8a6 6 0 0 1 0 8.4", "M7.8 16.2a6 6 0 0 1 0-8.4", "M19.1 4.9a10 10 0 0 1 0 14.2", "M4.9 19.1a10 10 0 0 1 0-14.2"],
  songs: ["M9 18V5l12-2v13", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  albums: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  artists: ["M20 21a8 8 0 0 0-16 0", "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z"],
  playlists: ["M21 15V6", "M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M12 12H3", "M16 6H3", "M12 18H3"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"], plus: ["M12 5v14", "M5 12h14"], close: ["M18 6 6 18", "m6 6 12 12"],
};

const music = {
  built: false, loaded: false, loading: null, scanTimer: null,
  dir: null, found: true,
  songs: new Map(), // id → song (the library's; an id is its path in MUSIC_DIR)
  extra: new Map(), // songs from elsewhere (/user/…), played from My Computer or a playlist
  all: [], albums: new Map(), artists: new Map(), playlists: [], inLists: new Map(),
  plays: { counts: {}, recent: [] },
  view: { kind: "home" }, back: [], fwd: [],
  sort: {}, selected: null, vdraw: null, menuAt: { x: 200, y: 200 },
  queue: [], at: -1, addedUntil: -1, original: null, from: "", radio: null,
  shuffle: false, repeat: "off", counted: false, errors: 0,
  panel: null, lyrics: null, lyricsScrolled: 0, seeking: false,
  audio: new Audio(),
};
music.audio.preload = "auto";

const muSong = (id) => music.songs.get(id) || music.extra.get(id);
const muNorm = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const muArtists = (s) => (s?.artists?.length ? s.artists.join(", ") : "Unknown artist");
const muCurrent = () => (music.at >= 0 ? music.queue[music.at] : null);
const muUrl = (id) => fileUrl(id.startsWith("/") ? id : `${music.dir}/${id}`, true);
const muCover = (id) => `/api/music/cover?id=${encodeURIComponent(id)}&v=${muSong(id)?.added || 0}`;

function muTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "–:––";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

function muLength(ids) {
  const total = ids.reduce((n, id) => n + (muSong(id)?.duration || 0), 0);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

const muCount = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function muShuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------ the library

async function musicLoad() {
  if (music.loading) return music.loading;
  music.loading = (async () => {
    const { status, body } = await api("/api/music/library").catch(() => ({ status: 0 }));
    if (status === 401) return showLock();
    if (status !== 200) {
      musicMessage(body?.error || "Can't reach your music right now.");
      return;
    }
    if (body.scanning && !body.songs) {
      // The first look round: how far it's got, then again.
      musicMessage(`Looking through your music… ${body.total ? `${body.done.toLocaleString()} of ${body.total.toLocaleString()} songs` : ""}`);
      clearTimeout(music.scanTimer);
      music.scanTimer = setTimeout(() => { music.loading = null; musicLoad(); }, 1500);
      return;
    }
    musicIndex(body);
    const first = !music.loaded;
    music.loaded = true;
    if (first) musicRestore();
    musicRenderSide();
    musicRender();
  })();
  try { await music.loading; } finally { music.loading = null; }
}

function musicIndex(body) {
  music.dir = body.dir;
  music.found = body.found !== false;
  music.songs = new Map(body.songs.map((s) => [s.id, s]));
  music.all = body.songs;
  music.plays = { counts: body.plays?.counts || {}, recent: body.plays?.recent || [] };
  music.albums = new Map();
  music.artists = new Map();
  const artist = (name) => {
    const key = muNorm(name);
    if (!music.artists.has(key)) music.artists.set(key, { key, name, ids: [], albums: new Set() });
    return music.artists.get(key);
  };
  for (const s of body.songs) {
    s.key = muNorm(`${s.title} ${s.artists.join(" ")} ${s.album}`);
    const by = s.albumArtist || s.artists[0] || "";
    if (s.album) {
      const key = `${muNorm(by)}\u0001${muNorm(s.album)}`;
      let album = music.albums.get(key);
      if (!album) music.albums.set(key, album = { key, title: s.album, artist: by, year: s.year, ids: [], cover: null, added: 0 });
      album.ids.push(s.id);
      album.added = Math.max(album.added, s.added);
      if (!album.cover && s.cover) album.cover = s.id;
      if (!album.year && s.year) album.year = s.year;
      if (by) artist(by).albums.add(key);
    }
    for (const name of s.artists) artist(name).ids.push(s.id);
  }
  for (const album of music.albums.values()) {
    album.ids.sort((a, b) => {
      const x = music.songs.get(a);
      const y = music.songs.get(b);
      return (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999) || muCollator.compare(x.title, y.title);
    });
  }
  music.playlists = (body.playlists || []).sort((a, b) => muCollator.compare(a.name, b.name));
  music.inLists = new Map();
  music.playlists.forEach((p, i) => {
    for (const id of p.items) {
      if (!music.inLists.has(id)) music.inLists.set(id, []);
      music.inLists.get(id).push(i);
    }
  });
}

function musicMessage(text) {
  if (!music.built) return;
  $("mu-main").replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, text)));
}

// ------------------------------------------------------------- the window

async function openMusic() {
  musicBuild();
  openWindow("music");
  if (!music.loaded) await musicLoad();
  else musicLoad(); // anything new since
}

function toggleMusic() { toggleWindow("music", () => openMusic()); }

// Closing it stops it; putting it away (another window over it) doesn't.
function closeMusic() {
  music.audio.pause();
  musicSave();
  closeWindow("music");
}

function musicBuild() {
  if (music.built) return;
  music.built = true;
  const close = el("button", { class: "sheet-close mu-close", type: "button", "aria-label": "Close Music" }, svg(MU_ICONS.close));
  close.addEventListener("click", closeMusic);
  const section = el("section", { id: "music", class: "sheet music-app", "aria-label": "Music", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "mu-shell", id: "mu-shell" },
      el("aside", { class: "mu-side", id: "mu-side" }, musicSearchBox(), el("nav", { class: "mu-side-nav", id: "mu-side-nav", "aria-label": "Music" })),
      el("main", { class: "mu-main", id: "mu-main", tabindex: "-1" }),
      el("aside", { class: "mu-panel", id: "mu-panel" }),
      musicBar()));
  document.body.insertBefore(section, $("modal"));
  registerWindow("music", { title: "Music", close: closeMusic, hide: () => closeWindow("music"), dock: "music", size: [1180, 760] });
  $("mu-main").addEventListener("scroll", () => music.vdraw?.(), { passive: true });
  new ResizeObserver(() => music.vdraw?.(true)).observe($("mu-main"));
  section.addEventListener("keydown", musicKeys);
  for (const type of ["contextmenu", "click"]) section.addEventListener(type, (e) => { if (e.clientX || e.clientY) music.menuAt = { x: e.clientX, y: e.clientY }; }, true);
  musicRenderSide();
  musicMessage("Opening your music…");
  musicBarUpdate();
}

function musicKeys(e) {
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("mu-search")?.focus();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " " && !e.target.closest("button")) { e.preventDefault(); musicToggle(); }
}

// ------------------------------------------------------------- the side

// The search box, once (typing in it shouldn't lose it).
function musicSearchBox() {
  const search = el("input", { class: "field-input mu-search", id: "mu-search", type: "search", placeholder: "Search", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const query = search.value;
      if (query.trim()) musicShow({ kind: "search", query }, music.view.kind !== "search");
      else if (music.view.kind === "search") musicNav(-1);
    }, 140);
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; search.dispatchEvent(new Event("input")); } });
  return el("label", { class: "mu-search-box" }, svg(MU_ICONS.search), search);
}

function musicRenderSide() {
  const side = $("mu-side-nav");
  if (!side) return;
  const item = (kind, label, icon) => {
    const on = music.view.kind === kind || (kind === "albums" && music.view.kind === "album") || (kind === "artists" && music.view.kind === "artist");
    const b = el("button", { type: "button", class: `mu-nav${on ? " on" : ""}` }, svg(MU_ICONS[icon]), el("span", {}, label));
    b.addEventListener("click", () => musicShow({ kind }));
    return b;
  };
  const lists = music.playlists.map((p) => {
    const b = el("button", { type: "button", class: `mu-nav mu-nav-list${music.view.kind === "playlist" && music.view.key === p.id ? " on" : ""}`, title: p.name }, el("span", {}, p.name));
    b.addEventListener("click", () => musicShow({ kind: "playlist", key: p.id }));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, musicListMenu(p)); });
    musicDropOn(b, p);
    return b;
  });
  const add = el("button", { type: "button", class: "mu-nav mu-nav-new" }, svg(MU_ICONS.plus), el("span", {}, "New playlist"));
  add.addEventListener("click", () => musicNewList());
  side.replaceChildren(
    item("home", "Home", "home"), item("radio", "Radio", "radio"),
    el("h3", { class: "mu-side-title" }, "Library"),
    item("songs", "Songs", "songs"), item("albums", "Albums", "albums"), item("artists", "Artists", "artists"), item("playlists", "Playlists", "playlists"),
    el("h3", { class: "mu-side-title" }, "Playlists"), ...lists, add);
}

// ------------------------------------------------------- moving around

// view: {kind: home | radio | songs | albums | artists | playlists |
// album | artist | playlist | search, key}. Back and forward: the mouse's
// side buttons.
function musicShow(view, push = true) {
  if (push && (view.kind !== music.view.kind || view.key !== music.view.key)) {
    music.back = [...music.back, { ...music.view, scroll: $("mu-main").scrollTop }].slice(-50);
    music.fwd = [];
  }
  music.view = { ...view };
  musicRender();
  musicRenderSide();
}

function musicNav(dir) {
  const to = (dir < 0 ? music.back : music.fwd).pop();
  if (!to) return;
  (dir < 0 ? music.fwd : music.back).push({ ...music.view, scroll: $("mu-main").scrollTop });
  music.view = to;
  $("mu-search").value = to.kind === "search" ? to.query || "" : "";
  musicRender();
  musicRenderSide();
  $("mu-main").scrollTop = to.scroll || 0;
  music.vdraw?.();
}
registerNav("music", (dir) => musicNav(dir));

function musicRender() {
  const main = $("mu-main");
  if (!main || !music.loaded) return;
  music.vdraw = null;
  if (!music.found) {
    return main.replaceChildren(el("div", { class: "mu-empty" }, el("h2", {}, "No music folder"),
      el("p", {}, `adlerOS looks for your music in ${music.dir} (MUSIC_DIR in the settings file, in your storage).`)));
  }
  const v = music.view;
  const page = v.kind === "songs" ? musicSongsView()
    : v.kind === "albums" ? musicAlbumsView()
      : v.kind === "artists" ? musicArtistsView()
        : v.kind === "playlists" ? musicPlaylistsView()
          : v.kind === "radio" ? musicRadioView()
            : v.kind === "album" ? musicAlbumView(music.albums.get(v.key))
              : v.kind === "artist" ? musicArtistView(music.artists.get(v.key))
                : v.kind === "playlist" ? musicPlaylistView(music.playlists.find((p) => p.id === v.key))
                  : v.kind === "search" ? musicSearchView()
                    : musicHomeView();
  main.replaceChildren(page);
  main.scrollTop = 0;
  music.vdraw?.();
  musicMarkPlaying();
}

const musicGo = (kind, key) => musicShow({ kind, key });
const musicAlbumKey = (s) => (s?.album ? `${muNorm(s.albumArtist || s.artists[0] || "")}\u0001${muNorm(s.album)}` : null);

// --------------------------------------------------------- the pieces

function musicArt(id, { round = false } = {}) {
  const s = id ? muSong(id) : null;
  const box = el("span", { class: `mu-art${round ? " round" : ""}` });
  if (s?.cover) {
    const img = el("img", { src: muCover(id), alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("error", () => img.remove());
    box.append(img);
  } else box.append(svg(MU_ICONS.songs));
  return box;
}

function musicButton(label, icon, run, kind = "secondary") {
  const b = el("button", { type: "button", class: `mu-button ${kind}${icon === "play" ? " fill" : ""}` }, ...(icon ? [svg(MU_ICONS[icon])] : []), el("span", {}, label));
  b.addEventListener("click", run);
  return b;
}

function musicIconButton(label, icon, run, extra = "") {
  const b = el("button", { type: "button", class: `mu-icon ${extra}`, title: label, "aria-label": label }, svg(MU_ICONS[icon]));
  b.addEventListener("click", run);
  return b;
}

function musicHead(title, sub, ...buttons) {
  return el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, title), sub ? el("p", { class: "mu-head-sub" }, sub) : ""),
    el("div", { class: "mu-head-actions" }, ...buttons));
}

function musicPlayButtons(ids, from, radio) {
  return [
    musicButton("Play", "play", () => musicPlayList(ids, 0, { from, shuffle: false }), "primary"),
    musicButton("Shuffle", "shuffle", () => musicPlayList(ids, -1, { from, shuffle: true })),
    ...(radio ? [musicButton("Radio", "radio", () => musicRadio(radio))] : []),
  ];
}

// A card: an album, an artist, a playlist, a station.
function musicCard({ art, title, sub, open, play, menu, round = false, label }) {
  const playButton = play ? el("button", { type: "button", class: "mu-card-play", "aria-label": `Play ${title}` }, svg(MU_ICONS.play)) : null;
  playButton?.addEventListener("click", (e) => { e.stopPropagation(); play(); });
  const card = el("div", { class: `mu-card${round ? " round" : ""}`, role: "link", tabindex: "0", title: label || title },
    el("div", { class: "mu-card-art" }, art, ...(playButton ? [playButton] : [])),
    el("div", { class: "mu-card-title" }, title), sub ? el("div", { class: "mu-card-sub" }, sub) : "");
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  if (menu) card.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, menu()); });
  return card;
}

function musicAlbumCard(album) {
  return musicCard({
    art: musicArt(album.cover), title: album.title, sub: album.artist || "Unknown artist",
    open: () => musicGo("album", album.key), play: () => musicPlayList(album.ids, 0, { from: album.title, shuffle: false }),
    menu: () => musicIdsMenu(album.ids, { from: album.title, album }),
  });
}

function musicArtistCard(a) {
  const cover = a.ids.find((id) => muSong(id)?.cover);
  return musicCard({
    art: musicArt(cover, { round: true }), title: a.name, sub: muCount(a.ids.length, "song"), round: true,
    open: () => musicGo("artist", a.key), play: () => musicPlayList(a.ids, -1, { from: a.name, shuffle: true }),
    menu: () => musicIdsMenu(a.ids, { from: a.name, artist: a }),
  });
}

function musicListArt(p) {
  const covers = [...new Set(p.items.filter((id) => muSong(id)?.cover).map((id) => musicAlbumKey(muSong(id)) || id))]
    .slice(0, 4).map((key) => (music.albums.get(key)?.cover || key));
  if (covers.length < 4) return musicArt(covers[0]);
  return el("span", { class: "mu-art mu-collage" }, ...covers.map((id) => musicArt(id)));
}

function musicListCard(p) {
  return musicCard({
    art: musicListArt(p), title: p.name, sub: muCount(p.items.length, "song"),
    open: () => musicGo("playlist", p.id), play: () => musicPlayList(p.items, 0, { from: p.name, shuffle: false }), menu: () => musicListMenu(p),
  });
}

function musicShelf(title, cards, more = null) {
  if (!cards.length) return "";
  const head = el("div", { class: "mu-shelf-head" }, el("h2", {}, title));
  if (more) {
    const b = el("button", { type: "button", class: "mu-link" }, "See all");
    b.addEventListener("click", more);
    head.append(b);
  }
  return el("section", { class: "mu-shelf" }, head, el("div", { class: "mu-shelf-row" }, ...cards));
}

// A list of songs that only draws the rows in view: thousands of them stay quick.
function musicVirtual(box, { count, height, render }) {
  const main = $("mu-main");
  box.style.height = `${count * height}px`;
  const rows = new Map();
  const draw = (fresh = false) => {
    if (!box.isConnected) return;
    if (fresh) { for (const n of rows.values()) n.remove(); rows.clear(); }
    const top = main.scrollTop - (box.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop);
    const first = Math.max(0, Math.floor(top / height) - 8);
    const last = Math.min(count - 1, Math.ceil((top + main.clientHeight) / height) + 8);
    for (const [i, n] of rows) if (i < first || i > last) { n.remove(); rows.delete(i); }
    for (let i = first; i <= last; i++) {
      if (rows.has(i)) continue;
      const n = render(i);
      n.style.top = `${i * height}px`;
      box.append(n);
      rows.set(i, n);
    }
    musicMarkPlaying(box);
  };
  return draw;
}

// ---------------------------------------------------------- the songs

const MU_SORTS = { title: "Title", artist: "Artist", album: "Album", added: "Recently added", plays: "Most played", time: "Time" };

function musicSorted(ids, by) {
  const get = (id) => muSong(id);
  const plays = music.plays.counts;
  const sorter = {
    title: (a, b) => muCollator.compare(get(a).title, get(b).title),
    artist: (a, b) => muCollator.compare(muArtists(get(a)), muArtists(get(b))) || muCollator.compare(get(a).album, get(b).album)
      || (get(a).track || 0) - (get(b).track || 0),
    album: (a, b) => muCollator.compare(get(a).album, get(b).album) || (get(a).disc || 1) - (get(b).disc || 1) || (get(a).track || 0) - (get(b).track || 0),
    added: (a, b) => get(b).added - get(a).added,
    plays: (a, b) => (plays[b] || 0) - (plays[a] || 0) || muCollator.compare(get(a).title, get(b).title),
    time: (a, b) => (get(a).duration || 0) - (get(b).duration || 0),
  }[by];
  return sorter ? [...ids].sort(sorter) : [...ids];
}

// A table of songs: a click picks one, a double click (or Enter, or a tap)
// plays from it; right-click for the rest. ctx: {ids, from, playlist, number}.
function musicTable(ctx) {
  const { ids } = ctx;
  const head = el("div", { class: "mu-thead", role: "row" }, el("span", {}, ctx.number ? "#" : ""), el("span", {}, "Title"),
    el("span", { class: "mu-col-artist" }, "Artist"), el("span", { class: "mu-col-album" }, "Album"), el("span", { class: "mu-col-time" }, "Time"));
  const box = el("div", { class: "mu-tbody", role: "rowgroup" });
  const row = (i) => musicRow(ids[i], i, ctx);
  if (ids.length > 300 && !ctx.playlist) music.vdraw = musicVirtual(box, { count: ids.length, height: 52, render: row });
  else box.append(...ids.map((_, i) => row(i)));
  musicTableEvents(box, ctx);
  return el("div", { class: `mu-table${ids.length > 300 && !ctx.playlist ? " virtual" : ""}`, role: "table" }, head, box);
}

function musicRow(id, i, ctx) {
  const s = muSong(id);
  if (!s) return el("div", { class: "mu-row missing" });
  const artist = el("span", { class: "mu-col-artist mu-cell" }, ...s.artists.flatMap((name, k) => [
    ...(k ? [", "] : []), el("span", { class: "mu-link-text", "data-artist": muNorm(name) }, name)]));
  const album = el("span", { class: "mu-col-album mu-cell" }, s.album ? el("span", { class: "mu-link-text", "data-album": musicAlbumKey(s) || "" }, s.album) : "");
  const n = ctx.number ? (ctx.number === "track" ? s.track || "" : i + 1) : null;
  const r = el("div", { class: "mu-row", role: "row", tabindex: "-1", "data-id": id, "data-i": String(i), draggable: "true" },
    n !== null ? el("span", { class: "mu-num" }, String(n), svg(MU_ICONS.play)) : musicArt(id),
    el("span", { class: "mu-cell mu-cell-title" }, el("span", { class: "mu-title" }, s.title), el("span", { class: "mu-sub" }, muArtists(s))),
    artist, album, el("span", { class: "mu-col-time mu-cell" }, muTime(s.duration)));
  if (music.selected === id) r.classList.add("selected");
  return r;
}

function musicTableEvents(box, ctx) {
  const rowOf = (e) => e.target.closest(".mu-row[data-id]");
  const play = (r) => musicPlayList(ctx.ids, Number(r.dataset.i), { from: ctx.from, shuffle: null });
  const pick = (r) => {
    music.selected = r.dataset.id;
    box.querySelectorAll(".mu-row.selected").forEach((n) => n.classList.remove("selected"));
    r.classList.add("selected");
    r.focus({ preventScroll: true });
  };
  box.addEventListener("click", (e) => {
    const r = rowOf(e);
    if (!r) return;
    const link = e.target.closest("[data-artist], [data-album]");
    if (link?.dataset.artist) return musicGo("artist", link.dataset.artist);
    if (link?.dataset.album) return musicGo("album", link.dataset.album);
    if (e.target.closest(".mu-num") || matchMedia("(pointer: coarse)").matches) return play(r);
    pick(r);
  });
  box.addEventListener("dblclick", (e) => { const r = rowOf(e); if (r && !e.target.closest("[data-artist], [data-album]")) play(r); });
  box.addEventListener("keydown", (e) => {
    const r = rowOf(e);
    if (!r) return;
    if (e.key === "Enter") { e.preventDefault(); play(r); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const i = Number(r.dataset.i) + (e.key === "ArrowDown" ? 1 : -1);
      if (i < 0 || i >= ctx.ids.length) return;
      const main = $("mu-main");
      let next = box.querySelector(`.mu-row[data-i="${i}"]`);
      if (!next) {
        main.scrollTop += e.key === "ArrowDown" ? 52 : -52;
        music.vdraw?.();
        next = box.querySelector(`.mu-row[data-i="${i}"]`);
      }
      if (next) { pick(next); next.scrollIntoView({ block: "nearest" }); }
    }
  });
  box.addEventListener("contextmenu", (e) => {
    const r = rowOf(e);
    if (!r) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, musicIdsMenu([r.dataset.id], { ...ctx, index: Number(r.dataset.i) }));
  });
  box.addEventListener("dragstart", (e) => {
    const r = rowOf(e);
    if (!r) return;
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/x-adleros-songs", JSON.stringify([r.dataset.id]));
  });
  if (ctx.playlist) musicReorder(box, ctx);
}

function musicSongsView() {
  const by = music.sort.songs || "title";
  const ids = musicSorted(music.all.map((s) => s.id), by);
  const sort = el("select", { class: "field-input mu-sort", "aria-label": "Sort songs by" },
    ...Object.entries(MU_SORTS).map(([k, label]) => el("option", { value: k, ...(k === by ? { selected: "" } : {}) }, label)));
  sort.addEventListener("change", () => { music.sort.songs = sort.value; musicSave(); musicRender(); });
  return el("div", { class: "mu-page" }, musicHead("Songs", `${muCount(ids.length, "song")}, ${muLength(ids)}`, sort, ...musicPlayButtons(ids, "Songs")),
    musicTable({ ids, from: "Songs" }));
}

// ---------------------------------------------------------- the albums

function musicGrid(items, card, { minWidth = 168 } = {}) {
  const box = el("div", { class: "mu-grid-box" });
  const main = $("mu-main");
  let cols = 0;
  let rowH = 0;
  let draw = null;
  const layout = () => {
    const w = box.clientWidth || main.clientWidth - 64;
    const c = Math.max(2, Math.floor((w + 20) / (minWidth + 20)));
    if (c === cols && draw) return draw(false);
    cols = c;
    const cardW = (w - 20 * (cols - 1)) / cols;
    rowH = Math.round(cardW + 64);
    box.style.setProperty("--cols", String(cols));
    draw = musicVirtual(box, {
      count: Math.ceil(items.length / cols), height: rowH,
      render: (r) => el("div", { class: "mu-grid-row" }, ...items.slice(r * cols, r * cols + cols).map(card)),
    });
    draw(true);
  };
  music.vdraw = (fresh) => (fresh || !draw ? layout() : draw());
  return box;
}

function musicAlbumsView() {
  const by = music.sort.albums || "artist";
  const albums = [...music.albums.values()].sort({
    artist: (a, b) => muCollator.compare(a.artist, b.artist) || muCollator.compare(a.title, b.title),
    title: (a, b) => muCollator.compare(a.title, b.title),
    added: (a, b) => b.added - a.added,
    year: (a, b) => (b.year || 0) - (a.year || 0) || muCollator.compare(a.title, b.title),
  }[by]);
  const sort = el("select", { class: "field-input mu-sort", "aria-label": "Sort albums by" },
    ...[["artist", "Artist"], ["title", "Title"], ["added", "Recently added"], ["year", "Year"]]
      .map(([k, label]) => el("option", { value: k, ...(k === by ? { selected: "" } : {}) }, label)));
  sort.addEventListener("change", () => { music.sort.albums = sort.value; musicSave(); musicRender(); });
  return el("div", { class: "mu-page" }, musicHead("Albums", muCount(albums.length, "album"), sort), musicGrid(albums, musicAlbumCard));
}

function musicAlbumView(album) {
  if (!album) return el("div", { class: "mu-empty" }, el("p", {}, "That album isn't in your library any more."));
  const discs = new Set(album.ids.map((id) => muSong(id).disc || 1)).size > 1;
  const artist = el("button", { type: "button", class: "mu-link mu-hero-artist" }, album.artist || "Unknown artist");
  artist.addEventListener("click", () => musicGo("artist", muNorm(album.artist)));
  const more = musicIconButton("More", "more", (e) => openMenu(e.clientX, e.clientY, musicIdsMenu(album.ids, { from: album.title, album })));
  return el("div", { class: "mu-page" },
    el("header", { class: "mu-hero" }, musicArt(album.cover),
      el("div", { class: "mu-hero-text" }, el("p", { class: "mu-kicker" }, "Album"), el("h1", {}, album.title), artist,
        el("p", { class: "mu-head-sub" }, [album.year, muCount(album.ids.length, "song"), muLength(album.ids)].filter(Boolean).join(" · ")),
        el("div", { class: "mu-head-actions" }, ...musicPlayButtons(album.ids, album.title, { kind: "album", key: album.key, label: album.title }), more))),
    discs ? musicDiscs(album) : musicTable({ ids: album.ids, from: album.title, number: "track" }));
}

function musicDiscs(album) {
  const byDisc = new Map();
  for (const id of album.ids) {
    const d = muSong(id).disc || 1;
    if (!byDisc.has(d)) byDisc.set(d, []);
    byDisc.get(d).push(id);
  }
  return el("div", {}, ...[...byDisc].flatMap(([d, ids]) => [el("h3", { class: "mu-disc" }, `Disc ${d}`), musicTable({ ids, from: album.title, number: "track" })]));
}

// ---------------------------------------------------------- the artists

function musicArtistsView() {
  const artists = [...music.artists.values()].sort((a, b) => muCollator.compare(a.name.replace(/^the\s+/i, ""), b.name.replace(/^the\s+/i, "")));
  const box = el("div", { class: "mu-list" });
  music.vdraw = musicVirtual(box, {
    count: artists.length, height: 56,
    render: (i) => {
      const a = artists[i];
      const r = el("div", { class: "mu-list-row", role: "link", tabindex: "0", "data-artist": a.key },
        musicArt(a.ids.find((id) => muSong(id)?.cover), { round: true }), el("span", { class: "mu-title" }, a.name),
        el("span", { class: "mu-sub" }, muCount(a.ids.length, "song")));
      return r;
    },
  });
  box.addEventListener("click", (e) => { const r = e.target.closest("[data-artist]"); if (r) musicGo("artist", r.dataset.artist); });
  box.addEventListener("keydown", (e) => { const r = e.target.closest("[data-artist]"); if (r && e.key === "Enter") musicGo("artist", r.dataset.artist); });
  box.addEventListener("contextmenu", (e) => {
    const r = e.target.closest("[data-artist]");
    if (!r) return;
    e.preventDefault();
    const a = music.artists.get(r.dataset.artist);
    openMenu(e.clientX, e.clientY, musicIdsMenu(a.ids, { from: a.name, artist: a }));
  });
  return el("div", { class: "mu-page" }, musicHead("Artists", muCount(artists.length, "artist")), box);
}

function musicArtistView(a) {
  if (!a) return el("div", { class: "mu-empty" }, el("p", {}, "That artist isn't in your library any more."));
  const plays = music.plays.counts;
  const top = [...a.ids].sort((x, y) => (plays[y] || 0) - (plays[x] || 0) || (muSong(y).year || 0) - (muSong(x).year || 0)).slice(0, 10);
  const own = [...a.albums].map((k) => music.albums.get(k)).filter(Boolean).sort((x, y) => (y.year || 0) - (x.year || 0));
  const elsewhere = [...new Set(a.ids.map((id) => musicAlbumKey(muSong(id))).filter((k) => k && !a.albums.has(k)))]
    .map((k) => music.albums.get(k)).filter(Boolean);
  const all = musicSorted(a.ids, "album");
  const cover = a.ids.find((id) => muSong(id)?.cover);
  return el("div", { class: "mu-page" },
    el("header", { class: "mu-hero artist" }, musicArt(cover, { round: true }),
      el("div", { class: "mu-hero-text" }, el("p", { class: "mu-kicker" }, "Artist"), el("h1", {}, a.name),
        el("p", { class: "mu-head-sub" }, `${muCount(a.ids.length, "song")}${own.length ? `, ${muCount(own.length, "album")}` : ""}`),
        el("div", { class: "mu-head-actions" }, ...musicPlayButtons(all, a.name, { kind: "artist", key: a.key, label: a.name })))),
    el("h2", { class: "mu-section" }, a.ids.length > 10 ? "Top songs" : "Songs"), musicTable({ ids: top, from: a.name }),
    ...(a.ids.length > 10 ? [(() => {
      const b = el("button", { type: "button", class: "mu-link mu-all" }, `All ${a.ids.length} songs`);
      b.addEventListener("click", () => {
        const top = $("mu-main").scrollTop;
        music.view.allSongs = true;
        musicRender();
        $("mu-main").scrollTop = top;
      });
      return music.view.allSongs ? musicTable({ ids: all, from: a.name }) : b;
    })()] : []),
    ...(own.length ? [el("h2", { class: "mu-section" }, "Albums"), el("div", { class: "mu-wrap" }, ...own.map(musicAlbumCard))] : []),
    ...(elsewhere.length ? [el("h2", { class: "mu-section" }, "Appears on"), el("div", { class: "mu-wrap" }, ...elsewhere.slice(0, 40).map(musicAlbumCard))] : []));
}

// ------------------------------------------------------------ playlists

function musicPlaylistsView() {
  const make = musicButton("New playlist", "plus", () => musicNewList(), "primary");
  return el("div", { class: "mu-page" }, musicHead("Playlists", muCount(music.playlists.length, "playlist"), make),
    music.playlists.length ? el("div", { class: "mu-wrap" }, ...music.playlists.map(musicListCard))
      : el("p", { class: "mu-empty-line" }, "No playlists yet. A playlist is an .m3u8 file in your music folder, so spotdl's and other players' work here too."));
}

function musicPlaylistView(p) {
  if (!p) return el("div", { class: "mu-empty" }, el("p", {}, "That playlist isn't there any more."));
  const more = musicIconButton("More", "more", (e) => openMenu(e.clientX, e.clientY, musicListMenu(p)));
  const title = el("h1", { class: p.writable ? "mu-editable" : "", title: p.writable ? "Rename" : "" }, p.name);
  if (p.writable) title.addEventListener("click", () => musicRenameList(p));
  return el("div", { class: "mu-page" },
    el("header", { class: "mu-hero" }, musicListArt(p),
      el("div", { class: "mu-hero-text" }, el("p", { class: "mu-kicker" }, "Playlist"), title,
        el("p", { class: "mu-head-sub" }, [muCount(p.items.length, "song"), muLength(p.items), p.missing ? `${p.missing} not found` : ""].filter(Boolean).join(" · ")),
        el("div", { class: "mu-head-actions" }, ...musicPlayButtons(p.items, p.name, { kind: "playlist", key: p.id, label: p.name }), more))),
    p.items.length ? musicTable({ ids: p.items, from: p.name, playlist: p, number: "index" })
      : el("p", { class: "mu-empty-line" }, "Nothing in it yet: right-click a song, then Add to playlist."));
}

async function musicSaveList(p, items, name = p?.name) {
  const reply = await api("/api/music/playlists", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save: { id: p?.id || null, name, items } }),
  }).catch(() => ({ status: 0 }));
  if (reply.status !== 200) { toast(reply.body?.error || "Couldn't save the playlist."); return null; }
  const saved = reply.body;
  const i = music.playlists.findIndex((x) => x.id === (p?.id || saved.id));
  if (i >= 0) music.playlists[i] = saved; else music.playlists.push(saved);
  music.playlists.sort((a, b) => muCollator.compare(a.name, b.name));
  music.inLists = new Map();
  music.playlists.forEach((x, k) => x.items.forEach((id) => { if (!music.inLists.has(id)) music.inLists.set(id, []); music.inLists.get(id).push(k); }));
  if (music.view.kind === "playlist" && music.view.key === p?.id) music.view.key = saved.id;
  musicRenderSide();
  return saved;
}

async function musicNewList(ids = []) {
  const name = await nameDialog({ title: "New playlist", button: "Create" });
  if (!name) return null;
  const made = await musicSaveList(null, ids, name);
  if (made && !ids.length) musicGo("playlist", made.id);
  else if (made) toast(`Added to ${made.name}.`);
  return made;
}

async function musicRenameList(p) {
  const name = await nameDialog({ title: "Rename playlist", value: p.name, button: "Rename" });
  if (!name || name === p.name) return;
  const saved = await musicSaveList(p, p.items, name);
  if (saved && music.view.kind === "playlist") { music.view.key = saved.id; musicRender(); }
}

async function musicDeleteList(p) {
  if (!(await confirmDialog({ title: `Delete ${p.name}?`, body: "Its .m3u8 file goes to the Trash; the songs stay.", button: "Delete", destructive: true }))) return;
  const reply = await api("/api/music/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: p.id }) })
    .catch(() => ({ status: 0 }));
  if (reply.status !== 200) return toast(reply.body?.error || "Couldn't delete it.");
  music.playlists = music.playlists.filter((x) => x.id !== p.id);
  if (music.view.kind === "playlist" && music.view.key === p.id) musicShow({ kind: "playlists" });
  musicRenderSide();
}

async function musicAddTo(p, ids) {
  const fresh = ids.filter((id) => !p.items.includes(id));
  if (!fresh.length) return toast(`Already in ${p.name}.`);
  const saved = await musicSaveList(p, [...p.items, ...fresh]);
  if (saved) {
    toast(`Added to ${saved.name}.`);
    if (music.view.kind === "playlist" && music.view.key === saved.id) musicRender();
  }
}

function musicListMenu(p) {
  return [
    { label: "Play", run: () => musicPlayList(p.items, 0, { from: p.name, shuffle: false }) },
    { label: "Shuffle", run: () => musicPlayList(p.items, -1, { from: p.name, shuffle: true }) },
    { label: "Play next", run: () => musicPlayNext(p.items) }, { label: "Add to queue", run: () => musicAddToQueue(p.items) },
    { label: "Start radio", run: () => musicRadio({ kind: "playlist", key: p.id, label: p.name }) },
    ...(p.writable ? [{ label: "Rename…", run: () => musicRenameList(p) }, { label: "Delete", run: () => musicDeleteList(p), destructive: true }] : []),
    ...(p.path ? [{ label: "Show in My Computer", run: () => openFiles(p.path.split("/").slice(0, -1).join("/")) }] : []),
  ];
}

// Dragged onto a playlist in the side: added to it.
function musicDropOn(node, p) {
  node.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-adleros-songs") && p.writable) { e.preventDefault(); node.classList.add("drop"); } });
  node.addEventListener("dragleave", () => node.classList.remove("drop"));
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    node.classList.remove("drop");
    try { musicAddTo(p, JSON.parse(e.dataTransfer.getData("text/x-adleros-songs"))); } catch { /* not ours */ }
  });
}

// A playlist's songs: dragged into a new order (saved), or onto another
// playlist in the side.
function musicReorder(box, ctx) {
  let from = null;
  box.addEventListener("dragstart", (e) => {
    const r = e.target.closest(".mu-row[data-id]");
    if (!r) return;
    from = Number(r.dataset.i);
    r.classList.add("dragging");
  });
  box.addEventListener("dragend", () => { from = null; box.querySelectorAll(".dragging, .drop-above, .drop-below").forEach((n) => n.classList.remove("dragging", "drop-above", "drop-below")); });
  box.addEventListener("dragover", (e) => {
    const r = e.target.closest(".mu-row[data-id]");
    if (from === null || !r || !ctx.playlist.writable) return;
    e.preventDefault();
    box.querySelectorAll(".drop-above, .drop-below").forEach((n) => n.classList.remove("drop-above", "drop-below"));
    const below = e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2;
    r.classList.add(below ? "drop-below" : "drop-above");
  });
  box.addEventListener("drop", async (e) => {
    const r = e.target.closest(".mu-row[data-id]");
    if (from === null || !r) return;
    e.preventDefault();
    let to = Number(r.dataset.i) + (e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2 ? 1 : 0);
    const items = [...ctx.playlist.items];
    const [moved] = items.splice(from, 1);
    if (to > from) to--;
    items.splice(to, 0, moved);
    from = null;
    if (await musicSaveList(ctx.playlist, items)) musicRender();
  });
}

// -------------------------------------------------------------- menus

// What a right-click on songs (or an album, an artist) offers.
function musicIdsMenu(ids, ctx = {}) {
  const s = ids.length === 1 ? muSong(ids[0]) : null;
  const items = [
    { label: "Play next", run: () => musicPlayNext(ids) },
    { label: "Add to queue", run: () => musicAddToQueue(ids) },
    { label: "Start radio", run: () => musicRadio(ctx.artist ? { kind: "artist", key: ctx.artist.key, label: ctx.artist.name }
      : ctx.album ? { kind: "album", key: ctx.album.key, label: ctx.album.title } : { kind: "song", key: ids[0], label: s?.title || "Song" }) },
    { label: "Add to playlist…", run: () => musicPickList(ids) },
  ];
  if (ctx.playlist?.writable && ctx.index !== undefined) {
    items.push({ label: `Remove from ${ctx.playlist.name}`, run: async () => {
      const left = ctx.playlist.items.filter((_, i) => i !== ctx.index);
      if (await musicSaveList(ctx.playlist, left)) musicRender();
    } });
  }
  if (s) {
    const key = musicAlbumKey(s);
    if (key && music.albums.has(key) && !ctx.album) items.push({ label: "Go to album", run: () => musicGo("album", key) });
    for (const name of s.artists.slice(0, 3)) {
      if (music.artists.has(muNorm(name))) items.push({ label: `Go to ${name}`, run: () => musicGo("artist", muNorm(name)) });
    }
    const path = ids[0].startsWith("/") ? ids[0] : `${music.dir}/${ids[0]}`;
    items.push({ label: "Show in My Computer", run: () => openFiles(path.split("/").slice(0, -1).join("/")) });
  }
  return items;
}

function musicPickList(ids) {
  const lists = music.playlists.filter((p) => p.writable).sort((a, b) => b.mtime - a.mtime);
  setTimeout(() => openMenu(music.menuAt.x, music.menuAt.y, [
    { label: "New playlist…", run: () => musicNewList(ids) },
    ...lists.slice(0, 30).map((p) => ({ label: p.name, run: () => musicAddTo(p, ids) })),
  ]), 0);
}

// ---------------------------------------------------- home, radio, search

function musicHomeView() {
  const recentAlbums = [];
  const seen = new Set();
  for (const id of music.plays.recent) {
    const key = musicAlbumKey(muSong(id));
    if (key && music.albums.has(key) && !seen.has(key)) { seen.add(key); recentAlbums.push(music.albums.get(key)); }
    if (recentAlbums.length >= 18) break;
  }
  const added = [...music.albums.values()].sort((a, b) => b.added - a.added).slice(0, 18);
  const lists = [...music.playlists].sort((a, b) => b.mtime - a.mtime).slice(0, 18);
  const stations = musicStations().slice(0, 8);
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return el("div", { class: "mu-page" }, musicHead(hello, `${muCount(music.all.length, "song")} in your library`,
    musicButton("Shuffle all", "shuffle", () => musicRadio({ kind: "all", label: "Your library" }), "primary")),
  musicShelf("Recently played", recentAlbums.map(musicAlbumCard)),
  musicShelf("Stations for you", stations.map(musicStationCard), () => musicShow({ kind: "radio" })),
  musicShelf("Recently added", added.map(musicAlbumCard), () => { music.sort.albums = "added"; musicShow({ kind: "albums" }); }),
  musicShelf("Your playlists", lists.map(musicListCard), () => musicShow({ kind: "playlists" })));
}

// Stations: yours (what you play), your library shuffled, your artists,
// genres and playlists.
function musicStations() {
  const counts = music.plays.counts;
  const byArtist = [...music.artists.values()].map((a) => ({ a, score: a.ids.reduce((n, id) => n + (counts[id] || 0), 0) * 3 + a.ids.length }))
    .sort((x, y) => y.score - x.score).slice(0, 12).map(({ a }) => ({ kind: "artist", key: a.key, label: a.name, sub: "Artist radio", art: a.ids.find((id) => muSong(id)?.cover), round: true }));
  const genres = new Map();
  for (const s of music.all) if (s.genre) genres.set(s.genre, (genres.get(s.genre) || 0) + 1);
  const byGenre = [...genres].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([g, n]) => ({ kind: "genre", key: g, label: g, sub: `${n} songs`, art: music.all.find((s) => s.genre === g && s.cover)?.id }));
  const lists = [...music.playlists].filter((p) => p.items.length >= 8).sort((a, b) => b.items.length - a.items.length).slice(0, 10)
    .map((p) => ({ kind: "playlist", key: p.id, label: p.name, sub: "From your playlist", list: p }));
  return [
    ...(music.plays.recent.length ? [{ kind: "you", label: "Your station", sub: "From what you play", art: music.plays.recent.find((id) => muSong(id)?.cover) }] : []),
    { kind: "all", label: "Your library", sub: "Everything, shuffled", art: music.all.find((s) => s.cover)?.id },
    ...byArtist.slice(0, 4), ...lists.slice(0, 3), ...byGenre.slice(0, 3), ...byArtist.slice(4), ...lists.slice(3), ...byGenre.slice(3),
  ];
}

function musicStationCard(st) {
  return musicCard({
    art: st.list ? musicListArt(st.list) : musicArt(st.art, { round: st.round }), title: st.label, sub: st.sub, round: st.round,
    open: () => musicRadio(st), play: () => musicRadio(st), label: `${st.label} radio`,
  });
}

function musicRadioView() {
  const stations = musicStations();
  return el("div", { class: "mu-page" }, musicHead("Radio", "Stations made from your library: songs that go together in your playlists, the same artists, genres and years. They don't run out."),
    el("div", { class: "mu-wrap" }, ...stations.map(musicStationCard)));
}

function musicSearchView() {
  const query = music.view.query || "";
  const words = muNorm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return musicHomeView();
  const hit = (key) => words.every((w) => key.includes(w));
  const songs = music.all.filter((s) => hit(s.key));
  const starts = (t) => muNorm(t).startsWith(words.join(" "));
  songs.sort((a, b) => (starts(b.title) - starts(a.title)) || ((music.plays.counts[b.id] || 0) - (music.plays.counts[a.id] || 0)));
  const artists = [...music.artists.values()].filter((a) => hit(muNorm(a.name))).sort((a, b) => (starts(b.name) - starts(a.name)) || b.ids.length - a.ids.length);
  const albums = [...music.albums.values()].filter((a) => hit(muNorm(`${a.title} ${a.artist}`))).slice(0, 24);
  const lists = music.playlists.filter((p) => hit(muNorm(p.name)));
  if (!songs.length && !artists.length && !albums.length && !lists.length) {
    return el("div", { class: "mu-page" }, musicHead(`“${query.trim()}”`, "Nothing in your library matches."));
  }
  return el("div", { class: "mu-page" }, musicHead(`“${query.trim()}”`, muCount(songs.length, "song")),
    ...(artists.length ? [musicShelf("Artists", artists.slice(0, 12).map(musicArtistCard))] : []),
    ...(albums.length ? [musicShelf("Albums", albums.map(musicAlbumCard))] : []),
    ...(lists.length ? [musicShelf("Playlists", lists.map(musicListCard))] : []),
    ...(songs.length ? [el("h2", { class: "mu-section" }, "Songs"), musicTable({ ids: songs.slice(0, 200).map((s) => s.id), from: `“${query.trim()}”` })] : []));
}

// ---------------------------------------------------------------- radio

// Songs for a station (seed: {kind: song | artist | album | genre | playlist
// | you | all, key}): the ones most like it, picked at random by how alike
// (and no artist over and over), never one of `skip`.
function musicRadioPick(seed, n, skip) {
  const pool = music.all.filter((s) => !skip.has(s.id));
  if (!pool.length) return [];
  if (seed.kind === "all") return muShuffled(pool).slice(0, n).map((s) => s.id);
  const counts = music.plays.counts;
  const seeds = seed.kind === "song" ? [seed.key]
    : seed.kind === "artist" ? music.artists.get(seed.key)?.ids || []
      : seed.kind === "album" ? music.albums.get(seed.key)?.ids || []
        : seed.kind === "genre" ? music.all.filter((s) => s.genre === seed.key).map((s) => s.id)
          : seed.kind === "playlist" ? music.playlists.find((p) => p.id === seed.key)?.items || []
            : [...Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id), ...music.plays.recent.slice(0, 30)];
  const artistW = new Map();
  const genreW = new Map();
  const listW = new Map();
  const years = [];
  for (const id of seeds) {
    const s = muSong(id);
    if (!s) continue;
    for (const a of s.artists) artistW.set(muNorm(a), (artistW.get(muNorm(a)) || 0) + 1);
    if (s.genre) genreW.set(s.genre, (genreW.get(s.genre) || 0) + 1);
    if (s.year) years.push(s.year);
    for (const p of music.inLists.get(id) || []) listW.set(p, (listW.get(p) || 0) + 1);
  }
  const year = years.length ? years.sort((a, b) => a - b)[Math.floor(years.length / 2)] : null;
  const most = (m) => Math.max(1, ...m.values());
  const [aMax, gMax, lMax] = [most(artistW), most(genreW), most(listW)];
  const scored = [];
  for (const s of pool) {
    let score = 0;
    for (const p of music.inLists.get(s.id) || []) score += 3 * (listW.get(p) || 0) / lMax;
    for (const a of s.artists) score += 4 * (artistW.get(muNorm(a)) || 0) / aMax;
    if (s.genre && genreW.has(s.genre)) score += 2 * genreW.get(s.genre) / gMax;
    if (year && s.year && Math.abs(s.year - year) <= 4) score += 0.7;
    if (score > 0) scored.push([s.id, score + 0.3 * Math.log1p(counts[s.id] || 0)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, 400);
  const out = [];
  const perArtist = new Map();
  if (seed.kind === "song" && !skip.has(seed.key) && muSong(seed.key)) out.push(seed.key);
  while (out.length < n && top.length) {
    const total = top.reduce((t, [, w]) => t + w * w, 0);
    let r = Math.random() * total;
    let k = 0;
    while (k < top.length - 1 && (r -= top[k][1] ** 2) > 0) k++;
    const [id] = top.splice(k, 1)[0];
    if (out.includes(id)) continue;
    const lead = muNorm(muSong(id).artists[0] || "");
    if ((perArtist.get(lead) || 0) >= 2 && top.length > n) continue;
    perArtist.set(lead, (perArtist.get(lead) || 0) + 1);
    out.push(id);
  }
  // Not enough alike: the rest at random.
  if (out.length < n) out.push(...muShuffled(pool.filter((s) => !out.includes(s.id))).slice(0, n - out.length).map((s) => s.id));
  return out;
}

function musicRadio(seed) {
  const picks = musicRadioPick(seed, 25, new Set());
  if (!picks.length) return toast("Nothing to play.");
  musicPlayList(picks, 0, { from: seed.kind === "all" ? "Your library, shuffled" : `${seed.label} radio`, shuffle: false, radio: seed });
}

// A station keeps going: more, before it runs out.
function musicRadioMore() {
  if (!music.radio || music.queue.length - music.at > 5) return;
  const recent = new Set(music.queue.slice(-200));
  music.queue.push(...musicRadioPick(music.radio, 20, recent));
  musicRenderPanel();
}

// ---------------------------------------------------------------- playing

function musicPlayList(ids, start = 0, { from = "", shuffle = null, radio = null } = {}) {
  ids = ids.filter((id) => muSong(id));
  if (!ids.length) return toast("Nothing to play.");
  const on = shuffle ?? music.shuffle;
  music.radio = radio;
  music.from = from;
  if (on && !radio) {
    const first = start >= 0 ? ids[start] : null;
    const rest = muShuffled(ids.filter((_, i) => i !== start));
    music.original = [...ids];
    music.queue = first ? [first, ...rest] : rest;
    music.at = 0;
    music.shuffle = true;
  } else {
    music.queue = [...ids];
    music.at = Math.max(0, start);
    music.original = null;
    if (shuffle === false || radio) music.shuffle = false;
  }
  music.addedUntil = music.at;
  musicStart(true);
}

function musicStart(play = true, at = 0) {
  const id = muCurrent();
  const audio = music.audio;
  if (!id || !muSong(id)) { audio.pause(); musicNowPlaying(); return; }
  audio.src = muUrl(id);
  if (at > 0) audio.addEventListener("loadedmetadata", () => { audio.currentTime = Math.min(at, (audio.duration || at) - 1); }, { once: true });
  music.counted = false;
  if (play) {
    audio.play().catch(() => {}); // the browser may want a click first
    // Now playing (to Navidrome, if it's set up).
    api("/api/music/playing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  musicNowPlaying();
  musicRadioMore();
  musicSaveSoon();
}

function musicToggle() {
  const audio = music.audio;
  if (!muCurrent()) {
    if (music.loaded && music.all.length) musicRadio({ kind: "all", label: "Your library" });
    return;
  }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function musicNext(auto = false) {
  if (music.at < music.queue.length - 1) {
    music.at++;
    if (music.addedUntil < music.at) music.addedUntil = music.at;
    return musicStart(true);
  }
  if (music.repeat === "all" && music.queue.length) { music.at = 0; music.addedUntil = 0; return musicStart(true); }
  if (music.radio) { musicRadioMore(); if (music.at < music.queue.length - 1) return musicNext(auto); }
  if (auto) { music.audio.pause(); music.audio.currentTime = 0; musicBarUpdate(); }
}

function musicPrev() {
  const audio = music.audio;
  if (audio.currentTime > 3 || music.at <= 0) { audio.currentTime = 0; return; }
  music.at--;
  musicStart(true);
}

function musicPlayNext(ids) {
  ids = ids.filter((id) => muSong(id));
  if (!ids.length) return;
  if (!muCurrent()) return musicPlayList(ids, 0, { from: "Your queue", shuffle: false });
  music.queue.splice(music.at + 1, 0, ...ids);
  music.addedUntil = Math.max(music.addedUntil, music.at) + ids.length;
  if (music.original) music.original.push(...ids);
  toast(ids.length === 1 ? `${muSong(ids[0]).title} plays next.` : `${ids.length} songs play next.`);
  musicRenderPanel();
  musicSaveSoon();
}

function musicAddToQueue(ids) {
  ids = ids.filter((id) => muSong(id));
  if (!ids.length) return;
  if (!muCurrent()) return musicPlayList(ids, 0, { from: "Your queue", shuffle: false });
  const at = Math.max(music.addedUntil, music.at) + 1;
  music.queue.splice(at, 0, ...ids);
  music.addedUntil = at + ids.length - 1;
  if (music.original) music.original.push(...ids);
  toast(ids.length === 1 ? `${muSong(ids[0]).title} is in the queue.` : `${ids.length} songs are in the queue.`);
  musicRenderPanel();
  musicSaveSoon();
}

function musicSetShuffle(on) {
  if (on === music.shuffle) return;
  music.shuffle = on;
  const current = muCurrent();
  if (on && current) {
    music.original = [...music.queue];
    music.queue = [...music.queue.slice(0, music.at + 1), ...muShuffled(music.queue.slice(music.at + 1))];
  } else if (!on && music.original && current) {
    const i = music.original.indexOf(current);
    music.queue = music.original;
    music.at = i >= 0 ? i : 0;
    music.original = null;
  }
  music.addedUntil = music.at;
  musicBarUpdate();
  musicRenderPanel();
  musicSaveSoon();
}

function musicCycleRepeat() {
  music.repeat = { off: "all", all: "one", one: "off" }[music.repeat];
  musicMediaNext();
  musicBarUpdate();
  musicSaveSoon();
}

// A song started: the bar, the rows, the queue, the lyrics, the keyboard's media keys.
function musicNowPlaying() {
  const id = muCurrent();
  const s = id ? muSong(id) : null;
  musicBarUpdate();
  musicMarkPlaying();
  musicRenderPanel();
  musicMediaNext();
  if (music.panel === "lyrics") musicLyricsLoad(id);
  if ("mediaSession" in navigator && s) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title, artist: muArtists(s), album: s.album || "",
      artwork: s.cover ? [{ src: new URL(muCover(id), location.href).href, sizes: "640x640", type: "image/jpeg" }] : [],
    });
  }
}

function musicMarkPlaying(root = $("mu-main")) {
  if (!root) return;
  const id = muCurrent();
  root.querySelectorAll(".mu-row.playing").forEach((n) => n.classList.remove("playing"));
  if (id) root.querySelectorAll(`.mu-row[data-id="${CSS.escape(id)}"]`).forEach((n) => n.classList.add("playing"));
}

// ---------------------------------------------------------------- the bar

function musicBar() {
  const seek = el("input", { type: "range", class: "mu-seek", id: "mu-seek", min: "0", max: "1000", value: "0", step: "1", "aria-label": "Where in the song" });
  seek.addEventListener("input", () => {
    music.seeking = true;
    const d = music.audio.duration;
    $("mu-now-time").textContent = muTime((seek.value / 1000) * d);
  });
  seek.addEventListener("change", () => {
    const d = music.audio.duration;
    if (Number.isFinite(d)) music.audio.currentTime = (seek.value / 1000) * d;
    music.seeking = false;
  });
  const volume = el("input", { type: "range", class: "mu-volume", id: "mu-volume", min: "0", max: "1", step: "0.01", value: String(music.audio.volume), "aria-label": "Volume" });
  volume.addEventListener("input", () => { music.audio.volume = Number(volume.value); music.audio.muted = false; musicSaveSoon(); });
  const artist = el("button", { type: "button", class: "mu-bar-artist mu-link", id: "mu-bar-artist" });
  artist.addEventListener("click", () => {
    const s = muSong(muCurrent());
    if (s?.artists[0] && music.artists.has(muNorm(s.artists[0]))) musicGo("artist", muNorm(s.artists[0]));
  });
  const title = el("button", { type: "button", class: "mu-bar-title mu-link", id: "mu-bar-title" });
  title.addEventListener("click", () => {
    const key = musicAlbumKey(muSong(muCurrent()));
    if (key && music.albums.has(key)) musicGo("album", key);
  });
  const art = el("span", { class: "mu-bar-art", id: "mu-bar-art" });
  art.addEventListener("click", () => musicSetPanel(music.panel === "lyrics" ? null : "lyrics"));
  return el("footer", { class: "mu-bar" },
    el("div", { class: "mu-bar-now" }, art, el("div", { class: "mu-bar-text" }, title, artist)),
    el("div", { class: "mu-bar-controls" },
      musicIconButton("Shuffle", "shuffle", () => musicSetShuffle(!music.shuffle), "mu-shuffle"),
      musicIconButton("Previous", "prev", musicPrev, "mu-fill"),
      musicIconButton("Play", "play", musicToggle, "mu-play mu-fill"),
      musicIconButton("Next", "next", () => musicNext(), "mu-fill"),
      musicIconButton("Repeat", "repeat", musicCycleRepeat, "mu-repeat")),
    el("div", { class: "mu-bar-seek" }, el("span", { class: "mu-bar-time", id: "mu-now-time" }, "0:00"), seek, el("span", { class: "mu-bar-time", id: "mu-total-time" }, "–:––")),
    el("div", { class: "mu-bar-tools" },
      musicIconButton("Mute", "volume", () => { music.audio.muted = !music.audio.muted; musicBarUpdate(); }, "mu-mute"), volume,
      musicIconButton("Lyrics", "lyrics", () => musicSetPanel(music.panel === "lyrics" ? null : "lyrics"), "mu-lyrics-button"),
      musicIconButton("Up next", "queue", () => musicSetPanel(music.panel === "queue" ? null : "queue"), "mu-queue-button")));
}

function musicBarUpdate() {
  if (!music.built) return;
  const id = muCurrent();
  const s = id ? muSong(id) : null;
  const audio = music.audio;
  $("mu-bar-title").textContent = s?.title || "Not playing";
  $("mu-bar-artist").textContent = s ? muArtists(s) : "";
  $("mu-bar-art").replaceChildren(musicArt(id));
  const play = $("music").querySelector(".mu-play");
  play.replaceChildren(svg(audio.paused ? MU_ICONS.play : MU_ICONS.pause));
  play.classList.toggle("mu-fill", audio.paused);
  play.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
  play.title = audio.paused ? "Play (Space)" : "Pause (Space)";
  $("music").querySelector(".mu-shuffle").classList.toggle("on", music.shuffle);
  const rep = $("music").querySelector(".mu-repeat");
  rep.classList.toggle("on", music.repeat !== "off");
  rep.classList.toggle("one", music.repeat === "one");
  rep.title = { off: "Repeat", all: "Repeat: all", one: "Repeat: this song" }[music.repeat];
  const mute = $("music").querySelector(".mu-mute");
  mute.replaceChildren(svg(audio.muted || audio.volume === 0 ? MU_ICONS.muted : MU_ICONS.volume));
  $("mu-volume").value = String(audio.muted ? 0 : audio.volume);
  $("mu-volume").style.setProperty("--done", `${(audio.muted ? 0 : audio.volume) * 100}%`);
  $("music").querySelector(".mu-lyrics-button").classList.toggle("on", music.panel === "lyrics");
  $("music").querySelector(".mu-queue-button").classList.toggle("on", music.panel === "queue");
  musicBarTime();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = s ? (audio.paused ? "paused" : "playing") : "none";
}

function musicBarTime() {
  if (!music.built) return;
  const audio = music.audio;
  const d = Number.isFinite(audio.duration) ? audio.duration : muSong(muCurrent())?.duration;
  if (!music.seeking) {
    $("mu-now-time").textContent = muTime(audio.currentTime || 0);
    $("mu-seek").value = d ? String(Math.round(((audio.currentTime || 0) / d) * 1000)) : "0";
  }
  $("mu-total-time").textContent = muTime(d);
  $("mu-seek").style.setProperty("--done", `${d ? Math.min(100, ((audio.currentTime || 0) / d) * 100) : 0}%`);
}

// --------------------------------------------------------- queue, lyrics

function musicSetPanel(panel) {
  music.panel = panel;
  $("mu-shell").classList.toggle("with-panel", Boolean(panel));
  musicRenderPanel();
  if (panel === "lyrics") musicLyricsLoad(muCurrent());
  musicBarUpdate();
  musicSaveSoon();
  setTimeout(() => music.vdraw?.(true), 50);
}

function musicRenderPanel() {
  musicMediaNext();
  const box = $("mu-panel");
  if (!box || !music.panel) return box?.replaceChildren();
  const close = musicIconButton("Close", "close", () => musicSetPanel(null), "mu-panel-close");
  const tab = (name, label) => {
    const b = el("button", { type: "button", class: `mu-tab${music.panel === name ? " on" : ""}` }, label);
    b.addEventListener("click", () => musicSetPanel(name));
    return b;
  };
  const head = el("div", { class: "mu-panel-head" }, tab("queue", "Up next"), tab("lyrics", "Lyrics"), close);
  box.replaceChildren(head, music.panel === "queue" ? musicQueueBody() : musicLyricsBody());
  if (music.panel === "lyrics") musicLyricsFollow(true);
}

function musicQueueBody() {
  const body = el("div", { class: "mu-panel-body mu-queue" });
  const current = muCurrent();
  if (!current) return el("div", { class: "mu-panel-body" }, el("p", { class: "mu-empty-line" }, "Nothing playing. Pick a song, or Shuffle all on Home."));
  const row = (i, label) => {
    const id = music.queue[i];
    const s = muSong(id);
    const r = el("div", { class: `mu-qrow${i === music.at ? " now" : ""}`, draggable: i > music.at ? "true" : "false", "data-i": String(i) },
      musicArt(id), el("div", { class: "mu-qtext" }, el("span", { class: "mu-title" }, s?.title || id), el("span", { class: "mu-sub" }, muArtists(s))),
      ...(i > music.at ? [musicIconButton("Remove", "close", (e) => { e.stopPropagation(); musicQueueRemove(i); }, "mu-qremove")] : []));
    r.addEventListener("click", () => { if (i !== music.at) { music.at = i; if (music.addedUntil < i) music.addedUntil = i; musicStart(true); } });
    if (label) r.setAttribute("aria-label", label);
    return r;
  };
  const added = music.addedUntil > music.at ? music.queue.slice(music.at + 1, music.addedUntil + 1).map((_, k) => music.at + 1 + k) : [];
  const rest = [];
  for (let i = Math.max(music.addedUntil, music.at) + 1; i < music.queue.length && rest.length < 150; i++) rest.push(i);
  const clear = el("button", { type: "button", class: "mu-link" }, "Clear");
  clear.addEventListener("click", () => { music.queue = music.queue.slice(0, music.at + 1); music.addedUntil = music.at; music.radio = null; musicRenderPanel(); musicSaveSoon(); });
  body.append(el("h3", { class: "mu-panel-title" }, "Now playing"), row(music.at),
    ...(added.length ? [el("h3", { class: "mu-panel-title" }, "Added by you"), ...added.map((i) => row(i))] : []),
    ...(rest.length ? [el("div", { class: "mu-panel-title" }, el("h3", {}, music.from ? `From ${music.from}` : "Up next"), clear), ...rest.map((i) => row(i))] : []),
    ...(music.queue.length - 1 - Math.max(music.addedUntil, music.at) > rest.length
      ? [el("p", { class: "mu-empty-line" }, `and ${(music.queue.length - 1 - Math.max(music.addedUntil, music.at) - rest.length).toLocaleString()} more`)] : []),
    ...(music.radio ? [el("p", { class: "mu-empty-line" }, "A station: it keeps going.")] : []));
  // Dragged into a new place in what's to come.
  let from = null;
  body.addEventListener("dragstart", (e) => { const r = e.target.closest(".mu-qrow"); if (r) { from = Number(r.dataset.i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } });
  body.addEventListener("dragover", (e) => { const r = e.target.closest(".mu-qrow"); if (from !== null && r && Number(r.dataset.i) > music.at) e.preventDefault(); });
  body.addEventListener("drop", (e) => {
    const r = e.target.closest(".mu-qrow");
    if (from === null || !r) return;
    e.preventDefault();
    let to = Number(r.dataset.i);
    const [id] = music.queue.splice(from, 1);
    if (from <= music.addedUntil) music.addedUntil--;
    if (to > from) to--;
    music.queue.splice(Math.max(music.at + 1, to), 0, id);
    if (to <= music.addedUntil) music.addedUntil++;
    from = null;
    musicRenderPanel();
    musicSaveSoon();
  });
  return body;
}

function musicQueueRemove(i) {
  music.queue.splice(i, 1);
  if (i <= music.addedUntil) music.addedUntil--;
  musicRenderPanel();
  musicSaveSoon();
}

// An LRC's lines: [{t: seconds, text}], times or not.
function musicParseLyrics(text) {
  let offset = 0;
  const timed = [];
  const plain = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    if (/^\s*\[(ar|ti|al|by|re|ve|length|au):/i.test(raw)) continue;
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (stamps.length) for (const m of stamps) timed.push({ t: Number(m[1]) * 60 + Number(m[2].replace(":", ".")), text: words });
    else plain.push(words);
  }
  if (timed.length) return { synced: true, lines: timed.map((l) => ({ ...l, t: l.t - offset })).sort((a, b) => a.t - b.t) };
  while (plain.length && !plain[0]) plain.shift();
  return { synced: false, lines: plain.map((t) => ({ t: null, text: t })) };
}

async function musicLyricsLoad(id) {
  if (!id || music.lyrics?.id === id) return musicRenderPanel();
  music.lyrics = { id, loading: true };
  musicRenderPanel();
  const s = muSong(id);
  const { status, body } = s?.lyrics ? await api(`/api/music/lyrics?id=${encodeURIComponent(id)}`).catch(() => ({ status: 0 })) : { status: 200, body: { text: null } };
  if (music.lyrics?.id !== id) return;
  music.lyrics = status === 200 && body?.text ? { id, ...musicParseLyrics(body.text) } : { id, lines: [] };
  musicRenderPanel();
}

function musicLyricsBody() {
  const l = music.lyrics;
  const id = muCurrent();
  const body = el("div", { class: "mu-panel-body mu-lyrics", id: "mu-lyrics" });
  if (!id) return el("div", { class: "mu-panel-body" }, el("p", { class: "mu-empty-line" }, "Nothing playing."));
  if (!l || l.id !== id || l.loading) return el("div", { class: "mu-panel-body" }, el("p", { class: "mu-empty-line" }, "…"));
  if (!l.lines.length) {
    return el("div", { class: "mu-panel-body" }, el("p", { class: "mu-empty-line" }, "No lyrics for this song. An .lrc file with its name, beside it, gives it some (spotdl makes them)."));
  }
  body.classList.toggle("synced", l.synced);
  l.lines.forEach((line, i) => {
    const p = el("p", { class: "mu-line", "data-i": String(i) }, line.text || "♪");
    if (l.synced) p.addEventListener("click", () => { music.audio.currentTime = Math.max(0, line.t); music.lyricsScrolled = 0; });
    body.append(p);
  });
  body.addEventListener("wheel", () => { music.lyricsScrolled = Date.now(); }, { passive: true });
  body.addEventListener("touchmove", () => { music.lyricsScrolled = Date.now(); }, { passive: true });
  return body;
}

// The line being sung: lit, and in the middle (unless you've just scrolled).
function musicLyricsFollow(jump = false) {
  const l = music.lyrics;
  const box = $("mu-lyrics");
  if (!box || !l?.synced || l.id !== muCurrent()) return;
  const t = music.audio.currentTime + 0.2;
  let i = -1;
  for (let k = 0; k < l.lines.length && l.lines[k].t <= t; k++) i = k;
  if (i === l.at && !jump) return;
  l.at = i;
  box.querySelectorAll(".mu-line.now, .mu-line.past").forEach((n) => n.classList.remove("now", "past"));
  box.querySelectorAll(".mu-line").forEach((n, k) => { if (k < i) n.classList.add("past"); });
  const line = box.querySelector(`.mu-line[data-i="${i}"]`);
  line?.classList.add("now");
  if (line && Date.now() - music.lyricsScrolled > 3000) {
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2, behavior: jump ? "auto" : "smooth" });
  }
}

// ---------------------------------------------------------- the audio

// Where in the song, for the phone's lock screen: its bar, to drag along.
function musicPosition() {
  const a = music.audio;
  music.posAt = Date.now();
  if (!("mediaSession" in navigator) || !Number.isFinite(a.duration) || a.duration <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate || 1 }); } catch { /* not this browser */ }
}

music.audio.addEventListener("play", () => { musicBarUpdate(); musicPosition(); });
music.audio.addEventListener("pause", () => { musicBarUpdate(); musicPosition(); musicSave(); });
music.audio.addEventListener("loadedmetadata", () => { musicBarTime(); musicPosition(); });
for (const type of ["seeked", "durationchange", "ratechange"]) music.audio.addEventListener(type, musicPosition);
music.audio.addEventListener("timeupdate", () => {
  musicBarTime();
  if (music.panel === "lyrics") musicLyricsFollow();
  const a = music.audio;
  // A play, once it's been listened to for a while.
  if (!music.counted && a.currentTime >= Math.min(30, (a.duration || 60) / 2)) {
    music.counted = true;
    const id = muCurrent();
    music.errors = 0;
    music.plays.counts[id] = (music.plays.counts[id] || 0) + 1;
    music.plays.recent = [id, ...music.plays.recent.filter((r) => r !== id)].slice(0, 300);
    api("/api/music/played", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  if (Date.now() - (music.posAt || 0) > 4000) musicPosition();
  if (Date.now() - (music.savedAt || 0) > 5000) musicSave();
});
music.audio.addEventListener("ended", () => {
  if (music.repeat === "one") { music.audio.currentTime = 0; music.audio.play().catch(() => {}); return; }
  musicNext(true);
});
music.audio.addEventListener("error", () => {
  const s = muSong(muCurrent());
  if (!music.audio.getAttribute("src")) return;
  toast(`Can't play ${s?.title || "that song"}.`);
  // A few in a row that won't play: stop, rather than run through them all.
  if (++music.errors < 4) setTimeout(() => musicNext(true), 800); else music.errors = 0;
});
music.audio.addEventListener("volumechange", () => { if (music.built) musicBarUpdate(); });

// The phone's lock screen and the keyboard's media keys: previous and next
// song, like a phone's own player (no ±10 s buttons: with them, a phone
// shows those instead), and dragging along the song.
const muAction = (action, run) => { try { navigator.mediaSession.setActionHandler(action, run); } catch { /* not this browser */ } };
if ("mediaSession" in navigator) {
  muAction("play", () => music.audio.play().catch(() => {}));
  muAction("pause", () => music.audio.pause());
  muAction("previoustrack", musicPrevSong);
  muAction("seekto", (d) => { if (Number.isFinite(d.seekTime)) music.audio.currentTime = d.seekTime; });
}

// The lock screen's previous: the song before, straight away (the bar's
// button starts this one again first, once it's past 3 seconds; there that's
// what you'd expect, on a lock screen it just looks like nothing happened).
function musicPrevSong() {
  if (music.at > 0) { music.at--; return musicStart(true); }
  if (music.repeat === "all" && music.queue.length > 1) { music.at = music.queue.length - 1; return musicStart(true); }
  music.audio.currentTime = 0;
}

// Next only when there's a next one (greyed out on the lock screen otherwise).
function musicMediaNext() {
  if (!("mediaSession" in navigator)) return;
  const more = music.at < music.queue.length - 1 || (music.repeat === "all" && music.queue.length > 1) || Boolean(music.radio);
  muAction("nexttrack", more ? () => musicNext() : null);
}

// --------------------------------------------------- kept on this device

function musicSave() {
  music.savedAt = Date.now();
  const extra = {};
  for (const id of music.queue) if (id.startsWith("/") && music.extra.has(id)) extra[id] = music.extra.get(id);
  winSave(MUSIC_KEY, {
    queue: music.queue.slice(0, 3000), at: music.at, addedUntil: music.addedUntil, time: Math.floor(music.audio.currentTime || 0),
    original: music.original?.slice(0, 3000) || null, from: music.from, radio: music.radio, shuffle: music.shuffle, repeat: music.repeat,
    volume: music.audio.volume, sort: music.sort, panel: music.panel, extra,
  });
}

function musicSaveSoon() {
  clearTimeout(music.saveTimer);
  music.saveTimer = setTimeout(musicSave, 800);
}

// Where you were: the queue and the song (paused), shuffle, repeat, volume.
function musicRestore() {
  const saved = winLoad(MUSIC_KEY, null);
  if (!saved || typeof saved !== "object") return;
  for (const [id, s] of Object.entries(saved.extra || {})) if (s && id.startsWith("/")) music.extra.set(id, s);
  const ok = (id) => typeof id === "string" && muSong(id);
  Object.assign(music, {
    shuffle: Boolean(saved.shuffle), repeat: ["off", "all", "one"].includes(saved.repeat) ? saved.repeat : "off",
    sort: saved.sort && typeof saved.sort === "object" ? saved.sort : {}, from: saved.from || "", radio: saved.radio || null,
  });
  if (Number.isFinite(saved.volume)) music.audio.volume = Math.min(1, Math.max(0, saved.volume));
  const queue = Array.isArray(saved.queue) ? saved.queue : [];
  const current = queue[saved.at];
  music.queue = queue.filter(ok);
  music.original = Array.isArray(saved.original) ? saved.original.filter(ok) : null;
  music.at = ok(current) ? music.queue.indexOf(current) : -1;
  music.addedUntil = Math.max(music.at, Math.min(Number(saved.addedUntil) || -1, music.queue.length - 1));
  if (music.at >= 0 && !music.audio.getAttribute("src")) musicStart(false, saved.time || 0);
  if (saved.panel) musicSetPanel(saved.panel);
  musicBarUpdate();
}

// ------------------------------------------------- from My Computer

// A song from My Computer: plays here (in your library or not).
async function playSong(entry, path) {
  musicBuild();
  openWindow("music");
  if (!music.loaded) await musicLoad();
  const { status, body } = await api(`/api/music/track?id=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
  if (status !== 200) return toast(body?.error || `Can't play ${entry.name}.`);
  if (!music.songs.has(body.id)) music.extra.set(body.id, body);
  musicPlayList([body.id], 0, { from: "My Computer", shuffle: false });
}

// An .m3u8 (.m3u) from My Computer: its songs, in the queue.
async function musicPlayListFile(path) {
  musicBuild();
  openWindow("music");
  if (!music.loaded) await musicLoad();
  const { status, body } = await api(`/api/music/playlist?path=${encodeURIComponent(path)}`).catch(() => ({ status: 0 }));
  if (status !== 200) return toast(body?.error || "Can't open that playlist.");
  for (const [id, s] of Object.entries(body.songs || {})) music.extra.set(id, s);
  if (!body.items.length) return toast(`Nothing in ${body.name} plays${body.missing ? ` (${body.missing} not found)` : ""}.`);
  const own = music.playlists.find((p) => p.id === body.id);
  if (own) musicShow({ kind: "playlist", key: own.id });
  musicPlayList(body.items, 0, { from: body.name, shuffle: false });
  if (body.missing) toast(`${body.missing} of its songs aren't there.`);
}
