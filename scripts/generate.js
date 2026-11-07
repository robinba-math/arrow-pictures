// Puzzle generator. Grows a connected picture from a hidden true answer, then
// strips numbers away one at a time, keeping a removal only while the engine
// still proves exactly one solution reachable without guessing. Runs many
// candidates and prints the most interesting.
//
//   node scripts/generate.js <recipe> [--tries 2000] [--top 6] [--seed 1] [--out dir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { checkPuzzle, rational, ops, shortestRoad, loadPuzzle } from '../engine/index.js';
import { levelProblem } from '../engine/puzzle.js';

const { rat, format } = rational;

// Recipes set the flavour. Op constants stay small so arithmetic is not the obstacle.
const RECIPES = {
  'gentle': {
    about: 'two known rules, a short picture; a warm-up',
    colors: ['scarlet', 'yellow'], hide: [], composite: null,
    nodes: [5, 6], closures: [0, 1], maxDen: 1, maxAbs: 40,
  },
  'rule-web': {
    about: 'three mystery rules, everything else shown or deducible',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['scarlet', 'yellow', 'purple'], composite: null,
    nodes: [7, 9], closures: [1, 3], maxDen: 1, maxAbs: 60,
  },
  'road-and-rules': {
    about: 'two rules (one mystery) plus a combined arrow',
    colors: ['scarlet', 'yellow'], hide: ['scarlet'], composite: ['scarlet', 'yellow'],
    nodes: [7, 9], closures: [1, 2], maxDen: 1, maxAbs: 60,
  },
  'double-mystery-road': {
    about: 'two mystery rules and a combined arrow built from both',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['scarlet', 'yellow'], composite: ['scarlet', 'yellow'],
    nodes: [8, 10], closures: [1, 3], maxDen: 1, maxAbs: 80,
  },
  'fraction-trail': {
    about: 'known rules with halving and thirding, few givens, lots of reverse steps',
    colors: ['scarlet', 'yellow', 'purple'], hide: [], composite: null, fracOps: true,
    nodes: [7, 9], closures: [1, 2], maxDen: 12, maxAbs: 40,
  },
  'below-zero': {
    about: 'subtraction-heavy rules that cross zero, one mystery',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['purple'], composite: null, negative: true,
    nodes: [7, 9], closures: [1, 3], maxDen: 1, maxAbs: 40,
  },
  'secret-recipe': {
    about: 'known rules, but the combined arrow hides which colors it uses and in what order',
    colors: ['scarlet', 'yellow'], hide: [], composite: ['scarlet', 'yellow'], hiddenRecipe: true,
    nodes: [7, 9], closures: [1, 2], maxDen: 1, maxAbs: 60,
  },
  'secret-recipe-plus': {
    about: 'a hidden recipe and a mystery rule',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['purple'], composite: ['yellow', 'scarlet'], hiddenRecipe: true,
    nodes: [8, 10], closures: [1, 3], maxDen: 1, maxAbs: 60,
  },
  'x-treme': {
    about: 'three mystery rules and a secret recipe; the very hardest',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow', 'purple'], composite: ['purple', 'scarlet'], hiddenRecipe: true,
    nodes: [10, 12], closures: [2, 4], maxDen: 1, maxAbs: 90,
  },
  'x-treme-below-zero': {
    about: 'two mystery rules, a secret recipe and numbers below zero',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow'], composite: ['yellow', 'purple'], hiddenRecipe: true, negative: true,
    nodes: [10, 12], closures: [2, 4], maxDen: 1, maxAbs: 60,
  },
  'grand-tour': {
    about: 'three mystery rules and a combined arrow; the hardest',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow', 'purple'], composite: ['purple', 'scarlet'],
    nodes: [9, 11], closures: [2, 4], maxDen: 1, maxAbs: 90,
  },

  // Themes. Each theme has a recipe per star level; generate with
  // --rating N to keep only puzzles the engine rates at that level.
  // Mastermind Mysteries: very few dots, mostly working out rules.
  'mm-1': { about: 'Mastermind 1: two mystery rules, a tiny picture',
    colors: ['scarlet', 'yellow'], hide: ['scarlet', 'yellow'], composite: null,
    nodes: [3, 4], closures: [0, 1], maxDen: 1, maxAbs: 40, maxBlanks: 1, keepGivens: true, minArrows: 3 },
  'mm-2': { about: 'Mastermind 2: three mystery rules',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['scarlet', 'yellow', 'purple'], composite: null,
    nodes: [4, 5], closures: [0, 1], maxDen: 1, maxAbs: 50, maxBlanks: 1, minArrows: 4 },
  'mm-3': { about: 'Mastermind 3: three mystery rules, a loop or two',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['scarlet', 'yellow', 'purple'], composite: null,
    nodes: [5, 6], closures: [1, 2], maxDen: 1, maxAbs: 60, maxBlanks: 2 },
  'mm-4': { about: 'Mastermind 4: three mystery rules and a brown arrow made of two',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow', 'purple'], composite: ['scarlet', 'purple'],
    nodes: [5, 7], closures: [1, 3], maxDen: 1, maxAbs: 80, maxBlanks: 2 },
  'mm-5': { about: 'Mastermind 5: mystery rules, a secret recipe, below zero',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow', 'purple'], composite: ['yellow', 'scarlet'], hiddenRecipe: true, negative: true,
    nodes: [7, 9], closures: [2, 4], maxDen: 1, maxAbs: 80, maxBlanks: 4 },
  // Arrows and Nodes: rules to find and dots to fill.
  'an-1': { about: 'Arrows and Nodes 1: one mystery rule, a few dots',
    colors: ['scarlet', 'yellow'], hide: ['yellow'], composite: null,
    nodes: [5, 6], closures: [0, 1], maxDen: 1, maxAbs: 40, minBlanks: 2 },
  'an-2': { about: 'Arrows and Nodes 2: one mystery among three',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['purple'], composite: null,
    nodes: [6, 8], closures: [1, 2], maxDen: 1, maxAbs: 50, minBlanks: 3 },
  'an-3': { about: 'Arrows and Nodes 3: a mystery rule and a brown road',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['yellow'], composite: ['scarlet', 'yellow'],
    nodes: [7, 9], closures: [1, 2], maxDen: 1, maxAbs: 60, minBlanks: 3 },
  'an-4': { about: 'Arrows and Nodes 4: two mysteries, below zero',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'purple'], composite: ['purple', 'yellow'], negative: true,
    nodes: [8, 10], closures: [1, 3], maxDen: 1, maxAbs: 60, minBlanks: 4 },
  'an-5': { about: 'Arrows and Nodes 5: three mysteries and a brown road',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow', 'purple'], composite: ['yellow', 'purple'],
    nodes: [10, 12], closures: [2, 4], maxDen: 1, maxAbs: 90, minBlanks: 4 },
  // Lots of Dots: every rule shown, lots of numbers to work out.
  'ld-1': { about: 'Lots of Dots 1: two rules, ten-ish dots, all forward',
    colors: ['scarlet', 'yellow'], hide: [], composite: null, forward: 0.9,
    nodes: [10, 12], closures: [0, 1], maxDen: 1, maxAbs: 60, minBlanks: 8, maxArrows: 16 },
  'ld-2': { about: 'Lots of Dots 2: three rules, a dozen dots',
    colors: ['scarlet', 'yellow', 'purple'], hide: [], composite: null,
    nodes: [12, 14], closures: [0, 2], maxDen: 1, maxAbs: 60, minBlanks: 10, maxArrows: 18 },
  'ld-3': { about: 'Lots of Dots 3: three rules and a brown road',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: [], composite: ['scarlet', 'yellow'],
    nodes: [14, 16], closures: [1, 2], maxDen: 1, maxAbs: 80, minBlanks: 12, maxArrows: 20 },
  'ld-4': { about: 'Lots of Dots 4: below zero, a brown road, sixteen-plus dots',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: [], composite: ['purple', 'scarlet'], negative: true,
    nodes: [16, 18], closures: [1, 3], maxDen: 1, maxAbs: 60, minBlanks: 14, maxArrows: 22 },
  'ld-5': { about: 'Lots of Dots 5: fractions, a brown road, twenty dots',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: [], composite: ['yellow', 'purple'], fracOps: true,
    nodes: [19, 22], closures: [1, 3], maxDen: 12, maxAbs: 40, minBlanks: 17, maxArrows: 26 },
  // Below Zero: practice for negatives, one move at a time. `pool` fixes the
  // rules each color may be; `focus` demands that many arrow steps of a kind:
  // cross (down past zero), addNeg (adding to a negative), subNeg
  // (subtracting from a negative), scaleNeg (x or / on a negative).
  'bz-1': { about: 'Below Zero 1: going down past zero',
    colors: ['scarlet', 'yellow'], hide: [], composite: null, negative: true, forward: 0.95, start: [3, 9],
    pool: { scarlet: ['-4', '-5', '-6'], yellow: ['-1', '-2'] },
    nodes: [5, 7], closures: [0, 1], maxDen: 1, maxAbs: 20, minBlanks: 4, maxBackward: 0, focus: { cross: 2 } },
  'bz-2': { about: 'Below Zero 2: adding to a negative',
    colors: ['scarlet', 'yellow'], hide: [], composite: null, negative: true, forward: 0.85, start: [1, 6],
    pool: { scarlet: ['-5', '-6', '-7', '-8'], yellow: ['+1', '+2', '+3'] },
    nodes: [7, 8], closures: [0, 2], maxDen: 1, maxAbs: 20, minBlanks: 4, maxBackward: 0, focus: { addNeg: 3 } },
  'bz-3': { about: 'Below Zero 3: subtracting from a negative',
    colors: ['scarlet', 'yellow', 'purple'], hide: [], composite: null, negative: true, start: [1, 6],
    pool: { scarlet: ['-3', '-4', '-5', '-6'], yellow: ['+1', '+2', '+4'], purple: ['-1', '-2'] },
    nodes: [8, 10], closures: [1, 2], maxDen: 1, maxAbs: 25, minBlanks: 5, maxBackward: 2, focus: { subNeg: 4, addNeg: 1 } },
  'bz-4': { about: 'Below Zero 4: multiplying and dividing negatives',
    colors: ['scarlet', 'yellow', 'purple'], hide: [], composite: null, negative: true, start: [1, 6],
    pool: { scarlet: ['*2', '*3'], yellow: ['-4', '-5', '-6'], purple: ['+1', '+2', '+3'] },
    nodes: [9, 11], closures: [1, 3], maxDen: 1, maxAbs: 40, minBlanks: 7, focus: { scaleNeg: 3, addNeg: 1, subNeg: 1 } },
  'bz-5': { about: 'Below Zero 5: everything, with a brown road',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: [], composite: ['yellow', 'purple'], negative: true, start: [1, 6],
    pool: { scarlet: ['/2', '/3'], yellow: ['-5', '-6', '-7'], purple: ['+1', '+2'] },
    nodes: [12, 15], closures: [1, 3], maxDen: 1, maxAbs: 40, minBlanks: 10, maxArrows: 20, focus: { scaleNeg: 2, addNeg: 3, subNeg: 2, cross: 1 } },
  // I'll Take 'em All: one of each theme, climbing 1 to 5 stars.
  'ta-1': { about: "I'll Take 'em All 1: Mastermind style, two mystery rules",
    colors: ['scarlet', 'yellow'], hide: ['scarlet', 'yellow'], composite: null,
    nodes: [3, 4], closures: [0, 1], maxDen: 1, maxAbs: 40, maxBlanks: 1, keepGivens: true, minArrows: 3 },
  'ta-2': { about: "I'll Take 'em All 2: Arrows and Nodes style, one mystery among three",
    colors: ['scarlet', 'yellow', 'purple'], hide: ['yellow'], composite: null,
    nodes: [6, 7], closures: [1, 2], maxDen: 1, maxAbs: 50, minBlanks: 3 },
  'ta-3': { about: "I'll Take 'em All 3: Lots of Dots style, every rule shown but a secret brown recipe",
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: [], composite: ['purple', 'scarlet'], hiddenRecipe: true,
    nodes: [11, 13], closures: [1, 2], maxDen: 1, maxAbs: 60, minBlanks: 9, maxArrows: 18 },
  'ta-4': { about: "I'll Take 'em All 4: Below Zero style, x and / on negatives",
    colors: ['scarlet', 'yellow', 'purple'], hide: [], composite: null, negative: true, start: [1, 6],
    pool: { scarlet: ['*2', '*3'], yellow: ['-5', '-6', '-7'], purple: ['+2', '+3', '+4'] },
    nodes: [10, 12], closures: [1, 3], maxDen: 1, maxAbs: 40, minBlanks: 8, focus: { scaleNeg: 3, addNeg: 2, subNeg: 1 } },
  'ta-5': { about: "I'll Take 'em All 5: mystery rules, a secret recipe, below zero, lots of dots",
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['yellow', 'purple'], composite: ['yellow', 'scarlet'], hiddenRecipe: true, negative: true,
    nodes: [11, 13], closures: [2, 3], maxDen: 1, maxAbs: 60, minBlanks: 7, maxArrows: 20 },
  // Missing Arrows: a finished picture with some arrows of one color left
  // out. `draw` names the color; `missing` bounds how many are left out.
  'ma-1': { about: 'Missing Arrows 1: every number shown, a few arrows missing',
    colors: ['scarlet', 'yellow'], hide: [], composite: null, draw: 'yellow', start: [1, 6],
    pool: { scarlet: ['+1'], yellow: ['+2', '+3'] },
    nodes: [6, 7], closures: [1, 3], maxDen: 1, maxAbs: 20, maxBlanks: 0, keepAll: true, missing: [2, 3] },
  'ma-2': { about: 'Missing Arrows 2: fill in the dots, then draw the missing arrows',
    colors: ['scarlet', 'yellow', 'purple'], hide: [], composite: null, draw: 'purple', start: [1, 9],
    pool: { scarlet: ['+1', '+2'], yellow: ['-3', '-4'], purple: ['+5', '+10'] },
    nodes: [7, 9], closures: [1, 3], maxDen: 1, maxAbs: 40, minBlanks: 3, missing: [3, 4] },
  'ma-3': { about: 'Missing Arrows 3: the missing color is a mystery too',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['yellow'], composite: null, draw: 'yellow',
    nodes: [8, 10], closures: [2, 3], maxDen: 1, maxAbs: 50, minBlanks: 3, missing: [3, 5] },
  'ma-4': { about: 'Missing Arrows 4: below zero, lots of missing arrows',
    colors: ['scarlet', 'yellow', 'purple'], hide: ['purple'], composite: null, draw: 'scarlet', negative: true,
    nodes: [9, 11], closures: [2, 4], maxDen: 1, maxAbs: 40, minBlanks: 4, missing: [4, 6] },
  'ma-5': { about: 'Missing Arrows 5: mysteries, a brown road and missing arrows',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'purple'], composite: ['yellow', 'purple'], draw: 'purple', negative: true,
    nodes: [10, 12], closures: [2, 4], maxDen: 1, maxAbs: 60, minBlanks: 5, missing: [4, 7] },
  // Mastermind Mysteries II: more of the favorite, now with several combined
  // arrows (brown, gray, white) whose recipes are shown.
  'm2-1': { about: 'Mastermind II 1: two mystery rules, a handful of dots',
    colors: ['scarlet', 'yellow'], hide: ['scarlet', 'yellow'], composite: null,
    nodes: [3, 4], closures: [0, 1], maxDen: 1, maxAbs: 40, maxBlanks: 0, keepGivens: true, minArrows: 4 },
  'm2-2': { about: 'Mastermind II 2: two mysteries and a brown arrow made of them',
    colors: ['scarlet', 'yellow', 'brown'], hide: ['scarlet', 'yellow'], composites: [{ id: 'brown', chain: ['yellow', 'scarlet'] }],
    nodes: [4, 5], closures: [1, 2], maxDen: 1, maxAbs: 50, maxBlanks: 0, keepGivens: true, minArrows: 4 },
  'm2-3': { about: 'Mastermind II 3: brown and gray, two recipes from the same two rules',
    colors: ['scarlet', 'yellow', 'brown', 'gray'], hide: ['scarlet', 'yellow'],
    composites: [{ id: 'brown', chain: ['scarlet', 'yellow'] }, { id: 'gray', chain: ['yellow', 'scarlet'] }],
    nodes: [4, 6], closures: [1, 2], maxDen: 1, maxAbs: 60, maxBlanks: 1, minArrows: 5 },
  'm2-4': { about: 'Mastermind II 4: three mysteries, brown and gray, one rule only inside them',
    colors: ['scarlet', 'yellow', 'purple', 'brown', 'gray'], hide: ['scarlet', 'yellow', 'purple'], inside: ['purple'],
    composites: [{ id: 'brown', chain: ['scarlet', 'purple'] }, { id: 'gray', chain: ['purple', 'yellow'] }],
    nodes: [5, 7], closures: [1, 3], maxDen: 1, maxAbs: 60, maxBlanks: 2, minArrows: 5 },
  'm2-5': { about: 'Mastermind II 5: brown, gray and white, below zero, purple only inside them',
    colors: ['scarlet', 'yellow', 'purple', 'brown', 'gray', 'white'], hide: ['scarlet', 'yellow', 'purple'], negative: true, inside: ['purple'],
    composites: [{ id: 'brown', chain: ['scarlet', 'yellow'] }, { id: 'gray', chain: ['yellow', 'purple'] }, { id: 'white', chain: ['purple', 'scarlet', 'yellow'] }],
    nodes: [7, 9], closures: [2, 4], maxDen: 1, maxAbs: 80, maxBlanks: 4, minArrows: 7 },
  // Code Breakers: like Mastermind, all about the rules, with a brown arrow
  // whose recipe is shown. `inside` keeps a color off the picture except as
  // a step of the brown arrow, so it can only be worked out through brown.
  'cb-1': { about: 'Code Breakers 1: one mystery rule, and brown is it plus a shown rule',
    colors: ['scarlet', 'yellow', 'brown'], hide: ['scarlet'], composite: ['scarlet', 'yellow'],
    nodes: [3, 4], closures: [0, 1], maxDen: 1, maxAbs: 40, maxBlanks: 0, keepGivens: true, minArrows: 3 },
  'cb-2': { about: 'Code Breakers 2: two mystery rules and the brown arrow made of them',
    colors: ['scarlet', 'yellow', 'brown'], hide: ['scarlet', 'yellow'], composite: ['scarlet', 'yellow'],
    nodes: [4, 5], closures: [0, 1], maxDen: 1, maxAbs: 50, maxBlanks: 0, keepGivens: true, minArrows: 4 },
  'cb-3': { about: 'Code Breakers 3: yellow only ever shows up inside brown',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow'], composite: ['scarlet', 'yellow'], inside: ['yellow'],
    nodes: [4, 6], closures: [0, 2], maxDen: 1, maxAbs: 60, maxBlanks: 1, minArrows: 4 },
  'cb-4': { about: 'Code Breakers 4: three mysteries, one hiding inside brown',
    colors: ['scarlet', 'yellow', 'purple', 'brown'], hide: ['scarlet', 'yellow', 'purple'], composite: ['purple', 'yellow'], inside: ['yellow'],
    nodes: [5, 7], closures: [1, 2], maxDen: 1, maxAbs: 60, maxBlanks: 2, minArrows: 5 },
  'cb-5': { about: 'Code Breakers 5: a three-step brown arrow and four mysteries',
    colors: ['scarlet', 'yellow', 'purple', 'blue', 'brown'], hide: ['scarlet', 'yellow', 'purple', 'blue'], composite: ['scarlet', 'yellow', 'scarlet'], inside: ['yellow'], negative: true,
    nodes: [9, 11], closures: [2, 4], maxDen: 1, maxAbs: 80, maxBlanks: 5, minArrows: 9 },
  // Road Builder: two numbers and some colors; build a road between them.
  // `ends` gives the ranges for the start and the end, `best` the range for
  // the shortest road's length; `detour` and `belowZero` demand one.
  'rb-1': { about: 'Road Builder 1: tens and ones',
    road: true, colors: ['scarlet', 'yellow'], pool: { scarlet: ['+10'], yellow: ['+1', '+2'] },
    ends: [[1, 9], [20, 40]], best: [3, 3], maxAbs: 60 },
  'rb-2': { about: 'Road Builder 2: up a lot, back a little',
    colors: ['scarlet', 'yellow'], road: true, pool: { scarlet: ['+5', '+6'], yellow: ['-1', '-2'] },
    ends: [[1, 9], [12, 30]], best: [4, 5], maxAbs: 50 },
  'rb-3': { about: 'Road Builder 3: the CSMP road, +5 and -2 style',
    colors: ['scarlet', 'yellow'], road: true, pool: { scarlet: ['+5', '+7'], yellow: ['-2', '-3'] },
    ends: [[0, 9], [15, 40]], best: [7, 8], maxAbs: 60 },
  'rb-4': { about: 'Road Builder 4: doubling, with a detour',
    colors: ['scarlet', 'yellow', 'purple'], road: true, pool: { scarlet: ['*2'], yellow: ['+1', '+3'], purple: ['-1', '-2'] },
    ends: [[1, 6], [20, 50]], best: [5, 6], detour: true, maxAbs: 60 },
  'rb-5': { about: 'Road Builder 5: three colors, down below zero',
    colors: ['scarlet', 'yellow', 'purple'], road: true, pool: { scarlet: ['*2', '*3'], yellow: ['-5', '-6', '-7'], purple: ['+1', '+2', '+3'] },
    ends: [[1, 6], [-40, -8]], best: [7, 9], detour: true, belowZero: true, maxAbs: 60 },
};

