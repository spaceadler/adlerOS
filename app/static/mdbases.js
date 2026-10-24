// Obsidian's Bases in Luna: a .base file (or a ```base block in a note)
// is YAML that picks notes (filters), works things out (formulas) and shows
// them in views, a table or cards. Its expressions are Bases' own small
// language; here, the parts notes use most: file.name, .basename, .path,
// .folder, .ext, .size, .mtime, .tags, .links; a property by its name (or
// note.<name>), formula.<name>, this (the note it's in); file.hasTag(),
// .inFolder(), .hasLink(), .hasProperty(); == != < > <= >= && || ! + - * /
// %; "text", numbers, true, false, null, [lists]; .contains(),
// .startsWith(), .endsWith(), .lower(), .upper(), .length, .isEmpty(),
// .join(); if(), now(), today(), date(), number(), list(); dates and
// durations ("7d", "2 weeks") add and subtract.
// Uses el, mdInline, yamlParse.
"use strict";

function mdBase(yamlText, ctx) {
  let base;
  try { base = yamlParse(yamlText) || {}; } catch { base = {}; }
  if (typeof base !== "object" || Array.isArray(base)) base = {};
  const views = Array.isArray(base.views) && base.views.length ? base.views : [{ type: "table", name: "Table" }];
  const box = el("div", { class: "md-base" });
  let current = 0;
  const draw = () => {
    const view = views[current] || views[0];
    const rows = baseRows(base, view, ctx);
    const tabs = views.length > 1 ? el("div", { class: "md-base-views" }, ...views.map((v, i) => {
      const b = el("button", { type: "button", class: `md-mode${i === current ? " on" : ""}` }, String(v.name || v.type || `View ${i + 1}`));
      b.addEventListener("click", () => { current = i; draw(); });
      return b;
    })) : "";
    const head = el("div", { class: "md-base-head" }, tabs, el("span", { class: "md-count" }, `${rows.length} result${rows.length === 1 ? "" : "s"}`));
    box.replaceChildren(head, view.type === "cards" ? baseCards(base, view, rows, ctx) : baseTable(base, view, rows, ctx));
  };
  draw();
  return box;
}

// The notes (and files) the base and its view pick, sorted, as many as the
// view's limit.
function baseRows(base, view, ctx) {
  const thisNote = ctx.notes.find((n) => n.path === ctx.thisFile) || null;
  const rows = [];
  const seen = new Set();
  for (const n of ctx.notes) {
    seen.add(n.path);
    rows.push(baseFile(n));
  }
  for (const f of ctx.files) if (!seen.has(f.path)) rows.push(baseFile({ path: f.path, size: f.size, mtime: f.mtime, props: {}, tags: [], links: [] }));
  const env = (row) => ({ row, base, thisNote: thisNote && baseFile(thisNote) });
  const picked = rows.filter((row) => baseFilter(base.filters, env(row)) && baseFilter(view.filters, env(row)));
  const sorts = [].concat(view.sort || []).map((s) => (typeof s === "string" ? { property: s, direction: "ASC" } : s)).filter((s) => s && s.property);
  if (!sorts.length) sorts.push({ property: "file.name", direction: "ASC" });
  picked.sort((a, b) => {
    for (const s of sorts) {
      const x = baseValue(s.property, env(a));
      const y = baseValue(s.property, env(b));
      const c = baseCompare(x, y);
      if (c) return String(s.direction || "ASC").toUpperCase() === "DESC" ? -c : c;
    }
    return 0;
  });
  return picked.slice(0, Number(view.limit) > 0 ? Number(view.limit) : undefined).map((row) => ({ row, env: env(row) }));
}

function baseFile(n) {
  const name = n.path.split("/").pop();
  const dot = name.lastIndexOf(".");
  return {
    path: n.path, name, basename: dot > 0 ? name.slice(0, dot) : name, ext: dot > 0 ? name.slice(dot + 1) : "",
    folder: n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "", size: n.size || 0,
    mtime: (n.mtime || 0) * 1000, ctime: (n.mtime || 0) * 1000, tags: n.tags || [], links: (n.links || []).filter((l) => l.exists).map((l) => l.path),
    props: n.props || {},
  };
}

