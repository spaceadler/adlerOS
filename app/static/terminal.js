// Terminal: a shell on this machine, in a window. Only there in admin mode
// (with it off, the terminal isn't shown anywhere), and off unless
// ADLEROS_TERMINAL=on on the host. The shell runs in agent/terminal.py on the
// host; each window has one connection to it, a WebSocket
// (/api/terminal/<id>/ws): what you type goes up it, what the shell writes
// comes down it. If it drops (a reload, the network, adlerOS restarting), the
// window connects again and gets the screen back.
// The screen is a small xterm-style emulator: cursor movement, erasing,
// scroll regions, 16/256/true colour, bold/underline/inverse, wide characters
// (emoji, CJK), the alternate screen (htop, nano, vim), the mouse for programs
// that ask, bracketed paste, answers to the usual queries, and scrollback.
// Uses $, el, api, toast, state, isOpen, openSettings, closeSettings,
// closeStore, closeUsage, closeDrawer, markDockOpen, openModal, closeModal.
"use strict";

// ---------------------------------------------------------------- screen

const TERM_SCROLLBACK = 5000;

// How many cells a character takes: 2 for East Asian wide ones and emoji,
// 0 for marks that go on the one before (accents, joiners, emoji's variation
// selector), else 1. Ranges as wcwidth has them, the common ones.
const TERM_ZERO = [[0x300, 0x36f], [0x483, 0x489], [0x591, 0x5bd], [0x610, 0x61a], [0x64b, 0x65f], [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef]];
const TERM_WIDE = [[0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd]];
function inRanges(code, ranges) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (code < ranges[mid][0]) hi = mid - 1;
    else if (code > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}