// Combined arrows: `composite` (with `hiddenRecipe`) makes one brown arrow;
// `composites` lists several, [{id, chain, hidden}], drawn brown, gray, white.
const COMBINED = (r) => r.composites || (r.composite ? [{ id: 'brown', chain: r.composite, hidden: !!r.hiddenRecipe }] : []);

const args = process.argv.slice(2);
const recipeName = args[0];
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const R = RECIPES[recipeName];
if (!R) { console.error(`recipes: ${Object.keys(RECIPES).join(', ')}`); process.exit(2); }
const TRIES = Number(opt('tries', 2000));
const TOP = Number(opt('top', 6));
let seed = Number(opt('seed', 1));
const OUT = opt('out', null);
const RATING = opt('rating', null) && Number(opt('rating'));

// Small seeded PRNG so a good puzzle can be regenerated from its seed.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeOps(rand) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const base = R.colors.filter((c) => !COMBINED(R).some((x) => x.id === c));
  const kinds = R.fracOps ? ['/', '/', '*', '+', '-'] : R.negative ? ['-', '-', '+', '*'] : ['+', '-', '*', '*', '/'];
  const used = new Set();
  const truth = {};
  if (R.pool) {
    for (const c of base) truth[c] = ops.parseOp(pick(R.pool[c]));
    return truth;
  }
  for (const c of base) {
    let op;
    for (let t = 0; t < 20; t++) {
      const kind = pick(kinds);
      const k = kind === '+' || kind === '-' ? 1 + Math.floor(rand() * (R.negative ? 9 : 7)) : pick([2, 2, 3, 3, 4, 5]);
      op = ops.parseOp(`${kind}${k}`);
      if (!used.has(op.kind) || t > 10) break;
    }
    used.add(op.kind);
    truth[c] = op;
  }
  return truth;
}

