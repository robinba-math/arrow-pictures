// Draws the board as an SVG string. Pure: no DOM, so the same code renders
// the live page and a local test sheet. Colors come from CSS tokens.

import { R } from './layout.js';

// Arrow colors are named by the puzzle; each name maps to a hue from a
// colorblind-safe set, and every hue also has its own line pattern, so no
// arrow depends on color alone.
// Plain colors come in a fixed order, scarlet, yellow, purple, then blue and
// green; combined arrows are brown, then gray, then white.
const NAMED = {
  scarlet: 'scarlet', red: 'scarlet', vermilion: 'scarlet', crimson: 'scarlet', yellow: 'yellow', gold: 'yellow', amber: 'yellow',
  orange: 'orange', green: 'green', teal: 'green', blue: 'blue', navy: 'blue', purple: 'purple',
  plum: 'purple', pink: 'purple', violet: 'purple',
};
const ORDER = ['scarlet', 'yellow', 'purple', 'blue', 'green', 'orange'];
const COMBINED = ['brown', 'gray', 'white'];
export const DASH = { scarlet: '', yellow: '11 6', purple: '14 5 2 5', blue: '0.1 7', green: '5 4', orange: '2 4', brown: '', gray: '', white: '' };
export const HUE_NAME = { scarlet: 'Scarlet', yellow: 'Yellow', purple: 'Purple', blue: 'Blue', green: 'Green', orange: 'Orange', brown: 'Brown', gray: 'Gray', white: 'White' };

