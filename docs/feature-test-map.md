# Feature-to-test map

One row per `FEATURES.md` item (or sub-rule). "Test" is `file > describe > test name`. Break-it column:
**caught** = a small wrong change to the code made the mapped file fail (change in brackets);
**strengthened** = not caught at first, test added/strengthened, then caught; n/a = UI/data row; **BLOCKED** = code disagrees with FEATURES.md (see the end).
Round 1, test reviewer. Break edits were never committed.

## Simulation correctness

| # | Rule | Test file > test name | Break-it |
|---|------|-----------------------|----------|
| 1a | Same config + seed gives the same log | engine/combat.test.ts > runCombat setup > is deterministic: same config + seed → identical log and result | caught (log depends on Date.now) |
| 1b | Seeded Rng is a pure sequence; no `Math.random()` in `engine/` | engine/rng.test.ts > createRng > produces the same sequence for the same seed; engine randomness > no engine source file calls Math.random | caught (Math.random mixed into next) |
| 1c | Each combat index gets its own derived seed | engine/rng.test.ts > deriveSeed > differs across combat indices | caught (index ignored) |
| 2a | Vulnerable x1.5 | engine/combat.test.ts > rule helpers > attackDamage: Strength, Weak, Vulnerable, floor once, min 0 | caught (x1.25) |
| 2b | Damage floored once | same test | caught (round instead of floor) |
| 2c | (base + Strength) per hit | same test; computeIntent: multi-hit with Strength and player Vulnerable | caught (Strength dropped) |
| 2d | Block absorbs hits in order | engine/combat.turnOrder.test.ts > damage rules in combat > Block absorbs the hits of one attack in order, running out part-way through (added) | strengthened (Block went negative after hit 2) |
| 3a | Enemy debuffs tick at end of enemy turn | engine/combat.turnOrder.test.ts > Vulnerable: Bash then Strike = 8 + 9; Vulnerable 2 lasts two player turns | caught (enemy tick removed) |
| 3b | Player debuffs tick at end of player turn | engine/combat.turnOrder.test.ts > Weak on the player cuts its attacks by 25% for that whole player turn, then ticks off at its end | caught (player tick removed) |
| 3c | Poison -1 after it fires | engine/combat.poison.test.ts > Poison > ticks at the start of the enemy turn after block reset, before the move; then decreases by 1 | caught (no decrement) |
| 3d | Poison ignores modifiers (Vulnerable) | engine/combat.poison.test.ts > is HP loss: ignores enemy Block and is not changed by Strength, Weak or Vulnerable | caught (Poison x1.5 under Vulnerable). Enemy Block resets before Poison, so Block cannot be broken separately |
| 3e | Poison kill wins before the move | engine/combat.poison.test.ts > a Poison kill ends combat as a win before the enemy moves | caught (check removed) |
| 3f | Enemy Block resets at start of enemy turn | engine/combat.turnOrder.test.ts > enemy block protects it during the next player turn only | caught |
| 3g | Player Block resets at start of player turn | engine/combat.turnOrder.test.ts > player block resets at the start of each player turn; one full round logs its phases in the documented order | caught |
| 3h | Howl from Beyond plays itself from Exhaust at end of player turn | engine/combat.playCards.test.ts > #114 Howl from Beyond (turnEndInExhaust) > is played for free at the end of the turn it is in the Exhaust pile, once, and goes to the discard pile | caught (trigger skipped) |
| 3i | Same, can win the combat | same file > can win the combat at the end of the turn | caught |
| 4a | Heals count in full past damage / Max HP (overheal) | engine/combat.statuses.test.ts > #115 heal and hpLost > #205 Not Yet heals in full for HP lost, past the damage taken; a heal at full HP still counts in full | caught (overheal dropped) |
| 4b | hpLost = start - final - overheal; Trent's examples (-3, -6) | engine/combat.relics.test.ts > #205 HP lost with heals and startHp > Trent's example 70/80 ... → −3; a fight with no damage and Burning Blood is −6 | caught (overheal ignored) |
| 4c | startHp starts a combat lower | engine/combat.relics.test.ts > startHp sets the HP the combat starts at; HP lost is counted from it | covered by 4b break (same formula) |
| 4d | Feed's Max HP gain raises current HP (Feed at full HP -> -3) | engine/combat.statuses.test.ts > #115 Max HP > #205 HP lost can go below 0 after Feed at full HP (80/80 → 83/83 = −3) | caught (current HP not raised) |
| 4e | Brightest Flame cap counts as lost (69/70 -> 68/68) | engine/combat.statuses.test.ts > Brightest Flame caps current HP and the HP removed counts as lost | caught (cap removed) |
| 4f | Burning Blood heals only on a win | engine/combat.relics.test.ts > Burning Blood does not heal on a loss | caught (also heals on loss) |
| 4g | Self-damage counts / is HP loss; dying from it is a loss | engine/combat.mechanics.test.ts > #106 lose HP > HP lost from your own cards counts toward hpLost; a self-damage card that drops you to 0 HP ends the combat as a loss | caught (loseHp not recorded: counters test) |
| 4h | Turn cap 100 | engine/combat.test.ts > end conditions > turn cap: passive player vs. non-attacking enemy | caught (cap 101) |
| 4i | `minHpLost` offsets the histogram | engine/combat.relics.test.ts > Monte Carlo hpLostCounts start at minHpLost when HP lost goes negative | not run (UI/stat; see summary) |
| 5a | Ascension overrides cumulative, none above the level | engine/enemy.test.ts > resolveEnemy (Nibbit) > A8 changes HP and Hesitant Slice block only; A9 applies A8 HP plus the A9 move overrides; A7 does not apply A8 | caught (`<` instead of `<=`) |
| 5b | Ascender's Bane added at A5+ | engine/combat.piles.test.ts > cards and piles > Ascender's Bane is added only at A5+ and exhausts from hand at end of turn | caught (level < ascension) |
| 6a | Innate on top; turn 1 still draws 5 | engine/combat.keywords.test.ts > Innate > Innate cards are always in the opening hand, drawn first; turn 1 draws the normal 5 even with more Innate cards | caught (innate placed at bottom) |
| 6b | Hand limit 10 | engine/combat.mechanics.test.ts > #107 draw > drawing into a full hand discards the drawn card | caught (limit 11) |
| 6c | Scrawl / Pillage stop at 10 | engine/combat.mechanics.test.ts > Scrawl draws until the hand is full (10) and never discards for the hand limit; Pillage stops at a full hand instead of drawing into it | caught (limit check removed) |
| 6d | Battle Trance blocks further draws that turn | engine/combat.mechanics.test.ts > Battle Trance: draws, then blocks every later draw this turn; the next turn draws normally | caught |
| 6e | Retain keeps cards | engine/combat.keywords.test.ts > Retain > Retain cards stay in hand at end of turn; the rest is discarded; next turn still draws drawPerTurn | caught |
| 7a | Powers leave the deck when played | engine/combat.powers.test.ts > #109 played Power cards > leave the deck for the rest of combat: not discarded, not exhausted, never drawn again | caught |
| 7b | Turn-start hooks fire in order first played | engine/combat.powers.test.ts > #109 start-of-turn powers > turn-start powers run in the order they were first gained; turn-start powers act after the draw | caught (order reversed) |
| 7c | Rolling Boulder instances grow independently | engine/combat.powers.test.ts > Rolling Boulder: two copies are separate instances that each grow +5 a turn (#135); a copy played later starts at 5 while the older one keeps growing | caught (shared instance / no growth) |
| 7d | Crimson Mantle: each copy adds Block and HP loss | engine/combat.powers.test.ts > Crimson Mantle: two copies each add their Block and their 1 HP loss (#135) | caught (HP loss, and Block, each broken separately) |
| 7e | No copy limit on those two (#135) | data/data.validate.test.ts > does not limit Rolling Boulder or Crimson Mantle copies (#135); app/lib/url.test.ts > allows many copies of Rolling Boulder and Crimson Mantle (#135) | data row (n/a) |
| 8a | Plating: Block at end of turn, drops 1 per turn | engine/combat.powers.test.ts > #109 Plating > end of turn: gain Block equal to Plating; start of turn: Plating drops by 1 (4 + 3 + 2 + 1), then ends | caught |
| 8b | Vigor: every hit of the next Attack, then used up | engine/combat.powers.test.ts > #109 Vigor (Prep Time) > adds to EVERY hit of the next Attack: Twin Strike 5+4 twice; that Attack uses it all up | caught |
| 8c | Thorns: every enemy hit, blocked ones included | engine/combat.powers.test.ts > #109 Thorns (Caltrops) > deals 3 damage back after every enemy hit, blocked or not | caught (only unblocked hits) |
| 8d | Fasten only on "Defend" cards | engine/combat.powers.test.ts > Fasten: +4 Block on cards named "Defend" (Defend, Ultimate Defend), not on other Block cards | caught |
| 8e | Fasten added before Frail, rounded once | engine/combat.powers.test.ts > #135 Fasten and Frail > Fasten is added before Frail x0.75, rounded down once floor((5 + 4) x 0.75) = 6 | caught (Fasten dropped) |
| 8f | Thrash exhausts a random Attack, adds per-hit damage, stacks | engine/combat.exhaust.test.ts > #108 Thrash > hits first, then exhausts a random Attack in hand and adds its PER-HIT damage to this copy; the bonus is permanent and stacks | break below (batch S) |
| 8g | Tear Asunder: any HP drop counts, fully blocked hits don't | engine/combat.mechanics.test.ts > #106 lose HP > counters: every HP drop from any source counts; fully blocked hits do not | caught (0-loss counted). Card itself unsimulated: **BLOCKED** (B2) |
| 8h | Corruption: Skills cost 0 and exhaust; X-cost unchanged; Drum still gains energy | engine/combat.powers.test.ts > #109 Corruption > Skills cost 0 in every pile; Attacks and Powers keep their cost; Drum of Battle played under Corruption costs 0, is exhausted and gains its 2 energy (Trent, Q4) | caught (Attacks exhausted instead) |
| 8i | X-cost (`xTimes`/`xBonus`) | engine/combat.energy.test.ts > X-cost (#23) > attackHits: hits × (X + xBonus), non-X attacks unchanged; upgraded "X+1" adds 1 to X | caught (xBonus dropped) |
| 8j | Energy doesn't carry over | engine/combat.energy.test.ts > energy gain (#22) > no carry-over: energy refills to energyPerTurn next turn | caught |
| 8k | Omnislice = 8/11 vs a single enemy | engine/combat.cards.test.ts > Omnislice with a single enemy (FEATURES 8) > deals 8 once (11 upgraded): no second target, no extra damage (added) | caught (data 8->9, 11->12) |
| 9a | Shrink -30% after all modifiers, floored once | engine/combat.shrink.test.ts > attackDamage with Shrink > multiplies by (100 − percent)% after Strength, Weak and Vulnerable, then floors once; Shrink in combat > is applied after Vulnerable | caught (+1) |
| 9b | Shrink doesn't stack | engine/combat.shrink.test.ts > Shrink in combat > does not stack: a second Shrink keeps the larger percent | caught (stacked) |
| 9c | Sludge Spinner: opener, then random without repeats | engine/combat.patterns.test.ts > random pattern > noRepeat never plays the same move twice in a row, and uses every move; the last opener move counts as the previous move for noRepeat; data/data.test.ts > Sludge Spinner opens with Oil Spray, then picks at random without repeats | caught (repeat allowed) |
| 9d | Stunned enemy skips move, no damage | engine/combat.statuses.test.ts > #115 Whistle's Stun > the stunned enemy skips its move (no damage) and its pattern still advances | caught (stun ignored) |
| 9e | Stun: pattern still advances | same test | caught (early return, no advance) |
| 9f | Enemy Strength from cards (Fight Me) like player Strength | engine/combat.temporary.test.ts > #169 enemy Strength (Fight Me!) > the enemy gains Strength and its attacks grow by it; the player Strength is separate | batch S |
| 9g | Slippery: loses only 1, one stack per hit | engine/combat.slippery.test.ts > Slippery > an attack hit loses only 1 HP and uses one stack; a multi-hit attack uses one stack per hit | caught (loss min(amount,2)) |
| 9h | Slippery: fully blocked hit uses none | engine/combat.slippery.test.ts > a fully blocked hit loses no HP and keeps the stack; a partly blocked one uses it | caught |
| 9i | Slippery: Poison counts | engine/combat.slippery.test.ts > Poison counts as an HP loss: 1 HP and one stack per tick | caught |
| 9j | Slippery: most-hits attack first | engine/combat.slippery.test.ts > Slippery strategy > plays the multi-hit attack before a big single hit while Slippery is up | batch S |
| 9k | Once-per-fight moves (#226) never repeat; picker always has a move | engine/combat.patterns.test.ts > oncePerFight moves (#226) > is used at most once over a long fight across many seeds, and the picker never stalls; with a two-move pool... | caught (filter removed). Validator part: data/data.validate.test.ts > accepts opener and random no-repeat patterns, and reports broken ones (#4) |
| 9l | startPowers at combat start, Ascension override replaces | engine/combat.enemies203.test.ts > Enemy start powers and Strength per turn (#203) > start powers are on the enemy at combat start...; an Ascension startPowers override replaces the base value from its level | batch S |
| 9m | Artifact: one stack per application, negates Vulnerable/Weak/Frail/Poison/Stun | engine/combat.enemies203.test.ts > Artifact (#203) > uses one stack per debuff; negates Poison and Stun too; a large Poison application uses exactly one stack; negates the first debuff only (Cubex golden) | caught (whole stack used; Poison not negated; debuffs not negated) |
| 9n | Strength per turn at end of enemy's own turn (0,1,2) | engine/combat.enemies203.test.ts > strengthPerTurn adds Strength at the END of the enemy turn, after its move (0, 1, 2 seen) | caught (+1 extra) |
| 9o | Enemy move may add a named card to a pile (Dismember: 3 Wounds) | engine/combat.enemies203.test.ts > Vantom: boss ... Dismember 26 adds 3 Wounds to discard | batch S |
| 10a | "Take X damage" statuses are blockable | engine/combat.statuses.test.ts > #115 curse and status triggers > "take X damage" is blockable | caught |
| 10b | "Lose X HP" ignores Block | engine/combat.statuses.test.ts > "lose X HP" ignores Block | caught |
| 10c | Intangible: every hit 1, ends after enemy move | engine/combat.statuses.test.ts > #115 Intangible > every enemy hit becomes 1 for that turn, then ends after the enemy move | caught (cap 2) |
| 10d | Intangible applies to Take-X-damage statuses, not Lose-X-HP | engine/combat.statuses.test.ts > applies to "take X damage" statuses but not to "lose X HP" | caught |
| 10e | Gambit loses on any unblocked attack damage | engine/combat.statuses.test.ts > #115 The Gambit > one unblocked point of enemy attack damage loses the combat; a single unblocked point ... (added) | strengthened (threshold >1 not caught first) |
| 10f | "Poison included (Accelerant = 1 twice)" under Intangible | no test possible: **BLOCKED** (B1) | - |
| 11a | Feed Max HP / Hand of Greed gold only on a kill | engine/combat.rewards.test.ts > Hand of Greed gains no gold when it does not kill; engine/combat.statuses.test.ts > Feed does not raise Max HP when the hit does not kill | caught (else branch swapped) |
| 11b | Alchemize gains a Random Potion when played | engine/combat.rewards.test.ts > Alchemize gains one potion each play, exhausts, and has no other effect | caught (2 potions) |
| 12a | Mangle / Dark Shackles Strength loss lasts through enemy's turn | engine/combat.temporary.test.ts > #110 enemy Strength loss this turn > a 3×3 attack with 3 Strength lost hits 0×3 and the Strength comes back after its turn | caught (loss never removed / not applied in intent) |
| 12b | Flame Barrier covers the following enemy turn | engine/combat.temporary.test.ts > #110 Flame Barrier > deals its damage back on every hit...; ends after that enemy turn | caught |
| 12c | Colossus x Weak = 62.5% less | engine/combat.temporary.test.ts > #110 Colossus > multiplies with Weak: 16 damage becomes 6 (62.5% less) | caught (40% instead of 50%) |
| 12d | Colossus stacks when replayed, ticks at end of enemy turn | engine/combat.temporary.test.ts > covers the following enemy turn only: one stack ends after it; playing it again in the same turn adds a stack that lasts one more enemy turn | caught |
| 12e | Panic Button stops Block from cards | engine/combat.temporary.test.ts > #110 Panic Button > gains 30 Block, then no Block from cards for 2 turns | caught |
| 12f | The Bomb fires at end of third turn | engine/combat.temporary.test.ts > #110 scheduled effects > The Bomb: 40 damage at the end of the third turn (the turn it is played counts as the first) | caught (scheduled turn off by one) |
| 13a | "Strike" = any name with Strike, upgraded included | engine/combat.conditional.test.ts > #111 name and debuff rules > "Strike" anywhere in the name counts, case-sensitive, upgraded "+" included | caught (startsWith) |
| 13b | Strike count across Draw, Hand, Discard, Exhaust | engine/combat.conditional.test.ts > countStrikes counts all four piles; #111 Perfected Strike > Strikes created mid-combat count | caught (Exhaust pile dropped) |
| 13c | Rampage growth stays with its copy | engine/combat.conditional.test.ts > #111 Rampage and Maul > Rampage +5 each play, and the growth stays with that copy across reshuffles | batch S |
| 13d | Fisticuffs Block = damage dealt after all modifiers, overkill included, then Dex/Frail | engine/combat.conditional.test.ts > #111 Fisticuffs (5 tests) | batch S |
| 13e | Rend counts every modelled debuff | engine/combat.conditional.test.ts > uniqueDebuffs counts Vulnerable, Weak, Frail, Poison, negative Strength and temporary Strength loss once each; Rend upgraded: 18 + 8 per unique debuff; Frail counts too | caught (Frail dropped; negative Strength dropped) |
| 13f | Entrench doubles Block, ignores Dex/Frail, works under Panic Button | engine/combat.conditional.test.ts > Entrench doubles your Block; Dexterity and Frail do not change the doubling; engine/combat.temporary.test.ts > Entrench still doubles current Block under No Block (#170) | batch S |
| 14a | Replay never used up | engine/combat.playCards.test.ts > #114 Replay (Hidden Gem) > is never used up: every later play of the card replays twice | caught (decrement added) |
| 14b | Replays stop when the enemy dies | engine/combat.playCards.test.ts > stops replaying once the enemy is dead | caught (kill check removed) |
| 14c | Replays pay the cost once; X-cost played by an effect gets X = energy left | engine/combat.playCards.test.ts > gives a random draw-pile card Replay 2: the card is played 2 more times, paying its cost once; Havoc ... an X-cost card it plays gets X = the energy left, and spends none | batch S |
| 14d | Cards played counted in one place (`playCard`) | engine/combat.triggers.test.ts > #113 cards-played tallies > a Replay is the same play, not a second one; cards played by an effect or a power count too | caught (replay counted twice) |
| 15a | Pools: only `simulated` cards | engine/combat.generate.test.ts > card pools > draw only from simulated, playable cards of the right character, rarity and type; a newly simulated card joins the pool by itself | caught |
| 15b | Pools: own character, no Colorless | same first test | caught (colorless allowed) |
| 15c | Jackpot+ includes cards 0-cost when upgraded | engine/combat.generate.test.ts > an upgraded cost pool also takes cards that become that cost when upgraded; the base pool does not (#170) | caught |
| 15d | Full hand sends new cards to discard; Rng seeded | engine/combat.generate.test.ts > addCards (random) > a full hand sends the new card to the discard pile; same seed gives the same cards | batch S |
| 16a | Dark Embrace draws at end-of-turn Ethereal exhaust stay in hand | engine/combat.triggers.test.ts > Dark Embrace: a card drawn by an Ethereal exhaust at the end of the turn stays in the hand (strengthened: checks the turn-2 hand) | strengthened (not caught first: only checked the log) |
| 16b | Inferno loses 1 HP per copy | engine/combat.triggers.test.ts > Inferno: each copy played loses 1 HP at the start of a turn (added) | strengthened (copies ignored) |
| 16c | Juggernaut reacts to any Block gain | engine/combat.triggers.test.ts > Juggernaut deals its damage for every Block gain: cards, powers and Feel No Pain | caught (threshold >3) |
| 17 | Void: loses 1 Energy on draw, never below 0; Ethereal+Unplayable | engine/combat.void.test.ts > #206 Void > loses 1 Energy when drawn at the start of the turn (after the refill); never takes energy below 0; is Ethereal: an unplayed Void is exhausted at the end of the turn | caught (clamp removed) |
| 18 | Card coverage: all main-release Ironclad/Colorless cards simulated except Splash, Sovereign Blade, multiplayer-only | none can pass: **BLOCKED** (B2) | - |
| 17a-1 | Ornamental Fan: every 3rd Attack per turn | engine/combat.relics.test.ts > #205 card-play relics > Ornamental Fan 4 Block on every 3rd Attack in one turn | caught (4th) |
| 17a-2 | Happy Flower / Pollinous Core turns; setup start count | engine/combat.relics.test.ts > Happy Flower +1 energy on turns 3, 6…; carried counters start at the setup count | caught |
| 17a-3 | Iron Club every 4th card per combat, starting count | engine/combat.relics.test.ts > Iron Club with 3 cards already counted draws on the first card played; draws 1 on every 4th card | caught (start count ignored) |
| 17a-4 | Tungsten Rod takes 1 off every HP loss | engine/combat.relics.test.ts > Tungsten Rod: every HP loss is 1 less | caught |
| 17a-5 | Beating Remnant caps 20 HP per turn (enemy turn separate) | engine/combat.relics.test.ts > Beating Remnant: at most 20 HP lost in one turn; two hits in one enemy turn share the 20 HP cap (added) | strengthened (per-hit cap not caught first) |
| 17a-6 | The Boot raises 1-4 to 5 | engine/combat.relics.test.ts > The Boot: 1–4 unblocked attack damage becomes 5; the edges of the range (added) | strengthened (4 not tested) |
| 17a-7 | Snecko Eye: +2 draw, random 0-3 costs | engine/combat.relics.test.ts > Bag of Preparation draws 2 more on turn 1; Snecko Eye draws 2 more every turn; Snecko Eye (Confused) drawn cards cost a random 0–3, the same for the same seed | caught (draw bonus dropped; fixed cost) |
| 17a-8 | Ghost Seed: only basic Strike/Defend | engine/combat.relics.test.ts > Runic Pyramid keeps the hand; Ghost Seed exhausts only basic Strikes and Defends left in hand | caught |
| 17a-9 | Belt Buckle +2 Dex only without potions | engine/combat.relics.test.ts > Oddly Smooth Stone +1 Dexterity; Belt Buckle +2 Dexterity with no potions | caught |
| 17a-10 | Sling of Courage only vs Elite | engine/combat.relics.test.ts > Sling of Courage 2 Strength only against an Elite | caught |
| 17a-11 | Velvet Choker: no 7th card | engine/combat.relics.test.ts > Velvet Choker no more than 6 cards a turn | caught |
| 17a-12 | Combat start / turn start / turn end hooks and ordering; Anchor, Gorget, Bellows | engine/combat.relics.test.ts > #205 start-of-combat relics; #205 turn relics (Anchor ... Bellows upgrades the first hand only; Stone Calendar, Orichalcum) | caught (Bellows every turn; turnEnd hook removed; draw bonus) |
| 17a-13 | Relic Block ignores Dex/Frail; Girya choice; Burning Blood default in URL | engine/combat.relics.test.ts > Vajra +1, Sword of Jade +3 and Girya (choice) Strength; app/lib/relics.test.ts > #205 relic setup > the Ironclad starts with Burning Blood...; the URL keeps relics only when they differ from the starting relic | batch S |