const LEVEL = { fractions: R.fractions || 'proper' };
const inRange = (v) => v.d <= R.maxDen && Math.abs(v.n) <= R.maxAbs * v.d && !levelProblem(v, LEVEL);

function grow(rand) {
  const truth = makeOps(rand);
  const chains = Object.fromEntries(Object.keys(truth).map((c) => [c, [truth[c]]]));
  for (const x of COMBINED(R)) chains[x.id] = x.chain.map((c) => truth[c]);
  // `inside` colors only ever appear as a step of the brown arrow.
  const colors = Object.keys(chains).filter((c) => !(R.inside || []).includes(c));
  const apply = (c, v) => { try { const r = ops.applyChain(chains[c], v); return inRange(r) ? r : null; } catch { return null; } };
  const invert = (c, v) => { try { const r = ops.invertChain(chains[c], v); return inRange(r) ? r : null; } catch { return null; } };

  const [s0, s1] = R.start || (R.negative ? [1, 9] : [1, 12]);
  const start = rat(s0 + Math.floor(rand() * (s1 - s0 + 1)));
  const nodes = [{ id: 'n0', v: start }];
  const arrows = [];
  const target = R.nodes[0] + Math.floor(rand() * (R.nodes[1] - R.nodes[0] + 1));
  const hasArrow = (f, t, c) => arrows.some((a) => a.from === f && a.to === t && a.color === c);
  let closures = 0;

  for (let guard = 0; nodes.length < target && guard < 400; guard++) {
    const u = nodes[Math.floor(rand() * nodes.length)];
    const c = colors[Math.floor(rand() * colors.length)];
    const forward = rand() < (R.forward ?? 0.65);
    const v = forward ? apply(c, u.v) : invert(c, u.v);
    if (!v || (R.negative === undefined && v.n === 0)) continue;
    const existing = nodes.find((n) => rational.eq(n.v, v));
    const [from, to] = forward ? [u.id, existing?.id] : [existing?.id, u.id];
    if (existing) {
      if (existing === u || hasArrow(from, to, c)) continue;
      arrows.push({ from, to, color: c });
      closures++;
    } else {
      const id = `n${nodes.length}`;
      nodes.push({ id, v });
      arrows.push(forward ? { from: u.id, to: id, color: c } : { from: id, to: u.id, color: c });
    }
  }
  // Close a few loops: arrows whose rule happens to join two existing dots.
  const want = R.closures[0] + Math.floor(rand() * (R.closures[1] - R.closures[0] + 1));
  const candidates = [];
  for (const u of nodes) for (const w of nodes) for (const c of colors) {
    if (u === w || hasArrow(u.id, w.id, c)) continue;
    const r = apply(c, u.v);
    if (r && rational.eq(r, w.v)) candidates.push({ from: u.id, to: w.id, color: c });
  }
  while (closures < want && candidates.length) {
    arrows.push(candidates.splice(Math.floor(rand() * candidates.length), 1)[0]);
    closures++;
  }
  return { truth, chains, nodes, arrows, closures };
}

