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
  'enemyGainStrength',
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
 * #116 addCards, transformCards, #115 heal, gainMaxHp, loseMaxHp, #104 gainGold / gainPotion, #114 playCards and addReplay, #112 moveCards, moveSelf, upgradeCards,
 * #110 schedule (with simulated inner effects), dealDamage, enemyLoseHp, setCost, #111 attackFrom, gainBlockFrom, growDamage
 * (their counters are checked by field). `applyEnemyPower` (stun, strengthLossThisTurn), `conditional` and `repeat` are
 * checked by field in data/validate/cards.ts.
 */
export const SIMULATED_CONTRACT_EFFECTS = new Set<string>([
  'loseHp',
  'draw',
  'drawUntil',
  'exhaustCards',
  'addCards',
  'transformCards',
  'moveCards',
  'moveSelf',
  'upgradeCards',
  'heal',
  'gainMaxHp',
  'loseMaxHp',
  'gainGold',
  'gainPotion',
  'attackFrom',
  'gainBlockFrom',
  'growDamage',
  // #110
  'schedule',
  'dealDamage',
  'enemyLoseHp',
  'enemyGainStrength',
  'setCost',
  'playCards',
  'addReplay',
]);

/** #110/#115: enemy powers the engine simulates (Stun, temporary Strength loss). */
export const SIMULATED_ENEMY_POWERS = new Set<string>(['stun', 'strengthLossThisTurn']);

/**
 * #108/#111: counters the engine reads for `repeat`, `conditional`, `attackFrom` and `gainBlockFrom`
 * (engine/combat.ts SIMULATED_COUNTERS). Every counter is simulated; playCard keeps the cards-played tallies (#113).
 */
export const SIMULATED_COUNTERS = new Set<string>([
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
]);

/** `script` ids the engine runs (#108 Fiend Fire, Thrash; #116 primalForcePlus; #114 playSelf; #110 prolong; #111 perfectedStrike). */
export const SIMULATED_SCRIPTS = new Set<string>([
  'fiendFire',
  'thrash',
  'primalForcePlus',
  'playSelf',
  'prolong',
  'perfectedStrike',
]);

/** Card triggers the engine runs (#108 exhausted, #115 drawn and turnEndInHand, #114 turnEndInExhaust). */
export const SIMULATED_TRIGGERS = new Set<string>(['exhausted', 'drawn', 'turnEndInHand', 'turnEndInExhaust']);

/** #114: `addCards` sources that copy a card (Anger, Dual Wield); 'card' and 'random' are #116's. */
export const SIMULATED_CARD_SOURCES = new Set<string>(['self', 'copyOf']);

/** #114: `addCards` fields the engine does not run for copies (#116 sets them on the cards it creates). */
export const UNSIMULATED_ADD_CARDS_FIELDS = ['options', 'upgraded', 'freeThisTurn', 'costThisCombat'] as const;

export const UNSIMULATED_EFFECTS = new Set<string>(
  ['gainStars', ...CONTRACT_EFFECTS].filter((t) => !SIMULATED_CONTRACT_EFFECTS.has(t)),
);

/**
 * Powers the engine simulates (engine/combat.ts SIMULATED_POWER_IDS); a simulated card may apply
 * only these: #107 noDraw (Battle Trance), the #109 simple powers, the #110 temporary powers and
 * the #113 trigger powers.
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
  // #113 trigger powers
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
]);

/** CardFilter fields the engine matches on (every field of CardFilter since #113 enabled `nameIncludes`). */
export const SIMULATED_FILTER_FIELDS = new Set<string>([
  'types',
  'notTypes',
  'rarity',
  'cardId',
  'upgraded',
  'noReplay',
  'nameIncludes',
]);

/** CardDef fields from #105 that the engine does not simulate yet (`triggers`: see SIMULATED_TRIGGERS; `costLessPer`: see SIMULATED_COST_COUNTERS; `playableIf` is simulated, #111). */
export const UNSIMULATED_CARD_FIELDS: readonly string[] = [];

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
