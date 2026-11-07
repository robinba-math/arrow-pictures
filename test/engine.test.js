import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { rat, add, div, eq, parse, format } from '../engine/rational.js';
import { family, parseOp, formatOp, applyOp, invertOp, opKey } from '../engine/ops.js';
import { checkPuzzle, prepare } from '../engine/index.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../puzzles/${path}`, import.meta.url), 'utf8'));
const codes = (r) => r.errors.map((e) => e.code);

test('rationals normalize sign and common factors', () => {
  assert.deepEqual(rat(6, -8), { n: -3, d: 4 });
  assert.ok(eq(add(rat(1, 3), rat(1, 6)), rat(1, 2)));
  assert.ok(eq(div(rat(3), rat(2)), rat(3, 2)));
  assert.throws(() => rat(1, 0));
});

test('rationals parse and format round-trip, including the Unicode minus', () => {
  for (const s of ['7', '-3', '3/4', '-1/2']) assert.equal(format(parse(s)), s);
  assert.equal(format(parse('−5')), '-5');
  assert.equal(format(parse(' 6/8 ')), '3/4');
  assert.throws(() => parse('1.5'));
  assert.throws(() => parse(1.5));
});

test('operations parse every notation a person might type', () => {
  for (const [s, key] of [['+3', '+3'], ['-3', '-3'], ['−3', '-3'], ['*2', '*2'], ['x2', '*2'], ['×2', '*2'], ['/2', '/2'], ['÷2', '/2'], ['+1/2', '+1/2']]) {
    assert.equal(opKey(parseOp(s)), key, s);
  }
  assert.throws(() => parseOp('*1'), /identity/);
  assert.throws(() => parseOp('+0'));
  assert.equal(formatOp(parseOp('/3'), { pretty: true }), '÷3');
});

test('every operation inverts exactly', () => {
  const v = rat(7, 3);
  for (const op of family({ kDens: [1, 2] })) assert.ok(eq(invertOp(op, applyOp(op, v)), v), opKey(op));
});

test('the rule family has no two operations that are the same function', () => {
  const ops = family({ kDens: [1, 2, 3] });
  const probes = [rat(1), rat(2), rat(-5, 3)];
  const sigs = ops.map((op) => probes.map((v) => format(applyOp(op, v))).join(','));
  assert.equal(new Set(sigs).size, ops.length);
  assert.equal(family().length, 12 + 12 + 11 + 11);
});

test('every library puzzle passes with no warnings', () => {
  const files = readdirSync(new URL('../puzzles/', import.meta.url), { recursive: true })
    .filter((f) => f.endsWith('.json') && !f.startsWith('fixtures') && f !== 'library.json');
  assert.ok(files.length >= 40);
  for (const f of files) {
    const r = checkPuzzle(load(f));
    assert.ok(r.ok, `${f}: ${JSON.stringify(r.errors)}`);
    assert.deepEqual(r.warnings, [], f);
  }
});

test('one arrow with both ends known does not pin a rule', () => {
  const r = checkPuzzle(load('fixtures/single-arrow-ambiguity.json'));
  assert.deepEqual(codes(r), ['multiple-solutions']);
  assert.match(r.errors[0].message, /\+4 or \*2/);
});

test('a group with no given value is rejected', () => {
  assert.deepEqual(codes(checkPuzzle(load('fixtures/unanchored.json'))), ['unanchored']);
});

test('a composite cycle is reported once', () => {
  assert.deepEqual(codes(checkPuzzle(load('fixtures/composite-cycle.json'))), ['composite-cycle']);
});

test('contradictory numbers have no solution', () => {
  assert.deepEqual(codes(checkPuzzle(load('fixtures/no-solution.json'))), ['no-solution']);
});

test('a unique puzzle that needs a hypothesis passes with a case-split warning', () => {
  const r = checkPuzzle(load('fixtures/needs-a-guess.json'));
  assert.ok(r.ok);
  assert.deepEqual(r.warnings.map((w) => w.code), ['disconnected', 'case-split']);
  assert.equal(r.difficulty.signals.caseSplits, 1);
  assert.deepEqual(r.solution.colors, { red: '*2', blue: '+3' });
});

