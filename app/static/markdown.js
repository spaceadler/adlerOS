// Markdown the way Obsidian writes it, made into page elements: headings,
// emphasis, lists and tasks, quotes and callouts, code, tables, rules,
// links ([text](path) and [[wikilinks]]), embeds (pictures, other notes),
// #tags, ==highlights==, footnotes, %%comments%%, $math$ (as written), and
// the frontmatter's properties. Never the note's own HTML: a <tag> in a
// note shows as text, so a note can't run anything here. ctx says where a
// link goes and what an embed shows (adlermd.js).
// Also a small YAML reader, for frontmatter and Bases files.
// Uses el, svg.
"use strict";

// --------------------------------------------------------------- YAML

// The YAML notes use: maps, lists, nested by indentation; strings (quoted
// or not), numbers, booleans, null; [inline, lists] and {inline: maps};
// | and > blocks. Not anchors, tags or documents.
function yamlParse(text) {
  const lines = String(text).replace(/\t/g, "  ").split("\n")
    .map((t, n) => ({ t: t.replace(/\s+#(?=\s).*$|^\s*#.*$/, "").replace(/\s+$/, ""), raw: t, n }))
    .filter((l) => l.t.trim() !== "" || false);
  let i = 0;
  const indent = (l) => l.t.length - l.t.trimStart().length;
  function scalar(v) {
    v = v.trim();
    if (v === "" || v === "~" || v === "null") return null;
    if (v === "true" || v === "false") return v === "true";
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) return Number(v);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      const inner = v.slice(1, -1);
      return v[0] === '"' ? inner.replace(/\\(["\\nt])/g, (_, c) => ({ n: "\n", t: "\t" }[c] || c)) : inner.replace(/''/g, "'");
    }
    if (v.startsWith("[") && v.endsWith("]")) return splitFlow(v.slice(1, -1)).map(scalar);
    if (v.startsWith("{") && v.endsWith("}")) {
      return Object.fromEntries(splitFlow(v.slice(1, -1)).map((kv) => {
        const at = kv.indexOf(":");
        return at < 0 ? [kv.trim(), null] : [kv.slice(0, at).trim().replace(/^["']|["']$/g, ""), scalar(kv.slice(at + 1))];
      }));
    }
    return v;
  }
  function splitFlow(s) {
    const out = [];
    let depth = 0, quote = null, cur = "";
    for (const ch of s) {
      if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim() !== "") out.push(cur);
    return out.map((x) => x.trim());
  }
  function block(at, style) {
    // | keeps newlines, > folds them; the lines indented under the key.
    const parts = [];
    let base = null;
    while (i < lines.length) {
      const l = lines[i];
      const ind = indent(l);
      if (ind <= at) break;
      if (base === null) base = ind;
      parts.push(l.raw.slice(Math.min(base, l.raw.length - l.raw.trimStart().length)));
      i++;
    }
    return style.startsWith("|") ? parts.join("\n") : parts.join(" ");
  }
  function node(at) {
    if (i >= lines.length) return null;
    const first = lines[i];
    if (indent(first) < at) return null;
    const here = indent(first);
    if (first.t.trimStart().startsWith("- ") || first.t.trim() === "-") {
      const list = [];
      while (i < lines.length && indent(lines[i]) === here && /^-( |$)/.test(lines[i].t.trimStart())) {
        const rest = lines[i].t.trimStart().slice(1).trim();
        i++;
        if (rest === "") list.push(node(here + 1));
        else if (/^[^"'[{][^:]*:( |$)/.test(rest)) {
          // - key: value, and more keys under it: a map in the list.
          lines.splice(i, 0, { t: " ".repeat(here + 2) + rest, raw: " ".repeat(here + 2) + rest, n: -1 });
          list.push(node(here + 1));
        } else list.push(scalar(rest));
      }
      return list;
    }
    const map = {};
    while (i < lines.length && indent(lines[i]) === here) {
      const t = lines[i].t.trim();
      const m = t.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
      if (!m) { i++; continue; }
      const key = m[1].replace(/^["']|["']$/g, "");
      const value = m[2] ?? "";
      i++;
      if (/^[|>][-+]?$/.test(value)) map[key] = block(here, value);
      else if (value === "") map[key] = i < lines.length && indent(lines[i]) > here ? node(here + 1)
        : i < lines.length && indent(lines[i]) === here && lines[i].t.trimStart().startsWith("- ") ? node(here) : null;
      else map[key] = scalar(value);
    }
    return map;
  }
  try {
    return lines.length ? node(0) : {};
  } catch {
    return {};
  }
}

// The frontmatter at a note's top: { data, raw, body, lines (how many it took) }.
function mdFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: null, raw: "", body: text, lines: 0 };
  const data = yamlParse(m[1]);
  return { data: data && typeof data === "object" && !Array.isArray(data) ? data : {}, raw: m[1], body: text.slice(m[0].length),
    lines: m[0].split("\n").length - 1 };
}

// ----------------------------------------------------------- the blocks

const MD_LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
const MD_FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^`\s]*)(.*)$/;
const MD_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const MD_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const CALLOUTS = {
  note: ["note", "#448aff"], abstract: ["abstract", "#00b0ff"], summary: ["abstract", "#00b0ff"], tldr: ["abstract", "#00b0ff"],
  info: ["info", "#00b8d4"], todo: ["todo", "#448aff"], tip: ["tip", "#00bfa5"], hint: ["tip", "#00bfa5"], important: ["tip", "#00bfa5"],
  success: ["success", "#00c853"], check: ["success", "#00c853"], done: ["success", "#00c853"],
  question: ["question", "#ff9100"], help: ["question", "#ff9100"], faq: ["question", "#ff9100"],
  warning: ["warning", "#ff9100"], caution: ["warning", "#ff9100"], attention: ["warning", "#ff9100"],
  failure: ["failure", "#ff5252"], fail: ["failure", "#ff5252"], missing: ["failure", "#ff5252"],
  danger: ["danger", "#ff1744"], error: ["danger", "#ff1744"], bug: ["bug", "#f50057"], example: ["example", "#7c4dff"],
  quote: ["quote", "#9e9e9e"], cite: ["quote", "#9e9e9e"],
};
const CALLOUT_ICONS = {
  note: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"], abstract: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  info: ["M12 16v-4", "M12 8h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"], todo: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m9 12 2 2 4-4"],
  tip: ["M12 2 15 9l7 .5-5.5 4.5L18 21l-6-3.5L6 21l1.5-7L2 9.5 9 9z"], success: ["M20 6 9 17l-5-5"],
  question: ["M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"],
  warning: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "M12 9v4", "M12 17h.01"],
  failure: ["M18 6 6 18", "m6 6 12 12"], danger: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"], bug: ["M8 2l1.9 1.9", "M14.1 3.9 16 2", "M9 7.1V6a3 3 0 1 1 6 0v1.1", "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6", "M12 20v-9", "M6.5 13H3", "M21 13h-3.5"],
  example: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"], quote: ["M3 21c3 0 7-1 7-8V5H3v8h4c0 3-1 5-4 5", "M14 21c3 0 7-1 7-8V5h-7v8h4c0 3-1 5-4 5"],
};

const mdIndent = (s) => s.length - s.trimStart().length;
function mdSlug(text) { return String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-"); }

// A note's text, as elements. lines: [{ t, n }] (n: its line in the note,
// so a task's box can tick it there).
function mdRender(text, ctx = {}) {
  const front = mdFrontmatter(text);
  const lines = front.body.split(/\r?\n/).map((t, n) => ({ t, n: n + front.lines }));
  const state = { footnotes: new Map(), ctx };
  const frag = document.createDocumentFragment();
  if (front.data && Object.keys(front.data).length && ctx.properties !== false) frag.append(mdProperties(front.data, ctx));
  frag.append(...mdBlocks(lines, state));
  if (state.footnotes.size) {
    frag.append(el("section", { class: "md-footnotes" }, el("hr"), el("ol", {}, ...[...state.footnotes].map(([id, body]) =>
      el("li", { id: `fn-${mdSlug(id)}` }, ...mdInline(body, state))))));
  }
  return frag;
}

function mdProperties(data, ctx) {
  const value = (v) => (Array.isArray(v) ? el("span", { class: "md-prop-list" }, ...v.map((x) => el("span", { class: "md-prop-pill" }, ...mdInline(String(x ?? ""), { ctx }))))
    : v && typeof v === "object" ? el("code", {}, JSON.stringify(v)) : el("span", {}, ...mdInline(String(v ?? ""), { ctx })));
  return el("div", { class: "md-properties" }, ...Object.entries(data).map(([k, v]) =>
    el("div", { class: "md-prop" }, el("span", { class: "md-prop-key" }, k), el("span", { class: "md-prop-value" }, value(v)))));
}

function mdBlocks(lines, state) {
  const out = [];
  let i = 0;
  const startsBlock = (t) => MD_FENCE.test(t) || /^\s{0,3}#{1,6}(\s|$)/.test(t) || MD_HR.test(t) || /^\s{0,3}>/.test(t)
    || MD_LIST.test(t) || /^\s*\$\$/.test(t) || /^\s*%%/.test(t);
  while (i < lines.length) {
    const { t, n } = lines[i];
    if (t.trim() === "") { i++; continue; }
    let m;
    if ((m = t.match(MD_FENCE))) {
      const [, , fence, lang] = m;
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(lines[i].t)) body.push(lines[i++].t);
      i++;
      const code = body.join("\n");
      out.push(lang === "base" && state.ctx.base ? state.ctx.base(code)
        : el("pre", { class: "md-code" }, el("code", { ...(lang ? { "data-lang": lang } : {}) }, code)));
      continue;
    }
    if (/^\s*\$\$/.test(t)) {
      const body = [t.replace(/^\s*\$\$/, "")];
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(body[body.length - 1])) body.push(lines[i++].t);
      out.push(el("div", { class: "md-math" }, body.join("\n").replace(/\$\$\s*$/, "").trim()));
      continue;
    }
    if (/^\s*%%/.test(t)) {
      // A comment: shown only while you edit.
      let rest = t.replace(/^\s*%%/, "");
      while (!rest.includes("%%") && i + 1 < lines.length) rest = lines[++i].t;
      i++;
      continue;
    }
    if ((m = t.match(/^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/))) {
      const text = (m[2] || "").replace(/\s\^[\w-]+$/, "");
      out.push(el(`h${m[1].length}`, { class: "md-h", id: `h-${mdSlug(text)}`, "data-line": String(n) }, ...mdInline(text, state)));
      i++;
      continue;
    }
    if (MD_HR.test(t)) { out.push(el("hr")); i++; continue; }
    if (/^\s{0,3}>/.test(t)) {
      const inner = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i].t)) {
        inner.push({ t: lines[i].t.replace(/^\s{0,3}>\s?/, ""), n: lines[i].n });
        i++;
      }
      out.push(mdQuote(inner, state));
      continue;
    }
    if (t.includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1].t) && lines[i + 1].t.includes("-")) {
      const rows = [t];
      const align = mdCells(lines[i + 1].t).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
      i += 2;
      while (i < lines.length && lines[i].t.includes("|") && lines[i].t.trim()) rows.push(lines[i++].t);
      const cell = (tag, text, k) => el(tag, align[k] ? { style: `text-align:${align[k]}` } : {}, ...mdInline(text, state));
      out.push(el("div", { class: "md-table-wrap" }, el("table", { class: "md-table" },
        el("thead", {}, el("tr", {}, ...mdCells(rows[0]).map((c, k) => cell("th", c, k)))),
        el("tbody", {}, ...rows.slice(1).map((r) => el("tr", {}, ...mdCells(r).map((c, k) => cell("td", c, k))))))));
      continue;
    }
    if ((m = t.match(/^\[\^([^\]]+)\]:\s?(.*)$/))) {
      const body = [m[2]];
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i].t)) body.push(lines[i++].t.trim());
      state.footnotes.set(m[1], body.join(" "));
      continue;
    }
    if (MD_LIST.test(t)) {
      const [list, next] = mdList(lines, i, state);
      out.push(list);
      i = next;
      continue;
    }
    // A paragraph: up to a blank line or something else.
    const para = [t];
    const first = n;
    i++;
    while (i < lines.length && lines[i].t.trim() !== "" && !startsBlock(lines[i].t)
      && !(lines[i].t.includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1].t))) para.push(lines[i++].t);
    const joined = para.join("\n").replace(/\s\^[\w-]+$/, "");
    // A line that's just an embed: the embed as a block, not in a paragraph.
    const solo = joined.trim().match(/^!\[\[([^\]]+)\]\]$/);
    if (solo && state.ctx.embed) {
      const node = state.ctx.embed(solo[1], { wiki: true });
      if (node) { out.push(node); continue; }
    }
    out.push(el("p", { "data-line": String(first) }, ...mdInline(joined, state)));
  }
  return out;
}

function mdCells(row) {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  const cells = [];
  let cur = "", code = false;
  for (let k = 0; k < r.length; k++) {
    const ch = r[k];
    if (ch === "`") code = !code;
    if (ch === "\\" && r[k + 1] === "|") { cur += "|"; k++; continue; }
    if (ch === "|" && !code && !/\[\[[^\]]*$/.test(cur)) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function mdQuote(inner, state) {
  const head = inner[0]?.t.match(/^\[!([\w-]+)\]([+-]?)\s*(.*)$/);
  if (!head) return el("blockquote", { class: "md-quote" }, ...mdBlocks(inner, state));
  const type = head[1].toLowerCase();
  const [look, color] = CALLOUTS[type] || ["note", "#448aff"];
  const title = head[3] || type[0].toUpperCase() + type.slice(1);
  const body = mdBlocks(inner.slice(1), state);
  const titleRow = [el("span", { class: "md-callout-icon" }, svg(CALLOUT_ICONS[look] || CALLOUT_ICONS.note)),
    el("span", { class: "md-callout-title-text" }, ...mdInline(title, state))];
  const style = { class: `md-callout md-callout-${look}`, style: `--callout:${color}`, "data-callout": type };
  if (!head[2]) return el("div", style, el("div", { class: "md-callout-title" }, ...titleRow), body.length ? el("div", { class: "md-callout-body" }, ...body) : "");
  // + or -: folds, open or closed to begin with.
  return el("details", { ...style, ...(head[2] === "+" ? { open: "" } : {}) },
    el("summary", { class: "md-callout-title" }, ...titleRow), el("div", { class: "md-callout-body" }, ...body));
}

function mdList(lines, start, state) {
  const first = lines[start].t.match(MD_LIST);
  const base = mdIndent(first[1]);
  const ordered = /\d/.test(first[2]);
  const list = el(ordered ? "ol" : "ul", { class: "md-list", ...(ordered && parseInt(first[2], 10) !== 1 ? { start: String(parseInt(first[2], 10)) } : {}) });
  let i = start;
  while (i < lines.length) {
    const m = lines[i].t.match(MD_LIST);
    if (!m || mdIndent(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const at = lines[i].n;
    const inner = [{ t: m[4], n: at }];
    const width = m[1].length + m[2].length + (m[3].length || 1);
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.t.trim() === "") {
        const next = lines.slice(i + 1).find((x) => x.t.trim() !== "");
        if (next && mdIndent(next.t) > base) { inner.push({ t: "", n: l.n }); i++; continue; }
        break;
      }
      if (mdIndent(l.t) <= base && (MD_LIST.test(l.t) || startsLikeBlock(l.t))) break;
      inner.push({ t: l.t.slice(Math.min(width, mdIndent(l.t))), n: l.n });
      i++;
    }
    const task = inner[0].t.match(/^\[(.)\](\s+|$)(.*)$/);
    const li = el("li", { class: task ? `md-task${task[1] !== " " ? " done" : ""}` : "", ...(task ? { "data-task": task[1] } : {}) });
    if (task) {
      const box = el("input", { type: "checkbox", class: "md-task-box", ...(task[1] !== " " ? { checked: "" } : {}) });
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.ctx.toggleTask) state.ctx.toggleTask(at, box.checked);
        else e.preventDefault();
      });
      li.append(box);
      inner[0] = { t: task[3], n: at };
    }
    const nested = inner.length > 1 && inner.slice(1).some((x) => x.t.trim() !== "");
    if (nested) li.append(...mdBlocks(inner, state));
    else li.append(...mdInline(inner[0].t, state));
    list.append(li);
  }
  return [list, i];
}
function startsLikeBlock(t) { return MD_FENCE.test(t) || /^\s{0,3}#{1,6}\s/.test(t) || /^\s{0,3}>/.test(t) || MD_HR.test(t); }

// ------------------------------------------------------------ in a line

const MD_INLINE = [
  // [name, pattern at the start of what's left, what it makes]
  ["escape", /^\\([\\`*_{}[\]()#+\-.!|~=$%^<>])/, (m) => [document.createTextNode(m[1])]],
  ["code", /^(`+)([\s\S]*?[^`])\1(?!`)/, (m) => [el("code", { class: "md-inline-code" }, m[2].trim())]],
  ["comment", /^%%[\s\S]*?%%/, () => []],
  ["math", /^\$(?=\S)([^$\n]*?\S)\$(?!\d)/, (m) => [el("span", { class: "md-math-inline" }, m[1])]],
  ["wikiembed", /^!\[\[([^\]\n]+)\]\]/, (m, s) => mdEmbed(m[1], { wiki: true }, s)],
  ["wikilink", /^\[\[([^\]\n]+)\]\]/, (m, s) => {
    const [target, alias] = m[1].split("|");
    return [mdLink(target, alias || target.replace(/#\^?/, " › "), { wiki: true }, s)];
  }],
  ["image", /^!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/, (m, s) => mdEmbed(m[2], { wiki: false, alt: m[1] }, s)],
  ["link", /^\[((?:\[[^\]]*\]|[^\]\n])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/, (m, s) => [mdLink(m[2], m[1], { wiki: false, inner: true }, s)]],
  ["autolink", /^<(https?:\/\/[^>\s]+)>/, (m, s) => [mdLink(m[1], m[1], { wiki: false }, s)]],
  ["url", /^https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_~)]/, (m, s) => [mdLink(m[0], m[0], { wiki: false }, s)]],
  ["fnref", /^\[\^([^\]\s]+)\]/, (m) => [el("sup", { class: "md-fnref" }, el("a", { href: `#fn-${mdSlug(m[1])}` }, m[1]))]],
  ["fninline", /^\^\[([^\]]+)\]/, (m, s) => [el("span", { class: "md-fn-inline", title: m[1] }, ...mdInline(m[1], s))]],
  ["bolditalic", /^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/, (m, s) => [el("strong", {}, el("em", {}, ...mdInline(m[2], s)))]],
  ["bold", /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, (m, s) => [el("strong", {}, ...mdInline(m[2], s))]],
  ["italic", /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![\w*])/, (m, s) => [el("em", {}, ...mdInline(m[2], s))]],
  ["strike", /^~~(?=\S)([\s\S]*?\S)~~/, (m, s) => [el("del", {}, ...mdInline(m[1], s))]],
  ["highlight", /^==(?=\S)([\s\S]*?\S)==/, (m, s) => [el("mark", {}, ...mdInline(m[1], s))]],
  ["tag", /^#([\p{L}_][\p{L}\p{N}_/-]*|\d+[\p{L}_/-][\p{L}\p{N}_/-]*)/u, (m, s) => {
    const tag = el("a", { class: "md-tag", href: "#", "data-tag": m[1] }, `#${m[1]}`);
    tag.addEventListener("click", (e) => { e.preventDefault(); s.ctx.tag?.(m[1]); });
    return [tag];
  }],
  ["break", /^( {2,}|\\)\n/, () => [el("br")]],
];

function mdInline(text, state) {
  const out = [];
  let buf = "";
  const flush = () => { if (buf) { out.push(document.createTextNode(buf)); buf = ""; } };
  const strict = state.ctx?.strictLineBreaks;
  let k = 0;
  const s = String(text);
  while (k < s.length) {
    const rest = s.slice(k);
    const prev = k ? s[k - 1] : " ";
    let done = false;
    for (const [name, re, make] of MD_INLINE) {
      if (name === "tag" && !/[\s([{,]/.test(prev)) continue;
      if ((name === "italic" || name === "bold" || name === "bolditalic") && rest[0] === "_" && /[\p{L}\p{N}]/u.test(prev)) continue;
      if (name === "url" && /[\w/]/.test(prev)) continue;
      const m = rest.match(re);
      if (!m) continue;
      flush();
      out.push(...make(m, state));
      k += m[0].length;
      done = true;
      break;
    }
    if (done) continue;
    if (s[k] === "\n") {
      flush();
      out.push(strict ? document.createTextNode(" ") : el("br"));
      k++;
      continue;
    }
    buf += s[k++];
  }
  flush();
  return out;
}

function mdLink(href, label, opts, state) {
  const external = /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href);
  const target = external ? null : state.ctx.resolve?.(href, opts.wiki);
  const text = opts.inner ? mdInline(label, state) : [label];
  const a = el("a", {
    class: `md-link${external ? " external" : ""}${!external && target && !target.exists ? " unresolved" : ""}`,
    href: external ? href : "#", ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}),
    title: external ? href : target?.path || href,
  }, ...text);
  a.addEventListener("click", (e) => {
    if (!state.ctx.open) return;
    e.preventDefault();
    state.ctx.open({ href, external, target, wiki: opts.wiki }, e);
  });
  return a;
}

function mdEmbed(target, opts, state) {
  const external = /^[a-z][a-z0-9+.-]*:/i.test(target);
  // ![[pic.png|300]] or ![alt|300](pic.png): a width.
  const [name, size] = (opts.wiki ? target : target).split("|");
  const width = /^\d+(x\d+)?$/.test(size || "") ? size.split("x")[0] : /\|(\d+)$/.exec(opts.alt || "")?.[1];
  if (external) {
    // Pictures from elsewhere aren't loaded here (adlerOS shows only its own): a link instead.
    return [mdLink(target, opts.alt || target, { wiki: false }, state)];
  }
  const node = state.ctx.embed?.(name, { ...opts, width, depth: (state.depth || 0) + 1 });
  return [node || mdLink(name, opts.alt || name, opts, state)];
}
