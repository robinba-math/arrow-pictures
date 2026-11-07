// Assembles the playable site in dist/, laid out the way the pages expect:
// each page wrapped as a full document, with app/, engine/, puzzles.js and
// base.css beside it. GitHub Pages publishes this folder.
//   node scripts/build-site.js
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { wrap, PAGES, FILES, FOLDERS } from './page.js';

const OUT = 'dist';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const [to, from] of Object.entries(PAGES)) writeFileSync(`${OUT}/${to}`, wrap(readFileSync(from, 'utf8')));
for (const [to, from] of Object.entries(FILES)) copyFileSync(from, `${OUT}/${to}`);
for (const [to, from] of Object.entries(FOLDERS)) {
  mkdirSync(`${OUT}/${to}`);
  for (const f of readdirSync(from).filter((f) => f.endsWith('.js'))) copyFileSync(`${from}/${f}`, `${OUT}/${to}/${f}`);
}
// No Jekyll processing on GitHub Pages: serve the files as they are.
writeFileSync(`${OUT}/.nojekyll`, '');
console.log(`built the site in ${OUT}/`);
