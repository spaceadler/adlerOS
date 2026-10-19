// Terminal: a shell on this machine, in a window. Only there in admin mode
// (with it off, the terminal isn't shown anywhere), and off unless
// ADLEROS_TERMINAL=on on the host. The shell runs in agent/terminal.py on the host; this page sends
// what you type and shows what it writes, through /api/terminal.
// The screen is a small xterm-style emulator: cursor movement, erasing,
// scroll regions, 16/256/true colour, bold/underline/inverse, the alternate
// screen (htop, nano, vim), bracketed paste, and scrollback.
// Uses $, el, api, toast, state, isOpen, openSettings, closeSettings,
// closeStore, closeUsage, closeDrawer, markDockOpen, openModal, closeModal.
"use strict";

// ---------------------------------------------------------------- screen

const TERM_SCROLLBACK = 2000;
const ANSI = ["#1e1e1e", "#e55561", "#8cc265", "#d18f52", "#4aa5f0", "#c162de", "#42b3c2", "#d7dae0",
  "#5c6370", "#ff6b78", "#a5e075", "#f0a45d", "#6cb8ff", "#d68fff", "#56d4e6", "#ffffff"];

function color256(n) {
  if (n < 16) return ANSI[n];
  if (n < 232) {
    const c = n - 16;
    const v = (x) => (x ? 55 + x * 40 : 0);
    return `rgb(${v(Math.floor(c / 36))},${v(Math.floor(c / 6) % 6)},${v(c % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

const BLANK_ATTR = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };

class TermScreen {
  constructor(root, rows, cols) {
    this.root = root;
    this.back = el("div", { class: "term-back" }); // scrollback, oldest first
    this.view = el("div", { class: "term-view" });
    root.replaceChildren(this.back, this.view);
    this.rows = rows;
    this.cols = cols;
    this.title = "";
    this.reset();
  }

  reset() {
    this.attr = { ...BLANK_ATTR };
    this.x = 0;
    this.y = 0;
    this.saved = { x: 0, y: 0, attr: { ...BLANK_ATTR } };
    this.top = 0;
    this.bottom = this.rows - 1;
    this.wrap = true;
    this.pendingWrap = false;
    this.appCursor = false;
    this.bracketed = false;
    this.mouse = 0; // 1000, 1002 or 1003: the program wants the mouse (we send it the wheel)
    this.mouseSgr = false; // 1006: as ESC [ < b ; x ; y M
    this.cursorVisible = true;
    this.alt = null; // the main screen's lines while the alternate one is up
    this.lines = Array.from({ length: this.rows }, () => this.blankLine());
    this.state = "text";
    this.params = "";
    this.dirty = new Set(this.lines.keys());
    this.back.replaceChildren();
    this.scheduleDraw();
  }

  blankLine(attr = BLANK_ATTR) {
    return Array.from({ length: this.cols }, () => ({ ch: " ", a: attr }));
  }

  resize(rows, cols) {
    if (rows === this.rows && cols === this.cols) return;
    const fit = (lines) => {
      for (const line of lines) {
        while (line.length < cols) line.push({ ch: " ", a: BLANK_ATTR });
        line.length = cols;
      }
      while (lines.length < rows) lines.push(Array.from({ length: cols }, () => ({ ch: " ", a: BLANK_ATTR })));
      // Shrinking: rows above the cursor go to the scrollback, as in xterm.
      while (lines.length > rows) {
        const gone = lines.shift();
        if (lines === this.lines && !this.alt) this.pushBack(gone);
        this.y = Math.max(0, this.y - 1);
      }
    };
    this.cols = cols;
    this.rows = rows;
    fit(this.lines);
    if (this.alt) fit(this.alt);
    this.top = 0;
    this.bottom = rows - 1;
    this.x = Math.min(this.x, cols - 1);
    this.y = Math.min(this.y, rows - 1);
    this.dirty = new Set(this.lines.keys());
    this.scheduleDraw();
  }

  // ---- writing

  write(text) {
    for (const ch of text) this.feed(ch);
    this.scheduleDraw();
  }

  feed(ch) {
    const code = ch.codePointAt(0);
    switch (this.state) {
      case "esc": return this.escape(ch);
      case "csi": return this.csiChar(ch);
      case "osc":
        if (ch === "\x07") return this.endOsc();
        if (ch === "\x1b") { this.state = "osc-esc"; return; }
        this.params += ch;
        return;
      case "osc-esc": // ESC \ ends an OSC
        this.endOsc();
        if (ch !== "\\") this.feed(ch);
        return;
      case "charset": this.state = "text"; return; // ESC ( B and friends: ignored
      case "dcs":
        if (ch === "\x1b") this.state = "dcs-esc";
        return;
      case "dcs-esc": this.state = ch === "\\" ? "text" : "dcs"; return;
      default: break;
    }
    if (code < 32 || code === 127) return this.control(ch);
    this.put(ch);
  }

  control(ch) {
    switch (ch) {
      case "\x1b": this.state = "esc"; break;
      case "\r": this.x = 0; this.pendingWrap = false; break;
      case "\n": case "\x0b": case "\x0c": this.lineFeed(); break;
      case "\b": if (this.x > 0) this.x--; this.pendingWrap = false; break;
      case "\t": this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8); break;
      default: break; // BEL and the rest
    }
  }

  put(ch) {
    if (this.pendingWrap) {
      this.x = 0;
      this.lineFeed();
      this.pendingWrap = false;
    }
    this.lines[this.y][this.x] = { ch, a: this.attr };
    this.dirty.add(this.y);
    if (this.x < this.cols - 1) this.x++;
    else if (this.wrap) this.pendingWrap = true;
  }

  lineFeed() {
    if (this.y === this.bottom) this.scrollUp(1);
    else if (this.y < this.rows - 1) this.y++;
  }

  pushBack(line) {
    const row = el("div", { class: "term-row" });
    this.fillRow(row, line, -1);
    this.back.append(row);
    while (this.back.childElementCount > TERM_SCROLLBACK) this.back.firstChild.remove();
  }

  scrollUp(n, toBack = true) {
    for (let i = 0; i < n; i++) {
      const gone = this.lines.splice(this.top, 1)[0];
      if (toBack && this.top === 0 && !this.alt) this.pushBack(gone);
      this.lines.splice(this.bottom, 0, this.blankLine(this.bgAttr()));
    }
    for (let r = this.top; r <= this.bottom; r++) this.dirty.add(r);
  }

  scrollDown(n) {
    for (let i = 0; i < n; i++) {
      this.lines.splice(this.bottom, 1);
      this.lines.splice(this.top, 0, this.blankLine(this.bgAttr()));
    }
    for (let r = this.top; r <= this.bottom; r++) this.dirty.add(r);
  }

  bgAttr() { return this.attr.bg ? { ...BLANK_ATTR, bg: this.attr.bg } : BLANK_ATTR; }

  escape(ch) {
    this.state = "text";
    switch (ch) {
      case "[": this.state = "csi"; this.params = ""; break;
      case "]": this.state = "osc"; this.params = ""; break;
      case "P": this.state = "dcs"; break;
      case "(": case ")": case "*": case "+": this.state = "charset"; break;
      case "7": this.saved = { x: this.x, y: this.y, attr: this.attr }; break;
      case "8": ({ x: this.x, y: this.y, attr: this.attr } = this.saved); break;
      case "D": this.lineFeed(); break;
      case "E": this.x = 0; this.lineFeed(); break;
      case "M": // reverse index
        if (this.y === this.top) this.scrollDown(1);
        else if (this.y > 0) this.y--;
        break;
      case "c": this.reset(); break;
      default: break; // = > and others: keypad modes, ignored
    }
  }

  endOsc() {
    this.state = "text";
    const [kind, ...rest] = this.params.split(";");
    if (kind === "0" || kind === "2") this.title = rest.join(";");
  }

  csiChar(ch) {
    if (/[0-9;?:<=>!"' ]/.test(ch)) {
      this.params += ch;
      if (this.params.length > 64) this.state = "text"; // nonsense: drop it
      return;
    }
    this.state = "text";
    this.csi(ch, this.params);
  }

  csi(final, raw) {
    const priv = raw.startsWith("?");
    const nums = raw.replace(/^[?<=>!]/, "").split(";").map((v) => parseInt(v, 10));
    const n = (i, d = 1) => (Number.isFinite(nums[i]) && nums[i] > 0 ? nums[i] : d);
    const clampY = (y) => Math.max(0, Math.min(this.rows - 1, y));
    const clampX = (x) => Math.max(0, Math.min(this.cols - 1, x));
    this.pendingWrap = false;
    switch (final) {
      case "A": this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n(0)); break;
      case "B": case "e": this.y = Math.min(this.y <= this.bottom ? this.bottom : this.rows - 1, this.y + n(0)); break;
      case "C": case "a": this.x = clampX(this.x + n(0)); break;
      case "D": this.x = clampX(this.x - n(0)); break;
      case "E": this.x = 0; this.y = clampY(this.y + n(0)); break;
      case "F": this.x = 0; this.y = clampY(this.y - n(0)); break;
      case "G": case "`": this.x = clampX(n(0) - 1); break;
      case "d": this.y = clampY(n(0) - 1); break;
      case "H": case "f": this.y = clampY(n(0) - 1); this.x = clampX(n(1) - 1); break;
      case "J": this.eraseDisplay(nums[0] || 0); break;
      case "K": this.eraseLine(nums[0] || 0); break;
      case "X": this.blank(this.y, this.x, Math.min(this.cols, this.x + n(0))); break;
      case "P": { // delete characters
        const line = this.lines[this.y];
        line.splice(this.x, n(0));
        while (line.length < this.cols) line.push({ ch: " ", a: this.bgAttr() });
        this.dirty.add(this.y);
        break;
      }
      case "@": { // insert blanks
        const line = this.lines[this.y];
        line.splice(this.x, 0, ...Array.from({ length: n(0) }, () => ({ ch: " ", a: this.bgAttr() })));
        line.length = this.cols;
        this.dirty.add(this.y);
        break;
      }
      case "L": // insert lines
        if (this.y >= this.top && this.y <= this.bottom) {
          const saveTop = this.top;
          this.top = this.y;
          this.scrollDown(n(0));
          this.top = saveTop;
        }
        break;
      case "M": // delete lines
        if (this.y >= this.top && this.y <= this.bottom) {
          const saveTop = this.top;
          this.top = this.y;
          this.scrollUp(n(0), false); // deleted lines never go to the scrollback
          this.top = saveTop;
        }
        break;
      case "S": this.scrollUp(n(0)); break;
      case "T": this.scrollDown(n(0)); break;
      case "r": // scroll region
        this.top = Math.max(0, n(0) - 1);
        this.bottom = Math.min(this.rows - 1, n(1, this.rows) - 1);
        if (this.top >= this.bottom) { this.top = 0; this.bottom = this.rows - 1; }
        this.x = 0;
        this.y = 0;
        break;
      case "s": this.saved = { x: this.x, y: this.y, attr: this.attr }; break;
      case "u": ({ x: this.x, y: this.y, attr: this.attr } = this.saved); break;
      case "m": this.sgr(raw === "" ? [0] : nums.map((v) => (Number.isFinite(v) ? v : 0))); break;
      case "h": case "l": if (priv) this.mode(nums, final === "h"); break;
      default: break; // device reports and the rest: not needed for a shell
    }
  }

  mode(nums, on) {
    for (const m of nums) {
      if (m === 1) this.appCursor = on;
      else if (m === 7) this.wrap = on;
      else if (m === 25) { this.cursorVisible = on; this.dirty.add(this.y); }
      else if (m === 2004) this.bracketed = on;
      else if (m === 1000 || m === 1002 || m === 1003) this.mouse = on ? m : 0;
      else if (m === 1006) this.mouseSgr = on;
      else if (m === 47 || m === 1047 || m === 1049) this.altScreen(on, m === 1049);
    }
  }

  altScreen(on, saveCursor) {
    if (on && !this.alt) {
      if (saveCursor) this.saved = { x: this.x, y: this.y, attr: this.attr };
      this.alt = this.lines;
      this.lines = Array.from({ length: this.rows }, () => this.blankLine());
    } else if (!on && this.alt) {
      this.lines = this.alt;
      this.alt = null;
      if (saveCursor) ({ x: this.x, y: this.y, attr: this.attr } = this.saved);
    } else {
      return;
    }
    this.root.classList.toggle("alt", Boolean(this.alt));
    this.dirty = new Set(this.lines.keys());
  }

  sgr(p) {
    let a = { ...this.attr };
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) a = { ...BLANK_ATTR };
      else if (v === 1) a.bold = true;
      else if (v === 2) a.dim = true;
      else if (v === 3) a.italic = true;
      else if (v === 4) a.underline = true;
      else if (v === 7) a.inverse = true;
      else if (v === 22) { a.bold = false; a.dim = false; }
      else if (v === 23) a.italic = false;
      else if (v === 24) a.underline = false;
      else if (v === 27) a.inverse = false;
      else if (v >= 30 && v <= 37) a.fg = ANSI[v - 30];
      else if (v >= 90 && v <= 97) a.fg = ANSI[v - 90 + 8];
      else if (v === 39) a.fg = null;
      else if (v >= 40 && v <= 47) a.bg = ANSI[v - 40];
      else if (v >= 100 && v <= 107) a.bg = ANSI[v - 100 + 8];
      else if (v === 49) a.bg = null;
      else if (v === 38 || v === 48) {
        let c = null;
        if (p[i + 1] === 5) { c = color256(p[i + 2] || 0); i += 2; }
        else if (p[i + 1] === 2) { c = `rgb(${p[i + 2] || 0},${p[i + 3] || 0},${p[i + 4] || 0})`; i += 4; }
        if (v === 38) a.fg = c;
        else a.bg = c;
      }
    }
    this.attr = a;
  }

  blank(y, from, to) {
    const attr = this.bgAttr();
    for (let x = from; x < to; x++) this.lines[y][x] = { ch: " ", a: attr };
    this.dirty.add(y);
  }

  eraseLine(mode) {
    if (mode === 0) this.blank(this.y, this.x, this.cols);
    else if (mode === 1) this.blank(this.y, 0, this.x + 1);
    else this.blank(this.y, 0, this.cols);
  }

  eraseDisplay(mode) {
    if (mode === 0) {
      this.eraseLine(0);
      for (let y = this.y + 1; y < this.rows; y++) this.blank(y, 0, this.cols);
    } else if (mode === 1) {
      this.eraseLine(1);
      for (let y = 0; y < this.y; y++) this.blank(y, 0, this.cols);
    } else {
      for (let y = 0; y < this.rows; y++) this.blank(y, 0, this.cols);
      if (mode === 3) this.back.replaceChildren();
    }
  }

  // ---- drawing

  scheduleDraw() {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => this.draw());
  }

  // One row as spans, a span per run of cells that look the same.
  fillRow(row, line, cursorX) {
    const spans = [];
    let run = "";
    let runKey = null;
    let runAttr = null;
    const flush = () => {
      if (!run) return;
      const span = el("span", {}, run);
      const a = runAttr;
      let fg = a.fg;
      let bg = a.bg;
      if (a.inverse !== (runKey && runKey.endsWith("|cur"))) [fg, bg] = [bg || "var(--term-bg)", fg || "var(--term-fg)"];
      if (fg) span.style.color = fg;
      if (bg) span.style.background = bg;
      const cls = [a.bold && "b", a.dim && "d", a.italic && "i", a.underline && "u"].filter(Boolean).join(" ");
      if (cls) span.className = cls;
      spans.push(span);
      run = "";
    };
    line.forEach((cell, x) => {
      const cur = x === cursorX;
      const key = `${cell.a.fg}|${cell.a.bg}|${cell.a.bold}${cell.a.dim}${cell.a.italic}${cell.a.underline}${cell.a.inverse}${cur ? "|cur" : ""}`;
      if (key !== runKey) {
        flush();
        runKey = key;
        runAttr = cell.a;
      }
      run += cell.ch;
    });
    flush();
    row.replaceChildren(...spans);
  }

  draw() {
    this.drawPending = false;
    const view = this.view;
    while (view.childElementCount < this.rows) view.append(el("div", { class: "term-row" }));
    while (view.childElementCount > this.rows) view.lastChild.remove();
    const showCursor = this.cursorVisible && this.focused;
    // The cursor's row changes as it moves: redraw where it was and where it is.
    if (this.cursorRow !== undefined) this.dirty.add(this.cursorRow);
    this.dirty.add(this.y);
    for (const y of this.dirty) {
      if (y < this.rows) this.fillRow(view.children[y], this.lines[y], showCursor && y === this.y ? this.x : -1);
    }
    this.cursorRow = this.y;
    this.dirty.clear();
    if (this.follow) this.root.scrollTop = this.root.scrollHeight;
  }
}

