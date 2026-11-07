// Exhaustive solver. Node values range over infinitely many fractions, so the
// search never enumerates them: it branches over the finite rule family for
// each mystery color and lets propagation force every value.

import { eq } from './rational.js';
import { applyChain, invertChain, applyOp, opEq } from './ops.js';
import { inDomain, recipeChoices } from './puzzle.js';

const CONTRADICTION = Symbol('contradiction');

export function initialState(p) {
  const vals = new Map();
  for (const n of p.nodes) if (n.given) vals.set(n.id, n.given);
  const ops = new Map();
  const cands = new Map();
  for (const id of p.baseColors) {
    const c = p.colorById.get(id);
    if (c.op) ops.set(id, c.op);
    else cands.set(id, p.family);
  }
  return { vals, ops, cands };
}

const cloneState = (s) => ({ vals: new Map(s.vals), ops: new Map(s.ops), cands: new Map(s.cands) });

// Safe chain evaluation: a division by zero or a value outside the domain is
// a contradiction, never an exception.
function tryApply(chainOps, v, config) {
  try {
    const r = applyChain(chainOps, v);
    return inDomain(r, config) ? r : CONTRADICTION;
  } catch {
    return CONTRADICTION;
  }
}
function tryInvert(chainOps, v, config) {
  try {
    const r = invertChain(chainOps, v);
    return inDomain(r, config) ? r : CONTRADICTION;
  } catch {
    return CONTRADICTION;
  }
}

// Does assigning `op` to `color` make this arrow's chain carry a to b?
function chainFits(chain, ops, color, op, a, b) {
  try {
    let x = a;
    for (const c of chain) x = applyOp(c === color ? op : ops.get(c), x);
    return eq(x, b);
  } catch {
    return false;
  }
}

// Apply every forced deduction until nothing changes. Mutates `s`.
export function propagate(p, s) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const arrow of p.arrows) {
      if (!arrow.chain) continue;
      const a = s.vals.get(arrow.from);
      const b = s.vals.get(arrow.to);
      const unknown = [...new Set(arrow.chain.filter((c) => !s.ops.has(c)))];

      if (unknown.length === 0) {
        const chainOps = arrow.chain.map((c) => s.ops.get(c));
        if (a && b) {
          const r = tryApply(chainOps, a, p.config);
          if (r === CONTRADICTION || !eq(r, b)) return CONTRADICTION;
        } else if (a) {
          const r = tryApply(chainOps, a, p.config);
          if (r === CONTRADICTION) return CONTRADICTION;
          s.vals.set(arrow.to, r);
          changed = true;
        } else if (b) {
          const r = tryInvert(chainOps, b, p.config);
          if (r === CONTRADICTION) return CONTRADICTION;
          s.vals.set(arrow.from, r);
          changed = true;
        }
      } else if (unknown.length === 1 && a && b) {
        const color = unknown[0];
        const before = s.cands.get(color);
        const after = before.filter((op) => chainFits(arrow.chain, s.ops, color, op, a, b));
        if (after.length === 0) return CONTRADICTION;
        if (after.length === 1) {
          s.ops.set(color, after[0]);
          s.cands.delete(color);
          changed = true;
        } else if (after.length < before.length) {
          s.cands.set(color, after);
          changed = true;
        }
      }
    }
  }
  return s;
}

// Count solutions up to `limit`. Status is one of:
//   unique | none | multiple | underdetermined | budget
export function solve(p, { limit = 2, budget = 200000 } = {}) {
  const solutions = [];
  let underdetermined = false;
  let visited = 0;
  let exhausted = false;

  const search = (s) => {
    if (solutions.length >= limit || underdetermined || exhausted) return;
    if (++visited > budget) { exhausted = true; return; }
    if (propagate(p, s) === CONTRADICTION) return;

    const open = p.baseColors.filter((c) => !s.ops.has(c));
    if (open.length === 0) {
      // Every rule is known. Propagation reaches a whole component once any of
      // its values is known, so a blank left here sits in a component with no
      // given value: infinitely many solutions.
      if (p.nodes.some((n) => !s.vals.has(n.id))) { underdetermined = true; return; }
      solutions.push({ vals: s.vals, ops: s.ops });
      return;
    }
    // Branch on the color with the fewest remaining candidates.
    open.sort((x, y) => s.cands.get(x).length - s.cands.get(y).length);
    const color = open[0];
    for (const op of s.cands.get(color)) {
      const next = cloneState(s);
      next.ops.set(color, op);
      next.cands.delete(color);
      search(next);
      if (solutions.length >= limit || underdetermined || exhausted) return;
    }
  };

  search(initialState(p));

  let status;
  if (exhausted) status = 'budget';
  else if (underdetermined) status = 'underdetermined';
  else if (solutions.length === 0) status = 'none';
  else if (solutions.length === 1) status = 'unique';
  else status = 'multiple';
  return { status, solutions, visited };
}

// The puzzle with each hidden composite's arrows following the given recipe.
export function withRecipes(p, recipes) {
  return { ...p, arrows: p.arrows.map((a) => (recipes.has(a.color) ? { ...a, chain: recipes.get(a.color) } : a)) };
}

// solve(), counting every recipe the player could pick for a hidden composite.
// Each solution carries the recipes it used.
export function solveAll(p, { limit = 2, budget = 200000 } = {}) {
  let assignments = [new Map()];
  for (const id of p.hidden) {
    assignments = assignments.flatMap((m) => recipeChoices(p, id).map((r) => new Map([...m, [id, r]])));
  }
  const solutions = [];
  let visited = 0;
  let status = null;
  for (const recipes of assignments) {
    const r = solve(p.hidden.length ? withRecipes(p, recipes) : p, { limit: limit - solutions.length, budget: budget - visited });
    visited += r.visited;
    if (r.status === 'budget' || r.status === 'underdetermined') { status = r.status; break; }
    for (const s of r.solutions) solutions.push({ ...s, recipes });
    if (solutions.length >= limit) break;
  }
  status ??= solutions.length === 0 ? 'none' : solutions.length === 1 ? 'unique' : 'multiple';
  return { status, solutions, visited };
}

// Two solutions differ somewhere; name the first place, for error messages.
export function firstDifference(p, s1, s2) {
  for (const id of p.hidden) {
    if (s1.recipes.get(id).join() !== s2.recipes.get(id).join()) return { kind: 'recipe', id };
  }
  for (const id of p.baseColors) {
    if (!opEq(s1.ops.get(id), s2.ops.get(id))) return { kind: 'color', id };
  }
  for (const n of p.nodes) {
    if (!eq(s1.vals.get(n.id), s2.vals.get(n.id))) return { kind: 'node', id: n.id };
  }
  return null;
}
