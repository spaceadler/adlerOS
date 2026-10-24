// Luna's Live mode (and Notepad's): the note as it reads, written in as it
// reads, line by line, as Obsidian's live preview is. Each line of the note
// is a line here, its text as written; what's only there to make it look
// so (the ** of bold, a link's [ ](address), a heading's #) is out of sight
// but where the caret is: in that bold word, on that link, on that heading's
// line. Click a link to write in it; Ctrl (⌘) and a click follows it. What
// takes several lines to be what it is (a table, a code block, a callout,
// the properties at the top, a PDF or a picture shown) reads as it reads
// until the caret goes in (a click on it, the arrows), then its lines.
//
// The note's text is the one truth: every keystroke (typing, deleting,
// Enter, pasting, cutting, undo) changes it, and the lines that changed are
// drawn again, the rest left as they are (a PDF shown doesn't load again).
// To the rest of Luna (Insert, [[ links, the list keys, files dropped in)
// it's a text box: value, selectionStart/End, setSelectionRange,
// setRangeText. Uses el, $, mdRender, mdFrontmatter.
"use strict";

const mdFlows = new WeakMap(); // the box it's drawn in → the editor
const mdLiveCRLF = (all) => all.length > 1 && all.slice(0, -1).filter((l) => l.endsWith("\r")).length * 2 > all.length - 1;

// The editor in a box (again: the same one, its text read afresh).
function mdFlow(box, opts) {
  const had = mdFlows.get(box);
  if (had) { had.opts = opts; had.load(); return had.api; }
  const flow = mdFlowMake(box, opts);
  mdFlows.set(box, flow);
  return flow.api;
}

function mdFlowStop(box) {
  const flow = mdFlows.get(box);
  if (!flow) return;
  flow.stop();
  mdFlows.delete(box);
}

const mdFlowOf = (node) => (node ? mdFlows.get(node.closest?.(".md-flow-box") || node)?.api || null : null);

// ------------------------------------------------------------- the lines

