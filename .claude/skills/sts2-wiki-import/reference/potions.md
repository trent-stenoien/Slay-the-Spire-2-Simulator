# Potions reference (read `../SKILL.md` first)

One file per potion: `data/potions/<id>.json` (snake_case id). Study `strength_potion.json` and
`fire_potion.json`. Rules are in `data/validate/potions.ts`; use-rules in `engine/potions.ts`;
`PotionDef` is in `engine/types.ts`. Bulk text is in `data/raw/potions.txt` (Name|Rarity|Character|Text).

## Field mapping

| Wiki | JSON |
|---|---|
| Name | `name`; `id` = snake_case name; `code` = new permanent two-character code, unique |
| Rarity | `rarity` (`common`, `uncommon`, `rare`, `event`) |
| Character ("Any" or one character) | `character`: `any` or a character code |
| "Gain N Strength" | `{ "type": "gainStrength", "amount": N }` |
| "Deal N damage" | `{ "type": "dealDamage", "amount": N }` (fixed: no Strength/Weak; goes through enemy Block) |
| Text | `description`; `simulated` true only if every effect is in `SIMULATED_POTION_EFFECTS` |

Also set `source: "slaythespire.wiki.gg"` and `lastUpdateVersion` to the manifest version. A new
potion also needs a use-rule in `engine/potions.ts` (`pickPotion`), or no strategy will ever use it.
