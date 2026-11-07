// Serves the app on the local network, laid out the way the published site
// is, straight from the project files: edits show up on reload.
//   node scripts/serve.js [port]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrap, PAGES, FILES, FOLDERS } from './page.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || 8080);
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8' };

// Published path -> file on disk.
function resolve(url) {
  const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (PAGES[name]) return { file: PAGES[name], page: true };
  if (FILES[name]) return { file: FILES[name] };
  const [folder, file] = name.split('/');
  if (FOLDERS[folder] && file?.endsWith('.js') && !file.includes('..')) return { file: join(FOLDERS[folder], file) };
  return null;
}

createServer(async (req, res) => {
  const hit = resolve(req.url);
  if (!hit) { res.writeHead(404).end('Not found'); return; }
  try {
    const text = await readFile(join(ROOT, hit.file), 'utf8');
    res.writeHead(200, { 'content-type': TYPES[extname(hit.file)] || 'text/plain', 'cache-control': 'no-store' });
    res.end(hit.page ? wrap(text) : text);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Arrow Pictures is running.`);
  console.log(`  On this Mac:          http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  On your home network: http://${ip}:${PORT}`);
});
