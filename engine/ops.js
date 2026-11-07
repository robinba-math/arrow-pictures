// Operations an arrow color can stand for: {kind, k}, kind one of + - * /,
// k a positive rational. Every operation in a family is invertible and no
// two are the same function, so "two rules fit" always means a real ambiguity.

import { rat, add, sub, mul, div, eq, parse as parseRat, format as formatRat } from './rational.js';

export const KINDS = ['+', '-', '*', '/'];

export function applyOp(op, v) {
  switch (op.kind) {
    case '+': return add(v, op.k);
    case '-': return sub(v, op.k);
    case '*': return mul(v, op.k);
    case '/': return div(v, op.k);
  }
  throw new TypeError(`unknown op kind ${op.kind}`);
}

export function invertOp(op, v) {
  switch (op.kind) {
    case '+': return sub(v, op.k);
    case '-': return add(v, op.k);
    case '*': return div(v, op.k);
    case '/': return mul(v, op.k);
  }
  throw new TypeError(`unknown op kind ${op.kind}`);
}

// The operation that undoes `op`: add undoes subtract, multiply undoes divide.
export const inverseOp = (op) =>
  Object.freeze({ kind: { '+': '-', '-': '+', '*': '/', '/': '*' }[op.kind], k: op.k });

// Run a chain of operations forward, or undo it from the far end.
export const applyChain = (ops, v) => ops.reduce((x, op) => applyOp(op, x), v);
export const invertChain = (ops, v) => ops.reduceRight((x, op) => invertOp(op, x), v);

export const opEq = (a, b) => a.kind === b.kind && eq(a.k, b.k);
export const opKey = (op) => `${op.kind}${formatRat(op.k)}`;

const PRETTY = { '+': '+', '-': '−', '*': '×', '/': '÷' };
export const formatOp = (op, { pretty = false } = {}) =>
  `${pretty ? PRETTY[op.kind] : op.kind}${formatRat(op.k)}`;

// Accepts "+3", "-3", "−3", "*2", "x2", "×2", "/2", "÷2", "+1/2".
export function parseOp(s) {
  if (s && typeof s === 'object') return normalizeOp(s);
  const m = String(s).trim().match(/^([+\-−*x×/÷])\s*(\d+(?:\s*\/\s*\d+)?)$/i);
  if (!m) throw new TypeError(`cannot parse operation "${s}"`);
  const kind = { '+': '+', '-': '-', '−': '-', '*': '*', x: '*', X: '*', '×': '*', '/': '/', '÷': '/' }[m[1]];
  return normalizeOp({ kind, k: m[2] });
}

function normalizeOp({ kind, k }) {
  if (!KINDS.includes(kind)) throw new TypeError(`unknown op kind ${kind}`);
  const kr = typeof k === 'object' && k !== null && 'n' in k ? k : parseRat(k);
  if (kr.n <= 0) throw new RangeError(`op constant must be positive, got ${formatRat(kr)}`);
  if ((kind === '*' || kind === '/') && eq(kr, rat(1))) throw new RangeError(`${kind}1 is the identity`);
  return Object.freeze({ kind, k: kr });
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// The finite set of rules a mystery color may be. Add and subtract take
// constants m/d for each allowed denominator d; multiply and divide take
// whole numbers 2..kMax, which keeps the family free of duplicates
// (multiplying by 1/2 would be the same function as dividing by 2).
export function family({ kinds = KINDS, kMax = 12, kDens = [1] } = {}) {
  const out = [];
  for (const kind of kinds) {
    if (kind === '+' || kind === '-') {
      for (const d of kDens) {
        for (let m = 1; m <= kMax * d; m++) {
          if (d > 1 && gcd(m, d) !== 1) continue;
          out.push(Object.freeze({ kind, k: rat(m, d) }));
        }
      }
    } else {
      for (let k = 2; k <= kMax; k++) out.push(Object.freeze({ kind, k: rat(k) }));
    }
  }
  return out;
}

// Every rule of an allowed kind that carries x to y, with no limit on the
// size of the constant. This is what a person can conclude from one arrow
// without knowing any limit. Returns null when infinitely many rules fit
// (0 to 0 under multiply or divide).
export function fitting(x, y, { kinds = KINDS, kDens = [1] } = {}) {
  const out = [];
  const diff = sub(y, x);
  const denOk = (r) => r.d === 1 || kDens.includes(r.d);
  if (diff.n > 0 && kinds.includes('+') && denOk(diff)) out.push(Object.freeze({ kind: '+', k: diff }));
  if (diff.n < 0 && kinds.includes('-') && denOk(rat(-diff.n, diff.d))) out.push(Object.freeze({ kind: '-', k: rat(-diff.n, diff.d) }));
  const scales = kinds.includes('*') || kinds.includes('/');
  if (x.n === 0) {
    if (y.n === 0 && scales) return null;
    return out;
  }
  const q = div(y, x);
  if (kinds.includes('*') && q.d === 1 && q.n >= 2) out.push(Object.freeze({ kind: '*', k: q }));
  if (kinds.includes('/') && q.n === 1 && q.d >= 2) out.push(Object.freeze({ kind: '/', k: rat(q.d) }));
  return out;
}

// Every rule, and every chain of rules, multiplies then adds: x -> m*x + c.
// Writing them this way makes "these two colors do the same thing" and
// "this color undoes that one" exact comparisons.
export function affine(chainOps) {
  let m = rat(1);
  let c = rat(0);
  for (const op of chainOps) {
    if (op.kind === '+') c = add(c, op.k);
    else if (op.kind === '-') c = sub(c, op.k);
    else if (op.kind === '*') { m = mul(m, op.k); c = mul(c, op.k); }
    else { m = div(m, op.k); c = div(c, op.k); }
  }
  return { m, c };
}
export const affineEq = (f, g) => eq(f.m, g.m) && eq(f.c, g.c);
export const affineInverse = (f) => ({ m: div(rat(1), f.m), c: div(rat(-f.c.n, f.c.d), f.m) });
export const isIdentity = (f) => eq(f.m, rat(1)) && f.c.n === 0;
