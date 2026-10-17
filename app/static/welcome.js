// The welcome: on an install's first login (and from Settings or search any
// time after). Standalone, it asks where your containers are and looks for
// apps there while you watch; in a homelab, it shows the catalog's apps you
// can still add. Then a short look around: the pages, the dock, search, the
// bell, and where the rest is. Seen once, it's remembered on the server.
// Uses $, el, svg, api, toast, state, refresh, postAction, waitForJob,
// plateFor, openStore, renderStore, store, desktopMode, focusStart.
"use strict";

const welcome = { steps: [], at: 0, spot: null, roots: "", busy: false, found: false };

function welcomeOpen() { return !$("welcome").hidden; }

async function openWelcome() {
  closeSearch();
  closeMenu();
  closeDrawer();
  if (state.mode === "standalone") {
    const { body } = await api("/api/settings").catch(() => ({ body: null }));
    welcome.roots = (body?.config?.COMPOSE_ROOTS || "").split(":").filter(Boolean).join("\n");
  }
  welcome.steps = [welcomeHello, state.mode === "standalone" ? welcomeFolders : welcomeCatalog, ...TOUR]
    .filter((step) => !step.spot || document.querySelector(step.spot)?.getClientRects().length);
  welcome.at = 0;
  welcome.found = false;
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

// ---------------------------------------------------------------- steps

const welcomeHello = {
  view: () => ({
    title: `Welcome to adlerOS${state.name ? `, ${state.name}` : ""}`,
    body: state.mode === "standalone"
      ? [welcomeText("A home screen for the Docker apps on this machine: open them, start and stop them, update them, read their logs, install new ones, and get at your files."),
        welcomeText("First, let's find your apps.")]
      : [welcomeText("This is your homelab's home screen. Every app it runs is here, one page per collection, and the App Store has more it can add."),
        welcomeText("A quick look around.")],
  }),
};

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
      body: [welcomeText("The folders that hold your docker compose files, one per line: ~/docker, /opt/stacks… adlerOS looks up to three folders deep, puts each app in a collection (the ones it doesn't know go in Extras), and starts nothing."),
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
      return { title: "Apps you can add", body: [welcomeText("You've installed everything in the catalog. The App Store can still import apps you run yourself.")] };
    }
    const names = Object.fromEntries((state.collections || []).map((c) => [c.id, c.name]));
    const groups = {};
    for (const a of available) (groups[a.genre] ||= []).push(a);
    const lists = Object.entries(groups).map(([genre, apps]) => el("section", { class: "welcome-group" },
      el("h3", { class: "group-title" }, names[genre] || genre[0].toUpperCase() + genre.slice(1)),
      ...apps.map((a) => {
        const get = el("button", { type: "button", class: "chip-button" }, "See it");
        get.addEventListener("click", () => {
          closeWelcome();
          openStore();
          $("store-search").value = store.query = a.name;
          renderStore();
        });
        return el("div", { class: "welcome-app" }, el("span", { class: "app-icon welcome-icon" }, plateFor(a)),
          el("span", { class: "welcome-app-text" }, el("strong", {}, a.name), el("span", {}, a.about)), get);
      })));
    return {
      title: "Apps you can add",
      body: [welcomeText(`Your homelab has ${state.apps.length} apps running. These ${available.length} come with it too, ready to install from the App Store; nothing's installed until you say so.`),
        el("div", { class: "welcome-apps" }, ...lists)],
    };
  },
};

const TOUR = [
  {
    spot: "#grid-area",
    view: () => ({ title: "Your apps", body: [welcomeText("One page per collection, its name above it. Swipe, use the dots, or the arrow keys to move between them. Right-click (or long-press) an app to keep it in the dock, or to rearrange the page.")] }),
  },
  {
    spot: "#dock",
    view: () => ({ title: "The dock", body: [welcomeText("The apps you pin, then adlerOS's own: All apps (A to Z), the App Store (start, stop, update, install), Settings, and Live Usage.")] }),
  },
  {
    spot: "#search-open",
    view: () => ({ title: "Search", body: [welcomeText("⌘K, Ctrl+K or / finds apps, settings and adlerOS's windows.")] }),
  },
  {
    spot: "#bell",
    view: () => ({ title: "Notifications", body: [welcomeText("When an app goes offline (or comes back), an install or update finishes, or the disk fills up.")] }),
  },
  {
    view: () => ({
      title: "And the rest",
      body: [welcomeText("Files, in All apps: your Desktop, your storage and your homelab, with an editor. Settings → Desktop mode, on a computer: windows side by side. Press ? for every key; it all works without a mouse."),
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
