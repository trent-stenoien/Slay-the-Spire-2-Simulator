# Regent card import questions

## Conditional Star generation

Recorded with NO gainStars effect (base and upgraded):

- **Convergence**: next turn gain Energy and 1 Star (2 Stars upgraded).
- **Genesis**: at the start of your turn gain 2 Stars (3 upgraded).
- **Hidden Cache**: the immediate "Gain 1 Star" is a gainStars effect; the "Next turn, gain 3 Stars" (4 upgraded) part is not recorded.
- **Knockout Blow**: gain 5 Stars only if it kills an enemy (attack recorded, Stars not).
- **The Sealed Throne**: whenever you play a card, gain 1 Star.
- **Radiate**: scales with Stars gained this turn (consumes, does not generate); **Black Hole** triggers on Stars gained or spent.

## Other questions

- Forge (Beat Into Shape, Big Bang, Bulwark, Conqueror, Furnace, Hammer Time, Refine Blade, Seeking Edge, Spoils of Battle, Summon Forth, The Smith, Wrought in War): does the project model Forge and Sovereign Blade at all? Only the non-Forge parts are recorded.
- Vigor / Plating / Replay (Patter, Terraforming, Neutron Aegis, Sword Sage): are these buffs going to be supported? Currently no effect object.
- Minion cards, Transform, Colorless/created cards, Debris (Begone, Charge, Guards, Bundle of Joy, Quasar, Collision Course, Crash Landing, ...): are card creation/transformation mechanics in scope?
- Multiplayer "another player"/"ALL players" cards (Constellation, Largesse, Tutor, Plot, Hammer Time): treat as unsimulated and ignore?
- "This turn" Strength loss on enemies (Crush Under, Dying Star, Monarch's Gaze, Resonance): Resonance records only the permanent Strength gain; enemy Strength loss is not recorded.
- Crescent Spear / Supermassive: scaling bonus damage ("additional damage for each ...") is not captured; only the base 8 / 5 damage is recorded and the upgrade only changes the bonus.
- Seven Stars: costs 7 Stars and hits 7 times for 7; stored as attack 7 x7 all enemies.
- Meteor Shower: "Apply 2 Weak and Vulnerable to ALL enemies" recorded as Weak 2 + Vulnerable 2.
- Void Form: "End your turn" and free card play are not representable; Ethereal keyword recorded.
