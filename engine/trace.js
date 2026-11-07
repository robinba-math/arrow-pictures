// The human-style solver. Unlike solve(), it never searches: it makes only the
// deductions a person would, one round at a time. Its trace is the difficulty
// measurement, and its next available step on any board is the hint.

import { eq, format as formatRat } from './rational.js';
import { applyChain, invertChain, applyOp, inverseOp, opEq, formatOp, parseOp } from './ops.js';
import { rat, add, sub, mul, div } from './rational.js';
import { parse as parseRat } from './rational.js';
import { inDomain, recipeChoices } from './puzzle.js';

// Easiest first. Hints offer the easiest available step.
const PRIORITY = ['forward', 'backward', 'composite-forward', 'composite-backward', 'pin', 'composite-pin', 'recipe', 'guess'];

const pv = (v) => formatRat(v).replace('-', '−');
const po = (op) => formatOp(op, { pretty: true });

function safe(fn) {
  try { return fn(); } catch { return null; }
}

// The colors an arrow runs through, as far as the player knows: a hidden
// composite's arrows have no chain until its recipe is worked out.
const chainOf = (arrow, know) => (arrow.hidden ? know.recipes.get(arrow.color) || null : arrow.chain);

// What can be concluded about `color` from arrows where it is the only
// unknown and both ends are known. `direct` arrows carry the color alone;
// `chained` arrows carry it once inside a combined arrow, and are reduced to
// the step the color itself makes by undoing the known parts.
//
// Two-arrow rule: any mix of adding, subtracting, multiplying and dividing
// comes out as x -> m*x + c, so two arrows from different numbers fix the
// color completely, whether it is one step or several, whole numbers or not.
// With fewer than two, the result is null: nothing is settled, however few
// simple rules happen to fit. So no puzzle relies on "each color is one
// whole-number step".
//
// `bounded` uses the puzzle's finite rule family instead, which is only for
// detecting puzzles that would need that assumption.
export function candidatesFor(p, know, color, { bounded = false } = {}) {
  const direct = [];
  const chained = [];
  for (const arrow of p.arrows) {
    const chain = chainOf(arrow, know);
    if (!chain || !chain.includes(color)) continue;
    const a = know.vals.get(arrow.from);
    const b = know.vals.get(arrow.to);
    if (!a || !b) continue;
    if (chain.some((c) => c !== color && !know.ops.has(c))) continue;
    if (chain.length === 1) direct.push(arrow);
    else if (chain.filter((c) => c === color).length === 1) chained.push(arrow);
  }

  // Reduce a chained arrow to the step the color itself must make.
  const ends = (arrow) => safe(() => {
    const chain = chainOf(arrow, know);
    const i = chain.indexOf(color);
    const before = chain.slice(0, i).map((c) => know.ops.get(c));
    const after = chain.slice(i + 1).map((c) => know.ops.get(c));
    return [applyChain(before, know.vals.get(arrow.from)), invertChain(after, know.vals.get(arrow.to))];
  });

  if (bounded) {
    const fits = (op, arrow) => {
      const e = chainOf(arrow, know).length === 1 ? [know.vals.get(arrow.from), know.vals.get(arrow.to)] : ends(arrow);
      return !!e && safe(() => eq(applyOp(op, e[0]), e[1]));
    };
    const afterDirect = p.family.filter((op) => direct.every((arrow) => fits(op, arrow)));
    const afterAll = afterDirect.filter((op) => chained.every((arrow) => fits(op, arrow)));
    return { direct, chained, afterDirect, afterAll };
  }

  const directPoints = direct.map((arrow) => [know.vals.get(arrow.from), know.vals.get(arrow.to)]);
  const chainedPoints = chained.map(ends).filter(Boolean);
  return {
    direct,
    chained,
    afterDirect: settle(directPoints),
    afterAll: settle([...directPoints, ...chainedPoints]),
  };
}

// From (start, end) pairs: null if fewer than two distinct starts; otherwise
// the one rule that fits them all, or [] if none does.
function settle(points) {
  const distinct = [];
  for (const [x, y] of points) if (!distinct.some(([u]) => eq(u, x))) distinct.push([x, y]);
  if (distinct.length < 2) return null;
  const [[x1, y1], [x2, y2]] = distinct;
  const m = div(sub(y2, y1), sub(x2, x1));
  const c = sub(y1, mul(m, x1));
  if (!points.every(([x, y]) => eq(add(mul(m, x), c), y))) return [];
  const op = simpleRule(m, c);
  return op ? [op] : [];
}

