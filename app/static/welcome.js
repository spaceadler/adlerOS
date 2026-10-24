// The welcome: on an install's first login (and from Settings or search any
// time after). What adlerOS is (a roof over your homelab, not a replacement
// for any of it); your apps (standalone: where your containers are, looked
// for while you watch; a homelab: the catalog's apps you can still add);
// making your accounts in them; your storage, as a desktop; and adlerOS's
// apps over Navidrome, Immich and Paperless, each one's connection asked live,
// with how to connect it. Then a short look around: the pages, the dock,
// search, the bell, and where the rest is. Seen once, it's remembered on the
// server.
// Uses $, el, api, toast, state, refresh, postAction, waitForJob, plateFor,
// openStore, renderStore, store, openFiles, openMusic, openGallery,
// openDocuments, openCalendar, settingsFile, settingsThen.
"use strict";

const welcome = { steps: [], at: 0, spot: null, roots: "", busy: false, found: false, links: null };

function welcomeOpen() { return !$("welcome").hidden; }

async function openWelcome() {
  closeSearch();
  closeMenu();
  closeDrawer();
  if (state.mode === "standalone") {
    const { body } = await api("/api/settings").catch(() => ({ body: null }));
    welcome.roots = (body?.config?.COMPOSE_ROOTS || "").split(":").filter(Boolean).join("\n");
  }
  welcome.steps = [welcomeHello, state.mode === "standalone" ? welcomeFolders : welcomeCatalog, welcomeAccounts,
    welcomeStorage, welcomeLayered, welcomeConnect, ...TOUR]
    .filter((step) => !step.spot || document.querySelector(step.spot)?.getClientRects().length);
  welcome.at = 0;
  welcome.found = false;
  welcomeLinks(true); // asked now, so they're in by the time they're shown
  $("welcome").hidden = false;
  renderWelcome();
}

function closeWelcome() {
  if (!welcomeOpen()) return;
  spotlight(null);
  $("welcome").hidden = true;
  if (!state.welcomed) {
    state.welcomed = true;
    api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ welcomed: true }) }).catch(() => {});
  }
}

function goWelcome(step) {
  welcome.at = Math.max(0, Math.min(step, welcome.steps.length - 1));
  renderWelcome();
}

// Leave the tour for one of adlerOS's windows (it's in Settings for later).
function welcomeTo(open) {
  closeWelcome();
  open();
}

// One step: its title, what it says, and its buttons (Back, Skip, and the
// step's own, or Next / Done).
function renderWelcome() {
  const step = welcome.steps[welcome.at];
  const last = welcome.at === welcome.steps.length - 1;
  const card = $("welcome-card");
  const view = step.view();
  const back = el("button", { type: "button", class: "button-secondary" }, "Back");
  back.addEventListener("click", () => goWelcome(welcome.at - 1));
  back.hidden = welcome.at === 0;
  const skip = el("button", { type: "button", class: "chip-button welcome-skip" }, "Skip the tour");
  skip.addEventListener("click", closeWelcome);
  skip.hidden = last;
  const next = view.primary || el("button", { type: "button", class: "button-primary" }, last ? "Done" : "Next");
  if (!view.primary) next.addEventListener("click", () => (last ? closeWelcome() : goWelcome(welcome.at + 1)));
  card.replaceChildren(
    el("div", { class: "welcome-top" }, el("span", { class: "welcome-count" }, `${welcome.at + 1} of ${welcome.steps.length}`), skip),
    el("h2", { id: "welcome-title" }, view.title),
    ...view.body,
    el("div", { class: "dialog-actions welcome-actions" }, back, ...(view.extra || []), next));
  $("welcome").classList.toggle("touring", Boolean(step.spot));
  spotlight(step.spot);
  requestAnimationFrame(() => (card.querySelector("[data-focus]") || next).focus({ preventScroll: true }));
}

// The thing a tour step is about gets a ring; the card moves out of its way.
function spotlight(selector) {
  welcome.spot?.classList.remove("tour-spot");
  welcome.spot = selector ? document.querySelector(selector) : null;
  welcome.spot?.classList.add("tour-spot");
  const card = $("welcome-card");
  card.classList.remove("at-top", "at-bottom");
  if (welcome.spot) {
    const r = welcome.spot.getBoundingClientRect();
    card.classList.add(r.top + r.height / 2 > innerHeight / 2 ? "at-top" : "at-bottom");
  }
}

const welcomeText = (text) => el("p", { class: "welcome-text" }, text);

// ------------------------------------------------- what adlerOS is, and isn't

