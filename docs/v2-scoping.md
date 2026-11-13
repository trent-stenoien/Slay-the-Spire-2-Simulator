# v2 scoping: #255 The Silent and #24 Act 2/3 bosses

Checkout: /home/claude/slay-the-spire-2-simulator at origin/main 216236a ("Handoff note: v1 complete"). Read-only; nothing changed.
Game version in `data/manifest.json`: v0.107.1. Sources: repo data, `data/raw/*.txt` (Cargo export), slaythespire.wiki.gg pages fetched today.
Sizes: S = under a day for one agent, M = a normal card, L = engine work touching combat.ts, strategies and validators.
"types.ts change" = needs a change to the shared contract (new PowerId, EnemyPowerId, Counter, Effect field, etc.). Per CLAUDE.md these need Trent/orchestrator approval before the branch starts.

---

## A. #255 The Silent

### A.1 What exists

- `data/characters/silent.json`: present and complete. Max HP 70, energy 3, draw 5, starting deck 5 Strike, 5 Defend, 1 Neutralize, 1 Survivor (12 cards, matches the game), `startingRelic: "Ring of the Snake"`.
- The Silent is greyed "WIP" in the app until every starting-deck card is simulated (`isCharacterSimulated`, `app/components/SetupPanel.tsx`). Neutralize is simulated; **Survivor is not** (it needs Discard), so the Silent cannot be selected today.
- Ring of the Snake (#8): **no relic file exists** (`data/relics/` has no ring_of_the_snake.json; relics-v1.md has no entry). Wiki text: "At the start of each combat, draw 2 additional cards." Expressible today as a `turnStart` hook with `turn: 1` and effect `draw 2` (the draw effect is simulated), so no types.ts change. Matching is by name, so `startingRelic` already lines up and `app/lib/relics.ts` picks it up as the default.
- `data/cards/silent/`: 86 files. **14 simulated**: assassinate, backstab, dagger_spray, dash, deadly_poison, deflect, leg_sweep, neutralize, poisoned_stab, scare, slice, snakebite, sucker_punch, suppress. **72 unsimulated**.
- The Shiv (`data/cards/colorless/shiv.json`) exists and is simulated (0 cost, 4 damage, Exhaust; upgraded 6).
- What the engine already has that the Silent can reuse (all Ironclad-proven): `draw`, `drawUntil`, `moveCards` (hand to discard, choose/all), `addCards` source `card`, `schedule` (next-turn effects), `repeat`/`attackFrom` with counters, `conditional enemyHas poison`, `playableIf` (Clash), `setCost`, `costLessPer` (attacks only), powers `dexterity`, `thorns`, `intangible`, `noDraw`, `choking`, `doubleAttack`, `freeAttack`, `retainHand`, enemy powers `artifact`, `stun`, `strengthLossThisTurn`. `xTimes` attacks work (Skewer).
- What does not exist: Sly (keyword is declared but "recorded only"; not in `SIMULATED_KEYWORDS`), any Poison-trigger powers, Dexterity-this-turn, discard counters, `Counter` for Poison/Skills in hand/cards drawn, Poison on the player (#25), multi-enemy (#5, in progress: `CombatState.enemy` is a single enemy, `CombatConfig.enemyId` is single).

### A.2 Per-card status of the 72 unsimulated cards

Legend for "lacks": DATA = effects can be written with today's vocabulary (card is only `simulated:false` because nobody filled it in); the rest name the missing mechanic.

| Card | Lacks |
|---|---|
| survivor, acrobatics, prepared, dagger_throw | DATA (draw + `moveCards` hand to discard, choose). Needs a discard-choice rule in strategies (question Q-A3). |
| backflip, adrenaline | DATA (gainBlock/gainEnergy + draw) |
| calculated_gamble | DATA likely: `moveCards` hand to discard mode all, then `repeat` per `lastEffectCount` of `draw 1`. Verify in a test. |
| predator | DATA (attack + `schedule` delay 1 `draw 2`) |
| dodge_and_roll | DATA (gainBlock + `schedule` gainBlock). Verify the scheduled Block gets Dexterity/Frail like card Block (Q-A8). |
| skewer (#66) | DATA (`attack` with `xTimes`) |
| grand_finale | DATA (`playableIf` drawPileSize max 0 + `attack` allEnemies 60) |
| strangle | DATA (attack + `applyPower choking 2`; Choking = "enemy loses N HP whenever you play a card this turn") |
| bullet_time | DATA (`applyPower noDraw` + `setCost` hand, 0, duration turn). Q-A9 on ordering. |
| footwork | DATA (`applyPower dexterity 2`) |
| bubble_bubble | DATA (`conditional enemyHas poison` then `applyPoison 9`) |
| piercing_wail | DATA single-enemy (`applyEnemyPower strengthLossThisTurn 6`); ALL enemies needs #5 |
| precise_cut | DATA probably (`attackFrom` 13, bonusPer -2 per `handSize`). Q-A10 (floor at 0?). |
| finisher | `attackFrom` bonusPer attacksPlayedThisTurn, but the counter already includes Finisher itself (combat.ts:859 counts before effects), so "already played" is counter - 1. Needs a decision: negative base or a new counter. |
| expose | script (remove Artifact and Block, then Vulnerable 2); `script` ids need no types.ts change |
| malaise | X-cost for non-attack effects (X Strength loss, X Weak); `xTimes` is attack-only. New script or a new Counter `xValue` (types.ts). |
| hidden_daggers, blade_dance, cloak_and_dagger, leading_strike, up_my_sleeve, storm_of_steel | Shivs: `addCards` source card `shiv` to hand (exists); Hidden Daggers+/Storm of Steel+ add upgraded Shivs (the `upgraded` field of `addCards` is listed as unsimulated for copies: check for source `card`); Storm of Steel count = cards discarded (`repeat` per lastEffectCount); Up My Sleeve reduces its own cost by 1 each play (script). Hidden Daggers and Storm of Steel also need Discard. |
| blade_of_ink | "Inky Shivs": enchantment unknown (Q-A5). Keep unsimulated until answered. |
| knife_trap | "Play every Shiv in your Exhaust Pile on the enemy": `playCards` needs a count of "all matching" (types.ts: `count` is required) |
| accuracy, phantom_blades, infinite_blades, fan_of_knives | Shiv powers: new PowerIds (+4 Shiv damage; Shivs Retain and first Shiv +9; start-of-turn add a Shiv; Shivs hit ALL, needs #5) |
| abrasive, flick_flack, haze, reflex, ricochet, tactician, untouchable | Sly (keyword), then DATA (Abrasive `dexterity 1` + `thorns 4`; Haze Poison ALL; Ricochet random target x4) |
| hand_trick, master_planner | Dynamic Sly: a per-instance Sly flag (`CardInstance`) and a power (types.ts) |
| sneaky, flanking | `multiplayerOnly: true` ("another player"). Leave unsimulated (Q-A6). |
| accelerant, envenom, noxious_fumes, corrosive_wave, outbreak | Poison powers: new PowerIds, Poison tick hook (extra triggers), unblocked-damage hook, turn-start ALL-enemy hook, draw hook, "every 3 Poison applications" counter. Outbreak text mismatch, see Q-A1. |
| mirage | `Counter` for enemy Poison (types.ts); ALL enemies |
| bouncing_flask | random enemy x3; single enemy = 3 x applyPoison 3 (Poison needs one Artifact stack per application, so 3 stacks); #46 note, #45 |
| afterimage, serpent_form, speedster, tools_of_the_trade, well_laid_plans, tracking | New trigger PowerIds (play-card Block; play-card random-enemy damage; draw-trigger ALL damage; turn-start draw+discard; end-of-turn retain choice; Weak-doubles-damage). Tracking text mismatch, Q-A1. |
| anticipate, blur, shadowmeld, burst, shadow_step, pounce, wraith_form | New temporary/next-turn PowerIds (Dexterity this turn; Block kept one turn; double Block gain; next Skill twice; next-turn double Attacks; next Skill costs 0; lose Dexterity each turn). Wraith Form also needs Dexterity going negative (Block floor 0; raw power list has a negative Dexterity debuff). |
| pinpoint, memento_mori, murder, flechettes, escape_plan, expertise | New Counters/conditions (types.ts): Skills played this turn for `costLessPer` (currently only attacksPlayedThisTurn is allowed), cards discarded this turn, cards drawn this combat (exists in CombatCounters but not in `Counter`), Skills in hand, "drew a Skill" condition, `drawUntil` hand size N (only handFull/stopOn today). |
| echoing_slash | ALL enemies + "repeat per enemy killed" (needs #5) |
| nightmare | "choose a card, next turn add 3 copies": a script that remembers the choice (no types.ts change if done as a script) |
| the_hunt | "If Fatal, gain an additional card reward": a reward-only effect like gainGold/gainPotion (types.ts), or leave the reward out (Q-A7). Attack + `fatal` condition exist. |

Totals by blocker: DATA-only about 21, Sly 7 (+2 dynamic), Shivs 6 + 5 more with powers/Knife Trap, Poison 8, small power/counter cards 19, multi-enemy dependent 5 (Echoing Slash, Fan of Knives, Mirage, Piercing Wail ALL, Bouncing Flask/Serpent Form random target), left out 3 (Sneaky, Flanking, Blade of Ink).

### A.3 Proposed cards for #255 (in suggested order)

| # | Card title | Unlocks | Size | types.ts |
|---|---|---|---|---|
| A1 | Ring of the Snake relic + Silent selectable | relic json, docs/relics-v1.md, UI note; selecting the Silent works once A2 flips Survivor | S | no |
| A2 | Silent draw, discard and energy cards | Survivor, Acrobatics, Prepared, Dagger Throw, Backflip, Adrenaline, Calculated Gamble, Predator, Dodge and Roll (+ discard-choice default in strategies) | M | no |
| A3 | Silent damage, Block and debuff cards on today's vocabulary | Skewer (#66), Grand Finale, Strangle, Bullet Time, Footwork, Bubble Bubble, Precise Cut, Expose, Piercing Wail (single enemy), Malaise (script) | M | no (scripts for Expose, Malaise) |
| A4 | Sly keyword | Abrasive, Flick Flack, Haze, Reflex, Ricochet, Tactician, Untouchable; discards by effect play the card free, hook in one place so A2's discards use it; strategies learn to discard Sly cards | M | no (keyword is already declared) |
| A5 | Shiv cards | Blade Dance, Cloak and Dagger, Leading Strike, Hidden Daggers, Storm of Steel, Up My Sleeve | M | no |
| A6 | Poison powers and Poison counters | Accelerant, Envenom, Noxious Fumes, Corrosive Wave, Outbreak, Mirage (+ extra Poison tick rule); needs Q-A1 first | L | yes (PowerIds, Counter for Poison and Poison applications) |
| A7 | Temporary and next-turn Silent powers | Anticipate, Blur, Shadowmeld, Burst, Shadow Step, Pounce, Wraith Form (+ the Dexterity-lost-per-turn rule) | M | yes (PowerIds) |
| A8 | Silent counters and conditions | Pinpoint, Memento Mori, Murder, Flechettes, Escape Plan, Expertise, Finisher | M | yes (Counters, Condition, drawUntil size) |
| A9 | Silent trigger powers | Afterimage, Serpent Form, Speedster, Tools of the Trade, Well-Laid Plans, Tracking | M | yes (PowerIds) |
| A10 | Shiv powers and Knife Trap | Accuracy, Infinite Blades, Phantom Blades, Knife Trap, Fan of Knives (ALL needs #5) | M | yes (PowerIds, playCards "all") |
| A11 | Dynamic Sly | Hand Trick, Master Planner | S | yes (CardInstance flag, PowerId) |
| A12 | Nightmare and The Hunt | Nightmare (script), The Hunt (depends on Q-A7) | S | maybe (reward effect) |
| A13 | Multi-enemy Silent cards | Echoing Slash, Mirage/Piercing Wail/Haze ALL, Bouncing Flask and Serpent Form random target; depends on #5 and #45 | M | no, once #5 lands |
| A14 | Strategy rules for the Silent | #46 Poison-only (rule given by Trent, ready), #12 cheapest set (ready), discard choice, Shiv/Sly play order | M | no |
| A15 | Silent golden combat with Poison | Trent records; fixture in `engine/golden/` | S | no |

Existing cards and how they fit: #46 (Poison-only play rule: Trent's answer is play before attacks when the enemy lives 2+ more turns; Block favours Poison; Artifact stacks count against it) lands in A14 and needs A6 to matter. #66 Skewer is in A3. #12 (cheapest set) is a strategy card unrelated to Silent mechanics, fits A14. #45 (random target in multi-enemy) is a prerequisite for A13. #8 is split: A1 is its v2 share. #25 (Poison on the player) is not needed by any Silent card or by the bosses below, so it can stay out.

### A.4 Questions for Trent (game behaviour unclear, not guessed)

- Q-A1. `data/raw/cards.txt` (labelled v0.107.1) disagrees with `data/cards/silent/`: Outbreak (raw: 3-cost Skill, "Apply 9 Poison to ALL, Poison triggers immediately"; data: 2-cost Power "every 3 times you apply Poison deal 11 damage to ALL"), Tracking (raw "50% more damage", data "double"), Haze (raw 2-cost Apply 4 Poison and 1 Weak; data 3-cost Sly), Expertise (raw "Draw 2, they gain Retain"; data "draw until 6"), Well-Laid Plans (raw "you no longer discard your Hand"; data "Retain up to 1"), Flick Flack (raw 7 damage; data 6), plus rarities of Accelerant, Echoing Slash, Flanking. The wiki Poison page also says Outbreak applies 9 Poison. Which is main release? Recheck these with the `sts2-wiki-import` skill before simulating them.
- Q-A2. Sly: the wiki says "If a card with Sly on it is discarded during your turn (not when ending your turn), it is automatically played" and "for free", and the page is marked "under construction". Open: who picks the target when it needs one; does it go to discard or Exhaust afterwards; is a Sly card discarded by hand-limit overflow, or by the Retain/Ethereal end-of-turn step, played; can an Unplayable Sly card (none today) or a Bound card be played.
- Q-A3. What should strategies discard when a card says "Discard N" (Survivor, Acrobatics, Prepared, Dagger Throw, Hidden Daggers, Calculated Gamble)? Suggested default for approval: Sly cards first, then Strikes, then Defends, then curses/statuses first of all. Same question for Well-Laid Plans (which card to retain).
- Q-A4. Poison: card text says "Poison is triggered 1 additional time" (Accelerant). Wiki: Poison ticks at the start of the enemy's turn, loses HP then reduces by 1. Does each extra trigger also reduce Poison by 1 (so 2 triggers at Poison 5 = 5 + 4 damage)? And does Envenom's "unblocked attack damage" count Thorns/fixed damage or only Attack cards?
- Q-A5. Blade of Ink's "Inky Shivs": what does the Inky enchantment do? Leave unsimulated until known.
- Q-A6. Sneaky and Flanking are flagged multiplayer-only ("another player"). Confirm they stay unsimulated.
- Q-A7. The Hunt's "additional card reward": track it as a reward (like gold/potions in the Rewards column) or ignore?
- Q-A8. Dodge and Roll "Next turn, gain 4 Block": does Dexterity/Frail apply at the time of the later gain? (Block from `schedule` today is treated as non-card Block per combat.ts:1195.)
- Q-A9. Bullet Time: "ALL cards in your Hand are free to play this turn" also covers cards drawn later? It says you cannot draw this turn, so only the current hand. Confirm X-cost cards (Skewer, Malaise) then play with X = energy left (0 energy)?
- Q-A10. Precise Cut: "2 less damage for each other card in your Hand": floor at 0? Finisher with no earlier Attack deals 0?
- Q-A11. Starting HP at Ascension 2+: the wiki says the Silent starts at 56 (`data/import/questions-world.md`); model it in this card or leave for later?

---

## B. #24 Act 2 and Act 3 bosses (plus #26 and #207)

### B.1 What is imported

No Act 2 or Act 3 enemy is imported. `data/enemies/` has 9 files, all Act 1 (byrdonis, cubex_construct, fuzzy_wurm_crawler, mawler, nibbit, seapunk, shrinker_beetle, sludge_spinner, vantom). `data/raw/enemies.txt` lists the zones: Hive = Act 2, Glory = Act 3 (the Zone type already has `hive` and `glory`). `data/raw/encounters.txt` has no Boss rows, so encounter composition comes from the wiki. The wiki Bosses page (no beta markers) lists:

- Act 2 (Hive): The Insatiable, Knowledge Demon, Kaiser Crab (Crusher + Rocket).
- Act 3 (Glory): Queen (+ Torch Head Amalgam), Test Subject, Aeonglass. At Ascension 10 a second, different Act 3 boss follows on floor 49 (not modelled by this sim, single combat).

HP columns in raw are base then Ascension 8 (fixed values, no range; Vantom is the precedent). Move values (base, Ascension 9) are from the intents export and the wiki pages. One shared caution: several of these wiki pages list "Beta Patch" history entries newer than v0.107.1 (Queen V0.108/V0.109, Knowledge Demon V0.108, Test Subject V0.110, Kaiser Crab and Insatiable earlier ones). The numbers below match raw v0.107.1 for HP and moves, but run the `sts2-wiki-import` version check when importing.

### B.2 Per boss

**Kaiser Crab (Act 2): Crusher + Rocket, two enemies.**
- HP: Crusher 209 (A8 219); Rocket 199 (A8 209).
- Both start with Back Attack and Crab Rage. Crusher fixed cycle: Thrash 12 (A9 14), Enlarging Strike 4, Bug Sting 6x2 (7x2) + 2 Weak + 2 Frail, Adapt +2 Strength (3), Guarded Strike 12 (14) + 18 Block. Rocket cycle: Targeting Reticle 3 (4), Precision Beam 18 (20), Charge Up +2 Strength (3), Laser 31 (35), Recharge (does nothing).
- Needs: multi-enemy (#5), Crab Rage (when an ally dies: +6 Strength and 99 Block to the survivor), the "Surrounded"/facing mechanic with Back Attack (+50% final damage from the claw you are not facing; playing a card at a claw turns you toward it; random-target and ALL attacks do not turn you), a no-op move (Recharge: empty effects, check validator).
- Engine can already do: Weak/Frail on the player, gain Strength, gain Block.

**Knowledge Demon (Act 2): single enemy.**
- HP 379 (A8 399). Cycle: Curse of Knowledge, Slap 17 (18), Knowledge Overwhelming 8x3 (9x3), Ponder 11 (13) + heal 30 + 2 Strength (3). Curse of Knowledge is used 3 times, with debuff pairs Disintegration 6 or Mind Rot, Disintegration 7 or Sloth, Disintegration 8 or Waste Away (the player picks one); after the third use the cycle becomes Slap, Knowledge Overwhelming, Ponder. This is expressible with the existing `opener` (3 x [Curse n, Slap, Overwhelming, Ponder]) plus a 3-move cycle.
- Needs: a "player chooses one of two debuffs" move effect and a Strategy choice rule; player debuff powers Disintegration (end of turn, take X damage), Mind Rot (draw X fewer), Sloth (max X cards per turn), Waste Away (X less energy); an enemy `heal` effect (Ponder). The existing Disintegration status card is the in-hand version, not this power.

**The Insatiable (Act 2): single enemy.**
- HP 321 (A8 341). Opens with Liquify Ground (gains 4 Sandpit; shuffles 6 Frantic Escape into the deck, 3 draw pile and 3 discard), then Thrash 8x2 (9x2), Lunging Bite 28 (31), Salivate +2 Strength (3) cycle (exact cycle unclear, Q-B2).
- Needs: Sandpit (player countdown, death at 0), Frantic Escape card (cost 1, "Increase Sandpit by 1", cost rises by 1 each play), strategy rules for playing it, adding cards to draw pile and discard (exists: `addCards` to drawRandom/discard).

**Queen + Torch Head Amalgam (Act 3): two enemies.**
- HP Queen 400 (A8 419); Amalgam 199 (211), has the Minion power (leaves combat without its leader).
- Queen opens Puppet Strings (3 Chains of Binding on the player), You're Mine (99 Frail, 99 Weak, 99 Vulnerable), then repeats Burn Bright for Me (+1 Strength to the Amalgam, +20 Block to herself) while the Amalgam lives. After it dies: Enrage +2 Strength, Off with Your Head 3x5 (4x5), Execution 15 (18), Enrage, repeat. Amalgam cycle: Strong Tackle 26 (32), Tackle 18 (22), Beam 8x3, Weak Tackle 14 (16), Weak Tackle, then loops Beam, Weak Tackle, Weak Tackle.
- Needs: multi-enemy (#5), an ally-targeted effect (Burn Bright), a pattern that switches when an ally dies, Minion, Chains of Binding / Bound (first X cards drawn each turn are Bound; only 1 Bound card playable per turn; a per-card state plus a playability rule). 99 Frail/Weak/Vulnerable already work.

**Test Subject (Act 3): single enemy, three phases.**
- Phase 1 HP 100 (A8 111), Adaptable + Enrage 2 (A9 3: gains Strength whenever the player plays a Skill), alternating Bite 20 (22) and Skull Bash 14 (16) + 1 Vulnerable. Phase 2 HP 200 (212): Painful Stabs (shuffles Wounds into the discard pile each time the player takes unblocked attack damage), Multi-Claw 10x3 (11x3) every turn with +1 hit per use. Phase 3 HP 300 (313): Nemesis (Intangible 1 at the end of every other turn, starts with Intangible 1), cycle Lacerate 10x3 (11x3), Big Pounce 45, Burning Growl (3 Burn, +2 Strength; A9 5 Burn, +3). Raw lists the phases as three entries (Phase 2, Phase 3).
- Needs: a revive/phase mechanism (HP reset, powers and statuses cleared, can't be targeted until revived), Enrage (enemy power reacting to Skill plays), Painful Stabs, enemy Intangible and Nemesis, growing hit count, per-phase patterns. Burn and Wound shuffles already work.

**Aeonglass (Act 3): single enemy.**
- HP 512 (A8 535). Starts with Withering Presence and Artifact 3. Cycle: Ebb 22 (26) + 33 Block, Eye Lasers 11x2 (12x2), Increasing Intensity (shuffles 1 Wither+X, A9 2, gains 2+X Strength, A9 3+X, upgrades all Withers; X = times used).
- Needs: Withering Presence (every 6 cards the player plays, a Wither into hand), growing move counters (X), upgrading statuses in all piles, Wither upgrade levels above +1. Wither (simulated) and Artifact (simulated) exist.
- **Beta warning:** the wiki page for Aeonglass carries a Beta Content Warning ("some or all of its content is only in the Beta Branch", main V0.107.1, beta V0.111.0). Raw v0.107.1 includes it, but per the import rule this needs Trent's call (Q-B1).

### B.3 Proposed cards for #24 (#26 and #207 folded in)

| # | Card title | Unlocks | Size | types.ts | Depends on |
|---|---|---|---|---|---|
| B1 | Act 2 and Act 3 pickers, zones and boss data conventions | enables Hive/Glory pickers once any boss exists; enemy notes; golden fixture harness for multi-phase | S | no | first boss card |
| B2 | Boss player debuffs: Disintegration, Mind Rot, Sloth, Waste Away (#26, #207) | PowerIds + hooks (end-of-turn damage, draw less, card cap, energy less) | M | yes | none |
| B3 | Knowledge Demon | enemy `heal`, "player chooses a debuff" effect and strategy choice rule, opener/cycle data | M | yes | B2, Q-B3 |
| B4 | The Insatiable, Sandpit and Frantic Escape (#207) | Sandpit countdown and loss, Frantic Escape card, strategy play rule | M | yes | Q-B2 |
| B5 | Aeonglass | Withering Presence, Wither+X, scaling move | M | yes | Q-B1, Q-B5 |
| B6 | Multi-phase enemies and Test Subject | revive, Enrage, Painful Stabs, Nemesis, enemy Intangible, growing Multi-Claw | L | yes | Q-B6 |
| B7 | Kaiser Crab (Crusher + Rocket) | two-enemy fight, Crab Rage, Back Attack and facing | L | yes | #5, #45, Q-B7 |
| B8 | Queen and Torch Head Amalgam, Chains of Binding and Bound | ally effects, pattern switch on ally death, Minion, Bound cards | L | yes | #5, Q-B8 |

No boss is data-only. Easiest first: B2 then B3, B4, B5. B7 and B8 wait for #5. If Trent wants fewer than all seven bosses in the first pass, B6 is the largest.

### B.4 Questions for Trent (game behaviour unclear, not guessed)

- Q-B1. Aeonglass: its wiki page has a Beta Content Warning although raw v0.107.1 lists it. Import it, or skip until it is confirmed in main?
- Q-B2. The Insatiable cycle: the wiki lists "Thrash, Lunging Bite, Salivate, Thrash, then back to the first Thrash". Is it a 4-move cycle (Thrash, Lunging Bite, Salivate, Thrash) after the Liquify Ground opener? Sandpit: when does the countdown tick (end of the player's turn or the enemy's), does 0 mean death at that moment, and what does Frantic Escape's "Increase Sandpit by 1" do to the number (add a turn)? Does Frantic Escape's cost grow by 1 for the rest of the combat and does it Exhaust? How many Frantic Escapes should a strategy play (rule needed)?
- Q-B3. Knowledge Demon's Curse of Knowledge: which option should a strategy pick? Suggestion for approval: choose by a simple fixed rule per strategy (e.g. always the non-Disintegration option, or the one that costs the least expected HP). Also: is Disintegration the power ("take X damage at the end of your turn", blockable?) rather than the existing status card? Is it removed or does it stack with Disintegration from earlier uses? Does Ponder's heal cap at max HP, and does Poison on the Demon matter for it?
- Q-B4. Kaiser Crab "Back Attack": does the sim need facing at all? Suggested simplification for approval: assume the player always faces the claw it plays cards at, with the other claw hitting for +50% (and who counts as "behind" when both attack in one enemy turn). Rule needed from Trent.
- Q-B5. Aeonglass: what do Wither+2, +3 do (damage per upgrade level)? Wiki shows only "(3;6)" for Wither and "Withers+X". Does Withering Presence count every card played (including Shivs, Skills, Powers, free plays), and is the counter reset per combat only?
- Q-B6. Test Subject: (a) when it reaches 0 HP mid-turn, does it revive right away or at its turn start (cards played after that do nothing)? (b) Do Poison, Vulnerable, Weak and Block clear on revive (the wiki says "each phase loses all status effects", and the changelog mentions Block on revive)? (c) Starting Painful Stabs amount and how many Wounds? (d) Nemesis: "end of every other turn" means Intangible after turns 2, 4, ... of phase 3 (or counting from the phase start), and how long it lasts (Intangible 1 = until the next enemy turn?) (e) Do the player's debuffs carry between phases? (f) Is the combat "won" only after Phase 3 dies?
- Q-B7. Kaiser Crab: when one claw dies, the survivor gains +6 Strength and 99 Block, in addition to Rocket's Recharge pattern (unchanged)? Is a win when both claws are dead? What does a targeted-attack strategy do (kill Rocket first or Crusher first)? Targeting priority options from #5 apply.
- Q-B8. Queen: after the Amalgam dies while Queen is on Burn Bright for Me, does she switch to Enrage immediately (the wiki says so)? Is the combat won when only Queen dies (Amalgam is Minion), and what if Queen is killed first? Does Chains of Binding stay when the Queen is already dead (irrelevant if combat ends)? How many cards does 3 Chains of Binding bind each turn (wiki: "first X cards drawn each turn", X not stated for intensity 3 here), and do the Bound cards keep Bound through discard/draw?
- Q-B9. Mind Rot, Sloth, Waste Away appear as 3 debuff "cards" in Curse of Knowledge: the data files `data/cards/status/{mind_rot,sloth,waste_away,frantic_escape}.json` exist but are `simulated:false`. Should those stay as status cards (in the deck builder) or become power-only?

---

## C. Order of work (suggested)

1. A1, A2, A3, A4, A5 (no types.ts change): the Silent becomes playable with its first ~40 cards. Ask Q-A1 and Q-A3 before A2/A4.
2. #5 multi-enemy lands; then A13, B7, B8.
3. types.ts batch for the Silent powers and counters (A6 to A12 together, one approval) and for the boss debuffs (B2). Ask Trent once for both.
4. B3, B4, B5, B6.
5. A14/A15 and the golden combats after each.
