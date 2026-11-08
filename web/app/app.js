// The solve screen: state, input, checking, hints. Drawing lives in
// render.js and geometry in layout.js; puzzle logic lives in the engine.

import { checkPuzzle, prepare, readBoard, deductions, ops, rational, missingArrows, stepsLeft } from '../engine/index.js';
import { inDomain, levelProblem } from '../engine/puzzle.js';
import THEMES from '../puzzles.js';
import { computeLayout, routeArrows, frame, GRID, R } from './layout.js';
import { renderBoard, colorStyles, BOARD_CSS, HUE_NAME, pretty } from './render.js';
import { party, showFinger, CELEBRATE_CSS } from './celebrate.js';

const $ = (id) => document.getElementById(id);
const style = document.createElement('style');
style.textContent = BOARD_CSS + CELEBRATE_CSS;
document.head.append(style);

// Browser storage may be missing or blocked; the app works without it.
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const MODES = {
  'find-values': { eyebrow: 'Find the numbers', help: 'Each color of arrow always does the same thing. Use the rules to fill in every empty dot.' },
  'find-rules': { eyebrow: 'Find the rules', help: 'Every number is shown. Work out what each mystery color does to a number.' },
  mixed: { eyebrow: 'Find the rules and the numbers', help: 'Work out the mystery rules, then use them to fill in the empty dots.' },
};
const oneMystery = 'Work out the mystery rule, then use it to fill in the empty dots.';

// ---- Library ---------------------------------------------------------------

// One list in play order: each theme from 1 star to 5, then the archive.
const library = THEMES.flatMap((theme) => theme.puzzles.map((json, pos) => ({ json, theme, pos }))).map(({ json, theme, pos }) => {
  const report = checkPuzzle(json);
  if (!report.ok) return null;
  const prep = prepare(json);
  const p = prep.puzzle;
  const styles = colorStyles(p);
  // Hints should name colors the way the board shows them.
  for (const c of p.colors) c.label = HUE_NAME[styles.get(c.id).hue].toLowerCase();
  return { json, theme, pos, report, prep, p, styles, layout: computeLayout(p) };
}).filter(Boolean);

// ---- State -----------------------------------------------------------------

const settings = store.get('ap:settings', { instant: false });
let idx = 0;
let cur;          // current library entry
let board;        // { values: {nodeId: text}, rules: {colorId: text} }
let history;      // board snapshots for undo
let hpos;
let lastEdit;     // the target of the last typed edit, for coalescing undo steps
let selected;     // { kind: 'node' | 'color', id } | null
let shown;        // Set of 'node:id' / 'color:id' currently marked wrong
let hintState;    // { level, h } | null
let progress;     // persisted per puzzle

const keyFor = (e) => `ap:p:${e.json.id || e.json.title}`;
const clone = (b) => JSON.parse(JSON.stringify(b));
const emptyBoard = () => ({ values: {}, rules: {}, recipes: {}, scratch: {}, drawn: [], extra: [] });

