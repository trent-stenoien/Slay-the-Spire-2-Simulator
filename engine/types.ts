/**
 * Shared types for the STS2 combat simulator.
 *
 * This file is the contract between the engine, data, strategy, stats and UI
 * tracks. Change it only through the orchestrator, never from a feature branch.
 *
 * v1 is single-target: every card targets the one enemy, every enemy move
 * targets the player. Effects therefore carry no explicit target; the source
 * decides it (a card's effects hit the enemy, an enemy move's hit the player).
 *
 * ---------------------------------------------------------------------------
 * Contract map (#105): which addition serves which board card. Everything
 * listed here is declared but NOT simulated yet: the validator rejects it on
 * `simulated: true` cards and the engine throws "not simulated yet" if it is
 * reached. The branch for each card implements its part in engine/, data/
 * validate/lists.ts (move the effect out of the unsimulated set) and app/.
 *
 * Shared vocabulary: PileName, CardDestination, CardFilter, SelectMode,
 * Counter, PerCounter, Condition, CardSource, CardPool.
 *
 * #106 Lose HP      — Effect `loseHp`; GameEvent `loseHp`; CombatCounters
 *                     hpLostThisTurn / hpLostThisCombat / hpLossesThisCombat;
 *                     Condition `lostHpThisTurn`; Counter `hpLossesThisCombat`.
 * #107 Draw         — Effect `draw`, `drawUntil`; PowerId `noDraw`;
 *                     CombatCounters cardsDrawn*; (GameEvent `draw` already exists).
 * #108 Exhaust      — Effect `exhaustCards`; CardTrigger `exhausted`
 *                     (Drum of Battle), `turnEndInExhaust` (Howl from Beyond);
 *                     GameEvent `exhaust` reasons 'effect' | 'power';
 *                     CombatCounters cardsExhausted*; Counter `lastEffectCount`;
 *                     Effect `script` (Fiend Fire, Thrash).
 * #109 Powers       — Effect `applyPower`; PlayerState.powers; PowerId (simple
 *                     powers block); GameEvent `powerApplied`, `powerRemoved`.
 * #110 Temporary    — PowerId (temporary block); Effect `applyEnemyPower`,
 *                     EnemyState.powers, EnemyPowerId `strengthLossThisTurn`;
 *                     Effect `schedule` + PlayerState.scheduled; Effect
 *                     `setCost` + CardInstance.costThisTurn / costThisCombat;
 *                     Effect `dealDamage` (The Bomb), `enemyLoseHp` (Choking);
 *                     CardDef.costLessPer (Stomp).
 * #111 Conditional  — Effect `conditional`, `repeat`, `attackFrom`,
 *                     `gainBlockFrom`, `growDamage`; CardInstance.damageBonus;
 *                     CardDef.playableIf (Clash); Effect `script` (Perfected Strike).
 * #112 Move/choose  — Effect `moveCards`, `moveSelf`, `upgradeCards`;
 *                     Strategy.choose + ChoiceRequest / ChoiceResponse;
 *                     GameEvent `moved`, `upgraded`.
 * #113 Triggers     — PowerId (trigger powers block); CombatCounters (cards and
 *                     attacks played); GameEvent `play.by`.
 * #114 Play cards   — Effect `playCards`, `addReplay`, `addCards` with source
 *                     `self` / `copyOf`; CardInstance.replay; GameEvent `replay`.
 * #115 Statuses/HP  — Effect `heal`, `gainMaxHp`, `loseMaxHp`; GameEvent `heal`,
 *                     `maxHp`, `enemySkip`; PowerId `intangible`, `gambit`;
 *                     EnemyPowerId `stun`; Condition `fatal` (Feed);
 *                     CardTrigger `drawn` / `turnEndInHand` (curses, statuses).
 * #116 Random gen   — Effect `addCards` with source `random` (CardPool),
 *                     `transformCards`; CardInstance.freeThisTurn / generated;
 *                     GameEvent `generated`, `transformed`; PowerId calamity,
 *                     helloWorld, entropy.
 * #169 Enemy Strength — Effect `enemyGainStrength` (Fight Me!); reuses EnemyState.strength.
 * #104 Rewards       — Effect `gainGold`, `gainPotion`; CombatResult.rewards;
 *                     StrategySummary.avgGold / potionRate (Hand of Greed, Alchemize).
 *
 * Contract map (#215): v1 relics, potions, enemy powers, Void, golden scripting.
 * Same rule: declared, not simulated; validators list the new ids as valid but unsimulated.
 *
 * #203 Enemies      — EnemyDef.startPowers (+ EnemyAscensionOverride.startPowers);
 *                     EnemyPowerId `artifact`, `strengthPerTurn`; GameEvent `negated`.
 *                     Self-buffs reuse `enemyGainStrength`; cards added to the player's
 *                     piles reuse `addCards` (source `card`) on an enemy move.
 * #213 Slippery     — EnemyPowerId `slippery` (via EnemyDef.startPowers).
 * #204 Potions      — PotionDef, GameData.potions; CombatConfig.potions / RunConfig.potions;
 *                     PlayerState.potions; Strategy.usePotion + PotionUse; GameEvent `potion`.
 *                     Strength Potion = `gainStrength`, Fire Potion = `dealDamage`.
 * #205 Relics       — RelicDef (RelicHook list + RelicModifier list + RelicChoice),
 *                     RelicSetup, GameData.relics; CombatConfig.relics / RunConfig.relics;
 *                     PlayerState.relicCounters; GameEvent `relic`, `heal.source`;
 *                     CombatResult.hpLost may be negative + CombatResult.healed;
 *                     StrategySummary.minHpLost; CombatConfig.startHp / RunConfig.startHp.
 * #206 Void         — Effect `loseEnergy` inside CardTrigger `drawn`.
 * #210 Golden       — CombatConfig.startHp, relics, potions, playerStart; Strategy.usePotion
 *                     (potion at a point); Strategy.choose (card choices, already declared).
 *                     Fixture JSON fields stay local to engine/golden/golden.test.ts.
 * #226 Once-per-fight — EnemyMove.oncePerFight (Mawler's Roar); simulated in engine/combat.ts.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Versions, codes, constants
// ---------------------------------------------------------------------------

/** A game patch version string, e.g. "v0.107.1". */
export type GameVersion = string;

/** One-letter character codes used in URLs. */
export type CharacterCode = 'I' | 'S' | 'D' | 'N' | 'R';

export const TURN_CAP = 100;
export const COMBATS_PER_RUN = 10000;
export const MAX_STRATEGIES_PER_RUN = 5;
export const HAND_LIMIT = 10;

export interface IntRange {
  min: number;
  max: number;
}

// ---------------------------------------------------------------------------
// Effects (shared by cards and enemy moves, resolved in list order)
// ---------------------------------------------------------------------------

