# Arrow Pictures

CSMP-style arrow picture puzzles: colored arrows stand for operations, and
the player fills in the missing numbers or works out the mystery rules.

**Play it at https://robinba-math.github.io/arrow-pictures/**

The site in `dist/` is plain static files, published to GitHub Pages from
`main` (see [Publishing](#publishing)). Progress is saved in
the player's browser. The [About page](web/about.html) explains the puzzles.
Design decisions and lessons from play-testing are in
[puzzles/DESIGN-NOTES.md](puzzles/DESIGN-NOTES.md).

## Layout

```
engine/
  rational.js   exact fractions; no floating point anywhere
  ops.js        operations, their inverses, the finite rule family
  puzzle.js     loads the JSON contract, structural checks
  solver.js     exhaustive solver: proves a puzzle has exactly one solution
  trace.js      human-style solver: difficulty rating and hints
  index.js      public API: checkPuzzle(), prepare()
bin/arrows.js   command-line front end
web/            the site: index.html (the puzzles), about.html, base.css,
                app/ (layout, render, app), puzzles.js (built)
scripts/        build-web.js bundles the library; build-site.js assembles dist/;
                serve.js runs it locally; generate.js makes new puzzles
puzzles/        the library: library.json lists the themes (each a folder,
                1 star to 5) and the archive; every puzzle must pass `check`
puzzles/fixtures/  deliberately broken puzzles the tests rely on
test/           node:test suite
```

The engine has no dependencies and runs unchanged in Node and the browser.

## Commands

Needs Node 22 or later. No packages to install.

```sh
npm test                                   # run the suite
npm run build                              # bundle the library (refuses invalid puzzles)
npm run serve                              # play at http://localhost:8080
node bin/arrows.js check puzzles/lots-of-dots/*.json   # validate, solve, rate
node bin/arrows.js check p.json --json     # machine-readable report
node bin/arrows.js hint p.json board.json  # next hint for a board
```

A board is the player's entries so far:

```json
{ "values": { "c": "10" }, "rules": { "scarlet": "×3" } }
```

`check` exits non-zero if any puzzle fails, so it can gate the library.

## What `check` enforces

- Exactly one solution
- Every connected group of dots has at least one given value
- Composite colors reference real colors, with no cycles
- Every value stays in range: denominators up to 12, magnitude up to 999

It warns, but does not fail, when a puzzle is unique yet needs a hypothesis
to solve, because no step is forced at some point.

## Publishing

The **Publish** workflow (`.github/workflows/pages.yml`) runs on every push to
`main`: it runs the tests, bundles the library, builds `dist/` with
`npm run site`, and deploys it to GitHub Pages. In the repository's settings,
set Pages to deploy from **GitHub Actions**.

## License

MIT. See [LICENSE](LICENSE).