export function colorStyles(p) {
  const styles = new Map();
  const used = new Set();
  const pick = (c) => {
    const want = NAMED[String(c.label || c.id).toLowerCase()];
    if (want && !used.has(want)) return want;
    return ORDER.find((h) => !used.has(h)) || 'blue';
  };
  for (const c of p.colors) {
    if (c.composite) continue;
    const hue = pick(c);
    used.add(hue);
    styles.set(c.id, { hue, dash: DASH[hue], composite: false });
  }
  const combined = p.colors.filter((c) => c.composite);
  combined.forEach((c, i) => styles.set(c.id, { hue: COMBINED[i] || 'brown', dash: '', composite: true }));
  return styles;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// Shrink long numbers to fit the dot.
const fontFor = (text) => (text.length <= 2 ? 22 : text.length === 3 ? 19 : text.length === 4 ? 16 : 13.5);

export const pretty = (s) => String(s).replace(/-/g, '−');

// view: {
//   nodes: {id: {text, kind: 'given'|'entered'|'blank', label}},
//   selected: nodeId|null, wrong: Set<nodeId>, hint: {nodes, arrows: Set}|null, solved,
//   from: nodeId|null (where an arrow being drawn starts),
//   arrowClass: {arrowId: class}, say: {x, y, text, kind: 'ok'|'bad'}|null,
//   marks: {nodeId: emoji} (a road's start, checkpoints and finish)
// }
export function renderBoard(p, layout, styles, view) {
  const [vx, vy, vw, vh] = layout.viewBox;
  const hues = [...new Set([...styles.values()].map((s) => s.hue))];
  const markers = hues.map((h) => `
    <marker id="ah-${h}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="4.4" markerHeight="4.4" orient="auto" markerUnits="strokeWidth">
      <path d="M0 0.6 L10 5 L0 9.4 z" class="ah" style="fill:var(--c-${h})"/>
    </marker>
    <marker id="ahr-${h}" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="17" markerHeight="17" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0 0.6 L10 5 L0 9.4 z" class="ah" style="fill:var(--c-${h})${h === 'white' ? ';stroke:var(--ink-soft);stroke-width:1.2' : ''}"/>
    </marker>`).join('');

  const hintArrows = view.hint?.arrows || new Set();
  const arrows = layout.arrows.map((a, i) => {
    const st = styles.get(a.color);
    const hint = (hintArrows.has(a.id) ? ' is-hint' : '') + (view.arrowClass?.[a.id] ? ` ${view.arrowClass[a.id]}` : '');
    const stroke = `stroke:var(--c-${st.hue})`;
    if (st.composite) {
      // A combined arrow is drawn as a road: two rails, because it stands for
      // a whole road of arrows.
      // White would vanish on light paper, so its road gets a dark edge.
      const edge = st.hue === 'white' ? `<path class="rail-edge" d="${a.d}"/>` : '';
      return `<g class="arrow road${hint}" data-arrow="${a.id}" style="--i:${i}">
        <path class="glow" d="${a.d}" style="${stroke}"/>${edge}
        <path class="rail-outer" d="${a.d}" style="${stroke}" marker-end="url(#ahr-${st.hue})"/>
        <path class="rail-inner" d="${a.d}"/>
      </g>`;
    }
    const dash = st.dash ? `;stroke-dasharray:${st.dash}` : '';
    return `<g class="arrow${hint}" data-arrow="${a.id}" style="--i:${i}">
      <path class="glow" d="${a.d}" style="${stroke}"/>
      <path class="line" d="${a.d}" style="${stroke}${dash}" marker-end="url(#ah-${st.hue})"/>
    </g>`;
  }).join('');

  const hintNodes = view.hint?.nodes || new Set();
  const dots = p.nodes.map((n) => {
    const { x, y } = layout.pos[n.id];
    const v = view.nodes[n.id];
    const cls = ['dot', `is-${v.kind}`];
    if (view.selected === n.id) cls.push('is-selected');
    if (view.from === n.id) cls.push('is-from');
    if (view.wrong?.has(n.id)) cls.push('is-wrong');
    if (hintNodes.has(n.id)) cls.push('is-hint');
    const text = pretty(v.text || '');
    const interactive = v.kind !== 'given';
    const attrs = interactive
      ? `role="button" tabindex="0" aria-label="${esc(v.label)}"`
      : `role="img" aria-label="${esc(v.label)}"`;
    const badge = view.wrong?.has(n.id)
      ? `<g class="badge"><circle cx="${x + 19}" cy="${y - 19}" r="8.5"/><path d="M${x + 15.5} ${y - 22.5} l7 7 m0 -7 l-7 7"/></g>`
      : '';
    return `<g class="${cls.join(' ')}" data-node="${esc(n.id)}" ${attrs}>
      <circle class="halo" cx="${x}" cy="${y}" r="${R + 10}"/>
      <circle class="ring" cx="${x}" cy="${y}" r="${R}"/>
      ${text ? `<text x="${x}" y="${y}" dy="0.35em" style="font-size:${fontFor(text)}px">${esc(text)}</text>` : ''}
      ${badge}
      ${view.marks?.[n.id] ? `<text class="mark" x="${x - R + 2}" y="${y - R + 4}">${view.marks[n.id]}</text>` : ''}
    </g>`;
  }).join('');

  return `<svg class="board${view.solved ? ' is-solved' : ''}" viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Arrow picture">
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse" x="${vx}" y="${vy}">
      <circle cx="12" cy="12" r="1.1" class="grid-dot"/>
    </pattern>${markers}
  </defs>
  <rect class="paper" x="${vx}" y="${vy}" width="${vw}" height="${vh}" style="fill:url(#grid)"/>
  <g class="arrows">${arrows}</g>
  <g class="dots">${dots}</g>
  ${view.say ? sayLabel(view.say) : ''}
</svg>`;
}

// The number sentence for an arrow just drawn, on a little card above it.
function sayLabel({ x, y, text, kind }) {
  const w = text.length * 10.5 + 26;
  return `<g class="say is-${kind}" transform="translate(${Math.round(x)} ${Math.round(y - 30)})">
    <rect x="${-w / 2}" y="-17" width="${w}" height="34" rx="10"/>
    <text y="0" dy="0.35em">${esc(pretty(text))}</text>
  </g>`;
}

// Board styles, shared by the page and the local test sheet. Tokens are
// defined by whoever hosts the board.
export const BOARD_CSS = `
.board { display: block; width: 100%; height: auto; max-height: 100%; font-family: var(--font-num); }
.board .grid-dot { fill: var(--grid); }
.board .arrow .line { fill: none; stroke-width: 3.2; stroke-linecap: round; }
.board .arrow .glow { fill: none; stroke-width: 14; stroke-linecap: round; opacity: 0; transition: opacity .2s; }
.board .arrow.is-hint .glow { opacity: .28; }
.board .road .rail-outer { fill: none; stroke-width: 8; stroke-linecap: round; }
.board .road .rail-edge { fill: none; stroke: var(--ink-soft); stroke-width: 10.5; stroke-linecap: round; }
.board .road .rail-inner { fill: none; stroke: var(--board); stroke-width: 2.6; stroke-linecap: round; }
.board .dot .ring { stroke-width: 2.2; }
.board .dot text { text-anchor: middle; font-weight: 700; font-variant-numeric: tabular-nums; pointer-events: none; }
.board .dot .halo { fill: var(--pencil); opacity: 0; }
.board .dot.is-given .ring { fill: var(--dot-given); stroke: var(--ink); }
.board .dot.is-given text { fill: var(--ink); }
.board .dot.is-blank .ring { fill: var(--board); stroke: var(--ink-soft); stroke-dasharray: 4 4; stroke-width: 1.8; }
.board .dot.is-entered .ring { fill: var(--board); stroke: var(--pencil); }
.board .dot.is-entered text { fill: var(--pencil); }
.board .dot[role="button"] { cursor: pointer; }
.board .dot[role="button"]:hover .ring { stroke-width: 3; }
.board .dot:focus { outline: none; }
.board .dot.is-selected .halo, .board .dot:focus-visible .halo { opacity: .18; }
.board .dot.is-selected .ring { stroke: var(--pencil); stroke-width: 3.4; stroke-dasharray: none; }
.board .dot.is-hint .halo { opacity: .22; animation: hintpulse 1.4s ease-in-out infinite; }
.board .dot.is-wrong .ring { stroke: var(--bad); stroke-dasharray: 5 3; stroke-width: 3; }
.board .dot.is-wrong text { fill: var(--bad); }
.board .badge circle { fill: var(--bad); }
.board .badge path { stroke: var(--board); stroke-width: 2.2; stroke-linecap: round; }
.board.is-solved .arrow .glow { animation: lightup .9s ease-out both; animation-delay: calc(var(--i) * 140ms); }
.board.is-solved .dot.is-entered .ring { stroke: var(--good); }
.board.is-solved .dot.is-entered text { fill: var(--good); }
.board .dot .mark { font-size: 22px; text-anchor: middle; pointer-events: none; }
.board .dot.is-from .halo { opacity: .3; }
.board .dot.is-from .ring { stroke: var(--ink); stroke-width: 4; stroke-dasharray: none; }
.board .arrow.is-drawn .glow { animation: lightup .9s ease-out both; }
.board .arrow.is-flash .line { stroke: var(--bad); stroke-dasharray: 6 6; animation: flashout 2.2s ease-in both; }
.board .say { pointer-events: none; animation: sayin .25s ease-out both; }
.board .say rect { fill: var(--board); stroke-width: 2.5; }
.board .say text { text-anchor: middle; font-size: 19px; font-weight: 800; }
.board .say.is-ok rect { stroke: var(--good); }
.board .say.is-ok text { fill: var(--good); }
.board .say.is-bad rect { stroke: var(--bad); }
.board .say.is-bad text { fill: var(--bad); }
@keyframes flashout { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
@keyframes sayin { from { opacity: 0; } }
@keyframes lightup { 40% { opacity: .4; } 100% { opacity: 0; } }
@keyframes hintpulse { 50% { opacity: .08; } }
@media (prefers-reduced-motion: reduce) {
  .board .dot.is-hint .halo { animation: none; }
  .board.is-solved .arrow .glow { animation: none; }
}
`;