export type Effect =
  /**
   * Deal `damage` per hit, `hits` times. Strength and modifiers apply per hit.
   * `allEnemies` marks area attacks; with one enemy (v1) it hits that enemy.
   * `xTimes` (X-cost cards only): the attack repeats X times, so total hits =
   * `hits` × (X + `xBonus`), where X is the energy spent on the card and
   * `xBonus` (default 0) covers "X+1 times" upgrades. X = 0 deals no hits.
   */
  | { type: 'attack'; damage: number; hits: number; allEnemies?: boolean; xTimes?: boolean; xBonus?: number }
  | { type: 'gainBlock'; amount: number }
  | { type: 'gainStrength'; amount: number }
  | { type: 'applyVulnerable'; amount: number }
  | { type: 'applyWeak'; amount: number }
  | { type: 'applyFrail'; amount: number }
  /**
   * Apply `amount` Poison to the enemy (cards only; v1 has no Poison on the player).
   * At the start of the enemy's turn, after its Block is removed, it loses HP equal
   * to its Poison (ignores Block, Strength, Weak, Vulnerable), then Poison goes down by 1.
   */
  | { type: 'applyPoison'; amount: number }
  /**
   * Gain `amount` energy now (cards only). Spendable this turn; it does not carry
   * over, since energy is set to energyPerTurn at the start of the next turn.
   */
  | { type: 'gainEnergy'; amount: number }
  /** Regent's Stars resource. Recorded only; not simulated yet. */
  | { type: 'gainStars'; amount: number }
  /**
   * #4 (enemy moves only): Shrink the player: their attacks deal `amount`% less damage
   * (Shrinker Beetle: 30). Applied after every other damage modifier, then rounded down.
   * Does not stack (a second Shrink keeps the larger percent); removed when the enemy
   * that applied it dies (in single-enemy v1 that ends the combat, so it lasts all fight).
   */
  | { type: 'applyShrink'; amount: number }
  // ----- #105 additions below: declared, not simulated yet. -----
  /** #106: the player loses `amount` HP (ignores Block). Counts toward hpLost and can kill (a loss) (#106). */
  | { type: 'loseHp'; amount: number }
  /** #107: draw `amount` cards (same hand-limit rule as the turn-start draw). */
  | { type: 'draw'; amount: number }
  /**
   * #107: draw one card at a time until a stop rule holds. `handFull` (Scrawl):
   * stop when the hand reaches HAND_LIMIT. `stopOn` (Pillage): stop after drawing
   * a card that matches the filter. Also stops when nothing is left to draw.
   */
  | { type: 'drawUntil'; handFull?: boolean; stopOn?: CardFilter }
  /**
   * #108: exhaust cards from `from` (default 'hand'). `count` cards (omit with
   * mode 'all'), picked by `mode`; `upTo` lets the chooser pick fewer (Purity).
   * Only cards matching `filter` qualify; the card being played never does.
   */
  | { type: 'exhaustCards'; from?: PileName; count?: number; mode: SelectMode; upTo?: boolean; filter?: CardFilter }
  /** #109/#113: give the player `amount` of a power (stacks add). Meaning per PowerId below. */
  | { type: 'applyPower'; power: PowerId; amount: number }
  /** #110/#115: give the enemy `amount` of an enemy power (temporary Strength loss, Stun). */
  | { type: 'applyEnemyPower'; power: EnemyPowerId; amount: number }
  /**
   * #110: run `effects` later. `delay` = player turns from now (1 = next turn);
   * `at` = 'turnStart' (default, after draw) or 'turnEnd' (The Bomb). Values are
   * read when the effects run, not when scheduled.
   */
  | { type: 'schedule'; delay: number; at?: 'turnStart' | 'turnEnd'; effects: Effect[] }
  /**
   * #110: fixed damage to the enemy that Strength, Weak and Vigor do not change
   * (The Bomb, Rolling Boulder, Caltrops-style). Block absorbs it. Vulnerable applies only to attack
   * damage from the player or its pets (Osty, v2), so it does not change this (Trent, #245).
   */
  | { type: 'dealDamage'; amount: number; allEnemies?: boolean }
  /** #110: the enemy loses `amount` HP directly (ignores Block and modifiers), like Poison damage. */
  | { type: 'enemyLoseHp'; amount: number }
  /** #169: the enemy gains `amount` Strength (Fight Me!); works like player Strength (`gainStrength` on an enemy move). */
  | { type: 'enemyGainStrength'; amount: number }
  /**
   * #110: set the cost of cards in `piles` to `cost` (Enlightenment) for this
   * turn (CardInstance.costThisTurn) or the rest of combat (costThisCombat).
   * `onlyIfHigher`: only cards whose current cost is above `cost` change.
   */
  | {
      type: 'setCost';
      piles: PileName[];
      cost: number;
      duration: 'turn' | 'combat';
      onlyIfHigher?: boolean;
      filter?: CardFilter;
    }
  /** #111: resolve `then` if the condition holds when reached, otherwise `else`. */
  | { type: 'conditional'; if: Condition; then: Effect[]; else?: Effect[] }
  /**
   * #111: resolve `effects` N times, N = counter value × `times` (default 1),
   * read once before the first repeat (Dominate, Molten Fist, Second Wind).
   */
  | { type: 'repeat'; per: Counter; times?: number; effects: Effect[] }
  /**
   * #111: an attack whose numbers depend on the state. Per hit:
   * `damage` + bonusPer.amount × counter (Bully, Rend, Ashen Strike, Gold Axe,
   * Mind Blast, Body Slam). Hits: `hits` + extraHitsPer.amount × counter
   * (Tear Asunder). Strength and modifiers apply as for `attack`.
   */
  | {
      type: 'attackFrom';
      damage: number;
      hits: number;
      allEnemies?: boolean;
      bonusPer?: PerCounter;
      extraHitsPer?: PerCounter;
    }
  /** #111: gain `amount` + bonusPer.amount × counter Block, as one gain (Expect a Fight, Stack, Entrench, Fisticuffs). */
  | { type: 'gainBlockFrom'; amount: number; bonusPer: PerCounter }
  /**
   * #111: after this card resolves, its attack damage grows by `amount` for the
   * rest of combat (CardInstance.damageBonus). 'self' = this copy (Rampage);
   * 'sameCard' = every copy with the same cardId in all piles (Maul).
   */
  | { type: 'growDamage'; amount: number; scope: 'self' | 'sameCard' }
  /**
   * #112: move cards from one pile to another. `count` cards (omit with mode
   * 'all'), picked by `mode`; `upTo` allows fewer (Neow's Fury). `options`:
   * show only N random qualifying cards and pick from those (Seeker Strike:
   * 1 of 3). `upgrade`: upgrade each moved card (Aggression).
   */
  | {
      type: 'moveCards';
      from: PileName;
      to: CardDestination;
      count?: number;
      mode: SelectMode;
      upTo?: boolean;
      filter?: CardFilter;
      options?: number;
      upgrade?: boolean;
    }
  /** #112: move the played card itself to `to`, now or at the start of next turn (Bolas, Thrumming Hatchet). */
  | { type: 'moveSelf'; to: CardDestination; when: 'now' | 'nextTurnStart' }
  /** #112: upgrade cards in `piles` (Armaments: hand, choose 1 or all; Apotheosis: every pile, all). */
  | { type: 'upgradeCards'; piles: PileName[]; count?: number; mode: SelectMode }
  /**
   * #114: play cards from a pile without paying their cost. `count` cards, or
   * X (+ xBonus) for X-cost cards with `xTimes` (Cascade). `exhaust`: exhaust
   * each played card afterwards instead of discarding it (Havoc).
   */
  | {
      type: 'playCards';
      from: PileName;
      mode: 'top' | 'random';
      count: number;
      xTimes?: boolean;
      xBonus?: number;
      filter?: CardFilter;
      exhaust?: boolean;
    }
  /** #114: `amount` Replay on cards picked from `from` (Hidden Gem: a random draw-pile card without Replay). */
  | { type: 'addReplay'; amount: number; from: PileName; mode: SelectMode; filter?: CardFilter }
  /**
   * #114/#116: create `count` new cards from `source` and put them in `to`.
   * `options`: show N candidates and choose 1 (Discovery, Abundance).
   * `upgraded`: created upgraded. `freeThisTurn` / `costThisCombat`: cost overrides
   * on the new cards (Infernal Blade, Metamorphosis).
   */
  | {
      type: 'addCards';
      source: CardSource;
      count: number;
      to: CardDestination;
      options?: number;
      upgraded?: boolean;
      freeThisTurn?: boolean;
      costThisCombat?: number;
    }
  /** #116: replace cards (Primal Force: all Attacks in hand → Giant Rock; Entropy: 1 random card). */
  | { type: 'transformCards'; from: PileName; count?: number; mode: SelectMode; filter?: CardFilter; into: CardSource }
  /** #115: the player heals `amount` HP, up to Max HP. Every heal counts in full toward hpLost, even past Max HP (#115, #205). */
  | { type: 'heal'; amount: number }
  /** #115: Max HP rises by `amount` (Feed). Current HP rises too, which lowers hpLost (#115, #205). */
  | { type: 'gainMaxHp'; amount: number }
  /** #115: Max HP drops by `amount` (Brightest Flame); HP is capped at the new Max HP. */
  | { type: 'loseMaxHp'; amount: number }
  /** #104: the player gains `amount` gold (Hand of Greed, inside a `fatal` conditional). Reward only; no combat effect. */
  | { type: 'gainGold'; amount: number }
  /** #104: the player gains one Random Potion (Alchemize). Reward only; the potion has no combat effect. */
  | { type: 'gainPotion' }
  /** #206: the player loses `amount` energy now, never below 0 (Void, as a `drawn` trigger). */
  | { type: 'loseEnergy'; amount: number }
  /**
   * One-off card logic the typed effects can't express (Fiend Fire, Thrash,
   * Perfected Strike, Prolong). `id` names a handler in the engine; `values`
   * carries the card's numbers (base or upgraded) so the handler has no magic numbers.
   */
  | { type: 'script'; id: string; values?: number[] };

