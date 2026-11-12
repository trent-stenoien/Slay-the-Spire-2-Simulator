/** Allowed values for game-data fields, kept in step with the engine contract. */
import type { Counter, EffectType, EnemyPowerId, PowerId } from '../../engine/types';

export const CARD_TYPES = ['attack', 'skill', 'power', 'status', 'curse', 'quest'] as const;

export const CARD_RARITIES = [
  'basic',
  'common',
  'uncommon',
  'rare',
  'ancient',
  'event',
  'token',
  'status',
  'curse',
  'quest',
] as const;

export const CARD_KEYWORDS = ['unplayable', 'ethereal', 'eternal', 'exhaust', 'retain', 'innate', 'sly'] as const;

/** Keywords and effects the engine implements; a `simulated` card may use only these. */
export const SIMULATED_KEYWORDS = new Set(['unplayable', 'ethereal', 'eternal', 'exhaust', 'innate', 'retain']);

/**
 * #105 contract effects: valid data. Each mechanic card (#106–#116) moves its effects into
 * SIMULATED_CONTRACT_EFFECTS when the engine supports them; the rest are not simulated yet.
 */
export const CONTRACT_EFFECTS = [
  'loseHp',
  'draw',
  'drawUntil',
  'exhaustCards',
  'applyPower',
  'applyEnemyPower',
  'schedule',
  'dealDamage',
  'enemyLoseHp',
  'setCost',
  'conditional',
  'repeat',
  'attackFrom',
  'gainBlockFrom',
  'growDamage',
  'moveCards',
  'moveSelf',
  'upgradeCards',
  'playCards',
  'addReplay',
  'addCards',
  'transformCards',
  'heal',
  'gainMaxHp',
  'loseMaxHp',
  'gainGold',
  'gainPotion',
  'script',
] as const;

/**
 * Contract effects the engine simulates: #106 loseHp, #107 draw and drawUntil, #108 exhaustCards,
 * #116 addCards, transformCards, #115 heal, gainMaxHp, loseMaxHp, #104 gainGold / gainPotion, #110 schedule (with simulated inner effects),
 * dealDamage, enemyLoseHp, setCost.  `applyEnemyPower` (stun, strengthLossThisTurn) and `conditional` (`fatal` only)
 * are checked by field in data/validate/cards.ts.
 */
export const SIMULATED_CONTRACT_EFFECTS = new Set<string>([
  'loseHp',
  'draw',
  'drawUntil',
  'exhaustCards',
  'addCards',
  'transformCards',
  'heal',
  'gainMaxHp',
  'loseMaxHp',
  'gainGold',
  'gainPotion',
  // #110
  'schedule',
  'dealDamage',
  'enemyLoseHp',
  'setCost',
]);

/** #110/#115: enemy powers the engine simulates (Stun, temporary Strength loss). */
export const SIMULATED_ENEMY_POWERS = new Set<string>(['stun', 'strengthLossThisTurn']);

/**
 * #108: `repeat` stays unsimulated in general (#111), but a simulated card may repeat "for each
 * card Exhausted" (Second Wind) with these counters.
 */
export const SIMULATED_REPEAT_COUNTERS = new Set<string>(['lastEffectCount', 'handSize']);

/** #108: `script` ids the engine runs (Fiend Fire, Thrash); other scripts are not simulated yet. */
export const SIMULATED_SCRIPTS = new Set<string>(['fiendFire', 'thrash', 'primalForcePlus', 'prolong']);

/** Card triggers the engine runs (#108 exhausted, #115 drawn and turnEndInHand); turnEndInExhaust waits for #114. */
export const SIMULATED_TRIGGERS = new Set<string>(['exhausted', 'drawn', 'turnEndInHand']);

export const UNSIMULATED_EFFECTS = new Set<string>(
  ['gainStars', ...CONTRACT_EFFECTS].filter((t) => !SIMULATED_CONTRACT_EFFECTS.has(t)),
);

/**
 * Powers the engine simulates (engine/combat.ts SIMULATED_POWER_IDS); a simulated card may apply
 * only these: #107 noDraw (Battle Trance), the #109 simple powers and the #110 temporary powers.
 * Trigger powers (#113, #116) are not simulated yet.
 */
export const SIMULATED_POWERS = new Set<string>([
  'noDraw',
  'demonForm',
  'energyPerTurn',
  'rollingBoulder',
  'crimsonMantle',
  'plating',
  'barricade',
  'cruelty',
  'dexterity',
  'fasten',
  'thorns',
  'vigorPerTurn',
  'vigor',
  'powersCostLess',
  'upgradeAtCombatEnd',
  'corruption',
  'calamity',
  'helloWorld',
  'entropy',
  'intangible',
  'gambit',
  // #110 temporary and next-turn powers
  'strengthThisTurn',
  'rage',
  'flameBarrier',
  'colossus',
  'noBlockFromCards',
  'retainHand',
  'freeAttack',
  'doubleAttack',
  'nextCardToDrawTop',
  'choking',
]);