// Count the arrow steps of each kind a Below Zero recipe asks for.
function focusCounts(g) {
  const val = new Map(g.nodes.map((n) => [n.id, n.v]));
  const out = { cross: 0, addNeg: 0, subNeg: 0, scaleNeg: 0 };
  for (const a of g.arrows) {
    let v = val.get(a.from);
    for (const op of g.chains[a.color]) {
      const w = ops.applyOp(op, v);
      if (op.kind === '-' && v.n >= 0 && w.n < 0) out.cross++;
      if (op.kind === '+' && v.n < 0) out.addNeg++;
      if (op.kind === '-' && v.n < 0) out.subNeg++;
      if ((op.kind === '*' || op.kind === '/') && v.n < 0) out.scaleNeg++;
      v = w;
    }
  }
  return out;
}

function toJson(g, givenIds) {
  return {
    ops: { kinds: ['+', '-', '*', '/'], kMax: 12, maxDen: 12, fractions: LEVEL.fractions },
    nodes: g.nodes.map((n) => (givenIds.has(n.id) ? { id: n.id, value: format(n.v) } : { id: n.id })),
    colors: [
      ...Object.keys(g.truth).map((c) => (R.hide.includes(c) ? { id: c } : { id: c, op: ops.formatOp(g.truth[c]) })),
      ...COMBINED(R).map((x) => ({ id: x.id, composite: x.chain, ...(x.hidden ? { hidden: true } : {}) })),
    ],
    arrows: g.arrows,
    ...(R.draw ? { draw: { color: R.draw } } : {}),
  };
}