// Read "multiply by m, then add c" back as one simple rule, if it is one.
function simpleRule(m, c) {
  const one = eq(m, rat(1));
  if (one && c.n > 0) return Object.freeze({ kind: '+', k: c });
  if (one && c.n < 0) return Object.freeze({ kind: '-', k: rat(-c.n, c.d) });
  if (c.n !== 0 || m.n <= 0 || one) return null;
  if (m.d === 1) return Object.freeze({ kind: '*', k: m });
  if (m.n === 1) return Object.freeze({ kind: '/', k: rat(m.d) });
  return null;
}

const count = (cands) => (cands === null ? Infinity : cands.length);

// Every step a person could take right now, easiest first.
export function deductions(p, know) {
  const out = [];
  const claimed = new Set();
  for (const arrow of p.arrows) {
    const chain = chainOf(arrow, know);
    if (!chain || chain.some((c) => !know.ops.has(c))) continue;
    const ops = chain.map((c) => know.ops.get(c));
    const composite = chain.length > 1;
    const a = know.vals.get(arrow.from);
    const b = know.vals.get(arrow.to);
    if (a && !b && !claimed.has(arrow.to)) {
      const v = safe(() => applyChain(ops, a));
      if (v && inDomain(v, p.config)) {
        out.push({ type: composite ? 'composite-forward' : 'forward', target: { kind: 'node', id: arrow.to }, value: v, arrow: arrow.id, color: arrow.color, from: a });
        claimed.add(arrow.to);
      }
    } else if (b && !a && !claimed.has(arrow.from)) {
      const v = safe(() => invertChain(ops, b));
      if (v && inDomain(v, p.config)) {
        out.push({ type: composite ? 'composite-backward' : 'backward', target: { kind: 'node', id: arrow.from }, value: v, arrow: arrow.id, color: arrow.color, to: b });
        claimed.add(arrow.from);
      }
    }
  }
  for (const color of p.mystery) {
    if (know.ops.has(color)) continue;
    const { direct, chained, afterDirect, afterAll } = candidatesFor(p, know, color);
    if (direct.length > 0 && afterDirect?.length === 1) {
      out.push({ type: 'pin', target: { kind: 'color', id: color }, value: afterDirect[0], arrows: direct.map((a) => a.id) });
    } else if (chained.length > 0 && afterAll?.length === 1) {
      out.push({ type: 'composite-pin', target: { kind: 'color', id: color }, value: afterAll[0], arrows: [...direct, ...chained].map((a) => a.id) });
    }
  }
  // A hidden recipe is settled when exactly one choice fits every one of its
  // arrows with both ends known. A choice using a color not yet worked out
  // can't be ruled out, so it still counts as possible.
  for (const id of p.hidden) {
    if (know.recipes.has(id)) continue;
    const arrows = p.arrows.filter((a) => a.color === id && know.vals.has(a.from) && know.vals.has(a.to));
    if (!arrows.length) continue;
    const fits = (r) => r.some((c) => !know.ops.has(c)) || arrows.every((a) =>
      safe(() => eq(applyChain(r.map((c) => know.ops.get(c)), know.vals.get(a.from)), know.vals.get(a.to))));
    const left = recipeChoices(p, id).filter(fits);
    if (left.length === 1 && left[0].every((c) => know.ops.has(c))) {
      out.push({ type: 'recipe', target: { kind: 'recipe', id }, value: left[0], arrows: arrows.map((a) => a.id) });
    }
  }
  out.sort((x, y) => PRIORITY.indexOf(x.type) - PRIORITY.indexOf(y.type));
  return out;
}

const isComplete = (p, know) =>
  p.nodes.every((n) => know.vals.has(n.id)) && p.mystery.every((c) => know.ops.has(c)) && p.hidden.every((id) => know.recipes.has(id));

function applyStep(know, step) {
  if (step.target.kind === 'node') know.vals.set(step.target.id, step.value);
  else if (step.target.kind === 'recipe') know.recipes.set(step.target.id, step.value);
  else know.ops.set(step.target.id, step.value);
}

export function givenKnowledge(p) {
  const vals = new Map();
  for (const n of p.nodes) if (n.given) vals.set(n.id, n.given);
  const ops = new Map();
  for (const id of p.baseColors) {
    const c = p.colorById.get(id);
    if (c.op) ops.set(id, c.op);
  }
  return { vals, ops, recipes: new Map() };
}