// ---------------------------------------------------------------- keys

function keySequence(e, appCursor) {
  const arrows = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" };
  if (arrows[e.key]) {
    const mod = (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);
    if (mod) return `\x1b[1;${mod + 1}${arrows[e.key]}`;
    return (appCursor ? "\x1bO" : "\x1b[") + arrows[e.key];
  }
  const special = {
    Enter: "\r", Backspace: e.ctrlKey ? "\b" : "\x7f", Tab: e.shiftKey ? "\x1b[Z" : "\t", Escape: "\x1b",
    Home: appCursor ? "\x1bOH" : "\x1b[H", End: appCursor ? "\x1bOF" : "\x1b[F",
    Insert: "\x1b[2~", Delete: "\x1b[3~", PageUp: "\x1b[5~", PageDown: "\x1b[6~",
    F1: "\x1bOP", F2: "\x1bOQ", F3: "\x1bOR", F4: "\x1bOS", F5: "\x1b[15~", F6: "\x1b[17~", F7: "\x1b[18~",
    F8: "\x1b[19~", F9: "\x1b[20~", F10: "\x1b[21~", F11: "\x1b[23~", F12: "\x1b[24~",
  };
  if (special[e.key] !== undefined) return (e.altKey && e.key.length > 1 && !e.key.startsWith("F") ? "\x1b" : "") + special[e.key];
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
    const k = e.key.toLowerCase();
    if (k >= "a" && k <= "z") return String.fromCharCode(k.charCodeAt(0) - 96);
    const extra = { "@": "\x00", " ": "\x00", "[": "\x1b", "\\": "\x1c", "]": "\x1d", "^": "\x1e", _: "\x1f", "?": "\x7f" };
    if (extra[e.key] !== undefined) return extra[e.key];
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) return `\x1b${e.key}`;
  return null; // typed text arrives through the input event
}

