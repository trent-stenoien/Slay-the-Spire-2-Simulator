# Key features (test checklist)

The behaviours that matter most, agreed with Trent. The quality-review loop checks each item
has a test; new rules agreed on a card are added here. Details live in the linked cards.

## Simulation correctness

1. **Determinism:** same config + seed gives an identical event log; no `Math.random()` in `engine/`.
2. **Damage:** per hit = floor((base + Strength) × modifiers); Vulnerable ×1.5; Block absorbs hits in order.
3. **Turn order** exactly as in CLAUDE.md, including: player debuffs tick at the end of the player's
   turn, enemy debuffs at the end of the enemy's turn; Poison at enemy turn start (ignores Block,
   a kill wins before the move, then −1); Howl from Beyond plays itself from the Exhaust pile at
   the end of the player's turn, then goes to discard (#114).
4. **HP lost (#115)** = Max HP at the start of combat − final HP (minimum 0). It includes self-damage
   (Hemokinesis etc.); dying from self-damage is a loss. Not Yet lowers it by the HP actually healed
   (65/70 → −5). Feed's Max HP gain also raises current HP, so it lowers it. HP removed by Brightest
   Flame's cap (69/70 → 68/68) counts as lost. Turn cap 100.
5. **Ascension:** overrides are cumulative; Ascender's Bane added (and locked in the deck builder) at A5+.
6. **Draw rules:** Innate cards go on top of the draw pile (turn 1 still draws 5); hand limit 10;
   Scrawl and Pillage stop at 10; Battle Trance blocks all further draws that turn; Retain keeps cards.
7. **Powers:** leave the deck when played; turn-start/turn-end hooks fire in order (after the draw, in
   the order first played). Rolling Boulder: each play is its own instance that grows independently.
   Crimson Mantle: each copy adds its Block and its HP loss. Neither has a copy limit (#135).
8. **Card mechanics as agreed:** Plating, Vigor (every hit of the next Attack), Thorns (every enemy
   hit, blocked or 0-damage hits included), Fasten ("Defend" cards; added before Frail's ×0.75, rounded
   down once), Thrash, Tear Asunder (any HP drop; fully blocked hits don't count), Corruption (X-cost
   unchanged; Drum of Battle still gains energy), X-cost (`xTimes`/`xBonus`), energy doesn't carry
   over, single-enemy targeting for random/ALL attacks (Omnislice = 8/11).
9. **Enemies (#4):** Shrink (−30% attack damage) applies after all other modifiers, rounded down once,
   and doesn't stack. Sludge Spinner opens with Oil Spray, then picks at random with no repeats (the
   opener counts as the previous move). A Stunned enemy skips its move and deals no damage; its
   pattern still advances (#148 confirms). Enemy Strength gained from cards (Fight Me) works like
   player Strength (#169).
10. **Statuses, curses and defensive effects (#115):** "Lose X HP" curses/statuses (Bad Luck, Beckon,
    Regret) ignore Block; "Take X damage" ones (Burn, Decay, Disintegration, Infection, Toxic, Wither)
    are blockable. Intangible makes every hit that turn 1, Poison included (Accelerant = 1 twice).
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
    wiki text, except Splash (#151), Sovereign Blade (waits for Forge, #20) and the multiplayer-only
    cards (#117).

## Strategy behaviour

18. **Ordered groups:** Attack / Block / Powers in the chosen order; "allow X through" applies only to
    Block. Defaults: Greedy Damage (Attack, Powers, Block), Scared Block (Block 0, Powers, Attack).
19. **Play order:** 0-cost draw first, then Enlightenment (always played, #169); Not Yet first when it
    would heal 8+ (#115); Apotheosis right away when something can be upgraded and tutors when the draw
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
    when storage is blocked. The UI says Burning Blood's heal is not simulated.

## Known failure points

- **Scared Block stress deck:** starter + Burning Pact + Purity + True Grit+ vs Nibbit A0 must stay at
  0% deaths for Block 0, Block 5 and Greedy (it was 64% at Block 0 before #141). Re-measure after any
  change to the exhaust order or deck guard.
- **`compare-main` covers only the starter deck**, so "identical" says nothing about the card rules
  above. Changes to those need their own tests or a measured deck.
- **`npm run shot` can't show the chart or Results**, because it never runs a simulation.
- **Parallel cards collide** in `engine/combat.ts`, `engine/strategies.ts` and `data/validate/*`; the
  later PR must merge `main` and re-run the checks before it is merged.