const MF_FENCE = /^\s{0,3}(```+|~~~+)/;
const MF_TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const MF_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const MF_EMBED_LINE = /^\s*(!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\))\s*$/;

// What each line is: a line of its own (a heading, a list's item…), or one
// of a block drawn as one (its kind, its first line and the one after it).
function mfParts(lines) {
  const out = [];
  let i = 0;
  const block = (type, from, to) => { out.push({ block: true, type, from, to }); i = to; };
  while (i < lines.length) {
    const t = lines[i];
    if (i === 0 && /^---\s*$/.test(t)) {
      const end = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l));
      if (end > 0) { block("front", 0, end + 1); continue; }
    }
    const fence = t.match(MF_FENCE);
    if (fence) {
      const mark = fence[1][0];
      let end = i + 1;
      while (end < lines.length && !new RegExp(`^\\s{0,3}${mark === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`).test(lines[end])) end++;
      block("code", i, Math.min(lines.length, end + 1));
      continue;
    }
    if (/^\s*\$\$/.test(t) && !/^\s*\$\$.*\$\$\s*$/.test(t.trim().length > 2 ? t : "")) {
      let end = i + 1;
      while (end < lines.length && !/\$\$\s*$/.test(lines[end])) end++;
      block("math", i, Math.min(lines.length, end + 1));
      continue;
    }
    if (t.includes("|") && i + 1 < lines.length && MF_TABLE_SEP.test(lines[i + 1])) {
      let end = i + 2;
      while (end < lines.length && lines[end].includes("|") && lines[end].trim()) end++;
      block("table", i, end);
      continue;
    }
    if (/^\s*>\s*\[!/.test(t)) {
      let end = i + 1;
      while (end < lines.length && /^\s*>/.test(lines[end])) end++;
      block("callout", i, end);
      continue;
    }
    if (MF_EMBED_LINE.test(t)) { block("embed", i, i + 1); continue; }
    out.push({ block: false, i });
    i++;
  }
  return out;
}

// A line's kind, and what at its start makes it so.
function mfLineKind(t) {
  let m;
  if (!t.trim()) return { kind: "blank" };
  if ((m = t.match(/^(#{1,6})(\s+)/))) return { kind: `h${m[1].length}`, mark: m[0] };
  if (MF_HR.test(t)) return { kind: "hr", mark: t };
  if ((m = t.match(/^(\s*)([-*+]|\d+[.)])(\s+)\[([ xX])\](\s+|$)/))) return { kind: "task", indent: m[1], mark: m[0].slice(m[1].length), done: m[4] !== " " };
  if ((m = t.match(/^(\s*)(\d+[.)])(\s+)/))) return { kind: "ol", indent: m[1], mark: m[0].slice(m[1].length) };
  if ((m = t.match(/^(\s*)([-*+])(\s+)/))) return { kind: "ul", indent: m[1], mark: m[0].slice(m[1].length) };
  if ((m = t.match(/^(\s*>\s?)+/))) return { kind: "quote", mark: m[0] };
  return { kind: "p" };
}

// ------------------------------------------------- what's in a line

const mfMk = (text) => el("span", { class: "mf-mk" }, text);
const mfTxt = (text) => document.createTextNode(text);
function mfTok(type, s, e, parts, data = {}) {
  const n = el("span", { class: `mf-tok mf-${type}`, "data-s": String(s), "data-e": String(e), ...data }, ...parts);
  return n;
}

// Bold, links, code… as spans, their marks spans of their own (out of sight
// unless the caret's in them): the line's text, unchanged, end to end.
// base: where s starts in its line.
function mfInline(s, base = 0) {
  const out = [];
  let plain = "";
  const flush = () => { if (plain) { out.push(mfTxt(plain)); plain = ""; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const at = base + i;
    const c = s[i];
    let m = null, node = null;
    if (c === "\\" && (m = rest.match(/^\\([\\`*_{}[\]()#+\-.!|~=$%^<>])/))) node = mfTok("escape", at, at + 2, [mfMk("\\"), mfTxt(m[1])]);
    else if (c === "`" && (m = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/))) node = mfTok("code", at, at + m[0].length, [mfMk(m[1]), mfTxt(m[2]), mfMk(m[1])]);
    else if (c === "%" && (m = rest.match(/^%%([\s\S]*?)%%/))) node = mfTok("comment", at, at + m[0].length, [mfMk("%%"), mfTxt(m[1]), mfMk("%%")]);
    else if (c === "$" && (m = rest.match(/^\$(?=\S)([^$\n]*?\S)\$(?!\d)/))) node = mfTok("math", at, at + m[0].length, [mfMk("$"), mfTxt(m[1]), mfMk("$")]);
    else if (c === "!" && (m = rest.match(/^!\[\[([^\]\n]+)\]\]/) || rest.match(/^!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/))) {
      node = mfTok("embed", at, at + m[0].length, [mfTxt(m[0])]);
    } else if (c === "[" && (m = rest.match(/^\[\[([^\]\n]+)\]\]/))) {
      const [target, alias] = m[1].split("|");
      node = alias !== undefined
        ? mfTok("wikilink", at, at + m[0].length, [mfMk(`[[${target}|`), mfTxt(alias), mfMk("]]")], { "data-href": target, "data-wiki": "1" })
        : mfTok("wikilink", at, at + m[0].length, [mfMk("[["), mfTxt(target), mfMk("]]")], { "data-href": target, "data-wiki": "1" });
    } else if (c === "[" && (m = rest.match(/^\[\^([^\]\s]+)\]/))) node = mfTok("fnref", at, at + m[0].length, [mfMk("[^"), mfTxt(m[1]), mfMk("]")]);
    else if (c === "[" && (m = rest.match(/^\[((?:\[[^\]]*\]|[^\]\n])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/))) {
      node = mfTok("link", at, at + m[0].length, [mfMk("["), el("span", { class: "mf-linktext" }, ...mfInline(m[1], at + 1)), mfMk(m[0].slice(1 + m[1].length))], { "data-href": m[2] });
    } else if (c === "<" && (m = rest.match(/^<(https?:\/\/[^>\s]+)>/))) node = mfTok("url", at, at + m[0].length, [mfMk("<"), mfTxt(m[1]), mfMk(">")], { "data-href": m[1] });
    else if (c === "h" && (m = rest.match(/^https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_~)]/))) node = mfTok("url", at, at + m[0].length, [mfTxt(m[0])], { "data-href": m[0] });
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1])) && (m = rest.match(/^#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*/u))) node = mfTok("tag", at, at + m[0].length, [mfTxt(m[0])]);
    else if ((c === "*" || c === "_") && (m = rest.match(/^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/))) node = mfTok("bold mf-italic", at, at + m[0].length, [mfMk(m[1]), ...mfInline(m[2], at + 3), mfMk(m[1])]);
    else if ((c === "*" || c === "_") && (m = rest.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/))) node = mfTok("bold", at, at + m[0].length, [mfMk(m[1]), ...mfInline(m[2], at + 2), mfMk(m[1])]);
    else if (c === "*" && (m = rest.match(/^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/))) node = mfTok("italic", at, at + m[0].length, [mfMk("*"), ...mfInline(m[1], at + 1), mfMk("*")]);
    else if (c === "_" && (i === 0 || !/\w/.test(s[i - 1])) && (m = rest.match(/^_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w_])/))) node = mfTok("italic", at, at + m[0].length, [mfMk("_"), ...mfInline(m[1], at + 1), mfMk("_")]);
    else if (c === "~" && (m = rest.match(/^~~(?=\S)([\s\S]*?\S)~~/))) node = mfTok("strike", at, at + m[0].length, [mfMk("~~"), ...mfInline(m[1], at + 2), mfMk("~~")]);
    else if (c === "=" && (m = rest.match(/^==(?=\S)([\s\S]*?\S)==/))) node = mfTok("mark", at, at + m[0].length, [mfMk("=="), ...mfInline(m[1], at + 2), mfMk("==")]);
    if (node) { flush(); out.push(node); i += m[0].length; } else { plain += c; i++; }
  }
  flush();
  return out;
}