// Any warning disqualifies: split pictures, guesses, redundant colors, unused colors.
const acceptable = (r) => r.ok && r.warnings.length === 0;

// Remove givens in random order while the puzzle stays acceptable.
function minimize(g, rand) {
  const given = new Set(g.nodes.map((n) => n.id));
  if (!acceptable(checkPuzzle(toJson(g, given)))) return null;
  if ((R.keepGivens && R.hide.length) || R.keepAll) return toJson(g, given);
  const order = [...given].sort(() => rand() - 0.5);
  for (const id of order) {
    given.delete(id);
    if (!acceptable(checkPuzzle(toJson(g, given)))) given.add(id);
  }
  return toJson(g, given);
}

// Leave out arrows of the draw color, one at a time, while the puzzle stays
// acceptable with every number given; the dots are thinned out after.
function thin(g, rand) {
  const all = new Set(g.nodes.map((n) => n.id));
  const want = R.missing[1];
  const order = g.arrows.filter((a) => a.color === R.draw).sort(() => rand() - 0.5);
  let left = 0;
  for (const a of order) {
    if (left >= want) break;
    const i = g.arrows.indexOf(a);
    g.arrows.splice(i, 1);
    if (acceptable(checkPuzzle(toJson(g, all)))) left++;
    else g.arrows.splice(i, 0, a);
  }
  return left > 0;
}