export type EffectType = Effect['type'];

export type DebuffKind = 'vulnerable' | 'weak' | 'frail';

// ---------------------------------------------------------------------------
// Effect vocabulary (#105)
// ---------------------------------------------------------------------------

/** A card pile. 'draw' is the draw pile; its top is the end of the array. */
export type PileName = 'hand' | 'draw' | 'discard' | 'exhaust';

/** Where a moved or created card goes. 'drawRandom' = a random position in the draw pile. */
export type CardDestination = 'hand' | 'drawTop' | 'drawBottom' | 'drawRandom' | 'discard' | 'exhaust';

/** How cards are picked: by Strategy.choose, at random (seeded Rng), every match, or from the top of the pile. */
export type SelectMode = 'choose' | 'random' | 'all' | 'top';

/** Which cards qualify. Every present field must match; an empty filter matches all. */
export interface CardFilter {
  /** Card type is one of these. */
  types?: CardType[];
  /** Card type is none of these ("non-Attack"). */
  notTypes?: CardType[];
  /** Rarity is one of these (Anointed: rare). Needs CardInstance.rarity. */
  rarity?: CardRarity[];
  /** Card name contains this text ("Strike"). Case-sensitive; the upgraded "+" does not matter (#111, #113). */
  nameIncludes?: string;
  cardId?: string;
  /** false = only cards not yet upgraded (Armaments). */
  upgraded?: boolean;
  /** true = only cards without Replay (Hidden Gem). */
  noReplay?: boolean;
}

/** A number read from the combat state when an effect resolves. */
export type Counter =
  | 'playerBlock'
  | 'playerStrength'
  | 'enemyVulnerable'
  /** Distinct debuffs on the enemy (Rend). Every modelled debuff counts once (#111). */
  | 'enemyUniqueDebuffs'
  | 'handSize'
  | 'drawPileSize'
  | 'discardPileSize'
  | 'exhaustPileSize'
  /** Number of separate HP-loss events this combat (Tear Asunder). Any HP drop; fully blocked hits do not count (#106). */
  | 'hpLossesThisCombat'
  | 'cardsPlayedThisTurn'
  | 'cardsPlayedThisCombat'
  | 'attacksPlayedThisTurn'
  | 'cardsExhaustedThisTurn'
  | 'cardsExhaustedThisCombat'
  /** Cards moved, exhausted, created or upgraded by the previous effect of the same card (Second Wind, Stoke). */
  | 'lastEffectCount'
  /** Damage dealt by the previous attack effect of the same card (Fisticuffs). Counts Block and HP after all modifiers, overkill included (#111). */
  | 'lastAttackDamage';

/** "`amount` for each `per`": adds amount × counter. */
export interface PerCounter {
  per: Counter;
  amount: number;
}

/** A test used by `conditional` effects and CardDef.playableIf. */
export type Condition =
  /** The player lost HP earlier this turn (Spite). */
  | { kind: 'lostHpThisTurn' }
  /** The enemy has at least 1 of this debuff or Poison (Dismantle). */
  | { kind: 'enemyHas'; status: DebuffKind | 'poison' }
  /** min ≤ counter ≤ max (either bound optional): Pact's End, Evil Eye, Restlessness. */
  | { kind: 'counter'; counter: Counter; min?: number; max?: number }
  /** No card in hand (other than the card being played) matches (Impatience: no Attacks). */
  | { kind: 'handHasNone'; filter: CardFilter }
  /** Every card in hand other than this one matches (Clash). */
  | { kind: 'handAll'; filter: CardFilter }
  /** The previous attack effect of this card killed the enemy (Feed). */
  | { kind: 'fatal' };

/** Which cards a random-generation effect draws from. Only simulated cards of the player's own character, no Colorless (#116). */
export interface CardPool {
  /** 'own' = the player's character; 'otherCharacters' = Splash. */
  character?: 'own' | 'colorless' | 'otherCharacters';
  types?: CardType[];
  rarity?: CardRarity[];
  /** Only cards with this printed cost (Jackpot: 0). */
  cost?: number;
}

/** Where `addCards` / `transformCards` get their cards. */
export type CardSource =
  /** A copy of the card being played (Anger). */
  | { kind: 'self' }
  /** A specific card (Primal Force → "giant_rock"). */
  | { kind: 'card'; cardId: string }
  /** Copies of a card picked from a pile (Dual Wield). */
  | { kind: 'copyOf'; from: PileName; mode: SelectMode; filter?: CardFilter }
  /** Random cards from a pool (seeded Rng). */
  | { kind: 'random'; pool: CardPool };

/**
 * A card's own trigger, active while the card is somewhere specific:
 * 'exhausted' (Drum of Battle: when this is exhausted), 'drawn' (Void),
 * 'turnEndInHand' (Burn, Decay, Regret), 'turnEndInExhaust' (Howl from Beyond: play it).
 */
