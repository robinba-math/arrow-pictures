// A number line for the investigate window: each step of an arrow drawn as a
// hop. Adding and subtracting hop right and left; multiplying and dividing
// stretch away from zero and squeeze toward it, which is the picture that
// makes negatives make sense (×2 takes −3 further left, to −6).
//
// Only numbers the player can already see get a dot: givens and entries. A
// hop starts from a known number; where it lands is left for the player to
// read off the ticks. When only the far end is known, the hop runs backward
// as an "undo". Pure: returns an SVG string.

import { rational, ops } from '../engine/index.js';
import { pretty } from './render.js';

const W = 900;
const M = 34;          // side margin
const AXIS = 158;      // y of the line
const num = (r) => r.n / r.d;
const safe = (f) => { try { return f(); } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const FRACTION_WORDS = { 2: 'half', 3: 'a third', 4: 'a quarter' };
function stepWords(op) {
  const k = rational.format(op.k);
  if (op.kind === '+') return `${k} to the right`;
  if (op.kind === '-') return `${k} to the left`;
  if (op.kind === '*') return `${op.k.n === 2 ? 'twice' : `${k} times`} as far from 0`;
  return `${FRACTION_WORDS[op.k.n] || `1/${k}`} as far from 0`;
}

// points: [{ v: rational|null, name, kind: 'given'|'entered' }], one more than steps.
// steps: [{ op: op|null, hue }].
export function numberLine(points, steps) {
  const hops = [];
  steps.forEach((s, i) => {
    if (!s.op) return;
    const a = points[i].v;
    const b = points[i + 1].v;
    if (a) {
      const to = safe(() => ops.applyOp(s.op, a));
      if (to) hops.push({ from: a, to, hue: s.hue, op: s.op, back: false, target: i + 1, landed: !!b && rational.eq(b, to) });
    } else if (b) {
      const to = safe(() => ops.invertOp(s.op, b));
      if (to) hops.push({ from: b, to, hue: s.hue, op: ops.inverseOp(s.op), back: true, target: i, landed: false });
    }
  });

  const known = points.filter((p) => p.v);
  if (!known.length) return null;
  const vals = [0, ...known.map((p) => num(p.v)), ...hops.map((h) => num(h.to))];
  let lo = Math.floor(Math.min(...vals)) - 1;
  let hi = Math.ceil(Math.max(...vals)) + 1;
  if (hi - lo < 12) { const pad = 12 - (hi - lo); lo -= Math.floor(pad / 2); hi += Math.ceil(pad / 2); }
  const span = hi - lo;
  const tick = span <= 26 ? 1 : span <= 60 ? 2 : span <= 130 ? 5 : 10;
  const label = span <= 26 ? 1 : span <= 60 ? 2 : span <= 130 ? 10 : 20;
  lo = Math.floor(lo / tick) * tick;
  hi = Math.ceil(hi / tick) * tick;
  const X = (v) => M + ((v - lo) / (hi - lo)) * (W - 2 * M);

  const parts = [];
  // Below zero is a cold strip.
  if (lo < 0) {
    parts.push(`<rect class="nl-cold" x="${X(lo)}" y="${AXIS - 8}" width="${X(Math.min(0, hi)) - X(lo)}" height="16" rx="4"/>`);
    parts.push(`<text class="nl-coldlabel" x="${X(lo) + 4}" y="${AXIS - 16}">below zero</text>`);
  }
  parts.push(`<path class="nl-axis" d="M${M - 14} ${AXIS} H${W - M + 14}"/>`);
  parts.push(`<path class="nl-axis" d="M${M - 6} ${AXIS - 6} L${M - 16} ${AXIS} L${M - 6} ${AXIS + 6} M${W - M + 6} ${AXIS - 6} L${W - M + 16} ${AXIS} L${W - M + 6} ${AXIS + 6}"/>`);
  for (let v = lo; v <= hi; v += tick) {
    const zero = v === 0;
    parts.push(`<path class="nl-tick${zero ? ' is-zero' : ''}" d="M${X(v)} ${AXIS - (zero ? 10 : 6)} V${AXIS + (zero ? 10 : 6)}"/>`);
    if (v % label === 0) parts.push(`<text class="nl-num${zero ? ' is-zero' : ''}" x="${X(v)}" y="${AXIS + 32}">${pretty(v)}</text>`);
  }

  // Hops, stacked so neighbors don't share a height.
  const defs = new Set();
  hops.forEach((h, i) => {
    const x1 = X(num(h.from));
    const x2 = X(num(h.to));
    const lift = Math.min(84, 30 + Math.abs(x2 - x1) * 0.25) + (i % 2) * 14;
    const mid = (x1 + x2) / 2;
    defs.add(h.hue);
    parts.push(`<path class="nl-hop${h.back ? ' is-back' : ''}" d="M${x1} ${AXIS - 4} Q${mid} ${AXIS - 2 * lift} ${x2} ${AXIS - 7}" style="stroke:var(--c-${h.hue})" marker-end="url(#nl-ah-${h.hue})"/>`);
    const text = `${h.back ? 'undo: ' : ''}${pretty(ops.formatOp(h.op, { pretty: true }))}`;
    parts.push(`<text class="nl-rule" x="${mid}" y="${AXIS - lift - 30}" style="fill:var(--c-${h.hue})">${esc(text)}</text>`);
    parts.push(`<text class="nl-say" x="${mid}" y="${AXIS - lift - 10}">${esc(stepWords(h.op))}</text>`);
    if (!h.landed && !points[h.target].v) {
      parts.push(`<circle class="nl-landing" cx="${x2}" cy="${AXIS}" r="8"/>`);
      parts.push(`<text class="nl-name is-unknown" x="${x2}" y="${AXIS + 60}">${esc(points[h.target].name)}?</text>`);
    }
  });

  // Known numbers, named underneath; names that share a spot stack.
  const at = new Map();
  for (const p of known) {
    const x = X(num(p.v));
    const row = at.get(x) || 0;
    at.set(x, row + 1);
    parts.push(`<circle class="nl-pt is-${p.kind}" cx="${x}" cy="${AXIS}" r="7"/>`);
    parts.push(`<text class="nl-name" x="${x}" y="${AXIS + 60 + row * 19}">${esc(p.name)} ${pretty(rational.format(p.v))}</text>`);
  }

  const markers = [...defs].map((h) => `<marker id="nl-ah-${h}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="13" markerHeight="13" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0.6 L10 5 L0 9.4 z" style="fill:var(--c-${h})"/></marker>`).join('');
  return `<svg class="numberline" viewBox="0 0 ${W} ${AXIS + 86}" role="img" aria-label="Number line"><defs>${markers}</defs>${parts.join('')}</svg>`;
}

export const NUMBERLINE_CSS = `
.numberline { display: block; width: 100%; height: auto; font-family: var(--font-num); }
.numberline .nl-axis { stroke: var(--ink); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.numberline .nl-tick { stroke: var(--ink-soft); stroke-width: 1.5; }
.numberline .nl-tick.is-zero { stroke: var(--ink); stroke-width: 3; }
.numberline .nl-num { fill: var(--ink-soft); font-size: 16px; font-weight: 700; text-anchor: middle; }
.numberline .nl-num.is-zero { fill: var(--ink); font-size: 20px; }
.numberline .nl-cold { fill: var(--c-blue); opacity: .14; }
.numberline .nl-coldlabel { fill: var(--c-blue); font: 700 13px var(--font-body); letter-spacing: .06em; text-transform: uppercase; }
.numberline .nl-hop { fill: none; stroke-width: 3; stroke-linecap: round; }
.numberline .nl-hop.is-back { stroke-dasharray: 7 5; }
.numberline .nl-rule { font: 900 24px "Arial Black", "Helvetica Neue", Arial, sans-serif; text-anchor: middle; }
.numberline .nl-say { fill: var(--ink-soft); font: 400 15px var(--font-body); text-anchor: middle; }
.numberline .nl-pt { r: 8; }
.numberline .nl-pt.is-given { fill: var(--ink); }
.numberline .nl-pt.is-entered { fill: var(--pencil); }
.numberline .nl-landing { fill: var(--board); stroke: var(--pencil); stroke-width: 2.4; stroke-dasharray: 3 3; }
.numberline .nl-name { fill: var(--ink); font: 700 16px var(--font-body); text-anchor: middle; }
.numberline .nl-name.is-unknown { fill: var(--pencil); }
`;
