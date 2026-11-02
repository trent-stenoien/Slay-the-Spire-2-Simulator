---
name: sts2-card-import
description: Fill in effects, keywords and the simulated flag for Slay the Spire 2 card JSON files in data/cards/, from the wiki card text. Use when importing or updating STS2 cards in this repo.
---

# STS2 card import

You are completing card files that a script already generated from the wiki export
(`data/raw/cards.txt`, built by `tools/build-card-skeletons.mjs`). Every file already has
correct metadata. **Your job is only these fields:** `effects`, `upgraded.effects`,
`keywords`, `upgraded.keywords` (only if they change on upgrade), and `simulated`.
Never change `id`, `code`, `name`, `type`, `rarity`, `character`, `cost`, `xCost`,
`starCost`, `upgraded.cost`, `description`, `upgradedDescription`, `multiplayerOnly`
or `lastUpdateVersion`. Never touch `engine/` or `data/validate.ts` / `data/validate/`.

The contract is `engine/types.ts` (`CardDef`, `Effect`). Read it once before starting.

## Main-release data only

Import only main-release data (the game version in `data/manifest.json`), never beta-branch
data. The wiki marks beta content with a "Beta Content Warning" banner or "(Beta only
currently)"; skip those cards, and use the main-release numbers where a page shows both.
If a card already in `data/cards/` turns out to be beta-only, don't delete it yourself: add a
question instead. Beta-only cards that were removed (Soulbound, Underworld, Cacophony) are
listed in `data/reserved-codes.json`; their codes stay reserved (codes are permanent), the
skeleton script skips them, and the validator rejects any card that uses a reserved code.

## Reading the card text

`description` / `upgradedDescription` are already split into base and upgraded text.
- ` / ` separates lines on the card.
- `[E]` is one Energy icon: `[E][E]` = 2 Energy. `0 [E]` means "costs 0".
- `[STAR]` is one Star icon (Regent): `[STAR][STAR]` = 2 Stars; `9 [STAR]` = 9 Stars.
- A standalone line `Exhaust.`, `Ethereal.`, `Unplayable.`, `Eternal.`, `Retain.`,
  `Innate.` or `Sly.` is a keyword. "Exhaust 1 card" is NOT the keyword.

## Effect vocabulary (the ONLY allowed effect objects)