// --------------------------------------------------------------- window

// Each terminal window and its shell. The first is #terminal; New window
// (desktop mode) makes more from it, each with a shell of its own.
const terms = new Map();

function makeTerm(id, section) {
  const t = { id, section, sid: null, screen: null, offset: 0, decoder: null, sending: Promise.resolve(), queue: "",
    timer: null, sizeTimer: null, alive: false, wheel: 0,
    screenEl: section.querySelector(".term"), input: section.querySelector(".term-input"),
    status: section.querySelector(".term-status"), closeButton: section.querySelector(".term-close") };
  terms.set(id, t);
  wireTerminal(t);
  return t;
}

const mainTerm = () => terms.get("terminal");
function terminalOpen() { return [...terms.keys()].some((id) => isOpen(id)); }

function toggleTerminal() { toggleWindow("terminal", openTerminal); }

// The terminal: back to its shell, or one still running from before (the
// page reloaded, another tab), else a new one.
async function openTerminal() {
  closeSearch();
  closeMenu();
  closeDrawer();
  const t = mainTerm();
  if (t.alive && t.sid) {
    showTerminalWindow(t);
    return t.input.focus();
  }
  const body = await terminalReady();
  if (!body) return;
  const shown = new Set([...terms.values()].map((x) => x.sid));
  const free = (body.sessions || []).find((sid) => !shown.has(sid));
  if (free) return startTerminal(t, free);
  newTerminal(t);
}