/** CardFilter fields the engine matches on (#107 Pillage's `stopOn`, #108 exhaust filters); others are not simulated yet. */
export const SIMULATED_FILTER_FIELDS = new Set<string>(['types', 'notTypes', 'cardId', 'upgraded']);

/** CardDef fields from #105 that the engine does not simulate yet (`triggers`: see SIMULATED_TRIGGERS; `costLessPer`: see SIMULATED_COST_COUNTERS). */
export const UNSIMULATED_CARD_FIELDS = ['playableIf'] as const;

/** #110: the counters `costLessPer` may use on a simulated card (Stomp: Attacks played this turn). */
export const SIMULATED_COST_COUNTERS = new Set<string>(['attacksPlayedThisTurn']);

export const PILES = ['hand', 'draw', 'discard', 'exhaust'] as const;

export const DESTINATIONS = ['hand', 'drawTop', 'drawBottom', 'drawRandom', 'discard', 'exhaust'] as const;

export const SELECT_MODES = ['choose', 'random', 'all', 'top'] as const;

export const COUNTERS = [
  'playerBlock',
  'playerStrength',
  'enemyVulnerable',
  'enemyUniqueDebuffs',
  'handSize',
  'drawPileSize',
  'discardPileSize',
  'exhaustPileSize',
  'hpLossesThisCombat',
  'cardsPlayedThisTurn',
  'cardsPlayedThisCombat',
  'attacksPlayedThisTurn',
  'cardsExhaustedThisTurn',
  'cardsExhaustedThisCombat',
  'lastEffectCount',
  'lastAttackDamage',
] as const;

export const POWER_IDS = [
  'demonForm',
  'energyPerTurn',
  'rollingBoulder',
  'crimsonMantle',
  'plating',
  'barricade',
  'cruelty',
  'dexterity',
  'fasten',
  'thorns',
  'vigorPerTurn',
  'vigor',
  'powersCostLess',
  'upgradeAtCombatEnd',
  'corruption',
  'strengthThisTurn',
  'rage',
  'flameBarrier',
  'colossus',
  'noBlockFromCards',
  'retainHand',
  'freeAttack',
  'doubleAttack',
  'nextCardToDrawTop',
  'choking',
  'noDraw',
  'darkEmbrace',
  'feelNoPain',
  'rupture',
  'inferno',
  'juggernaut',
  'unmovable',
  'vicious',
  'panache',
  'automation',
  'juggling',
  'aggression',
  'hellraiser',
  'stampede',
  'mayhem',
  'nostalgia',
  'stratagem',
  'intangible',
  'gambit',
  'calamity',
  'helloWorld',
  'entropy',
] as const;

export const ENEMY_POWER_IDS = ['strengthLossThisTurn', 'stun'] as const;

export const TRIGGER_WHENS = ['exhausted', 'drawn', 'turnEndInHand', 'turnEndInExhaust'] as const;

export const POOL_CHARACTERS = ['own', 'colorless', 'otherCharacters'] as const;

/** Compile-time check that the lists above match the contract unions exactly (fails typecheck otherwise). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const CONTRACT_LISTS_MATCH_TYPES: Same<PowerId, (typeof POWER_IDS)[number]> &
  Same<EnemyPowerId, (typeof ENEMY_POWER_IDS)[number]> &
  Same<Counter, (typeof COUNTERS)[number]> &
  Same<EffectType, 'attack' | (typeof AMOUNT_EFFECTS)[number] | (typeof CONTRACT_EFFECTS)[number]> = true;

export const CHARACTER_CODES = ['I', 'S', 'D', 'N', 'R'] as const;

export const ZONES = ['overgrowth', 'underdocks', 'hive', 'glory'] as const;

export const DIFFICULTIES = ['easy', 'normal', 'elite', 'boss', 'minion', 'event'] as const;

export const PATTERN_STARTS = ['first', 'random'] as const;

/** #4: cycle (fixed order) or random (seeded pick, optionally never the same move twice in a row). */
export const PATTERN_TYPES = ['cycle', 'random'] as const;

export const AMOUNT_EFFECTS = [
  'gainBlock',
  'gainStrength',
  'applyVulnerable',
  'applyWeak',
  'applyFrail',
  'applyPoison',
  'gainEnergy',
  'gainStars',
  'applyShrink',
] as const;

export const TWO_CHAR_CODE = /^[A-Za-z0-9]{2}$/;

export const NUMERIC_KEY = /^(0|[1-9][0-9]*)$/;