// A short fingerprint of what a puzzle asks, to tell when it has changed.
function fingerprint(json) {
  const text = JSON.stringify([json.nodes, json.colors, json.arrows, json.road, json.draw]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function load(i) {
  stopReplay();
  idx = (i + library.length) % library.length;
  cur = library[idx];
  // A board saved for an earlier version of this puzzle doesn't fit it.
  // Boards saved before fingerprints existed are kept as they are.
  const sig = fingerprint(cur.json);
  let saved = store.get(keyFor(cur), null);
  if (saved?.sig && saved.sig !== sig) saved = null;
  progress = saved || { board: emptyBoard(), hints: 0, activeMs: 0, solved: false };
  progress.sig = sig;
  board = { recipes: {}, scratch: {}, drawn: [], extra: [], ...clone(progress.board) };
  investigating = null;
  pen = null;
  flash = null;
  history = [clone(board)];
  hpos = 0;
  lastEdit = null;
  selected = null;
  shown = new Set();
  hintState = null;
  store.set('ap:last', cur.json.id);
  renderAll();
}

function save() {
  progress.board = clone(board);
  store.set(keyFor(cur), progress);
}

// ---- Reading the board -----------------------------------------------------

// A rule entry may hold candidates: "+4 or ×2".
function parseRuleText(text) {
  const parts = (text || '').split(' or ').map((s) => s.trim()).filter(Boolean);
  const parsed = parts.map((s) => { try { return ops.parseOp(s); } catch { return null; } });
  return { parts, parsed, single: parts.length === 1 && parsed[0] ? parsed[0] : null };
}

// The board in the engine's terms: dots as typed, rules only when settled.
function engineBoard(b = board) {
  const rules = {};
  for (const [id, text] of Object.entries(b.rules)) {
    const r = parseRuleText(text);
    if (r.single) rules[id] = ops.formatOp(r.single);
  }
  return { values: { ...b.values }, rules, recipes: { ...b.recipes } };
}

// Every entry that disagrees with the solution, including a candidate list
// that leaves out the right rule.
function wrongEntries() {
  const { wrong } = readBoard(cur.p, cur.prep.solution, engineBoard());
  const out = new Set(wrong.map((w) => `${w.kind}:${w.id}`));
  for (const [id, text] of Object.entries(board.rules)) {
    const r = parseRuleText(text);
    if (r.parts.length === 0) continue;
    if (r.parsed.some((x) => !x)) { out.add(`color:${id}`); continue; }
    if (r.parts.length > 1 && !r.parsed.some((op) => ops.opEq(op, cur.prep.solution.ops.get(id)))) out.add(`color:${id}`);
  }
  for (const x of board.extra) {
    const v = shownValue(x.id);
    if (board.values[x.id] && !(v && rational.eq(v, truth(x.id)))) out.add(`node:${x.id}`);
  }
  return out;
}

// A hidden recipe counts once every one of its dropdowns has a color.
const recipeChosen = (id) => {
  const r = board.recipes[id] || [];
  return r.length === cur.p.colorById.get(id).composite.length && r.every(Boolean);
};

function isSolved() {
  if (cur.prep.hint(engineBoard()).done !== true) return false;
  if (cur.p.road) return roadLength() !== null;
  return !cur.p.draw || missingLeft().length === 0;
}

function counts() {
  const blanks = cur.p.nodes.filter((n) => !n.given);
  const filled = blanks.filter((n) => (board.values[n.id] || '') !== '').length;
  const rulesDone = cur.p.mystery.filter((c) => parseRuleText(board.rules[c]).single).length
    + cur.p.hidden.filter((id) => recipeChosen(id)).length;
  const arrows = cur.p.draw ? { found: board.drawn.length, total: cur.prep.draw.missing.length } : null;
  return { blanks: blanks.length, filled, rules: cur.p.mystery.length + cur.p.hidden.length, rulesDone, arrows };
}

// ---- Editing ---------------------------------------------------------------

const targetKey = (t) => (t ? `${t.kind}:${t.id}` : null);

function commit({ coalesce = false } = {}) {
  const key = targetKey(selected);
  if (!(coalesce && key === lastEdit)) {
    history = history.slice(0, hpos + 1);
    history.push(null);
    hpos++;
  }
  history[hpos] = clone(board);
  lastEdit = coalesce ? key : null;

  const now = Date.now();
  progress.activeMs += Math.min(now - (progress.lastAt || now), 120000);
  progress.lastAt = now;
  hintState = null;
  if (settings.instant) {
    const w = wrongEntries();
    if (selected) w.delete(targetKey(selected)); // never judge an entry mid-typing
    shown = w;
  } else {
    // Editing an entry clears its mark.
    if (selected) shown.delete(targetKey(selected));
  }
  trackOrder();
  let justSolved = false;
  if (!progress.solved && isSolved()) {
    progress.solved = true;
    progress.solvedAt = now;
    selected = null;
    pen = null;
    shown = new Set();
    // Solved from inside the step-by-step window: back to the picture for
    // the replay and the party.
    investigating = null;
    justSolved = true;
  }
  save();
  renderAll();
  // Start after the click that solved it, so that click doesn't skip the replay.
  if (justSolved) setTimeout(celebrate, 450);
}

// Remember the order answers became right, for the replay.
function trackOrder() {
  const { know } = readBoard(cur.p, cur.prep.solution, engineBoard());
  const right = new Set([
    ...cur.p.nodes.filter((n) => !n.given && know.vals.has(n.id)).map((n) => `node:${n.id}`),
    ...cur.p.mystery.filter((c) => know.ops.has(c)).map((c) => `color:${c}`),
    ...cur.p.hidden.filter((id) => know.recipes.has(id)).map((id) => `recipe:${id}`),
  ]);
  const order = (progress.order || []).filter((k) => right.has(k));
  for (const k of right) if (!order.includes(k)) order.push(k);
  progress.order = order;
}

function nodeKey(text, key) {
  if (/^\d$/.test(key)) {
    const digits = text.replace(/[^0-9]/g, '');
    return digits.length >= 5 ? text : text + key;
  }
  if (key === 'neg') return text.startsWith('-') ? text.slice(1) : '-' + text;
  if (key === 'frac') return /\d$/.test(text) && !text.includes('/') ? text + '/' : text;
  if (key === 'back') return text.slice(0, -1);
  if (key === 'clear') return '';
  return text;
}

const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function ruleKey(text, key) {
  const segs = text === '' ? [''] : text.split(' or ');
  let last = segs[segs.length - 1];
  const hasOp = /^[+−×÷]/.test(last);
  const hasDigit = /\d/.test(last);
  if (key in OPS) {
    if (!hasOp || !hasDigit) last = OPS[key] + last.replace(/^[+−×÷]/, '');
    else { segs.push(OPS[key]); return segs.join(' or '); }
  } else if (/^\d$/.test(key)) {
    if (!hasOp || last.replace(/[^0-9]/g, '').length >= 4) return text;
    last += key;
  } else if (key === 'frac') {
    if (hasOp && /\d$/.test(last) && !last.includes('/')) last += '/';
  } else if (key === 'or') {
    if (hasOp && /\d$/.test(last)) { segs.push(''); return segs.join(' or ').replace(/ or $/, ' or '); }
    return text;
  } else if (key === 'back') {
    if (last === '' && segs.length > 1) { segs.pop(); return segs.join(' or '); }
    last = last.slice(0, -1);
  } else if (key === 'clear') {
    return '';
  }
  segs[segs.length - 1] = last;
  return segs.join(' or ');
}

function press(key) {
  if (!selected || progress.solved) return;
  if (selected.kind === 'scratch') {
    const [arrowId, i] = splitKey(selected.id);
    const mids = board.scratch[arrowId] || [];
    const before = mids[i] || '';
    const after = nodeKey(before, key);
    if (after === before) return;
    mids[i] = after;
    if (mids.some(Boolean)) board.scratch[arrowId] = mids; else delete board.scratch[arrowId];
  } else if (selected.kind === 'node') {
    const before = board.values[selected.id] || '';
    const after = nodeKey(before, key);
    if (after === before) return;
    if (after === '') delete board.values[selected.id]; else board.values[selected.id] = after;
  } else {
    const before = board.rules[selected.id] || '';
    const after = ruleKey(before, key);
    if (after === before) return;
    if (after === '') delete board.rules[selected.id]; else board.rules[selected.id] = after;
  }
  commit({ coalesce: key !== 'clear' });
}

// Blanks in reading order, then mystery rules.
function targets() {
  const blanks = cur.p.nodes.filter((n) => !n.given)
    .sort((a, b) => cur.layout.pos[a.id].y - cur.layout.pos[b.id].y || cur.layout.pos[a.id].x - cur.layout.pos[b.id].x)
    .map((n) => ({ kind: 'node', id: n.id }));
  return [...blanks, ...cur.p.mystery.map((id) => ({ kind: 'color', id }))];
}

function select(t, { focus = false } = {}) {
  if (progress.solved) return;
  if (selected && targetKey(selected) !== targetKey(t) && settings.instant) {
    // Leaving an entry is the moment to judge it.
    shown = wrongEntries();
  }
  selected = t;
  lastEdit = null;
  renderAll();
  if (focus && t) focusTarget(t);
}

function step(dir) {
  const ts = targets();
  if (!ts.length) return;
  const i = ts.findIndex((t) => targetKey(t) === targetKey(selected));
  select(ts[(i + dir + ts.length) % ts.length], { focus: true });
}

function focusTarget(t) {
  const el = t.kind === 'node'
    ? $('stage').querySelector(`[data-node="${CSS.escape(t.id)}"]`)
    : $('rules').querySelector(`[data-color="${CSS.escape(t.id)}"]`);
  el?.focus({ preventScroll: true });
}

// ---- Drawing arrows --------------------------------------------------------
// In a drawing puzzle the player picks a color's pen, clicks the dot an arrow
// starts at, then the dot it ends at; in a road puzzle, clicking an empty
// spot instead makes a new dot there. Every arrow is judged the moment it is
// drawn and its number sentence read out, the way a CSMP class checks each
// arrow aloud.

let pen = null;    // { color, from: nodeId|null } while drawing
let flash = null;  // { kind: 'ok'|'bad'|'note', text, drawn?: index, refused?: arrow }
let flashTimer;

const penColors = () => (cur.p.draw ? [cur.p.draw.color] : cur.p.road ? cur.p.road.colors : []);
const extraDot = (id) => board.extra.find((x) => x.id === id);
const opOf = (color) => cur.prep.solution.ops.get(color);
const parseVal = (text) => { try { return rational.parse(text); } catch { return null; } };
const allowedValue = (v) => inDomain(v, cur.p.config) && !levelProblem(v, cur.p.config);
const missingLeft = () => missingArrows(cur.p, cur.prep.solution, cur.p.draw.color, board.drawn);

// The true number at a dot. A dot the player added is worked out from the
// arrow that made it.
function truth(id) {
  const x = extraDot(id);
  return x ? ops.applyOp(opOf(x.color), truth(x.from)) : cur.prep.solution.vals.get(id);
}

// The number the player can see at a dot, or null.
function shownValue(id) {
  const n = cur.p.nodes.find((m) => m.id === id);
  if (n?.given) return n.given;
  return board.values[id] ? parseVal(board.values[id]) : null;
}

function say(kind, text, extra = {}) {
  clearTimeout(flashTimer);
  flash = { kind, text, ...extra };
  flashTimer = setTimeout(() => { flash = null; renderBoardView(); renderStatus(); }, kind === 'note' ? 4000 : 2600);
}

function togglePen(color) {
  if (progress.solved) return;
  pen = pen?.color === color ? null : { color, from: null };
  flash = null;
  renderAll();
}

// "8 + 3 = 11", unless the rule is still a mystery to the player.
function sentence(color, v) {
  const op = opOf(color);
  const guess = parseRuleText(board.rules[color]).single;
  if (!cur.p.colorById.get(color).op && !(guess && ops.opEq(guess, op))) return null;
  return `${fmtRat(v)} ${OPS[op.kind]} ${fmtRat(op.k)} = ${fmtRat(ops.applyOp(op, v))}`;
}

// An arrow can only start or end at a dot that shows its right number.
function ready(id) {
  const v = shownValue(id);
  if (!v) {
    say('note', 'Fill in that dot’s number first.');
    select({ kind: 'node', id });
    return false;
  }
  if (!rational.eq(v, truth(id))) {
    shown.add(`node:${id}`);
    say('bad', 'That dot’s number doesn’t fit yet. Fix it first.');
    renderAll();
    return false;
  }
  return true;
}

function drawArrow(from, to) {
  const color = pen.color;
  const name = nameOf(color).toLowerCase();
  pen.from = null;
  if (!ready(from) || !ready(to)) return;
  if ([...cur.p.arrows, ...board.drawn].some((a) => a.from === from && a.to === to && a.color === color)) {
    say('note', 'That arrow is already there.');
    renderAll();
    return;
  }
  const text = sentence(color, truth(from));
  if (rational.eq(ops.applyOp(opOf(color), truth(from)), truth(to))) {
    board.drawn.push({ from, to, color });
    say('ok', text ? `${text} ✓` : `Yes! That’s a ${name} arrow.`, { drawn: board.drawn.length - 1 });
    commit();
  } else {
    say('bad', text ? `${text}, not ${fmtRat(truth(to))}` : `No, that’s not a ${name} arrow.`, { refused: { from, to, color } });
    renderAll();
  }
}

const snap = (v, o) => o + GRID / 2 + Math.round((v - o - GRID / 2) / GRID) * GRID;
const roomAt = (pos, x, y) => {
  const [vx, vy, vw, vh] = cur.layout.viewBox;
  const inside = x >= vx + R + 8 && x <= vx + vw - R - 8 && y >= vy + R + 8 && y <= vy + vh - R - 8;
  return inside && Object.values(pos).every((q) => Math.hypot(q.x - x, q.y - y) >= 2 * R + 14);
};

// Where a new dot goes for a click at `pt`: right there if there's room,
// else the nearest free spot further along the same direction from the
// arrow's start, else the nearest free spot anywhere close by.
function freeSpotToward(from, pt) {
  const { pos } = boardModel().layout;
  const [vx, vy] = cur.layout.viewBox;
  const P = pos[from];
  const len = Math.hypot(pt.x - P.x, pt.y - P.y) || 1;
  const ux = (pt.x - P.x) / len;
  const uy = (pt.y - P.y) / len;
  for (let r = len; r <= len + 8 * GRID; r += GRID / 2) {
    const x = snap(P.x + ux * r, vx);
    const y = snap(P.y + uy * r, vy);
    if (roomAt(pos, x, y)) return { x, y };
  }
  let best = null;
  for (let dx = -5; dx <= 5; dx++) {
    for (let dy = -5; dy <= 5; dy++) {
      const x = snap(pt.x, vx) + dx * GRID;
      const y = snap(pt.y, vy) + dy * GRID;
      const d = Math.hypot(x - pt.x, y - pt.y);
      if (roomAt(pos, x, y) && (!best || d < best.d)) best = { x, y, d };
    }
  }
  return best;
}

// Road puzzles: an arrow from the pen's dot to an empty spot makes a new dot.
function drawToSpot(pt) {
  const from = pen.from;
  if (!ready(from)) return;
  const spot = freeSpotToward(from, pt);
  if (!spot) {
    say('note', 'There isn’t room for a new dot there. Try another spot.');
    renderAll();
    return;
  }
  const { x, y } = spot;
  const w = ops.applyOp(opOf(pen.color), truth(from));
  if (!allowedValue(w)) {
    say('note', 'That arrow goes off the edge of this puzzle’s numbers. Try another color.');
    renderAll();
    return;
  }
  if ([...cur.p.nodes.map((n) => n.id), ...board.extra.map((e) => e.id)].some((id) => rational.eq(truth(id), w))) {
    say('note', 'That number already has a dot. Draw the arrow to that dot instead.');
    renderAll();
    return;
  }
  addDot(from, pen.color, x, y);
  selected = { kind: 'node', id: board.extra.at(-1).id };
  pen.from = selected.id;
  say('note', 'New dot! Type its number.');
  commit();
}

function addDot(from, color, x, y) {
  board.nextId = (board.nextId || 0) + 1;
  const id = `r${board.nextId}`;
  board.extra.push({ id, x, y, from, color });
  board.drawn.push({ from, to: id, color });
  return id;
}

function svgPoint(e) {
  const svg = $('stage').querySelector('svg.board');
  return new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
}

function penClick(e) {
  const dot = e.target.closest('[data-node]');
  if (dot) {
    const id = dot.dataset.node;
    if (pen.from === id) pen.from = null;
    else if (pen.from) { drawArrow(pen.from, id); return; }
    else if (!shownValue(id)) {
      say('note', 'Fill in this dot’s number, then draw from it.');
      select({ kind: 'node', id });
      return;
    } else {
      pen.from = id;
      flash = null;
    }
    renderAll();
    return;
  }
  if (cur.p.road && pen.from) { drawToSpot(svgPoint(e)); return; }
  if (pen.from) { pen.from = null; renderAll(); }
}

// The dots a road reaches from `start` through dots with right numbers,
// each with its distance in arrows. Arrows already in the picture count.
const roadStops = () => [cur.p.road.from, ...cur.p.road.via, cur.p.road.to];
function roadReach(start = cur.p.road.from) {
  const ok = (id) => { const v = shownValue(id); return v && rational.eq(v, truth(id)); };
  if (!ok(start)) return new Map();
  const dist = new Map([[start, 0]]);
  for (let layer = [start]; layer.length;) {
    const next = [];
    for (const u of layer) {
      for (const a of [...cur.p.arrows, ...board.drawn]) {
        if (a.from !== u || dist.has(a.to) || !ok(a.to)) continue;
        dist.set(a.to, dist.get(u) + 1);
        next.push(a.to);
      }
    }
    layer = next;
  }
  return dist;
}
// The road's length stop to stop, or null while it doesn't get through.
function roadLength() {
  const stops = roadStops();
  let total = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    const d = roadReach(stops[i]).get(stops[i + 1]);
    if (d === undefined) return null;
    total += d;
  }
  return total;
}

// A free spot for a new dot near `id`, leaning toward the dot `goal`.
function spotNear(id, goal) {
  const { pos } = boardModel().layout;
  const P = pos[id];
  const T = pos[goal];
  const toward = Math.atan2(T.y - P.y, T.x - P.x);
  const [vx, vy] = cur.layout.viewBox;
  for (const r of [120, 168, 216]) {
    for (const turn of [0, 35, -35, 70, -70, 105, -105, 140, -140, 180]) {
      const a = toward + (turn * Math.PI) / 180;
      const x = snap(P.x + r * Math.cos(a), vx);
      const y = snap(P.y + r * Math.sin(a), vy);
      if (roomAt(pos, x, y)) return { x, y };
    }
  }
  return { x: P.x, y: P.y + 3 * GRID };
}

// Hints for drawing puzzles take the same three steps as the others.
function drawHint() {
  const m = missingLeft()[0];
  const name = nameOf(m.color).toLowerCase();
  const a = truth(m.from);
  const b = truth(m.to);
  const op = opOf(m.color);
  return {
    custom: true,
    color: m.color,
    levels: {
      where: `There’s still a ${name} arrow that starts at the ${fmtRat(a)} dot.`,
      how: `${fmtRat(a)} ${OPS[op.kind]} ${fmtRat(op.k)} = ${fmtRat(b)}. Which dot shows ${fmtRat(b)}?`,
      what: `Draw a ${name} arrow from ${fmtRat(a)} to ${fmtRat(b)}.`,
    },
    nodes: (level) => new Set(level >= 3 ? [m.from, m.to] : [m.from]),
    apply() { board.drawn.push({ ...m }); },
  };
}

function roadHint() {
  // Work on the first stretch, stop to stop, that isn't built yet.
  const stops = roadStops();
  const i = stops.findIndex((id, j) => j + 1 < stops.length && !roadReach(id).has(stops[j + 1]));
  const goal = stops[i + 1];
  const end = truth(goal);
  const left = stepsLeft(end, cur.p.road.colors.map(opOf), cur.p.config);
  // Build from whichever dot of that stretch is closest to its goal,
  // preferring the newest.
  let best = null;
  for (const id of roadReach(stops[i]).keys()) {
    const d = left(truth(id));
    if (!best || d <= best.d) best = { id, d };
  }
  const v = truth(best.id);
  const next = (c) => { try { const w = ops.applyOp(opOf(c), v); return allowedValue(w) && left(w) === best.d - 1 ? w : null; } catch { return null; } };
  const color = cur.p.road.colors.find(next);
  const w = next(color);
  const name = nameOf(color).toLowerCase();
  const onto = [...cur.p.nodes.map((n) => n.id), ...board.extra.map((e) => e.id)].find((id) => rational.eq(truth(id), w));
  const op = opOf(color);
  const sum = `${fmtRat(v)} ${OPS[op.kind]} ${fmtRat(op.k)} = ${fmtRat(w)}`;
  return {
    custom: true,
    color,
    levels: {
      where: `Keep building from the ${fmtRat(v)} dot.`,
      how: `From ${fmtRat(v)}, the shortest road to ${fmtRat(end)} takes ${best.d} more arrow${best.d === 1 ? '' : 's'}. Try a ${name} arrow next.`,
      what: `Draw a ${name} arrow from ${fmtRat(v)} to ${onto ? 'the' : 'a new'} ${fmtRat(w)} dot: ${sum}.`,
    },
    nodes: (level) => new Set(level >= 3 && onto ? [best.id, onto] : [best.id]),
    apply() {
      if (onto) {
        board.drawn.push({ from: best.id, to: onto, color });
        if (extraDot(onto)) board.values[onto] = rational.format(w);
      } else {
        const { x, y } = spotNear(best.id, goal);
        board.values[addDot(best.id, color, x, y)] = rational.format(w);
      }
    },
  };
}

// ---- Welcome and new ideas -------------------------------------------------
// A first visit gets a short welcome. After that, the first time a puzzle
// uses an idea the player hasn't met (a mystery rule, a combined arrow, a
// road...), a card says what it is: what the thing means, never how to
// solve. Each is shown once, remembered in this browser.

const listWords = (xs, and) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${and} ${xs.at(-1)}` : xs[0] || '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Plain colors that never get an arrow of their own, only a step inside a
// combined arrow.
function insideOnly() {
  if (cur.p.road) return [];
  return cur.p.baseColors
    .filter((c) => !cur.p.arrows.some((a) => a.color === c))
    .map((c) => ({ id: c, in: cur.p.colors.filter((x) => x.composite?.includes(c)).map((x) => x.id) }))
    .filter((x) => x.in.length);
}

function ideasHere() {
  const p = cur.p;
  const low = (id) => nameOf(id).toLowerCase();
  const out = [];
  const combined = p.colors.filter((c) => c.composite);
  if (p.mystery.length) out.push(['mystery', 'A <b>?</b> rule is a mystery. Find arrows of that color where you know both numbers, and work out what the arrow does.']);
  if (combined.length) {
    const shown = combined.find((c) => !c.hidden);
    const what = shown
      ? `<b>${low(shown.id)} means ${shown.composite.map(low).join(' then ')}</b> does ${shown.composite.map((x) => `a ${low(x)} step`).join(', then ')}`
      : 'it does one color’s step, then the next';
    out.push(['combined', `A ${low(combined[0].id)} arrow is ${combined[0].composite.length > 2 ? 'several' : 'two'} arrows in one: ${what}. Click one to see it step by step.`]);
  }
  if (combined.length > 1) out.push(['several', `${cap(listWords(combined.slice(1).map((c) => low(c.id)), 'and'))} arrows are combined arrows too, each with its own recipe.`]);
  if (p.hidden.length) out.push(['secret', `The ${listWords(p.hidden.map(low), 'and')} arrow keeps its recipe secret. Pick its colors in order from the menus on the right.`]);
  for (const x of insideOnly().slice(0, 1)) out.push(['inside', `${nameOf(x.id)} has no arrows of its own here. It only appears as a step inside ${listWords(x.in.map(low), 'and')}.`]);
  if (p.draw) out.push(['missing', `Some ${low(p.draw.color)} arrows are missing. Press ${low(p.draw.color)}’s ✏️ Draw pen, click the dot where an arrow starts, then the dot where it ends. Each arrow is checked right away.`]);
  if (p.road) out.push(['road', 'Build a road of arrows from 🚗 to 🏁. Click a dot, then click an empty spot to make a new dot and type its number. Any road works; the shortest is a bonus.']);
  if (p.road?.via.length) out.push(['checkpoint', '⭐ marks a checkpoint: your road has to stop there on the way.']);
  if (p.road && p.arrows.length) out.push(['prebuilt', 'Arrows already in the picture can be part of your road.']);
  const blankEnds = p.road ? [p.road.from, p.road.to].filter((id) => !p.nodes.find((n) => n.id === id).given) : [];
  if (blankEnds.length) out.push(['blank-end', `The ${blankEnds.map((id) => (id === p.road.from ? '🚗' : '🏁')).join(' and ')} dot${blankEnds.length > 1 ? 's have' : ' has'} no number yet. Work ${blankEnds.length > 1 ? 'them' : 'it'} out first.`]);
  return out;
}

const EXAMPLE = `<svg viewBox="0 0 520 120" aria-hidden="true">
  <path d="M100 60 H220" style="stroke:var(--c-scarlet);stroke-width:3.2;fill:none"/><path d="M212 50 L232 60 L212 70 z" style="fill:var(--c-scarlet)"/>
  <path d="M298 60 H410" style="stroke:var(--c-yellow);stroke-width:3.2;stroke-dasharray:11 6;fill:none"/><path d="M402 50 L422 60 L402 70 z" style="fill:var(--c-yellow)"/>
  <circle cx="70" cy="60" r="28" style="fill:var(--dot-given);stroke:var(--ink);stroke-width:2.2"/><text x="70" y="60" dy="0.35em" text-anchor="middle" style="fill:var(--ink);font-size:24px;font-weight:700;font-family:var(--font-num)">3</text>
  <circle cx="260" cy="60" r="28" style="fill:var(--dot-given);stroke:var(--ink);stroke-width:2.2"/><text x="260" y="60" dy="0.35em" text-anchor="middle" style="fill:var(--ink);font-size:24px;font-weight:700;font-family:var(--font-num)">7</text>
  <circle cx="450" cy="60" r="28" style="fill:var(--board);stroke:var(--ink-soft);stroke-width:1.8;stroke-dasharray:4 4"/><text x="450" y="60" dy="0.35em" text-anchor="middle" style="fill:var(--ink-soft);font-size:24px;font-weight:700;font-family:var(--font-num)">?</text>
</svg>`;

function renderCards() {
  const dlg = $('card');
  const welcome = !store.get('ap:welcomed', false);
  // New ideas wait until the welcome is out of the way.
  const seen = new Set(store.get('ap:seen', []));
  const fresh = welcome ? [] : ideasHere().filter(([key]) => !seen.has(key));
  const kind = welcome ? 'welcome' : fresh.length ? 'idea' : '';
  if (!kind) {
    if (dlg.open) dlg.close();
    return;
  }
  const keys = fresh.map(([key]) => key).join(' ');
  if (dlg.dataset.kind !== kind || dlg.dataset.keys !== keys) {
    dlg.dataset.kind = kind;
    dlg.dataset.keys = keys;
    dlg.innerHTML = kind === 'welcome'
      ? `<h3 id="card-title">Welcome to Arrow Pictures!</h3>
        <p>Each color of arrow is a rule, like +4 or ×2, and every arrow of that color does the same thing. Use the rules to fill in the empty dots.</p>
        <div class="example">${EXAMPLE}<small><b style="color:var(--c-scarlet)">Scarlet</b> is +4 and <b style="color:var(--c-yellow)">yellow</b> is ×2, so the empty dot is 14.</small></div>
        <div class="row"><button data-card="welcome" autofocus>Got it</button><a href="about.html">More about how to play</a></div>`
      : `<div class="lvl">${cur.json.title}</div>
        <h3 id="card-title">New idea${fresh.length > 1 ? 's' : ''}</h3>
        ${fresh.length > 1 ? `<ul>${fresh.map(([, html]) => `<li>${html}</li>`).join('')}</ul>` : `<p>${fresh[0][1]}</p>`}
        <div class="row"><button data-card="idea" autofocus>Got it</button></div>`;
  }
  if (!dlg.open) dlg.showModal();
}

function dismissCard() {
  const dlg = $('card');
  if (dlg.dataset.kind === 'welcome') store.set('ap:welcomed', true);
  else store.set('ap:seen', [...new Set([...store.get('ap:seen', []), ...dlg.dataset.keys.split(' ').filter(Boolean)])]);
  dlg.dataset.kind = '';
  renderCards();
}

// The whole picture should be on screen without scrolling, whatever sits
// above it (instructions, a tip): it takes the height left between
// its top and the bottom of the window, less the status bar under it.
const BOARD_MIN = 300;
const BOARD_MAX = 760;
function fitBoard() {
  const svg = $('stage').querySelector('svg.board');
  if (!svg) return;
  const top = svg.getBoundingClientRect().top + scrollY;
  const room = innerHeight - top - $('status').offsetHeight - 28;
  svg.style.maxHeight = `${Math.round(Math.min(BOARD_MAX, Math.max(BOARD_MIN, room)))}px`;
}
addEventListener('resize', fitBoard);
document.fonts?.ready.then(fitBoard);

// ---- Rendering -------------------------------------------------------------

const fmtRat = (r) => pretty(rational.format(r));
const fmtOp = (op) => ops.formatOp(op, { pretty: true });

// Rules are shown with a big symbol and written out underneath, since + and ÷
// look alike at a glance: "÷2" reads "divided by 2".
const SAY = { '+': 'plus', '−': 'minus', '×': 'times', '÷': 'divided by' };
const splitOp = (s) => s.match(/^([+−×÷])\s*(.*)$/);
function opHtml(text) {
  const parts = text.split(' or ');
  const big = parts.map((s) => { const m = splitOp(s); return m ? `<span class="sym">${m[1]}</span>${m[2]}` : s; }).join(' or ');
  const words = parts.map((s) => { const m = splitOp(s); return m ? `${SAY[m[1]]} ${m[2]}`.trim() : ''; }).filter(Boolean);
  return `<span class="big">${big}</span>${words.length ? `<span class="say">${words.join(' or ')}</span>` : ''}`;
}
const nameOf = (colorId) => HUE_NAME[cur.styles.get(colorId).hue];

function swatch(colorId) {
  const st = cur.styles.get(colorId);
  const stroke = `var(--c-${st.hue})`;
  const head = `<path d="M44 4 L54 10 L44 16 z" style="fill:${stroke}${st.hue === 'white' ? ';stroke:var(--ink-soft);stroke-width:1.2' : ''}"/>`;
  if (st.composite) {
    const edge = st.hue === 'white' ? '<path d="M3 10 H46" style="stroke:var(--ink-soft);stroke-width:9.5;stroke-linecap:round;fill:none"/>' : '';
    return `<svg viewBox="0 0 56 20" aria-hidden="true">${edge}<path d="M3 10 H46" style="stroke:${stroke};stroke-width:7;stroke-linecap:round;fill:none"/><path d="M3 10 H46" style="stroke:var(--board);stroke-width:2.3;stroke-linecap:round;fill:none"/>${head}</svg>`;
  }
  const dash = st.dash ? `;stroke-dasharray:${st.dash}` : '';
  return `<svg viewBox="0 0 56 20" aria-hidden="true"><path d="M3 10 H46" style="stroke:${stroke};stroke-width:3.2;stroke-linecap:round;fill:none${dash}"/>${head}</svg>`;
}

function dotView(n) {
  if (n.given) return { kind: 'given', text: rational.format(n.given), label: `Dot showing ${fmtRat(n.given)}` };
  const text = board.values[n.id] || '';
  return { kind: text ? 'entered' : 'blank', text, label: text ? `Your dot: ${pretty(text)}` : 'Empty dot' };
}

// The picture as it stands: the puzzle's own dots and arrows, plus the dots
// and arrows the player has drawn, plus a refused arrow while it fades.
function boardModel() {
  const drawn = board.drawn.map((a, i) => ({ id: `d${i}`, ...a }));
  const refused = flash?.refused ? [{ id: 'refused', ...flash.refused }] : [];
  if (!board.extra.length && !drawn.length && !refused.length) return { p: cur.p, layout: cur.layout };
  const p = { ...cur.p, nodes: [...cur.p.nodes, ...board.extra.map((x) => ({ id: x.id, given: null }))], arrows: [...cur.p.arrows, ...drawn, ...refused] };
  const pos = { ...cur.layout.pos, ...Object.fromEntries(board.extra.map((x) => [x.id, { x: x.x, y: x.y }])) };
  const arrows = routeArrows(p, pos);
  let viewBox = cur.layout.viewBox;
  if (!cur.p.road) {
    // Grow to fit a drawn arrow that bends outside the picture, never shrink.
    const [ax, ay, aw, ah] = viewBox;
    const [bx, by, bw, bh] = frame(pos, arrows);
    const x = Math.min(ax, bx), y = Math.min(ay, by);
    viewBox = [x, y, Math.max(ax + aw, bx + bw) - x, Math.max(ay + ah, by + bh) - y];
  }
  return { p, layout: { pos, arrows, viewBox } };
}

function renderBoardView() {
  const { p, layout } = boardModel();
  const nodes = {};
  for (const n of p.nodes) nodes[n.id] = dotView(n);
  const wrongNodes = new Set([...shown].filter((k) => k.startsWith('node:')).map((k) => k.slice(5)));
  const arrowClass = {};
  const flashArrow = flash?.refused ? 'refused' : flash?.drawn !== undefined ? `d${flash.drawn}` : null;
  if (flashArrow) arrowClass[flashArrow] = flash.refused ? 'is-flash' : 'is-drawn';
  const at = flashArrow && layout.arrows.find((a) => a.id === flashArrow);
  const view = {
    nodes,
    selected: selected?.kind === 'node' ? selected.id : null,
    wrong: wrongNodes,
    hint: hintHighlight(),
    solved: progress.solved && !replay,
    from: pen?.from || null,
    marks: cur.p.road ? Object.fromEntries(roadStops().map((id, i, all) => [id, i === 0 ? '🚗' : i === all.length - 1 ? '🏁' : '⭐'])) : null,
    arrowClass,
    say: at ? { x: at.mid.x, y: Math.max(at.mid.y, layout.viewBox[1] + 50), text: flash.text, kind: flash.kind } : null,
  };
  const hadFocus = $('stage').contains(document.activeElement);
  $('stage').classList.toggle('is-drawing', !!pen);
  $('stage').innerHTML = renderBoard(p, layout, cur.styles, view);
  fitBoard();
  for (const g of $('stage').querySelectorAll('.arrow.road')) g.classList.add('can-investigate');
  if (hadFocus && selected?.kind === 'node') focusTarget(selected);
}

// ---- Investigate -------------------------------------------------------------
// Clicking a brown arrow opens it out over the picture as its separate steps,
// with a middle dot between each pair to work on. The middle dots are scratch
// paper: kept with the board, never checked. The end dots are the real ones.

let investigating = null; // arrow id, or null

function stepsOf(arrow) {
  if (!arrow.hidden) return arrow.chain;
  const r = board.recipes[arrow.color];
  return r && r.every(Boolean) ? r : null;
}

function ruleLabel(colorId) {
  const c = cur.p.colorById.get(colorId);
  if (c.op) return { text: fmtOp(c.op), guess: false };
  const text = board.rules[colorId];
  return text ? { text, guess: true } : { text: '?', guess: true };
}

function openInvestigate(arrowId) {
  investigating = arrowId;
  if (selected?.kind === 'scratch') selected = null;
  renderAll();
}

function closeInvestigate() {
  investigating = null;
  if (selected?.kind === 'scratch') selected = null;
  renderAll();
}

function renderInvestigate() {
  const box = $('investigate');
  box.hidden = !investigating;
  if (!investigating) return;
  const arrow = cur.p.arrows.find((a) => a.id === investigating);
  const steps = stepsOf(arrow);
  const name = nameOf(arrow.color);
  const head = `<div class="inv-head"><h3>Investigating ${arrow.hidden || cur.p.colorById.get(arrow.color).composite ? 'the' : 'a'} ${name.toLowerCase()} arrow</h3><button class="inv-close" data-inv="close">Back to the picture</button></div>`;
  if (!steps) {
    box.innerHTML = `${head}<p class="inv-help">This arrow hides its recipe. Choose its colors on the right first, then you can open it up here.</p>`;
    return;
  }
  const words = steps.map((s) => `<b>${nameOf(s)}</b>`).join(' then ');
  const mids = board.scratch[arrow.id] || [];
  const from = cur.p.nodes.find((n) => n.id === arrow.from);
  const to = cur.p.nodes.find((n) => n.id === arrow.to);
  const ids = [from.id, ...steps.slice(1).map((_, i) => `~${i}`), to.id];
  const GAP = 230;
  const pos = Object.fromEntries(ids.map((id, i) => [id, { x: i * GAP, y: 0 }]));
  const nodes = { [from.id]: dotView(from), [to.id]: dotView(to) };
  steps.slice(1).forEach((_, i) => {
    const text = mids[i] || '';
    nodes[`~${i}`] = { kind: text ? 'entered' : 'blank', text, label: text ? `Middle dot: ${pretty(text)}` : 'Empty middle dot' };
  });
  const mini = { nodes: ids.map((id) => ({ id, given: id === from.id ? from.given : id === to.id ? to.given : null })) };
  const arrows = steps.map((c, i) => ({ id: `s${i}`, color: c, d: `M${i * GAP + R + 4} 0 L${(i + 1) * GAP - R - 5} 0` }));
  const w = (ids.length - 1) * GAP;
  const layout = { viewBox: [-R - 30, -78, w + 2 * R + 60, 150], pos, arrows };
  const sel = selected?.kind === 'scratch' && selected.id.startsWith(`${arrow.id}:`) ? `~${splitKey(selected.id)[1]}`
    : selected?.kind === 'node' ? selected.id : null;
  const wrong = new Set([...shown].filter((k) => k.startsWith('node:')).map((k) => k.slice(5)));
  let svg = renderBoard(mini, layout, cur.styles, { nodes, selected: sel, wrong, hint: null, solved: false });
  const labels = steps.map((c, i) => {
    const x = i * GAP + GAP / 2;
    const hue = cur.styles.get(c).hue;
    const l = ruleLabel(c);
    const m = splitOp(pretty(l.text));
    const say = l.guess ? (l.text === '?' ? 'mystery rule' : 'your guess') : m ? `${SAY[m[1]]} ${m[2]}` : '';
    return `<text class="inv-rule${l.guess ? ' is-guess' : ''}" x="${x}" y="-22" style="fill:var(--c-${hue})">${pretty(l.text)}</text>
      <text class="inv-say" x="${x}" y="30">${nameOf(c)}${say ? ` · ${say}` : ''}</text>`;
  }).join('');
  const caps = ['start', ...steps.slice(1).map(() => 'middle dot'), 'end']
    .map((t, i) => `<text class="inv-cap" x="${i * GAP}" y="${R + 30}">${t}</text>`).join('');
  svg = svg.replace('</svg>', `<g class="inv-labels">${labels}${caps}</g></svg>`);
  const help = `${name} means ${words}. Fill in the middle dot to take it one step at a time. It’s scratch paper, so it isn’t checked.`;
  box.innerHTML = `${head}
    <p class="inv-help">${help}</p>
    <div class="inv-strip">${svg}</div>`;
}

function hintHighlight() {
  if (replay) return replay.hl;
  if (!hintState || hintState.h.fix) return null;
  if (hintState.h.custom) return { arrows: new Set(), nodes: hintState.h.nodes(hintState.level) };
  const s = hintState.h.step;
  const arrows = new Set(s.arrow ? [s.arrow] : s.arrows || []);
  if (s.target.kind === 'recipe' && arrows.size === 0) {
    for (const a of cur.p.arrows) if (a.color === s.target.id) arrows.add(a.id);
  }
  if (s.target.kind === 'color' && arrows.size === 0) {
    // Never point inside a hidden recipe: that would give it away.
    for (const a of cur.p.arrows) if (!a.hidden && a.chain?.includes(s.target.id)) arrows.add(a.id);
  }
  const nodes = new Set(s.target.kind === 'node' && hintState.level >= 2 ? [s.target.id] : []);
  return { arrows, nodes };
}

function renderRules() {
  const hintColor = replay ? replay.hl?.color
    : !hintState || hintState.h.fix ? null
    : hintState.h.custom ? (hintState.level >= 2 ? hintState.h.color : null)
    : hintState.h.step.target.kind !== 'node' ? hintState.h.step.target.id : null;
  $('rules').innerHTML = cur.p.colors.map((c) => {
    const name = nameOf(c.id);
    let val;
    if (c.hidden) {
      const chosen = board.recipes[c.id] || [];
      const slots = c.composite.map((_, i) => {
        const v = chosen[i] || '';
        const opts = ['<option value="">?</option>', ...cur.p.baseColors.map((b) => `<option value="${b}"${b === v ? ' selected' : ''}>${nameOf(b)}</option>`)];
        const sel = v ? ` style="--sel:var(--c-${cur.styles.get(v).hue})"` : '';
        return `<select class="${v ? 'has-value' : ''}" data-recipe="${c.id}" data-slot="${i}"${sel} aria-label="${name} step ${i + 1}" ${progress.solved ? 'disabled' : ''}>${opts.join('')}</select>`;
      });
      val = `<span class="recipe${shown.has(`recipe:${c.id}`) ? ' is-wrong' : ''}">${slots.join(' then ')}</span>`;
    } else if (c.composite) {
      val = `<span class="rule-val chain">means ${c.composite.map((x) => `<b>${nameOf(x)}</b>`).join(' then ')}</span>`;
    } else if (c.op) {
      val = `<span class="rule-val">${opHtml(fmtOp(c.op))}</span>`;
    } else {
      const text = board.rules[c.id] || '';
      const r = parseRuleText(text);
      const cls = ['slot', 'rule-val'];
      if (text) cls.push('has-value');
      if (r.parts.length > 1) cls.push('is-candidates');
      if (selected?.kind === 'color' && selected.id === c.id) cls.push('is-selected');
      if (shown.has(`color:${c.id}`)) cls.push('is-wrong');
      const shownText = text ? opHtml(text) : '<span class="q">?</span>';
      const label = text ? `${name} rule, your answer ${text}` : `${name} rule, not worked out yet`;
      val = `<button class="${cls.join(' ')}" data-color="${c.id}" aria-label="${label}" ${progress.solved ? 'disabled' : ''}>${shownText}</button>`;
    }
    const inside = insideOnly().find((x) => x.id === c.id);
    const nameText = (c.hidden ? `${name} means\u2026` : name) + (inside ? `<small class="inside">only inside ${listWords(inside.in.map((x) => nameOf(x).toLowerCase()), 'and')}</small>` : '');
    const on = pen?.color === c.id;
    const penBtn = penColors().includes(c.id)
      ? `<button class="pen${on ? ' is-on' : ''}" data-pen="${c.id}" aria-pressed="${on}" ${progress.solved ? 'disabled' : ''}>✏️ ${on ? 'Drawing' : 'Draw'}</button>`
      : '';
    return `<div class="rule-row${c.hidden ? ' is-recipe' : ''}${penBtn ? ' has-pen' : ''}${hintColor === c.id ? ' is-hint' : ''}">${swatch(c.id)}<span class="name">${nameText}</span>${val}${penBtn}</div>`;
  }).join('');
}

function renderKeys() {
  const kind = selected?.kind;
  const off = !selected || progress.solved ? 'disabled' : '';
  const k = (key, label, cls = '', aria = '') => `<button data-key="${key}" class="${cls}" ${off} ${aria ? `aria-label="${aria}"` : ''}>${label}</button>`;
  const digits = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];
  let html;
  if (kind === 'color') {
    html = [
      k('+', '+<small>plus</small>', 'op', 'add'), k('-', '−<small>minus</small>', 'op', 'subtract'), k('*', '×<small>times</small>', 'op', 'multiply'), k('/', '÷<small>divide</small>', 'op', 'divide'),
      ...digits.slice(0, 3).map((d) => k(d, d)), k('back', '⌫', 'small', 'delete'),
      ...digits.slice(3, 6).map((d) => k(d, d)), k('frac', 'a/b', 'small', 'fraction'),
      ...digits.slice(6).map((d) => k(d, d)), k('or', 'or', 'small', 'add another possibility'),
      k('0', '0', 'wide'), k('clear', 'Clear', 'small wide'),
    ];
  } else {
    html = [
      ...digits.slice(0, 3).map((d) => k(d, d)), k('back', '⌫', 'small', 'delete'),
      ...digits.slice(3, 6).map((d) => k(d, d)), k('neg', '±', '', 'make negative or positive'),
      ...digits.slice(6).map((d) => k(d, d)), k('frac', 'a/b', 'small', 'fraction'),
      k('0', '0', 'wide'), k('clear', 'Clear', 'small wide'),
    ];
  }
  $('keys').innerHTML = html.join('');
  const t = $('target');
  if (progress.solved) t.innerHTML = 'Solved. Pick another puzzle from the list.';
  else if (!selected && cur.p.road) t.innerHTML = 'Pick a <b>Draw</b> pen to start. New dots get their numbers typed in here.';
  else if (!selected) t.innerHTML = 'Tap an empty dot or a <b>?</b> rule to start.';
  else if (kind === 'node') t.innerHTML = 'Typing into the <b>selected dot</b>.';
  else if (kind === 'scratch') t.innerHTML = 'Typing into the <b>middle dot</b>. It’s scratch paper, so it isn’t checked.';
  else t.innerHTML = `Typing the <b>${nameOf(selected.id)}</b> rule. Not sure? Use <b>or</b> to list possibilities.`;
}

function renderHint() {
  const box = $('hintbox');
  const btn = $('hint');
  if (progress.solved) {
    box.hidden = true;
    btn.textContent = 'Hint';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  if (!hintState) {
    box.hidden = true;
    btn.textContent = 'Hint';
    return;
  }
  const { level, h } = hintState;
  box.hidden = false;
  if (h.fix) {
    const n = h.wrong.length;
    box.className = 'hint is-fix';
    box.innerHTML = `<div class="lvl">Fix this first</div>
      <p>${n === 1 ? 'One of your answers doesn’t fit' : `${n} of your answers don’t fit`}. It’s marked in red. Clear it and try again.</p>
      <button id="clear-wrong">Clear ${n === 1 ? 'it' : 'them'}</button>`;
    btn.textContent = 'Hint';
    return;
  }
  const titles = ['Where to look', 'How to work it out', 'The answer'];
  const texts = [h.levels.where, h.levels.how, h.levels.what];
  box.className = 'hint';
  box.innerHTML = `<div class="steps" aria-hidden="true">${[1, 2, 3].map((i) => `<span class="${i <= level ? 'on' : ''}"></span>`).join('')}</div>
    <div class="lvl">${titles[level - 1]}</div>
    ${texts.slice(0, level).map((t, i) => `<p${i < level - 1 ? ' style="color:var(--ink-soft)"' : ''}>${t}</p>`).join('')}
    ${level === 3 ? '<button id="apply-hint">Fill it in</button>' : ''}`;
  btn.textContent = level === 1 ? 'More help' : level === 2 ? 'Show answer' : 'Hint';
  btn.disabled = level === 3;
}

function renderStatus() {
  const el = $('status');
  const c = counts();
  el.className = 'status';
  let msg;
  let extra = '';
  if (replay) {
    el.classList.add('is-solved');
    msg = `Replaying your solve\u2026 step ${replay.n} of ${replay.total}`;
    extra = '<button id="skip" class="quiet">Skip</button>';
  } else if (progress.solved) {
    el.classList.add('is-solved');
    const mins = Math.max(1, Math.round(progress.activeMs / 60000));
    const n = cur.p.road && roadLength();
    const best = cur.p.road && cur.prep.road.best;
    msg = n ? `Your road takes ${n} arrow${n === 1 ? '' : 's'}${n === best ? ', the shortest there is!' : `; the shortest takes ${best}.`} ` : '';
    msg += `Solved in about ${mins} min${mins === 1 ? '' : 's'}${progress.hints ? `, with ${progress.hints} hint${progress.hints === 1 ? '' : 's'}` : ', no hints'}.`;
    extra = cur.p.road ? '' : '<button id="replay" class="quiet">Watch the replay</button>';
    if (library.length > 1) extra += '<button id="go-next">Next puzzle</button>';
  } else if (flash) {
    el.classList.add(flash.kind === 'ok' ? 'is-ok' : flash.kind === 'bad' ? 'has-wrong' : 'is-note');
    msg = pretty(flash.text);
  } else if (shown.size) {
    el.classList.add('has-wrong');
    msg = `${shown.size} answer${shown.size === 1 ? ' doesn’t' : 's don’t'} fit yet.`;
  } else {
    const parts = [];
    if (c.blanks) parts.push(`${c.filled} of ${c.blanks} dots filled`);
    if (c.rules) parts.push(`${c.rulesDone} of ${c.rules} rules found`);
    if (c.arrows) parts.push(`${c.arrows.found} of ${c.arrows.total} ${nameOf(cur.p.draw.color).toLowerCase()} arrows drawn`);
    if (cur.p.road) parts.push(`${board.drawn.length} arrow${board.drawn.length === 1 ? '' : 's'} drawn`);
    if (pen) {
      const name = nameOf(pen.color).toLowerCase();
      parts.unshift(pen.from
        ? `Now click the dot it ends at${cur.p.road ? ', or an empty spot for a new dot' : ''}.`
        : `Drawing ${name} arrows: click the dot an arrow starts at.`);
    }
    msg = parts.join(' · ');
  }
  el.innerHTML = `<span class="msg" id="msg">${msg}</span>${extra ? `<span class="status-actions">${extra}</span>` : ''}`;
}

function renderHeader() {
  const r = cur.report;
  const mode = MODES[r.mode];
  const recipeOnly = cur.p.hidden.length && !cur.p.mystery.length;
  $('mode').textContent = recipeOnly ? 'Find the recipe and the numbers' : mode.eyebrow;
  $('title').textContent = cur.json.title || `Puzzle ${idx + 1}`;
  const secret = cur.p.hidden.map((id) => nameOf(id).toLowerCase());
  const help = r.mode === 'mixed' && cur.p.mystery.length === 1 ? oneMystery : mode.help;
  $('instructions').textContent = secret.length
    ? `${recipeOnly ? MODES['find-values'].help : help} The ${secret.join(' and ')} arrow${secret.length > 1 ? 's hide their' : ' hides its'} recipe: choose which colors it uses, in order.`
    : help;
  const drawName = cur.p.draw && nameOf(cur.p.draw.color).toLowerCase();
  if (cur.p.draw) {
    const c = counts();
    $('mode').textContent = 'Find the missing arrows';
    $('instructions').textContent = `${c.blanks || c.rules ? `${$('instructions').textContent} Then draw` : 'Every number is shown. Draw'} every missing ${drawName} arrow: press ${drawName}’s Draw pen, click the dot an arrow starts at, then the dot it ends at.`;
  }
  if (cur.p.road) {
    const c = counts();
    const shownAt = (id) => { const n = cur.p.nodes.find((m) => m.id === id); return n.given ? ` ${fmtRat(n.given)}` : ''; };
    const via = cur.p.road.via.length;
    $('mode').textContent = 'Build a road';
    $('instructions').textContent = [
      `Build a road of arrows from 🚗${shownAt(cur.p.road.from)} to 🏁${shownAt(cur.p.road.to)}${via ? `, stopping at the ⭐ dot${via > 1 ? 's' : ''} on the way` : ''}.`,
      cur.p.mystery.length ? 'First work out the mystery rule from its arrows.' : '',
      c.blanks ? `Fill in the empty dots${cur.p.mystery.length ? ' too' : ''}.` : '',
      cur.p.arrows.length ? 'Arrows already drawn can be part of your road.' : '',
      'Press a color’s Draw pen, click a dot, then click an empty spot to make a new dot and type its number. Any road that gets there works.',
    ].filter(Boolean).join(' ');
  }
  const combined = cur.p.colors.filter((c) => c.composite).map((c) => nameOf(c.id).toLowerCase());
  if (combined.length) $('instructions').textContent += ` Stuck? Click a ${listWords(combined, 'or')} arrow to take it step by step.`;
  renderCards();
  $('tip').hidden = !cur.json.tip;
  $('tip').textContent = cur.json.tip || '';
  const n = r.difficulty.rating;
  const stars = $('stars');
  stars.innerHTML = `${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span>`;
  stars.setAttribute('aria-label', `Difficulty ${n} out of 5`);
  const c = counts();
  const nm = cur.p.mystery.length;
  const nr = cur.p.hidden.length;
  const nd = c.arrows?.total;
  $('counts').textContent = [cur.p.road && `The shortest road takes ${cur.prep.road.best} arrows`, c.blanks && `${c.blanks} empty dot${c.blanks === 1 ? '' : 's'}`, nm && `${nm} mystery rule${nm === 1 ? '' : 's'}`, nr && `${nr} secret recipe${nr === 1 ? '' : 's'}`,
      nd && `${nd} missing ${nameOf(cur.p.draw.color).toLowerCase()} arrow${nd === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const inTheme = library.filter((e) => e.theme === cur.theme).length;
  $('which').textContent = `${cur.theme.archive ? 'Archive: ' : ''}${cur.theme.title} · ${cur.pos + 1} of ${inTheme}`;
  $('prev').disabled = library.length < 2;
  $('next').disabled = library.length < 2;
  $('undo').disabled = hpos === 0 || progress.solved;
  $('redo').disabled = hpos >= history.length - 1 || progress.solved;
  $('check').disabled = progress.solved;
  $('instant').checked = settings.instant;
}

// The puzzle browser: a row per theme with how many of its puzzles are
// solved; a theme opens to show its puzzles. The theme being played opens
// by itself.
const openThemes = new Set();
function renderList() {
  openThemes.add(cur.theme.id);
  const solved = (e) => { const s = store.get(keyFor(e), null); return s?.solved && (!s.sig || s.sig === fingerprint(e.json)); };
  const cell = ([e, i]) => {
    const n = e.report.difficulty.rating;
    const done = solved(e);
    return `<button class="cell${done ? ' is-done' : ''}" data-go="${i}" aria-current="${i === idx}"
      aria-label="${e.json.title}, ${n} star${n === 1 ? '' : 's'}${done ? ', solved' : ''}">
      <span class="tick" aria-hidden="true">✓</span>
      <span class="t">${e.json.title}<span class="stars-sm">${'★'.repeat(n)}</span></span>
    </button>`;
  };
  const section = (theme) => {
    const items = library.map((e, i) => [e, i]).filter(([e]) => e.theme === theme);
    const n = items.filter(([e]) => solved(e)).length;
    return `<details class="theme" data-theme="${theme.id}"${openThemes.has(theme.id) ? ' open' : ''}>
      <summary>
        <span class="name"><b>${theme.title}</b><small>${theme.blurb}</small></span>
        <span class="tally${n === items.length ? ' is-all' : ''}">${n} of ${items.length}</span>
      </summary>
      <div class="cells">${items.map(cell).join('')}</div>
    </details>`;
  };
  const archive = THEMES.filter((t) => t.archive);
  $('list').innerHTML = THEMES.filter((t) => !t.archive).map(section).join('')
    + (archive.length ? `<h4 class="archive-label">Archive</h4>${archive.map(section).join('')}` : '');
  for (const d of $('list').querySelectorAll('details.theme')) {
    d.addEventListener('toggle', () => { if (d.open) openThemes.add(d.dataset.theme); else openThemes.delete(d.dataset.theme); });
  }
}

function renderAll() {
  renderHeader();
  renderBoardView();
  renderInvestigate();
  renderRules();
  renderKeys();
  renderHint();
  renderStatus();
}

// ---- Actions ---------------------------------------------------------------

function check() {
  shown = wrongEntries();
  renderAll();
  if (!shown.size) {
    const c = counts();
    const left = (c.blanks - c.filled) + (c.rules - c.rulesDone) + (c.arrows ? c.arrows.total - c.arrows.found : 0);
    $('msg').textContent = cur.p.road ? 'Every dot so far is right. Keep building!'
      : left ? `Everything so far is right. ${left} still to go.` : 'Everything is right.';
  }
}

function askHint() {
  if (progress.solved) return;
  if (hintState && !hintState.h.fix) {
    if (hintState.level < 3) { hintState.level++; progress.hints++; save(); renderAll(); }
    return;
  }
  const wrong = wrongEntries();
  progress.hints++;
  save();
  if (wrong.size) {
    shown = wrong;
    hintState = { level: 1, h: { fix: true, wrong: [...wrong] } };
  } else {
    const h = cur.prep.hint(engineBoard());
    hintState = { level: 1, h: h.done && cur.p.road ? roadHint() : h.done && cur.p.draw ? drawHint() : h };
  }
  renderAll();
}

function applyHint() {
  if (hintState?.h.custom) {
    hintState.h.apply();
    selected = null;
    commit();
    return;
  }
  const s = hintState?.h.step;
  if (!s) return;
  if (s.target.kind === 'node') board.values[s.target.id] = rational.format(s.value);
  else if (s.target.kind === 'recipe') board.recipes[s.target.id] = [...s.value];
  else board.rules[s.target.id] = fmtOp(s.value);
  selected = null;
  commit();
}

function clearWrong() {
  for (const k of shown) {
    const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (kind === 'node') delete board.values[id];
    else if (kind === 'recipe') delete board.recipes[id];
    else delete board.rules[id];
  }
  shown = new Set();
  commit();
}

function undo(dir) {
  const next = hpos + dir;
  if (next < 0 || next >= history.length || progress.solved) return;
  hpos = next;
  board = clone(history[hpos]);
  lastEdit = null;
  hintState = null;
  shown = settings.instant ? wrongEntries() : new Set();
  save();
  renderAll();
}

let resetTimer;
function reset() {
  const btn = $('reset');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Tap again to clear everything';
    resetTimer = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Start over'; }, 3500);
    return;
  }
  clearTimeout(resetTimer);
  btn.classList.remove('armed');
  btn.textContent = 'Start over';
  store.set(keyFor(cur), null);
  load(idx);
}

// ---- Celebration -----------------------------------------------------------

let replay = null;  // { skip, hl, n, total, wake } while a solve is replayed
let replayToken = 0;
let confetti = null; // the running party, until the player moves on

const splitKey = (k) => [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
function entryOf(b, key) {
  const [kind, id] = splitKey(key);
  return kind === 'node' ? b.values[id] : kind === 'color' ? b.rules[id] : b.recipes?.[id];
}
function putEntry(b, key, v) {
  const [kind, id] = splitKey(key);
  if (kind === 'node') b.values[id] = v;
  else if (kind === 'color') b.rules[id] = v;
  else b.recipes[id] = [...v];
}

// How hard each kind of step feels, for picking the one to point at.
const HARD = { forward: 1, backward: 2, 'composite-forward': 3, 'composite-backward': 4, pin: 5, 'composite-pin': 6, recipe: 6, guess: 7 };

// The player's answers in the order they got them right, each with the
// arrows that justify it at that moment.
function replaySteps(final) {
  const trace = cur.report.trace.flat();
  const keys = (progress.order || []).filter((k) => entryOf(final, k));
  for (const t of trace) if (!keys.includes(t.target) && entryOf(final, t.target)) keys.push(t.target);
  const partial = emptyBoard();
  return keys.map((key) => {
    const [kind, id] = splitKey(key);
    const { know } = readBoard(cur.p, cur.prep.solution, engineBoard(partial));
    const d = deductions(cur.p, know).find((x) => `${x.target.kind}:${x.target.id}` === key);
    let arrows = d ? (d.arrow ? [d.arrow] : d.arrows || []) : [];
    if (!arrows.length) {
      arrows = cur.p.arrows.filter((a) => (kind === 'node' ? a.from === id || a.to === id : a.color === id)).map((a) => a.id);
    }
    const t = trace.find((x) => x.target === key);
    const v = kind === 'node' ? t?.value || '' : '';
    const hard = (HARD[t?.type] || 1) + (v.includes('/') ? 0.5 : 0) + (v.startsWith('-') ? 0.3 : 0);
    putEntry(partial, key, entryOf(final, key));
    return { key, kind, id, arrows, hard };
  });
}

const pause = (ms) => new Promise((r) => {
  const t = setTimeout(r, ms);
  if (replay) replay.wake = () => { clearTimeout(t); r(); };
});

function skipReplay() {
  if (!replay) return;
  replay.skip = true;
  replay.wake?.();
}
function stopReplay() {
  confetti?.stop();
  confetti = null;
  replayToken++;
  replay?.wake?.();
  replay = null;
}

// Replay the solve, point at the trickiest step, then party.
async function celebrate() {
  if (replay) return;
  confetti?.stop();
  confetti = null;
  const token = ++replayToken;
  // A road has no deductions to replay.
  if (cur.p.road) { confetti = party(); return; }
  const final = clone(board);
  const steps = replaySteps(final);
  const hardest = steps.reduce((m, s, i) => (s.hard >= steps[m].hard ? i : m), 0);
  const alive = () => token === replayToken && replay && !replay.skip;
  replay = { skip: false, hl: null, n: 0, total: steps.length };
  board = { ...emptyBoard(), drawn: final.drawn };
  renderAll();
  await pause(700);
  for (let i = 0; i < steps.length && alive(); i++) {
    const s = steps[i];
    putEntry(board, s.key, entryOf(final, s.key));
    replay.n = i + 1;
    replay.hl = { arrows: new Set(s.arrows), nodes: new Set(s.kind === 'node' ? [s.id] : []), color: s.kind === 'node' ? null : s.id };
    renderAll();
    if (i === hardest) {
      const el = s.kind === 'node'
        ? $('stage').querySelector(`[data-node="${CSS.escape(s.id)}"] .ring`)
        : $('rules').querySelector(`[data-color="${CSS.escape(s.id)}"], [data-recipe="${CSS.escape(s.id)}"]`)?.closest('.rule-row');
      const remove = el ? showFinger(el, 'The trickiest step!') : () => {};
      await pause(3000);
      remove();
    } else {
      await pause(900);
    }
  }
  if (token !== replayToken) return;
  board = final;
  replay = null;
  renderAll();
  confetti = party();
}

// ---- Events ----------------------------------------------------------------

$('stage').addEventListener('click', (e) => {
  if (pen && !progress.solved) { penClick(e); return; }
  const road = e.target.closest('.arrow.road');
  if (road && !e.target.closest('[data-node]')) { openInvestigate(road.dataset.arrow); return; }
  const dot = e.target.closest('[data-node]');
  if (!dot) { if (selected?.kind === 'node') select(null); return; }
  const node = cur.p.nodes.find((n) => n.id === dot.dataset.node);
  if ((node && !node.given) || extraDot(dot.dataset.node)) select({ kind: 'node', id: dot.dataset.node });
});
$('stage').addEventListener('focusin', (e) => {
  // While drawing, the click decides what a dot does. Redrawing on focus
  // would replace the dot mid-click, and the browser would drop the click.
  if (pen) return;
  const dot = e.target.closest('[data-node][role="button"]');
  if (dot && targetKey(selected) !== `node:${dot.dataset.node}`) select({ kind: 'node', id: dot.dataset.node });
});
$('investigate').addEventListener('click', (e) => {
  if (e.target.closest('[data-inv="close"]')) { closeInvestigate(); return; }
  const dot = e.target.closest('[data-node]');
  if (!dot) return;
  const id = dot.dataset.node;
  if (id.startsWith('~')) select({ kind: 'scratch', id: `${investigating}:${id.slice(1)}` });
  else if (!cur.p.nodes.find((n) => n.id === id).given) select({ kind: 'node', id });
});
$('rules').addEventListener('click', (e) => {
  const penBtn = e.target.closest('[data-pen]');
  if (penBtn) { togglePen(penBtn.dataset.pen); return; }
  const slot = e.target.closest('[data-color]');
  if (slot) select({ kind: 'color', id: slot.dataset.color }, { focus: true });
});
$('rules').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-recipe]');
  if (!sel || progress.solved) return;
  const id = sel.dataset.recipe;
  const slot = Number(sel.dataset.slot);
  const r = [...(board.recipes[id] || [])];
  r[slot] = sel.value;
  if (r.some(Boolean)) board.recipes[id] = Array.from({ length: cur.p.colorById.get(id).composite.length }, (_, i) => r[i] || '');
  else delete board.recipes[id];
  shown.delete(`recipe:${id}`);
  selected = null;
  commit();
  $('rules').querySelector(`[data-recipe="${CSS.escape(id)}"][data-slot="${slot}"]`)?.focus({ preventScroll: true });
});
$('keys').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (b) press(b.dataset.key);
});
$('check').addEventListener('click', check);
$('hint').addEventListener('click', askHint);
$('undo').addEventListener('click', () => undo(-1));
$('redo').addEventListener('click', () => undo(1));
$('reset').addEventListener('click', reset);
$('instant').addEventListener('change', (e) => {
  settings.instant = e.target.checked;
  store.set('ap:settings', settings);
  shown = settings.instant ? wrongEntries() : new Set();
  if (settings.instant && selected) shown.delete(targetKey(selected));
  renderAll();
});
$('card').addEventListener('click', (e) => { if (e.target.closest('[data-card]')) dismissCard(); });
// Escape closes it too, and counts as Got it.
$('card').addEventListener('cancel', (e) => { e.preventDefault(); dismissCard(); });
$('hintbox').addEventListener('click', (e) => {
  if (e.target.id === 'apply-hint') applyHint();
  if (e.target.id === 'clear-wrong') clearWrong();
});
$('status').addEventListener('click', (e) => {
  if (e.target.id === 'go-next') load(idx + 1);
  if (e.target.id === 'replay') { e.stopPropagation(); celebrate(); }
});
// While replaying, any click or Escape skips to the party.
document.addEventListener('click', () => skipReplay());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') skipReplay(); });
$('prev').addEventListener('click', () => load(idx - 1));
$('next').addEventListener('click', () => load(idx + 1));
$('which').addEventListener('click', () => {
  const list = $('list');
  list.hidden = !list.hidden;
  $('which').setAttribute('aria-expanded', String(!list.hidden));
  if (!list.hidden) { renderList(); list.querySelector('[aria-current="true"]')?.focus(); }
});
$('list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  $('list').hidden = true;
  $('which').setAttribute('aria-expanded', 'false');
  load(Number(b.dataset.go));
});
document.addEventListener('click', (e) => {
  if (!$('list').hidden && !e.target.closest('.nav')) { $('list').hidden = true; $('which').setAttribute('aria-expanded', 'false'); }
});

