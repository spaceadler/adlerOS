// Contacts: the people in Monica (a personal CRM), through adlerOS's server
// (a token pasted once, in Connect; it never reaches the browser). A to Z
// down the side with a search; a person's page: how to reach them (emails,
// phones…), their birthday, what you know about them and your notes; new,
// edit and delete, all written back to Monica (starring is only on Monica's
// own pages: its API can't), so its own pages and
// apps have them too.
// Uses $, el, svg, api, toast, showLock, openWindow, closeWindow,
// registerWindow, toggleWindow, sideToggle, confirmDialog.
"use strict";

const CT_ICONS = {
  person: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  plus: ["M12 5v14", "M5 12h14"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  star: ["M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M6 6l1 14h10l1-14"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
};
// Monica's kinds of contact field, as Contacts adds them.
const CT_KINDS = [["email", "Email"], ["phone", "Phone"]];

const ct = { built: false, status: null, list: [], q: "", view: { kind: "home" }, person: null };
const ctOnline = () => Boolean(ct.status?.ok);

async function ctGet(path) {
  const { status, body } = await api(`/api/contacts/${path}`).catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); throw new Error("login"); }
  if (status === 409 && body?.status) { ct.status = body.status; throw new Error(body.error || "Monica isn't connected"); }
  if (status !== 200) throw new Error(body?.error || "Contacts can't reach the server right now.");
  return body;
}
async function ctPost(what, body) {
  const { status, body: got } = await api(`/api/contacts/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => ({ status: 0 }));
  if (status === 401) { showLock(); return null; }
  return got || { ok: false, error: "No answer from the server." };
}

// ------------------------------------------------------------- the window

async function openContacts() {
  ctBuild();
  openWindow("contacts");
  await ctLoad();
}
function toggleContacts() { toggleWindow("contacts", () => openContacts()); }
function closeContacts() { closeWindow("contacts"); }

function ctBuild() {
  if (ct.built) return;
  ct.built = true;
  const close = el("button", { class: "sheet-close mu-close", type: "button", "aria-label": "Close Contacts" }, svg(CT_ICONS.close));
  close.addEventListener("click", closeContacts);
  const search = el("input", { class: "field-input mu-search", id: "ct-search", type: "search", placeholder: "Search", spellcheck: "false", autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ct.q = search.value.trim(); ctLoadList(); }, 250);
  });
  const add = el("button", { type: "button", class: "mu-nav ct-new" }, svg(CT_ICONS.plus), el("span", {}, "New contact"));
  add.addEventListener("click", () => ctShow({ kind: "edit", id: null }));
  const section = el("section", { id: "contacts", class: "sheet music-app contacts-app", "aria-label": "Contacts", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "mu-shell", id: "ct-shell" },
      el("aside", { class: "mu-side", id: "ct-side" }, el("label", { class: "mu-search-box" }, svg(CT_ICONS.search), search), add,
        el("nav", { class: "mu-side-nav ct-list", id: "ct-list", "aria-label": "People" }), el("div", { class: "vd-source", id: "ct-source" })),
      el("main", { class: "mu-main", id: "ct-main", tabindex: "-1" })));
  document.body.insertBefore(section, $("modal"));
  $("ct-shell").append(sideToggle(section, "contacts"));
  registerWindow("contacts", { title: "Contacts", close: closeContacts, hide: () => closeWindow("contacts"), dock: "contacts", size: [1000, 700] });
  $("ct-main").replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, "Opening your contacts…")));
}

async function ctLoad() {
  ct.status = await ctGet("status").catch((e) => ({ error: e.message }));
  ctSource();
  if (!ctOnline()) { ct.list = []; ctList(); return ctShow({ kind: "connect" }, true); }
  await ctLoadList();
  ctRender();
}

async function ctLoadList() {
  if (!ctOnline()) return;
  const all = [];
  try {
    // Every page of them (a hundred a page): a person's list is short enough.
    for (let page = 1; page <= 50; page++) {
      const got = await ctGet(`list?page=${page}${ct.q ? `&q=${encodeURIComponent(ct.q)}` : ""}`);
      all.push(...got.contacts);
      if (page >= (got.pages || 1)) break;
    }
  } catch (e) {
    toast(e.message);
  }
  ct.list = all.sort((a, b) => a.name.localeCompare(b.name)); // across pages too
  ctList();
}

// ------------------------------------------------------------- the side

function ctAvatar(c, size = "") {
  return el("span", { class: `ct-avatar${size ? ` ${size}` : ""}`, style: c.color ? `background:${c.color}` : "", "aria-hidden": "true" },
    c.initials || (c.name || "?").slice(0, 1).toUpperCase());
}

function ctList() {
  const nav = $("ct-list");
  if (!nav) return;
  if (!ctOnline()) return nav.replaceChildren();
  if (!ct.list.length) return nav.replaceChildren(el("p", { class: "vd-dim ct-none" }, ct.q ? "No one by that name." : "No one yet."));
  const starred = ct.list.filter((c) => c.starred);
  const rows = [];
  const row = (c) => {
    const on = ct.view.kind === "person" && ct.view.id === c.id;
    const b = el("button", { type: "button", class: `mu-nav ct-row${on ? " on" : ""}`, "data-id": c.id }, ctAvatar(c), el("span", {}, c.name));
    b.addEventListener("click", () => ctShow({ kind: "person", id: c.id }));
    return b;
  };
  if (starred.length && !ct.q) rows.push(el("h3", { class: "ct-letter" }, "Starred"), ...starred.map(row));
  let letter = "";
  for (const c of ct.list) {
    const first = (c.name[0] || "#").toUpperCase();
    const l = /[A-Z]/.test(first) ? first : "#";
    if (l !== letter) { letter = l; rows.push(el("h3", { class: "ct-letter" }, l)); }
    rows.push(row(c));
  }
  nav.replaceChildren(...rows);
}

function ctSource() {
  const src = el("button", { type: "button", class: "mu-nav vd-source-button" }, svg(CT_ICONS.link),
    el("span", {}, ctOnline() ? `Monica${ct.status.user ? `: ${ct.status.user}` : ""}` : "Connect Monica"));
  src.addEventListener("click", () => ctShow({ kind: "connect" }));
  $("ct-source")?.replaceChildren(src);
}

function ctShow(view, replace = false) {
  ct.view = view;
  ctList();
  ctRender();
  if (!replace) $("ct-main")?.focus({ preventScroll: true });
}

async function ctRender() {
  const main = $("ct-main");
  if (!main) return;
  const page = el("div", { class: "mu-page ct-page" });
  const v = ct.view;
  main.replaceChildren(page);
  if (v.kind === "connect") return ctConnectPage(page);
  if (!ctOnline()) return ctConnectPage(page);
  if (v.kind === "person") return ctPersonPage(page, v.id);
  if (v.kind === "edit") return ctEditPage(page, v.id);
  page.append(el("div", { class: "mu-empty" }, el("h2", {}, "Contacts"),
    el("p", {}, ct.list.length ? `${ct.list.length} ${ct.list.length === 1 ? "person" : "people"}. Pick one, or search.` : "No one yet: New contact adds the first.")));
}

// ------------------------------------------------------------- a person

async function ctPersonPage(page, id) {
  page.append(el("p", { class: "vd-dim" }, "Opening…"));
  let p;
  try {
    p = await ctGet(`contact?id=${id}`);
  } catch (e) {
    page.replaceChildren(el("div", { class: "mu-empty" }, el("p", {}, e.message)));
    return;
  }
  if (ct.view.kind !== "person" || ct.view.id !== id) return; // moved on meanwhile
  ct.person = p;
  const edit = el("button", { type: "button", class: "mu-button secondary" }, svg(CT_ICONS.edit), "Edit");
  edit.addEventListener("click", () => ctShow({ kind: "edit", id }));
  const del = el("button", { type: "button", class: "mu-button secondary" }, svg(CT_ICONS.trash), "Delete");
  del.addEventListener("click", async () => {
    if (!await confirmDialog({ title: `Delete ${p.name}?`, body: "From Monica too, with their notes and everything else it keeps about them.", button: "Delete", destructive: true })) return;
    const got = await ctPost("delete", { id });
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    toast(`${p.name}: deleted.`);
    await ctLoadList();
    ctShow({ kind: "home" }, true);
  });
  const sub = [p.nickname && `“${p.nickname}”`, [p.job, p.company].filter(Boolean).join(" at ")].filter(Boolean).join(" · ");
  const head = el("header", { class: "mu-head ct-head" }, ctAvatar(p, "big"),
    el("div", {}, el("h1", {}, p.name), sub ? el("p", { class: "vd-dim" }, sub) : ""),
    el("div", { class: "ct-actions" }, edit, del));

  // How to reach them: emails and phones as links, the rest as text.
  const href = (f) => (f.kind === "email" || /mail/i.test(f.type) ? `mailto:${f.value}` : f.kind === "phone" || /phone/i.test(f.type) ? `tel:${f.value.replace(/\s/g, "")}`
    : /^https?:\/\//.test(f.value) ? f.value : null);
  const fields = p.fields.map((f) => {
    const x = el("button", { type: "button", class: "ct-x", "aria-label": `Remove ${f.value}` }, svg(CT_ICONS.close));
    x.addEventListener("click", async () => {
      const got = await ctPost("field-delete", { id, fieldId: f.id });
      if (!got?.ok) return toast(got?.error || "That didn't work.");
      ctShow({ kind: "person", id }, true);
    });
    const link = href(f);
    return el("div", { class: "ct-field" }, el("span", { class: "ct-label" }, f.type || f.kind),
      link ? el("a", { href: link, target: link.startsWith("http") ? "_blank" : "", rel: "noopener noreferrer" }, f.value) : el("span", {}, f.value), x);
  });
  const kind = el("select", { class: "field-input ct-kind", "aria-label": "Kind" }, ...CT_KINDS.map(([k, label]) => el("option", { value: k }, label)));
  const value = el("input", { class: "field-input", type: "text", placeholder: "Add an email or phone", "aria-label": "Email or phone" });
  const addField = async () => {
    if (!value.value.trim()) return value.focus();
    const got = await ctPost("field-add", { id, kind: kind.value, value: value.value.trim() });
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    ctShow({ kind: "person", id }, true);
  };
  value.addEventListener("keydown", (e) => { if (e.key === "Enter") addField(); });
  value.addEventListener("input", () => { if (value.value.includes("@")) kind.value = "email"; else if (/^[+\d][\d\s()-]{4,}$/.test(value.value)) kind.value = "phone"; });

  const about = [];
  if (p.birthday) {
    const [y, m, d] = p.birthday.date.split("-").map(Number);
    const when = new Date(p.birthday.yearUnknown ? 2000 : y, m - 1, d).toLocaleDateString([], { day: "numeric", month: "long", ...(p.birthday.yearUnknown ? {} : { year: "numeric" }) });
    about.push(el("div", { class: "ct-field" }, el("span", { class: "ct-label" }, "Birthday"), el("span", {}, when)));
  }
  for (const a of p.addresses) about.push(el("div", { class: "ct-field" }, el("span", { class: "ct-label" }, "Address"), el("span", {}, a)));
  if (p.tags.length) about.push(el("div", { class: "ct-field" }, el("span", { class: "ct-label" }, "Tags"), el("span", {}, p.tags.join(", "))));
  if (p.description) about.push(el("p", { class: "ct-description" }, p.description));

  const noteBox = el("textarea", { class: "field-input ct-note-input", rows: "3", placeholder: "A note: what you talked about, what to remember…" });
  const addNote = el("button", { type: "button", class: "mu-button primary" }, "Add note");
  addNote.addEventListener("click", async () => {
    if (!noteBox.value.trim()) return noteBox.focus();
    addNote.disabled = true;
    const got = await ctPost("note-add", { id, body: noteBox.value.trim() });
    addNote.disabled = false;
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    ctShow({ kind: "person", id }, true);
  });
  const notes = p.notes.map((n) => {
    const x = el("button", { type: "button", class: "ct-x", "aria-label": "Delete this note" }, svg(CT_ICONS.close));
    x.addEventListener("click", async () => {
      if (!await confirmDialog({ title: "Delete this note?", body: n.body.slice(0, 140), button: "Delete", destructive: true })) return;
      const got = await ctPost("note-delete", { id, noteId: n.id });
      if (!got?.ok) return toast(got?.error || "That didn't work.");
      ctShow({ kind: "person", id }, true);
    });
    return el("div", { class: "ct-note" }, el("div", { class: "ct-note-top" }, el("span", { class: "vd-dim" }, n.at), x), el("p", {}, n.body));
  });

  page.replaceChildren(head,
    el("section", { class: "ct-section" }, el("h2", {}, "Reach them"), ...fields, el("div", { class: "ct-add" }, kind, value)),
    ...(about.length ? [el("section", { class: "ct-section" }, el("h2", {}, "About"), ...about)] : []),
    el("section", { class: "ct-section" }, el("h2", {}, "Notes"), noteBox, el("div", { class: "ct-add-row" }, addNote), ...notes),
    ...(p.url ? [el("p", { class: "vd-dim ct-more" }, "The rest (relationships, reminders, gifts, activities) is in ", el("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, "Monica"), ".")] : []));
}

// ------------------------------------------------------------- edit

async function ctEditPage(page, id) {
  const p = id ? (ct.person?.id === id ? ct.person : await ctGet(`contact?id=${id}`).catch(() => null)) : null;
  if (id && !p) { page.append(el("div", { class: "mu-empty" }, el("p", {}, "Couldn't open them."))); return; }
  const field = (label, input) => el("label", { class: "ct-edit-field" }, el("span", { class: "ct-label" }, label), input);
  const input = (name, value = "", attrs = {}) => el("input", { class: "field-input", type: "text", name, value, ...attrs });
  const first = input("first", p?.first || "", { required: "", maxlength: "50" });
  const last = input("last", p?.last || "", { maxlength: "100" });
  const nick = input("nickname", p?.nickname || "", { maxlength: "100" });
  const bday = input("birthday", p?.birthday ? (p.birthday.yearUnknown ? p.birthday.date.slice(5) : p.birthday.date) : "", { placeholder: "YYYY-MM-DD, or MM-DD", inputmode: "numeric" });
  const desc = el("textarea", { class: "field-input", name: "description", rows: "3", maxlength: "2000" }, p?.description || "");
  const save = el("button", { type: "submit", class: "mu-button primary" }, id ? "Save" : "Add");
  const cancel = el("button", { type: "button", class: "mu-button secondary" }, "Cancel");
  cancel.addEventListener("click", () => ctShow(id ? { kind: "person", id } : { kind: "home" }));
  const form = el("form", { class: "ct-edit" }, field("First name", first), field("Last name", last), field("Nickname", nick),
    field("Birthday", bday), field("About them", desc), el("div", { class: "ct-add-row" }, cancel, save));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    const got = await ctPost(id ? "update" : "create", { id, first: first.value, last: last.value, nickname: nick.value, birthday: bday.value, description: desc.value });
    save.disabled = false;
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    toast(id ? "Saved." : `${first.value.trim()}: added.`);
    await ctLoadList();
    ctShow({ kind: "person", id: got.id || id });
  });
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, id ? `Edit ${p.name}` : "New contact"))), form);
  first.focus();
}

// ------------------------------------------------------------- connect

function ctConnectPage(page) {
  const s = ct.status || {};
  page.append(el("header", { class: "mu-head" }, el("div", {}, el("h1", {}, "Monica"))));
  const box = el("div", { class: "vd-connect" });
  page.append(box);
  if (ctOnline()) {
    const off = el("button", { type: "button", class: "mu-button secondary" }, "Disconnect");
    off.addEventListener("click", async () => {
      const got = await ctPost("connect", { token: "" });
      if (got?.ok) { toast("Disconnected."); await ctLoad(); }
    });
    box.append(el("p", {}, `Connected${s.user ? ` as ${s.user}` : ""}. Your contacts are Monica's: what you change here, its own pages have too.`), off);
    return;
  }
  const why = s.error === "nomonica" ? "Contacts keeps your people in Monica, a personal CRM. Install it from the App Store (or set MONICA_URL in the settings file if it runs elsewhere), then come back here."
    : s.error === "refused" ? "Monica no longer takes the token you gave. Paste a new one."
      : s.error === "unreachable" ? "Monica isn't answering right now. Is it running? The App Store starts it. The token is kept."
        : "Contacts shows and changes the people in Monica, a personal CRM: how to reach them, their birthdays, your notes.";
  const input = el("input", { class: "field-input vd-key", type: "password", placeholder: "Monica API token", autocomplete: "off", spellcheck: "false", "aria-label": "Monica API token" });
  const go = el("button", { type: "button", class: "mu-button primary" }, "Connect");
  const run = async () => {
    const token = input.value.trim();
    if (!token) return input.focus();
    go.disabled = true;
    const got = await ctPost("connect", { token });
    go.disabled = false;
    if (!got?.ok) return toast(got?.error || "That didn't work.");
    toast(`Connected${got.user ? ` as ${got.user}` : ""}.`);
    await ctLoad();
    ctShow({ kind: "home" }, true);
  };
  go.addEventListener("click", run);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  box.append(el("p", {}, why), ...(s.error === "nomonica" ? [] : [
    el("ol", { class: "vd-steps" }, el("li", {}, "Open Monica and make your account (its first page)."),
      el("li", {}, "Settings (top right), then API, then Create a new token under Personal access tokens. Call it adlerOS."),
      el("li", {}, "Copy the token (it's long) and paste it here.")),
    el("div", { class: "vd-key-row" }, input, go)]));
}