export interface CardTrigger {
  when: 'exhausted' | 'drawn' | 'turnEndInHand' | 'turnEndInExhaust';
  /** Effects to resolve. For Howl from Beyond, `[{ type: 'script', id: 'playSelf' }]` or similar. */
  effects: Effect[];
}

// ---------------------------------------------------------------------------
// Powers (#109, #110, #113, #115, #116)
// ---------------------------------------------------------------------------

/**
 * Player powers, stored in PlayerState.powers as id → amount. A power with
 * amount 0 or absent is off. Meanings (amount in brackets).
 */
export type PowerId =
  // #109 simple powers
  /** Start of turn: gain [amount] Strength (Demon Form). */
  | 'demonForm'
  /** Start of turn: gain [amount] energy (Pyre). */
  | 'energyPerTurn'
  /** Start of turn: deal [amount] damage to ALL enemies, then amount += 5 (Rolling Boulder). */
  | 'rollingBoulder'
  /** Start of turn: lose 1 HP, gain [amount] Block (Crimson Mantle). */
  | 'crimsonMantle'
  /** End of turn: gain [amount] Block; Plating drops by 1 at the start of each turn (#109). */
  | 'plating'
  /** Block is not removed at the start of your turn (Barricade). */
  | 'barricade'
  /** Vulnerable enemies take an extra [amount]% damage (Cruelty). */
  | 'cruelty'
  /** +[amount] Block per Block gain from cards (Prowess, Expertise). */
  | 'dexterity'
  /** Defend cards give [amount] extra Block (Fasten). Only cards named "Defend" (#109). */
  | 'fasten'
  /** When attacked, deal [amount] damage back (Caltrops). */
  | 'thorns'
  /** Start of turn: gain [amount] Vigor (Prep Time). */
  | 'vigorPerTurn'
  /** Next Attack deals +[amount] damage, then Vigor is used up. Applies to every hit of that Attack (#109). */
  | 'vigor'
  /** Powers cost [amount] less (Master of Strategy: Curious). */
  | 'powersCostLess'
  /** End of combat: upgrade a random card (Improvement). No effect inside one combat. */
  | 'upgradeAtCombatEnd'
  /** Skills cost 0; playing a Skill exhausts it (Corruption). */
  | 'corruption'
  // #110 temporary and next-turn powers (cleared at the end of the player's turn unless noted)
  /** Strength gained "this turn"; that much Strength is removed at end of turn (Setup Strike, Feeding Frenzy). */
  | 'strengthThisTurn'
  /** This turn: gain [amount] Block whenever you play an Attack (Rage). */
  | 'rage'
  /** Thorns until your next turn (Flame Barrier). Lasts through the following enemy turn (#110). */
  | 'flameBarrier'
  /** Take 50% less damage from Vulnerable enemies (Colossus). Multiplies with Weak, floored once; lasts the following enemy turn (#110). */
  | 'colossus'
  /** Cannot gain Block from cards for [amount] turns (Panic Button). */
  | 'noBlockFromCards'
  /** Retain the whole hand at the end of this turn (Equilibrium, Salvo). */
  | 'retainHand'
  /** The next [amount] Attacks this combat cost 0 (Unrelenting). */
  | 'freeAttack'
  /** This turn, the next [amount] Attacks are played an extra time (One-Two Punch). */
  | 'doubleAttack'
  /** This turn, the next card played goes on top of the draw pile (Rebound). */
  | 'nextCardToDrawTop'
  /** This turn, the enemy loses [amount] HP whenever you play a card (Master of Strategy: Choking). */
  | 'choking'
  // #107
  /** You cannot draw more cards this turn (Battle Trance). Blocks all further draws that turn (#107). */
  | 'noDraw'
  // #113 trigger powers
  /** Whenever a card is exhausted, draw [amount] (Dark Embrace). */
  | 'darkEmbrace'
  /** Whenever a card is exhausted, gain [amount] Block (Feel No Pain). */
  | 'feelNoPain'
  /** Whenever you lose HP on your turn, gain [amount] Strength (Rupture). */
  | 'rupture'
  /** Start of turn: lose 1 HP. Whenever you lose HP on your turn, deal [amount] damage to ALL enemies (Inferno). */
  | 'inferno'
  /** Whenever you gain Block, deal [amount] damage to a random enemy (Juggernaut). */
  | 'juggernaut'
  /** The first Block gain from a card each turn is doubled (Unmovable). */
  | 'unmovable'
  /** Whenever you apply Vulnerable, draw [amount] (Vicious). */
  | 'vicious'
  /** Every 5th card played in a turn: deal [amount] damage to ALL enemies (Panache). */
  | 'panache'
  /** Every 10 cards drawn: gain [amount] energy (Automation). */
  | 'automation'
  /** Add [amount] copies of the 3rd Attack played each turn into your hand (Juggling). */
  | 'juggling'
  /** Start of turn: move a random Attack from discard to hand and upgrade it (Aggression). */
  | 'aggression'
  /** Drawing a card containing "Strike" plays it (Hellraiser). Any card with Strike in its name (#113). */
  | 'hellraiser'
  /** End of turn: play [amount] random Attack(s) from your hand (Stampede). */
  | 'stampede'
  /** Start of turn: play the top [amount] card(s) of your draw pile (Mayhem). */
  | 'mayhem'
  /** The first Attack or Skill played each turn goes on top of the draw pile (Nostalgia). */
  | 'nostalgia'
  /** Whenever you shuffle your draw pile, choose a card from it to put into your hand (Stratagem). */
  | 'stratagem'
  // #115
  /** Damage taken is reduced to 1 per hit (Apparition). Every enemy hit, and curse/status damage (#115). */
  | 'intangible'
  /** Taking unblocked attack damage loses the combat (The Gambit). Simulated (#115). */
  | 'gambit'
  // #116
  /** Whenever you play an Attack, add a random Attack into your hand (Calamity). */
  | 'calamity'
  /** Start of turn: add a random Common card into your hand (Hello World). */
  | 'helloWorld'
  /** Start of turn: transform [amount] card(s) in your hand (Entropy). */
  | 'entropy';

/** Enemy powers, stored in EnemyState.powers. */
export type EnemyPowerId =
  /** The enemy has [amount] less Strength this turn (Mangle, Dark Shackles). Comes back after the end of the enemy's turn (#110). */
  | 'strengthLossThisTurn'
  /** The enemy skips its next move (Whistle). Its pattern still advances (#115, #148). */
  | 'stun'
  /**
   * #203: each stack negates the next debuff applied to the enemy (the debuff is not applied,
   * one stack is used). Vulnerable, Weak, Frail, Poison, Stun and temporary Strength loss all count (#203).
   */
  | 'artifact'
  /** #203: the enemy gains [amount] Strength each turn (Byrdonis). Gained at the end of the enemy's own turn, after its move (#203). */
  | 'strengthPerTurn'
  /**
   * #213: the next [amount] times the enemy loses HP, it loses only 1 (one stack per loss).
   * Poison and `enemyLoseHp` losses count; a fully blocked hit (0 HP loss) uses no stack (#213).
   */
  | 'slippery';

/** Effects queued by a `schedule` effect. */
export interface ScheduledEffect {
  /** Player turn number on which the effects run. */
  turn: number;
  at: 'turnStart' | 'turnEnd';
  effects: Effect[];
  /** uid of the card that scheduled them, for the log. */
  sourceUid?: number;
}

