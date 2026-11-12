# Golden combats

Each `*.json` here is a real combat played by hand in the game. `golden.test.ts` replays every
fixture through the real engine with the real data and compares turn by turn. To add a combat,
copy a fixture, edit it and run `npm test`. Fields that were not recorded are left out and are
not checked. The synthetic fixtures at the end of `golden.test.ts` show every field in use.

## Fixture format

- `combat`, `source`, `gameVersion`: name (also the file name), where it was recorded, game version.
- `character`, `ascension`: ids as in `data/`.
- `deck`: `[{ "card": id, "count": n, "upgraded"?: true }]`. Before Ascension additions.
- Card references everywhere else (hands, plays, draws, choices) are ids, with `+` appended for an
  upgraded card (`"strike+"`). `"strike"` means a Strike that is not upgraded.
- `enemy`: `{ "id", "startHp" }`. The engine is made to roll exactly `startHp`.
- `player`: `{ "startHp", "maxHp" }`. The engine starts at `startHp` (`CombatConfig.startHp`), so
  player HP is compared directly.
- `relics` (optional): `[{ "id", "choice"? }]` in pick order. `choice` is the relic's setup value
  (Girya's Strength; the starting count of a counter relic such as Happy Flower or Iron Club).
- `potions` (optional): potion ids in slot order.
- `playerStart` (optional): `{ "strength"?, "debuffs"?: { "vulnerable": n, … }, "powers"?: { "plating": n, … } }`,
  applied before combatStart relics. Start-of-turn rules still run on turn 1 (Plating drops by 1).
- `turns[]`, in order:
  - `hand`: the cards drawn at the start of this turn (any order). The engine is made to draw exactly these.
  - `drawn` (optional): cards drawn during the turn (Pommel Strike), in order. Checked, and forced.
  - `plays`: cards in play order (use the listed order when the game order was not recorded).
  - `potions` (optional): `[{ "potion": id, "beforePlay": n }]`: used before play `n` (1-based;
    `plays.length + 1` = after the last play, before ending the turn).
  - `choices` (optional): `[{ "source"?: cardId, "pick": [cards] }]`, one per "choose a card"
    prompt this turn, in order (Armaments: which card to upgrade). `source` is checked when given.
  - `atStart`: state when the player's turn begins (after the draw and start-of-turn powers, before potions).
  - `afterPlays`: state when the player ends the turn. On the turn that wins, only `enemy.hp: 0` is
    checked, taken from the result.
  - `afterEnemy`: state after the enemy's move (read at the start of the next turn).
    `player.block` is not allowed here: Block resets at the start of the turn.
  - `enemyMove` (optional): the enemy's move id after this turn's plays (single enemy, random pattern).
    Give it on every turn or none. The harness forces that order and rejects an illegal one (not in
    the pool, a second once-per-fight move, a no-repeat violation, a broken opener) with
    `enemy moves: turn N: …`. Turn 1's move is the opener when there is one.
  - `enemyHpAfterEachPlay`: enemy HP after each play (and before any potion used before the next play).
  - State is `{ "player"?: {…}, "enemy"?: {…} }`. Fields: `hp`, `block`, `strength`, `shrink`,
    `energy`, `poison`, `vulnerable`, `weak`, `frail`, and any simulated power by id (player:
    `plating`, `flameBarrier`, …; enemy: `artifact`, `slippery`, `strengthPerTurn`, …; absent = 0).
    Every field is optional; an unknown field fails the consistency test.
- `result`: `{ "outcome": "win" | "loss", "turns", "finalHp", "hpLost" }`. `finalHp` is after
  end-of-combat heals (Burning Blood); `hpLost` is `startHp - finalHp` and may be negative.
- `knownDiffs` (optional): `[{ "diff": "<exact mismatch line>", "reason" }]`. A record that disagrees
  with the engine is committed as a documented finding instead of forcing the engine. Each listed
  diff must still occur (a fixed one fails as "stale knownDiff"); any other mismatch still fails.
- `skip` (optional): a reason; the replay is skipped (the consistency test still runs).

## How the harness forces the game

The test mocks `engine/rng.ts`: the first `int` call (the enemy HP roll) returns `enemy.startHp`,
and `shuffle` orders each pile so the draws follow the recorded `hand` and `drawn` lists in order.
Nothing in `engine/types.ts` changes. Cards added to the discard pile (Vantom's Wounds) are forced
like any other once reshuffled. A draw that spans a reshuffle works if the recorded draws are
consistent with the piles; cards in a shuffle beyond the last recorded draw are in any order.

Limits: a card put into, or taken from, the draw pile between shuffles (an `addCards` to the draw
pile, Headbutt, Stratagem) cannot be forced; the harness reports it as
`turn N: <card> added to drawRandom (…); the shuffle mock cannot force later draws`. Record it under
`knownDiffs` or `skip`. Other random effects (random targets or picks) are not scripted, and only one enemy is supported.
A fixture's `enemyMove` order is forced harness-side by giving the enemy a cycle pattern in a copy of the data
(the engine's own random pick is not exercised).
