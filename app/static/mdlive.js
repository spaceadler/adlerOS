// adlermd's Live mode: the note as it reads, edited where you click, as in
// Obsidian's Live Preview. The block you're in (a paragraph, a heading, a
// list, a table, the properties) turns back into its Markdown, and reads
// again once you leave it. The arrows past a block's first or last line go
// on to the next; Backspace at a block's start (Delete at its end) joins it
// with the one before (after); Escape is done. A link, a box to tick or a
// video still works as itself. Blocks know their lines from mdRender
// (data-from, data-to). Uses el, mdRender, mdFrontmatter, mdFit.
"use strict";

// box: where the note shows. opts: text() and set(text), the note's
// Markdown; ctx(), mdRender's; writable(); wire(area), the editor's own
// keys, completion and pasting; left(), once the caret has left the note.
function mdLive(box, opts) {
  let live = mdLiveBoxes.get(box);
  if (live) live.opts = opts; // again (a file loaded): drawn afresh
  else {
    live = { box, opts, edit: null };
    mdLiveBoxes.set(box, live);
    box.addEventListener("click", (e) => mdLiveClick(live, e));
  }
  box.classList.add("md-live");
  mdLiveDraw(live);
  return live;
}

const mdLiveBoxes = new WeakMap();

// Back to only reading (another mode): what's being edited goes back first.
function mdLiveStop(box) {
  const live = mdLiveBoxes.get(box);
  if (!live) return;
  if (live.edit) mdLiveDone(live);
  mdLiveBoxes.delete(box);
  box.classList.remove("md-live");
}

// What a click, a mouse button still down, moved away from: put back as it
// reads once the click is done, so what it landed on (a link, another
// block) is still there for it.
const mdLiveDown = { on: false, pending: null };
document.addEventListener("pointerdown", () => { mdLiveDown.on = true; }, true);
document.addEventListener("pointerup", () => {
  setTimeout(() => {
    mdLiveDown.on = false;
    const p = mdLiveDown.pending;
    mdLiveDown.pending = null;
    if (p && p.live.edit?.area === p.area && document.activeElement !== p.area) mdLiveDone(p.live);
  }, 0);
}, true);

function mdLiveDraw(live) {
  const scroll = live.box.closest(".md-scroll") || live.box;
  const top = scroll?.scrollTop;
  live.edit = null;
  const ctx = live.opts.ctx();
  if (ctx.toggleTask) {
    // Ticked while a block above is being edited: the line it is now.
    const toggle = ctx.toggleTask;
    ctx.toggleTask = (line, done) => toggle(mdLiveLine(live, line), done);
  }
  live.box.replaceChildren(mdRender(live.opts.text(), ctx));
  scroll.scrollTop = top;
}

const mdLiveBlocks = (live) => [...live.box.children].filter((n) => n.dataset.from !== undefined);

// A note's lines as an editor holds them: without Windows' \r (a text box
// drops it), which mdLiveInput gives back to a note that ends its lines so.
const mdLivePlain = (lines) => lines.map((l) => l.replace(/\r$/, "")).join("\n");
const mdLiveCRLF = (all) => all.length > 1 && all.slice(0, -1).filter((l) => l.endsWith("\r")).length * 2 > all.length - 1;

// A line of the note as it reads, in the note as it is now.
function mdLiveLine(live, line) {
  const e = live.edit;
  return e && line >= e.to0 ? line + e.count - e.base : line;
}

// The blocks that showed lines a–b (as the note reads), gone: an editor shows them now.
function mdLiveHide(live, a, b) {
  for (const n of mdLiveBlocks(live)) if (Number(n.dataset.from) >= a && Number(n.dataset.from) < b) n.remove();
}

function mdLiveClick(live, e) {
  if (mdLiveBoxes.get(live.box) !== live || !live.opts.writable() || e.button !== 0) return;
  if (e.target.closest("a, input, button, summary, select, textarea, label, video, audio, iframe, .md-base")) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed && live.box.contains(sel.anchorNode)) return; // choosing words to copy
  let block = e.target;
  while (block && block.parentElement !== live.box) block = block.parentElement;
  if (block && block.dataset.from === undefined) return; // the footnotes, a note's HTML words
  let hint;
  if (block) hint = mdLiveHint(block, e.clientX, e.clientY);
  else {
    // Between blocks, or past the last: the nearest; below them all, the note's end.
    const blocks = mdLiveBlocks(live);
    const last = blocks[blocks.length - 1];
    if (!last || e.clientY > last.getBoundingClientRect().bottom) return mdLiveAtEnd(live, last);
    block = blocks.reduce((best, b) => {
      const r = b.getBoundingClientRect();
      const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
      return !best || d < best.d ? { b, d } : best;
    }, null).b;
    hint = e.clientY < block.getBoundingClientRect().top ? "start" : "end";
  }
  mdLiveOpen(live, Number(block.dataset.from), hint);
}