// Road puzzles: just the two ends and the colors to build with.
function makeRoad(rand) {
  const truth = makeOps(rand);
  const pickIn = ([lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));
  const [a, b] = R.ends.map(pickIn);
  return {
    ops: { kinds: ['+', '-', '*', '/'], kMax: 12, maxDen: 1, maxAbs: R.maxAbs, fractions: 'none' },
    nodes: [{ id: 'n0', value: String(a) }, { id: 'n1', value: String(b) }],
    colors: Object.keys(truth).map((c) => ({ id: c, op: ops.formatOp(truth[c]) })),
    arrows: [],
    road: { from: 'n0', to: 'n1', colors: Object.keys(truth) },
  };
}

function roadMain() {
  const results = [];
  const seen = new Set();
  for (let t = 0; t < TRIES; t++) {
    const s = seed + t;
    const json = makeRoad(mulberry32(s));
    const r = checkPuzzle(json);
    if (!acceptable(r)) continue;
    const road = r.road;
    if (road.best < R.best[0] || road.best > R.best[1]) continue;
    if ((R.detour && !road.detour) || (R.belowZero && !road.belowZero)) continue;
    // Every color must be needed: without it, no road is as short.
    const p = loadPuzzle(json);
    const [a, b] = p.nodes.map((n) => n.given);
    const needed = (c) => {
      const rest = p.colors.filter((x) => x.id !== c.id).map((x) => x.op);
      return (shortestRoad(a, b, rest, p.config)?.best ?? Infinity) > road.best;
    };
    if (!p.colors.every(needed)) continue;
    if (RATING && r.difficulty.rating !== RATING) continue;
    const sig = JSON.stringify([json.nodes, json.colors]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    // Fewer shortest roads means the planning matters more.
    results.push({ seed: s, json, r, interest: r.difficulty.score - Math.log2(road.ways) * 0.3 });
  }
  results.sort((x, y) => y.interest - x.interest);
  console.log(`${recipeName}: ${R.about}`);
  console.log(`${results.length} acceptable of ${TRIES} tries\n`);
  for (const x of results.slice(0, TOP)) {
    const d = x.r.difficulty;
    console.log(`seed ${x.seed}  rating ${d.rating} (${d.score})  ${x.json.nodes.map((n) => n.value).join(' to ')}  rules ${JSON.stringify(x.r.solution.colors)}`);
    console.log(`  best ${x.r.road.best}  ways ${x.r.road.ways}  detour ${x.r.road.detour}  below zero ${x.r.road.belowZero}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/${recipeName}-${x.seed}.json`, JSON.stringify(x.json, null, 2));
    }
  }
}
if (R.road) { roadMain(); process.exit(0); }

