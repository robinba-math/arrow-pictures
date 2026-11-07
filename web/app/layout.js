// Places dots and routes arrows. Pure: puzzle in, geometry out, no DOM.
// A graph with a directed cycle goes on a ring, which cannot overlap itself;
// anything else is laid out left to right in layers, the way an arrow road reads.

export const R = 26;          // dot radius
const LAYER_GAP = 150;
const ROW_GAP = 104;
const BLOCK_GAP = 128;
const PAD = 40;
const LOOP_RISE = 58;
const MAX_LAYERS = 5;

export function computeLayout(p) {
  if (p.road) return roadLayout(p);
  const ids = p.nodes.map((n) => n.id);
  const succ = new Map(ids.map((id) => [id, []]));
  const pred = new Map(ids.map((id) => [id, []]));
  for (const a of p.arrows) {
    if (a.from === a.to) continue;
    succ.get(a.from).push(a.to);
    pred.get(a.to).push(a.from);
  }

  // A short road reads best left to right. A long one would become a thin
  // strip of tiny dots, so it goes on a ring like a cyclic picture.
  const blocks = undirectedComponents(ids, succ, pred).map((comp) => {
    if (hasDirectedCycle(comp, succ)) return ring(comp, succ, pred, p.arrows);
    const lay = layered(comp, succ, pred, ids);
    return lay.layers > MAX_LAYERS ? ring(comp, succ, pred, p.arrows) : lay;
  });

  // Stack components top to bottom, each centered on the widest.
  const pos = {};
  const widest = Math.max(...blocks.map((b) => b.w));
  let y = 0;
  for (const b of blocks) {
    const dx = (widest - b.w) / 2;
    for (const [id, q] of Object.entries(b.pos)) pos[id] = { x: q.x + dx, y: q.y + y };
    y += b.h + BLOCK_GAP;
  }

  const arrows = routeArrows(p, pos);
  return { pos, arrows, viewBox: frame(pos, arrows) };
}

// Bounds cover dots, loop tops and curve control points.
export function frame(pos, arrows) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, r = 0) => {
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  };
  for (const q of Object.values(pos)) grow(q.x, q.y, R + 6);
  for (const a of arrows) for (const [x, y] of a.extent) grow(x, y, 6);

  return [minX - PAD, minY - PAD, maxX - minX + 2 * PAD, maxY - minY + 2 * PAD].map(Math.round);
}

// A road puzzle is a big sheet of grid paper with room for the dots the
// player adds. Its two ends sit far apart unless the puzzle places its dots
// itself ("at": [column, row]); every dot sits on a grid dot (the grid is
// offset 12 from the sheet's corner, every 24).
export const GRID = 24;
const ROAD_SPAN = 24 * GRID;
function roadLayout(p) {
  const pos = { [p.road.from]: { x: 0, y: 0 }, [p.road.to]: { x: ROAD_SPAN, y: 0 } };
  for (const n of p.nodes) if (n.at) pos[n.id] = { x: n.at[0] * GRID, y: n.at[1] * GRID };
  return { pos, arrows: routeArrows(p, pos), viewBox: [-108, -228, ROAD_SPAN + 216, 456] };
}

function undirectedComponents(ids, succ, pred) {
  const seen = new Set();
  const comps = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const w of [...succ.get(v), ...pred.get(v)]) if (!seen.has(w)) { seen.add(w); stack.push(w); }
    }
    // Keep declaration order inside a component; it is the author's intent.
    comps.push(ids.filter((id) => comp.includes(id)));
  }
  return comps;
}

function hasDirectedCycle(comp, succ) {
  const state = new Map(); // 1 = on stack, 2 = done
  const visit = (v) => {
    state.set(v, 1);
    for (const w of succ.get(v)) {
      if (state.get(w) === 1) return true;
      if (!state.has(w) && visit(w)) return true;
    }
    state.set(v, 2);
    return false;
  };
  return comp.some((v) => !state.has(v) && visit(v));
}