// Below everything: the note's end, or past the properties, its first
// line (focus: false, an empty note's place to start, not yet typing in).
function mdLiveAtEnd(live, last, { focus = true } = {}) {
  if (last && !last.classList.contains("md-properties")) return mdLiveOpen(live, Number(last.dataset.from), "end");
  const text = live.opts.text();
  const lines = text.split("\n");
  const front = mdFrontmatter(text);
  let body = front.lines;
  if (front.data && body < lines.length && /^---\s*$/.test(lines[body]) && !front.body) body++; // "---" with no line after it
  if (live.edit) mdLiveDone(live, false);
  mdLiveEdit(live, body, Math.max(body, lines.length), "end", null, { focus });
}

// The block with this line (of the note as it reads now) as Markdown.
function mdLiveOpen(live, line, hint) {
  if (live.edit) {
    const e = live.edit;
    if (line >= e.to0) line += e.count - e.base; // lines under the one being edited moved with it
    mdLiveDone(live, false);
  }
  const blocks = mdLiveBlocks(live);
  const block = blocks.find((b) => Number(b.dataset.from) <= line && line < Number(b.dataset.to))
    || blocks.find((b) => Number(b.dataset.from) >= line) || blocks[blocks.length - 1];
  if (!block || block.classList.contains("md-properties") && line >= Number(block.dataset.to)) return mdLiveAtEnd(live, null);
  mdLiveEdit(live, Number(block.dataset.from), Number(block.dataset.to), hint, block);
}

// Lines from–to as an editor, in the block's place (and its look: a
// heading's size, code's letters).
function mdLiveEdit(live, from, to, hint, block = null, { focus = true } = {}) {
  const all = live.opts.text().split("\n");
  const end = to;
  while (to > from + 1 && (all[to - 1] ?? "").trim() === "") to--;
  const area = el("textarea", { class: "md-live-area", spellcheck: "true", rows: "1", "aria-label": "The note, here", placeholder: "Start writing…" });
  area.value = mdLivePlain(all.slice(from, to));
  if (block) {
    const cs = getComputedStyle(block);
    for (const p of ["fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "marginTop", "marginBottom"]) area.style[p] = cs[p];
    block.replaceWith(area);
    mdLiveHide(live, from, end); // the rest of what its lines made (a note's HTML can be several)
  } else {
    // No block to stand for: where the lines would read, before the first block after them.
    const after = mdLiveBlocks(live).find((b) => Number(b.dataset.from) >= from);
    if (after) after.before(area); else live.box.append(area);
  }
  // count: the lines it is now; base: the lines it was, ending at to0 (as the note reads).
  live.edit = { area, from, count: to - from, base: to - from, to0: to };
  area.addEventListener("input", () => mdLiveInput(live, area));
  live.opts.wire?.(area);
  area.addEventListener("keydown", (e) => mdLiveKeys(live, area, e));
  area.addEventListener("focusout", () => {
    if (live.edit?.area !== area) return;
    if (mdLiveDown.on) mdLiveDown.pending = { live, area };
    else mdLiveDone(live);
  });
  mdFit(area);
  if (!focus) return area;
  const at = mdLiveCaret(area.value, hint);
  area.focus({ preventScroll: true });
  area.setSelectionRange(at, at);
  const r = area.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) area.scrollIntoView({ block: "nearest" });
  return area;
}

function mdLiveInput(live, area) {
  const e = live.edit;
  if (e?.area !== area) return;
  const all = live.opts.text().split("\n");
  let mine = area.value.split("\n");
  if (mdLiveCRLF(all)) {
    // Its lines end as the note's do; the note's last line (no line end) stays so.
    const last = e.from + e.count >= all.length && !all[all.length - 1].endsWith("\r");
    mine = mine.map((l, k) => (last && k === mine.length - 1 ? l : `${l}\r`));
  }
  all.splice(e.from, e.count, ...mine);
  e.count = mine.length;
  live.opts.set(all.join("\n"));
  mdFit(area);
}

// Done with the block: the note reads again.
function mdLiveDone(live, left = true) {
  if (!live.edit) return;
  mdLiveDraw(live);
  if (left) live.opts.left?.();
}

function mdLiveKeys(live, area, e) {
  if (e.defaultPrevented || live.edit?.area !== area) return;
  if (e.key === "Escape") {
    e.preventDefault();
    mdLiveDone(live);
    live.box.focus({ preventScroll: true });
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || area.selectionStart !== area.selectionEnd) return;
  const v = area.value;
  const at = area.selectionStart;
  const edit = live.edit;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const up = e.key === "ArrowUp";
    if (up ? v.lastIndexOf("\n", at - 1) >= 0 : v.indexOf("\n", at) >= 0) return; // not its first (last) line
    const go = () => {
      const blocks = mdLiveBlocks(live);
      const next = up ? [...blocks].reverse().find((b) => Number(b.dataset.to) <= edit.from) : blocks.find((b) => Number(b.dataset.from) >= edit.to0);
      if (next) mdLiveOpen(live, Number(next.dataset.from), up ? "end" : "start");
    };
    if (at === (up ? 0 : v.length)) { e.preventDefault(); return go(); }
    // A wrapped line moves within itself first: on only from its first (last) row.
    setTimeout(() => { if (live.edit === edit && area.selectionStart === (up ? 0 : area.value.length)) go(); }, 0);
    return;
  }
  if (e.key === "Backspace" && at === 0) {
    // Into the block before (and the blank lines between): as one.
    const all = live.opts.text().split("\n");
    const prev = mdLiveSibling(area, "previousElementSibling");
    if (prev?.classList.contains("md-properties")) return; // not into the YAML
    let from = prev ? Number(prev.dataset.from) : edit.from;
    if (!prev) while (from > 0 && all[from - 1].trim() === "") from--;
    if (from >= edit.from) return;
    e.preventDefault();
    mdLiveGrow(live, area, from, edit.from, all, true);
    document.execCommand("delete");
    return;
  }
  if (e.key === "Delete" && at === v.length) {
    const all = live.opts.text().split("\n");
    const next = mdLiveSibling(area, "nextElementSibling");
    const end = edit.from + edit.count;
    let to = next ? Number(next.dataset.to) + (edit.count - edit.base) : end;
    if (next) while (to > end + 1 && all[to - 1].trim() === "") to--;
    else while (to < all.length && all[to].trim() === "") to++;
    if (to <= end) return;
    e.preventDefault();
    mdLiveGrow(live, area, end, to, all, false);
    document.execCommand("forwardDelete");
  }
}