test('the denominator cap prunes values rather than crashing', () => {
  const halve = (n) => ({
    nodes: [{ id: 'n0', value: 1 }, ...Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}` }))],
    colors: [{ id: 'red', op: '/2' }],
    arrows: Array.from({ length: n }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, color: 'red' })),
  });
  assert.ok(checkPuzzle(halve(3)).ok); // reaches 1/8
  assert.deepEqual(codes(checkPuzzle(halve(4))), ['no-solution']); // 1/16 exceeds the cap of 12
});

test('fractional constants are found when the family allows them', () => {
  const r = checkPuzzle({
    ops: { kDens: [1, 2], fractions: 'any' },
    nodes: [{ id: 'a', value: 1 }, { id: 'b', value: '3/2' }, { id: 'c', value: 4 }, { id: 'd', value: '9/2' }],
    colors: [{ id: 'red' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'c', to: 'd', color: 'red' }],
  });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.solution.colors.red, '+1/2');
});

test('composite arrows run in order: red then blue differs from blue then red', () => {
  const base = (composite) => ({
    nodes: [{ id: 'a', value: 4 }, { id: 'b' }],
    colors: [{ id: 'red', op: '*3' }, { id: 'blue', op: '-2' }, { id: 'gray', composite }],
    arrows: [{ from: 'a', to: 'b', color: 'gray' }],
  });
  assert.equal(checkPuzzle(base(['red', 'blue'])).solution.nodes.b, '10');
  assert.equal(checkPuzzle(base(['blue', 'red'])).solution.nodes.b, '6');
});

test('hints offer the easiest step, show the arithmetic, and flag wrong entries', () => {
  const { hint } = prepare(load('archive/first-set/03-gray-shortcut.json'));
  const first = hint({});
  assert.equal(first.step.type, 'forward');
  assert.equal(first.levels.what, '12 − 2 = 10, so that dot is 10.');

  const later = hint({ values: { c: '10', f: '5' }, rules: { scarlet: '×3' } });
  assert.deepEqual(later.wrong.map((w) => w.id), ['f']);
  assert.equal(later.step.type, 'composite-backward');
  assert.equal(later.levels.what, '4 + 2 = 6, then 6 ÷ 3 = 2, so that dot is 2.');

  assert.ok(hint({ values: { c: '10', f: '2' }, rules: { scarlet: '*3' } }).done);
});

test('an unreadable entry is reported, not thrown', () => {
  const { hint } = prepare(load('archive/first-set/01-warm-up.json'));
  const h = hint({ values: { b: 'five' } });
  assert.deepEqual(h.wrong, [{ kind: 'node', id: 'b', reason: 'unreadable', entered: 'five' }]);
});

test('a picture in separate groups is warned about, a connected one is not', () => {
  const r = checkPuzzle(load('fixtures/needs-a-guess.json'));
  assert.match(r.warnings.find((w) => w.code === 'disconnected').message, /3 separate groups/);
  assert.ok(!checkPuzzle(load('archive/first-set/03-gray-shortcut.json')).warnings.some((w) => w.code === 'disconnected'));
});

test('a rule settled by one arrow alone fails, even when the size limit would settle it', () => {
  const r = checkPuzzle(load('fixtures/needs-range.json')); // 9 -> 36: x4 only if rules stop at 12
  assert.deepEqual(codes(r), ['needs-two-arrows']);
});

test('two arrows from different numbers settle a rule; one arrow never does', () => {
  // 5 -> 7 alone could be +2, or x3 then -8, or x7/5: not settled.
  const one = checkPuzzle({
    nodes: [{ id: 'a', value: 5 }, { id: 'b', value: 7 }, { id: 'd' }],
    colors: [{ id: 'red' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'b', to: 'd', color: 'red' }],
  });
  assert.deepEqual(codes(one), ['needs-two-arrows']);
  // 19 -> 16 and 10 -> 7: only subtract 3 fits both, even allowing combinations.
  const two = checkPuzzle({
    nodes: [{ id: 'a', value: 19 }, { id: 'b', value: 16 }, { id: 'c', value: 10 }, { id: 'd', value: 7 }, { id: 'e' }],
    colors: [{ id: 'red' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'c', to: 'd', color: 'red' }, { from: 'b', to: 'e', color: 'red' }, { from: 'e', to: 'c', color: 'red' }],
  });
  assert.ok(two.ok, JSON.stringify(two.errors));
  assert.equal(two.solution.colors.red, '-3');
  assert.equal(two.trace[0][0].type, 'pin');
});

test('multiplying by a negative is never a rule, not even as a mix of steps', () => {
  assert.throws(() => parseOp('*-5'));
  // 1 -> -5 and 3 -> -15 fit only x-5, which no mix of allowed steps makes.
  const neg = checkPuzzle({
    nodes: [{ id: 'a', value: 1 }, { id: 'b', value: -5 }, { id: 'c', value: 3 }, { id: 'd', value: -15 }],
    colors: [{ id: 'red' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'c', to: 'd', color: 'red' }],
  });
  assert.ok(!neg.ok);
  // 1 -> -5 and 2 -> -4: subtract 6, settled without ever weighing x-5.
  const sub6 = checkPuzzle({
    nodes: [{ id: 'a', value: 1 }, { id: 'b', value: -5 }, { id: 'c', value: 2 }, { id: 'd', value: -4 }],
    colors: [{ id: 'red' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'c', to: 'd', color: 'red' }],
  });
  assert.ok(sub6.ok, JSON.stringify(sub6.errors));
  assert.equal(sub6.solution.colors.red, '-6');
});

test('the fraction level allows fractions between -1 and 1, including hidden middle numbers', () => {
  const r = checkPuzzle(load('fixtures/improper-fraction.json'));
  assert.deepEqual(codes(r), ['fraction-level']);
  assert.match(r.errors[0].message, /passes through 11\/2/);
  const ok = checkPuzzle({
    nodes: [{ id: 'a', value: 1 }, { id: 'b' }, { id: 'c' }],
    colors: [{ id: 'red', op: '/2' }, { id: 'blue', op: '-1' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'b', to: 'c', color: 'blue' }],
  });
  assert.ok(ok.ok, JSON.stringify(ok.errors)); // 1/2 then -1/2 are both allowed
  const harder = checkPuzzle({
    ops: { fractions: 'any' },
    nodes: [{ id: 'a', value: 3 }, { id: 'b' }],
    colors: [{ id: 'red', op: '/2' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }],
  });
  assert.ok(harder.ok); // 3/2 is fine once a puzzle opts into the harder level
});

test('colors that repeat or undo each other are flagged, including combined arrows', () => {
  const redundant = (colors, arrows) => {
    const r = checkPuzzle({ nodes: [{ id: 'a', value: 4 }, { id: 'b' }, { id: 'c' }], colors, arrows });
    assert.ok(r.ok, JSON.stringify(r.errors));
    return r.warnings.filter((w) => w.code === 'redundant-colors').map((w) => w.message);
  };
  const road = [{ from: 'a', to: 'b', color: 'red' }, { from: 'b', to: 'c', color: 'blue' }];

  // Halving then doubling: blue only undoes red.
  assert.match(redundant([{ id: 'red', op: '/2' }, { id: 'blue', op: '*2' }], road)[0], /blue \(\*2\) just undoes red/);

  // A combined arrow whose steps cancel out.
  assert.match(
    redundant([{ id: 'red', op: '+3' }, { id: 'blue', op: '-3' }, { id: 'gray', composite: ['red', 'blue'] }],
      [...road, { from: 'a', to: 'c', color: 'gray' }]).join(' '),
    /gray \(\+3 then -3\) leaves every number unchanged/,
  );

  // A combined arrow that adds something new is fine.
  assert.deepEqual(
    redundant([{ id: 'red', op: '*2' }, { id: 'blue', op: '+2' }, { id: 'gray', composite: ['red', 'blue'] }],
      [...road, { from: 'a', to: 'c', color: 'gray' }]),
    [],
  );
});

test('a hidden recipe must be the only choice that fits, order included', () => {
  const puzzle = (ops) => ({
    nodes: [{ id: 'a', value: '6' }, { id: 'b' }, { id: 'c' }],
    colors: [{ id: 'red', op: ops[0] }, { id: 'blue', op: ops[1] }, { id: 'gray', composite: ['red', 'blue'], hidden: true }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'b', to: 'c', color: 'blue' }, { from: 'a', to: 'c', color: 'gray' }],
  });
  const r = checkPuzzle(puzzle(['*2', '-5']));
  assert.deepEqual(codes(r), []);
  assert.equal(r.solution.recipes.gray, 'red then blue');
  assert.ok(r.trace.flat().some((s) => s.type === 'recipe'));

  // +3 then −1 is the same as −1 then +3, so the order can't be worked out.
  assert.deepEqual(codes(checkPuzzle(puzzle(['+3', '-1']))), ['multiple-solutions']);

  const { hint } = prepare(puzzle(['*2', '-5']));
  const h = hint({ values: { b: '12', c: '7' } });
  assert.equal(h.step.type, 'recipe');
  assert.equal(h.levels.what, 'gray means red then blue: 6 × 2 = 12, then 12 − 5 = 7.');
  assert.deepEqual(hint({ values: { b: '12', c: '7' }, recipes: { gray: ['blue', 'red'] } }).wrong.map((w) => w.kind), ['recipe']);
  assert.ok(hint({ values: { b: '12', c: '7' }, recipes: { gray: ['red', 'blue'] } }).done);
});

test('a missing-arrows puzzle asks for every true arrow of its color that is not drawn', () => {
  const puzzle = (extra = []) => ({
    nodes: [{ id: 'a', value: '1' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    colors: [{ id: 'red', op: '+1' }, { id: 'blue', op: '+2' }],
    arrows: [{ from: 'a', to: 'b', color: 'red' }, { from: 'b', to: 'c', color: 'red' }, { from: 'c', to: 'd', color: 'red' }, { from: 'a', to: 'c', color: 'blue' }, ...extra],
    draw: { color: 'blue' },
  });
  const r = checkPuzzle(puzzle());
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.draw.missing, [{ from: 'b', to: 'd', color: 'blue' }]);
  assert.equal(r.difficulty.signals.missingArrows, 1);
  assert.deepEqual(codes(checkPuzzle(puzzle([{ from: 'b', to: 'd', color: 'blue' }]))), ['nothing-to-draw']);
  assert.deepEqual(codes(checkPuzzle({ ...puzzle(), draw: { color: 'green' } })), ['draw-color']);
});

test('a road puzzle finds the shortest road, and whether it must detour or go below zero', () => {
  const road = (a, b, colorOps, extra = {}) => ({
    ops: { maxAbs: 60, fractions: 'none' },
    nodes: [{ id: 'a', value: a }, { id: 'b', value: b }],
    colors: colorOps.map((op, i) => ({ id: ['red', 'blue', 'green'][i], op })),
    arrows: [],
    road: { from: 'a', to: 'b', colors: ['red', 'blue', 'green'].slice(0, colorOps.length) },
    ...extra,
  });
  // CSMP's example: from 2 to 23 with +5 and −2 takes five +5s and two −2s.
  const r = checkPuzzle(road('2', '23', ['+5', '-2']));
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.road.best, 7);
  assert.equal(r.road.ways, 21);
  assert.equal(r.road.detour, false);
  // 9 to 15 with +7 and −3: the road has to swing past 15 and come back.
  assert.equal(checkPuzzle(road('9', '15', ['+7', '-3'])).road.detour, true);
  assert.equal(checkPuzzle(road('6', '-40', ['*2', '-5', '+2'])).road.belowZero, true);
  assert.deepEqual(codes(checkPuzzle(road('2', '7', ['+5', '-2']))), ['road-too-short']);
  assert.deepEqual(codes(checkPuzzle(road('2', '7', ['*2', '*4']))), ['no-road']);
  assert.deepEqual(codes(checkPuzzle({ ...road('2', '23', ['+5', '-2']), road: { from: 'a', to: 'b', colors: [] } })), ['road-colors']);
});

test('a road can stop at checkpoints, follow arrows already drawn, and start or end at a dot to work out', () => {
  const trip = (extra) => ({
    ops: { maxAbs: 60, fractions: 'none' },
    colors: [{ id: 'red', op: '+10' }, { id: 'blue', op: '+2' }],
    ...extra,
  });
  // Through a checkpoint: 3 to 37 by way of 17, which a clue arrow from 7 gives.
  const r = checkPuzzle(trip({
    nodes: [{ id: 's', value: '3' }, { id: 'c' }, { id: 'k', value: '7' }, { id: 'e', value: '37' }],
    arrows: [{ from: 'k', to: 'c', color: 'red' }],
    road: { from: 's', via: ['c'], to: 'e', colors: ['red', 'blue'] },
  }));
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.solution.nodes.c, '17');
  assert.equal(r.road.best, 5);
  // 3 → 5 → 7, then the clue's own arrow to 17 for free, then 27, 37.
  assert.equal(r.road.toDraw, 4);
  // A broken road: both halves are drawn, their dots are blank.
  const fix = checkPuzzle(trip({
    nodes: [{ id: 's', value: '3' }, { id: 'a' }, { id: 'b' }, { id: 'e', value: '35' }],
    arrows: [{ from: 's', to: 'a', color: 'red' }, { from: 'b', to: 'e', color: 'red' }],
    road: { from: 's', to: 'e', colors: ['red', 'blue'] },
  }));
  assert.deepEqual(codes(fix), []);
  assert.deepEqual([fix.solution.nodes.a, fix.solution.nodes.b], ['13', '25']);
  assert.equal(fix.road.toDraw, fix.road.best - 2);
  assert.deepEqual(codes(checkPuzzle(trip({
    nodes: [{ id: 's', value: '3' }, { id: 'e', value: '37' }],
    arrows: [],
    road: { from: 's', via: ['s'], to: 'e', colors: ['red', 'blue'] },
  }))), ['road-ends']);
});
