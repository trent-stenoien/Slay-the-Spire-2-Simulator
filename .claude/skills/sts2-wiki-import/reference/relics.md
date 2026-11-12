# Relics reference (read `../SKILL.md` first)

One JSON file per relic in `data/relics/<id>.json` (`RelicDef` in `engine/types.ts`), checked by
`data/validate/relics.ts`. Engine: hook dispatch in `engine/relics.ts` + the `relic*` methods of
`engine/combat.ts`. Per-relic status: `docs/relics-v1.md`.

## Shape

```json
{
  "id": "horn_cleat", "code": "HC", "name": "Horn Cleat", "rarity": "uncommon", "character": "any",
  "hooks": [{ "when": "turnStart", "turn": 2, "effects": [{ "type": "gainBlock", "amount": 14 }] }],
  "description": "At the start of your 2nd turn, gain 14 Block.",
  "simulated": true, "lastUpdateVersion": "v0.107.1"
}
```

- `rarity`: starter, common, uncommon, rare, shop, boss, ancient, event (the wiki's "Event" and
  merchant "???" relics are `event`). `character`: a character code (`"I"`) or `"any"`.
- `description`: the wiki text, with energy icons written as "1 Energy".
- Codes are two characters, unique among relics, permanent.
- Not expressible with the types below → keep the data, set `"simulated": false`, and say why in
  `docs/relics-v1.md`. Never bend a type to fit.

## Wiki text → JSON

| Wiki text | JSON |
|---|---|
| Start each combat with N Strength / Thorns / Dexterity / Vigor | `combatStart` hook: `gainStrength` / `applyPower` thorns, dexterity, vigor |
| At the start of each combat, heal N / apply N Vulnerable | `combatStart` hook: `heal` / `applyVulnerable` |
| Start each combat with N Block / extra Energy / N Plating; draw N more at combat start | `turnStart` hook with `"turn": 1` (Block resets and energy refills at turn start) |
| At the start of your Nth turn … | `turnStart` hook with `"turn": N` |
| At the start of your turn … | `turnStart` hook, no turn |
| Every N turns … | `turnStart` hook with `"everyTurns": N` (fires on turns N, 2N, …) |
| At the end of turn N … | `turnEnd` hook with `"turn": N` |
| If you end your turn without Block, gain N Block | `turnEnd` hook: `conditional` counter `playerBlock` max 0 |
| At the end of combat, heal N | `combatEnd` hook (wins only) |
| Every N cards you play … | `cardPlayed` hook with `"everyCards": N` (+ `filter`); counted per combat |
| Gain N Energy / draw N more each turn | modifier `energyPerTurn` / `drawPerTurn` |
| Cards containing "Strike" deal N more | modifier `cardDamageBonus` + `filter.nameIncludes` |
| Lose 1 less HP / at most N HP a turn | modifier `hpLossReduce` / `hpLossCapPerTurn` |
| Unblocked attack damage of 4 or less becomes 5 | modifier `minUnblockedAttack` 5 |
| Energy conserved / hand not discarded / max N cards a turn / X + N / Dexterity without potions / no potions | `conserveEnergy` / `keepHand` / `cardsPerTurnLimit` / `xBonus` / `dexterityWithoutPotions` / `noPotions` |
| Choice in setup (Girya) | `choice` + hook `"amountFromChoice": true` |
| Counter that carries between combats (Happy Flower, Pollinous Core, Iron Club) | `choice` with values 0…N−1, default 0, on a relic with an `everyTurns` / `everyCards` hook: the starting count |
| One-off rule | modifier `script` with an `id` from `RELIC_SCRIPTS` in `engine/relics.ts`: `ornamentalFan` (every 3rd Attack in a turn), `bellows`, `ghostSeed`, `confused` (Snecko Eye), `slingOfCourage` (Elites only) |

Relic Block is not from a card: Dexterity and Frail don't change it. Hooks fire in the order the
relics were picked. Ghost Seed affects only basic (rarity `basic`) Strikes and Defends.