function layered(comp, succ, pred, ids) {
  // Longest-path layering in topological order.
  const indeg = new Map(comp.map((v) => [v, pred.get(v).length]));
  const queue = comp.filter((v) => indeg.get(v) === 0);
  const order = [];
  while (queue.length) {
    const v = queue.shift();
    order.push(v);
    for (const w of succ.get(v)) {
      indeg.set(w, indeg.get(w) - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }
  const layer = new Map();
  for (const v of order) layer.set(v, Math.max(0, ...pred.get(v).map((u) => layer.get(u) + 1)));
  // Pull each source rightwards to sit just before its nearest successor,
  // so a lone arrow into the middle of a road stays short.
  for (const v of order) {
    if (pred.get(v).length === 0 && succ.get(v).length > 0) {
      layer.set(v, Math.min(...succ.get(v).map((w) => layer.get(w))) - 1);
    }
  }
  const min = Math.min(...layer.values());
  const layers = [];
  for (const v of comp) {
    const L = layer.get(v) - min;
    (layers[L] ||= []).push(v);
  }
  for (let i = 0; i < layers.length; i++) layers[i] ||= [];

  // Two barycenter sweeps reduce crossings.
  const rank = new Map();
  const setRanks = () => layers.forEach((col) => col.forEach((v, i) => rank.set(v, i - (col.length - 1) / 2)));
  setRanks();
  const bary = (v, nbrs) => {
    const xs = nbrs.filter((w) => rank.has(w)).map((w) => rank.get(w));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : rank.get(v);
  };
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let i = 1; i < layers.length; i++) {
      layers[i].sort((a, b) => bary(a, pred.get(a)) - bary(b, pred.get(b)) || ids.indexOf(a) - ids.indexOf(b));
      setRanks();
    }
    for (let i = layers.length - 2; i >= 0; i--) {
      layers[i].sort((a, b) => bary(a, succ.get(a)) - bary(b, succ.get(b)) || ids.indexOf(a) - ids.indexOf(b));
      setRanks();
    }
  }

  const tallest = Math.max(...layers.map((c) => c.length));
  const pos = {};
  layers.forEach((col, i) => {
    col.forEach((v, j) => {
      pos[v] = { x: i * LAYER_GAP, y: ((tallest - 1) / 2 + j - (col.length - 1) / 2) * ROW_GAP };
    });
  });
  return { pos, w: (layers.length - 1) * LAYER_GAP, h: (tallest - 1) * ROW_GAP, layers: layers.length };
}

function ring(comp, succ, pred, arrows) {
  // Try every starting dot and both walking preferences; keep the order whose
  // chords cross least, then the one whose arrows are shortest around the ring.
  const inComp = new Set(comp);
  const edges = arrows.filter((a) => a.from !== a.to && inComp.has(a.from)).map((a) => [a.from, a.to]);
  const walk = (start, forwardFirst) => {
    const order = [];
    const seen = new Set();
    const visit = (v) => {
      seen.add(v);
      order.push(v);
      const nbrs = forwardFirst ? [...succ.get(v), ...pred.get(v)] : [...pred.get(v), ...succ.get(v)];
      for (const w of nbrs) if (!seen.has(w)) visit(w);
    };
    visit(start);
    return order;
  };
  const n = comp.length;
  const cost = (order) => {
    const at = new Map(order.map((v, i) => [v, i]));
    const chords = edges.map(([a, b]) => [Math.min(at.get(a), at.get(b)), Math.max(at.get(a), at.get(b))]);
    let crossings = 0;
    for (let i = 0; i < chords.length; i++) {
      for (let j = i + 1; j < chords.length; j++) {
        const [a, b] = chords[i];
        const [c, d] = chords[j];
        if (a === c || a === d || b === c || b === d) continue;
        if ((a < c && c < b) !== (a < d && d < b)) crossings++;
      }
    }
    const length = chords.reduce((sum, [a, b]) => sum + Math.min(b - a, n - (b - a)), 0);
    return crossings * 100 + length;
  };
  let best = null;
  let bestCost = Infinity;
  for (const start of comp) {
    for (const forwardFirst of [true, false]) {
      const order = walk(start, forwardFirst);
      const c = cost(order);
      if (c < bestCost) { best = order; bestCost = c; }
    }
  }
  const radius = Math.max(96, (n * ROW_GAP * 1.15) / (2 * Math.PI));
  const pos = {};
  best.forEach((v, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos[v] = { x: radius + radius * Math.cos(t), y: radius + radius * Math.sin(t) };
  });
  return { pos, w: 2 * radius, h: 2 * radius };
}

