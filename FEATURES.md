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
4. **HP lost (#115, #205)** = start HP (default Max HP; `startHp` can start a combat lower) − final HP,
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
   over, single-enemy targeting for random/ALL attacks (Omnislice = 8/11), Expect a Fight (#246: gains
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
    Ghost Seed: the basic Strike and Defend (upgraded too) exhaust at end of turn like Ethereal.
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
    Vulnerable and there is energy for it plus another attack; otherwise by damage (#11, #149). X-cost
    attacks are compared at their damage for 1 energy: Strike before Whirlwind, Whirlwind+ before
    Strike; ties go to the other attack (#147). Cascade is played with the X-cost attacks.
21. **Situational cards:** temporary Strength, Rage and One-Two Punch only when an Attack follows;
    Setup Strike always counts as a 7-damage attack; Dark Shackles only when the enemy is attacking;
    Panic Button only as a last resort (#110). Body Slam and Entrench after other block cards, with
    Entrench planned to avoid excess Block (#111). Catastrophe, Beat Down, Hidden Gem, Dual Wield, The
    Bomb, Outmaneuver and Prolong use leftover energy; Dual Wield copies the highest-value card.
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
    Block), so it is never held while dying.
38. **Golden combats (#177, #210):** every fixture in `engine/golden/` replays through the engine
    (start HP, relics, potions at a point in the turn, `playerStart` statuses, scripted choices,
    mid-turn draws); mismatches fail unless listed in `knownDiffs` with a reason, and a listed one
    that no longer occurs fails too. `CombatConfig.playerStart` gives the player Strength, debuffs and
    powers before combatStart relics.

## Multi-enemy fights (#5)

39. **Several enemies (#5):** a fight can have up to 5 enemies (`enemyIds`, left to right); each has its
    own HP, Block, statuses, powers and move pattern. Enemy turn: every living enemy's Block resets, then
    each one's Poison, then each moves left to right, then the player's "until the enemy turn ends"
    powers end, then each enemy's temporary Strength loss ends, Strength per turn is gained and debuffs
    tick. The fight is won only when every enemy is dead; a dead enemy never acts and can't be targeted.
    A single-target card hits the strategy's target; if that enemy dies mid-card, the rest of its hits
    and effects on it are lost (other effects still resolve). A dead or missing target falls back to the
    current enemy, else the leftmost living one (also for cards played by effects, Replay and Juggernaut;
    random targets are #45). ALL effects (attacks, The Bomb, Rolling Boulder, Panache, Inferno, and
    Vulnerable / Weak / Poison with `allEnemies`: Thunderclap, Shockwave, Scare, Bag of Marbles) hit
    every living enemy; a multi-hit ALL attack lands each hit on all enemies before the next hit, and
    counts its damage once per enemy hit (#6). Thorns killing an attacker stops its attack; the others
    still act. Feed / Hand of Greed count a kill while other enemies live. Shrink ends when the enemy that
    applied it dies. HP left (`enemyHpRemaining`) is summed. Single-enemy fights are unchanged.
40. **Target priority (#5, Trent):** each strategy picks "Lowest HP first" (default) or "Biggest incoming
    attack first" (ties: lowest HP); further ties go to the leftmost enemy. Strategies in one run can use
    different priorities. The Block group plans against all enemies' incoming damage combined. URL
    strategy codes end in "i" for Biggest attack; older codes and saved strategies mean Lowest HP.
41. **Multi-enemy UI (#5):** Setup has "Add enemy" / "Remove enemy N" (any enemy), the link holds one
    enemy code per enemy (`e=NbSe`), the results text joins the names ("Ironclad vs A and B"), the
    combat log shows one HP bar per enemy, lines "Enemy N:" before that enemy's events, and one intent
    line naming every living enemy's move with the total incoming damage. The strategy editor and the
    New Strategy form have a Target picker.

## Known failure points

- **Scared Block stress deck:** starter + Burning Pact + Purity + True Grit+ vs Nibbit A0 must stay at
  0% deaths for Block 0, Block 5 and Greedy (it was 64% at Block 0 before #141). Re-measure after any
  change to the exhaust order or deck guard.
- **`compare-main` covers only the starter deck**, so "identical" says nothing about the card rules
  above. Changes to those need their own tests or a measured deck.
- **`npm run shot` can't show the chart or Results**, because it never runs a simulation.
- **Parallel cards collide** in `engine/combat.ts`, `engine/strategies.ts` and `data/validate/*`; the
  later PR must merge `main` and re-run the checks before it is merged.
