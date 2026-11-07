# What makes a good arrow picture

The running record of taste for this library. Read it before generating or
writing puzzles, and add to it whenever feedback comes in.

## From feedback

- **Colors in order: scarlet, yellow, purple**, then blue and green if a
  puzzle needs more. A combined arrow is always brown. Generated puzzles name
  their colors this way. (2026-11-01)
- **Themes, each climbing from 1 star to 5** (the test player's request). Each theme
  is a folder listed in `puzzles/library.json`; the build fails a theme whose
  stars don't start at 1, end at 5 and never go down. Generator recipes
  `mm-1`..`mm-5`, `an-1`..`an-5`, `ld-1`..`ld-5`, run with `--rating N`.
  - *Mastermind Mysteries*: very few dots, mostly working out rules.
    The 5-star one needs 9 dots and a secret recipe to reach 5 stars.
  - *Arrows and Nodes*: rules to find and dots to fill.
  - *Lots of Dots*: every rule shown, 10 to 20 dots to work out.
  - *Below Zero*: practice for negatives, one move per puzzle: going down
    past zero, adding to a negative, subtracting from a negative, × and ÷
    on negatives, then all of them. Recipes `bz-1`..`bz-5` use fixed rule
    pools and `focus` counts so each puzzle drills its move; 1 and 2 stars
    are forward-only (no undoing arrows). Each puzzle has a `tip` shown on
    the page, using the elevator analogy; a tip's example must not be a
    step in its own puzzle. Made when he got stuck on negatives in
    Dot-pocalypse.
  - *I'll Take 'em All!*: one puzzle in each theme's style, in star
    order: Mastermind (1), Arrows and Nodes (2), Lots of Dots with a secret
    brown recipe to identify (3), Below Zero (4), then everything at once
    (5: mystery rules, secret recipe, negatives, 10 empty dots). Recipes
    `ta-1`..`ta-5`.
  - *Missing Arrows* and *Road Builder*: the two CSMP drawing activities
    (see below). Recipes `ma-1`..`ma-5` and `rb-1`..`rb-5`.
  - *Mastermind Mysteries II*: more of the test player's favorite theme, with
    several combined arrows whose recipes are shown: brown alone, then
    brown and gray (the same two rules in both orders), then brown, gray
    and white. Recipes `m2-1`..`m2-5`.
  - *Code Breakers*: Mastermind-style rule finding with a brown arrow whose
    recipe is shown. From ★★★ on, yellow never gets an arrow of its own
    (`inside` in the recipe), so it can only be worked out through brown;
    ★★★★★ has a three-step brown arrow (scarlet, yellow, scarlet) and four
    mystery rules. Recipes `cb-1`..`cb-5`.
  - *Road Trips*: road building mixed with filling in, designed by hand
    (not generated): fix a half-built road (CSMP's "label the arrow road"),
    a ⭐ checkpoint whose number a clue arrow gives, a mystery road color
    learned from two arrows, road ends with no numbers, then all of it at
    once. The ★★ checkpoint uses +10/+2 because with × or a step back the
    checkpoint either makes the road very long or counts as a detour.
    The first ★★★★★ (clue groups in the corners, a clue dot in the road's
    path, a broken piece, four ideas at once) didn't work for the test player: too
    busy to see what connected to what. Redone 2026-11-07 with the clue
    arrows as pieces of the road itself and nothing else on the sheet.
    Keep road puzzles uncluttered: few given dots, every one on the road.
- Drawing puzzles, after the CSMP first-grade lessons (F71.2, F87.2,
  F102.1, F104.2: "draw all the missing arrows"; and "build a road from 2
  to 23 using +5 and −2 arrows"):
  - `"draw": {"color"}`: the answer is every true arrow of that color
    between two dots that isn't drawn yet, worked out by the engine. The
    dots must be solvable without them. The page shows how many are missing.
  - `"road": {"from", "to", "colors"}`: two given dots and no arrows. The
    player draws arrows into empty space to make new dots, types each new
    number, and finishes with an arrow into the end dot. Any road solves it;
    the engine finds the shortest (breadth-first, within the puzzle's
    number range) and the page says whether his road was that short. Every
    color must be needed for the shortest road.
  - A road may also have `"via"` checkpoints (in order), dots placed with
    `"at": [column, row]`, arrows already drawn (the road may follow them,
    and difficulty counts only the arrows still to draw), mystery road
    colors, and ends with no given number. The page marks the start 🚗,
    checkpoints ⭐ and finish 🏁. It's solved when every dot is right and
    the road gets through.
  - Each arrow is judged the moment it is drawn and its number sentence is
    shown ("8 + 3 = 11 ✓", or "7 + 1 = 8, not 9"), the way a CSMP class
    reads each arrow aloud. Both ends need their right numbers first. For a
    mystery color the sentence stays hidden until he has found the rule.
  (2026-11-01)
- **Solved sets go to the archive, still playable.** `puzzles/archive/`
  holds the first 12 and the second 14; the app lists them in a fold-out
  under the themes. New puzzles get new ids so they don't show as solved.
  (2026-11-01)
- **No multiplying by a negative.** Rules use positive constants only, and
  any mix of them multiplies by a positive amount, so ×−5 is never a
  possibility the player has to rule out (1 to −5 is −6). Tested.
  (2026-11-01)
- **Secret recipes** (suggested by our youngest player). A combined color can hide its recipe
  with `"hidden": true`; the player picks each part from a dropdown of the
  plain colors, in order, repeats allowed. The checker tries every choice and
  fails the puzzle unless exactly one fits, so two steps that give the same
  result either way round (+3 and −1) can't be used. Recipes `secret-recipe`
  and `secret-recipe-plus` generate them. (2026-11-01)
- **Two-arrow rule.** A mystery color is only settled by two of its arrows
  starting from different numbers (after undoing known steps in a combined
  arrow). One arrow never settles it: 19 to 16 could be −3, or ×2 then −22.
  Any mix of steps is "multiply by m, then add c", and two arrows fix both,
  so no puzzle relies on "each color is one whole-number step". The
  checker fails puzzles that need it (`needs-two-arrows`). (2026-11-01)
- **No color that just undoes another.** ×2 and ÷2 as separate colors
  is redundant: an arrow the other way says the same thing. Likewise a
  combined arrow that cancels out, or one that repeats another color. The
  checker warns (`redundant-colors`) and the generator rejects it. (2026-11-01)
- **Never depend on the size limit of rules.** 9 to 36 alone does not
  settle a rule: it could be +27 or ×4. Now covered by the two-arrow rule.
  (2026-11-01)
- **Connected pictures.** Prefer one connected picture over several
  separate groups that each solve on their own. Not a hard rule, so the
  checker warns (`disconnected`) rather than failing. (2026-11-01)
- **Fractions stay between −1 and 1** at the default level: ½, ⅔ and −½
  yes, 11/2 no. Improper fractions feel out of place to an early fraction
  user. This includes the hidden middle number of a combined arrow. A puzzle
  can opt into `"fractions": "any"` for a later, harder level. (2026-11-01)
- **Denominators up to 12**, not just halves, thirds and quarters. (2026-11-01)
- **Tips teach an idea, never how to solve the puzzle.** The Below Zero
  tips (elevator floors, owing money) stay; tips like "you already know
  yellow, so brown tells you about scarlet" were removed. (2026-11-07)
- **Combined arrows are brown, then gray, then white**, in the order the
  puzzle lists them; a white road gets a dark edge so it shows on light
  paper. (2026-11-07)
- **Standard minus sign**, not CSMP's hat notation. (2026-10-31)
- **Say "negative" for a number below zero** ("negative forty", "the negative
  sign"); "minus" only means subtracting ("−5" as a rule reads "minus 5").
  (2026-11-07)

## Working principles

- Hard should mean a long, narrow chain of forced steps, not missing
  information. Every puzzle must have exactly one solution.
- A puzzle that needs a guess (`case-split` warning) is frustrating for a
  young solver. Keep it rare and say so in the title.
- Loops that close back on themselves are satisfying: the last step checks
  the earlier work.
- Combined arrows (scarlet then blue) are the most interesting single feature;
  undoing one in reverse order is a real skill.
- Keep the arithmetic from becoming the obstacle: magnitudes mostly under
  100, rule constants small.
