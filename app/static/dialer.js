// Phone, after the iPhone's: Favorites, Recents, Contacts and Keypad, down
// the side (along the top on a phone). Calling hands the number to the
// device's own phone (a tel: link): an iPhone asks "Call …?", a computer
// offers its phone app (FaceTime, a linked phone), if it has one.
// - Contacts: your address book's people (Contacts, CardDAV), each with
//   their numbers: a tap calls, the star makes it a favorite.
// - Keypad: the number as you type it (or paste it), with whose it is; the
//   letters under the digits; hold 0 for +; your keyboard types too.
// - Favorites and Recents (the calls made from adlerOS: a page can't read
//   the phone's own log): the same on every device (/api/phone). A recent
//   opens its person (or its number), as an iPhone's info page; the green
//   button on its right calls.
// Uses $, el, svg, api, toast, winLoad, winSave, openWindow, closeWindow,
// registerWindow, toggleWindow, isOpen, openContacts, ctShow.
"use strict";

const PH_KEY = "adleros.phone";
const PH_AT_KEY = "adleros.phoneAt";
const PH_ICONS = {
  star: ["M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z"],
  recent: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  person: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  keypad: ["M5 4h.01", "M12 4h.01", "M19 4h.01", "M5 10h.01", "M12 10h.01", "M19 10h.01", "M5 16h.01", "M12 16h.01", "M19 16h.01", "M12 21h.01"],
  call: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"],
  back: ["M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z", "m18 9-6 6", "m12 9 6 6"],
  close: ["M18 6 6 18", "m6 6 12 12"], search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  out: ["M7 17 17 7", "M8 7h9v9"], open: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
};
const PH_KEYS = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];
const PH_TYPES = { mobile: "mobile", iphone: "iPhone", home: "home", work: "work", main: "main", other: "phone" };

const dial = { built: false, tab: "keypad", typed: "", people: null, peopleAt: 0, q: "", person: null, number: null, sendTimer: null };

// ------------------------------------------------------------ what's kept

function phData() {
  const d = winLoad(PH_KEY, {}) || {};
  return { favorites: Array.isArray(d.favorites) ? d.favorites : [], recents: Array.isArray(d.recents) ? d.recents : [] };
}
function phSave(d) {
  winSave(PH_KEY, d);
  winSave(PH_AT_KEY, Date.now());
  clearTimeout(dial.sendTimer);
  dial.sendTimer = setTimeout(() => api("/api/phone", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ at: winLoad(PH_AT_KEY, Date.now()), data: winLoad(PH_KEY, {}) }) }).catch(() => {}), 300);
}
// The server's copy when it's newer; this one, the first time.
async function phSync() {
  const r = await api("/api/phone").catch(() => null);
  if (r?.status !== 200) return;
  if (!r.body.data) { if (localStorage.getItem(PH_KEY)) phSave(phData()); return; }
  if (r.body.at <= winLoad(PH_AT_KEY, 0)) return;
  winSave(PH_KEY, r.body.data);
  winSave(PH_AT_KEY, r.body.at);
  if (dial.built && isOpen("phone") && dial.tab !== "keypad" && !$("phone").contains(document.activeElement?.closest?.("input") || null)) phRender();
}

