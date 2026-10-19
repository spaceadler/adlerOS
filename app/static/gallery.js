// Gallery: your photos and videos as Immich has them: the timeline (by
// month, then day, rows that fill the width), albums, people, favorites,
// On this day, and Immich's search (what's in a photo, in words). A photo
// opens big, with what Immich knows about it (when, where, the camera, who's
// in it, its albums); the arrows (or a swipe) go through the rest. adlerOS's
// server asks Immich (IMMICH_API_KEY): the page never sees the key. Months
// are fetched as you come to them, and let go when you're far past, so the
// whole library scrolls lightly. Uses el, svg, $, api, toast, openMenu,
// registerWindow, registerNav, openApp.
"use strict";

const GA_ICONS = {
  photos: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "m21 15-5-5L5 21", "M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  albums: ["M3 7h18v13H3z", "M6 4h12", "M8 1.5h8"],
  people: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  favorites: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  close: ["M18 6 6 18", "m6 6 12 12"], prev: ["m15 18-6-6 6-6"], next: ["m9 18 6-6-6-6"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  play: ["M7 4.5v15l12.5-7.5z"], live: ["M12 12h.01", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  immich: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  places: ["M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  map: ["M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z", "M8 2v16", "M16 6v16"],
  plus: ["M12 5v14", "M5 12h14"], minus: ["M5 12h14"],
};

const gallery = {
  built: false, status: null,
  view: { kind: "photos" }, back: [], fwd: [],
  albums: null, people: null, memories: null, showUnnamed: false,
  timeline: null, viewer: null, vdrawn: 0,
};

const gaThumb = (id, size = "thumbnail") => `/api/gallery/thumb/${id}?size=${size}`;
const gaQuery = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
const gaRowHeight = () => (phoneLayout() ? 112 : innerWidth < 1100 ? 160 : 200);
const GA_GAP = 4;

// When it was taken, as the camera's clock had it (Immich's local time).
function gaLocal(a) {
  return new Date(Date.parse(a.localDateTime || a.fileCreatedAt) + (a.localDateTime ? 0 : (a.localOffsetHours || 0) * 3600e3));
}
const gaDay = (d) => d.toISOString().slice(0, 10);
function gaDayLabel(d) {
  const today = gaDay(new Date(Date.now() - new Date().getTimezoneOffset() * 60e3));
  const day = gaDay(d);
  if (day === today) return "Today";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    ...(d.getUTCFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
const gaMonthLabel = (bucket) => new Date(`${bucket.slice(0, 10)}T00:00:00Z`).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });
const gaDuration = (ms) => {
  const s = Math.round((typeof ms === "string" ? ms.split(":").reduce((t, x) => t * 60 + Number(x), 0) * 1000 : ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function gaGet(path) {
  const { status, body } = await api(`/api/gallery/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status !== 200) throw new Error(body?.error || "Immich didn't answer");
  return body;
}

// ------------------------------------------------------------ the window

async function openGallery() {
  galleryBuild();
  openWindow("gallery");
  if (!gallery.status?.ok) await galleryCheck();
}

function toggleGallery() { toggleWindow("gallery", () => openGallery()); }

function closeGallery() {
  gaCloseViewer();
  closeWindow("gallery");
}

function galleryBuild() {
  if (gallery.built) return;
  gallery.built = true;
  const close = el("button", { class: "sheet-close ga-close", type: "button", "aria-label": "Close Gallery" }, svg(GA_ICONS.close));
  close.addEventListener("click", closeGallery);
  const search = el("input", { class: "field-input ga-search", id: "ga-search", type: "search", placeholder: "Search your photos", spellcheck: "false", autocomplete: "off" });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && search.value.trim()) gaShow({ kind: "search", query: search.value.trim() });
    if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; }
  });
  const section = el("section", { id: "gallery", class: "sheet gallery-app", "aria-label": "Gallery", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "ga-shell" },
      el("aside", { class: "ga-side" }, el("label", { class: "ga-search-box" }, svg(GA_ICONS.search), search),
        el("nav", { class: "ga-side-nav", id: "ga-side-nav", "aria-label": "Gallery" })),
      el("main", { class: "ga-main", id: "ga-main", tabindex: "-1" })));
  document.body.insertBefore(section, $("modal"));
  registerWindow("gallery", { title: "Gallery", close: closeGallery, hide: () => closeWindow("gallery"), dock: "gallery", size: [1200, 800] });
  section.addEventListener("keydown", gaKeys);
  let resizeTimer = null;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(gaRelayout, 150); }).observe($("ga-main"));
  gaRenderSide();
}

async function galleryCheck() {
  $("ga-main").replaceChildren(el("div", { class: "ga-empty" }, el("p", {}, "Asking Immich…")));
  gallery.status = await gaGet("status").catch((e) => ({ error: e.message }));
  // Without these it can't show a thing: as good as no key.
  if (gallery.status.ok && gallery.status.missing?.some((p) => p === "asset.read" || p === "asset.view")) {
    gallery.status = { ...gallery.status, ok: false, error: "refused" };
  }
  gaRender();
}

function gaRenderSide() {
  const nav = $("ga-side-nav");
  if (!nav) return;
  const v = gallery.view;
  const item = (kind, label, icon) => {
    const on = v.kind === kind || (kind === "albums" && v.kind === "album") || (kind === "people" && v.kind === "person") || (kind === "places" && v.kind === "place");
    const b = el("button", { type: "button", class: `ga-nav${on ? " on" : ""}` }, svg(GA_ICONS[icon]), el("span", {}, label));
    b.addEventListener("click", () => gaShow({ kind }));
    return b;
  };
  nav.replaceChildren(item("photos", "Photos", "photos"), item("albums", "Albums", "albums"), item("people", "People", "people"),
    item("places", "Places", "places"), item("map", "Map", "map"), item("favorites", "Favorites", "favorites"));
  const immich = gaImmichApp();
  if (immich) {
    const b = el("button", { type: "button", class: "ga-nav ga-nav-out" }, svg(GA_ICONS.immich), el("span", {}, "Open Immich"));
    b.addEventListener("click", () => openApp(immich));
    nav.append(b);
  }
}

const gaImmichApp = () => (typeof appById === "function" ? appById("immich") : null);

function gaKeys(e) {
  if (gallery.viewer) return gaViewerKeys(e);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); $("ga-search").focus(); }
}

// ------------------------------------------------------- moving around

function gaShow(view, push = true) {
  if (push && (view.kind !== gallery.view.kind || view.key !== gallery.view.key || view.query !== gallery.view.query)) {
    gallery.back = [...gallery.back, { ...gallery.view, scroll: $("ga-main").scrollTop }].slice(-50);
    gallery.fwd = [];
  }
  gallery.view = { ...view };
  gaRender();
  gaRenderSide();
}

function gaNav(dir) {
  if (gallery.viewer) return dir < 0 ? gaStep(-1) : gaStep(1);
  const to = (dir < 0 ? gallery.back : gallery.fwd).pop();
  if (!to) return;
  (dir < 0 ? gallery.fwd : gallery.back).push({ ...gallery.view, scroll: $("ga-main").scrollTop });
  gallery.view = to;
  $("ga-search").value = to.kind === "search" ? to.query : "";
  gaRender(to.scroll || 0);
  gaRenderSide();
}
registerNav("gallery", (dir) => gaNav(dir));

function gaRender(scroll = 0) {
  const main = $("ga-main");
  gaStopTimeline();
  gallery.grid = null;
  gallery.map = null;
  if (!gallery.status?.ok) return main.replaceChildren(gaSetupPage());
  const v = gallery.view;
  const page = el("div", { class: "ga-page" });
  // A key that can't do all of it: what's missing (On this day, say).
  if (gallery.status.missing?.length) page.append(el("p", { class: "ga-note" }, `Immich's key can't ${gallery.status.missing.join(", ")}: some of Gallery won't show. A new key with those permissions fixes it.`));
  main.replaceChildren(page);
  main.scrollTop = 0;
  const go = {
    photos: () => gaPhotosView(page),
    favorites: () => gaTimelineInto(page, { isFavorite: "true", visibility: "timeline", order: "desc" }, { title: "Favorites" }),
    albums: () => gaAlbumsView(page),
    album: () => gaAlbumView(page, v.key),
    people: () => gaPeopleView(page),
    person: () => gaPersonView(page, v.key),
    search: () => gaSearchView(page, { query: v.query }, `“${v.query}”`, "Search"),
    places: () => gaPlacesView(page),
    place: () => gaSearchView(page, { city: v.key, country: v.country || null }, v.key, v.country || "Place"),
    map: () => gaMapView(page),
  }[v.kind] || (() => gaPhotosView(page));
  Promise.resolve(go()).then(() => { if (scroll) requestAnimationFrame(() => { main.scrollTop = scroll; }); })
    .catch((e) => { if (e.message !== "login") page.replaceChildren(el("div", { class: "ga-empty" }, el("p", {}, e.message))); });
}

// Not set up yet, or Immich said no: what to do about it.
function gaSetupPage() {
  const s = gallery.status || {};
  const retry = el("button", { type: "button", class: "button-primary" }, "Try again");
  retry.addEventListener("click", galleryCheck);
  const perms = el("p", { class: "ga-perms" }, ...(s.permissions || []).map((p) => el("code", {}, p)));
  const body = s.error === "noimmich"
    ? [el("h2", {}, "Gallery shows your photos from Immich"), el("p", {}, "Immich isn't among your apps here. If it runs elsewhere, set IMMICH_URL in adlerOS's settings file (.env) to its address.")]
    : s.error === "nokey"
      ? [el("h2", {}, "Gallery shows your photos from Immich"),
        el("p", {}, "It needs a key from Immich: in Immich, Account Settings → API Keys → New API Key, with these permissions (it only reads):"), perms,
        el("p", {}, "Then put it in adlerOS's settings file (.env) as IMMICH_API_KEY=…, and restart adlerOS."),
        el("p", { class: "ga-dim" }, `It'll ask Immich at ${s.url}.`)]
      : s.error === "refused"
        ? [el("h2", {}, "Immich didn't take the key"), el("p", {}, "IMMICH_API_KEY in adlerOS's settings file isn't one Immich knows (deleted, or mistyped). Make a new one, with these permissions:"), perms]
        : [el("h2", {}, "Can't reach Immich"), el("p", {}, s.error ? `${s.url || "Immich"}: ${s.error}` : "Immich didn't answer.")];
  return el("div", { class: "ga-empty ga-setup" }, ...body, retry);
}

// ---------------------------------------------------------- the timeline

// A timeline: Immich's months for these params (an album's, a person's,
// favorites…), each fetched once it's near, laid out in rows by day.
async function gaTimelineInto(page, params, { title = "", sub = "", head = null, empty = "No photos here yet." } = {}) {
  const buckets = await gaGet(`buckets?${gaQuery(params)}`);
  const total = buckets.reduce((n, b) => n + b.count, 0);
  const box = el("div", { class: "ga-timeline" });
  const tl = { params, box, buckets: buckets.map((b) => ({ ...b, assets: null, body: null, height: 0, shown: false, loading: null })) };
  if (head) page.append(head);
  else if (title) page.append(el("header", { class: "ga-head" }, el("h1", {}, title), el("p", { class: "ga-dim" }, sub || `${total.toLocaleString()} ${total === 1 ? "item" : "items"}`)));
  if (!total) { page.append(el("p", { class: "ga-dim ga-none" }, empty)); return; }
  page.append(box);
  const width = () => box.clientWidth || $("ga-main").clientWidth - 48;
  tl.buckets.forEach((b, i) => {
    b.body = el("div", { class: "ga-month-body" });
    b.body.style.height = `${gaEstimate(b.count, width())}px`;
    b.section = el("section", { class: "ga-month", "data-i": String(i) }, el("h2", { class: "ga-month-title" }, gaMonthLabel(b.timeBucket)), b.body);
    box.append(b.section);
  });
  tl.observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const b = tl.buckets[Number(en.target.dataset.i)];
      if (en.isIntersecting) gaShowBucket(tl, b); else gaHideBucket(b);
    }
  }, { root: $("ga-main"), rootMargin: "1600px 0px" });
  for (const b of tl.buckets) tl.observer.observe(b.section);
  gallery.timeline = tl;
}

function gaStopTimeline() {
  gallery.timeline?.observer?.disconnect();
  gallery.timeline = null;
}

function gaEstimate(count, width) {
  const h = gaRowHeight();
  const perRow = Math.max(1, (width + GA_GAP) / (h * 1.25 + GA_GAP));
  return Math.ceil(count / perRow) * (h + GA_GAP) + Math.ceil(count / 12) * 34;
}

async function gaLoadBucket(tl, b) {
  if (b.assets) return b.assets;
  b.loading ||= gaGet(`bucket?${gaQuery({ ...tl.params, timeBucket: b.timeBucket })}`).then((c) => {
    b.assets = c.id.map((id, k) => ({ id, ratio: c.ratio[k], isImage: c.isImage[k], isFavorite: c.isFavorite[k], fileCreatedAt: c.fileCreatedAt[k],
      localOffsetHours: c.localOffsetHours[k], duration: c.duration[k], livePhotoVideoId: c.livePhotoVideoId?.[k] || null }));
    return b.assets;
  });
  try { return await b.loading; } finally { b.loading = null; }
}

async function gaShowBucket(tl, b) {
  if (b.shown) return;
  b.shown = true;
  const assets = await gaLoadBucket(tl, b).catch(() => null);
  if (!assets || !b.shown || gallery.timeline !== tl) return;
  gaDrawBucket(tl, b);
}

function gaDrawBucket(tl, b) {
  const width = tl.box.clientWidth;
  b.body.replaceChildren(...gaLayout(b.assets, width).map((day) => el("div", { class: "ga-day" },
    el("h3", { class: "ga-day-title" }, day.label),
    ...day.rows.map((row) => el("div", { class: "ga-row" }, ...row.map(({ a, w, h }) => gaTile(a, w, h, tl)))))));
  b.body.style.height = "";
  b.height = b.body.offsetHeight;
}

// Far past: let go of its pictures, keep its place.
function gaHideBucket(b) {
  if (!b.shown) return;
  b.shown = false;
  if (!b.body.childElementCount) return;
  b.height = b.body.offsetHeight || b.height;
  b.body.replaceChildren();
  b.body.style.height = `${b.height}px`;
}

function gaRelayout() {
  const tl = gallery.timeline;
  gaDrawFaces();
  if (gallery.map) return gallery.map.redraw();
  if (!tl) return gallery.grid?.redraw();
  const width = tl.box.clientWidth;
  for (const b of tl.buckets) {
    if (b.shown && b.assets) gaDrawBucket(tl, b);
    else b.body.style.height = `${b.height && b.assets ? b.height : gaEstimate(b.count, width)}px`;
  }
}

// Rows that fill the width, each at about the same height; a day's last row
// as it is (not stretched).
function gaLayout(assets, width, { byDay = true } = {}) {
  const target = gaRowHeight();
  const days = [];
  for (const a of assets) {
    const d = gaLocal(a);
    const key = byDay ? gaDay(d) : "all";
    if (days[days.length - 1]?.key !== key) days.push({ key, label: byDay ? gaDayLabel(d) : "", assets: [] });
    days[days.length - 1].assets.push(a);
  }
  return days.map((day) => {
    const rows = [];
    let row = [];
    let sum = 0;
    for (const a of day.assets) {
      const r = Math.min(3, Math.max(0.45, a.ratio || 1));
      row.push([a, r]);
      sum += r;
      const free = width - (row.length - 1) * GA_GAP;
      if (sum * target >= free) {
        const h = free / sum;
        rows.push(row.map(([x, rx]) => ({ a: x, w: rx * h, h })));
        row = [];
        sum = 0;
      }
    }
    if (row.length) rows.push(row.map(([x, rx]) => ({ a: x, w: rx * target, h: target })));
    return { ...day, rows };
  });
}

function gaTile(a, w, h, source) {
  // Low: the photo you open goes ahead of a few hundred of these.
  const img = el("img", { src: gaThumb(a.id), alt: "", loading: "lazy", decoding: "async", draggable: "false", fetchpriority: "low" });
  img.addEventListener("error", () => img.remove());
  const tile = el("button", { type: "button", class: "ga-tile", "data-id": a.id, "aria-label": a.isImage ? "Photo" : "Video" }, img,
    ...(!a.isImage ? [el("span", { class: "ga-badge" }, svg(GA_ICONS.play), gaDuration(a.duration))] : []),
    ...(a.livePhotoVideoId ? [el("span", { class: "ga-badge ga-live" }, svg(GA_ICONS.live))] : []),
    ...(a.isFavorite ? [el("span", { class: "ga-fav" }, svg(GA_ICONS.favorites))] : []));
  tile.style.width = `${Math.floor(w)}px`;
  tile.style.height = `${Math.floor(h)}px`;
  tile.addEventListener("click", () => gaOpen(source, a.id));
  return tile;
}

// -------------------------------------------------------------- views

async function gaPhotosView(page) {
  const memories = await gaGet("memories").catch(() => []);
  gallery.memories = memories.filter((m) => m.assets?.length);
  const head = el("header", { class: "ga-head" }, el("h1", {}, "Photos"));
  page.append(head);
  if (gallery.memories.length) {
    const year = new Date().getFullYear();
    page.append(el("section", { class: "ga-memories" }, el("h2", { class: "ga-month-title" }, "On this day"),
      el("div", { class: "ga-shelf" }, ...gallery.memories.map((m) => {
        const ago = m.data?.year ? year - m.data.year : null;
        const assets = m.assets.map((a) => ({ ...a, isImage: a.type === "IMAGE" }));
        const card = el("button", { type: "button", class: "ga-memory" },
          el("img", { src: gaThumb(m.assets[0].id, "preview"), alt: "", loading: "lazy" }),
          el("span", { class: "ga-memory-text" }, ago ? `${ago} year${ago === 1 ? "" : "s"} ago` : "A memory", el("small", {}, `${m.assets.length} items`)));
        card.addEventListener("click", () => gaOpen({ list: assets }, assets[0].id));
        return card;
      }))));
  }
  await gaTimelineInto(page, { visibility: "timeline", order: "desc" });
  const total = gallery.timeline?.buckets.reduce((n, b) => n + b.count, 0) || 0;
  head.append(el("p", { class: "ga-dim" }, `${total.toLocaleString()} photos and videos`));
}

async function gaAlbumsView(page) {
  gallery.albums = await gaGet("albums");
  const albums = [...gallery.albums].sort((a, b) => String(b.endDate || b.updatedAt).localeCompare(String(a.endDate || a.updatedAt)));
  page.append(el("header", { class: "ga-head" }, el("h1", {}, "Albums"), el("p", { class: "ga-dim" }, `${albums.length} albums`)),
    el("div", { class: "ga-cards" }, ...albums.map((al) => {
      const years = [al.startDate, al.endDate].filter(Boolean).map((d) => new Date(d).getFullYear());
      const when = years.length ? (years[0] === years[years.length - 1] ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : "";
      const art = el("span", { class: "ga-card-art" });
      if (al.albumThumbnailAssetId) {
        const img = el("img", { src: gaThumb(al.albumThumbnailAssetId), alt: "", loading: "lazy", fetchpriority: "low" });
        img.addEventListener("error", () => img.remove());
        art.append(img);
      }
      const card = el("button", { type: "button", class: "ga-card" }, art, el("span", { class: "ga-card-title" }, al.albumName),
        el("span", { class: "ga-card-sub" }, [`${al.assetCount.toLocaleString()} items`, when].filter(Boolean).join(" · ")));
      card.addEventListener("click", () => gaShow({ kind: "album", key: al.id }));
      return card;
    })));
}

async function gaAlbumView(page, id) {
  const al = (gallery.albums || []).find((a) => a.id === id) || await gaGet(`album/${id}`);
  const range = [al.startDate, al.endDate].filter(Boolean).map((d) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }));
  const download = el("button", { type: "button", class: "button-secondary ga-head-button" }, svg(GA_ICONS.download), "Download");
  download.addEventListener("click", () => gaDownloadAlbum(al, download));
  const head = el("header", { class: "ga-head" }, el("p", { class: "ga-kicker" }, "Album"), el("h1", {}, al.albumName),
    el("p", { class: "ga-dim" }, [`${al.assetCount.toLocaleString()} items`, [...new Set(range)].join(" – ")].filter(Boolean).join(" · ")),
    ...(al.description ? [el("p", { class: "ga-desc" }, al.description)] : []), ...(al.assetCount ? [download] : []));
  await gaTimelineInto(page, { albumId: id, order: al.order === "asc" ? "asc" : "desc" }, { head, empty: "This album is empty." });
}

// An album as a zip (in parts, if it's big: Immich's split).
async function gaDownloadAlbum(al, button) {
  button.disabled = true;
  const info = await gaGet(`album-zip-info/${al.id}`).catch((e) => { toast(e.message); return null; });
  button.disabled = false;
  if (!info?.parts.length) return;
  const get = (i) => {
    const a = el("a", { href: `/api/gallery/album-zip/${al.id}?part=${i}`, download: "" });
    document.body.append(a);
    a.click();
    a.remove();
    toast(`Downloading ${al.albumName}${info.parts.length > 1 ? ` (${i + 1} of ${info.parts.length})` : ""}, ${bytes(info.parts[i])}. Immich zips it first: it may take a moment to start.`);
  };
  if (info.parts.length === 1) return get(0);
  const r = button.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, info.parts.map((size, i) => ({ label: `Part ${i + 1} of ${info.parts.length} (${bytes(size)})`, run: () => get(i) })));
}

async function gaPlacesView(page) {
  const cities = (await gaGet("cities")).filter((c) => c.city).sort((a, b) => a.city.localeCompare(b.city));
  page.append(el("header", { class: "ga-head" }, el("h1", {}, "Places"), el("p", { class: "ga-dim" }, `${cities.length} places`)),
    el("div", { class: "ga-cards" }, ...cities.map((c) => {
      const img = el("img", { src: gaThumb(c.id), alt: "", loading: "lazy", fetchpriority: "low" });
      img.addEventListener("error", () => img.remove());
      const card = el("button", { type: "button", class: "ga-card" }, el("span", { class: "ga-card-art" }, img),
        el("span", { class: "ga-card-title" }, c.city), el("span", { class: "ga-card-sub" }, [c.state, c.country].filter((x) => x && x !== c.city).join(", ")));
      card.addEventListener("click", () => gaShow({ kind: "place", key: c.city, country: c.country }));
      return card;
    })));
}

async function gaPeopleView(page) {
  gallery.people = (await gaGet("people")).people;
  const named = gallery.people.filter((p) => p.name);
  const unnamed = gallery.people.filter((p) => !p.name);
  const face = (p) => {
    const img = el("img", { src: `/api/gallery/face/${p.id}`, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.remove());
    const b = el("button", { type: "button", class: "ga-person" }, el("span", { class: "ga-face" }, img), el("span", { class: "ga-card-title" }, p.name || "Unnamed"));
    b.addEventListener("click", () => gaShow({ kind: "person", key: p.id }));
    return b;
  };
  const more = el("button", { type: "button", class: "ga-link" }, gallery.showUnnamed ? "Hide the ones without a name" : `Show ${unnamed.length} without a name`);
  more.addEventListener("click", () => { gallery.showUnnamed = !gallery.showUnnamed; gaRender($("ga-main").scrollTop); });
  page.append(el("header", { class: "ga-head" }, el("h1", {}, "People"), el("p", { class: "ga-dim" }, `${named.length} with names`)),
    el("div", { class: "ga-people" }, ...named.map(face)),
    ...(unnamed.length ? [more, ...(gallery.showUnnamed ? [el("div", { class: "ga-people" }, ...unnamed.slice(0, 600).map(face))] : [])] : []));
}

async function gaPersonView(page, id) {
  const p = (gallery.people || []).find((x) => x.id === id) || await gaGet(`person/${id}`);
  const img = el("img", { src: `/api/gallery/face/${id}`, alt: "" });
  img.addEventListener("error", () => img.remove());
  const head = el("header", { class: "ga-head ga-person-head" }, el("span", { class: "ga-face big" }, img),
    el("div", {}, el("p", { class: "ga-kicker" }, "Person"), el("h1", {}, p.name || "Unnamed")));
  await gaTimelineInto(page, { personId: id, order: "desc" }, { head });
}

// Immich's own search (what's in the photo, in words), or a place's
// photos: a page of them at a time.
async function gaSearchView(page, ask, title, kicker) {
  const results = { list: [], next: 1 };
  const grid = el("div", { class: "ga-timeline" });
  const more = el("button", { type: "button", class: "button-secondary ga-more" }, "More");
  const head = el("p", { class: "ga-dim" }, "Looking…");
  page.append(el("header", { class: "ga-head" }, el("p", { class: "ga-kicker" }, kicker), el("h1", {}, title), head), grid);
  // A place's: by day, as the timeline is; a search's: best first.
  const byDay = Boolean(ask.city);
  const draw = () => {
    grid.replaceChildren(...gaLayout(results.list, grid.clientWidth, { byDay }).map((d) => el("div", { class: "ga-day" },
      ...(byDay ? [el("h3", { class: "ga-day-title" }, d.label)] : []),
      ...d.rows.map((row) => el("div", { class: "ga-row" }, ...row.map(({ a, w, h }) => gaTile(a, w, h, results)))))));
  };
  const load = async () => {
    more.disabled = true;
    const { status, body } = await api("/api/gallery/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ask, page: results.next }) })
      .catch(() => ({ status: 0 }));
    more.disabled = false;
    if (status !== 200) { head.textContent = body?.error || "Immich didn't answer."; return; }
    results.list.push(...body.items);
    results.next = body.nextPage ? Number(body.nextPage) : null;
    const n = `${results.list.length}${results.next ? "+" : ""}`;
    head.textContent = !results.list.length ? "Nothing matches." : ask.city ? `${n} photos and videos` : `${n} matches`;
    draw();
    if (results.next) page.append(more); else more.remove();
  };
  more.addEventListener("click", load);
  gallery.grid = { redraw: draw };
  await load();
}

// ---------------------------------------------------------- the viewer

// source: a timeline (its months, fetched as you go) or {list: [assets]}.
async function gaOpen(source, id) {
  const viewer = gallery.viewer || gaBuildViewer();
  viewer.source = source;
  await gaShowAsset(id);
}

function gaBuildViewer() {
  const stage = el("div", { class: "ga-stage" });
  const button = (label, icon, run, extra = "") => {
    const b = el("button", { type: "button", class: `ga-vbutton ${extra}`, title: label, "aria-label": label }, svg(GA_ICONS[icon]));
    b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
    return b;
  };
  const title = el("div", { class: "ga-vtitle" });
  const info = el("aside", { class: "ga-info" });
  const live = button("Play the Live Photo", "live", () => gaPlayLive(), "ga-vlive");
  const box = el("div", { class: "ga-viewer", role: "dialog", "aria-label": "Photo", tabindex: "-1" },
    el("div", { class: "ga-vbar" }, button("Close (Escape)", "close", gaCloseViewer), title, el("span", { class: "ga-vgap" }), live,
      button("Info (i)", "info", () => { gallery.viewer.info = !gallery.viewer.info; gaRenderInfo(); }, "ga-vinfo"),
      button("Download the original", "download", () => gaDownload())),
    stage, button("Previous (←)", "prev", () => gaStep(-1), "ga-vprev"), button("Next (→)", "next", () => gaStep(1), "ga-vnext"), info);
  // A swipe: sideways for the next or the last one, down to close.
  let start = null;
  stage.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") start = { x: e.clientX, y: e.clientY }; });
  stage.addEventListener("pointerup", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) gaStep(dx < 0 ? 1 : -1);
    else if (dy > 110) gaCloseViewer();
  });
  stage.addEventListener("pointercancel", () => { start = null; });
  $("gallery").append(box);
  gallery.viewer = { box, stage, title, infoBox: info, live, info: false, id: null, asset: null, token: 0 };
  box.focus({ preventScroll: true });
  return gallery.viewer;
}

function gaCloseViewer() {
  const v = gallery.viewer;
  if (!v) return;
  v.box.querySelectorAll("video").forEach((n) => n.pause());
  v.box.remove();
  gallery.viewer = null;
  const tile = $("ga-main")?.querySelector(`.ga-tile[data-id="${v.id}"]`);
  (tile || $("ga-main"))?.focus({ preventScroll: true });
}

// Where this one is in what it came from, and the one before or after.
async function gaNeighbor(source, id, dir) {
  if (source.list) {
    const i = source.list.findIndex((a) => a.id === id);
    return source.list[i + dir] || null;
  }
  const tl = source;
  let bi = tl.buckets.findIndex((b) => b.assets?.some((a) => a.id === id));
  if (bi < 0) return null;
  let i = tl.buckets[bi].assets.findIndex((a) => a.id === id) + dir;
  while (bi >= 0 && bi < tl.buckets.length) {
    const assets = await gaLoadBucket(tl, tl.buckets[bi]);
    if (i >= 0 && i < assets.length) return assets[i];
    bi += dir;
    if (bi < 0 || bi >= tl.buckets.length) return null;
    const next = await gaLoadBucket(tl, tl.buckets[bi]);
    i = dir > 0 ? 0 : next.length - 1;
  }
  return null;
}

function gaFind(source, id) {
  if (source.list) return source.list.find((a) => a.id === id);
  for (const b of source.buckets) { const a = b.assets?.find((x) => x.id === id); if (a) return a; }
  return null;
}

async function gaStep(dir) {
  const v = gallery.viewer;
  if (!v) return;
  const next = await gaNeighbor(v.source, v.id, dir);
  if (next && gallery.viewer === v) gaShowAsset(next.id);
}

async function gaShowAsset(id) {
  const v = gallery.viewer;
  const a = gaFind(v.source, id) || { id, isImage: true };
  v.id = id;
  v.asset = null;
  const token = ++v.token;
  // The small one at once (it's there already), the big one over it when it comes.
  let media;
  if (a.isImage === false) {
    media = el("video", { src: `/api/gallery/video/${id}`, controls: "", autoplay: "", playsinline: "", poster: gaThumb(id, "preview") });
  } else {
    media = el("img", { class: "ga-full", src: gaThumb(id), alt: "", fetchpriority: "high" });
    const big = new Image();
    big.fetchPriority = "high";
    big.addEventListener("load", () => { if (v.token === token) media.src = big.src; });
    big.src = gaThumb(id, "preview");
  }
  v.stage.replaceChildren(media);
  v.live.hidden = !a.livePhotoVideoId;
  // Its day, if it's known yet (a photo from the map isn't, until Immich says).
  v.title.textContent = a.fileCreatedAt || a.localDateTime ? gaDayLabel(gaLocal(a)) : "";
  // Its neighbours' pictures, ready for the arrows.
  for (const dir of [1, -1]) {
    gaNeighbor(v.source, id, dir).then((n) => {
      if (!n) return;
      const pre = new Image();
      pre.fetchPriority = "low";
      pre.src = gaThumb(n.id, "preview");
    });
  }
  const asset = await gaGet(`asset/${id}`).catch(() => null);
  if (v.token !== token || !asset) return;
  v.asset = asset;
  v.title.textContent = `${gaWhen(asset)} · ${asset.originalFileName}`;
  v.live.hidden = !asset.livePhotoVideoId;
  if (asset.type === "VIDEO" && media.tagName === "IMG") {
    v.stage.replaceChildren(el("video", { src: `/api/gallery/video/${id}`, controls: "", autoplay: "", playsinline: "", poster: gaThumb(id, "preview") }));
  }
  if (media.tagName === "IMG") media.addEventListener("load", () => gaDrawFaces(), { once: false });
  v.faces = null;
  gaRenderInfo();
  if (asset.type === "IMAGE") {
    v.faces = await gaGet(`faces/${id}`).catch(() => []);
    if (v.token === token) gaDrawFaces();
  }
}

// Who's where in it (Immich's face boxes), over the photo while its info
// is out: a name's box lights up as you point at the name.
function gaDrawFaces() {
  const v = gallery.viewer;
  if (!v) return;
  v.stage.querySelector(".ga-faces")?.remove();
  const img = v.stage.querySelector("img.ga-full");
  if (!v.info || !img || !v.faces?.length || !img.naturalWidth) return;
  const s = v.stage.getBoundingClientRect();
  const r = img.getBoundingClientRect();
  const layer = el("div", { class: "ga-faces" });
  Object.assign(layer.style, { left: `${r.left - s.left}px`, top: `${r.top - s.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  for (const f of v.faces) {
    const [x1, y1, x2, y2] = f.box;
    const [w, h] = f.size;
    if (!w || !h) continue;
    const box = el("div", { class: "ga-face-box", "data-person": f.person?.id || "" }, ...(f.person?.name ? [el("span", {}, f.person.name)] : []));
    Object.assign(box.style, { left: `${(x1 / w) * 100}%`, top: `${(y1 / h) * 100}%`, width: `${((x2 - x1) / w) * 100}%`, height: `${((y2 - y1) / h) * 100}%` });
    layer.append(box);
  }
  v.stage.append(layer);
}

function gaWhen(asset) {
  const d = new Date(asset.localDateTime);
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

async function gaRenderInfo() {
  const v = gallery.viewer;
  v.box.classList.toggle("with-info", v.info);
  requestAnimationFrame(gaDrawFaces); // the photo's room changes with the info beside it
  if (!v.info || !v.asset) return v.infoBox.replaceChildren();
  const a = v.asset;
  const e = a.exifInfo || {};
  const row = (label, ...value) => (value.filter(Boolean).length ? el("div", { class: "ga-irow" }, el("span", { class: "ga-ilabel" }, label), el("span", {}, ...value.filter(Boolean))) : "");
  const w = e.exifImageWidth || a.width;
  const h = e.exifImageHeight || a.height;
  const exposure = [e.fNumber ? `ƒ/${Number(e.fNumber).toFixed(1).replace(/\.0$/, "")}` : "", e.exposureTime ? `${e.exposureTime} s` : "",
    e.iso ? `ISO ${e.iso}` : "", e.focalLength ? `${Math.round(e.focalLength)} mm` : ""].filter(Boolean).join("  ");
  const place = [e.city, e.state, e.country].filter(Boolean).join(", ");
  const people = (a.people || []).filter((p) => p.name).map((p) => {
    const b = el("button", { type: "button", class: "ga-chip" }, p.name);
    b.addEventListener("click", () => { gaCloseViewer(); gaShow({ kind: "person", key: p.id }); });
    const light = (on) => v.stage.querySelectorAll(`.ga-face-box[data-person="${p.id}"]`).forEach((n) => n.classList.toggle("lit", on));
    b.addEventListener("pointerenter", () => light(true));
    b.addEventListener("pointerleave", () => light(false));
    return b;
  });
  const unnamed = (a.people || []).filter((p) => !p.name).length;
  if (unnamed) people.push(el("span", { class: "ga-dim" }, `and ${unnamed} without a name`));
  const albumsBox = el("div", { class: "ga-chips" });
  v.infoBox.replaceChildren(el("h3", {}, "Info"),
    ...(e.description ? [el("p", { class: "ga-desc" }, e.description)] : []),
    row("Taken", gaWhen(a)),
    row("File", a.originalFileName, el("small", {}, [w && h ? `${w} × ${h}` : "", w && h ? `${((w * h) / 1e6).toFixed(1)} MP` : "", e.fileSizeInByte ? bytes(e.fileSizeInByte) : ""].filter(Boolean).join(" · "))),
    row("Camera", [e.make, e.model].filter(Boolean).join(" "), e.lensModel ? el("small", {}, e.lensModel) : "", exposure ? el("small", {}, exposure) : ""),
    row("Place", place, Number.isFinite(e.latitude) && Number.isFinite(e.longitude) ? el("small", {}, `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`) : ""),
    ...(people.length ? [el("div", { class: "ga-irow" }, el("span", { class: "ga-ilabel" }, "People"), el("div", { class: "ga-chips" }, ...people))] : []),
    el("div", { class: "ga-irow" }, el("span", { class: "ga-ilabel" }, "Albums"), albumsBox));
  const albums = await gaGet(`albums-of/${a.id}`).catch(() => []);
  if (gallery.viewer !== v || v.asset !== a) return;
  albumsBox.replaceChildren(...(albums.length ? albums.map((al) => {
    const b = el("button", { type: "button", class: "ga-chip" }, al.albumName);
    b.addEventListener("click", () => { gaCloseViewer(); gaShow({ kind: "album", key: al.id }); });
    return b;
  }) : [el("span", { class: "ga-dim" }, "None")]));
}

// A Live Photo: its few seconds, over the still, then the still again.
function gaPlayLive() {
  const v = gallery.viewer;
  const a = gaFind(v.source, v.id);
  if (!a?.livePhotoVideoId) return;
  const video = el("video", { class: "ga-live-video", src: `/api/gallery/video/${a.livePhotoVideoId}`, autoplay: "", playsinline: "", muted: "" });
  video.addEventListener("ended", () => video.remove());
  video.addEventListener("error", () => video.remove());
  v.stage.append(video);
}

function gaDownload() {
  const v = gallery.viewer;
  if (!v?.id) return;
  const a = el("a", { href: `/api/gallery/original/${v.id}`, download: v.asset?.originalFileName || "" });
  document.body.append(a);
  a.click();
  a.remove();
}

function gaViewerKeys(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return gaCloseViewer(); }
  if (e.target.closest("input, textarea")) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); return gaStep(-1); }
  if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); return gaStep(1); }
  if (e.key === "i") { gallery.viewer.info = !gallery.viewer.info; gaRenderInfo(); }
}

// ---------------------------------------------------------------- the map

// Where they were taken: OpenStreetMap's map (CARTO's dark tiles), your
// photos on it in clusters (a click shows a cluster's, a double click or the
// wheel zooms, a drag moves it; two fingers on a phone).
const GA_TILE = 256;
const gaTileUrl = (z, x, y) => `https://${"abcd"[(x + y) % 4]}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}${devicePixelRatio > 1 ? "@2x" : ""}.png`;
const gaMercator = (lat, lon) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};

async function gaMapView(page) {
  const markers = (await gaGet("markers")).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon))
    .map((m) => { const [x, y] = gaMercator(m.lat, m.lon); return { ...m, x, y }; });
  page.classList.add("ga-map-page");
  const tiles = el("div", { class: "ga-tiles" });
  const pins = el("div", { class: "ga-pins" });
  const panel = el("aside", { class: "ga-map-panel", hidden: "" });
  const zoomButton = (label, icon, dz) => {
    const b = el("button", { type: "button", class: "ga-vbutton", title: label, "aria-label": label }, svg(GA_ICONS[icon]));
    b.addEventListener("click", (e) => { e.stopPropagation(); zoomAt(map.z + dz); });
    return b;
  };
  const box = el("div", { class: "ga-map", tabindex: "0", "aria-label": "Map of your photos" }, tiles, pins,
    el("div", { class: "ga-map-zoom" }, zoomButton("Zoom in", "plus", 1), zoomButton("Zoom out", "minus", -1)),
    el("div", { class: "ga-map-credit" }, "© OpenStreetMap contributors · © CARTO"), panel);
  page.append(el("header", { class: "ga-head" }, el("h1", {}, "Map"), el("p", { class: "ga-dim" }, `${markers.length.toLocaleString()} photos with a place`)), box);
  const map = { z: 2, cx: 0.5, cy: 0.5, cache: new Map() };
  gallery.map = { redraw: () => draw() };

  // At first: all of them in view.
  if (markers.length) {
    const xs = markers.map((m) => m.x).sort((a, b) => a - b);
    const ys = markers.map((m) => m.y).sort((a, b) => a - b);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
    const [x0, x1, y0, y1] = [q(xs, 0.01), q(xs, 0.99), q(ys, 0.01), q(ys, 0.99)]; // the odd far one doesn't zoom it all out
    map.cx = (x0 + x1) / 2;
    map.cy = (y0 + y1) / 2;
    const w = box.clientWidth || 800;
    const h = box.clientHeight || 500;
    map.z = Math.max(1, Math.min(14, Math.floor(Math.log2(Math.min(w / ((x1 - x0) * GA_TILE || 1), h / ((y1 - y0) * GA_TILE || 1))))));
  }

  // pinsToo: false while dragging (the pins slide along; drawn again after).
  function draw(pinsToo = true) {
    if (!box.isConnected) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const world = GA_TILE * 2 ** map.z;
    const left = map.cx * world - w / 2;
    const top = map.cy * world - h / 2;
    const n = 2 ** map.z;
    const keep = new Set();
    for (let ty = Math.max(0, Math.floor(top / GA_TILE)); ty <= Math.min(n - 1, Math.floor((top + h) / GA_TILE)); ty++) {
      for (let tx = Math.floor(left / GA_TILE); tx <= Math.floor((left + w) / GA_TILE); tx++) {
        const x = ((tx % n) + n) % n;
        const key = `${map.z}/${tx}/${ty}`;
        keep.add(key);
        let img = map.cache.get(key);
        if (!img) {
          img = el("img", { class: "ga-tile-img", src: gaTileUrl(map.z, x, ty), alt: "", draggable: "false" });
          map.cache.set(key, img);
        }
        img.style.transform = `translate(${Math.round(tx * GA_TILE - left)}px, ${Math.round(ty * GA_TILE - top)}px)`;
        if (!img.isConnected) tiles.append(img);
      }
    }
    for (const [key, img] of map.cache) if (!keep.has(key)) { img.remove(); if (map.cache.size > 300) map.cache.delete(key); }
    if (!pinsToo) {
      pins.style.transform = `translate(${Math.round(map.drawn.left - left)}px, ${Math.round(map.drawn.top - top)}px)`;
      return;
    }
    map.drawn = { left, top };
    pins.style.transform = "";
    // Clusters: the ones near each other on screen, as one.
    const cell = 70;
    const groups = new Map();
    for (const m of markers) {
      const px = m.x * world - left;
      const py = m.y * world - top;
      if (px < -cell || py < -cell || px > w + cell || py > h + cell) continue;
      const key = `${Math.floor(px / cell)},${Math.floor(py / cell)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { list: [], sx: 0, sy: 0 });
      g.list.push(m);
      g.sx += px;
      g.sy += py;
    }
    pins.replaceChildren(...[...groups.values()].map((g) => {
      const img = el("img", { src: gaThumb(g.list[0].id), alt: "", loading: "lazy", draggable: "false" });
      img.addEventListener("error", () => img.remove());
      const pin = el("button", { type: "button", class: "ga-pin", "aria-label": `${g.list.length} photos` }, img,
        ...(g.list.length > 1 ? [el("span", { class: "ga-pin-count" }, g.list.length > 999 ? `${Math.floor(g.list.length / 1000)}k` : String(g.list.length))] : []));
      pin.style.transform = `translate(${Math.round(g.sx / g.list.length) - 22}px, ${Math.round(g.sy / g.list.length) - 22}px)`;
      pin.addEventListener("click", (e) => { e.stopPropagation(); openCluster(g.list); });
      pin.addEventListener("dblclick", (e) => { e.stopPropagation(); fit(g.list); });
      return pin;
    }));
  }

  function zoomAt(z, px = box.clientWidth / 2, py = box.clientHeight / 2) {
    z = Math.max(1, Math.min(18, Math.round(z)));
    if (z === map.z) return;
    // The point under the pointer stays under it.
    const world = GA_TILE * 2 ** map.z;
    const wx = map.cx + (px - box.clientWidth / 2) / world;
    const wy = map.cy + (py - box.clientHeight / 2) / world;
    const next = GA_TILE * 2 ** z;
    map.cx = wx - (px - box.clientWidth / 2) / next;
    map.cy = wy - (py - box.clientHeight / 2) / next;
    map.z = z;
    draw();
  }

  function fit(list) {
    const xs = list.map((m) => m.x);
    const ys = list.map((m) => m.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    map.cx = (x0 + x1) / 2;
    map.cy = (y0 + y1) / 2;
    const span = Math.max(x1 - x0, y1 - y0) * GA_TILE;
    map.z = Math.max(map.z + 1, Math.min(18, Math.floor(Math.log2(Math.min(box.clientWidth, box.clientHeight) / Math.max(span, 1e-9)) - 0.5)));
    map.z = Math.min(18, map.z);
    draw();
  }

  // A cluster's photos, beside the map: where, how many, each to open.
  function openCluster(list) {
    const where = new Map();
    for (const m of list) { const k = [m.city, m.country].filter(Boolean).join(", "); if (k) where.set(k, (where.get(k) || 0) + 1); }
    const place = [...where].sort((a, b) => b[1] - a[1])[0]?.[0] || "Here";
    const shown = list.slice(0, 300);
    const close = el("button", { type: "button", class: "ga-vbutton", title: "Close", "aria-label": "Close" }, svg(GA_ICONS.close));
    close.addEventListener("click", () => { panel.hidden = true; });
    const zoom = el("button", { type: "button", class: "button-secondary" }, "Zoom in here");
    zoom.addEventListener("click", () => fit(list));
    const source = { list: shown.map((m) => ({ id: m.id })) };
    panel.replaceChildren(el("div", { class: "ga-map-panel-head" }, el("div", {}, el("h3", {}, place),
      el("p", { class: "ga-dim" }, `${list.length.toLocaleString()} photos${list.length > shown.length ? ` (the first ${shown.length})` : ""}`)), close),
    ...(list.length > 1 ? [zoom] : []),
    el("div", { class: "ga-map-grid" }, ...shown.map((m) => {
      const img = el("img", { src: gaThumb(m.id), alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.remove());
      const b = el("button", { type: "button", class: "ga-tile" }, img);
      b.addEventListener("click", () => gaOpen(source, m.id));
      return b;
    })));
    panel.hidden = false;
  }

  // Dragging, the wheel, two fingers.
  const down = new Map();
  let pinch = null;
  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ga-pin, .ga-map-zoom, .ga-map-panel")) return;
    box.setPointerCapture(e.pointerId);
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size === 2) {
      const [a, b] = [...down.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: map.z };
    }
  });
  box.addEventListener("pointermove", (e) => {
    const was = down.get(e.pointerId);
    if (!was) return;
    if (down.size === 2 && pinch) {
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...down.values()];
      const z = pinch.z + Math.round(Math.log2(Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d)));
      const r = box.getBoundingClientRect();
      if (z !== map.z) zoomAt(z, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    const world = GA_TILE * 2 ** map.z;
    map.cx -= (e.clientX - was.x) / world;
    map.cy = Math.max(0, Math.min(1, map.cy - (e.clientY - was.y) / world));
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    box.classList.add("dragging");
    map.moved = true;
    if (!map.raf) map.raf = requestAnimationFrame(() => { map.raf = 0; draw(false); });
  });
  const up = (e) => {
    down.delete(e.pointerId);
    if (down.size < 2) pinch = null;
    if (!down.size) {
      box.classList.remove("dragging");
      if (map.moved) { map.moved = false; draw(); }
    }
  };
  box.addEventListener("pointerup", up);
  box.addEventListener("pointercancel", up);
  let wheelAt = 0;
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (Date.now() - wheelAt < 180) return;
    wheelAt = Date.now();
    const r = box.getBoundingClientRect();
    zoomAt(map.z + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  box.addEventListener("dblclick", (e) => {
    if (e.target.closest(".ga-pin, .ga-map-zoom, .ga-map-panel")) return;
    const r = box.getBoundingClientRect();
    zoomAt(map.z + 1, e.clientX - r.left, e.clientY - r.top);
  });
  box.addEventListener("keydown", (e) => {
    const step = 80 / (GA_TILE * 2 ** map.z);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); map.cx += moves[e.key][0]; map.cy += moves[e.key][1]; draw(); }
    if (e.key === "+" || e.key === "=") zoomAt(map.z + 1);
    if (e.key === "-") zoomAt(map.z - 1);
  });
  requestAnimationFrame(draw);
}