const welcomeHello = {
  view: () => ({
    title: `Welcome to adlerOS${state.name ? `, ${state.name}` : ""}`,
    body: [
      welcomeText(state.mode === "standalone"
        ? "adlerOS is a home screen over the Docker apps on this machine. They're the base: each runs in its own container, set up the way it is, and keeps running whether adlerOS is open or not."
        : "adlerOS is the home screen over your homelab. The homelab is the base: its containers, their storage and the network between them, built to just work, with adlerOS or without it."),
      welcomeText("adlerOS doesn't replace any of it. It brings it under one roof: one place to open your apps, run and update them, get at your files, and work from."),
      welcomeText(state.mode === "standalone" ? "First, let's find your apps." : "Here's how it fits together."),
    ],
  }),
};

// ------------------------------------------------------------- your apps

// Standalone: where the compose files are, and looking there.
const welcomeFolders = {
  view() {
    const area = el("textarea", { class: "field-input welcome-roots", rows: "3", spellcheck: "false", autocapitalize: "off",
      placeholder: "/home/you/docker", "aria-label": "Your compose folders, one per line", "data-focus": "" });
    area.value = welcome.roots;
    area.addEventListener("input", () => { welcome.roots = area.value; });
    const status = el("div", { class: "welcome-status", "aria-live": "polite" }, welcomeKnown());
    const log = el("pre", { class: "welcome-log", hidden: "" });
    const look = el("button", { type: "button", class: "button-primary" }, welcome.found ? "Next" : "Look for apps");
    const skipLooking = el("button", { type: "button", class: "button-secondary" }, state.apps.length ? "Keep these" : "Not now");
    skipLooking.addEventListener("click", () => goWelcome(welcome.at + 1));
    skipLooking.hidden = welcome.found;
    // Once it has looked, the same button goes on.
    look.addEventListener("click", () => (welcome.found ? goWelcome(welcome.at + 1) : lookForApps(area, look, status, log, skipLooking)));
    return {
      title: "Where are your containers?",
      body: [welcomeText("The folders that hold your docker compose files, one per line: ~/docker, /opt/stacks… adlerOS looks up to three folders deep and puts each app in a collection (the ones it doesn't know go in Extras). It only reads them: nothing's started, stopped or changed."),
        area, status, log],
      extra: [skipLooking],
      primary: look,
    };
  },
};

function welcomeKnown() {
  if (!state.apps.length) return "adlerOS doesn't know any apps yet.";
  const counts = {};
  for (const a of state.apps) counts[a.genre] = (counts[a.genre] || 0) + 1;
  const names = Object.fromEntries((state.collections || []).map((c) => [c.id, c.name]));
  return `adlerOS knows ${state.apps.length} app${state.apps.length === 1 ? "" : "s"}: ${Object.entries(counts)
    .map(([g, n]) => `${names[g] || g} ${n}`).join(", ")}.`;
}

async function lookForApps(area, look, status, log, skipLooking) {
  if (welcome.busy) return;
  const roots = area.value.split(/[\n:]+/).map((r) => r.trim()).filter(Boolean);
  if (!roots.length) return toast("Put at least one folder in.");
  const bad = roots.find((r) => !r.startsWith("/"));
  if (bad) return toast(`${bad}: a whole path, starting with /.`);
  welcome.busy = true;
  look.disabled = true;
  status.textContent = "Looking…";
  log.hidden = false;
  log.textContent = "";
  const { status: code, body } = await postAction("app-folders", { roots: roots.join(":") });
  let job = code === 202 ? await waitForJob(body, (j) => { log.textContent = (j.log || []).slice(-8).join("\n"); }) : null;
  welcome.busy = false;
  look.disabled = false;
  if (code === 409) {
    status.textContent = `The helper is busy (${body?.job?.label || "something else"}); try again when it's done.`;
    return;
  }
  if (!job || job.status !== "done") {
    const said = (job?.log || []).filter((l) => !l.startsWith("$")).pop();
    status.textContent = job?.error?.includes("pick it up")
      ? "adlerOS's helper isn't running, so it can't look yet. On the machine, run ./install.sh in adlerOS's folder (it sets the helper up), then try again."
      : `That didn't work: ${said || job?.error || body?.error || "no answer"}`;
    return;
  }
  log.textContent = (job.log || []).filter((l) => !l.startsWith("$")).slice(-8).join("\n");
  await refresh();
  welcome.found = true;
  status.textContent = welcomeKnown();
  look.textContent = "Next";
  skipLooking.hidden = true;
  look.focus();
}

