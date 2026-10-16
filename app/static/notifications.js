// Notifications: the bell at the top right of the desktop. adlerOS's server
// writes them (an app went offline or came back, a backup or update
// finished or failed, the disk is filling up, it's running hot, Cup found
// updates); this shows them, and pops new ones up as a toast.
// Uses $, el, svg, api, toast, showLock, openStore, openSettings, openUsage.
"use strict";

const NOTES_POLL_MS = 30000;

const notes = { items: [], seen: null, timer: null, opener: null };

const NOTE_ICONS = {
  offline: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"],
  online: ["M20 6 9 17l-5-5"],
  "job-done": ["M20 6 9 17l-5-5"],
  "job-failed": ["M18 6 6 18", "m6 6 12 12"],
  disk: ["M22 12H2", "M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"],
  heat: ["M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z"],
  updates: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
};

function ago(seconds) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function notesOpen() { return !$("notes").hidden; }

async function loadNotes() {
  const { status, body } = await api("/api/notifications").catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200 || !body) return;
  const fresh = notes.seen ? body.items.filter((n) => !n.read && !notes.seen.has(n.id)) : [];
  notes.seen = new Set(body.items.map((n) => n.id));
  notes.items = body.items;
  // New since the last look: say so, once (the newest one, plus a count).
  if (fresh.length && !$("desktop").hidden) toast(fresh.length > 1 ? `${fresh[0].title} (+${fresh.length - 1} more)` : fresh[0].title);
  const badge = $("bell-count");
  badge.textContent = body.unread > 9 ? "9+" : String(body.unread);
  badge.hidden = !body.unread;
  $("bell").setAttribute("aria-label", body.unread ? `Notifications, ${body.unread} new` : "Notifications");
  if (notesOpen()) renderNotes();
}

function startNotes() {
  stopNotes();
  loadNotes();
  notes.timer = setInterval(() => { if (!document.hidden) loadNotes(); }, NOTES_POLL_MS);
}

function stopNotes() {
  clearInterval(notes.timer);
  notes.timer = null;
  closeNotes();
}

function openTarget(target) {
  if (target === "app-store") return openStore();
  if (target === "live-usage") return openUsage();
  if (target === "settings") return openSettings();
  if (target?.startsWith("settings:")) return openSettings(target.slice("settings:".length));
}

function renderNotes() {
  const list = $("notes-list");
  if (!notes.items.length) {
    list.replaceChildren(el("p", { class: "notes-empty" }, "Nothing new. adlerOS tells you here when an app goes offline, a backup or update finishes, or the disk fills up."));
    return;
  }
  list.replaceChildren(...notes.items.map((n) => {
    const item = el("button", { type: "button", class: `note ${n.kind}${n.read ? "" : " unread"}` },
      el("span", { class: "note-icon" }, svg(NOTE_ICONS[n.kind] || NOTE_ICONS.online)),
      el("span", { class: "note-text" }, el("span", { class: "note-title" }, n.title),
        n.body ? el("span", { class: "note-body" }, n.body) : "",
        el("span", { class: "note-time" }, ago(n.time))));
    item.addEventListener("click", () => {
      closeNotes();
      openTarget(n.open);
    });
    return item;
  }));
}

async function openNotes() {
  closeMenu();
  notes.opener = document.activeElement;
  $("notes").hidden = false;
  renderNotes();
  ($("notes-list").querySelector("button") || $("notes-clear")).focus();
  if (notes.items.some((n) => !n.read)) {
    await api("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: "all" }) }).catch(() => {});
    loadNotes();
  }
}

function closeNotes() {
  if (!notesOpen()) return;
  $("notes").hidden = true;
  if (notes.opener?.isConnected) notes.opener.focus({ preventScroll: true });
}

$("bell").addEventListener("click", () => (notesOpen() ? closeNotes() : openNotes()));
$("notes-clear").addEventListener("click", async () => {
  await api("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }).catch(() => {});
  notes.items = [];
  renderNotes();
  loadNotes();
});
document.addEventListener("pointerdown", (e) => {
  if (notesOpen() && !$("notes").contains(e.target) && !$("bell").contains(e.target)) closeNotes();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !notesOpen() || !$("modal").hidden) return;
  e.stopImmediatePropagation();
  closeNotes();
}, true);