// Another terminal window, with a new shell (Alt+Enter with one open, or
// New window in a terminal's menu).
async function newTerminalWindow() {
  if (!desktopMode()) return openTerminal();
  if (!(await terminalReady())) return;
  let n = 2;
  while ($(`terminal-${n}`)) n++;
  const id = `terminal-${n}`;
  const section = $("terminal").cloneNode(true);
  section.querySelector(":scope > .win-bar")?.remove();
  section.querySelectorAll(":scope > .win-grip").forEach((g) => g.remove());
  for (const node of section.querySelectorAll("[id]")) node.removeAttribute("id");
  Object.assign(section, { id, hidden: true });
  section.classList.remove("active", "minimized", "closing", "off-ws");
  section.removeAttribute("style");
  section.setAttribute("aria-label", `Terminal ${n}`);
  section.querySelector(".term-title").textContent = `Terminal ${n}`;
  document.body.insertBefore(section, $("terminal").nextSibling);
  const t = makeTerm(id, section);
  registerWindow(id, { title: `Terminal ${n}`, close: () => closeTerminal(t), hide: () => hideTerminal(t), icon: "terminal",
    size: [920, 580], copy: true });
  newTerminal(t);
}

// Whether a terminal may open: switched on, admin mode. The body, or null.
async function terminalReady() {
  const { status, body } = await api("/api/terminal").catch(() => ({ status: 0 }));
  if (status === 401) return showLock();
  if (status !== 200) return toast("Can't reach adlerOS right now.");
  if (!body.enabled) return terminalOffDialog();
  if (!body.admin) return toast("The terminal is only there in admin mode (Settings).");
  return body;
}