// What makes a puzzle interesting beyond its raw difficulty.
function interest(r, g) {
  const s = r.difficulty.signals;
  const colorsUsed = new Set(g.arrows.map((a) => a.color)).size;
  return r.difficulty.score
    + 0.6 * Math.min(g.closures, 3)
    + 0.5 * s.frontier.narrowRounds
    + (s.compositeSteps > 0 ? 1 : 0)
    + (colorsUsed >= 3 ? 0.5 : 0)
    + (R.fracOps ? 1.2 * Math.min(s.arithmetic.fractions, 3) : 0)
    - (s.arithmetic.maxAbs > 60 ? 1 : 0)
    - Math.max(0, g.arrows.length - (R.maxArrows || 14)) * 0.5;
}

const results = [];
const seen = new Set();
for (let t = 0; t < TRIES; t++) {
  const s = seed + t;
  const rand = mulberry32(s);
  const g = grow(rand);
  if (g.arrows.length < (R.minArrows ?? 5)) continue;
  if (R.draw && !thin(g, rand)) continue;
  const json = minimize(g, rand);
  if (!json) continue;
  const r = checkPuzzle(json);
  if (!acceptable(r)) continue;
  const blanks = json.nodes.filter((n) => n.value === undefined).length;
  if (RATING && r.difficulty.rating !== RATING) continue;
  if (blanks > (R.maxBlanks ?? Infinity) || blanks < (R.minBlanks ?? 0)) continue;
  if (json.arrows.length > (R.maxArrows ?? Infinity)) continue;
  if (r.difficulty.signals.backwardSteps > (R.maxBackward ?? Infinity)) continue;
  if (R.draw && (r.draw.missing.length < R.missing[0] || r.draw.missing.length > R.missing[1])) continue;
  if (R.focus) {
    const f = focusCounts(g);
    if (Object.entries(R.focus).some(([k, n]) => f[k] < n)) continue;
  }
  const sig = JSON.stringify([r.solution.colors, json.arrows.length, r.difficulty.score]);
  if (seen.has(sig)) continue;
  seen.add(sig);
  results.push({ seed: s, json, r, interest: interest(r, g), closures: g.closures });
}
results.sort((a, b) => b.interest - a.interest);

console.log(`${recipeName}: ${R.about}`);
console.log(`${results.length} acceptable of ${TRIES} tries\n`);
for (const x of results.slice(0, TOP)) {
  const d = x.r.difficulty;
  const sg = d.signals;
  const givens = x.json.nodes.filter((n) => n.value !== undefined).length;
  console.log(`seed ${x.seed}  interest ${x.interest.toFixed(1)}  rating ${d.rating} (${d.score})  ${x.r.mode}`);
  console.log(`  ${x.json.nodes.length} dots (${givens} given), ${x.json.arrows.length} arrows, ${x.closures} loops  rules ${JSON.stringify(x.r.solution.colors)}`);
  console.log(`  depth ${sg.chainDepth} narrow ${sg.frontier.narrowRounds} backward ${sg.backwardSteps} composite ${sg.compositeSteps} pins ${sg.pins} recipes ${sg.recipes}  max|v| ${sg.arithmetic.maxAbs} neg ${sg.arithmetic.negatives} frac ${sg.arithmetic.fractions}`);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${recipeName}-${x.seed}.json`, JSON.stringify(x.json, null, 2));
  }
}