// A homelab: its catalog's apps you haven't installed, by collection.
const welcomeCatalog = {
  view() {
    const available = state.available.filter((a) => !a.imported).sort((a, b) => a.name.localeCompare(b.name));
    if (!available.length) {
      return { title: "Apps you can add", body: [welcomeText(`Your homelab runs ${state.apps.length} apps, and that's everything in its catalog. The App Store can still import apps you run yourself.`)] };
    }
    const names = Object.fromEntries((state.collections || []).map((c) => [c.id, c.name]));
    const groups = {};
    for (const a of available) (groups[a.genre] ||= []).push(a);
    const lists = Object.entries(groups).map(([genre, apps]) => el("section", { class: "welcome-group" },
      el("h3", { class: "group-title" }, names[genre] || genre[0].toUpperCase() + genre.slice(1)),
      ...apps.map((a) => {
        const get = el("button", { type: "button", class: "chip-button" }, "See it");
        get.addEventListener("click", () => welcomeTo(() => {
          openStore();
          $("store-search").value = store.query = a.name;
          renderStore();
        }));
        return el("div", { class: "welcome-app" }, el("span", { class: "app-icon welcome-icon" }, plateFor(a)),
          el("span", { class: "welcome-app-text" }, el("strong", {}, a.name), el("span", {}, a.about)), get);
      })));
    return {
      title: "Apps you can add",
      body: [welcomeText(`Your homelab runs ${state.apps.length} apps. These ${available.length} come with it too, ready to install from the App Store; nothing's installed until you say so.`),
        el("div", { class: "welcome-apps" }, ...lists)],
    };
  },
};

// Each app is its own: adlerOS runs it, the accounts in it are the app's.
const welcomeAccounts = {
  view: () => ({
    title: "Make your accounts",
    body: [
      welcomeText("Every app keeps its own accounts. Once one's installed, open it and make yours there; the first account is usually the app's admin."),
      welcomeText("adlerOS doesn't sign in to your apps or change what's inside them. It opens them, starts and stops them, updates them and shows their logs; their users, settings and data stay theirs, and they work the same without adlerOS."),
      welcomeText("A few of adlerOS's own apps can show you what's in yours, once they have a login or key from them. More on that in a moment."),
    ],
  }),
};

// ------------------------------------------------------------ your storage

const welcomeStorage = {
  view() {
    const open = el("button", { type: "button", class: "button-secondary" }, "Open My Computer");
    open.addEventListener("click", () => welcomeTo(() => openFiles()));
    return {
      title: "Your storage, as a desktop",
      body: [
        welcomeText("Next to the containers is your storage folder: the photos Immich keeps, the music Navidrome plays, Paperless's documents, your notes, and the rest. On its own it's a folder on a server, reached with File Browser or ssh."),
        welcomeText("My Computer makes it a desktop to work from: open and edit what's in it, move it, upload to it, keep things on the Desktop, and every app reads the same folders. adlermd writes your notes in it, as the Markdown files they are."),
      ],
      extra: [open],
    };
  },
};

// ------------------------------------------- adlerOS's apps over your apps

// Each one: the app it sits on, what it does without it, what it adds with
// it, and how it connects.
const LAYERED = [
  {
    id: "music", name: "Music", over: "Navidrome", apps: ["navidrome"], icon: "music", open: () => openMusic(),
    adds: "what you play shows in Navidrome too, and in the Subsonic apps on your phone",
    alone: "plays your music folder on its own",
  },
  {
    id: "gallery", name: "Gallery", over: "Immich", apps: ["immich"], icon: "gallery", open: () => openGallery(),
    adds: "Immich's albums, people, places and map, memories, and search by what's in a photo",
    alone: "shows the photos in the Gallery folder, by month",
  },
  {
    id: "documents", name: "Documents", over: "Paperless-ngx", apps: ["paperless-ngx", "paperless"], icon: "documents", open: () => openDocuments(),
    adds: "Paperless's titles, tags and correspondents, search inside every page, and uploads to it",
    alone: "shows the files in the Documents folder (Paperless names them by number)",
  },
  {
    id: "calendar", name: "Calendar", over: "Radicale", apps: ["radicale"], icon: "calendar", open: () => openCalendar(),
    adds: "your calendars in their colors, by day, week or month; events dragged, made and edited there, so your phone has them too",
    alone: "is an empty calendar, with how to connect it at the top",
  },
];

// Their connections, asked once a tour (and again on "Check again").
function welcomeLinks(again = false) {
  if (welcome.links && !again) return welcome.links;
  const ask = (path) => api(path).then(({ status, body }) => (status === 200 && body ? body : { error: "noanswer" }), () => ({ error: "noanswer" }));
  welcome.links = Promise.all([ask("/api/music/navidrome"), ask("/api/gallery/status"), ask("/api/paperless/status"), ask("/api/calendar/status")])
    .then(([music, gallery, documents, calendar]) => ({ music, gallery, documents, calendar }));
  return welcome.links;
}

