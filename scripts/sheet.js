// Renders every sample puzzle onto one SVG sheet for a visual check.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadPuzzle } from '../engine/index.js';
import { computeLayout } from '../web/app/layout.js';
import { renderBoard, colorStyles, BOARD_CSS } from '../web/app/render.js';

const given = process.argv.slice(4);
const files = given.length ? given : readdirSync('puzzles').filter((f) => f.endsWith('.json')).map((f) => `puzzles/${f}`);
if (!given.length) files.push('puzzles/fixtures/needs-a-guess.json');
const jsons = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
jsons.push({
  title: 'Layout stress: ring, parallel arrows, self-loop, composite',
  nodes: [{ id: 'a', value: 2 }, { id: 'b' }, { id: 'c', value: '-3/4' }, { id: 'd' }, { id: 'e', value: 10 }],
  colors: [{ id: 'scarlet', op: '+3' }, { id: 'yellow' }, { id: 'purple', op: '*2' }, { id: 'blue' }, { id: 'green' }, { id: 'brown', composite: ['scarlet', 'purple'] }],
  arrows: [
    { from: 'a', to: 'b', color: 'scarlet' }, { from: 'a', to: 'b', color: 'yellow' }, { from: 'b', to: 'a', color: 'purple' },
    { from: 'b', to: 'c', color: 'blue' }, { from: 'c', to: 'd', color: 'green' }, { from: 'd', to: 'a', color: 'brown' },
    { from: 'e', to: 'e', color: 'yellow' }, { from: 'd', to: 'e', color: 'scarlet' },
  ],
});

const pick = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
if (pick) { const keep = pick.map((i) => jsons[i]); jsons.length = 0; jsons.push(...keep); }
const COLS = Number(process.env.COLS || 1);
const PW = 380 * (COLS > 1 ? 1 : 2);
const W = PW * COLS;
let y = 0;
let col = 0;
let rowH = 0;
const panels = jsons.map((json, k) => {
  const p = loadPuzzle(json);
  const layout = computeLayout(p);
  const styles = colorStyles(p);
  const nodes = {};
  p.nodes.forEach((n, i) => {
    if (n.given) nodes[n.id] = { kind: 'given', text: `${n.given.n}${n.given.d > 1 ? '/' + n.given.d : ''}`, label: '' };
    else if (i % 2) nodes[n.id] = { kind: 'entered', text: k === 3 ? '13/12' : String(10 + i), label: '' };
    else nodes[n.id] = { kind: 'blank', text: '', label: '' };
  });
  const blanks = p.nodes.filter((n) => !n.given).map((n) => n.id);
  const view = {
    nodes,
    selected: blanks[0] || null,
    wrong: new Set(k === 0 ? [blanks[1]] : []),
    hint: k === 1 ? { nodes: new Set(), arrows: new Set([p.arrows[0].id, p.arrows[2].id]) } : k === 2 ? { nodes: new Set([blanks.at(-1)]), arrows: new Set() } : null,
  };
  const [, , vw, vh] = layout.viewBox;
  const h = Math.min(320, (PW * vh) / vw);
  const x = col * PW;
  const out = `<text x="${x + 8}" y="${y + 18}" class="cap">${json.title}</text>
  <svg x="${x}" y="${y + 26}" width="${PW}" height="${h}">${renderBoard(p, layout, styles, view).replace('<svg ', '<svg width="100%" height="100%" ')}</svg>`;
  rowH = Math.max(rowH, h + 46);
  if (++col >= COLS) { col = 0; y += rowH; rowH = 0; }
  return out;
});

const tokens = `:root{--board:#FFFFFF;--grid:#D5DCE6;--ink:#17202C;--ink-soft:#6B7586;--dot-given:#EEF1F6;--pencil:#3442C4;--bad:#C0322A;--good:#1D7A4C;
--c-scarlet:#DE1A0E;--c-blue:#0A6FB5;--c-green:#05916A;--c-purple:#8E3FB8;--c-orange:#D9731A;--c-yellow:#D9A400;--c-brown:#8A5A2E;--font-num:system-ui}
.cap{font:600 13px system-ui;fill:#17202C}`;
y += rowH;
writeFileSync(process.argv[2], `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><style>${tokens}${BOARD_CSS}</style><rect width="100%" height="100%" fill="#F2F4F7"/>${panels.join('')}</svg>`);
console.log('wrote', process.argv[2], 'height', y);