// ---- Arrows ----------------------------------------------------------------

export function routeArrows(p, pos) {
  // Arrows between the same two dots, in either direction, fan out.
  const groups = new Map();
  for (const a of p.arrows) {
    if (a.from === a.to) continue;
    const key = [a.from, a.to].sort().join('|');
    (groups.get(key) || groups.set(key, []).get(key)).push(a);
  }
  const loopsAt = new Map();

  return p.arrows.map((a) => {
    if (a.from === a.to) {
      const k = loopsAt.get(a.from) || 0;
      loopsAt.set(a.from, k + 1);
      return { id: a.id, color: a.color, ...selfLoop(pos[a.from], k) };
    }
    const key = [a.from, a.to].sort().join('|');
    const group = groups.get(key);
    const i = group.indexOf(a);
    const n = group.length;
    const canonical = a.from < a.to ? 1 : -1;
    let bend = n === 1 ? 0 : (i - (n - 1) / 2) * 44 * canonical;
    const P = pos[a.from];
    const Q = pos[a.to];
    // A straight arrow that would cross another dot bends around it.
    if (bend === 0) {
      const others = Object.entries(pos).filter(([id]) => id !== a.from && id !== a.to).map(([, q]) => q);
      if (others.some((q) => nearCurve(P, Q, 0, q, R + 10))) {
        bend = [28, -28, 48, -48, 72, -72, 104, -104].find((b) => !others.some((q) => nearCurve(P, Q, b, q, R + 10))) ?? 56;
      }
    }
    return { id: a.id, color: a.color, ...curve(P, Q, bend) };
  });
}

function control(P, Q, bend) {
  const dx = Q.x - P.x, dy = Q.y - P.y;
  const len = Math.hypot(dx, dy) || 1;
  // A quadratic's apex sits halfway to its control point, so double the offset.
  return { x: (P.x + Q.x) / 2 - (dy / len) * bend * 2, y: (P.y + Q.y) / 2 + (dx / len) * bend * 2 };
}

const towards = (from, to, dist) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
};

const r1 = (v) => Math.round(v * 10) / 10;

function curve(P, Q, bend) {
  const C = control(P, Q, bend);
  const s = towards(P, C, R + 3);
  const e = towards(Q, C, R + 5);
  const mid = { x: 0.25 * s.x + 0.5 * C.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * C.y + 0.25 * e.y };
  return {
    d: `M${r1(s.x)} ${r1(s.y)} Q${r1(C.x)} ${r1(C.y)} ${r1(e.x)} ${r1(e.y)}`,
    mid,
    extent: [[s.x, s.y], [mid.x, mid.y], [e.x, e.y]],
  };
}

function selfLoop(P, k) {
  const rise = LOOP_RISE + k * 22;
  const spread = 34 + k * 10;
  const a1 = (-120 * Math.PI) / 180, a2 = (-60 * Math.PI) / 180;
  const s = { x: P.x + (R + 2) * Math.cos(a1), y: P.y + (R + 2) * Math.sin(a1) };
  const e = { x: P.x + (R + 5) * Math.cos(a2), y: P.y + (R + 5) * Math.sin(a2) };
  const c1 = { x: P.x - spread - 6, y: P.y - R - rise };
  const c2 = { x: P.x + spread + 6, y: P.y - R - rise };
  const top = P.y - R - rise * 0.75;
  return {
    d: `M${r1(s.x)} ${r1(s.y)} C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(e.x)} ${r1(e.y)}`,
    mid: { x: P.x, y: top },
    extent: [[P.x - spread, top], [P.x + spread, top]],
  };
}

function nearCurve(P, Q, bend, q, dist) {
  const C = control(P, Q, bend);
  for (let t = 0.1; t < 0.95; t += 0.05) {
    const x = (1 - t) ** 2 * P.x + 2 * (1 - t) * t * C.x + t ** 2 * Q.x;
    const y = (1 - t) ** 2 * P.y + 2 * (1 - t) * t * C.y + t ** 2 * Q.y;
    if (Math.hypot(x - q.x, y - q.y) < dist) return true;
  }
  return false;
}