// Where one stands: connected, or the step it's at (0 install the app, 1 make
// your account and a key, 2 a key it refused, 3 not answering).
function layeredState(l, st) {
  const installed = state.apps.some((a) => l.apps.includes(a.id));
  if (st.ok) return { ok: true, label: "Connected" };
  if (l.id === "music") {
    if (st.configured) return { at: 3, label: "Not answering" };
    return installed ? { at: 1, label: "Needs your login" } : { at: 0, label: `No ${l.over}` };
  }
  if (l.id === "calendar") {
    if (st.error === "refused") return { at: 2, label: "Login refused" };
    if (st.configured) return { at: 3, label: st.error === "nocalendars" ? "No calendars" : "Not answering" };
    return st.error === "noserver" ? { at: 0, label: `No ${l.over}` } : { at: 1, label: "Needs your login" };
  }
  if (st.error === "noimmich" || st.error === "nopaperless") return { at: 0, label: `No ${l.over}` };
  if (st.error === "nokey" || st.error === "notoken") return { at: 1, label: l.id === "gallery" ? "Needs a key" : "Needs a token" };
  if (st.error === "refused") return { at: 2, label: l.id === "gallery" ? "Key refused" : "Token refused" };
  return { at: 3, label: "Not answering" };
}

function welcomeChip(l) {
  const chip = el("span", { class: "welcome-state" }, "Asking…");
  welcomeLinks().then((links) => {
    const s = layeredState(l, links[l.id]);
    chip.textContent = s.label;
    chip.classList.toggle("ok", Boolean(s.ok));
  });
  return chip;
}

const welcomeLayered = {
  view() {
    const rows = LAYERED.map((l) => {
      const open = el("button", { type: "button", class: "chip-button" }, "Open");
      open.addEventListener("click", () => welcomeTo(l.open));
      return el("div", { class: "welcome-app welcome-layer" },
        el("img", { class: "welcome-icon", src: `/static/dock/${l.icon}.svg`, alt: "" }),
        el("span", { class: "welcome-app-text" }, el("strong", {}, `${l.name}, on ${l.over}`), el("span", { class: "welcome-wrap" }, l.adds)),
        el("span", { class: "welcome-layer-side" }, welcomeChip(l), open));
    });
    return {
      title: "Apps on top of your apps",
      body: [
        welcomeText("Music, Gallery, Documents and Calendar sit on top of Navidrome, Immich, Paperless and Radicale. They read what those apps already know, through the apps' own APIs, and show it the same way, all in one place."),
        el("div", { class: "welcome-apps" }, ...rows),
        welcomeText("They don't replace those apps or touch how your homelab is set up: the photos stay Immich's and the documents Paperless's, and what you do here (a play, an upload) goes to the app, as if you'd done it there. They need those apps for the good parts; without them, each still shows the files themselves, and says what connecting adds."),
      ],
    };
  },
};

// How each one connects, from where it is now.
function welcomeHow(l, s, st) {
  const perms = (st.permissions || []).map((p) => el("code", {}, p));
  const file = settingsFile();
  const install = `Install ${l.over} (the App Store has it), or if it runs elsewhere, put its address in ${file} as ${{ music: "NAVIDROME_URL", gallery: "IMMICH_URL", documents: "PAPERLESS_URL", calendar: "CALDAV_URL" }[l.id]}=…${l.id === "calendar" ? " (any CalDAV server's)" : ""}`;
  // A homelab's install.sh makes Paperless's admin itself.
  const account = state.mode !== "standalone" && l.id === "documents"
    ? "Log in to Paperless as admin: install.sh made the account, with the password PAPERLESS_ADMIN_PASSWORD in containers/productivity/paperless-ngx/.env."
    : l.id === "calendar" ? `Have a login for ${l.over}, and a calendar in it (your phone's calendar app can make one).`
      : `Open ${l.over} and make your account.`;
  const key = {
    music: [`Your Navidrome login is all it takes: put it in ${file} as NAVIDROME_USER=… and NAVIDROME_PASSWORD=…${settingsThen()}.`],
    gallery: ["In Immich: Account Settings → API Keys → New API Key, with these permissions (they only read):", el("span", { class: "welcome-perms" }, ...perms),
      `Put it in ${file} as IMMICH_API_KEY=…${settingsThen()}.`],
    documents: ["In Paperless: your name (top right) → My Profile → API Auth Token.", `Put it in ${file} as PAPERLESS_TOKEN=…${settingsThen()}.`],
    calendar: [`Your ${l.over} login is all it takes: put it in ${file} as CALDAV_USER=… and CALDAV_PASSWORD=…${settingsThen()}.`],
  }[l.id];
  const steps = s.at === 0 ? [install, account, ...key]
    : s.at === 1 ? [account, ...key]
      : s.at === 2 ? [`${l.over} doesn't know the ${l.id === "music" || l.id === "calendar" ? "login" : l.id === "gallery" ? "key" : "token"} in ${file} (deleted, or mistyped). Make a new one:`, ...key]
        : st.error === "nocalendars" ? [`${l.over} answered at ${st.url}, but has no calendars for that login. Make one (your phone's calendar app can), or check CALDAV_URL.`]
          : [`${l.over} isn't answering${st.url ? ` at ${st.url}` : ""}. Is it running? The App Store starts it.`];
  const items = [];
  for (const step of steps) {
    if (typeof step === "string") items.push(el("li", {}, step));
    else items[items.length - 1].append(step); // the permissions, under their line
  }
  return el("section", { class: "welcome-group" },
    el("h3", { class: "group-title welcome-how-title" }, el("span", {}, `${l.name}, on ${l.over}`), el("span", { class: "welcome-state" }, s.label)),
    el("ol", { class: "welcome-steps" }, ...items),
    el("p", { class: "welcome-alone" }, `Meanwhile, it ${l.alone}.`));
}

