// Public surface of the engine. Runs unchanged in Node and the browser.

import { format as formatRat } from './rational.js';
import { formatOp, applyOp, affine, affineEq, affineInverse, isIdentity } from './ops.js';
import { loadPuzzle, inferMode, components, levelProblem } from './puzzle.js';
import { solveAll, firstDifference } from './solver.js';
import { humanTrace, difficulty, hint as hintFor } from './trace.js';
import { missingArrows, shortestRoad, fewestNew } from './draw.js';

export { loadPuzzle, inferMode } from './puzzle.js';
export { solve, solveAll } from './solver.js';
export { humanTrace, difficulty, deductions, candidatesFor, readBoard } from './trace.js';
export * as rational from './rational.js';
export * as ops from './ops.js';
export { missingArrows, shortestRoad, stepsLeft } from './draw.js';

const fmtSolution = (p, sol) => ({
  nodes: Object.fromEntries(p.nodes.map((n) => [n.id, formatRat(sol.vals.get(n.id))])),
  colors: Object.fromEntries(p.baseColors.map((c) => [c, formatOp(sol.ops.get(c))])),
  ...(p.hidden.length ? { recipes: Object.fromEntries(p.hidden.map((id) => [id, sol.recipes.get(id).join(' then ')])) } : {}),
});

const fmtStep = (s) => ({
  type: s.type,
  target: `${s.target.kind}:${s.target.id}`,
  value: s.target.kind === 'node' ? formatRat(s.value) : s.target.kind === 'recipe' ? s.value.join(' then ') : formatOp(s.value),
});

// The acceptance test every puzzle must pass before it reaches the library.
export function checkPuzzle(json) {
  const p = loadPuzzle(json);
  const errors = [...p.errors];
  const warnings = [];
  const report = (extra = {}) => ({
    ok: errors.length === 0,
    id: p.id,
    title: p.title,
    mode: inferMode(p),
    errors,
    warnings,
    ...extra,
  });
  if (errors.length) return report();

  for (const group of components(p)) {
    const anchored = group.some((id) => p.nodes.find((n) => n.id === id).given);
    const touched = p.arrows.some((a) => group.includes(a.from));
    if (!touched && group.length === 1) {
      // A road puzzle's lone dots are where the player's road goes.
      if (anchored) { if (!p.road) warnings.push({ code: 'isolated', message: `node "${group[0]}" has no arrows` }); }
      else errors.push({ code: 'unanchored', message: `node "${group[0]}" has no arrows and no value` });
    } else if (!anchored) {
      errors.push({ code: 'unanchored', message: `nodes ${group.map((g) => `"${g}"`).join(', ')} form a group with no given value, so they have infinitely many solutions` });
    }
  }
  const groups = components(p).filter((g) => g.length > 1 || p.arrows.some((a) => a.from === g[0]));
  if (groups.length > 1 && !p.road) {
    warnings.push({ code: 'disconnected', message: `the picture splits into ${groups.length} separate groups; connected pictures are preferred` });
  }
  for (const c of p.colors) {
    if (p.road?.colors.includes(c.id)) continue;
    if (!p.arrows.some((a) => a.color === c.id) && !p.colors.some((o) => o.composite?.includes(c.id))) {
      warnings.push({ code: 'unused-color', message: `color "${c.id}" is never used` });
    }
  }
  if (p.declaredMode && p.declaredMode !== inferMode(p)) {
    warnings.push({ code: 'mode', message: `declared mode "${p.declaredMode}" but the content makes it "${inferMode(p)}"` });
  }
  if (errors.length) return report();

  const result = solveAll(p);
  if (result.status === 'none') {
    errors.push({ code: 'no-solution', message: 'no assignment satisfies every arrow' });
  } else if (result.status === 'multiple') {
    const [s1, s2] = result.solutions;
    const d = firstDifference(p, s1, s2);
    const show = (s) => (d.kind === 'recipe' ? s.recipes.get(d.id).join(' then ') : d.kind === 'color' ? formatOp(s.ops.get(d.id)) : formatRat(s.vals.get(d.id)));
    errors.push({ code: 'multiple-solutions', message: `more than one solution: ${d.kind} "${d.id}" could be ${show(s1)} or ${show(s2)}` });
  } else if (result.status === 'underdetermined') {
    errors.push({ code: 'unanchored', message: 'some values are never forced, so there are infinitely many solutions' });
  } else if (result.status === 'budget') {
    errors.push({ code: 'too-large', message: `search exceeded its budget after ${result.visited} states` });
  }
  if (errors.length) return report({ searchStates: result.visited });

  const sol = result.solutions[0];

  // Every number the solver works with must suit the fraction level: each
  // dot, and the hidden middle numbers of a combined arrow.
  for (const n of p.nodes) {
    const v = sol.vals.get(n.id);
    const level = levelProblem(v, p.config);
    if (level) errors.push({ code: 'fraction-level', message: `dot "${n.id}" works out to ${formatRat(v)}; ${level}` });
  }
  for (const a of p.arrows) {
    if (!a.chain || a.chain.length < 2) continue;
    let v = sol.vals.get(a.from);
    for (const c of a.chain.slice(0, -1)) {
      v = applyOp(sol.ops.get(c), v);
      const level = levelProblem(v, p.config);
      if (level) {
        errors.push({ code: 'fraction-level', message: `the ${a.color} arrow from "${a.from}" passes through ${formatRat(v)} after ${c}; ${level}` });
        break;
      }
    }
  }
  if (errors.length) return report({ searchStates: result.visited });

  // Two colors that do the same thing, or where one just undoes the other,
  // add arrows without adding anything to work out.
  const describe = (c) => {
    const col = p.colorById.get(c.id);
    const chain = (col.composite ? p.arrows.find((a) => a.color === c.id)?.chain : [c.id]) || null;
    return chain ? { id: c.id, chain, f: affine(chain.map((x) => sol.ops.get(x))), words: chain.map((x) => formatOp(sol.ops.get(x))).join(' then ') } : null;
  };
  const effects = p.colors.map(describe).filter(Boolean);
  for (const e of effects) {
    if (isIdentity(e.f)) warnings.push({ code: 'redundant-colors', message: `${e.id} (${e.words}) leaves every number unchanged` });
  }
  for (let i = 0; i < effects.length; i++) {
    for (let j = i + 1; j < effects.length; j++) {
      const [x, y] = [effects[i], effects[j]];
      if (affineEq(x.f, y.f)) {
        warnings.push({ code: 'redundant-colors', message: `${x.id} (${x.words}) and ${y.id} (${y.words}) do the same thing` });
      } else if (affineEq(x.f, affineInverse(y.f))) {
        warnings.push({ code: 'redundant-colors', message: `${y.id} (${y.words}) just undoes ${x.id} (${x.words}); an arrow the other way says the same thing` });
      }
    }
  }

  const trace = humanTrace(p, sol);
  // Two-arrow rule: a puzzle must not depend on assuming a color is one
  // whole-number step, which is what settling it from one arrow requires.
  for (const g of trace.guesses.filter((x) => x.reason === 'one-arrow')) {
    errors.push({ code: 'needs-two-arrows', message: `"${g.target.id}" is only settled by assuming it is one simple step; it needs two of its arrows, from different numbers, with both ends known` });
  }
  if (errors.length) return report({ searchStates: result.visited });
  if (trace.guesses.length) {
    warnings.push({ code: 'case-split', message: `not solvable by forced steps alone: needs ${trace.guesses.length} hypothesis(es) about ${trace.guesses.map((g) => `"${g.target.id}"`).join(', ')}` });
  }
  const extra = drawInfo(p, sol);
  if (extra.error) errors.push(extra.error);
  if (errors.length) return report({ searchStates: result.visited });
  return report({
    solution: fmtSolution(p, sol),
    ...(extra.draw ? { draw: extra.draw } : {}),
    ...(extra.road ? { road: extra.road } : {}),
    difficulty: difficulty(p, trace, sol, extra),
    trace: trace.rounds.map((r) => r.map(fmtStep)),
    searchStates: result.visited,
  });
}