function baseFilter(f, env) {
  if (f === undefined || f === null || f === "") return true;
  if (typeof f === "string") return baseTruthy(baseEval(f, env));
  if (Array.isArray(f)) return f.every((x) => baseFilter(x, env));
  if (typeof f === "object") {
    if (Array.isArray(f.and)) return f.and.every((x) => baseFilter(x, env));
    if (Array.isArray(f.or)) return f.or.some((x) => baseFilter(x, env));
    if (Array.isArray(f.not)) return !f.not.some((x) => baseFilter(x, env));
  }
  return true;
}

const baseTruthy = (v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== false && v !== 0 && v !== "");

function baseCompare(x, y) {
  if (x === y) return 0;
  if (x === null || x === undefined || x === "") return 1;
  if (y === null || y === undefined || y === "") return -1;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
}

// A column's value: file.x, formula.x, note.x or a property.
function baseValue(prop, env) {
  return baseEval(String(prop), env);
}

// ------------------------------------------------------- the language

function baseTokens(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_$][\w$-]*)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!().,[\]]))/y;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1") });
    else if (m[3] !== undefined) out.push({ t: "id", v: m[3] });
    else out.push({ t: "op", v: m[4] });
  }
  return out;
}

function baseEval(src, env, depth = 0) {
  const key = `${src}`;
  const cache = env.cache || (env.cache = new Map());
  if (cache.has(key)) return cache.get(key);
  const tokens = baseTokens(src);
  let i = 0;
  const peek = (v) => tokens[i] && tokens[i].v === v && tokens[i].t === "op";
  const next = () => tokens[i++];
  const expect = (v) => { if (peek(v)) i++; };
  const bin = (sub, ops, f) => () => {
    let left = sub();
    while (tokens[i] && tokens[i].t === "op" && ops.includes(tokens[i].v)) {
      const op = next().v;
      left = f(op, left, sub());
    }
    return left;
  };
  const primary = () => {
    const tok = next();
    if (!tok) return null;
    if (tok.t === "num" || tok.t === "str") return tok.v;
    if (tok.t === "op" && tok.v === "(") { const v = or(); expect(")"); return v; }
    if (tok.t === "op" && tok.v === "[") {
      const list = [];
      while (tokens[i] && !peek("]")) { list.push(or()); if (peek(",")) i++; }
      expect("]");
      return list;
    }
    if (tok.t === "id") {
      if (tok.v === "true" || tok.v === "false") return tok.v === "true";
      if (tok.v === "null") return null;
      if (peek("(")) { i++; const args = argList(); return baseCall(tok.v, args, env); }
      return { ref: tok.v };
    }
    return null;
  };
  const argList = () => {
    const args = [];
    while (tokens[i] && !peek(")")) { args.push(or()); if (peek(",")) i++; }
    expect(")");
    return args;
  };
  const postfix = () => {
    let v = primary();
    for (;;) {
      if (peek(".")) {
        i++;
        const name = next()?.v;
        if (peek("(")) { i++; v = baseMethod(baseResolve(v, env, depth), name, argList(), env); }
        else v = v && typeof v === "object" && "ref" in v ? { ref: `${v.ref}.${name}` } : baseProp(baseResolve(v, env, depth), name);
      } else if (peek("[")) {
        i++;
        const k = or();
        expect("]");
        const target = baseResolve(v, env, depth);
        v = target == null ? null : target[k];
      } else return v;
    }
  };
  const unary = () => {
    if (peek("!")) { i++; return !baseTruthy(baseResolve(unary(), env, depth)); }
    if (peek("-")) { i++; return -Number(baseResolve(unary(), env, depth)); }
    return postfix();
  };
  const val = (x) => baseResolve(x, env, depth);
  const mul = bin(unary, ["*", "/", "%"], (op, a, b) => {
    const [x, y] = [Number(val(a)), Number(val(b))];
    return op === "*" ? x * y : op === "/" ? x / y : x % y;
  });
  const add = bin(mul, ["+", "-"], (op, a, b) => baseArith(op, val(a), val(b)));
  const cmp = bin(add, ["<", ">", "<=", ">="], (op, a, b) => {
    const c = baseCompare(baseDateish(val(a)), baseDateish(val(b)));
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  });
  const eq = bin(cmp, ["==", "!="], (op, a, b) => {
    const [x, y] = [val(a), val(b)];
    // "3" and 3 are the same, as Bases has it; lists by what's in them.
    const same = Array.isArray(x) || Array.isArray(y) ? JSON.stringify(x) === JSON.stringify(y)
      : x === y || (x != null && y != null && String(x) === String(y));
    return op === "==" ? same : !same;
  });
  const and = bin(eq, ["&&"], (op, a, b) => baseTruthy(val(a)) && baseTruthy(val(b)));
  const or = bin(and, ["||"], (op, a, b) => baseTruthy(val(a)) || baseTruthy(val(b)));
  let result;
  try { result = val(or()); } catch { result = null; }
  cache.set(key, result);
  return result;
}