function terminalOffDialog() {
  const ok = el("button", { type: "button", class: "button-primary wide" }, "OK");
  ok.addEventListener("click", closeModal);
  openModal(el("div", { class: "dialog material", role: "dialog", "aria-modal": "true" },
    el("h2", {}, "The terminal is off"),
    el("p", {}, state.mode === "standalone"
      ? "It's off unless you turn it on, on the machine itself: set ADLEROS_TERMINAL=on in adlerOS's .env and run ./install.sh again."
      : "It's off unless you turn it on, on the machine itself: set ADLEROS_TERMINAL=on in homelab.env and run ./install.sh again."),
    el("div", { class: "dialog-actions" }, ok)));
}

// Straight in: admin mode (which your password turned on) is the key.
async function newTerminal(t) {
  showTerminalWindow(t);
  const size = measureTerminal(t);
  const { status, body } = await api("/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: size.rows, cols: size.cols }),
  }).catch(() => ({ status: 0 }));
  if (status === 200) return startTerminal(t, body.sid);
  if (status === 401) return showLock();
  toast(status === 403 ? "The terminal needs admin mode." : body?.error || "Couldn't open a terminal.");
  if (t.id !== "terminal") closeWindow(t.id);
}

// Rows and columns that fit the window, from one character's size.
function measureTerminal(t) {
  const box = t.screenEl;
  const probe = el("span", { class: "term-probe" }, "W".repeat(10));
  box.append(probe);
  const r = probe.getBoundingClientRect();
  const scale = drawnScale(box); // a zoomed window draws it bigger than its own pixels
  probe.remove();
  const cw = r.width / 10 / scale || 8;
  const ch = r.height / scale || 17;
  const width = box.clientWidth || window.innerWidth - 80;
  const height = box.clientHeight || window.innerHeight - 200;
  return { cols: Math.max(20, Math.floor((width - 16) / cw)), rows: Math.max(5, Math.floor((height - 8) / ch)) };
}

