// Load a puzzle from its JSON contract into the engine's normalized form,
// collecting structural errors rather than throwing on the first one.

import { parse as parseRat, format as formatRat } from './rational.js';
import { parseOp, family, KINDS } from './ops.js';

export const DEFAULT_CONFIG = Object.freeze({
  kinds: KINDS,
  kMax: 12,
  kDens: [1],
  maxDen: 12,
  maxAbs: 999,
  // Which fractions a puzzle may use, as a level: 'none'; 'proper', meaning
  // only fractions between -1 and 1; or 'any'.
  fractions: 'proper',
});

export function loadPuzzle(json) {
  const errors = [];
  const err = (code, message) => errors.push({ code, message });

  const config = { ...DEFAULT_CONFIG, ...(json.ops || {}) };

  const nodes = [];
  const nodeIds = new Set();
  for (const raw of json.nodes || []) {
    if (!raw.id) { err('node-id', 'a node is missing its id'); continue; }
    if (nodeIds.has(raw.id)) err('node-dup', `node "${raw.id}" is declared twice`);
    nodeIds.add(raw.id);
    let given = null;
    if (raw.value !== undefined && raw.value !== null) {
      try {
        given = parseRat(raw.value);
        if (!inDomain(given, config)) err('node-domain', `node "${raw.id}" value ${formatRat(given)} is outside the allowed range`);
        const level = levelProblem(given, config);
        if (level) err('fraction-level', `node "${raw.id}" is ${formatRat(given)}; ${level}`);
      } catch (e) {
        err('node-value', `node "${raw.id}": ${e.message}`);
      }
    }
    // A road puzzle may place its dots on the grid: "at": [column, row].
    nodes.push({ id: raw.id, given, at: Array.isArray(raw.at) ? raw.at : null });
  }

  const colors = [];
  const colorIds = new Set();
  for (const raw of json.colors || []) {
    if (!raw.id) { err('color-id', 'a color is missing its id'); continue; }
    if (colorIds.has(raw.id)) err('color-dup', `color "${raw.id}" is declared twice`);
    colorIds.add(raw.id);
    if (raw.composite && raw.op) err('color-both', `color "${raw.id}" has both an op and a composite`);
    let op = null;
    if (raw.op) {
      try { op = parseOp(raw.op); } catch (e) { err('color-op', `color "${raw.id}": ${e.message}`); }
    }
    // A hidden composite keeps its recipe secret: the player picks its parts.
    colors.push({ id: raw.id, op, composite: raw.composite || null, hidden: !!(raw.composite && raw.hidden), label: raw.label || raw.id });
  }

  // Composites expand to a sequence of base colors; reject unknown parts and cycles.
  const byId = new Map(colors.map((c) => [c.id, c]));
  const expanded = new Map();
  const broken = new Set();
  const expand = (id, stack) => {
    if (expanded.has(id)) return expanded.get(id);
    if (broken.has(id)) return null;
    const c = byId.get(id);
    if (!c) return null;
    if (!c.composite) return [id];
    if (stack.includes(id)) {
      const cycle = stack.slice(stack.indexOf(id));
      err('composite-cycle', `composite cycle: ${[...cycle, id].join(' → ')}`);
      cycle.forEach((c) => broken.add(c));
      return null;
    }
    if (!Array.isArray(c.composite) || c.composite.length < 2) {
      err('composite-shape', `composite "${id}" must chain at least two colors`);
      return null;
    }
    const seq = [];
    for (const part of c.composite) {
      if (!byId.has(part)) { err('composite-ref', `composite "${id}" references unknown color "${part}"`); return null; }
      const sub = expand(part, [...stack, id]);
      if (!sub) return null;
      seq.push(...sub);
    }
    expanded.set(id, seq);
    return seq;
  };
  for (const c of colors) {
    const seq = expand(c.id, []);
    if (seq) expanded.set(c.id, seq);
  }
  // The recipe of a hidden composite is chosen from the plain colors, so its
  // parts must be plain colors, and no other composite may be built on it.
  for (const c of colors) {
    if (!c.composite) continue;
    for (const part of c.composite) {
      const sub = byId.get(part);
      if (c.hidden && sub?.composite) err('hidden-composite', `hidden composite "${c.id}" may only use plain colors, not "${part}"`);
      if (sub?.hidden) err('hidden-composite', `composite "${c.id}" is built on hidden composite "${part}"`);
    }
  }

  const arrows = [];
  (json.arrows || []).forEach((raw, i) => {
    const id = raw.id || `e${i}`;
    if (!nodeIds.has(raw.from)) err('arrow-ref', `arrow ${id} starts at unknown node "${raw.from}"`);
    if (!nodeIds.has(raw.to)) err('arrow-ref', `arrow ${id} ends at unknown node "${raw.to}"`);
    if (!colorIds.has(raw.color)) err('arrow-ref', `arrow ${id} has unknown color "${raw.color}"`);
    arrows.push({ id, from: raw.from, to: raw.to, color: raw.color, chain: expanded.get(raw.color) || null, hidden: !!byId.get(raw.color)?.hidden });
  });

  const baseColors = colors.filter((c) => !c.composite);
  const mystery = baseColors.filter((c) => !c.op).map((c) => c.id);

  // Drawing puzzles. "draw": the player adds every missing arrow of one
  // color. "road": the player builds a road from one dot to another,
  // through any checkpoint dots ("via") in order. The road may use arrows
  // already in the picture, and its dots may be blanks to work out first.
  let draw = null;
  if (json.draw) {
    const c = byId.get(json.draw.color);
    if (!c || c.composite) err('draw-color', `draw color "${json.draw.color}" must be a plain color of this puzzle`);
    else draw = { color: c.id };
  }
  let road = null;
  if (json.road) {
    const { from, to, via = [], colors: use = [] } = json.road;
    const stops = [from, ...via, to];
    if (stops.some((id) => !nodeIds.has(id))) err('road-ends', 'a road’s start, checkpoints and end must be dots of the puzzle');
    else if (new Set(stops).size !== stops.length) err('road-ends', 'a road’s start, checkpoints and end must all be different dots');
    else if (!use.length || use.some((id) => !byId.get(id) || byId.get(id).composite)) err('road-colors', 'a road is built from plain colors');
    else road = { from, to, via: [...via], colors: [...use] };
    if (draw) err('draw-kind', 'a puzzle can ask for missing arrows or a road, not both');
  }

  return {
    id: json.id || null,
    title: json.title || null,
    declaredMode: json.mode || null,
    config,
    family: family(config),
    nodes,
    colors,
    colorById: byId,
    baseColors: baseColors.map((c) => c.id),
    mystery,
    hidden: colors.filter((c) => c.hidden).map((c) => c.id),
    arrows,
    draw,
    road,
    errors,
  };
}