// A name, to its value: file, note.x, formula.x, this, or a property.
function baseResolve(v, env, depth = 0) {
  if (!v || typeof v !== "object" || !("ref" in v)) return v;
  const parts = v.ref.split(".");
  const head = parts.shift();
  let out;
  if (head === "file") out = env.row;
  else if (head === "this") out = env.thisNote;
  else if (head === "note") out = env.row.props;
  else if (head === "formula") {
    const name = parts.shift();
    const f = env.base.formulas?.[name];
    out = f === undefined || depth > 8 ? null : baseEval(String(f), env, depth + 1);
  } else out = env.row.props[head];
  for (const p of parts) out = baseProp(out, p);
  return out === undefined ? null : out;
}

function baseProp(v, name) {
  if (v == null) return null;
  if (name === "length") return Array.isArray(v) || typeof v === "string" ? v.length : null;
  if (v.props && !(name in v) && name in v.props) return v.props[name];
  return v[name] ?? null;
}

function baseMethod(v, name, args, env) {
  const a = args.map((x) => baseResolve(x, env));
  const s = typeof v === "string" ? v : null;
  const list = Array.isArray(v) ? v : null;
  switch (name) {
    case "hasTag": return v && a.some((t) => (v.tags || []).some((x) => x === String(t).replace(/^#/, "") || x.startsWith(`${String(t).replace(/^#/, "")}/`)));
    case "inFolder": return v && a.some((f) => { const d = String(f).replace(/^\/+|\/+$/g, ""); return v.folder === d || v.folder.startsWith(`${d}/`); });
    case "hasLink": return v && a.some((t) => (v.links || []).some((l) => l === t || l.replace(/\.md$/, "") === String(t) || l.split("/").pop().replace(/\.md$/, "") === String(t)));
    case "hasProperty": return v && a.some((p) => v.props && v.props[p] !== undefined);
    case "contains": return list ? list.some((x) => String(x) === String(a[0])) : s !== null ? s.toLowerCase().includes(String(a[0]).toLowerCase()) : false;
    case "containsAny": return a.some((x) => baseMethod(v, "contains", [x], env));
    case "containsAll": return a.every((x) => baseMethod(v, "contains", [x], env));
    case "startsWith": return s !== null && s.startsWith(String(a[0]));
    case "endsWith": return s !== null && s.endsWith(String(a[0]));
    case "lower": return s !== null ? s.toLowerCase() : v;
    case "upper": return s !== null ? s.toUpperCase() : v;
    case "trim": return s !== null ? s.trim() : v;
    case "isEmpty": return v == null || v === "" || (list && !list.length);
    case "join": return list ? list.join(a[0] ?? ", ") : v;
    case "toString": return v == null ? "" : String(v);
    case "round": return Number(v).toFixed(Number(a[0]) || 0) * 1;
    default: return null;
  }
}

function baseCall(name, args, env) {
  const a = args.map((x) => baseResolve(x, env));
  switch (name) {
    case "if": return baseTruthy(a[0]) ? a[1] : a[2] ?? null;
    case "now": return Date.now();
    case "today": { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case "date": return baseDateish(a[0]);
    case "number": return Number(a[0]);
    case "list": return Array.isArray(a[0]) ? a[0] : a[0] == null ? [] : [a[0]];
    case "min": return Math.min(...a.map(Number));
    case "max": return Math.max(...a.map(Number));
    default: return null;
  }
}

const DURATION = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?|M|months?|y|years?)\s*$/;
const DURATION_MS = { ms: 1, s: 1e3, m: 6e4, min: 6e4, h: 36e5, d: 864e5, w: 6048e5, M: 2592e6, y: 31536e6 };
function baseDuration(text) {
  const m = String(text).match(DURATION);
  if (!m) return null;
  const unit = m[2] === "M" ? "M" : m[2].replace(/s$/, "").replace(/^second$/, "s").replace(/^minute$/, "min").replace(/^hour$/, "h").replace(/^day$/, "d").replace(/^week$/, "w").replace(/^month$/, "M").replace(/^year$/, "y");
  return Number(m[1]) * (DURATION_MS[unit] ?? 0);
}
// A date written as text ("2024-05-01"): its time, to compare and count with.
function baseDateish(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v.trim())) {
    const t = Date.parse(v.trim().replace(" ", "T"));
    return Number.isNaN(t) ? v : t;
  }
  return v;
}
function baseArith(op, x, y) {
  const dx = baseDateish(x);
  const dy = baseDateish(y);
  if (typeof dx === "number" && typeof y === "string" && baseDuration(y) !== null) return op === "+" ? dx + baseDuration(y) : dx - baseDuration(y);
  if (op === "+" && (typeof x === "string" || typeof y === "string")) return `${x ?? ""}${y ?? ""}`;
  return op === "+" ? Number(dx) + Number(dy) : Number(dx) - Number(dy);
}

// --------------------------------------------------------------- views

function baseColumns(base, view, rows) {
  if (Array.isArray(view.order) && view.order.length) return view.order.map(String);
  const props = new Map();
  for (const { row } of rows) for (const k of Object.keys(row.props || {})) props.set(k, (props.get(k) || 0) + 1);
  return ["file.name", ...[...props].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k)];
}

