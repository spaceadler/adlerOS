// adlermd's graph: notes as dots, their links as lines, pulled into shape
// by forces (graph.json's centre, repel and link strengths, and link
// distance), on a canvas. Drag the space to move round, the wheel zooms, a
// dot can be dragged; click one to open it (Ctrl: in a new tab). Hovering
// lights up what a note links with. graph.json's colour groups (path:,
// tag:, file:, or words) colour the dots; the box at the top filters them.
// Uses el.
"use strict";

function mdGraph(box, data, { settings = {}, current = null, open }) {
  const canvas = el("canvas", { class: "md-graph-canvas" });
  const filter = el("input", { class: "field-input md-graph-filter", type: "search", placeholder: "Filter the graph", spellcheck: "false" });
  const count = el("span", { class: "md-graph-count" }, `${data.nodes.length} notes, ${data.links.length} links`);
  box.replaceChildren(canvas, el("div", { class: "md-graph-bar" }, filter, count));
  const ctx = canvas.getContext("2d");
  const size = Math.sqrt(data.nodes.length + 1) * 40;
  const nodes = data.nodes.map((n, i) => {
    const a = i * 2.399963; // spread round a spiral to start with
    const r = size * Math.sqrt((i + 0.5) / Math.max(1, data.nodes.length));
    return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fixed: false };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.links.map((l) => ({ s: byId.get(l.source), t: byId.get(l.target) })).filter((l) => l.s && l.t && l.s !== l.t);
  const near = new Map(nodes.map((n) => [n, new Set()]));
  for (const l of links) { near.get(l.s).add(l.t); near.get(l.t).add(l.s); }
  const repel = (settings.repelStrength ?? 10) * 90;
  const distance = 30 + (settings.linkDistance ?? 250) * 0.25;
  const linkK = 0.04 * (settings.linkStrength ?? 1);
  const centreK = 0.004 * (settings.centerStrength ?? 0.5);
  const nodeSize = settings.nodeSizeMultiplier ?? 1;
  const lineSize = settings.lineSizeMultiplier ?? 1;
  const fade = settings.textFadeMultiplier ?? 0;
  const accent = getComputedStyle(box).getPropertyValue("--md-accent").trim() || "#8b7cf6";
  const groups = (data.groups || []).map((g) => ({ ...g, test: groupTest(g.query) }));
  const colour = (n) => {
    if (n.id === current) return accent;
    for (const g of groups) if (g.test(n)) return `#${(g.color?.rgb ?? 0x8b7cf6).toString(16).padStart(6, "0")}`;
    return n.kind === "tag" ? "#4ade80" : n.kind === "attachment" ? "#e2c044" : n.kind === "unresolved" ? "#6b6b76" : "#b8b8c4";
  };
  const view = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let hover = null;
  let drag = null;
  let match = null;
  let running = true;
  let fitted = false;

  function tick() {
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 640000) continue; // far apart: nothing between them worth working out
        const f = (repel * alpha) / d2;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x;
      const dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - distance) / d) * linkK * alpha;
      l.s.vx += dx * f; l.s.vy += dy * f;
      l.t.vx -= dx * f; l.t.vy -= dy * f;
    }
    for (const a of nodes) {
      if (a.fixed) { a.vx = a.vy = 0; continue; }
      a.vx -= a.x * centreK * alpha;
      a.vy -= a.y * centreK * alpha;
      a.vx *= 0.6; a.vy *= 0.6;
      a.x += Math.max(-40, Math.min(40, a.vx));
      a.y += Math.max(-40, Math.min(40, a.vy));
    }
    alpha = Math.max(0, alpha * 0.985);
  }

  // So everything's in view, once it's mostly settled.
  function fit() {
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    view.k = Math.max(0.05, Math.min(2, 0.9 * Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))));
    view.x = -(x0 + x1) / 2;
    view.y = -(y0 + y1) / 2;
  }

  const radius = (n) => (3 + Math.sqrt(n.degree) * 1.6) * nodeSize;
  const toScreen = (n) => [(n.x + view.x) * view.k + canvas.clientWidth / 2, (n.y + view.y) * view.k + canvas.clientHeight / 2];
  const toWorld = (sx, sy) => [(sx - canvas.clientWidth / 2) / view.k - view.x, (sy - canvas.clientHeight / 2) / view.k - view.y];

  function draw() {
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const lit = hover ? near.get(hover) : null;
    ctx.lineWidth = Math.max(0.5, view.k * lineSize);
    for (const l of links) {
      const on = hover && (l.s === hover || l.t === hover);
      const dim = (hover && !on) || (match && !(match.has(l.s) && match.has(l.t)));
      ctx.strokeStyle = on ? accent : `rgba(200, 200, 215, ${dim ? 0.06 : 0.22})`;
      const [ax, ay] = toScreen(l.s);
      const [bx, by] = toScreen(l.t);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    const labelsFrom = 0.9 - fade * 0.15;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const n of nodes) {
      const [x, y] = toScreen(n);
      if (x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;
      const dim = (hover && n !== hover && !lit.has(n)) || (match && !match.has(n));
      const r = radius(n) * Math.max(0.6, Math.min(1.6, view.k));
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.fillStyle = n === hover ? accent : colour(n);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (view.k >= labelsFrom || n === hover || (lit && lit.has(n))) {
        ctx.fillStyle = dim ? "rgba(230,230,240,0.25)" : "rgba(235,235,245,0.9)";
        ctx.fillText(n.label.length > 40 ? `${n.label.slice(0, 38)}…` : n.label, x, y + r + 13);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    if (!running || !canvas.isConnected) { running = false; return; }
    if (alpha > 0.005 || drag) tick();
    if (!fitted && alpha < 0.4) { fit(); fitted = true; }
    draw();
    requestAnimationFrame(frame);
  }
  for (let i = 0; i < 40; i++) tick(); // a head start, before the first frame
  requestAnimationFrame(frame);

  function nodeAt(sx, sy) {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const [x, y] = toScreen(n);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      const r = Math.max(8, radius(n) * view.k + 4);
      if (d < r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
    drag = { n, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (n) { n.fixed = true; alpha = Math.max(alpha, 0.3); }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    if (!drag) {
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "grab"; }
      return;
    }
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
    if (drag.n) {
      const [wx, wy] = toWorld(e.clientX - r.left, e.clientY - r.top);
      drag.n.x = wx;
      drag.n.y = wy;
    } else {
      view.x = drag.vx + (e.clientX - drag.x) / view.k;
      view.y = drag.vy + (e.clientY - drag.y) / view.k;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.n) d.n.fixed = false;
    if (d.n && !d.moved && (d.n.kind === "note" || d.n.kind === "unresolved" || d.n.kind === "tag")) open(d.n.id, e.ctrlKey || e.metaKey);
  });
  canvas.addEventListener("pointerleave", () => { hover = null; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(e.clientX - r.left, e.clientY - r.top);
    view.k = Math.max(0.03, Math.min(6, view.k * Math.exp(-e.deltaY * 0.0015)));
    // Zoom about the pointer: the point under it stays under it.
    const [nx, ny] = toWorld(e.clientX - r.left, e.clientY - r.top);
    view.x += nx - wx;
    view.y += ny - wy;
  }, { passive: false });
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    match = q ? new Set(nodes.filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q))) : null;
  });
  return { stop: () => { running = false; } };
}

// A colour group's query, as a test: path:, tag:, file:, or words in the path.
function groupTest(query) {
  const q = String(query || "").trim();
  const m = q.match(/^(path|tag|file):\s*(.+)$/i);
  if (!m) return (n) => q && n.id.toLowerCase().includes(q.toLowerCase());
  const want = m[2].replace(/^"|"$/g, "").toLowerCase();
  if (m[1].toLowerCase() === "path") return (n) => n.id.toLowerCase().includes(want);
  if (m[1].toLowerCase() === "file") return (n) => n.label.toLowerCase().includes(want);
  const tag = want.replace(/^#/, "");
  return (n) => (n.tags || []).some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`)) || n.id.toLowerCase() === `#${tag}`;
}