| Card text | Effect |
|---|---|
| Deal N damage. | `{ "type": "attack", "damage": N, "hits": 1 }` |
| Deal N damage twice / K times. | `{ "type": "attack", "damage": N, "hits": K }` |
| Deal N damage to ALL enemies. | `{ "type": "attack", "damage": N, "hits": 1, "allEnemies": true }` |
| Deal N damage to a random enemy (K times / twice). | `{ "type": "attack", "damage": N, "hits": K }` (no target flag) |
| Gain N Block. | `{ "type": "gainBlock", "amount": N }` |
| Gain N Strength. (permanent) | `{ "type": "gainStrength", "amount": N }` |
| Apply N Vulnerable. | `{ "type": "applyVulnerable", "amount": N }` |
| Apply N Weak. | `{ "type": "applyWeak", "amount": N }` |
| Apply N Frail. | `{ "type": "applyFrail", "amount": N }` |
| Apply N Poison. (fixed N, the one/target enemy) | `{ "type": "applyPoison", "amount": N }` |
| Gain N Stars. | `{ "type": "gainStars", "amount": N }` |
| Gain [E] / [E][E] / N [E]. (this turn) | `{ "type": "gainEnergy", "amount": N }` |
| (X-cost card) Deal N damage X times. | `{ "type": "attack", "damage": N, "hits": 1, "xTimes": true }` |
| (X-cost card) Deal N damage to ALL enemies X times. | `{ "type": "attack", "damage": N, "hits": 1, "allEnemies": true, "xTimes": true }` |
| (X-cost card) Deal N damage to a random enemy X times. | `{ "type": "attack", "damage": N, "hits": 1, "xTimes": true }` (no target flag) |
| (X-cost card) Deal N damage X+1 times. | `{ "type": "attack", "damage": N, "hits": 1, "xTimes": true, "xBonus": 1 }` |
| Lose N HP. (the player; #106) | `{ "type": "loseHp", "amount": N }` |
| Draw N card(s). (#107) | `{ "type": "draw", "amount": N }` |
| Draw cards until your Hand is full. | `{ "type": "drawUntil", "handFull": true }` |
| Draw cards until you draw a non-Attack card. | `{ "type": "drawUntil", "stopOn": { "notTypes": ["attack"] } }` |
| You cannot draw additional cards this turn. | `{ "type": "applyPower", "power": "noDraw", "amount": 1 }` |
| Exhaust N card(s). (you choose, from your Hand; #108) | `{ "type": "exhaustCards", "count": N, "mode": "choose" }` |
| Exhaust N card(s) at random. | `{ "type": "exhaustCards", "count": N, "mode": "random" }` |
| Exhaust up to N cards in your Hand. | `{ "type": "exhaustCards", "count": N, "mode": "choose", "upTo": true }` |
| Exhaust all non-Attack cards in your Hand. Gain N Block for each card Exhausted. | `{ "type": "exhaustCards", "mode": "all", "filter": { "notTypes": ["attack"] } }`, `{ "type": "repeat", "per": "lastEffectCount", "effects": [{ "type": "gainBlock", "amount": N }] }` |
| Exhaust your Hand. Deal N damage for each card Exhausted. (Fiend Fire) | `{ "type": "script", "id": "fiendFire", "values": [N] }` |
| Exhaust a random Attack in your Hand and add its damage to this card. (Thrash) | `{ "type": "script", "id": "thrash" }` (after the card's `attack`) |
| When this card is Exhausted, gain N [E]. (Drum of Battle) | card field `"triggers": [{ "when": "exhausted", "effects": [{ "type": "gainEnergy", "amount": N }] }]`; an upgraded value goes in `upgraded.triggers` |

`gainEnergy` is only for energy gained right now ("When this card is Exhausted, gain [E]" is a
`triggers` entry, above). "Next turn, gain [E]", "Gain [E] at the start of each turn", conditional gains and
"Another player gains [E]" have no effect object.

X is all the energy available when the card is played (the card spends all of it).
`xTimes` (only on cards with `"xCost": true`) makes the attack repeat X times: total hits =
`hits` × (X + `xBonus`). Only "X times" attacks are expressible; other uses of X (X Weak,
Channel X, play X cards, …) and Regent's X-Star cards have no effect object.

Fights are single-enemy for now: a random-target attack always hits the one enemy, and
ALL-enemies damage counts once. `engine/types.ts` has no `randomTarget` flag, so random-target
damage is a plain `attack`, including random-target "X times" (e.g. Volley, an `xTimes`
attack like the rows above). "For each", Osty and power triggers ("Whenever …, deal N damage
to a random enemy") still have no effect object.

Effects go in card-text order. Damage/Block numbers are the printed base values
(Strength is applied by the engine). If the upgraded effects differ in any way, write the
FULL upgraded list in `upgraded.effects` (it replaces the base list). If only the cost or
keywords change, leave `upgraded.effects` out.

Anything not in the table (discard, delayed or conditional energy gain, conditional draw, Doom, Orbs,
Summon, Forge, "this turn" Strength, conditions, X-cost scaling other than "X times" attacks, "for each",
creating cards, powers, multiplayer, Poison that is conditional, scaling,
or random-target Poison/debuffs, …) has no effect object. Record the parts
you CAN express, in order, and skip the rest.

## simulated

Set `"simulated": true` only when ALL of these hold, for base AND upgraded versions:
1. Every sentence of the text is captured by the effects/keywords above.
1a. `repeat` only as "for each card Exhausted" (`per: "lastEffectCount"`), `script` only
   `fiendFire` / `thrash`, `triggers` only `"when": "exhausted"`. Other uses of `conditional`,
   `attackFrom`, `repeat` or triggers (Evil Eye, Ashen Strike, Pact's End, Howl from Beyond)
   are recorded with `simulated: false`.
2. Keywords are only `unplayable`, `ethereal`, `eternal`, `exhaust`, `innate`, `retain`
   (`sly` is recorded only, not simulated).
3. No `gainStars` effect, no `starCost`, not `xStarCost`. An `xCost` card qualifies only
   when every X in its text (base and upgraded) is an "X times" attack (`xTimes`).
4. Type is attack or skill (powers, statuses with end-of-turn effects, quests → false).
   Exception: a status/curse whose whole text is keywords (e.g. `Unplayable. Ethereal.`)
   can be `true`.
Otherwise `false`. When unsure, `false` — and add a question (below).

## Examples

Bash — `Deal 8 damage. / Apply 2 Vulnerable.` → `Deal 10 damage. / Apply 3 Vulnerable.`
```json
"effects": [{ "type": "attack", "damage": 8, "hits": 1 }, { "type": "applyVulnerable", "amount": 2 }],
"upgraded": { "effects": [{ "type": "attack", "damage": 10, "hits": 1 }, { "type": "applyVulnerable", "amount": 3 }] },
"keywords": [], "simulated": true
```
Venerate — `Gain [STAR][STAR].` → `Gain [STAR][STAR][STAR].`
```json
"effects": [{ "type": "gainStars", "amount": 2 }],
"upgraded": { "effects": [{ "type": "gainStars", "amount": 3 }] },
"simulated": false
```
Breakthrough — `Lose 1 HP. / Deal 9 damage to ALL enemies.` → `Lose 1 HP. / Deal 13 damage to ALL enemies.`
```json
"effects": [{ "type": "loseHp", "amount": 1 }, { "type": "attack", "damage": 9, "hits": 1, "allEnemies": true }],
"upgraded": { "effects": [{ "type": "loseHp", "amount": 1 }, { "type": "attack", "damage": 13, "hits": 1, "allEnemies": true }] },
"simulated": true
```
Apparition — base `Ethereal. / Gain 1 Intangible. / Exhaust.`, upgraded `Gain 1 Intangible. / Exhaust.`
```json
"keywords": ["ethereal", "exhaust"], "effects": [],
"upgraded": { "keywords": ["exhaust"] }, "simulated": false
```
Whirlwind (X-cost) — `Deal 5 damage to ALL enemies X times.` → `Deal 8 damage to ALL enemies X times.`
```json
"effects": [{ "type": "attack", "damage": 5, "hits": 1, "allEnemies": true, "xTimes": true }],
"upgraded": { "effects": [{ "type": "attack", "damage": 8, "hits": 1, "allEnemies": true, "xTimes": true }] },
"simulated": true
```
Fuel — `Gain [E]. / Exhaust.` → `Gain [E][E]. / Exhaust.`
```json
"keywords": ["exhaust"], "effects": [{ "type": "gainEnergy", "amount": 1 }],
"upgraded": { "effects": [{ "type": "gainEnergy", "amount": 2 }] }, "simulated": true
```
Dazed (status) — `Unplayable. / Ethereal.` → `"keywords": ["unplayable", "ethereal"], "effects": [], "simulated": true`

## Questions

When a card raises a rules question the project hasn't settled (new mechanic, unclear
wording, a number you can't read), append ONE line to your batch's questions file
(given in your task, e.g. `data/import/questions-silent.md`):
`- **Card Name**: the question in one sentence.`
Group similar cards into one line ("Poison (12 Silent cards): …"). Don't ask about
mechanics already listed as "no effect object" above unless the wording is ambiguous.

## Finish

Run `npm run typecheck && npm test` from the repo root; the validator must report no
errors for your files. Fix any it reports. Commit only your folder's files and your
questions file.