function cellWidth(code) {
  if (code < 0x300) return 1;
  if (inRanges(code, TERM_ZERO)) return 0;
  return inRanges(code, TERM_WIDE) ? 2 : 1;
}
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
    this.quiet = false; // replaying old output: its queries aren't answered again, its copies not copied again
    this.reset();
  }

  answer(text) { if (!this.quiet) this.reply?.(text); }

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
    this.root.classList.remove("alt");
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
        if (this.params.length < 1 << 20) this.params += ch; // OSC 52 carries a whole copy; one never ended doesn't grow forever
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
    const width = cellWidth(ch.codePointAt(0));
    const line = this.lines[this.y];
    if (width === 0) { // a mark: on the character before it
      const x = this.pendingWrap ? this.x : this.x - 1;
      const at = line[x]?.cont ? x - 1 : x;
      if (at >= 0) line[at] = { ...line[at], ch: line[at].ch + ch };
      this.dirty.add(this.y);
      return;
    }
    if (this.pendingWrap || (width === 2 && this.x === this.cols - 1)) {
      if (!this.pendingWrap && this.wrap) line[this.x] = { ch: " ", a: this.attr }; // no room for both halves here
      if (this.pendingWrap || this.wrap) {
        this.x = 0;
        this.lineFeed();
      }
      this.pendingWrap = false;
    }
    const row = this.lines[this.y];
    // Writing over half of a wide one: its other half goes too.
    if (row[this.x].cont && this.x > 0) row[this.x - 1] = { ch: " ", a: row[this.x - 1].a };
    const end = this.x + width - 1;
    if (row[end]?.wide && end + 1 < this.cols) row[end + 1] = { ch: " ", a: row[end + 1].a };
    if (width === 2 && this.x < this.cols - 1) {
      row[this.x] = { ch, a: this.attr, wide: true };
      row[this.x + 1] = { ch: "", a: this.attr, cont: true };
    } else {
      row[this.x] = { ch, a: this.attr };
    }
    this.dirty.add(this.y);
    const next = this.x + Math.min(width, this.cols - this.x);
    if (next < this.cols) this.x = next;
    else if (this.wrap) { this.x = this.cols - 1; this.pendingWrap = true; }
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
    // OSC 52: a program putting something on the clipboard (nvim's "+y, tmux).
    if (kind === "52" && rest.length === 2 && rest[1] !== "?" && !this.quiet) {
      try {
        const bytes = Uint8Array.from(atob(rest[1]), (c) => c.charCodeAt(0));
        navigator.clipboard?.writeText(new TextDecoder().decode(bytes)).catch(() => {});
      } catch { /* not base64 */ }
    }
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
      // Asked where the cursor is (CSI 6 n), whether all's well (5 n), what
      // this terminal is (CSI c, CSI > c): answered like xterm, as a program
      // may wait for the answer.
      case "n":
        if (!priv && nums[0] === 6) this.answer(`\x1b[${this.y + 1};${this.x + 1}R`);
        else if (!priv && nums[0] === 5) this.answer("\x1b[0n");
        break;
      case "c":
        if (raw.startsWith(">")) this.answer("\x1b[>0;276;0c");
        else if (!priv && !nums[0]) this.answer("\x1b[?62;22c");
        break;
      default: break; // the rest: not needed for a shell
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
    let runWide = false;
    const flush = () => {
      if (!run) return;
      const span = el("span", {}, run);
      const a = runAttr;
      let fg = a.fg;
      let bg = a.bg;
      if (a.inverse !== (runKey && runKey.endsWith("|cur"))) [fg, bg] = [bg || "var(--term-bg)", fg || "var(--term-fg)"];
      if (fg) span.style.color = fg;
      if (bg) span.style.background = bg;
      // A wide one is a span of its own, exactly two cells wide: an emoji's
      // own width depends on the font, and the columns after it mustn't move.
      const cls = [a.bold && "b", a.dim && "d", a.italic && "i", a.underline && "u", runWide && "w"].filter(Boolean).join(" ");
      if (cls) span.className = cls;
      spans.push(span);
      run = "";
    };
    line.forEach((cell, x) => {
      if (cell.cont) return; // the second half of a wide one
      const cur = x === cursorX;
      const key = `${cell.a.fg}|${cell.a.bg}|${cell.a.bold}${cell.a.dim}${cell.a.italic}${cell.a.underline}${cell.a.inverse}${cur ? "|cur" : ""}`;
      if (key !== runKey || cell.wide || runWide) {
        flush();
        runKey = key;
        runAttr = cell.a;
        runWide = Boolean(cell.wide);
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
  const t = { id, section, sid: null, screen: null, decoder: null, ws: null, attached: false, pending: "", retries: 0,
    retryTimer: null, sizeTimer: null, alive: false, wheel: 0, mouseDown: -1, mouseCell: "",
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

// Open in Terminal (My Computer): a shell in that folder. On a computer, a
// window of its own; else the terminal, its shell moved there if it's open.
async function openTerminalAt(path) {
  closeMenu();
  if (desktopMode()) return newTerminalWindow(path);
  if (!(await terminalReady())) return;
  const t = mainTerm();
  if (t.alive && t.sid) {
    showTerminalWindow(t);
    sendTerminal(t, ` cd -- '${hostPath(path).replace(/'/g, "'\\''")}'\r`);
    return t.input.focus();
  }
  newTerminal(t, path);
}

// Another terminal window, with a new shell (Alt+Enter with one open, or
// New window in a terminal's menu); `path`: in that folder.
async function newTerminalWindow(path = null) {
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
  section.classList.remove("active", "minimized", "closing", "off-ws", "win-genie");
  section.removeAttribute("style");
  section.setAttribute("aria-label", `Terminal ${n}`);
  section.querySelector(".term-title").textContent = `Terminal ${n}`;
  document.body.insertBefore(section, $("terminal").nextSibling);
  const t = makeTerm(id, section);
  registerWindow(id, { title: `Terminal ${n}`, close: () => closeTerminal(t), hide: () => hideTerminal(t), icon: "terminal",
    size: [920, 580], copy: true });
  newTerminal(t, path);
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
async function newTerminal(t, path = null) {
  showTerminalWindow(t);
  const size = measureTerminal(t);
  const { status, body } = await api("/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: size.rows, cols: size.cols, ...(path ? { path } : {}) }),
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
  t.alive = true;
  t.retries = 0;
  t.screen = new TermScreen(t.screenEl, size.rows, size.cols);
  t.screen.follow = true;
  t.screen.reply = (answer) => sendTerminal(t, answer);
  t.decoder = new TextDecoder("utf-8");
  t.status.textContent = "Connecting…";
  t.input.focus();
  connectTerminal(t, sid);
}

// The window's one connection to its shell. Binary messages are what the
// shell wrote; text ones say how things stand (TerminalRelay in server.py).
function connectTerminal(t, sid) {
  clearTimeout(t.retryTimer);
  t.ws?.close();
  t.attached = false;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${sid}/ws`);
  ws.binaryType = "arraybuffer";
  t.ws = ws;
  let over = false; // ended, or turned away: not to be connected again
  ws.addEventListener("message", (e) => {
    if (t.ws !== ws) return;
    if (typeof e.data !== "string") {
      t.screen.write(t.decoder.decode(new Uint8Array(e.data), { stream: true }));
      t.status.textContent = t.screen.title || "Connected";
      return;
    }
    const msg = JSON.parse(e.data);
    if (msg.waiting) t.status.textContent = "Waiting for the terminal host…";
    if (msg.attached) {
      // The output again from the last of it: onto a clear screen.
      t.attached = true;
      t.retries = 0;
      t.decoder = new TextDecoder("utf-8");
      t.screen.reset();
      t.screen.quiet = true; // until {"live"}: what comes first is old
      t.status.textContent = "Connected";
      const { rows, cols } = measureTerminal(t);
      t.screen.resize(rows, cols);
      ws.send(JSON.stringify({ size: [rows, cols] }));
      if (t.pending) {
        ws.send(new TextEncoder().encode(t.pending));
        t.pending = "";
      }
    }
    if (msg.live) t.screen.quiet = false;
    if (msg.ended) {
      over = true;
      endTerminal(t, `Session ended: ${msg.ended.why || "done"}.`);
    }
    if (msg.error === "admin") {
      over = true;
      endTerminal(t, "Admin mode is off. If it timed out, this shell is still running: turn it on again and open Terminal to get back to it.");
    }
  });
  ws.addEventListener("close", () => {
    if (t.ws !== ws) return;
    t.ws = null;
    t.attached = false;
    if (!over && t.alive && t.sid === sid) reconnectTerminal(t, sid);
  });
}

// Dropped (the network, adlerOS restarting): again, a little later each
// time, as long as the shell is still there to go back to.
async function reconnectTerminal(t, sid) {
  t.status.textContent = "Reconnecting…";
  const { status, body } = await api("/api/terminal").catch(() => ({ status: 0 }));
  if (t.sid !== sid || !t.alive) return;
  if (status === 401) return showLock();
  if (status === 200 && !body.admin) return endTerminal(t, "Admin mode is off. If it timed out, this shell is still running: turn it on again and open Terminal to get back to it.");
  if (status === 200 && !(body.sessions || []).includes(sid)) return endTerminal(t, "This terminal is gone.");
  const wait = Math.min(10000, 500 * 2 ** t.retries++);
  t.retryTimer = setTimeout(() => { if (t.sid === sid && t.alive) connectTerminal(t, sid); }, wait);
}

function endTerminal(t, message) {
  t.alive = false;
  t.sid = null;
  clearTimeout(t.retryTimer);
  const ws = t.ws;
  t.ws = null;
  ws?.close();
  t.status.textContent = message;
  t.screen?.write(`\r\n\x1b[2m[${message}]\x1b[0m\r\n`);
}

// What you typed, up the connection; held for a moment if it's (re)connecting.
function sendTerminal(t, text) {
  if (!t.alive || !t.sid || !text) return;
  if (t.ws?.readyState === WebSocket.OPEN && t.attached) t.ws.send(new TextEncoder().encode(text));
  else if (t.pending.length < 65536) t.pending += text;
}

function resizeTerminal(t) {
  if (!t.screen || !isOpen(t.id)) return;
  clearTimeout(t.sizeTimer);
  t.sizeTimer = setTimeout(() => {
    const { rows, cols } = measureTerminal(t);
    t.screen.resize(rows, cols);
    if (t.alive && t.attached && t.ws?.readyState === WebSocket.OPEN) t.ws.send(JSON.stringify({ size: [rows, cols] }));
  }, 120);
}

// Ends a window's session: its ✕, Ctrl+Shift+Q. No window: every terminal
// (logging out, admin mode off).
function closeTerminal(t = null) {
  for (const x of t ? [t] : [...terms.values()]) {
    if (x.alive && x.sid) {
      if (x.ws?.readyState === WebSocket.OPEN) x.ws.send(JSON.stringify({ close: true }));
      else api(`/api/terminal/${x.sid}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    }
    x.alive = false;
    x.sid = null;
    clearTimeout(x.retryTimer);
    // Its close goes first; the connection after it.
    const ws = x.ws;
    x.ws = null;
    if (ws) setTimeout(() => ws.close(), 300);
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

// A touch screen's keys (a phone has none of these): a translucent bar at
// the bottom. Ctrl, Alt and Shift stay down for the next key, the phone
// keyboard's too (Ctrl, then C: ^C); two taps keep one down until a third.
// The bar never takes the focus, so the keyboard stays up.
const TERM_KEYS = [
  [["Esc", "Escape"], ["Tab", "Tab"], ["Ctrl", "ctrl"], ["Alt", "alt"], ["Shift", "shift"], ["~", "~"], ["|", "|"], ["/", "/"], ["-", "-"]],
  [["Home", "Home"], ["End", "End"], ["PgUp", "PageUp"], ["PgDn", "PageDown"], ["←", "ArrowLeft"], ["↑", "ArrowUp"], ["↓", "ArrowDown"], ["→", "ArrowRight"]],
];
const TERM_MODS = ["ctrl", "alt", "shift"];
function termKeysBar(t) {
  let bar = t.section.querySelector(".term-keys");
  if (!bar) {
    bar = el("div", { class: "term-keys", role: "toolbar", "aria-label": "Keys" },
      ...TERM_KEYS.map((row) => el("div", { class: "term-keys-row" }, ...row.map(([label, key]) =>
        el("button", { type: "button", class: `term-key${TERM_MODS.includes(key) ? " mod" : ""}${key.startsWith("Arrow") ? " term-arrow" : ""}`, tabindex: "-1", "data-key": key,
          "aria-label": { "←": "Left", "↑": "Up", "↓": "Down", "→": "Right" }[label] || label }, label)))));
    t.screenEl.after(bar);
  }
  t.mods = { ctrl: 0, alt: 0, shift: 0 }; // 0 up, 1 for the next key, 2 kept down
  const lastTap = {};
  bar.addEventListener("pointerdown", (e) => e.preventDefault()); // the focus (and the keyboard) stays where it is
  bar.addEventListener("click", (e) => {
    const b = e.target.closest(".term-key");
    if (!b) return;
    const key = b.dataset.key;
    if (TERM_MODS.includes(key)) {
      const now = performance.now();
      const twice = now - (lastTap[key] || 0) < 350;
      lastTap[key] = now;
      t.mods[key] = t.mods[key] ? (twice && t.mods[key] === 1 ? 2 : 0) : 1;
      termModsShow(t);
    } else {
      sendTerminal(t, termKeyWithMods(t, key) ?? key);
      termModsUsed(t);
    }
    if (navigator.vibrate) navigator.vibrate(5);
  });
  // The phone's keyboard opening: the bar (and the screen's last line) sit
  // on top of it, not under it.
  if (window.visualViewport && !t.section.kbWatch) {
    t.section.kbWatch = true; // a property, not an attribute: a cloned window watches too
    const place = () => {
      const vv = window.visualViewport;
      const under = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      t.section.style.setProperty("--kb", `${Math.round(under)}px`);
    };
    visualViewport.addEventListener("resize", place);
    visualViewport.addEventListener("scroll", place);
  }
}
function termModsShow(t) {
  for (const k of TERM_MODS) {
    const b = t.section.querySelector(`.term-key[data-key="${k}"]`);
    b?.classList.toggle("on", t.mods[k] > 0);
    b?.classList.toggle("locked", t.mods[k] === 2);
    b?.setAttribute("aria-pressed", String(t.mods[k] > 0));
  }
}
// A key with the modifiers that are down (the bar's): its sequence, or null.
function termKeyWithMods(t, key) {
  const m = t.mods || {};
  return keySequence({ key, ctrlKey: m.ctrl > 0, altKey: m.alt > 0, shiftKey: m.shift > 0 }, t.screen?.appCursor);
}
const termModsDown = (t) => t.mods && TERM_MODS.some((k) => t.mods[k] > 0);
function termModsUsed(t) {
  if (!t.mods) return;
  for (const k of TERM_MODS) if (t.mods[k] === 1) t.mods[k] = 0;
  termModsShow(t);
}

// The cell under the pointer, 1-based: [column, row].
function termCell(s, e) {
  const view = s.view.getBoundingClientRect();
  return [Math.min(s.cols, Math.max(1, Math.floor((e.clientX - view.left) / (view.width / s.cols)) + 1)),
    Math.min(s.rows, Math.max(1, Math.floor((e.clientY - view.top) / (view.height / s.rows)) + 1))];
}
function termMouseReport(s, b, col, row, press) {
  if (s.mouseSgr) return `\x1b[<${b};${col};${row}${press ? "M" : "m"}`;
  // The old encoding has no release per button: 3 (with the same modifiers) is any.
  return `\x1b[M${String.fromCharCode(32 + (press ? b : (b & ~3) | 3), 32 + Math.min(col, 223), 32 + Math.min(row, 223))}`;
}
function termMouse(t, e, kind) {
  const s = t.screen;
  if (!s || !t.alive || !s.mouse || e.shiftKey) return;
  const [col, row] = termCell(s, e);
  const mods = (e.altKey ? 8 : 0) + (e.ctrlKey ? 16 : 0);
  if (kind === "down") {
    if (e.button > 2) return;
    e.preventDefault(); // no text selection: the click is the program's
    t.input.focus({ preventScroll: true });
    t.mouseDown = e.button;
    t.mouseCell = `${col},${row}`;
    sendTerminal(t, termMouseReport(s, e.button + mods, col, row, true));
  } else if (kind === "up") {
    if (t.mouseDown < 0) return;
    sendTerminal(t, termMouseReport(s, t.mouseDown + mods, col, row, false));
    t.mouseDown = -1;
  } else if (t.mouseDown >= 0 && s.mouse >= 1002 && t.mouseCell !== `${col},${row}`) {
    t.mouseCell = `${col},${row}`;
    sendTerminal(t, termMouseReport(s, t.mouseDown + 32 + mods, col, row, true)); // a drag
  }
}

function wireTerminal(t) {
  const input = t.input;
  termKeysBar(t);
  input.addEventListener("keydown", (e) => {
    // Ctrl+Shift+Q closes the window; everything else goes to the shell.
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "q") {
      e.preventDefault();
      return closeTerminal(t);
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") return; // paste (the paste event sends it)
    // Ctrl+Shift+C copies what you selected (Ctrl+C alone stays the shell's interrupt).
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      const text = String(window.getSelection());
      if (text) copyText(text, "Copied.");
      return;
    }
    if (e.metaKey) return; // ⌘C, ⌘V on a Mac
    // The bar's Ctrl, Alt or Shift down: this key with them.
    if (termModsDown(t) && e.key.length >= 1 && e.key !== "Unidentified" && !["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
      const m = t.mods;
      const key = m.shift > 0 && e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const seq = keySequence({ key, ctrlKey: e.ctrlKey || m.ctrl > 0, altKey: e.altKey || m.alt > 0, shiftKey: e.shiftKey || m.shift > 0 }, t.screen?.appCursor);
      e.preventDefault();
      e.stopPropagation();
      sendTerminal(t, seq ?? key);
      termModsUsed(t);
      return;
    }
    const seq = keySequence(e, t.screen?.appCursor);
    if (seq !== null) {
      e.preventDefault();
      e.stopPropagation();
      sendTerminal(t, seq);
    }
  });
  input.addEventListener("input", () => {
    let text = input.value;
    input.value = "";
    if (!text) return;
    // A phone keyboard's letter with the bar's Ctrl (or Alt, Shift) down.
    if (termModsDown(t)) {
      const m = t.mods;
      const ch = m.shift > 0 ? text[0].toUpperCase() : text[0];
      text = (keySequence({ key: ch, ctrlKey: m.ctrl > 0, altKey: m.alt > 0, shiftKey: false }, t.screen?.appCursor) ?? ch) + text.slice(1);
      termModsUsed(t);
    }
    sendTerminal(t, text);
  });
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text") || "").replace(/\r?\n/g, "\r");
    sendTerminal(t, t.screen?.bracketed ? `\x1b[200~${text}\x1b[201~` : text);
  });
  input.addEventListener("focus", () => { if (t.screen) { t.screen.focused = true; t.screen.scheduleDraw(); } });
  input.addEventListener("blur", () => { if (t.screen) { t.screen.focused = false; t.screen.scheduleDraw(); } });
  // Clicking the screen types into it, unless you were selecting text to copy.
  t.screenEl.addEventListener("mouseup", (e) => {
    termMouse(t, e, "up");
    if (!String(window.getSelection())) input.focus();
  });
  // A program that asked for the mouse (htop, vim with the mouse on, Claude
  // Code) gets its clicks, and drags with 1002 or 1003; with Shift held, the
  // mouse selects text instead, as in xterm.
  t.screenEl.addEventListener("mousedown", (e) => termMouse(t, e, "down"));
  t.screenEl.addEventListener("mousemove", (e) => termMouse(t, e, "move"));
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
      const [col, row] = termCell(s, e);
      one = termMouseReport(s, up ? 64 : 65, col, row, true);
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
