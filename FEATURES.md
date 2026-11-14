# Key features (test checklist)

The behaviours that matter most, agreed with Trent. The quality-review loop checks each item
has a test; new rules agreed on a card are added here. Details live in the linked cards.

## Simulation correctness

1. **Determinism:** same config + seed gives an identical event log; no `Math.random()` in `engine/`.
2. **Damage:** per hit = floor((base + Strength) × modifiers); Vulnerable ×1.5; Block absorbs hits in order.
   Vulnerable multiplies only attack damage from the player or its pets (Osty, v2). Fixed damage (The Bomb,
   Rolling Boulder, Juggernaut) ignores it. (Trent, #245)
3. **Turn order** exactly as in CLAUDE.md, including: player debuffs tick at the end of the player's
   turn, enemy debuffs at the end of the enemy's turn; Poison at enemy turn start (ignores Block,
   a kill wins before the move, then −1); Howl from Beyond plays itself from the Exhaust pile at
   the end of the player's turn, then goes to discard (#114).
4. **HP lost (#115, #205)** = start HP (default Max HP; `startHp` can start a combat lower; without it, A2+ starts lower per character: Ironclad 64/80, Silent 56/70, cumulative per-character `ascension` overrides, Max HP unchanged, #286) − final HP,
   and can be negative: every heal from cards and relics counts in full, past the damage taken and
   past Max HP (Trent: start 70/80, Blood Vial 2, lose 5, Burning Blood 6 → −3; no damage + Burning
   Blood → −6; Not Yet 10 at full HP → −10). HP itself stops at Max HP. It includes self-damage
   (Hemokinesis etc.); dying from self-damage is a loss. Feed's Max HP gain also raises current HP, so
   it lowers it (Feed at full HP → −3). HP removed by Brightest Flame's cap (69/70 → 68/68) counts as
   lost. Turn cap 100. Burning Blood heals only on a win.
5. **Ascension:** overrides are cumulative; Ascender's Bane added (and locked in the deck builder) at A5+.
6. **Draw rules:** Innate cards go on top of the draw pile (turn 1 still draws 5); hand limit 10;
   Scrawl and Pillage stop at 10; Battle Trance blocks all further draws that turn; Retain keeps cards.
7. **Powers:** leave the deck when played; turn-start/turn-end hooks fire in order (after the draw, in
   the order first played). Rolling Boulder: each play is its own instance that grows independently.
   Crimson Mantle: each copy adds its Block and its HP loss. Neither has a copy limit (#135).
8. **Card mechanics as agreed:** Plating (end of turn: gain Block equal to Plating; −1 at the start of each turn; not reduced by hits), Vigor (every hit of the next Attack), Thorns (every enemy
   hit, blocked or 0-damage hits included), Fasten ("Defend" cards; added before Frail's ×0.75, rounded
   down once), Thrash, Tear Asunder (any HP drop; fully blocked hits don't count), Corruption (X-cost
   unchanged; Drum of Battle still gains energy), X-cost (`xTimes`/`xBonus`), energy doesn't carry
   over, single-enemy targeting for random/ALL attacks (Omnislice = 8/11; with several enemies it also deals the damage dealt to every other living enemy, #283), Expect a Fight (#246: gains
   1 Energy per Attack in hand when played; it is a Skill, so it never counts itself; strategies play it
   only when it gains more than its cost. Later version: its "cannot gain additional Energy this turn"
   clause is not modelled, as it does not come up in v1).
9. **Enemies (#4):** Shrink (−30% attack damage) applies after all other modifiers, rounded down once,
   and doesn't stack. Sludge Spinner opens with Oil Spray, then picks at random with no repeats (the
   opener counts as the previous move). A Stunned enemy skips its move and deals no damage; its
   pattern still advances (#148 confirms). Enemy Strength gained from cards (Fight Me) works like
   player Strength (#169). Slippery N (#213, e.g. Inklet 1, Vantom 8): each time the enemy would lose
   HP (an attack hit, Juggernaut / Thorns power damage, Poison, direct HP loss) it loses only 1 and
   uses one stack, so a multi-hit attack uses one per hit; a fully blocked hit (0 HP loss) uses none;
   Strength and Vulnerable don't matter. Poison counts as a loss (literal reading of the text). While
   it is up, the attack with the most hits is played first and big single hits wait.
9c. **Alternate pattern (#287, Inklet):** an `alternate` pattern plays a fixed move and a weighted seeded random
    pick in turn. The first move comes from `openerBySlot` by position (first and last enemy = outer, any other
    = middle; a lone enemy is outer), else `startWith` (default the fixed move); afterwards the move after the
    fixed one is a random pick and the move after a pick is the fixed one. Inklet: outer opens Jab, middle opens
    Whirlwind, then Jab alternates with a 50/50 Piercing Gaze or Whirlwind.
9e. **Spawn log event (#333):** each enemy added mid-fight logs one `spawn` event (enemy id, slot, rolled HP, `stunned`); the log panel shows "Wriggler appears as Enemy 2 (19 HP, Stunned)" and the replay adds the enemy's HP snapshot.
9d. **Summons and pattern extras (#322):** `spawnEnemies` (enemy moves and `EnemyDef.onDeath`) appends `count` enemies
    to the right, HP rolled with the seeded Rng; `stunned` ones skip their first move, and that arrival Stun does not advance the pattern (#329: Wrigglers still open
    Bite, Wriggle, Bite, Wriggle by slot; an ordinary Stun still advances it, #148).
    `onDeath` runs once when the enemy dies, whoever or whatever kills it (attack, Poison, effect); the combat is
    won only when every enemy including spawned ones is dead, and the rest of a card (all-enemy and random-target
    hits) reaches the new enemies. An enemy phase already under way is not extended: enemies spawned in it act from
    the next phase on (a Stunned one skips that one), matching the wiki's "Stunned during the player's next turn" for
    Phrog Parasite killed by Poison (Trent: decision for review). `RandomPattern.weights` (default 1 per move) make
    the pick weighted, `noRepeatMoves` limits the no-repeat rule to those moves (Twig Slime (M): Sticky Shot never
    twice in a row, Chomp may), `startBySlot` picks the first cycle move by the enemy's place among same-id enemies
    (Wriggler: 1st/3rd Nasty Bite, 2nd/4th Wriggle). Patterns without these fields draw the Rng exactly as before.
9b. **Once-per-fight moves (#226):** an enemy move flagged `oncePerFight` (Mawler's Roar) is never picked again
    once made; the no-repeat picker still always has a legal move (a pool with no unused move falls back to the
    whole pool, and a pool of only once-moves is rejected by the validator).
9a. **Artifact, start powers, Strength per turn (#203):** an enemy's `startPowers` apply at combat start
    (an Ascension override replaces them from its level). Artifact negates the next debuff applied to the
    enemy, exactly one stack per application whatever its size (one Poison application of any amount = 1 stack;
    a multi-bounce Poison effect uses one per bounce); Vulnerable, Weak, Frail, Poison, Stun and temporary Strength loss all
    count (golden combat 7: Uppercut's Weak is negated, its Vulnerable lands). Strength per turn
    (Byrdonis) is gained at the end of the enemy's own turn, after its move (Strength 0, 1, 2 on turns
    1, 2, 3). An enemy move may add a named card to a pile (Vantom's Dismember: 3 Wounds to discard).
10. **Statuses, curses and defensive effects (#115):** "Lose X HP" curses/statuses (Bad Luck, Beckon,
    Regret) ignore Block; "Take X damage" ones (Burn, Decay, Disintegration, Infection, Toxic, Wither)
    are blockable. Intangible makes every hit that turn 1.
    (v2 note, #25: Poison on the player does not exist in v1, so "Poison included, Accelerant = 1 twice" is not a v1 test item.)
    The Gambit loses the combat on any unblocked enemy attack damage.
11. **Kill rewards (#104, #115):** Feed's Max HP and Hand of Greed's gold count only when the hit
    kills. Alchemize gains a Random Potion when played.
12. **Temporary effects (#110):** Mangle / Dark Shackles Strength loss lasts through the end of the
    enemy's turn (3×3 → 0×3). Flame Barrier and Colossus cover the following enemy turn. Colossus
    multiplies with Weak (62.5% less together), stacks when replayed, and ticks down at the end of the
    enemy's turn. Panic Button stops Block from cards; The Bomb fires at the end of the third turn.
    Silent (#264): Anticipate's Dexterity ends with the turn; Blur keeps the Block through the next turn
    start only; Shadowmeld doubles Block from cards this turn (with Dexterity and Frail, floored once);
    Burst replays the next 1 (2 upgraded) Skills this turn; Pounce makes the next Skill cost 0; Shadow Step
    discards the hand and doubles Attack damage on the next turn only; Wraith Form loses 1 Dexterity at each
    turn start (Dexterity may go below 0, Block from cards stays at 0 or more); Dodge and Roll's next-turn Block
    gets Dexterity and Frail (Trent).
13. **Conditional and scaling cards (#111, #113):** "Strike" means any card with Strike in its name
    (Strike+ included) in Draw, Hand, Discard and Exhaust, including ones created mid-combat; used by
    Perfected Strike and Hellraiser. Rampage's growth stays with that copy. Fisticuffs' Block = damage
    dealt to Block and HP after all modifiers, overkill included, then Dexterity/Frail. Rend counts
    every modelled debuff. Entrench doubles current Block, ignores Dexterity and Frail, and still
    works under Panic Button's No Block (#170).
14. **Playing other cards (#114):** Replay is never used up unless something says so. Replays pay the
    cost once and stop when the enemy dies. Cards played by an effect that are X-cost get X = energy
    left and spend none. Attacks and cards played are counted in one place (`playCard`).
15. **Random card generation (#116):** pools contain only `simulated: true` cards of the player's own
    character (no Colorless), built from the data so new cards join automatically. Jackpot+ also
    includes cards that become 0-cost when upgraded (Body Slam+). A full hand sends new cards to
    discard. All picks use the seeded Rng.
16. **Trigger powers (#113):** cards drawn by Dark Embrace during the end-of-turn Ethereal exhaust
    stay in hand into the next turn. Inferno loses 1 HP per copy. Juggernaut reacts to any Block gain.
17. **Void (#206):** drawing Void (at turn start after the energy refill, or mid-turn) loses 1 Energy,
    never below 0. It is Unplayable and Ethereal, so an unplayed Void exhausts at end of turn.
18. **Card coverage:** every main-release Ironclad and Colorless card is simulated and matches its
    wiki text, except Splash (#151), Sovereign Blade (waits for Forge, #20), Sweeping Gaze (waits for Osty, #19), the hidden Mad Science placeholder (its
    `mad_science_*` variants are the simulated cards) and the multiplayer-only cards (#117).
18a. **Silent Shiv cards (#262):** Blade Dance (3 Shivs, 4 upgraded, Exhaust), Cloak and Dagger (6 Block, 1 Shiv;
    2 upgraded), Leading Strike (3 damage, 6 upgraded, 2 Shivs), Up My Sleeve (3 Shivs, 4 upgraded; this copy costs
    1 less for the rest of the combat, never below 0, each copy on its own) and Storm of Steel (discard the
    hand, not itself; 1 Shiv per discarded card, Shiv+ upgraded) add Shivs to the hand (a full hand sends them to
    the discard pile). Shivs are 0-cost Attacks (4 damage, 6 upgraded) that Exhaust. Shiv play rule (#284, Trent):
    Shivs are played like attacks (ranked by damage with the other attacks). Shiv-making cards (Blade Dance, Up My
    Sleeve; Leading Strike counts its Shivs too) are compared with the other attacks by energy efficiency
    (damage per energy, counting the Shivs they make: 4 each, 6 upgraded; a tie goes to the maker; Accuracy, #267,
    would add here once simulated). Storm of Steel is played last, after all other energy is spent, and only while
    the hand still holds cards to discard. Hidden Daggers stays unsimulated until the discard choice exists (#259).
    **Blade of Ink (#285):** adds 2 Inky Shivs to the hand (3 upgraded); the Inky enchantment is "This card
    applies 1 Weak" (Trent), so an Inky Shiv is a Shiv (4 damage, Exhaust, 0 cost) that also applies 1 Weak to the
    target. Modelled as the `inky_shiv` token; strategies treat it like a Shiv.
17a. **Relics (#205):** relic data in `data/relics/`, status per relic in `docs/relics-v1.md`. Hooks fire
    in pick order: combat start (before the first draw), turn start (after the draw and start-of-turn
    powers), turn end (before Plating), after a card is played, combat end (wins only). "Start each
    combat with" Block, Energy, Plating or extra draw happens on turn 1 after the Block reset (Anchor 10
    Block on turn 1 only; Gorget's 4 Plating gives 4 Block at the end of turn 1). Relic Block ignores
    Dexterity and Frail. Ornamental Fan counts Attacks per turn (every 3rd); Iron Club counts cards per
    combat (every 4th). Happy Flower / Pollinous Core fire on turns 3, 6… / 4, 8… and Iron Club on
    every 4th card; their counters carry between combats in the game, so Setup sets the starting
    count (default 0, URL `HF2`; Happy Flower 2 → turns 1, 4…). Tungsten Rod takes 1 off every HP loss, then Beating Remnant caps HP lost at 20 per
    turn (the player's turn and the enemy's turn count separately, Trent confirmed). The Boot raises unblocked attack
    damage of 1–4 to 5. Snecko Eye: +2 draw, and each drawn card costs a random 0–3 (seeded Rng).
    Ring of the Snake (Silent starting relic): +2 draw on turn 1 only. Ghost Seed: the basic Strike and Defend (upgraded too) exhaust at end of turn like Ethereal.
    Belt Buckle's +2 Dexterity is off while a potion slot is filled. Sling of Courage: only
    against `elite` enemies. Velvet Choker: no 7th card a turn. Girya's Strength (1–3, default 1) is chosen in Setup.
    The Ironclad has Burning Blood by default; relics are in the URL (`r`).

## Strategy behaviour

18. **Ordered groups:** Attack / Block / Powers in the chosen order; "allow X through" applies only to
    Block. Defaults: Greedy Damage (Attack, Powers, Block), Scared Block (Block 0, Powers, Attack).
19. **Play order:** 0-cost draw first, then Enlightenment (always played, #169); Not Yet (any healing card)
    with the energy left after the groups, at any HP, since every heal counts in full (#205); Apotheosis right away when something can be upgraded and tutors when the draw
    pile has a card to fetch (#112); net-energy cards (Bloodletting) before pure draw; 1+ cost pure
    draw only when the top group can't be filled, then re-plan, and skipped when the turn already
    spends all its energy (X-cost cards and expensive Powers count), except for Block-first strategies
    (#127); Battle Trance after other draw; Tremble first among Attacks; Havoc early; Mad Science
    never played; Alchemize is not played (#171).
20. **Attack choice:** an attack that applies Vulnerable goes first only when the enemy has no
    Vulnerable and there is energy for it plus another attack; otherwise the set of attacks that deals
    the most total damage within the Energy is played, free attacks always in it; ties go to more damage per
    Energy, then fewer cards (#11, #149, #12). The set's biggest attack goes first. X-cost
    attacks are compared at their damage for 1 energy: Strike before Whirlwind, Whirlwind+ before
    Strike; ties go to the other attack (#147). Cascade is played with the X-cost attacks.
    **Block choice (#12):** a Block group that is not last plays the cheapest set of block cards (in Energy,
    then fewest cards, then most Block) that reaches the Block target; the biggest card of the set first.
    When no set reaches it (or Block is last), the biggest block card goes first as before.
21. **Situational cards:** temporary Strength, Rage and One-Two Punch only when an Attack follows;
    Setup Strike always counts as a 7-damage attack; Dark Shackles only when the enemy is attacking;
    Panic Button only as a last resort (#110). Body Slam and Entrench after other block cards, with
    Entrench planned to avoid excess Block (#111). Catastrophe, Beat Down, Hidden Gem, Dual Wield, The
    Bomb, Outmaneuver and Prolong use leftover energy; Dual Wield copies the highest-value card.
    Anticipate, Shadowmeld and Burst are played before Block Skills only when a Block Skill follows;
    Shadow Step is played last (#264).
    "Choose a card" follows the strategy's priorities (#112, #150).
22. **Self-damage:** never play a card that would kill you; otherwise ignore the HP cost.
23. **Fiend Fire:** always if it kills; otherwise only when it beats other uses of the energy; played
    last after spending spare energy; Bash goes before it unless it kills.
24. **Second Wind:** played after the turn's Powers; exhausts only Block cards worth ≤ its per-card Block.
25. **Exhaust order:** the 8-tier order (#108/#139); Howl from Beyond is tier 2 (#170). Brand, Burning
    Pact and Purity follow the regular order; Purity is limited to curses/statuses and non-upgraded
    Strikes/Defends. Draw-only cards (#144): 0-cost ones are never exhausted; 1+ cost ones go right
    after Strikes and Defends once ≥ 80% of the turns so far ended at 0 energy, otherwise never.
26. **Deck-health guard (#141/#147):** after an exhaust, damaging cards ≥ max(2, ceil(active deck / 5))
    and the active deck stays at or above the deck floor, unless the exhaust ends combat. Deck floor =
    5 + the draw of the deck's draw cards: Exhaust cards (Scrawl) add 0; Pillage adds 1 for each
    step where the next card is ≥ 80% likely an attack (4 Strikes + 1 Defend → floor draw 2), capped
    at 10 − hand size; exhaustible draw-only cards add 0. When one more damaging card may go, the
    lower damage-per-energy one goes first (Bash before the last Strike; X-cost counts as 1-cost).

## Results and UI

27. **Monte Carlo:** 10,000 combats per strategy; up to 5 strategies.
28. **Results table:** Avg HP lost (2 decimals), "HP lost, P25-P75", Avg combat turn length, death
    rate; sorted on the unrounded values by HP lost, then death rate, then turns; description line with
    character, enemy, ascension. A **Rewards** column appears only when some strategy gained a
    reward, e.g. "+14.2 gold avg · Random Potion 63%" (#104).
29. **Chart:** smoothing ×0 (Raw) to ×5, default ×3; P5–P95 marks and P25–P75 band for every visible
    strategy; each strategy's marks on one line, crowded labels shift sideways, equal values merge
    ("P25–P50 = 8"); "Show Percentiles" toggle at the far right of the legend row (#78); X range
    [max(0, P5 − 2), P95 + 2]; legend toggles.
30. **Color-blind palette (#13):** a toggle switches every strategy color (chart, legend, results
    table, View a combat) to a color-blind-safe palette with a distinct dash pattern per line.
31. **Combat log and picker:** turn blocks with enemy intent; checkbox picker numbered 1–10000;
    Compare view side by side (stacked on phones). Strategies hidden on the chart stay in View a
    combat and Compare (#122).
32. **Shareable URL:** deck, strategies (`st` codes, old codes still parse), colors and combat index
    restore the same view. Custom strategy names are not in the URL.
33. **Deck builder:** grouped by data folder, collapsed by default; search; Statuses/Curses/Multiplayer
    filters; Standard/Upgraded steppers; wiki links; hidden cards excluded.

## Data and storage

34. **Data files:** every JSON file passes the schema check; card, enemy and character codes are
    unique and permanent, and codes in `data/reserved-codes.json` are never reused; only
    main-release data is imported (no beta).
35. **Enemy basics:** HP is rolled inside the enemy's range from the seeded Rng; move patterns cycle
    in order; an Ascension level applies every override at or below it and none above (A8 has no A9).
36. **Storage and notes:** saved decks and strategies live in localStorage, and the app still works
    when storage is blocked. The UI notes a starting relic only when it is not simulated (Burning
    Blood is, #205); negative HP lost shows as "gained N HP" in the combat log.
37. **Potions (#204):** up to 3 potion slots in the setup (URL `p=` codes, e.g. `SPFP`). The strategy is
    asked before every move; using a potion costs no energy, empties the slot and logs a `potion`
    event. Fire Potion deals a fixed 20 (no Strength or Weak) through enemy Block. All built-in
    strategies share one rule set: Strength Potion at once (turn 1, before any card); Fire Potion
    when HP + Block of the enemy is at most 20 (a kill) or when the enemy has no Block, and only with
    no Slippery; and always when the enemy's coming attack could kill you (intent total at least HP +
    Block), so it is never held while dying. Poison Potion (#303, Silent): Apply 6 Poison; used at
    once, after the Strength Potion and before the Fire Potion. Energy Potion (#211): Gain 2 Energy; drunk
    on the first turn the playable cards in hand cost at least 2 more than the current Energy (X-cost
    cards count 0); after the Poison Potion, before the Fire Potion.
    Slow (#303, Bygone Effigy starts with it): each Attack the player deals to that enemy takes +10% per
    card played earlier this turn (the card itself and potions do not count; every played card counts,
    cards played by other cards included, #314: Sly, Havoc, ..., also for the later hits; Strike 6 -> 7 after 2 cards,
    Strike+ 9 -> 10, 8 after 4). One multiplier with Vulnerable (floored once); resets each player turn;
    Poison and fixed HP loss are unaffected. Built-in kill checks count it. Sleep is a no-effect opener move.
38. **Golden combats (#177, #210):** every fixture in `engine/golden/` replays through the engine
    (start HP, relics, potions at a point in the turn, `playerStart` statuses, scripted choices,
    mid-turn draws); mismatches fail unless listed in `knownDiffs` with a reason, and a listed one
    that no longer occurs fails too. `CombatConfig.playerStart` gives the player Strength, debuffs and
    powers before combatStart relics. Multi-enemy fixtures (#197) list `enemies` with aliases and give
    each play's target, per-enemy states and per-enemy forced moves.

39. **UI polish (#254):** chart toggles read "Colorblind" and "Percentiles" (below the strategy filters on
    small screens); Results has a "Generate new seed" button beside the seed field; deck folders for each
    character and Colorless split into rarity sub-folders (Basic, Common, Uncommon, Rare, Ancient, Event,
    Token; empty ones omitted; Shared Strike/Defend stay flat); Statuses and Curses folders start
    collapsed; enemy, relic and potion lists are alphabetical; the relic remove "x" has no border; the
    version label reads "Slay the Spire 2 <gameVersion>".

## Multi-enemy fights (#5)

40. **Several enemies (#5):** a fight can have up to 5 enemies (`enemyIds`, left to right); each has its
    own HP, Block, statuses, powers and move pattern. Enemy turn (#281): enemies take their turns
    left to right, each finishing its whole turn (Block reset, Poison, move, pattern advance,
    temporary Strength loss ends, Strength per turn gained, debuffs tick) before the next starts;
    the player's "until the enemy turn ends" powers end after the last enemy's move. The fight is won only when every enemy is dead; a dead enemy never acts and can't be targeted.
    A single-target card hits the strategy's target; if that enemy dies mid-card, the rest of its hits
    and effects on it are lost (other effects still resolve). A dead or missing target falls back to the
    current enemy, else the leftmost living one (also for cards played by effects, Replay and Juggernaut;
    random targets are #45). ALL effects (attacks, The Bomb, Rolling Boulder, Panache, Inferno, and
    Vulnerable / Weak / Poison with `allEnemies`: Thunderclap, Shockwave, Scare, Bag of Marbles) hit
    every living enemy; a multi-hit ALL attack lands each hit on all enemies before the next hit, and
    counts its damage once per enemy hit (#6). Thorns killing an attacker stops its attack; the others
    still act. Feed / Hand of Greed count a kill while other enemies live. Shrink ends when the enemy that
    applied it dies. HP left (`enemyHpRemaining`) is summed. Single-enemy fights are unchanged.
41. **Target priority (#5, Trent):** each strategy picks "Lowest HP first" (default) or "Biggest incoming
    attack first" (ties: lowest HP); further ties go to the leftmost enemy. Strategies in one run can use
    different priorities. The Block group plans against all enemies' incoming damage combined. URL
    strategy codes end in "i" for Biggest attack; older codes and saved strategies mean Lowest HP.
    Lowest HP ranks by effective HP (HP + Block, #282); only HP-direct effects (Poison, Doom, Capture Spirit:
    cards that lose HP past Block) rank by HP alone.
42. **Multi-enemy UI (#5):** Setup has "Add enemy" / "Remove enemy N" (any enemy), the link holds one
    enemy code per enemy (`e=NbSe`), the results text joins the names ("Ironclad vs A and B"), the
    combat log shows one HP bar per enemy, lines "Enemy N:" before that enemy's events, and one intent
    line naming every living enemy's move with the total incoming damage. The strategy editor and the
    New Strategy form have a Target picker.
43. **Random-target cards (#45, Trent):** an `attack` effect with `randomTarget` (Sword Boomerang, Rip and
    Tear, Volley, Ricochet) sends each hit to a random living enemy through the seeded Rng, one draw per hit,
    only while 2+ enemies live (a one-enemy fight draws nothing and is unchanged); hits continue after a kill.
    Juggernaut's damage also picks a random living enemy. Strategies, with 2+ enemies alive, play random-target
    attacks first and re-plan the rest of the turn on the new board, except (#304) that targeted attacks that
    together (combined, within the Energy left) kill a living enemy go first, the cheapest set in Energy, aimed
    at the leftmost enemy they kill (#344: counted under the engine's rules: Vulnerable or Weak and Strength from a card in
    the set count for the later cards, enemy Block and Artifact are respected, and the set is played in the order that
    kills, so a debuff card such as Bash can go first). With one enemy there is no special order (energy-to-damage ratio).
44. **Poison-only cards (#46, Trent):** a card whose only effect is applying Poison (Deadly Poison, Bouncing
    Flask) is played before the Attacks when the enemy will live at least two more turns. Estimate: the Attacks in
    hand deal D a turn (Strength and Vulnerable counted, energy after the Poison card); the enemy lives 2+ turns
    when HP - its Poison - 2 x max(0, D - its Block) > 0, so enemy Block favours Poison (Poison ignores Block).
    Enemy Artifact counts against it: each application uses one stack and is negated, so a card is not played
    when the Artifact stacks cover all its applications.

45. **Silent counters (#265):** Pinpoint costs 1 less per Skill played this turn (minimum 0). Memento Mori
    deals 4 (5 upgraded) more per card discarded this turn by an effect (the end-of-turn discard does not
    count; resets each turn). Murder deals 1 more per card drawn this combat (the opening hand counts).
    Flechettes hits once per Skill in hand and Finisher once per Attack played earlier this turn (not
    itself), each hit for the card's damage with Strength and modifiers; with none, no hits (0 damage).
    Escape Plan draws 1 card and gains Block only if the card drawn is a Skill. Expertise draws until the
    hand holds 6 (7 upgraded) cards; a bigger hand draws nothing. Strategies play Finisher after the other
    Attacks.

## Silent trigger powers (#266)

46. **Silent trigger powers (#266):** Afterimage: each card played after it gains [amount] Block (power Block: no
    Dexterity or Frail; its own card does not count). Serpent Form: each such card deals [amount] damage to a random
    living enemy (not an Attack: Block absorbs it; Strength, Weak and Vulnerable do not change it). Speedster: each
    card drawn during the player's turn, the turn-start draw included, deals [amount] damage to ALL enemies (power
    damage). Tools of the Trade: at the start of each turn after the normal draw, draw [amount], then discard
    [amount] cards from the hand; the strategy discards in the exhaust order, with Sly cards ahead of curses and
    statuses except those that hurt while kept (Trent, #259). Tracking (main release): Attacks deal double damage to
    a Weak enemy (a ×2 multiplier floored once, ×3 with Vulnerable; it is not Weak on the player).
47. **Well-Laid Plans (#266, Trent):** at the end of the turn up to [amount] cards (1, upgraded 2) are retained
    (Ethereal and Retain cards are not offered; curses and statuses are never kept). The strategy keeps the card it
    needs next turn for its top priority (the first group of its order with a card in hand; a Block-first strategy
    keeps a Block card, the best of the group first), unless more than half of the draw pile is cards of that
    group, in which case it keeps other cards first (leftover slots take the demoted ones).
48. **Silent damage, Block and debuff cards (#260, Trent):** X-cost cards (Skewer, Malaise) spend all the Energy
    left, so two X-cost cards in one hand play only one unless Energy is gained in between. Bullet Time makes only the
    cards in hand at that moment free this turn (X-cost cards still spend their X) and blocks all later draws this turn.
    Precise Cut deals max(0, base + Strength − 2 × other cards in hand) (#314: Strength before the floor; 3
    Strength, 8 other cards: 13 + 3 − 16 = 0); the strategy's estimate floors the same way. Grand Finale is playable only with
    an empty draw pile. Expose removes the enemy's Block and Artifact before it applies Vulnerable. Malaise takes X
    (X+1 upgraded) Strength from the enemy for good, then applies that much Weak; Artifact negates each separately.
    Strangle: the enemy loses 2 (3) HP for every card played after it this turn. Piercing Wail hits one enemy.
    Bubble Bubble adds Poison only to an enemy that already has Poison.

## Silent draw, discard and energy cards (#259)

49. **Discard from the hand (#259, Trent):** "Discard N" (Survivor, Acrobatics, Prepared, Dagger Throw) is a
    `moveCards` hand → discard pick of exactly N (fewer only when the hand is smaller), resolved after the card's
    other effects in text order. Every card discarded from the hand by an effect (these, Storm
    of Steel, Tools of the Trade) goes through one shared discard step that counts it as discarded this turn
    (Memento Mori); the end-of-turn hand discard and a full-hand draw do not. The strategy discards in the shared
    order of item 46 (curses/statuses that hurt while kept, then Sly cards, then the exhaust order).
50. **Silent draw and energy cards (#259):** Backflip gains Block, then draws 2; Adrenaline gains 1 (2) energy
    and draws 2 (Exhaust); Predator deals 15 (20) and draws 2 more at the start of the next turn (after the
    normal draw). Dodge and Roll's next-turn Block gets Dexterity and Frail (#264, tested in
    combat.silentTemp.test.ts). Calculated Gamble is not simulated yet (#311).

## Silent Sly keyword (#261)

51. **Sly (#261, #314, Trent):** a Sly card discarded from the hand by a card or power effect during the player's
    turn (the shared discard step of item 49) goes to the discard pile and is played right AFTER the card that
    discarded it finishes (its Replays and on-play triggers included; for Tools of the Trade, after its whole
    discard), exactly as if played from the hand (all effects, on-play triggers, cards-played counters, Slow,
    Vigor, Calamity) but for free; a single-target Attack hits a random living enemy (seeded Rng, one draw only
    while 2+ live) and the player's target is kept afterwards. Afterwards it goes where a played card goes
    (discard pile, Exhaust, a Power leaves play). Several Sly cards discarded by one card play in hand (draw)
    order; a Sly card may itself discard (and play) another, after it finishes; a Sly play that kills the last
    enemy wins like any played card. Vigor goes to the first Attack played (an Attack that discards a Sly Attack
    has used it; after a Skill such as Survivor the Sly Attack uses it). A queued Sly card that left the
    discard pile before its turn (reshuffled by a later draw of the discarding card) is not played. The end-of-turn
    hand discard never plays Sly cards. Abrasive, Flick-Flack (6/8, main), Haze (cost 3, Sly, main), Reflex,
    Ricochet, Tactician and Untouchable are simulated.
52. **Sly strategy (#314, Trent):** a "Discard N" card (Survivor, Acrobatics, Prepared, Dagger Throw) is
    weighed with the free effects of the Sly card(s) it would discard (the discard order of item 49) added to
    its own, against its Energy cost, like other plays (Survivor + Untouchable is 14 Block for 1, Survivor +
    Ricochet is a 12-damage Attack for 1). It is played before the groups when the Sly energy pays for it
    and another card wants energy (Survivor + Tactician + Strike + Defend: Survivor, then Strike and Defend);
    when a Sly card costing at least the discard card has a free effect no group weighs: Poison when the
    Poison-only estimate of #46 says it pays off and Artifact does not negate it (Survivor +
    Haze), or a Power / other effect (Survivor + Abrasive); or when a Sly card draws (Reflex) and energy is
    left afterwards to play the drawn cards.

## Setup UI: starting HP (#315)

53. **Starting HP field (#315, builder's default):** the Setup panel has a Starting HP number field showing
    the character's start HP at the chosen Ascension (#286). It follows Ascension changes until the user edits
    it; an edited value is kept across Ascension changes (Reset returns to the default) and is dropped when the
    character changes (Max HP differs). Input is rounded and clamped to 1..Max HP; empty input is ignored. A
    set value is passed as `startHp` to the run and to replayed combats. It is stored in the URL as `h` only when edited and different from the default; out-of-range values are ignored with an error.

## Silent Poison powers (#263)

54. **Silent Poison powers and counters (#263, Trent):** Accelerant: Poison triggers 1 (2) extra times at the
    start of the enemy's turn, and every extra trigger also lowers Poison by 1 (Poison 5 with one extra trigger
    deals 5 + 4 and leaves 3); triggers stop once Poison reaches 0 or the enemy dies. Envenom: each hit of an
    Attack card that deals unblocked damage applies 1 (2) Poison to that enemy; Thorns, power damage, fixed damage
    (Fire Potion) and Poison itself do not. Noxious Fumes: at the start of each of your turns (after the draw)
    apply 2 (3) Poison to ALL enemies. Corrosive Wave: for the rest of this turn, every card you draw applies
    2 (3) Poison to ALL enemies. Outbreak (main v0.107.1, Uncommon Power): every 3rd time you apply Poison deals
    11 (15 upgraded; cost 2, upgraded 1) damage to ALL enemies (power damage, Block absorbs). Each enemy that
    receives Poison is one application (#332, Trent: Poison to ALL on 3 enemies = 3), an Artifact-negated
    application does not count, and applications are counted only while Outbreak is in play. Mirage: Block equal to the total Poison on all living enemies
    (Dexterity and Frail apply; Exhaust).

## Dynamic Sly and Nightmare (#268)

55. **Hand Trick and Nightmare (#268):** Hand Trick (1 cost; Block 7, 10 upgraded) gives Sly to one Skill in the
    hand until the end of this turn (a per-card keyword; it is gone next turn even if the card is retained, and
    is not copied by Nightmare). The engine picks the Skill without Sly that costs the most, ties in hand order
    (builder's default); no such Skill, no effect. Nightmare (3 cost, 2 upgraded; Exhaust): choose a card in the
    hand (Strategy.choose, purpose 'copy': best card first); at the start of next turn, BEFORE the draw (Trent), 3
    copies are added to the hand (a full hand sends them to the discard pile; cards drawn past 10 go to the discard
    pile by the existing hand-limit rule). The copies keep the upgrade, damage bonus,
    Replay and combat cost the card had when chosen, and every modifier on it, Hand Trick's temporary Sly included
    (Trent): that Sly expires at the end of the turn the copies arrive. An empty hand: no effect.
56. **Master Planner and The Hunt (#268, builder's defaults):** Master Planner (Power, cost 2, 1 upgraded): every
    Skill played while it is in play (from the hand or by an effect) gains Sly for the rest of the combat (a card
    played before it, Attacks and Powers do not), so it plays free when a later effect discards it. The Hunt
    (cost 1, Exhaust; 10 damage, 15 upgraded): if the hit kills the enemy (the last one with several), the combat
    gains one extra card reward, counted in `CombatResult.rewards.cardRewards` like Hand of Greed's gold; no kill,
    no reward. The count is not summarised or shown in the Results view yet (StrategySummary has no field for it).

## Known failure points

- **Scared Block stress deck:** starter + Burning Pact + Purity + True Grit+ vs Nibbit A0 must stay at
  0% deaths for Block 0, Block 5 and Greedy (it was 64% at Block 0 before #141). Re-measure after any
  change to the exhaust order or deck guard.
- **`compare-main` covers only the starter deck**, so "identical" says nothing about the card rules
  above. Changes to those need their own tests or a measured deck.
- **`npm run shot` can't show the chart or Results**, because it never runs a simulation.
- **Parallel cards collide** in `engine/combat.ts`, `engine/strategies.ts` and `data/validate/*`; the
  later PR must merge `main` and re-run the checks before it is merged.