// Solve the way a person would, round by round. When no step is forced, take
// the solution's rule for the most constrained mystery color and record it
// as a case split: a person would have to hypothesise there.
export function humanTrace(p, solution) {
  const know = givenKnowledge(p);
  const rounds = [];
  const guesses = [];
  for (let safety = 0; safety < 500; safety++) {
    const ds = deductions(p, know);
    if (ds.length > 0) {
      rounds.push(ds);
      for (const step of ds) applyStep(know, step);
      continue;
    }
    if (isComplete(p, know)) break;
    const open = p.mystery.filter((c) => !know.ops.has(c));
    const openRecipes = p.hidden.filter((id) => !know.recipes.has(id));
    if (open.length === 0 && openRecipes.length === 0) break; // blanks with no anchor; validity reports it
    if (open.length === 0) {
      // Every rule is known but a recipe is not: try the choices one by one.
      const id = openRecipes[0];
      const step = { type: 'guess', reason: 'hypothesis', target: { kind: 'recipe', id }, value: solution.recipes.get(id), candidates: recipeChoices(p, id).length };
      guesses.push(step);
      rounds.push([step]);
      applyStep(know, step);
      continue;
    }
    // Stuck. If the finite rule family would have settled a color here, the
    // puzzle only works for someone who knows the size limit on rules.
    let rangeStep = null;
    for (const c of open) {
      const limited = candidatesFor(p, know, c, { bounded: true }).afterAll;
      const free = candidatesFor(p, know, c).afterAll;
      if (limited.length === 1 && count(free) > 1) {
        // Settled only by assuming red is one whole-number step: almost
        // always because only one red arrow has both ends known.
        rangeStep = { type: 'guess', reason: 'one-arrow', target: { kind: 'color', id: c }, value: solution.ops.get(c), candidates: count(free) };
        break;
      }
    }
    if (rangeStep) {
      guesses.push(rangeStep);
      rounds.push([rangeStep]);
      applyStep(know, rangeStep);
      continue;
    }
    const ranked = open
      .map((c) => ({ color: c, n: count(candidatesFor(p, know, c).afterAll) }))
      .sort((x, y) => x.n - y.n);
    const pick = ranked[0];
    const step = { type: 'guess', reason: 'hypothesis', target: { kind: 'color', id: pick.color }, value: solution.ops.get(pick.color), candidates: pick.n };
    guesses.push(step);
    rounds.push([step]);
    applyStep(know, step);
  }
  return { rounds, guesses, complete: isComplete(p, know) };
}

