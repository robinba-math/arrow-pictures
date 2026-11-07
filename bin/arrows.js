#!/usr/bin/env node
// Command-line front end to the engine.
//   arrows check <puzzle.json>... [--json]   validate, solve, rate
//   arrows hint <puzzle.json> [board.json]   next hint for a board

import { readFileSync } from 'node:fs';
import { checkPuzzle, prepare } from '../engine/index.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const files = rest.filter((a) => !a.startsWith('--'));
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function printCheck(file, r) {
  const mark = r.ok ? (r.warnings.length ? 'WARN' : 'PASS') : 'FAIL';
  console.log(`${mark}  ${file}${r.title ? `  — ${r.title}` : ''}  [${r.mode}]`);
  for (const e of r.errors) console.log(`  error   ${e.code}: ${e.message}`);
  for (const w of r.warnings) console.log(`  warning ${w.code}: ${w.message}`);
  if (!r.ok) return;
  const d = r.difficulty;
  const s = d.signals;
  console.log(`  rating  ${STARS(d.rating)}  (score ${d.score})`);
  console.log(`  signals depth ${s.chainDepth} · frontier min ${s.frontier.min} mean ${s.frontier.mean} narrow ${s.frontier.narrowRounds} · backward ${s.backwardSteps} · composite ${s.compositeSteps} · pins ${s.pins} · splits ${s.caseSplits}`);
  console.log(`  numbers max |v| ${s.arithmetic.maxAbs} · negatives ${s.arithmetic.negatives} · fractions ${s.arithmetic.fractions}`);
  const sol = r.solution;
  const rules = Object.entries(sol.colors).map(([c, op]) => `${c}=${op}`).join(' ');
  const vals = Object.entries(sol.nodes).map(([n, v]) => `${n}=${v}`).join(' ');
  console.log(`  rules   ${rules}`);
  for (const [c, r] of Object.entries(sol.recipes || {})) console.log(`  recipe  ${c} = ${r}`);
  console.log(`  values  ${vals}`);
  r.trace.forEach((round, i) => {
    console.log(`  round ${i + 1}  ${round.map((st) => `${st.type} ${st.target}=${st.value}`).join(' | ')}`);
  });
}

if (cmd === 'check') {
  if (!files.length) { console.error('usage: arrows check <puzzle.json>... [--json]'); process.exit(2); }
  let failed = 0;
  const results = [];
  for (const f of files) {
    let r;
    try { r = checkPuzzle(readJson(f)); } catch (e) { r = { ok: false, mode: '?', errors: [{ code: 'read', message: e.message }], warnings: [] }; }
    if (!r.ok) failed++;
    results.push({ file: f, ...r });
    if (!flags.has('--json')) printCheck(f, r);
  }
  if (flags.has('--json')) console.log(JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
} else if (cmd === 'hint') {
  const [pf, bf] = files;
  if (!pf) { console.error('usage: arrows hint <puzzle.json> [board.json]'); process.exit(2); }
  const { hint } = prepare(readJson(pf));
  const h = hint(bf ? readJson(bf) : {});
  if (h.done) { console.log('Solved. Nothing left to hint.'); process.exit(0); }
  for (const w of h.wrong) console.log(`wrong   ${w.kind} "${w.id}": ${w.reason} (${w.entered})`);
  console.log(`step    ${h.step.type} → ${h.step.target.kind} "${h.step.target.id}"`);
  console.log(`where   ${h.levels.where}`);
  console.log(`how     ${h.levels.how}`);
  console.log(`what    ${h.levels.what}`);
} else {
  console.error('usage: arrows check <puzzle.json>... | arrows hint <puzzle.json> [board.json]');
  process.exit(2);
}
