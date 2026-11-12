# Enemies reference (read `../SKILL.md` first)

One file per enemy: `data/enemies/<id>.json` (snake_case id). Study `data/enemies/nibbit.json`
(cycle) and `sludge_spinner.json` (random). Rules are in `data/validate/enemies.ts`; behaviour in
`engine/enemy.ts`. Use the fields declared in `EnemyDef` in `engine/types.ts`. Enemy starting powers
and some move kinds are being added to the contract under card #215: if the page needs something the
types lack (starting powers such as Artifact, once-per-fight moves, new effects), stop and report.

## Field mapping

| Wiki | JSON |
|---|---|
| Name | `name`; `id` = snake_case name; `code` = new permanent two-character code, unique, not in `reserved-codes.json` |
| Debut (Act N, zone) | `act`, `zone` (see `ZONES` in `data/validate/lists.ts`) |
| Encounter type (Normal/Elite/Boss) | `difficulty` (`DIFFICULTIES` in the same file) |
| HP "72 (76 at Ascension 8)" | `hp: {min,max}` inclusive; a single value is `min == max`; a range "42-46" is min/max. The A8 value goes in `ascension["8"].hp` |
| Each move row | `moves.<camelId>`: `{ name, effects }`, effects in table order from the base column |
| "N damage x K" | `{ "type": "attack", "damage": N, "hits": K }` |
| Block, Strength, debuffs on the player | the matching `Effect` from `engine/types.ts` (enemy moves may not use card-only effects, `applyPoison`, `gainEnergy` or `xTimes`; the validator says which) |
| Move pattern prose | `pattern`: `cycle` (`order`, `start: first|random`, optional `opener`) or `random` (`moves`, `noRepeat`, optional `opener`) |
| Ascension column / changes | `ascension["<level>"]` with `hp`, `moves.<id>.effects` or `pattern` |

## Rules

- Ascension overrides are cumulative: A9 applies A8 then A9. Write only what changes at each level
  (the wiki lists A8 HP and A9 damage separately). A move override replaces the whole effect list, so
  restate every effect of that move, changed or not.
- Numbers are printed base values; Strength and Vulnerable are applied by the engine.
- "Cannot use the same move twice in a row" is `noRepeat: true`; "always opens with X" is `opener`.
- Check HP and move numbers against the Update History (SKILL.md section 2) before writing; the
  infobox may already show a beta patch.
- Add or update the enemy's test data only if the validator or an existing test enumerates enemies.