// A line, drawn: its kind's look, its start's marks (seen when the caret's
// on it), the rest as it reads.
function mfLine(t, i) {
  const k = mfLineKind(t);
  const line = el("div", { class: `mf-line mf-${k.kind}`, "data-i": String(i) });
  if (k.kind === "blank") { line.append(el("br")); return line; }
  if (k.kind === "hr") { line.append(el("span", { class: "mf-lm" }, mfMk(t))); return line; }
  let rest = t;
  if (k.indent) { line.append(el("span", { class: "mf-indent" }, k.indent)); rest = rest.slice(k.indent.length); }
  if (k.mark) {
    if (k.kind === "task") {
      const box = el("span", { class: `mf-check${k.done ? " done" : ""}`, contenteditable: "false", "aria-hidden": "true" });
      line.append(box, el("span", { class: "mf-lm" }, mfMk(k.mark)));
      line.classList.toggle("done", k.done);
    } else if (k.kind === "ol") line.append(el("span", { class: "mf-lm mf-num" }, k.mark));
    else line.append(el("span", { class: "mf-lm" }, mfMk(k.mark)));
    rest = rest.slice(k.mark.length);
  }
  line.append(...mfInline(rest, t.length - rest.length));
  if (!line.textContent && !line.querySelector(".mf-check")) line.append(el("br"));
  return line;
}

// ------------------------------------------------------------- the editor