function showTerminalWindow(t) { openWindow(t.id); }

function startTerminal(t, sid) {
  showTerminalWindow(t);
  const size = measureTerminal(t);
  t.sid = sid;
  t.offset = 0;
  t.alive = true;
  t.decoder = new TextDecoder("utf-8");
  t.screen = new TermScreen(t.screenEl, size.rows, size.cols);
  t.screen.follow = true;
  t.status.textContent = "Starting…";
  t.input.focus();
  readTerminal(t, sid);
}

async function readTerminal(t, sid) {
  const asked = Date.now();
  while (t.sid === sid) {
    let result;
    try {
      result = await api(`/api/terminal/${sid}?offset=${t.offset}`);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (t.sid !== sid) return;
    if (result.status === 401) return showLock();
    if (result.status === 403) return endTerminal(t, "Admin mode is off. If it timed out, this shell is still running: turn it on again and open Terminal to get back to it.");
    if (result.status !== 200 || !result.body) return endTerminal(t, "This terminal is gone.");
    const { data, offset, ended, started } = result.body;
    if (data) {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      t.screen.write(t.decoder.decode(bytes, { stream: true }));
      t.status.textContent = t.screen.title || "Connected";
    }
    t.offset = offset;
    if (ended) return endTerminal(t, `Session ended: ${ended.why || "done"}.`);
    if (!started) {
      // The host takes a request for a minute; after that it never will.
      if (Date.now() - asked > 60000) {
        api(`/api/terminal/${sid}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
        return endTerminal(t, "The terminal host didn't answer. On the machine: systemctl status adleros-terminal.path");
      }
      t.status.textContent = "Waiting for the terminal host…";
    }
  }
}

function endTerminal(t, message) {
  t.alive = false;
  t.sid = null;
  t.status.textContent = message;
  t.screen?.write(`\r\n\x1b[2m[${message}]\x1b[0m\r\n`);
}

function sendTerminal(t, text) {
  if (!t.alive || !t.sid || !text) return;
  t.queue += text;
  clearTimeout(t.timer);
  t.timer = setTimeout(() => flushTerminal(t), 8);
}

function flushTerminal(t) {
  const sid = t.sid;
  const bytes = new TextEncoder().encode(t.queue);
  t.queue = "";
  // Small pieces: a request body is at most 4 KB.
  for (let i = 0; i < bytes.length; i += 2400) {
    const piece = bytes.slice(i, i + 2400);
    const data = btoa(String.fromCharCode(...piece));
    t.sending = t.sending.then(() => api(`/api/terminal/${sid}/input`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }),
    }).catch(() => {}));
  }
}

function resizeTerminal(t) {
  if (!t.screen || !isOpen(t.id)) return;
  clearTimeout(t.sizeTimer);
  t.sizeTimer = setTimeout(() => {
    const { rows, cols } = measureTerminal(t);
    t.screen.resize(rows, cols);
    if (t.alive) {
      api(`/api/terminal/${t.sid}/size`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, cols }) }).catch(() => {});
    }
  }, 120);
}

// Ends a window's session: its ✕, Ctrl+Shift+Q. No window: every terminal
// (logging out, admin mode off).
function closeTerminal(t = null) {
  for (const x of t ? [t] : [...terms.values()]) {
    if (x.alive && x.sid) {
      api(`/api/terminal/${x.sid}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    }
    x.alive = false;
    x.sid = null;
    hideTerminal(x);
  }
}

// Puts a window away (no window: all of them); a running shell keeps
// running (t brings the first back). A copy goes for good.
function hideTerminal(t = null) {
  for (const x of t ? [t] : [...terms.values()]) {
    closeWindow(x.id);
    if (x.id !== "terminal") terms.delete(x.id);
  }
}

// ------------------------------------------------------------- wiring

function wireTerminal(t) {
  const input = t.input;
  input.addEventListener("keydown", (e) => {
    // Ctrl+Shift+Q closes the window; everything else goes to the shell.
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "q") {
      e.preventDefault();
      return closeTerminal(t);
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") return; // paste (the paste event sends it)
    if (e.metaKey) return; // ⌘C, ⌘V on a Mac
    const seq = keySequence(e, t.screen?.appCursor);
    if (seq !== null) {
      e.preventDefault();
      e.stopPropagation();
      sendTerminal(t, seq);
    }
  });
  input.addEventListener("input", () => {
    if (input.value) sendTerminal(t, input.value);
    input.value = "";
  });
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text") || "").replace(/\r?\n/g, "\r");
    sendTerminal(t, t.screen?.bracketed ? `\x1b[200~${text}\x1b[201~` : text);
  });
  input.addEventListener("focus", () => { if (t.screen) { t.screen.focused = true; t.screen.scheduleDraw(); } });
  input.addEventListener("blur", () => { if (t.screen) { t.screen.focused = false; t.screen.scheduleDraw(); } });
  // Clicking the screen types into it, unless you were selecting text to copy.
  t.screenEl.addEventListener("mouseup", () => {
    if (!String(window.getSelection())) input.focus();
  });
  // The wheel: a program that asked for the mouse (Claude Code, htop, vim
  // with the mouse on) gets it, and scrolls what it shows itself; one on the
  // alternate screen that didn't (less, man) gets the arrow keys. Otherwise,
  // and always with Shift, the scrollback scrolls.
  t.screenEl.addEventListener("wheel", (e) => {
    const s = t.screen;
    if (!s || !t.alive || e.shiftKey || (!s.mouse && !s.alt)) return;
    e.preventDefault();
    t.wheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines, or pixels
    const steps = Math.trunc(t.wheel / 50);
    if (!steps) return;
    t.wheel -= steps * 50;
    const up = steps < 0;
    let one;
    if (s.mouse) {
      const view = s.view.getBoundingClientRect();
      const col = Math.min(s.cols, Math.max(1, Math.floor((e.clientX - view.left) / (view.width / s.cols)) + 1));
      const row = Math.min(s.rows, Math.max(1, Math.floor((e.clientY - view.top) / (view.height / s.rows)) + 1));
      const b = up ? 64 : 65;
      one = s.mouseSgr ? `\x1b[<${b};${col};${row}M` : `\x1b[M${String.fromCharCode(32 + b, 32 + Math.min(col, 223), 32 + Math.min(row, 223))}`;
    } else {
      one = (s.appCursor ? "\x1bO" : "\x1b[") + (up ? "A" : "B");
    }
    sendTerminal(t, one.repeat(Math.min(Math.abs(steps), 10)));
  }, { passive: false });
  t.screenEl.addEventListener("scroll", () => {
    const box = t.screenEl;
    if (t.screen) t.screen.follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  });
  t.closeButton.addEventListener("click", () => closeTerminal(t));
  // The window's size changes with the screen, or (desktop mode) by dragging.
  new ResizeObserver(() => resizeTerminal(t)).observe(t.screenEl);
}

const firstTerm = makeTerm("terminal", $("terminal"));
registerWindow("terminal", { title: "Terminal", close: () => closeTerminal(firstTerm), hide: () => hideTerminal(firstTerm), dock: "terminal", size: [920, 580] });