function mdLiveSibling(area, which) {
  let n = area[which];
  while (n && n.dataset.from === undefined) n = n[which];
  return n;
}

// The editor takes in lines a–b too (of the note as it is now; before it,
// or after), and the blocks that showed them; the caret stays where it was.
function mdLiveGrow(live, area, a, b, all, before) {
  const edit = live.edit;
  const add = mdLivePlain(all.slice(a, b));
  const caret = before ? add.length + 1 : area.value.length;
  area.value = before ? `${add}\n${area.value}` : `${area.value}\n${add}`;
  const k = b - a;
  if (before) {
    mdLiveHide(live, a, edit.from);
    edit.from = a;
  } else {
    mdLiveHide(live, edit.to0, edit.to0 + k);
    edit.to0 += k;
  }
  edit.count += k;
  edit.base += k;
  area.setSelectionRange(caret, caret);
  mdFit(area);
}

// Where in the block's words the click was: the words before it.
function mdLiveHint(block, x, y) {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) ({ offsetNode: node, offset } = document.caretPositionFromPoint(x, y) || {});
  else if (document.caretRangeFromPoint) ({ startContainer: node, startOffset: offset } = document.caretRangeFromPoint(x, y) || {});
  if (!node || !block.contains(node)) return "end";
  const r = document.createRange();
  r.selectNodeContents(block);
  try { r.setEnd(node, offset); } catch { return "end"; }
  const before = r.toString();
  const all = block.textContent;
  return { before, ratio: all.length ? before.length / all.length : 1 };
}

// The same place in the Markdown: after the longest run of the words
// before the click that it has, nearest where it would be.
function mdLiveCaret(src, hint) {
  if (hint === "start") return 0;
  if (!hint || hint === "end") return src.length;
  if (typeof hint.line === "number") return src.split("\n").slice(0, hint.line).join("\n").length + (hint.line ? 1 : 0);
  if (!hint.before) return 0;
  const want = hint.ratio * src.length;
  for (let n = Math.min(24, hint.before.length); n >= 1; n--) {
    const tail = hint.before.slice(-n);
    let best = -1;
    for (let at = src.indexOf(tail); at >= 0; at = src.indexOf(tail, at + 1)) {
      if (best < 0 || Math.abs(at + n - want) < Math.abs(best + n - want)) best = at;
    }
    if (best >= 0) return best + n;
  }
  return Math.min(src.length, Math.round(want));
}

// To a line of the note (a search's hit): its block, the caret at it.
function mdLiveGoto(live, line) {
  const blocks = mdLiveBlocks(live);
  const block = blocks.find((b) => Number(b.dataset.from) <= line && line < Number(b.dataset.to));
  if (!block) return;
  const from = Number(block.dataset.from);
  const area = mdLiveEdit(live, from, Number(block.dataset.to), { line: line - from }, block);
  area.scrollIntoView({ block: "center" });
}