function mdFlowMake(box, opts) {
  box.classList.add("md-flow-box");
  const root = el("div", { class: "md-flow", spellcheck: "true" });
  box.replaceChildren(root);
  const f = { opts, root, text: "", crlf: false, items: [], active: { line: -1, block: null }, undo: [], redo: [], typing: 0 };

  const writable = () => Boolean(f.opts.writable?.());
  const lines = () => f.text.split("\n");
  const lineEl = (i) => root.querySelector(`:scope > .mf-line[data-i="${i}"]`);
  const absOf = (i, col) => { const ls = lines(); let n = 0; for (let k = 0; k < i && k < ls.length; k++) n += ls[k].length + 1; return n + col; };
  const posOfAbs = (abs) => {
    const ls = lines();
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      if (abs <= n + ls[i].length) return { i, col: Math.max(0, abs - n) };
      n += ls[i].length + 1;
    }
    return { i: ls.length - 1, col: ls[ls.length - 1].length };
  };

  // -------------------------------------------- drawn, and drawn again

  // What's to be drawn: a key each (a line's text and kind; a block's
  // text), so what didn't change keeps its place (and a PDF its page).
  function plan() {
    const ls = lines();
    const items = [];
    for (const p of mfParts(ls)) {
      if (!p.block) { items.push({ key: `L ${ls[p.i]}`, make: () => mfLine(ls[p.i], p.i), line: p.i }); continue; }
      const text = ls.slice(p.from, p.to).join("\n");
      items.push({ key: `W ${p.type} ${p.from === 0 ? "0" : ""} ${text}`, make: () => widget(p, text), block: p });
      for (let i = p.from; i < p.to; i++) {
        items.push({ key: `R ${p.type} ${ls[i]}`, make: () => { const n = mfLine(ls[i], i); n.classList.add("mf-raw", `mf-in-${p.type}`); n.dataset.block = String(p.from); return n; }, line: i });
      }
    }
    return items;
  }

  function widget(p, text) {
    const w = el("div", { class: `mf-widget mf-w-${p.type}`, contenteditable: "false", "data-from": String(p.from), "data-to": String(p.to) });
    try {
      const drawn = mdRender(p.type === "front" ? `${text}\n` : text, { ...f.opts.ctx(), ...(p.type === "front" ? {} : { properties: false }) });
      w.append(drawn);
    } catch { w.append(el("pre", {}, text)); }
    if (!w.textContent.trim() && !w.querySelector("img, iframe, video, audio, table")) w.append(el("p", { class: "mf-dim" }, text));
    return w;
  }

  // Drawn again: what's the same at the top and the bottom stays; the middle's new.
  function draw() {
    const want = plan();
    const had = f.items;
    let top = 0;
    while (top < had.length && top < want.length && had[top].key === want[top].key) top++;
    let bottom = 0;
    while (bottom < had.length - top && bottom < want.length - top && had[had.length - 1 - bottom].key === want[want.length - 1 - bottom].key) bottom++;
    const before = had[had.length - bottom]?.el || null;
    for (const item of had.slice(top, had.length - bottom)) item.el.remove();
    const made = want.slice(top, want.length - bottom).map((w) => ({ ...w, el: w.make() }));
    for (const m of made) root.insertBefore(m.el, before);
    const kept = had.slice(had.length - bottom);
    f.items = [...had.slice(0, top), ...made, ...kept.map((k, n) => ({ ...k, line: want[want.length - bottom + n].line, block: want[want.length - bottom + n].block }))];
    // Their numbers, from the top again (lines above moved them).
    for (const item of f.items) {
      if (item.line !== undefined) item.el.dataset.i = String(item.line);
      if (item.block) { item.el.dataset.from = String(item.block.from); item.el.dataset.to = String(item.block.to); }
      if (item.el.classList.contains("mf-raw")) {
        const b = f.items.find((x) => x.block && x.block.from <= item.line && item.line < x.block.to);
        if (b) item.el.dataset.block = String(b.block.from);
      }
    }
    root.contentEditable = writable() ? "plaintext-only" : "false";
    if (root.contentEditable !== "plaintext-only" && writable()) root.contentEditable = "true"; // an older browser
  }

  // ------------------------------------------------------- the caret

  // A point in the DOM as (line, column) of the text: what's before it in
  // its line, marks and all.
  function posOf(node, offset) {
    const elNode = node.nodeType === 1 ? node : node.parentNode;
    let line = elNode?.closest?.(".mf-line");
    if (!line || line.parentNode !== root) {
      if (node === root) {
        const kids = [...root.children];
        const after = kids[offset] || null;
        const prev = kids.slice(0, offset).reverse().find((k) => k.classList.contains("mf-line"));
        if (prev) return { i: Number(prev.dataset.i), col: lines()[Number(prev.dataset.i)].length };
        if (after?.classList.contains("mf-line")) return { i: Number(after.dataset.i), col: 0 };
      }
      return null;
    }
    const r = document.createRange();
    r.setStart(line, 0);
    try { r.setEnd(node, offset); } catch { return null; }
    return { i: Number(line.dataset.i), col: r.toString().length };
  }

  function selection() {
    const sel = getSelection();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) return null;
    const a = posOf(sel.anchorNode, sel.anchorOffset), b = posOf(sel.focusNode, sel.focusOffset);
    if (!a || !b) return null;
    const x = absOf(a.i, a.col), y = absOf(b.i, b.col);
    return { start: Math.min(x, y), end: Math.max(x, y), focus: b };
  }

  // The caret at (line, column): in the text node there, one that's seen if
  // it can be.
  function domPoint(i, col) {
    const line = lineEl(i);
    if (!line) return null;
    const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n = 0, best = null;
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const len = t.data.length;
      if (col >= n && col <= n + len) {
        const hidden = t.parentNode.closest(".mf-mk") && getComputedStyle(t.parentNode).display === "none";
        if (!best || (best.hidden && !hidden)) best = { node: t, offset: col - n, hidden };
        if (!hidden && col < n + len) break;
      }
      n += len;
    }
    return best || { node: line, offset: 0 };
  }

  function setCaret(start, end = start) {
    const a = posOfAbs(start), b = posOfAbs(end);
    activate(b.i, b.col); // what the caret's in shows its marks first, so it lands where they are
    const p = domPoint(a.i, a.col), q = domPoint(b.i, b.col);
    if (!p || !q) return;
    const sel = getSelection();
    sel.setBaseAndExtent(p.node, p.offset, q.node, q.offset);
  }

  // The line (and what in it) the caret's in: its marks seen; a block it's
  // in, its lines to write in.
  function activate(i, col) {
    root.querySelectorAll(":scope > .mf-line.on, .mf-tok.on").forEach((t) => t.classList.remove("on"));
    const line = i >= 0 ? lineEl(i) : null;
    f.active = { line: i, lineEl: line, block: null };
    if (line) {
      line.classList.add("on");
      for (const t of line.querySelectorAll(".mf-tok")) {
        if (Number(t.dataset.s) <= col && col <= Number(t.dataset.e)) t.classList.add("on");
      }
    }
    // A block: open (its lines) while the caret's in it; drawn, else.
    const from = line?.dataset.block;
    root.querySelectorAll(".mf-open").forEach((n) => { if (n.dataset.block !== from && n.dataset.from !== from) n.classList.remove("mf-open"); });
    if (from !== undefined) {
      root.querySelectorAll(`:scope > [data-block="${from}"], :scope > .mf-widget[data-from="${from}"]`).forEach((n) => n.classList.add("mf-open"));
      f.active.block = Number(from);
    }
  }

  // Only while it's being written in (the focus in it): else it reads as it reads.
  function follow() {
    if (!root.contains(document.activeElement)) return activate(-1, 0);
    const s = selection();
    if (!s) return;
    activate(s.focus.i, s.focus.col);
  }

  // ------------------------------------------------------- changing it

  function setText(text, caret, { keep = false } = {}) {
    if (!keep) {
      const now = Date.now();
      // One step back per word typed, or per other change.
      if (!(f.typing && now - f.typing < 900 && f.undo.length)) f.undo.push({ text: f.text, caret: selection()?.end ?? 0 });
      if (f.undo.length > 300) f.undo.shift();
      f.redo = [];
    }
    f.text = text;
    draw();
    if (caret !== undefined) setCaret(...(Array.isArray(caret) ? caret : [caret]));
    f.opts.set(f.crlf ? text.replace(/\n/g, "\r\n") : text);
    f.quiet = true;
    root.dispatchEvent(new Event("input")); // as a text box would ([[ links, and the like)
    f.quiet = false;
  }

  function change(a, b, insert, caret) {
    f.typing = insert.length === 1 && a === b ? Date.now() : 0;
    setText(f.text.slice(0, a) + insert + f.text.slice(b), caret ?? a + insert.length);
  }

  function back(step) {
    const from = step < 0 ? f.undo : f.redo, to = step < 0 ? f.redo : f.undo;
    const was = from.pop();
    if (!was) return;
    to.push({ text: f.text, caret: selection()?.end ?? 0 });
    f.typing = 0;
    setText(was.text, Math.min(was.caret, was.text.length), { keep: true });
  }

  const wordBack = (abs) => { const head = f.text.slice(0, abs); const m = head.match(/(\w+\s*|[^\w\s]+\s*|\s+)$/); return abs - (m ? m[0].length : 1); };
  const wordOn = (abs) => { const tail = f.text.slice(abs); const m = tail.match(/^(\s*\w+|\s*[^\w\s]+|\s+)/); return abs + (m ? m[0].length : 1); };
  const charBack = (abs) => (abs >= 2 && /[\uDC00-\uDFFF]/.test(f.text[abs - 1]) ? abs - 2 : abs - 1);
  const charOn = (abs) => (/[\uD800-\uDBFF]/.test(f.text[abs]) ? abs + 2 : abs + 1);

  root.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertCompositionText") return; // a word being made (another script's keyboard): read when it's done
    e.preventDefault();
    if (!writable()) return;
    const s = selection();
    if (!s) return;
    const { start: a, end: b } = s;
    const lineStart = f.text.lastIndexOf("\n", a - 1) + 1;
    let lineEnd = f.text.indexOf("\n", b);
    if (lineEnd < 0) lineEnd = f.text.length;
    switch (e.inputType) {
      case "insertText": case "insertReplacementText": {
        const t = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
        return change(a, b, t);
      }
      case "insertParagraph": case "insertLineBreak": return change(a, b, "\n");
      case "insertFromPaste": case "insertFromDrop": case "insertFromYank":
        return change(a, b, (e.dataTransfer?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n"));
      case "deleteContentBackward": return a !== b ? change(a, b, "") : a > 0 && change(charBack(a), a, "");
      case "deleteContentForward": return a !== b ? change(a, b, "") : a < f.text.length && change(a, charOn(a), "");
      case "deleteWordBackward": return a !== b ? change(a, b, "") : a > 0 && change(Math.max(lineStart === a ? a - 1 : lineStart, wordBack(a)), a, "");
      case "deleteWordForward": return a !== b ? change(a, b, "") : change(a, Math.min(lineEnd === a ? a + 1 : lineEnd, wordOn(a)), "");
      case "deleteSoftLineBackward": case "deleteHardLineBackward": return change(a === b ? (lineStart === a ? Math.max(0, a - 1) : lineStart) : a, b, "");
      case "deleteSoftLineForward": case "deleteHardLineForward": return change(a, a === b ? (lineEnd === b ? Math.min(f.text.length, b + 1) : lineEnd) : b, "");
      case "deleteByCut": case "deleteContent": case "deleteByDrag": return a !== b && change(a, b, "");
      case "historyUndo": return back(-1);
      case "historyRedo": return back(1);
      default: // bold, italic and the like from the browser: Luna's own (Ctrl+B…) do it as Markdown
    }
  });
  // A word made with another script's keyboard: the line it's in, read back.
  root.addEventListener("compositionend", () => {
    const s = getSelection();
    const line = (s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentNode)?.closest?.(".mf-line");
    if (!line) return;
    const i = Number(line.dataset.i);
    const ls = lines();
    const r = document.createRange();
    r.selectNodeContents(line);
    const now = r.toString();
    const caret = posOf(s.anchorNode, s.anchorOffset);
    ls[i] = now;
    setText(ls.join("\n"), caret ? absOf(caret.i, caret.col) : undefined);
  });
  root.addEventListener("copy", (e) => {
    const s = selection();
    if (!s || s.start === s.end) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", f.text.slice(s.start, s.end));
  });
  root.addEventListener("cut", (e) => {
    const s = selection();
    if (!s || s.start === s.end) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", f.text.slice(s.start, s.end));
    if (writable()) change(s.start, s.end, "");
  });
  root.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.key.toLowerCase() === "z") { e.preventDefault(); return back(e.shiftKey ? 1 : -1); }
    if (mod && !e.altKey && e.key.toLowerCase() === "y") { e.preventDefault(); return back(1); }
    // Up and down into a block drawn as one (its lines out of sight): its first or last line.
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !mod) {
      const s = selection();
      if (!s) return;
      const i = s.focus.i;
      const next = i + (e.key === "ArrowDown" ? 1 : -1);
      const there = lineEl(next);
      if (!there || !there.classList.contains("mf-raw") || there.classList.contains("mf-open")) return;
      // Only from this line's last (or first) row on screen.
      const caret = getSelection().getRangeAt(0).getBoundingClientRect();
      const box = lineEl(i)?.getBoundingClientRect();
      if (box && caret.height && (e.key === "ArrowDown" ? box.bottom - caret.bottom > caret.height * 0.6 : caret.top - box.top > caret.height * 0.6)) return;
      e.preventDefault();
      const col = Math.min(s.focus.col, lines()[next].length);
      setCaret(absOf(next, col));
    }
  });
  document.addEventListener("selectionchange", f.onSel = () => { if (root.isConnected && root.contains(getSelection().anchorNode)) follow(); });
  root.addEventListener("focusin", () => follow());
  // Away from it: it reads as it reads, every mark out of sight; and it's kept.
  root.addEventListener("focusout", (e) => {
    if (root.contains(e.relatedTarget)) return;
    setTimeout(() => {
      if (root.contains(document.activeElement)) return;
      activate(-1, 0);
      f.opts.left?.();
    }, 0);
  });

  // Clicks: a task's box ticks it; Ctrl and a click on a link follows it;
  // a block drawn as one opens to be written in (its links still followed).
  root.addEventListener("mousedown", (e) => {
    const check = e.target.closest(".mf-check");
    if (check && writable()) {
      e.preventDefault();
      const line = Number(check.closest(".mf-line").dataset.i);
      const ls = lines();
      ls[line] = ls[line].replace(/\[([ xX])\]/, (_, x) => (x === " " ? "[x]" : "[ ]"));
      const keep = selection();
      return setText(ls.join("\n"), keep ? [keep.start, keep.end] : undefined);
    }
    const link = e.target.closest(".mf-link, .mf-wikilink, .mf-url");
    if (link && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const href = link.dataset.href;
      const wiki = link.dataset.wiki === "1";
      const external = /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href);
      const ctx = f.opts.ctx();
      const target = external ? null : ctx.resolve?.(href, wiki);
      ctx.open?.({ href, external, target, wiki }, e);
      return;
    }
    const w = e.target.closest(".mf-widget");
    if (w && !e.target.closest("a, button, input, select, summary, iframe, video, audio, .md-embed-bar-button")) {
      e.preventDefault();
      const from = Number(w.dataset.from);
      root.focus({ preventScroll: true });
      setCaret(absOf(from, 0));
    }
  });

  // ----------------------------------------------------- to the rest

  // A text box, to Luna's other parts (Insert, [[ links, the list keys).
  const api = {
    mdFlow: true, root,
    get value() { return f.text; },
    get selectionStart() { return selection()?.start ?? f.saved?.[0] ?? 0; },
    get selectionEnd() { return selection()?.end ?? f.saved?.[1] ?? 0; },
    setSelectionRange(a, b = a) { root.focus({ preventScroll: true }); setCaret(Math.max(0, Math.min(a, f.text.length)), Math.max(0, Math.min(b, f.text.length))); },
    setRangeText(text, a = this.selectionStart, b = this.selectionEnd, mode = "preserve") {
      const s = this.selectionStart, e = this.selectionEnd;
      const len = text.length - (b - a);
      const caret = mode === "end" ? a + text.length : mode === "start" ? a : mode === "select" ? [a, a + text.length]
        : [s <= a ? s : s >= b ? s + len : a, e <= a ? e : e >= b ? e + len : a + text.length];
      f.typing = 0;
      setText(f.text.slice(0, a) + text + f.text.slice(b), caret);
    },
    focus(o) { root.focus(o || { preventScroll: true }); },
    blur() { root.blur(); },
    get isConnected() { return root.isConnected; },
    closest(sel) { return root.closest(sel); },
    getBoundingClientRect() { return root.getBoundingClientRect(); },
    addEventListener(...a) { root.addEventListener(...a); },
    dispatchEvent(ev) { if (ev.type === "input" && f.quiet === false && ev.isTrusted === false) { /* theirs: nothing to read */ } return root.dispatchEvent(ev); },
    get readOnly() { return !writable(); },
    get style() { return root.style; },
    // Where the caret's drawn, on screen (for what pops up by it).
    caretRect() {
      const sel = getSelection();
      if (sel.rangeCount && root.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0).getClientRects()[0] || sel.getRangeAt(0).getBoundingClientRect();
        if (r && (r.width || r.height)) return r;
        const line = lineEl(selection()?.focus.i ?? 0);
        if (line) return line.getBoundingClientRect();
      }
      return root.getBoundingClientRect();
    },
    // The caret where a point is (a file dropped there).
    placeAt(x, y) {
      const p = document.caretPositionFromPoint?.(x, y);
      const r = p ? null : document.caretRangeFromPoint?.(x, y);
      const at = p ? posOf(p.offsetNode, p.offset) : r ? posOf(r.startContainer, r.startOffset) : null;
      if (at) setCaret(absOf(at.i, at.col));
    },
    gotoLine(line) {
      const i = Math.max(0, Math.min(lines().length - 1, line));
      root.focus({ preventScroll: true });
      setCaret(absOf(i, 0));
      lineEl(i)?.scrollIntoView({ block: "center" });
    },
    atEnd({ focus = true } = {}) {
      if (focus) root.focus({ preventScroll: true });
      setCaret(f.text.length);
    },
  };
  f.api = api;
  // Held while something else has the focus (a dialog), for setSelectionRange after.
  root.addEventListener("focusout", () => { const s = selection(); if (s) f.saved = [s.start, s.end]; }, true);

  f.load = () => {
    const raw = f.opts.text() ?? "";
    f.crlf = mdLiveCRLF(raw.split("\n"));
    const text = raw.replace(/\r\n/g, "\n");
    if (text !== f.text || !f.items.length) {
      f.text = text;
      draw();
    }
  };
  f.stop = () => { document.removeEventListener("selectionchange", f.onSel); box.classList.remove("md-flow-box"); };
  f.load();
  f.opts.wire?.(api);
  return f;
}