// What a drawing puzzle asks for: the missing arrows, or the shortest road.
function drawInfo(p, sol) {
  if (p.draw) {
    const missing = missingArrows(p, sol, p.draw.color);
    if (!missing.length) return { error: { code: 'nothing-to-draw', message: `no ${p.draw.color} arrow is missing` } };
    return { draw: { color: p.draw.color, missing } };
  }
  if (p.road) {
    // The shortest road goes stop to stop, and may take arrows already in
    // the picture as well as new ones of the road's colors.
    const val = (id) => sol.vals.get(id);
    const colorOps = p.road.colors.map((c) => sol.ops.get(c));
    const jumps = p.arrows.map((a) => [val(a.from), val(a.to)]);
    const stops = [p.road.from, ...p.road.via, p.road.to];
    const road = { best: 0, toDraw: 0, ways: 1, detour: false, belowZero: false };
    for (let i = 0; i + 1 < stops.length; i++) {
      const seg = shortestRoad(val(stops[i]), val(stops[i + 1]), colorOps, p.config, { jumps });
      if (!seg) return { error: { code: 'no-road', message: `no road joins "${stops[i]}" to "${stops[i + 1]}" with these colors` } };
      road.best += seg.best;
      road.toDraw += fewestNew(val(stops[i]), val(stops[i + 1]), colorOps, p.config, jumps);
      road.ways *= seg.ways;
      road.detour ||= seg.detour;
      road.belowZero ||= seg.belowZero;
    }
    if (road.best < 2) return { error: { code: 'road-too-short', message: 'a single arrow joins the two dots' } };
    const scales = colorOps.some((op) => ['*', '/'].includes(op.kind));
    return { road: { ...road, colors: p.road.colors.length, scales, stops: stops.length } };
  }
  return {};
}

// Solve once and keep what the UI needs: the loaded puzzle, the solution,
// and a hint function bound to both.
export function prepare(json) {
  const p = loadPuzzle(json);
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join('; '));
  const result = solveAll(p);
  if (result.status !== 'unique') throw new Error(`puzzle is not uniquely solvable (${result.status})`);
  const solution = result.solutions[0];
  return { puzzle: p, solution, ...drawInfo(p, solution), hint: (board) => hintFor(p, solution, board) };
}