const welcomeConnect = {
  view() {
    const box = el("div", { class: "welcome-apps" }, el("p", { class: "welcome-status" }, "Asking them…"));
    const again = el("button", { type: "button", class: "button-secondary" }, "Check again");
    again.addEventListener("click", () => { welcomeLinks(true); renderWelcome(); });
    welcomeLinks().then((links) => {
      const states = LAYERED.map((l) => [l, layeredState(l, links[l.id]), links[l.id]]);
      const done = states.filter(([, s]) => s.ok).map(([l]) => l.name);
      const todo = states.filter(([, s]) => !s.ok);
      box.replaceChildren(
        ...(done.length ? [el("p", { class: "welcome-status" }, `${new Intl.ListFormat("en").format(done)} ${done.length === 1 ? "is" : "are"} connected.`)] : []),
        ...todo.map(([l, s, st]) => welcomeHow(l, s, st)));
    });
    return {
      title: "Connecting them",
      body: [
        welcomeText(`Each takes one login or key, made in that app and put in ${settingsFile()}. It stays on this server; your browser never sees it.`),
        welcomeText(state.mode === "standalone"
          ? "Or let adlerOS's installer do it: ./install.sh --connect in adlerOS's folder, in a terminal, makes each one's key with your login (and the admin, where an app has none yet)."
          : "Or let the installer do it: ./install.sh again in your homelab's folder, in a terminal, connects Documents by itself, and Gallery and Music with your login (making their admin, where they have none yet)."),
        box,
      ],
      extra: [again],
    };
  },
};

// ---------------------------------------------------------- a look around

const TOUR = [
  {
    spot: "#grid-area",
    view: () => ({ title: "Your apps", body: [welcomeText("One page per collection, its name above it. Swipe, use the dots, or the arrow keys to move between them. Right-click (or long-press) an app to keep it in the dock, put it on the Desktop, or rearrange the page.")] }),
  },
  {
    spot: "#dock",
    view: () => ({ title: "The dock", body: [welcomeText("The apps you keep here (Music, Gallery, Documents and Calendar too), then adlerOS's own: All apps, always here, the App Store (start, stop, update, install), Settings, and Live Usage.")] }),
  },
  {
    spot: "#search-open",
    view: () => ({ title: "Search", body: [welcomeText("Alt+Space or / finds apps, settings, adlerOS's windows and your files.")] }),
  },
  {
    spot: "#bell",
    view: () => ({ title: "Notifications", body: [welcomeText("When an app goes offline (or comes back), an install or update finishes, or the disk fills up.")] }),
  },
  {
    view: () => ({
      title: "And the rest",
      body: [welcomeText("My Computer, Music, Gallery, Documents, Calendar and adlermd are in All apps. On a computer, Settings → Desktop mode puts windows side by side, and the mouse's side buttons go back and forward in them. Press ? for every key; it all works without a mouse."),
        welcomeText("This tour is in Settings, if you want it again.")],
    }),
  },
];

// ---------------------------------------------------------------- wiring

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !welcomeOpen() || !$("modal").hidden) return;
  e.stopImmediatePropagation();
  closeWelcome();
}, true);
window.addEventListener("resize", () => { if (welcomeOpen()) spotlight(welcome.steps[welcome.at]?.spot); });
