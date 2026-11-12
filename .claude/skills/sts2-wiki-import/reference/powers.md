# Buffs and debuffs reference (read `../SKILL.md` first)

Powers are rules, not data files: the work is engine code plus tests, so check the contract first.
Player powers are `PowerId` and enemy powers `EnemyPowerId` in `engine/types.ts` (see its Contract
map); debuffs on creatures live in `debuffs` (e.g. `vulnerable`). If the contract lacks a field you
need, stop and report. Example pages: Artifact (https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Artifact).

## Capture from the page

- Buff or debuff, and who can have it (player, enemies, both). Artifact: "currently only enemies".
- Stack type: counter (amounts add, as Artifact) or duration (ticks down) or flag.
- When it changes: ticks down at end of whose turn (see the Turn order bullet in CLAUDE.md for the
  existing order), is consumed per use (Artifact loses one stack per negated debuff), or never.
- What it modifies: damage dealt or taken, Block, draw, energy, debuff application, a trigger.
  Include interactions listed on the page (Artifact: Expose removes all of it).
- Which enemies start with it and how many; those go in the enemy file once #215 lands.
- The Update History rows, applying the version rule in SKILL.md (some pages have no table; then
  the infobox stands, and say so in the report).

## Where it goes

- Implement in `engine/` (pure TypeScript, seeded `Rng`, no `Math.random()`); add the id to the
  contract only via a card that allows the type change.
- Every rule gets a test next to the code (`engine/combat.*.test.ts`), and a numbered line in
  `FEATURES.md` for each new rule.
- Cards that apply it use the `applyPower` / `applyEnemyPower` effects; update the effect table in
  `reference/cards.md` when a card becomes expressible.
