// Puzzles where the player draws arrows, after the CSMP activities: "draw all
// the missing yellow arrows" in a finished picture, and "build a road" from
// one number to another with given colors of arrow.

import { eq, format as formatRat } from './rational.js';
import { applyOp } from './ops.js';
import { inDomain, levelProblem } from './puzzle.js';

// Every arrow of `color` that is true between two dots and not yet drawn.
export function missingArrows(p, sol, color, drawn = []) {
  const op = sol.ops.get(color);
  const have = new Set([...p.arrows, ...drawn].filter((a) => a.color === color).map((a) => `${a.from}>${a.to}`));
  const out = [];
  for (const u of p.nodes) {
    let w;
    try { w = applyOp(op, sol.vals.get(u.id)); } catch { continue; }
    for (const v of p.nodes) {
      if (v.id !== u.id && eq(w, sol.vals.get(v.id)) && !have.has(`${u.id}>${v.id}`)) out.push({ from: u.id, to: v.id, color });
    }
  }
  return out;
}

// A number a road may pass through: inside the puzzle's range and its
// fraction level.
const allowed = (v, config) => inDomain(v, config) && !levelProblem(v, config);

// Breadth-first over numbers. dist maps a number's key to its distance from
// the start, and ways counts the shortest roads that reach it. `jumps` are
// arrows already drawn, as [from, to] number pairs, which a road may follow.
function spread(start, colorOps, config, { maxDepth = 14, keep = () => true, jumps = [] } = {}) {
  const key = formatRat;
  const dist = new Map([[key(start), 0]]);
  const ways = new Map([[key(start), 1]]);
  const vals = new Map([[key(start), start]]);
  let layer = [start];
  for (let d = 1; d <= maxDepth && layer.length; d++) {
    const next = [];
    for (const v of layer) {
      const steps = [...colorOps.map((op) => () => applyOp(op, v)), ...jumps.filter(([a]) => eq(a, v)).map(([, b]) => () => b)];
      for (const step of steps) {
        let w;
        try { w = step(); } catch { continue; }
        if (!allowed(w, config) || !keep(w)) continue;
        const k = key(w);
        if (!dist.has(k)) { dist.set(k, d); ways.set(k, 0); vals.set(k, w); next.push(w); }
        if (dist.get(k) === d) ways.set(k, ways.get(k) + ways.get(key(v)));
      }
    }
    layer = next;
  }
  return { dist, ways, vals };
}

// The fewest arrows from `from` to `to` using the given ops, how many roads
// that short there are, and whether every one of them has to leave the
// stretch between the two numbers, or pass below zero, to be that short.
export function shortestRoad(from, to, colorOps, config, opts = {}) {
  const all = spread(from, colorOps, config, opts);
  const best = all.dist.get(formatRat(to));
  if (best === undefined) return null;
  const [lo, hi] = from.n * to.d <= to.n * from.d ? [from, to] : [to, from];
  const inside = (v) => v.n * lo.d >= lo.n * v.d && v.n * hi.d <= hi.n * v.d;
  const within = spread(from, colorOps, config, { ...opts, keep: inside }).dist.get(formatRat(to));
  const nonneg = spread(from, colorOps, config, { ...opts, keep: (v) => v.n >= 0 }).dist.get(formatRat(to));
  return {
    best,
    ways: all.ways.get(formatRat(to)),
    detour: within === undefined || within > best,
    belowZero: nonneg === undefined || nonneg > best,
  };
}

// The fewest new arrows a road needs when arrows already in the picture
// (`jumps`) are free to follow: a breadth-first search where a jump costs
// nothing.
export function fewestNew(from, to, colorOps, config, jumps = [], maxNew = 14) {
  const key = formatRat;
  const cost = new Map([[key(from), 0]]);
  const deque = [from];
  while (deque.length) {
    const v = deque.shift();
    const c = cost.get(key(v));
    if (eq(v, to)) return c;
    const moves = [
      ...jumps.filter(([a]) => eq(a, v)).map(([, b]) => [b, 0]),
      ...colorOps.map((op) => { try { return [applyOp(op, v), 1]; } catch { return null; } }).filter(Boolean),
    ];
    for (const [w, step] of moves) {
      if (!allowed(w, config) || c + step > maxNew) continue;
      const k = key(w);
      if (cost.has(k) && cost.get(k) <= c + step) continue;
      cost.set(k, c + step);
      if (step === 0) deque.unshift(w); else deque.push(w);
    }
  }
  return null;
}

// How many more arrows from each number it takes to reach `to`, for hints.
export function stepsLeft(to, colorOps, config, maxDepth = 14) {
  const key = formatRat;
  const left = new Map([[key(to), 0]]);
  return (v) => {
    const k = key(v);
    if (left.has(k)) return left.get(k);
    const road = shortestRoad(v, to, colorOps, config, { maxDepth });
    const n = road ? road.best : Infinity;
    left.set(k, n);
    return n;
  };
}
