// The pages in web/ are written as page content only, the way the artifact
// host wants them; it wraps each in a document skeleton. The local server
// and the site build wrap them the same way here.
export const wrap = (body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${body}
</body></html>`;

// Published path -> file in the project, for every file the site serves.
export const PAGES = { 'index.html': 'web/index.html', 'about.html': 'web/about.html' };
export const FILES = { 'puzzles.js': 'web/puzzles.js', 'base.css': 'web/base.css' };
export const FOLDERS = { app: 'web/app', engine: 'engine' };
