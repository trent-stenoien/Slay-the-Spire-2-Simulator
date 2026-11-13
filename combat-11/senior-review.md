# Combat 11 senior review (Silent A10 vs Shrinker Beetle, v0.107.1)
Sources: notes.md, screenshots 01-08, data/enemies/shrinker_beetle.json, data/characters/silent.json, engine/rules.ts.

## Resolved (15 of 15 items; 1 residual question)
1. 7 cards T1: Ring of the Snake draws +2 on turn 1 only (data/relics/ring_of_the_snake.json). 5+2=7 (01.jpg). T2-T4 draw 5.
2. Ascender's Bane: A10 includes it (08.jpg modifier list; manifest ascensionCards A5+). Deck = 5 Strike, 5 Defend, Neutralize, Survivor, Deadly Poison, Bane = 14; 01.jpg shows hand 7 + draw pile 7 = 14.
3. Typo, Ascender's Bane.
4. Shrink was applied by the beetle's T1 move (after 02.jpg, absent there). Shrink icon sits under S in 03-08.jpg. Notes should say "S: Shrink (-30% damage dealt) from T1 enemy turn, stays while B lives". HP unchanged (40/70).
5. Costs: Strike 1, Defend 1, Survivor 1, Deadly Poison 1, Neutralize 0, Bane unplayable. 3 energy/turn (02,04,06,08 show 0/3 or 2/3). T1: DP+2 Strikes = 3, so 3 Defends could not be played (and Bane is unplayable).
6. T1 Strikes pre-Shrink: 6 each, 40->28 (6+6).
7. T2 Strikes under Shrink: floor(6x0.7)=4 each, 23->15 (8). 04.jpg.
8. T2 Survivor = 8 Block (04.jpg shows 8). Chomp 8 - 8 = 0. Block does not carry over.
9. T3 Neutralize: floor(3x0.7)=2, 11->9. It also applies 1 Weak (06.jpg beetle shows Weak 1).
10. T3: Weak cut the beetle's Stomp 14 -> floor(14x0.75)=10 (06.jpg intent 10). 3 Defends = 15 Block (06.jpg, 15). 15 >= 10, no HP loss. Notes' "attacking for 14" was the intent before Neutralize.
11. T3: 4 Defends + Neutralize in hand, 3 energy: Neutralize 0 + 3 Defends = 3; 4th Defend unaffordable.
12. T4: see Residual question below. 4 Strikes (4 dmg each under Shrink) at 3 energy could have killed (8 >= 6); Deadly Poison was a choice.
13. Typo, "its".
14. Deck list: 5 Strike, 5 Defend, Neutralize, Survivor (data/characters/silent.json) + Deadly Poison + Bane. Pile counts reconcile all turns: T2 draws 5 of 7 (2 left: Defend, Neutralize); Bane exhausts (ethereal) at T1 end so deck is 13; T3 draws those 2, reshuffles 11 discards, draws 3 (draw 8, discard 0 in 05.jpg); T4 draws 5 of 8 (3 left, 07.jpg).
15. A10 list (08.jpg): Tough Enemies (A8 HP), Deadly Enemies (A9 damage) apply. Beetle 40 HP, Chomp 8, Stomp 14 match our A8/A9 overrides.

## Poison arithmetic (consistent)
T1 DP 5; B 28. B turn: 28-5=23, P4, Shrink. T2: -8 =15; turn: 15-4=11, P3. T3: -2 =9; turn: 9-3=6, P2 (Chomp 8 shown at T4 start for the next move). T4: DP +5 =7 >= 6 HP, dies at turn start before moving. Move order Shrink, Chomp 8, Stomp 14, Chomp 8 matches data (opener shrinker, then chomp/stomp cycle).

## Data/rule findings
- No disagreement for beetle HP (40 within A8 range 40-42), Chomp 8 / Stomp 14 (A9), Shrink 30%, Shrink damage math (rules.ts floor(dmg*0.70)), Ring of the Snake, Survivor 8, Neutralize 3+1 Weak, Deadly Poison 5.
- Start HP 40/70: not 56. Screenshot shows floor 3 and 109 gold, so S is mid-run (earlier fights). Must be passed as startHp 40 in the fixture; the A2+ default of 56 does not apply mid-run. Not a rule conflict. No evidence of "Weary Traveler" HP effect; it is unexamined in our data (not simulated/not needed).
- A10 Tight Belt (2 potion slots shown) is irrelevant to combat; no potions used. Fishing Rod no combat effect.

## Still unexplained
- T4: why DP (poison 7 kills at turn start) rather than 2 Strikes (4+4 = 8 kills at once)? Question for Trent: intended to test a poison kill on its own turn, or did Shrink make you think Strikes would not kill? (Only matters for replicating the line; the arithmetic is consistent.)
- Minor: how was start HP 40 reached (confirm it is the run's current HP, floor 3)?

## Corrected record
T1: S 40/70, draw 7 (Ring of the Snake): 2 Strike, 3 Defend, Deadly Poison, Ascender's Bane. Play DP, 2 Strikes (6 each) -> B 28, P5. Bane exhausts. B: poison to 23, P4, Shrink (-30% S damage).
T2: B 23, intent Chomp 8. Draw 3 Strike, Defend, Survivor. Survivor (8 Block, discard Defend), 2 Strikes (4 each) -> 15. Chomp blocked. Poison 15->11, P3.
T3: B 11, intent Stomp 14. Draw 4 Defend, Neutralize (2 old + reshuffle). Neutralize (2, Weak 1; intent 10), 3 Defends (15 Block) -> B 9. Stomp 10 blocked. Poison 9->6, P2.
T4: B 6, Chomp 8. Draw 4 Strike, DP. DP -> P7. B dies at turn start. 0 HP lost, 4 turns.
