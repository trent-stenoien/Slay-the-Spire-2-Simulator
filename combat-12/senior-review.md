# Senior review, combat 12 (Silent A10 vs Bygone Effigy, v0.107.1)
Screens read: 02, 05, 07, 09, 11. Slow rule (tooltip, 02): each card the player plays adds 10%; the enemy takes 10% more Attack damage per card played this turn. Slow N on screen = 10 x cards played; resets after the player turn. Potions do not count as cards.

## Resolved (22 of 23)
1. Ring of the Snake: +2 draw on turn 1 (5+2 = 7 cards; data ring_of_the_snake.json OK).
2. Ascender's Bane is in the deck (A10); the 21-card deck (screens) = 5 Strike (1 is +) + 5 Defend + Neutralize + Survivor + Bane + Egg + Deadly Poison, Blur, WLP, Footwork, Prowess+, D&R, Snakebite.
3. Strike 7 vs 6: Slow. T1 Strike was the 3rd card (DP, Defend before): 6 x 1.2 = 7.2 -> 7. T2 Strike was 2nd (WLP before): 6 x 1.1 = 6.6 -> 6.
4. Poison 17 = Deadly Poison 5 + 2 x Poison Potion 6 (raw/potions.txt: Apply 6). Slow 30 = DP, Defend, Strike (3 cards, potions excluded).
5. Strike+ 10: base 9, 3rd... it was after WLP+Strike: 9 x 1.2 = 10.8 -> 10. Total 108-6-10 = 92.
6. +10 Strength is Effigy's Wake move (intents.txt "Gains 10 Strength") on its T2 move; first seen T3 (05 shows 10). Slashes 15 (A9+) + 10 = 25.
7. T3 hand is 6 = retained Defend (WLP) + 5 drawn (Strike, Prowess+, D&R, Snakebite, Footwork). Notes' "Drew" list includes the retained Defend; Footwork/Prowess do not draw.
8. Slow 40 = 4 cards played T3 (Prowess+, Footwork, D&R, Defend). Others = 3 cards.
9. 17 Block: Prowess+ +2 Dex, Footwork +2 Dex = 4 Dex. Defend 5+4 = 9, D&R 4+4 = 8 now (next-turn block fixed at 8, seen 07). 9+8 = 17. Enemy 25-17 = 8 HP lost (30->22).
10. Snakebite is retained (keyword), not drawn again; T3 end "Retain: Strike" is the WLP pick. T4 hand (07) = Snakebite, Strike (retained) + 5 drawn: Blur, Strike, Neutralize, Defend, Survivor. Notes' T4 "Drew" list is the 7-card hand minus the duplicate Strike, i.e. a typo/dedupe.
11. T4 hand 7 = 2 retained + 5 draw, no extra draw. Draw pile was 4 at T3 end so a reshuffle happened mid-draw (07: draw 10, discard 0).
12. E 61->56 = Neutralize 3 + 2 Strength (Prowess+) = 5, Slow 0 (first card). Snakebite does no damage.
13. Poison 14->21 = +7 Snakebite (data 7 OK).
14. Block 20 = 8 (D&R) + Survivor 8+4 Dex = 12. Enemy Weak 18: 25 x 0.75 = 18.75 -> 18; 20-18 = 2 Block left; HP stays 22.
15. Weak 1 applied T4 ticks off at end of Effigy's turn; T5 attack 25 (09).
16. T5 start Block 0 (D&R was T3 only). 27 = Blur 5+4 + Defend 9 + Defend 9; 3 energy. Enemy 25 -> 2 left, kept by Blur = T6 start 2 (11).
17. Deadly Poison / Egg: both in discard since T1; the T4 reshuffle put them back. T5 drew DP; T6 drew Egg (09: draw 5; 11: draw 0 after drawing 5, no second reshuffle).
18-19. No T6 end shot needed: nothing played, Poison 19 >= HP 15 kills at the start of Effigy's turn (15 HP at T6 = 35-20). Screenshot 11 is both before and after.
20-21. Survivor + Neutralize are starting cards; 5 Strike (1 Strike+; possibly Fishing Rod, see Q2) and 5 Defend.
22. Energy 3; Happy Flower (every 3rd turn) gives 4 on T3 and T6 (05, 11: 4/3). T3: 4 cards x 1 = 4. T4: Neutralize 0 + Survivor 1 + Snakebite 2 = 3.
23. Typo: "Footwork, Prowess+".
Whole chain checks: 132-7=125; -17=108; -16=92... T3 76 (-16 Poison); -15=61; -5=56; -21 = 35; -20 = 15; T6 kill. HP 30->22 = 8 lost; 6 turns.

## Data/engine gaps and disagreements
- Bygone Effigy: not in data/enemies (only data/raw/enemies.txt 127/132 HP, Slow; intents.txt Slashes 13;15 (A9), Sleep, Wake +10 Strength). Needs import (main release) with an A10 HP of 132 and a Sleep/Wake pattern.
- Slow power (and Sleeping/Slumber state) is not in engine/types.ts or the engine. New mechanic: +10% Attack damage per card played, reset each player turn; potions excluded; multiplier is additive per card (confirmed 1.1, 1.2). Needs a contract card.
- Poison Potion: no data/potions file (only fire, strength). raw/potions.txt: 6 Poison (screens confirm 6).
- Fishing Rod relic: no data file (no combat effect; it may explain the Strike+/Prowess+ upgrades).
- Not simulated (simulated:false): Blur, Dodge and Roll, Footwork, Survivor. Footwork JSON has effects [] (no Dexterity effect); our data lacks its +2 Dex. Strategy "choose" must handle WLP retain (simulated) and Survivor discard.
- Prowess+ gives 2 Str + 2 Dex in data: matches the game. Snakebite 7, Deadly Poison 5, Neutralize 3+1 Weak, Blur 5 (+4 Dex), D&R 4, Survivor 8, Happy Flower, Ring of the Snake: all match.
- No contradiction found between screenshots and data values; the gaps above are only missing content.

## Still unexplained: questions for Trent
Q1. T4 "Drew" list omits the second Strike (hand 07 has two Strikes + retained Snakebite). Confirm drawn = Blur, Strike, Neutralize, Defend, Survivor.
Q2. Was the Strike+ upgraded before this fight (Fishing Rod) and is Prowess+ also an earlier upgrade? Only matters for the fixture deck.
Q3. Which Defend was retained on T5/T6 and are both D&R plays in T3 the same copy? (Cosmetic.)
