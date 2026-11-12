# Key features (test checklist)

The behaviours that matter most, agreed with Trent. The quality-review loop checks each item
has a test; new rules agreed on a card are added here. Details live in the linked cards.

## Simulation correctness

1. **Determinism:** same config + seed gives an identical event log; no `Math.random()` in `engine/`.
2. **Damage:** per hit = floor((base + Strength) × modifiers); Vulnerable ×1.5; Block absorbs hits in order.
3. **Turn order** exactly as in CLAUDE.md, including: player debuffs tick at the end of the player's
   turn, enemy debuffs at the end of the enemy's turn; Poison at enemy turn start (ignores Block,
   a kill wins before the move, then −1).
4. **HP lost** is measured before healing and includes self-damage (Hemokinesis etc.); dying from
   self-damage is a loss. Turn cap 100.
5. **Ascension:** overrides are cumulative; Ascender's Bane added (and locked in the deck builder) at A5+.
6. **Draw rules:** Innate cards go on top of the draw pile (turn 1 still draws 5); hand limit 10;
   Scrawl stops at 10; Battle Trance blocks all further draws that turn; Retain keeps cards.
7. **Powers:** leave the deck when played; turn-start/turn-end hooks fire in order; `maxCopies`
   limits (Rolling Boulder, Crimson Mantle: 1).
8. **Card mechanics as agreed:** Plating, Vigor (every hit of the next Attack), Thorns (every enemy
   hit), Fasten ("Defend" cards), Thrash, Tear Asunder (any HP drop; fully blocked hits don't count),
   Corruption (X-cost unchanged; Drum of Battle still gains energy), X-cost (`xTimes`/`xBonus`),
   energy doesn't carry over, single-enemy targeting for random/ALL attacks.
9. **Every Ironclad and Colorless card** (main release) is simulated and matches its wiki text.

## Strategy behaviour

10. **Ordered groups:** Attack / Block / Powers in the chosen order; "allow X through" applies only to
    Block. Defaults: Greedy Damage (Attack, Powers, Block), Scared Block (Block 0, Powers, Attack).
11. **Play order:** 0-cost draw first; 1+ cost pure draw only when the top group can't be filled, then
    re-plan; net-energy cards first when the energy can be used; Battle Trance after other draw;
    Tremble first among Attacks; Enlightenment early; Mad Science never played.
12. **Self-damage:** never play a card that would kill you; otherwise ignore the HP cost.
13. **Fiend Fire:** always if it kills; otherwise only when it beats other uses of the energy; played
    last after spending spare energy; Bash goes before it unless it kills.
14. **Second Wind:** played after the turn's Powers; exhausts only Block cards worth ≤ its per-card Block.
15. **Exhaust order:** the 8-tier order (#108/#139, #170: Howl from Beyond tier 2); Purity limited to
    curses/statuses and non-upgraded Strikes/Defends.
16. **Deck-health guard (#141/#147):** after an exhaust, damaging cards ≥ ceil(active deck / 5) and the
    active deck stays ≥ 5, unless the exhaust ends combat; lower damage-per-energy attacks are
    exhausted first (Bash before the last Strike).

## Results and UI

17. **Monte Carlo:** 10,000 combats per strategy; up to 5 strategies.
18. **Results table:** Avg HP lost (2 decimals), "HP lost, P25-P75", Avg combat turn length, death
    rate; sorted by HP lost, then death rate, then turns; description line with character, enemy,
    ascension.
19. **Chart:** smoothing ×0 (Raw) to ×5, default ×3; P5–P95 marks and P25–P75 band for 1–2 visible
    strategies; X range [max(0, P5 − 2), P95 + 2]; legend toggles.
20. **Combat log and picker:** turn blocks with enemy intent; checkbox picker numbered 1–10000;
    Compare view side by side (stacked on phones).
21. **Shareable URL:** deck, strategies (`st` codes, old codes still parse), colors and combat index
    restore the same view.
22. **Deck builder:** grouped by data folder, collapsed by default; search; Statuses/Curses/Multiplayer
    filters; Standard/Upgraded steppers; wiki links; hidden cards excluded.
