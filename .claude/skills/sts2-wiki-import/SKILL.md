---
name: sts2-wiki-import
description: Import or update Slay the Spire 2 records (cards, enemies, buffs/debuffs) in data/ from slaythespire.wiki.gg, applying the main-release version rule. Use whenever data comes from the wiki.
---

# STS2 wiki import

Shared procedure for any record imported from slaythespire.wiki.gg into `data/`. Then read the
reference file for the record type:

| Record | Reference |
|---|---|
| Cards (`data/cards/`) | `reference/cards.md` |
| Enemies (`data/enemies/`) | `reference/enemies.md` |
| Buffs and debuffs | `reference/powers.md` |

Potions and relics are added by their own cards (#204, #205); keywords/mechanics when needed.
Type index with examples: https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Main

## 1. Fetch

Use the WebFetch tool on the page URL (`https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:<Name>`);
shell tools such as curl cannot reach the wiki. Ask explicitly for: the infobox values, the
move/effect table, Ascension changes, and the full Update History table with its Type column.
Card tables may show beta values, so always apply the version rule below.

## 2. Version rule

The game version we import is `gameVersion` in `data/manifest.json` (main release). In the page's
Update History, find the latest row of Type "Major Update" at or before that version. Every change up
to and including it is in main (a Major Update merges the earlier beta patches). Ignore rows of Type
"Beta Patch" NEWER than that Major Update, and undo their values if the infobox already reflects them.
Skip any content under a "Beta Content Warning" or marked "(Beta only currently)". Do not delete
existing beta-only records yourself; ask in the hand-back report.

## 3. Conflicts

When infobox or table values disagree with the changelog as of the manifest version, the changelog
wins; record each conflict in the hand-back report. Example: Vantom's infobox says 9 Slippery and
Dismember 27, but the V0.104.0 beta patch (merged to main by Major Update V0.107.1) lowered them to
8 Slippery (9 at the higher Ascension level) and 26; the game confirms 8 and 26.

## 4. Game overrides wiki

Values Trent has confirmed from the game override the wiki. Note them in the report.

## 5. Repo rules

- Codes are permanent (`data/reserved-codes.json` lists removed records; never reuse those).
- Source is CC BY-SA 4.0; keep attribution in `data/LICENSE`.
- Use only fields declared in `engine/types.ts`, which is the contract; never change it on a feature
  branch. If the page needs something the types lack, stop and report what and why.
- Stamp `lastUpdateVersion` with the manifest version.
- Run `npm run format`, `npm run typecheck` and `npm test`; the validator (`data/validate/`) must
  report no errors.