document.addEventListener('keydown', (e) => {
  if ($('card').open) return;
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.target.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return; // let buttons click
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (!$('list').hidden) { $('list').hidden = true; $('which').focus(); return; }
    if (investigating) { closeInvestigate(); return; }
    if (pen) { if (pen.from) pen.from = null; else pen = null; renderAll(); return; }
    if (selected) select(null);
    return;
  }
  if (!selected) return;
  const kind = selected.kind;
  let key = null;
  if (/^\d$/.test(e.key)) key = e.key;
  else if (e.key === '-') key = kind !== 'color' ? 'neg' : '-';
  else if (e.key === '+' && kind === 'color') key = '+';
  else if ((e.key === '*' || e.key === 'x' || e.key === 'X') && kind === 'color') key = '*';
  else if (e.key === '/') {
    const text = board.rules[selected.id] || '';
    key = kind !== 'color' || /\d$/.test(text) ? 'frac' : '/';
  } else if (e.key === 'o' && kind === 'color') key = 'or';
  else if (e.key === 'Backspace') key = 'back';
  else if (e.key === 'Delete') key = 'clear';
  else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); return; }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); return; }
  if (key) { e.preventDefault(); press(key); }
});

// ---- Start -----------------------------------------------------------------

if (!library.length) {
  $('stage').innerHTML = '<div class="empty">No puzzles passed the checker, so there is nothing to show.</div>';
} else {
  // Open on the last puzzle visited, or the first unsolved one. The first
  // theme (Lots of Dots) shows every rule, so someone new learns what arrows
  // do before meeting mystery rules.
  const last = library.findIndex((e) => e.json.id === store.get('ap:last', null));
  const firstUnsolved = library.findIndex((e) => !store.get(keyFor(e), null)?.solved);
  load(last >= 0 ? last : Math.max(0, firstUnsolved));
}
