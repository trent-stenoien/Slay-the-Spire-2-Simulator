# Relics v1 (#205)

Text: wiki Relics_List (slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Relics_List), checked against every
beta patch newer than main v0.107.1 (V0.108.0 via patchbot.io's copy of the Steam notes; V0.109.0–V0.111.0 on the
wiki): none changes these relics' text, so the list text is main-release. Individual relic pages were not fetched
(The Boot's page was, and agrees). Not done: Byrdpip (a companion that attacks; no contract type).

| Relic | Main text | Simulated | Notes |
|---|---|---|---|
| Burning Blood | At the end of combat, heal 6 HP. | yes | Wins only. Default relic for the Ironclad. |
| Blood Vial | At the start of each combat, heal 2 HP. | yes |  |
| Vajra | Start each combat with 1 Strength. | yes |  |
| Anchor | Start each combat with 10 Block. | yes | Turn-1 hook (combat-start Block would be wiped by the turn-1 Block reset). |
| Gorget | At the start of each combat, gain 4 Plating. | yes | Turn-1 hook, so Plating isn't cut to 3 by turn 1's start-of-turn tick. |
| Ornamental Fan | Every time you play 3 Attacks in a single turn, gain 4 Block. | yes | Script: the contract's `everyCards` counts per combat, the relic counts per turn. |
| Girya | You can now gain Strength at Rest Site. (3 times max) | yes | Real text is a rest-site action; Setup picks the Strength (1–3, default 1). |
| Bag of Marbles | At the start of each combat, apply 1 Vulnerable to ALL enemies. | yes |  |
| Bag of Preparation | At the start of each combat, draw 2 additional cards. | yes |  |
| Bronze Scales | Start each combat with 3 Thorns. | yes |  |
| Oddly Smooth Stone | Start each combat with 1 Dexterity. | yes |  |
| Lantern | Start each combat with an additional 1 Energy. | yes |  |
| Strike Dummy | Cards containing “Strike” deal 3 additional damage. | yes | Also applies to Perfected Strike's script attack. |
| Akabeko | At the start of each combat, gain 8 Vigor. | yes |  |
| Horn Cleat | At the start of your 2nd turn, gain 14 Block. | yes |  |
| Beating Remnant | You cannot lose more than 20 HP in a single turn. | yes | "A single turn": player's and enemy's turns counted separately (open question). |
| Bellows | The first Hand you draw each combat is Upgraded. | yes | Script, after the other turn-1 hooks (Bag of Preparation's cards are upgraded too). |
| Captain's Wheel | At the start of your 3rd turn, gain 18 Block. | yes |  |
| Chandelier | At the start of your 3rd turn, gain 3 Energy. | yes |  |
| Ice Cream | Energy is now conserved between turns. | yes |  |
| Stone Calendar | At the end of turn 7, deal 52 damage to ALL enemies. | yes |  |
| Tungsten Rod | Whenever you would lose HP, lose 1 less. | yes |  |
| Sai | At the start of your turn, gain 7 Block. | yes |  |
| Iron Club | Every 4 cards you play, draw 1 card. | yes | Counter starts at 0 each combat. |
| Runic Pyramid | At the end of your turn, you no longer discard your Hand. | yes |  |
| Bread | At the start of your first turn, lose 2 Energy. At the start of all other turns, gain 1 Energy. | no | Needs `loseEnergy` (#206, not simulated yet). Data entered. |
| Sozu | Gain 1 Energy at the start of each turn. You can no longer obtain Potions. | yes | `noPotions` blocks gainPotion rewards (Alchemize); potion slots are #204's. |
| Velvet Choker | Gain 1 Energy at the start of each turn. You cannot play more than 6 cards per turn. | yes |  |
| Belt Buckle | While you have no Potions, you have 2 additional Dexterity. | yes | Reads PlayerState.potions (none until #204 lands → always +2). |
| Chemical X | The effects of your cost X cards are increased by 2. | yes | X + 2 for effects; energy spent unchanged. |
| Ghost Seed | Strikes and Defends gain Ethereal. | yes | Script: name contains Strike/Defend exhausts at end of turn (generated copies too). |
| Sling of Courage | Start each Elite combat with 2 Strength. | yes | Script: only vs `difficulty: elite`. |
| Pollinous Core | Every 4 turns, draw 2 additional cards. | yes | Counter starts at 0 each combat (game carries it across combats). |
| Happy Flower | Every 3 turns, gain 1 Energy. | yes | Counter starts at 0 each combat (game carries it across combats). |
| Snecko Eye | At the start of your turn, draw 2 additional cards. Start each combat Confused. | yes | Script `confused`: drawn card costs random 0–3 for the combat. |
| Sword of Jade | Start each combat with 3 Strength. | yes |  |
| The Boot | Whenever you would deal 4 or less unblocked attack damage, increase it to 5. | yes |  |
| Orichalcum | If you end your turn without Block, gain 6 Block. | yes | Not on Trent's list; added because Orichalcum??? uses the same hook. |
| Snecko Eye??? | Start each combat Confused. | yes | Script `confused` only. |
| Strike Dummy??? | Cards containing “Strike” deal 1 additional damage. | yes |  |
| Anchor??? | Start each combat with 4 Block. | yes |  |
| Blood Vial??? | At the start of each combat, heal 1 HP. | yes |  |
| Happy Flower??? | Every 5 turns, gain 1 Energy. | yes |  |
| Orichalcum??? | If you end your turn without Block, gain 3 Block. | yes |  |
| Byrdpip | Upon pickup, gain the card Byrd Swoop. A Byrdpip will accompany you in battles. | not entered | Companion attacker; no type for it. |