export function inDomain(v, config) {
  return v.d <= config.maxDen && Math.abs(v.n) <= config.maxAbs * v.d;
}

// Whether a value suits the puzzle's fraction level. This shapes which
// puzzles get made; the solver never uses it to rule anything out, so no
// puzzle can depend on a player knowing it.
export function levelProblem(v, config) {
  if (v.d === 1) return null;
  if (config.fractions === 'none') return 'this level uses no fractions';
  if (config.fractions === 'proper' && Math.abs(v.n) >= v.d) return 'this level only uses fractions between \u22121 and 1';
  return null;
}

// What the puzzle asks for, judged from its content rather than its label.
export function inferMode(p) {
  const blanks = p.nodes.some((n) => !n.given);
  const rules = p.mystery.length > 0 || p.hidden.length > 0;
  if (blanks && rules) return 'mixed';
  if (rules) return 'find-rules';
  return 'find-values';
}

// Every recipe a player could pick for a hidden composite: each slot is any
// plain color, repeats allowed.
export function recipeChoices(p, id) {
  let out = [[]];
  for (let i = 0; i < p.colorById.get(id).composite.length; i++) {
    out = out.flatMap((r) => p.baseColors.map((c) => [...r, c]));
  }
  return out;
}

// Connected components over arrows, ignoring direction.
export function components(p) {
  const parent = new Map(p.nodes.map((n) => [n.id, n.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const a of p.arrows) {
    if (parent.has(a.from) && parent.has(a.to)) parent.set(find(a.from), find(a.to));
  }
  const groups = new Map();
  for (const n of p.nodes) {
    const r = find(n.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n.id);
  }
  return [...groups.values()];
}