// A number as dialled: digits, and + * # , ; (a pause, a wait) only.
const phDial = (n) => String(n || "").replace(/[^\d+*#,;]/g, "");
// The digits alone, for matching (the last nine: "+962 79…" is "079…").
const phTail = (n) => phDial(n).replace(/\D/g, "").slice(-9);

// ------------------------------------------------------------- calling

function phCall(number, name = "") {
  const n = phDial(number);
  if (!n) return toast("No number to call.");
  const who = name || phWho(n)?.name || "";
  const d = phData();
  d.recents = [{ number: n, name: who, at: Date.now() }, ...d.recents].slice(0, 100);
  phSave(d);
  // A link to the device's phone: a tap on an iPhone asks to call.
  const a = el("a", { href: `tel:${n}` });
  document.body.append(a);
  a.click();
  a.remove();
  toast(`Calling ${who || number}…`);
  if (dial.tab === "recents" && isOpen("phone")) phRender();
}

// Whose number it is, from your contacts (by its last digits).
function phWho(number) {
  const tail = phTail(number);
  if (tail.length < 6 || !dial.people) return null;
  for (const c of dial.people) for (const p of c.phones) if (phTail(p.value) === tail) return { name: c.name, id: c.id, type: p.type };
  return null;
}

async function phPeople(again = false) {
  if (dial.people && !again && Date.now() - dial.peopleAt < 60000) return dial.people;
  const r = await api(`/api/contacts/cards${again ? "?again=1" : ""}`).catch(() => null);
  if (r?.status === 200) { dial.people = r.body.contacts.filter((c) => c.phones.length); dial.peopleAt = Date.now(); }
  else if (!dial.people) dial.people = [];
  return dial.people;
}

// --------------------------------------------------------------- the window

function openPhone(tab) {
  phBuild();
  if (tab) dial.tab = tab;
  openWindow("phone");
  phRender();
  phPeople().then(() => { if (isOpen("phone")) phRender(); });
}
function togglePhone() { toggleWindow("phone", () => openPhone()); }
function closePhone() { closeWindow("phone"); }

function phBuild() {
  if (dial.built) return;
  dial.built = true;
  const close = el("button", { class: "sheet-close mu-close", type: "button", "aria-label": "Close Phone" }, svg(PH_ICONS.close));
  close.addEventListener("click", closePhone);
  const section = el("section", { id: "phone", class: "sheet music-app phone-app", "aria-label": "Phone", hidden: "" },
    el("div", { class: "sheet-bg", "aria-hidden": "true" }, el("div", { class: "sheet-wallpaper" }), el("div", { class: "sheet-tint" })),
    close,
    el("div", { class: "mu-shell" },
      el("aside", { class: "mu-side" }, el("nav", { class: "mu-side-nav", id: "ph-nav", "aria-label": "Phone" })),
      el("main", { class: "mu-main ph-main", id: "ph-main", tabindex: "-1" })));
  document.body.insertBefore(section, $("modal"));
  registerWindow("phone", { title: "Phone", close: closePhone, hide: () => closeWindow("phone"), dock: "phone", size: [880, 700] });
  // The keyboard types on the keypad (not while a field has it).
  section.addEventListener("keydown", (e) => {
    if (dial.tab !== "keypad" || e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[\d*#+]$/.test(e.key)) { e.preventDefault(); phType(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); dial.typed = dial.typed.slice(0, -1); phKeypadShow(); }
    else if (e.key === "Enter" && dial.typed) { e.preventDefault(); phCall(dial.typed); }
  });
  section.addEventListener("paste", (e) => {
    if (dial.tab !== "keypad" || e.target.closest("input, textarea")) return;
    const text = e.clipboardData?.getData("text") || "";
    if (phDial(text)) { e.preventDefault(); dial.typed = phDial(text); phKeypadShow(); }
  });
}

function phRender() {
  if (!dial.built) return;
  const item = (tab, icon, label) => {
    const b = el("button", { type: "button", class: `mu-nav${dial.tab === tab ? " on" : ""}` }, svg(icon), el("span", {}, label));
    b.addEventListener("click", () => { dial.tab = tab; dial.person = null; dial.number = null; phRender(); });
    return b;
  };
  $("ph-nav").replaceChildren(item("favorites", PH_ICONS.star, "Favorites"), item("recents", PH_ICONS.recent, "Recents"),
    item("contacts", PH_ICONS.person, "Contacts"), item("keypad", PH_ICONS.keypad, "Keypad"));
  const main = $("ph-main");
  if (dial.person) return phPerson(main, dial.person);
  if (dial.number) {
    // Your contacts came in since: it's someone's after all.
    const who = phWho(dial.number);
    if (!who) return phNumber(main, dial.number);
    dial.person = who.id;
    dial.number = null;
    return phPerson(main, who.id);
  }
  ({ favorites: phFavorites, recents: phRecents, contacts: phContacts, keypad: phKeypad }[dial.tab] || phKeypad)(main);
}

const phAvatar = (c) => (c?.photo ? el("img", { class: "ct-avatar", src: `/api/contacts/card-photo?id=${c.id}`, alt: "" })
  : el("span", { class: "ct-avatar" }, c?.initials || (c?.name || "#").slice(0, 1).toUpperCase()));

// The green button on a row's right that calls.
function phCallButton(number, name) {
  const b = el("button", { type: "button", class: "ph-call-mini", "aria-label": `Call ${name || number}`, title: "Call" }, svg(PH_ICONS.call));
  b.addEventListener("click", () => phCall(number, name));
  return b;
}

// When a call was: the time today, Yesterday, the weekday this week, else the date.
function phWhen(at) {
  const t = new Date(at), today = new Date();
  if (t.toDateString() === today.toDateString()) return t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(today.toDateString()) - new Date(t.toDateString())) / 86400000);
  return days === 1 ? "Yesterday" : days < 7 ? t.toLocaleDateString([], { weekday: "long" }) : t.toLocaleDateString();
}

// The calls made to these numbers, newest first, on a person's (or a number's) page.
function phHistory(numbers) {
  const tails = new Set(numbers.map(phTail).filter(Boolean));
  const calls = phData().recents.filter((r) => tails.has(phTail(r.number))).slice(0, 10);
  if (!calls.length) return [];
  return [el("h3", { class: "ph-history-title" }, "Recent calls"), el("div", { class: "ph-history" }, ...calls.map((r) => {
    const t = new Date(r.at);
    return el("div", { class: "ph-history-row" }, el("span", {}, `${phWhen(r.at)}${t.toDateString() === new Date().toDateString() ? "" : `, ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}`),
      el("span", { class: "vd-dim" }, numbers.length > 1 ? `Outgoing · ${r.number}` : "Outgoing call"));
  }))];
}

// A row you tap (to call, or to open); a button on its right for more.
function phRow(main, sub, onTap, side = null) {
  const b = el("button", { type: "button", class: "ph-row" }, el("span", { class: "ph-row-text" }, el("strong", {}, main), sub ? el("span", {}, sub) : ""));
  b.addEventListener("click", onTap);
  return el("div", { class: "ph-row-box" }, b, side || "");
}

// ------------------------------------------------------------ Favorites

function phFavorites(main) {
  const d = phData();
  const rows = d.favorites.map((f, i) => {
    const x = el("button", { type: "button", class: "ph-side-button", "aria-label": `Take ${f.name} out of Favorites` }, svg(PH_ICONS.close));
    x.addEventListener("click", () => { const y = phData(); y.favorites.splice(i, 1); phSave(y); phRender(); });
    return phRow(f.name, PH_TYPES[f.type] || f.type || "phone", () => phCall(f.number, f.name), x);
  });
  main.replaceChildren(el("div", { class: "mu-page ph-page" }, el("header", { class: "mu-head" }, el("h1", {}, "Favorites")),
    ...(rows.length ? rows : [el("p", { class: "vd-dim" }, "None yet: the star beside a number (in Contacts) puts it here.")])));
}

// -------------------------------------------------------------- Recents

// A tap opens who it was (their numbers, the calls to them), as an iPhone's
// info page, never a call by accident; the green button calls.
function phRecents(main) {
  const d = phData();
  const rows = d.recents.map((r) => {
    const who = phWho(r.number);
    const name = who?.name || r.name || "";
    const side = el("span", { class: "ph-row-side" }, el("span", { class: "ph-when" }, phWhen(r.at)), phCallButton(r.number, name));
    return phRow(name || r.number, `↗ ${who ? PH_TYPES[who.type] || who.type : name ? r.number : "phone"}`, () => {
      if (who) dial.person = who.id; else dial.number = r.number;
      phRender();
    }, side);
  });
  const clear = el("button", { type: "button", class: "cl-text-button" }, "Clear");
  clear.addEventListener("click", () => { const y = phData(); y.recents = []; phSave(y); phRender(); });
  main.replaceChildren(el("div", { class: "mu-page ph-page" }, el("header", { class: "mu-head cl-head" }, el("h1", {}, "Recents"), d.recents.length ? clear : ""),
    ...(rows.length ? rows : [el("p", { class: "vd-dim" }, "No calls yet. The ones made from adlerOS show here (your phone's own list is the phone's).")])));
}

// ------------------------------------------------------------- Contacts

function phContacts(main) {
  const search = el("input", { class: "field-input mu-search ph-search", type: "search", placeholder: "Search", value: dial.q, spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "ph-list" });
  const draw = () => {
    const q = dial.q.toLowerCase();
    const people = (dial.people || []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.phones.some((p) => phTail(p.value).includes(q.replace(/\D/g, "") || "~")));
    if (!dial.people) return list.replaceChildren(el("p", { class: "vd-dim" }, "Opening your contacts…"));
    if (!dial.people.length) return list.replaceChildren(el("p", { class: "vd-dim" }, "No one with a number: Phone uses your address book (Contacts)."));
    let letter = "";
    const rows = [];
    for (const c of people) {
      const l = /[A-Z]/i.test(c.name[0]) ? c.name[0].toUpperCase() : "#";
      if (l !== letter) { letter = l; rows.push(el("h3", { class: "ct-letter" }, l)); }
      const b = el("button", { type: "button", class: "ph-person" }, phAvatar(c), el("span", {}, c.name));
      b.addEventListener("click", () => { dial.person = c.id; phRender(); });
      rows.push(b);
    }
    list.replaceChildren(...rows);
  };
  search.addEventListener("input", () => { dial.q = search.value.trim(); draw(); });
  main.replaceChildren(el("div", { class: "mu-page ph-page" }, el("header", { class: "mu-head" }, el("h1", {}, "Contacts")), search, list));
  draw();
}

// One person: their numbers (a tap, or the green button, calls; the star: Favorites), and the calls to them.
function phPerson(main, id) {
  const c = (dial.people || []).find((x) => x.id === id);
  if (!c) { dial.person = null; return phRender(); }
  const back = el("button", { type: "button", class: "cl-text-button" }, "‹ Back");
  back.addEventListener("click", () => { dial.person = null; phRender(); });
  const open = el("button", { type: "button", class: "cl-text-button" }, "Open in Contacts");
  open.addEventListener("click", () => openContacts().then(() => ctShow({ kind: "person", id })));
  const d = phData();
  const rows = c.phones.map((p) => {
    const fav = d.favorites.some((f) => phTail(f.number) === phTail(p.value));
    const star = el("button", { type: "button", class: `ph-side-button ph-star${fav ? " on" : ""}`, "aria-label": fav ? "Take out of Favorites" : "Add to Favorites", "aria-pressed": String(fav) }, svg(PH_ICONS.star));
    star.addEventListener("click", () => {
      const y = phData();
      if (fav) y.favorites = y.favorites.filter((f) => phTail(f.number) !== phTail(p.value));
      else y.favorites.push({ name: c.name, number: p.value, type: p.type, id: c.id });
      phSave(y);
      phRender();
    });
    return phRow(p.value, PH_TYPES[p.type] || p.type, () => phCall(p.value, c.name), el("span", { class: "ph-row-side" }, star, phCallButton(p.value, c.name)));
  });
  main.replaceChildren(el("div", { class: "mu-page ph-page" }, el("div", { class: "ph-person-bar" }, back, open),
    el("div", { class: "ph-person-head" }, phAvatar(c), el("h1", {}, c.name), c.company ? el("p", { class: "vd-dim" }, c.company) : ""), ...rows,
    ...phHistory(c.phones.map((p) => p.value))));
}

// A number that's no one's in your contacts: it, the star, the calls to it.
function phNumber(main, number) {
  const back = el("button", { type: "button", class: "cl-text-button" }, "‹ Back");
  back.addEventListener("click", () => { dial.number = null; phRender(); });
  const d = phData();
  const name = d.recents.find((r) => phTail(r.number) === phTail(number) && r.name)?.name || "";
  const fav = d.favorites.some((f) => phTail(f.number) === phTail(number));
  const star = el("button", { type: "button", class: `ph-side-button ph-star${fav ? " on" : ""}`, "aria-label": fav ? "Take out of Favorites" : "Add to Favorites", "aria-pressed": String(fav) }, svg(PH_ICONS.star));
  star.addEventListener("click", () => {
    const y = phData();
    if (fav) y.favorites = y.favorites.filter((f) => phTail(f.number) !== phTail(number));
    else y.favorites.push({ name: name || number, number, type: "other" });
    phSave(y);
    phRender();
  });
  main.replaceChildren(el("div", { class: "mu-page ph-page" }, el("div", { class: "ph-person-bar" }, back, el("span")),
    el("div", { class: "ph-person-head" }, phAvatar({ name: "#" }), el("h1", {}, name || number), el("p", { class: "vd-dim" }, name ? number : "Not in your contacts")),
    phRow(number, "phone", () => phCall(number, name), el("span", { class: "ph-row-side" }, star, phCallButton(number, name))), ...phHistory([number])));
}

// --------------------------------------------------------------- Keypad

function phKeypad(main) {
  const keys = PH_KEYS.map(([digit, letters]) => {
    const b = el("button", { type: "button", class: "ph-key", "aria-label": digit }, el("strong", {}, digit), el("span", {}, letters || " "));
    let held = null;
    // Hold 0 for +.
    b.addEventListener("pointerdown", () => { if (digit === "0") held = setTimeout(() => { held = "plus"; phType("+"); }, 550); });
    b.addEventListener("click", () => {
      if (held === "plus") { held = null; return; }
      clearTimeout(held);
      held = null;
      phType(digit);
    });
    return b;
  });
  const call = el("button", { type: "button", class: "ph-call", "aria-label": "Call" }, svg(PH_ICONS.call));
  call.addEventListener("click", () => {
    if (dial.typed) return phCall(dial.typed);
    const last = phData().recents[0]; // as an iPhone: the last number, ready
    if (last) { dial.typed = last.number; phKeypadShow(); }
  });
  const del = el("button", { type: "button", class: "ph-del", "aria-label": "Delete" }, svg(PH_ICONS.back));
  let hold = null;
  del.addEventListener("pointerdown", () => { hold = setTimeout(() => { dial.typed = ""; phKeypadShow(); hold = "all"; }, 600); });
  del.addEventListener("click", () => { if (hold === "all") { hold = null; return; } clearTimeout(hold); dial.typed = dial.typed.slice(0, -1); phKeypadShow(); });
  main.replaceChildren(el("div", { class: "mu-page ph-page ph-keypad-page" },
    el("div", { class: "ph-display" }, el("div", { class: "ph-number", id: "ph-number" }), el("div", { class: "ph-who", id: "ph-who" })),
    el("div", { class: "ph-keys" }, ...keys), el("div", { class: "ph-keys-foot" }, el("span"), call, del)));
  phKeypadShow();
  main.focus({ preventScroll: true });
}
function phType(ch) {
  if (dial.typed.length >= 40) return;
  dial.typed += ch;
  phKeypadShow();
}
function phKeypadShow() {
  if (!$("ph-number")) return;
  $("ph-number").textContent = dial.typed;
  const who = phWho(dial.typed);
  $("ph-who").textContent = who ? `${who.name} · ${PH_TYPES[who.type] || who.type}` : "";
  document.querySelector(".ph-del")?.classList.toggle("on", Boolean(dial.typed));
}

setInterval(phSync, 8000);
phSync();