/** Per-combat tallies used by conditions, counters and trigger powers. "This turn" fields reset at the player's turn start. */
export interface CombatCounters {
  /** HP lost this turn (amount). */
  hpLostThisTurn: number;
  /** HP lost this combat (amount). */
  hpLostThisCombat: number;
  /** Number of HP-loss events this combat (Tear Asunder). */
  hpLossesThisCombat: number;
  cardsPlayedThisTurn: number;
  cardsPlayedThisCombat: number;
  attacksPlayedThisTurn: number;
  skillsPlayedThisTurn: number;
  cardsExhaustedThisTurn: number;
  cardsExhaustedThisCombat: number;
  cardsDrawnThisTurn: number;
  cardsDrawnThisCombat: number;
}

// ---------------------------------------------------------------------------
// Potions (#204) and relics (#205)
// ---------------------------------------------------------------------------

/**
 * #204: a potion. Using one resolves `effects` as if a card played them (enemy-targeted effects
 * hit the enemy; Strength Potion `gainStrength` 2, Fire Potion `dealDamage` 20), costs no energy,
 * does not count as a card played, and removes it from its slot. Data in data/potions/.
 */
export interface PotionDef {
  id: string;
  /** Permanent two-character URL code. Never reused. */
  code: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'event';
  /** A character-specific potion, or 'any'. */
  character: CharacterCode | 'any';
  effects: Effect[];
  description: string;
  simulated: boolean;
  lastUpdateVersion: GameVersion;
}

/**
 * #205: when a relic hook fires. 'combatStart' = before the first draw; 'turnStart' = after the
 * player's draw; 'turnEnd' = at the end of the player's turn; 'combatEnd' = after a win (Burning
 * Blood); 'cardPlayed' = after a card resolves.
 */
export type RelicWhen = 'combatStart' | 'turnStart' | 'turnEnd' | 'combatEnd' | 'cardPlayed';

/**
 * #205: one relic effect. Every present field must hold for the hook to fire:
 * `turn` = only on this player turn (Anchor-style 1, Horn Cleat 2, Stone Calendar 7);
 * `everyTurns` = every Nth turn (Happy Flower 3); `everyCards` = every Nth card played that
 * matches `filter` this combat (Iron Club 4; Ornamental Fan 3 Attacks), counted in
 * PlayerState.relicCounters. `amountFromChoice`: every `amount` in `effects` is replaced by the
 * value chosen in setup (Girya). Effects resolve as for a card the player plays.
 */
export interface RelicHook {
  when: RelicWhen;
  turn?: number;
  everyTurns?: number;
  everyCards?: number;
  filter?: CardFilter;
  amountFromChoice?: boolean;
  effects: Effect[];
}

/**
 * #205: a standing rule a relic adds, for what hooks can't express (amount in brackets):
 * 'energyPerTurn' / 'drawPerTurn' [+N each turn] (Sozu, Velvet Choker, Snecko Eye);
 * 'cardDamageBonus' [+N per hit on cards matching `filter`] (Strike Dummy);
 * 'hpLossReduce' [lose N less HP per loss] (Tungsten Rod); 'hpLossCapPerTurn' [N] (Beating Remnant);
 * 'minUnblockedAttack' [unblocked attack damage of 1..N-1 becomes N] (The Boot);
 * 'conserveEnergy' (Ice Cream); 'keepHand' [hand is not discarded at turn end] (Runic Pyramid);
 * 'cardsPerTurnLimit' [N] (Velvet Choker); 'xBonus' [X-cost cards get X+N] (Chemical X);
 * 'dexterityWithoutPotions' [N] (Belt Buckle); 'noPotions' (Sozu); 'script' = one-off
 * engine handler `id` (Bellows, Ghost Seed, Snecko Eye's cost shuffle). Exact relic text: main release.
 */
export interface RelicModifier {
  kind:
    | 'energyPerTurn'
    | 'drawPerTurn'
    | 'cardDamageBonus'
    | 'hpLossReduce'
    | 'hpLossCapPerTurn'
    | 'minUnblockedAttack'
    | 'conserveEnergy'
    | 'keepHand'
    | 'cardsPerTurnLimit'
    | 'xBonus'
    | 'dexterityWithoutPotions'
    | 'noPotions'
    | 'script';
  amount?: number;
  filter?: CardFilter;
  /** Handler name, only with kind 'script'. */
  id?: string;
}

/** #205: a value picked when the relic is selected (Girya: Strength 1, 2 or 3). */
export interface RelicChoice {
  label: string;
  values: number[];
  default: number;
}

/**
 * #205: a relic. Starting buffs are combatStart hooks reusing existing effects and powers
 * (Vajra `gainStrength` 1, Gorget `applyPower` plating 4, Bronze Scales thorns, Oddly Smooth
 * Stone dexterity, Akabeko vigor, Bag of Marbles `applyVulnerable`, Blood Vial `heal` 2);
 * Burning Blood is a combatEnd `heal` 6. Data in data/relics/.
 */
export interface RelicDef {
  id: string;
  /** Permanent two-character URL code. Never reused. */
  code: string;
  name: string;
  rarity: 'starter' | 'common' | 'uncommon' | 'rare' | 'shop' | 'boss' | 'ancient' | 'event';
  /** A character-specific relic, or 'any'. */
  character: CharacterCode | 'any';
  hooks: RelicHook[];
  modifiers?: RelicModifier[];
  choice?: RelicChoice;
  description: string;
  simulated: boolean;
  lastUpdateVersion: GameVersion;
}

