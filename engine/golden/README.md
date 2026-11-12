# Golden combats

Each `*.json` here is a real combat played by hand in the game. `golden.test.ts` replays every
fixture through the real engine with the real data and compares turn by turn. To add a combat,
copy a fixture, edit it and run `npm test`. Fields that were not recorded are left out and are
not checked.

## Fixture format

- `combat`, `source`, `gameVersion`: name (also the file name), where it was recorded, game version.
- `character`, `ascension`: ids as in `data/`.
- `deck`: `[{ "card": id, "count": n, "upgraded"?: true }]`. Before Ascension additions.
- `enemy`: `{ "id", "startHp" }`. The engine is made to roll exactly `startHp`.
- `player`: `{ "startHp", "maxHp" }`. The engine always starts at Max HP, so HP is compared as
  HP lost from the start: `startHp - recorded HP` against `Max HP - engine HP`.
- `turns[]`, in order:
  - `hand`: the cards drawn this turn (ids, any order). The engine is made to draw exactly these.
    A draw that spans a reshuffle works if the hands in the fixture are consistent with the deck.
  - `plays`: card ids in play order (use the listed order when the game order was not recorded).
  - `atStart`: state when the player's turn begins (after the draw).
  - `afterPlays`: state when the player ends the turn. On the turn that wins, only `enemy.hp: 0`
    and `player.hp` are checked, taken from the result.
  - `afterEnemy`: state after the enemy's move (read at the start of the next turn).
    `player.block` is not allowed here: Block resets at the start of the turn.
  - `enemyHpAfterEachPlay`: enemy HP after each play, one number per play.
  - State is `{ "player"?: { hp, block, strength, vulnerable, weak, frail }, "enemy"?: { hp, block,
strength, vulnerable, weak, frail } }`. Every field is optional.
- `result`: `{ "outcome": "win" | "loss", "turns", "finalHp", "hpLost" }`. `hpLost` is
  `startHp - finalHp`.

## How the harness forces the game

The test mocks `engine/rng.ts`: the first `int` call (the enemy HP roll) returns `enemy.startHp`,
and `shuffle` orders the pile so the draws follow the recorded hands. Nothing in the engine or
`engine/types.ts` changes. Limits: hands must come from the normal draw (no extra draw effects),
and a card the engine adds to the piles is not scripted.