function baseLabel(base, prop) {
  const name = base.properties?.[prop]?.displayName;
  if (name) return String(name);
  return { "file.name": "Name", "file.basename": "Name", "file.path": "Path", "file.folder": "Folder", "file.ext": "Extension", "file.size": "Size",
    "file.mtime": "Modified", "file.ctime": "Created", "file.tags": "Tags", "file.links": "Links" }[prop] || prop.replace(/^(note|formula)\./, "");
}

function baseCell(prop, env, ctx) {
  const v = baseValue(prop, env);
  if (prop === "file.name" || prop === "file.basename") {
    const a = el("a", { href: "#", class: "md-link" }, /\.md$/i.test(env.row.name) ? env.row.basename : env.row.name);
    a.addEventListener("click", (e) => { e.preventDefault(); ctx.open(env.row.path, e); });
    return a;
  }
  if ((prop === "file.mtime" || prop === "file.ctime") && typeof v === "number") return document.createTextNode(new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
  if (prop === "file.size" && typeof v === "number") return document.createTextNode(bytes(v));
  if (v === true || v === false) return el("input", { type: "checkbox", disabled: "", ...(v ? { checked: "" } : {}) });
  if (Array.isArray(v)) return el("span", { class: "md-prop-list" }, ...v.map((x) => el("span", { class: "md-prop-pill" }, ...mdInline(String(x ?? ""), { ctx: {} }))));
  if (v == null) return document.createTextNode("");
  if (typeof v === "object") return el("code", {}, JSON.stringify(v));
  return el("span", {}, ...mdInline(String(v), { ctx: {} }));
}

function baseTable(base, view, rows, ctx) {
  const cols = baseColumns(base, view, rows);
  return el("div", { class: "md-table-wrap" }, el("table", { class: "md-table md-base-table" },
    el("thead", {}, el("tr", {}, ...cols.map((c) => el("th", {}, baseLabel(base, c))))),
    el("tbody", {}, ...rows.map(({ env }) => el("tr", {}, ...cols.map((c) => el("td", {}, baseCell(c, env, ctx))))))));
}

function baseCards(base, view, rows, ctx) {
  const cols = baseColumns(base, view, rows).filter((c) => c !== "file.name" && c !== "file.basename");
  return el("div", { class: "md-base-cards" }, ...rows.map(({ row, env }) => {
    const cover = view.image ? ctx.image?.(baseValue(String(view.image), env) ?? "", row.path) : null;
    const card = el("button", { type: "button", class: "md-base-card" },
      cover ? el("img", { src: cover, alt: "", loading: "lazy" }) : el("div", { class: "md-base-card-blank" }),
      el("div", { class: "md-base-card-body" }, el("div", { class: "md-base-card-title" }, /\.md$/i.test(row.name) ? row.basename : row.name),
        ...cols.slice(0, 4).map((c) => el("div", { class: "md-base-card-prop" }, el("span", { class: "md-prop-key" }, baseLabel(base, c)), baseCell(c, env, ctx)))));
    card.addEventListener("click", (e) => { if (!e.target.closest("a")) ctx.open(row.path, e); });
    return card;
  }));
}