/** #205: a relic picked for a run, with its setup choice when it has one (Girya). */
export interface RelicSetup {
  relicId: string;
  choice?: number;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type CardType = 'attack' | 'skill' | 'power' | 'status' | 'curse' | 'quest';

export type CardRarity =
  'basic' | 'common' | 'uncommon' | 'rare' | 'ancient' | 'event' | 'token' | 'status' | 'curse' | 'quest';

/** Engine-simulated keywords: unplayable, ethereal, eternal, exhaust, retain, innate. `sly` is recorded only. */
export type CardKeyword = 'unplayable' | 'ethereal' | 'eternal' | 'exhaust' | 'retain' | 'innate' | 'sly';

/**
 * What changes when a card is upgraded. Omitted fields keep the base value;
 * present fields (effects, keywords) replace the base list wholesale.
 */
export interface CardUpgrade {
  cost?: number;
  starCost?: number;
  effects?: Effect[];
  keywords?: CardKeyword[];
  /** #105: replaces the base `triggers` list when present (Drum of Battle+). */
  triggers?: CardTrigger[];
}

export interface CardDef {
  /** Stable internal id, e.g. "strike". */
  id: string;
  /** Permanent two-character, case-sensitive URL code, e.g. "St". Never reused. */
  code: string;
  name: string;
  type: CardType;
  /** "shared": basic cards every character uses (Strike, Defend). */
  character: CharacterCode | 'colorless' | 'shared';
  rarity: CardRarity;
  /** Energy cost. `null` exactly when keywords include "unplayable". X-cost cards use 0 with `xCost: true`. */
  cost: number | null;
  xCost: boolean;
  /** Regent Stars cost; `null` when the card has none. */
  starCost: number | null;
  /** True when the Star cost is X (spend all Stars); then `starCost` is 0. */
  xStarCost?: boolean;
  keywords: CardKeyword[];
  /**
   * Structured effects in order. Complete when `simulated` is true; may be partial
   * (or empty) otherwise, holding whatever the effect vocabulary can express.
   */
  effects: Effect[];
  /** `null` when the card cannot be upgraded. */
  upgraded: CardUpgrade | null;
  /** Card text as shown in game, base version. Energy shown as "[E]", Stars as "[STAR]". */
  description: string;
  /** Upgraded card text; `null` when the card cannot be upgraded. */
  upgradedDescription: string | null;
  /**
   * True only when `effects` and keywords fully capture the card (base and upgraded)
   * using mechanics the engine implements. Unsimulated cards can't be put in a deck.
   */
  simulated: boolean;
  multiplayerOnly: boolean;
  /** Placeholder entry that is kept as data but never offered in the deck builder. */
  hidden?: boolean;
  /** #108/#115: the card's own triggers (Drum of Battle, Howl from Beyond, curses, statuses). Not simulated yet. */
  triggers?: CardTrigger[];
  /** #111: the card can be played only while this holds (Clash). Not simulated yet. */
  playableIf?: Condition;
  /** #110: costs `amount` less per counter value, minimum 0 (Stomp: per Attack played this turn). Not simulated yet. */
  costLessPer?: PerCounter;
  /** #137: most copies a deck may hold, Standard and Upgraded combined. Absent means no limit. */
  maxCopies?: number;
  /** Game version this entry was last checked against. */
  lastUpdateVersion: GameVersion;
}

/** One line of a deck: N copies of a card, upgraded or not. */
export interface DeckEntry {
  cardId: string;
  upgraded: boolean;
  count: number;
}

export type Deck = DeckEntry[];

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface CharacterDef {
  id: string;
  code: CharacterCode;
  name: string;
  maxHp: number;
  energyPerTurn: number;
  drawPerTurn: number;
  startingDeck: Deck;
  /** Relic name (e.g. "Burning Blood"). Informational until #205 matches it to a RelicDef. */
  startingRelic: string;
  lastUpdateVersion: GameVersion;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

/** Act 1: overgrowth or underdocks; Act 2: hive; Act 3: glory. */
export type Zone = 'overgrowth' | 'underdocks' | 'hive' | 'glory';
export type EnemyDifficulty = 'easy' | 'normal' | 'elite' | 'boss' | 'minion' | 'event';

export interface EnemyMove {
  name: string;
  effects: Effect[];
  /** #226: the move can be used at most once per fight (Mawler's Roar); the picker never chooses it again. */
  oncePerFight?: boolean;
}

export interface CyclePattern {
  type: 'cycle';
  /** Move ids, played in this order and repeated. */
  order: string[];
  /** "first" starts at order[0]; "random" picks a seeded random start. */
  start: 'first' | 'random';
  /** #4: move ids played once, in this order, before the cycle starts (Shrinker Beetle: Shrinker). */
  opener?: string[];
}

/**
 * #4: each turn the enemy picks one of `moves` at random (seeded Rng, equally likely).
 * The pick is made as soon as the previous move ends (at combat start for the first one),
 * so the player sees it as the intent.
 */
export interface RandomPattern {
  type: 'random';
  /** Move ids to pick from. */
  moves: string[];
  /** true: never the same move twice in a row. The last opener move counts as the previous move. */
  noRepeat: boolean;
  /** Move ids played once, in this order, before random picks start (Sludge Spinner: Oil Spray). */
  opener?: string[];
}

export type MovePattern = CyclePattern | RandomPattern;

/**
 * Overrides for one Ascension level. Levels are cumulative: at A9 the engine
 * applies every override at or below 9, in ascending order. A move override
 * replaces that move's whole effect list.
 */
export interface EnemyAscensionOverride {
  hp?: IntRange;
  moves?: Record<string, { effects: Effect[] }>;
  pattern?: MovePattern;
  /** #203: replaces EnemyDef.startPowers from this level (Vantom: 9 Slippery). */
  startPowers?: Partial<Record<EnemyPowerId, number>>;
}

export interface EnemyDef {
  id: string;
  /** Permanent two-character URL code, e.g. "Nb". */
  code: string;
  name: string;
  act: number;
  zone: Zone;
  difficulty: EnemyDifficulty;
  /** Rolled per combat, inclusive. */
  hp: IntRange;
  moves: Record<string, EnemyMove>;
  pattern: MovePattern;
  /** Keyed by Ascension level as a string ("8", "9"). */
  ascension: Record<string, EnemyAscensionOverride>;
  /** #203/#213: powers the enemy starts combat with (Cubex Construct: 1 artifact; Vantom: 8 slippery). */
  startPowers?: Partial<Record<EnemyPowerId, number>>;
  source: string;
  lastUpdateVersion: GameVersion;
}

// ---------------------------------------------------------------------------
// Manifest and loaded game data
// ---------------------------------------------------------------------------

export interface Manifest {
  /** Current game version, stamped on every simulation result. */
  gameVersion: GameVersion;
  /** Cards added to every starting deck at or above an Ascension level. */
  ascensionCards: { level: number; cardId: string }[];
}

export interface GameData {
  manifest: Manifest;
  cards: Record<string, CardDef>;
  enemies: Record<string, EnemyDef>;
  characters: Record<string, CharacterDef>;
  /** #205: absent until relic data exists. */
  relics?: Record<string, RelicDef>;
  /** #204: absent until potion data exists. */
  potions?: Record<string, PotionDef>;
}

// ---------------------------------------------------------------------------
// Combat state
// ---------------------------------------------------------------------------

/**
 * A card in combat, resolved at setup (upgrade applied), so strategies never
 * need to look up definitions.
 */
export interface CardInstance {
  /** Unique within one combat. */
  uid: number;
  cardId: string;
  name: string;
  type: CardType;
  upgraded: boolean;
  /** Effective cost; `null` if unplayable. X-cost cards have cost 0 and `xCost: true`. */
  cost: number | null;
  /** Present and true for X-cost cards: playing one spends all energy, X = energy spent. */
  xCost?: boolean;
  keywords: CardKeyword[];
  effects: Effect[];
  // ----- #105 additions: all optional; absent means "no change". -----
  /** #110: cost for the rest of this turn only; overrides `cost` and `costThisCombat`. Cleared at end of turn. */
  costThisTurn?: number;
  /** #110/#116: cost for the rest of combat (Enlightenment+, Metamorphosis); overrides `cost`. */
  costThisCombat?: number;
  /** #116: costs 0 for the rest of this turn (Infernal Blade, Discovery). Cleared at end of turn. */
  freeThisTurn?: boolean;
  /** #114: Replay stacks: the card is played that many extra times each time it is played. It is never used up unless something says so (Trent #114 Q1). */
  replay?: number;
  /** #111: extra damage per hit gained in combat (Rampage, Maul, Thrash). */
  damageBonus?: number;
  /** #116: true for cards created during combat rather than dealt from the deck. */
  generated?: boolean;
  /** #112: the card's rarity, for filters (Anointed). */
  rarity?: CardRarity;
  /** Copied from CardDef / CardUpgrade (see there). */
  triggers?: CardTrigger[];
  playableIf?: Condition;
  costLessPer?: PerCounter;
}

export type Debuffs = Record<DebuffKind, number>;

export interface PlayerState {
  hp: number;
  maxHp: number;
  block: number;
  energy: number;
  strength: number;
  debuffs: Debuffs;
  drawPile: CardInstance[];
  hand: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
  // ----- #105 additions: all optional; absent means none / zero. -----
  /** #109/#110/#113/#115/#116: active powers, id → amount. */
  powers?: Partial<Record<PowerId, number>>;
  /** #106/#107/#108/#113: per-turn and per-combat tallies. */
  counters?: CombatCounters;
  /** #110: effects waiting for a later turn (Outmaneuver, Relax, Toric Toughness, The Bomb, Bolas). */
  scheduled?: ScheduledEffect[];
  /** #4: Shrink percent: the player's attacks deal this much % less damage. Absent or 0 means none. */
  shrink?: number;
  // ----- #215 additions. -----
  /** #204: potion slots, potion id or null once used. Absent means no potions. */
  potions?: (string | null)[];
  /** #205: per-relic tallies (cards played toward Iron Club, etc.), relic id → count. */
  relicCounters?: Record<string, number>;
}

export interface EnemyState {
  enemyId: string;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  strength: number;
  debuffs: Debuffs;
  /** Poison stacks. Not a tick-down debuff: it drops by 1 only after dealing its damage. */
  poison: number;
  /** Index into the resolved cycle pattern's `order` (opener moves don't advance it; 0 for random patterns). */
  patternIndex: number;
  /** #4: moves the enemy has made so far (opener moves come first). Absent means 0. */
  movesMade?: number;
  /** #4: the move id the enemy makes on its next turn (its intent). Set by the engine for every pattern. */
  nextMoveId?: string;
  /** #110/#115: enemy powers (temporary Strength loss, Stun), id → amount. Absent means none. */
  powers?: Partial<Record<EnemyPowerId, number>>;
}

export interface CombatState {
  turn: number;
  player: PlayerState;
  enemy: EnemyState;
}

/** What the enemy will do this turn, as the player sees it. */
export interface EnemyIntent {
  moveId: string;
  name: string;
  /** One entry per attack effect, in order; empty on non-attack turns. */
  attacks: { damagePerHit: number; hits: number }[];
  /** Sum of damagePerHit × hits over all attacks; 0 on non-attack turns. */
  totalIncoming: number;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Everything a strategy may look at. It must not mutate anything. */
export interface StrategyView {
  state: DeepReadonly<CombatState>;
  intent: EnemyIntent;
  /** Cards in hand that are playable right now (affordable, not unplayable). */
  playable: readonly DeepReadonly<CardInstance>[];
}

export type Decision = { kind: 'play'; uid: number } | { kind: 'endTurn' };

/** #204: use the potion in PlayerState.potions[slot]. */
export interface PotionUse {
  slot: number;
}

/**
 * #108/#112/#114/#116: a "choose a card" prompt the engine sends to Strategy.choose.
 * `options` are the candidate cards (from a pile, or newly created for
 * Discovery-style picks). The response must pick between `min` and `max` of them.
 */
export interface ChoiceRequest {
  /** What the pick is for. */
  purpose: 'exhaust' | 'move' | 'upgrade' | 'copy' | 'generate' | 'transform' | 'replay';
  /** The card whose effect asks, or absent when a power asks (Stratagem). */
  sourceUid?: number;
  sourceCardId?: string;
  /** The power that asks, when a power asks. */
  sourcePower?: PowerId;
  /** Pile the options come from; absent for newly created options. */
  from?: PileName;
  /** Where picked cards go, when they move. */
  to?: CardDestination;
  options: readonly DeepReadonly<CardInstance>[];
  min: number;
  max: number;
}

/** The uids picked, from `ChoiceRequest.options`, in order of preference. */
export interface ChoiceResponse {
  uids: number[];
}

/** Called repeatedly during the player's turn until it returns endTurn. */
export interface Strategy {
  decide(view: StrategyView): Decision;
  /**
   * #105: answer a "choose a card" prompt. Optional: without it, generate/move/upgrade picks use the
   * priority list (`chooseGenerated`) and other picks the shared exhaust order (`chooseExhaust`)
   * (#108, #112). Every built-in strategy has `choose`.
   */
  choose?(view: StrategyView, request: ChoiceRequest): ChoiceResponse;
  /**
   * #204/#210: asked before each `decide`; return a potion to use now, or null. Optional: a
   * strategy without it never uses potions. Strength Potion: turn 1 before anything else; Fire
   * Potion: when it does the most (after Slippery is gone, or to kill) (#204).
   */
  usePotion?(view: StrategyView): PotionUse | null;
}

/** #130: the card groups a strategy puts in priority order. */
export type StrategyGroup = 'attack' | 'block' | 'powers';

/**
 * #130: serializable strategy settings. A strategy is a user-ordered priority of the three
 * groups; each decision walks `order` (first = highest priority) and plays from the first group
 * that has something to play (engine/strategies.ts has the per-group rules).
 *
 * URL code: the order as letters a/b/p, with X right after "b" unless Block is last
 * ("apb", "b5pa", "pb5a"). Old codes still parse: "g" = "apb", "b<X>" = "b<X>pa".
 */
export interface StrategyConfig {
  /** 'attack', 'block' and 'powers', each exactly once. */
  order: StrategyGroup[];
  /**
   * Block group: play block while (incoming − Block) > allowThrough, then move on. A whole number
   * 0–9999. When Block is last it is unused (Block then spends leftover energy) and always 0.
   */
  allowThrough: number;
}

export type StrategyColor = 'blue' | 'green' | 'yellow' | 'red' | 'purple';

export interface SavedStrategy {
  id: string;
  name: string;
  config: StrategyConfig;
}

/** A strategy selected for one run, with its color for that run (unique per run). */
export interface RunStrategy {
  strategy: SavedStrategy;
  color: StrategyColor;
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export type Side = 'player' | 'enemy';

export type GameEvent =
  | { t: 'combatStart'; seed: number; enemyHp: number; playerHp: number }
  | { t: 'shuffle'; reason: 'start' | 'reshuffle'; count: number }
  | { t: 'turnStart'; turn: number; side: Side }
  | { t: 'draw'; uid: number; cardId: string }
  /**
   * `x` is present for X-cost cards: the energy spent on it.
   * #113/#114: `by` is present when the card was played automatically rather than
   * by the strategy: 'effect' (Havoc, Cascade), 'power' (Mayhem, Hellraiser), 'replay', 'trigger' (Howl from Beyond).
   */
  | {
      t: 'play';
      uid: number;
      cardId: string;
      energyLeft: number;
      x?: number;
      by?: 'effect' | 'power' | 'replay' | 'trigger';
    }
  /** The player gained energy from a card. */
  | { t: 'energy'; amount: number; total: number }
  | { t: 'damage'; source: Side; target: Side; amount: number; blocked: number; hpLoss: number }
  | { t: 'block'; side: Side; amount: number; total: number }
  | { t: 'blockReset'; side: Side }
  | { t: 'strength'; side: Side; amount: number; total: number }
  | { t: 'debuff'; side: Side; kind: DebuffKind; amount: number; total: number }
  | { t: 'debuffTick'; side: Side; kind: DebuffKind; total: number }
  /** Poison applied to the enemy. */
  | { t: 'poison'; amount: number; total: number }
  /** #4: the player is Shrunk: attacks deal `percent`% less damage (`percent` after the no-stack rule). */
  | { t: 'shrink'; percent: number }
  /** Poison HP loss at the start of the enemy's turn; Poison is then amount − 1. */
  | { t: 'poisonDamage'; amount: number; hpAfter: number }
  /** #108: 'effect' = exhausted by a card effect (Burning Pact, Havoc); 'power' = by a power (Corruption). */
  | { t: 'exhaust'; uid: number; cardId: string; reason: 'ethereal' | 'keyword' | 'effect' | 'power' }
  | { t: 'discard'; uid: number; cardId: string; reason: 'endOfTurn' | 'handLimit' }
  | { t: 'enemyMove'; moveId: string; name: string }
  | { t: 'turnEnd'; turn: number; side: Side }
  | { t: 'combatEnd'; outcome: Outcome; turns: number; hpLost: number }
  // ----- #105 additions: not emitted yet. -----
  /** #106: `side` lost HP not from an attack (Hemokinesis, Crimson Mantle, curses). Poison keeps `poisonDamage`. */
  | { t: 'loseHp'; side: Side; amount: number; hpAfter: number }
  /** #115: the player healed. `amount` is the HP actually restored. #205: `source` = relic id when a relic healed. */
  | { t: 'heal'; amount: number; hpAfter: number; source?: string }
  /** #115: the player's Max HP changed by `amount` (negative for a loss). */
  | { t: 'maxHp'; amount: number; maxHpAfter: number; hpAfter: number }
  /** #109/#110: a power on `side` changed by `amount` (negative to reduce); `total` after. */
  | { t: 'powerApplied'; side: Side; power: PowerId | EnemyPowerId; amount: number; total: number }
  /** #109/#110: a power on `side` ended (expired or used up). */
  | { t: 'powerRemoved'; side: Side; power: PowerId | EnemyPowerId }
  /** #112: a card moved between piles. */
  | { t: 'moved'; uid: number; cardId: string; from: PileName; to: CardDestination }
  /** #114/#116: a new card was created (`uid` is new) and put in `to`. */
  | { t: 'generated'; uid: number; cardId: string; to: CardDestination; source: CardSource['kind'] }
  /** #112: a card was upgraded for the rest of combat. */
  | { t: 'upgraded'; uid: number; cardId: string }
  /** #116: a card became another card (same uid). */
  | { t: 'transformed'; uid: number; fromCardId: string; toCardId: string }
  /** #110: a card's cost changed. */
  | { t: 'costChanged'; uid: number; cardId: string; cost: number; duration: 'turn' | 'combat' }
  /** #114: a card was played again by Replay; `left` = Replay remaining. */
  | { t: 'replay'; uid: number; cardId: string; left: number }
  /** #115: the enemy skipped its move. */
  | { t: 'enemySkip'; reason: 'stun' }
  // ----- #215 additions: not emitted yet. -----
  /** #203: Artifact negated a debuff on `side`; `left` = Artifact remaining. */
  | { t: 'negated'; side: Side; status: DebuffKind | EnemyPowerId | 'poison'; left: number }
  /** #204: the player used the potion in `slot`. */
  | { t: 'potion'; potionId: string; slot: number }
  /** #205: a relic hook or modifier took effect. */
  | { t: 'relic'; relicId: string };

// ---------------------------------------------------------------------------
// Running combats
// ---------------------------------------------------------------------------

export type Outcome = 'win' | 'loss' | 'turnCap';

export interface CombatConfig {
  characterId: string;
  /** The player's deck before Ascension additions. */
  deck: Deck;
  enemyId: string;
  ascension: number;
  strategy: StrategyConfig;
  seed: number;
  // ----- #215 additions: all optional; absent means the current behaviour. -----
  /** #205/#210: HP at the start of combat (below Max HP); absent = Max HP. */
  startHp?: number;
  /** #205: relics in play. */
  relics?: RelicSetup[];
  /** #204: potion ids in slot order. */
  potions?: string[];
  /** #210: statuses the player starts with (golden fixtures). */
  playerStart?: { strength?: number; debuffs?: Partial<Debuffs>; powers?: Partial<Record<PowerId, number>> };
}

export interface CombatResult {
  seed: number;
  outcome: Outcome;
  /** Player turns taken. */
  turns: number;
  /**
   * Max HP − final HP, measured before any end-of-combat healing. #205 (Trent): becomes start HP −
   * final HP after all healing, end-of-combat relic heals included, and may go negative
   * (lose 5, heal 8 → −3). Heals may exceed the damage taken in the simulation.
   */
  hpLost: number;
  /** #205: total HP actually healed this combat (cards and relics); omitted when 0. */
  healed?: number;
  /** Enemy HP at the end (0 on a win); useful for turn-cap analysis. */
  enemyHpRemaining: number;
  /** #104: gold and potions gained during the combat; omitted when nothing was gained. */
  rewards?: { gold: number; potions: number };
  /** Present only when requested (log viewer); omitted in bulk runs. */
  log?: GameEvent[];
}

/** Engine entry point, implemented in engine/combat.ts. */
export type RunCombat = (data: GameData, config: CombatConfig, options?: { log?: boolean }) => CombatResult;

export interface RunConfig {
  characterId: string;
  deck: Deck;
  enemyId: string;
  ascension: number;
  strategies: RunStrategy[];
  /** #205: HP at the start of each combat; absent = Max HP. */
  startHp?: number;
  /** #205: relics in play. */
  relics?: RelicSetup[];
  /** #204: potion ids in slot order (refilled for every combat). */
  potions?: string[];
  /** Per-combat seeds are derived from this, identical across strategies. */
  runSeed: number;
}

export interface StrategySummary {
  strategyId: string;
  combats: number;
  avgHpLost: number;
  /** Over wins only; null if there were no wins. */
  avgTurnsToKill: number | null;
  /** Mean combat length in turns over ALL combats (wins, losses, turn-cap fights at full length); 0 for none. */
  avgTurns: number;
  /** #104: mean gold gained per combat (over all combats). */
  avgGold: number;
  /** #104: fraction of combats in which at least one potion was gained, in [0, 1]. */
  potionRate: number;
  deathRate: number;
  turnCapRate: number;
  /** hpLostCounts[n] = number of combats that lost exactly n HP (n + minHpLost when that is set). */
  hpLostCounts: number[];
  /** #205: when HP lost can be negative, the HP lost counted by hpLostCounts[0] (≤ 0). Absent = 0. */
  minHpLost?: number;
  /**
   * firstCombatByHpLost[n] = the lowest 0-based combat index that lost exactly n HP.
   * Has a key only for HP values that occurred (the non-zero entries of hpLostCounts).
   */
  firstCombatByHpLost: Record<number, number>;
}

export interface RunResult {
  gameVersion: GameVersion;
  config: RunConfig;
  summaries: StrategySummary[];
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** Seeded RNG. Every random choice in a combat goes through one of these. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Fisher–Yates shuffle in place; returns the same array. */
  shuffle<T>(items: T[]): T[];
}