// Six signals from the trace, plus a 1-5 rating that maps off them. The
// weights are a starting point, to be tuned against real solves.
export function difficulty(p, trace, solution, extra = {}) {
  const steps = trace.rounds.flat();
  const widths = trace.rounds.map((r) => r.length);
  const count = (...types) => steps.filter((s) => types.includes(s.type)).length;
  const blanks = p.nodes.filter((n) => !n.given).map((n) => solution.vals.get(n.id));

  const signals = {
    chainDepth: trace.rounds.length,
    frontier: {
      min: widths.length ? Math.min(...widths) : 0,
      mean: widths.length ? +(widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(2) : 0,
      narrowRounds: widths.filter((w) => w === 1).length,
    },
    backwardSteps: count('backward', 'composite-backward'),
    compositeSteps: count('composite-forward', 'composite-backward', 'composite-pin'),
    recipes: count('recipe'),
    pins: count('pin', 'composite-pin'),
    caseSplits: trace.guesses.length,
    arithmetic: {
      maxAbs: blanks.length ? Math.max(...blanks.map((v) => Math.abs(v.n / v.d))) : 0,
      negatives: blanks.filter((v) => v.n < 0).length,
      fractions: blanks.filter((v) => v.d > 1).length,
    },
  };

  const s = signals;
  const score =
    0.5 * s.chainDepth +
    0.4 * s.frontier.narrowRounds +
    0.6 * s.backwardSteps +
    0.8 * s.compositeSteps +
    1.0 * s.pins +
    1.5 * s.recipes +
    3.0 * s.caseSplits +
    (s.arithmetic.fractions > 0 ? 0.8 : 0) +
    (s.arithmetic.negatives > 0 ? 0.4 : 0) +
    (s.arithmetic.maxAbs > 50 ? 0.5 : 0) +
    drawScore(p, extra);
  if (extra.draw) signals.missingArrows = extra.draw.missing.length;
  if (extra.road) signals.road = extra.road;
  const rating = score < 3 ? 1 : score < 6 ? 2 : score < 10 ? 3 : score < 15 ? 4 : 5;
  return { rating, score: +score.toFixed(2), signals };
}

// Finding every missing arrow means checking the pairs of dots; building a
// road means planning the arrows still to draw, and a road that must swing wide or dip below zero
// to be shortest takes more thought.
function drawScore(p, { draw, road }) {
  if (draw) return 0.7 * draw.missing.length + 0.08 * p.nodes.length;
  if (road) return 0.9 * road.toDraw + (road.detour ? 2.5 : 0) + (road.belowZero ? 3 : 0) + (road.colors > 2 ? 1.5 : 0) + (road.scales ? 2 : 0);
  return 0;
}

// ---- Hints ---------------------------------------------------------------

const label = (p, colorId) => p.colorById.get(colorId)?.label || colorId;
const chainWords = (p, chain) => chain.map((c) => label(p, c)).join(' then ');

// "12 − 2 = 10": one operation written out as arithmetic.
const SYM = { '+': '+', '-': '\u2212', '*': '\u00d7', '/': '\u00f7' };
const sum = (op, v) => `${pv(v)} ${SYM[op.kind]} ${pv(op.k)} = ${pv(applyOp(op, v))}`;

// Each step of a chain written out, forwards or undone from the far end.
function workForward(ops, v) {
  const lines = [];
  for (const op of ops) { lines.push(sum(op, v)); v = applyOp(op, v); }
  return lines.join(', then ');
}
function workBackward(ops, v) {
  const lines = [];
  for (const op of [...ops].reverse()) { const inv = inverseOp(op); lines.push(sum(inv, v)); v = applyOp(inv, v); }
  return lines.join(', then ');
}

// A board is the player's entries: {values: {nodeId: "3/4"}, rules: {colorId: "+3"}}.
// Entries that disagree with the unique solution are reported, never used.
export function readBoard(p, solution, board = {}) {
  const know = givenKnowledge(p);
  const wrong = [];
  for (const [id, raw] of Object.entries(board.values || {})) {
    const node = p.nodes.find((n) => n.id === id);
    if (!node || node.given || raw === '' || raw === null || raw === undefined) continue;
    const v = safe(() => parseRat(raw));
    if (!v) wrong.push({ kind: 'node', id, reason: 'unreadable', entered: raw });
    else if (!eq(v, solution.vals.get(id))) wrong.push({ kind: 'node', id, reason: 'incorrect', entered: raw });
    else know.vals.set(id, v);
  }
  for (const [id, raw] of Object.entries(board.rules || {})) {
    if (!p.mystery.includes(id) || raw === '' || raw === null || raw === undefined) continue;
    const op = safe(() => parseOp(raw));
    if (!op) wrong.push({ kind: 'color', id, reason: 'unreadable', entered: raw });
    else if (!opEq(op, solution.ops.get(id))) wrong.push({ kind: 'color', id, reason: 'incorrect', entered: raw });
    else know.ops.set(id, op);
  }
  // A recipe is read once every slot is chosen.
  for (const [id, parts] of Object.entries(board.recipes || {})) {
    if (!p.hidden.includes(id) || !Array.isArray(parts)) continue;
    if (parts.length !== p.colorById.get(id).composite.length || parts.some((c) => !c)) continue;
    if (parts.join() !== solution.recipes.get(id).join()) wrong.push({ kind: 'recipe', id, reason: 'incorrect', entered: parts });
    else know.recipes.set(id, parts);
  }
  return { know, wrong };
}

// The next hint for this board: three levels of the same step.
export function hint(p, solution, board = {}) {
  const { know, wrong } = readBoard(p, solution, board);
  if (isComplete(p, know) && wrong.length === 0) return { done: true, wrong };

  const ds = deductions(p, know);
  const arrowById = new Map(p.arrows.map((a) => [a.id, a]));
  let step;
  let levels;

  if (ds.length === 0) {
    const open = p.mystery.filter((c) => !know.ops.has(c));
    const openRecipe = p.hidden.find((id) => !know.recipes.has(id));
    if (open.length === 0 && openRecipe) {
      const L = label(p, openRecipe);
      step = { type: 'guess', target: { kind: 'recipe', id: openRecipe }, value: solution.recipes.get(openRecipe) };
      levels = {
        where: `Look at the ${L} arrows.`,
        how: `Nothing is forced yet. Pick a choice for ${L}, follow it, and see whether the numbers stay consistent.`,
        what: `${L} means ${chainWords(p, step.value)}.`,
      };
    } else if (open.length === 0) {
      // Only reachable when the player's correct entries are fewer than the
      // givens imply; fall back to revealing a blank.
      const blank = p.nodes.find((n) => !know.vals.has(n.id));
      step = { type: 'reveal', target: { kind: 'node', id: blank.id }, value: solution.vals.get(blank.id) };
      levels = {
        where: 'Look for a dot you have not filled in yet.',
        how: 'Follow any arrow whose rule you know from a dot you know.',
        what: `This dot is ${pv(step.value)}.`,
      };
    } else {
      const ranked = open
        .map((c) => ({ color: c, n: count(candidatesFor(p, know, c).afterAll) }))
        .sort((x, y) => x.n - y.n);
      const { color, n } = ranked[0];
      step = { type: 'guess', target: { kind: 'color', id: color }, value: solution.ops.get(color), candidates: n };
      levels = {
        where: `Look at the ${label(p, color)} arrows.`,
        how: `Nothing is forced yet. ${n === Infinity ? 'Many' : n} rules still fit the ${label(p, color)} arrows; pick one, follow it, and see whether the numbers stay consistent.`,
        what: `The ${label(p, color)} rule is ${po(step.value)}.`,
      };
    }
    return { done: false, wrong, step, levels };
  }

  step = ds[0];
  const arrow = step.arrow ? arrowById.get(step.arrow) : null;
  const L = arrow ? label(p, arrow.color) : label(p, step.target.id);
  switch (step.type) {
    case 'forward': {
      const op = know.ops.get(chainOf(arrow, know)[0]);
      levels = {
        where: `Look at the ${L} arrow leaving ${pv(step.from)}.`,
        how: `You know the ${L} rule and the number where the arrow starts. Follow the arrow.`,
        what: `${sum(op, step.from)}, so that dot is ${pv(step.value)}.`,
      };
      break;
    }
    case 'backward': {
      const op = know.ops.get(chainOf(arrow, know)[0]);
      levels = {
        where: `Look at the ${L} arrow arriving at ${pv(step.to)}.`,
        how: `You know where this arrow ends and what ${L} does. Run it backwards: undo ${po(op)}.`,
        what: `Undo ${po(op)}: ${sum(inverseOp(op), step.to)}, so that dot is ${pv(step.value)}.`,
      };
      break;
    }
    case 'composite-forward': {
      levels = {
        where: `Look at the ${L} arrow leaving ${pv(step.from)}.`,
        how: `A ${L} arrow means ${chainWords(p, chainOf(arrow, know))}. Do both steps in order.`,
        what: `${workForward(chainOf(arrow, know).map((c) => know.ops.get(c)), step.from)}, so that dot is ${pv(step.value)}.`,
      };
      break;
    }
    case 'composite-backward': {
      levels = {
        where: `Look at the ${L} arrow arriving at ${pv(step.to)}.`,
        how: `A ${L} arrow means ${chainWords(p, chainOf(arrow, know))}. Undo them in reverse order, last step first.`,
        what: `${workBackward(chainOf(arrow, know).map((c) => know.ops.get(c)), step.to)}, so that dot is ${pv(step.value)}.`,
      };
      break;
    }
    case 'pin': {
      const n = step.arrows.length;
      const examples = step.arrows
        .map((id) => arrowById.get(id))
        .map((a) => `${pv(know.vals.get(a.from))} → ${pv(know.vals.get(a.to))}`)
        .join(', ');
      levels = {
        where: `Look at the ${L} arrows.`,
        how: `${n} ${L} arrows have numbers at both ends, starting from different numbers. What one rule takes each of them to where it ends?`,
        what: `The ${L} rule is ${po(step.value)} (${examples}).`,
      };
      break;
    }
    case 'composite-pin': {
      levels = {
        where: `Look at the ${L} arrows, including the ones hidden inside a combined arrow.`,
        how: `A combined arrow tells you what ${L} does to one number once you undo the parts you already know. With a second ${L} arrow from a different number, that settles ${L}.`,
        what: `The ${L} rule is ${po(step.value)}.`,
      };
      break;
    }
    case 'recipe': {
      const a = arrowById.get(step.arrows[0]);
      const n = step.arrows.length;
      levels = {
        where: `Look at the ${L} arrow${n === 1 ? '' : 's'} with numbers at both ends.`,
        how: `Try the choices for ${L}: which colors, in which order, take ${n === 1 ? 'it' : 'each one'} from where it starts to where it ends?`,
        what: `${L} means ${chainWords(p, step.value)}: ${workForward(step.value.map((c) => know.ops.get(c)), know.vals.get(a.from))}.`,
      };
      break;
    }
  }
  return { done: false, wrong, step, levels };
}
