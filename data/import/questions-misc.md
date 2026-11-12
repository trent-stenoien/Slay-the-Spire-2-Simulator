# Curse, status and quest card import questions

- **Disintegration, Mind Rot, Sloth, Waste Away**: Their text has no "Unplayable." line, but the skeleton gives cost null (which requires the `unplayable` keyword); are these really unplayable, and should they stay unsimulated (persistent/end-of-turn rules)?
- **End-of-turn penalty cards (Bad Luck, Debt, Decay, Doubt, Regret, Shame, Burn, Infection, Toxic, Wither, Beckon, Disintegration)**: Engine has no "if in hand at end of turn" effects (HP loss, Weak/Frail, damage); marked simulated=false, confirm they stay out of decks until supported.
- **Enthralled, Normality, Sloth**: Play-order and card-per-turn limits are not representable; confirm unsimulated.
- **Folly, Writhe, Poor Sleep**: Contain Innate/Retain, which are not simulated keywords per the skill; kept simulated=false.
- **Spore Mind, Debris (cost 1, Exhaust only)**: Playable with no effect; marked simulated=true as keyword-only text, confirm that is intended.
- ~~**Slimed**~~ Resolved (#180): given the `draw` effect and marked simulated.
- **Quests (Byrdonis Egg, Dowsing, Lantern Key, Spoils Map) and Guilty**: Run-level text (rest site, rooms, deck removal) is outside combat; simulated=false.
