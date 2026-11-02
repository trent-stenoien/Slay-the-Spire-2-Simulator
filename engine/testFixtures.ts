/**
 * Inline GameData for engine tests. Engine tests must not import from data/.
 * Values mirror the v1 design (Ironclad starter cards, Nibbit).
 */
import type { CardDef, CharacterDef, Effect, EnemyDef, GameData, Manifest } from './types';

const V = 'v0.107.1';
const META = {
  xCost: false,
  starCost: null,
  description: '',
  upgradedDescription: '',
  simulated: true,
  multiplayerOnly: false,
} as const;

export const cards: Record<string, CardDef> = {
  strike: {
    id: 'strike',
    code: 'St',
    name: 'Strike',
    type: 'attack',
    character: 'shared',
    cost: 1,
    keywords: [],
    effects: [{ type: 'attack', damage: 6, hits: 1 }],
    upgraded: { effects: [{ type: 'attack', damage: 9, hits: 1 }] },
    rarity: 'basic',
    ...META,
    lastUpdateVersion: V,
  },
  defend: {
    id: 'defend',
    code: 'De',
    name: 'Defend',
    type: 'skill',
    character: 'shared',
    cost: 1,
    keywords: [],
    effects: [{ type: 'gainBlock', amount: 5 }],
    upgraded: { effects: [{ type: 'gainBlock', amount: 8 }] },
    rarity: 'basic',
    ...META,
    lastUpdateVersion: V,
  },
  bash: {
    id: 'bash',
    code: 'Ba',
    name: 'Bash',
    type: 'attack',
    character: 'I',
    cost: 2,
    keywords: [],
    effects: [
      { type: 'attack', damage: 8, hits: 1 },
      { type: 'applyVulnerable', amount: 2 },
    ],
    upgraded: {
      effects: [
        { type: 'attack', damage: 10, hits: 1 },
        { type: 'applyVulnerable', amount: 3 },
      ],
    },
    rarity: 'basic',
    ...META,
    lastUpdateVersion: V,
  },
  ultimate_strike: {
    id: 'ultimate_strike',
    code: 'US',
    name: 'Ultimate Strike',
    type: 'attack',
    character: 'colorless',
    cost: 1,
    keywords: [],
    effects: [{ type: 'attack', damage: 14, hits: 1 }],
    upgraded: { effects: [{ type: 'attack', damage: 20, hits: 1 }] },
    rarity: 'basic',
    ...META,
    lastUpdateVersion: V,
  },
  ultimate_defend: {
    id: 'ultimate_defend',
    code: 'UD',
    name: 'Ultimate Defend',
    type: 'skill',
    character: 'colorless',
    cost: 1,
    keywords: [],
    effects: [{ type: 'gainBlock', amount: 11 }],
    upgraded: { effects: [{ type: 'gainBlock', amount: 15 }] },
    rarity: 'basic',
    ...META,
    lastUpdateVersion: V,
  },
  ascenders_bane: {
    id: 'ascenders_bane',
    code: 'AB',
    name: "Ascender's Bane",
    type: 'curse',
    character: 'colorless',
    cost: null,
    keywords: ['unplayable', 'ethereal', 'eternal'],
    effects: [],
    upgraded: null,
    rarity: 'basic',
    ...META,
    lastUpdateVersion: V,
  },
};

export const ironclad: CharacterDef = {
  id: 'ironclad',
  code: 'I',
  name: 'The Ironclad',
  maxHp: 80,
  energyPerTurn: 3,
  drawPerTurn: 5,
  startingDeck: [
    { cardId: 'strike', upgraded: false, count: 5 },
    { cardId: 'defend', upgraded: false, count: 4 },
    { cardId: 'bash', upgraded: false, count: 1 },
  ],
  startingRelic: 'Burning Blood',
  lastUpdateVersion: V,
};

export const nibbit: EnemyDef = {
  id: 'nibbit',
  code: 'Nb',
  name: 'Nibbit',
  act: 1,
  zone: 'overgrowth',
  difficulty: 'normal',
  hp: { min: 42, max: 46 },
  moves: {
    butt: { name: 'Butt', effects: [{ type: 'attack', damage: 12, hits: 1 }] },
    hesitantSlice: {
      name: 'Hesitant Slice',
      effects: [
        { type: 'attack', damage: 6, hits: 1 },
        { type: 'gainBlock', amount: 5 },
      ],
    },
    hiss: { name: 'Hiss', effects: [{ type: 'gainStrength', amount: 2 }] },
  },
  pattern: { type: 'cycle', order: ['butt', 'hesitantSlice', 'hiss'], start: 'first' },
  ascension: {
    '8': {
      hp: { min: 44, max: 48 },
      moves: {
        hesitantSlice: {
          effects: [
            { type: 'attack', damage: 6, hits: 1 },
            { type: 'gainBlock', amount: 6 },
          ],
        },
      },
    },
    '9': {
      moves: {
        butt: { effects: [{ type: 'attack', damage: 13, hits: 1 }] },
        hesitantSlice: {
          effects: [
            { type: 'attack', damage: 7, hits: 1 },
            { type: 'gainBlock', amount: 6 },
          ],
        },
        hiss: { effects: [{ type: 'gainStrength', amount: 3 }] },
      },
    },
  },
  source: 'https://slaythespire.wiki.gg/wiki/Nibbit',
  lastUpdateVersion: V,
};

export const manifest: Manifest = {
  gameVersion: V,
  ascensionCards: [{ level: 5, cardId: 'ascenders_bane' }],
};

/** A fresh copy each call so tests can add enemies or cards freely. */
export function makeGameData(): GameData {
  return structuredClone({
    manifest,
    cards,
    enemies: { nibbit },
    characters: { ironclad },
  });
}

/** Build a simple test enemy with fixed HP and a single repeated move. */
export function makeEnemy(
  id: string,
  hp: number,
  moves: EnemyDef['moves'],
  order: string[] = Object.keys(moves),
): EnemyDef {
  return {
    id,
    code: 'Zz',
    name: id,
    act: 1,
    zone: 'overgrowth',
    difficulty: 'normal',
    hp: { min: hp, max: hp },
    moves,
    pattern: { type: 'cycle', order, start: 'first' },
    ascension: {},
    source: 'test',
    lastUpdateVersion: V,
  };
}

/**
 * #105: one valid example of every contract effect, modelled on a real card. Shared by
 * engine, validator and card-text tests. loseHp (#106), draw and drawUntil (#107) and
 * exhaustCards (#108) are simulated now (repeat and script only in narrow forms, see #108 tests); the tests filter them out of the "not simulated yet" checks.
 */
export const CONTRACT_EFFECT_SAMPLES: Effect[] = [
  { type: 'loseHp', amount: 2 }, // Hemokinesis
  { type: 'draw', amount: 2 }, // Soul
  { type: 'drawUntil', stopOn: { notTypes: ['attack'] } }, // Pillage
  { type: 'exhaustCards', count: 3, mode: 'choose', upTo: true }, // Purity
  { type: 'applyPower', power: 'demonForm', amount: 3 }, // Demon Form
  { type: 'applyEnemyPower', power: 'strengthLossThisTurn', amount: 9 }, // Dark Shackles
  { type: 'schedule', delay: 1, effects: [{ type: 'gainEnergy', amount: 2 }] }, // Outmaneuver
  { type: 'dealDamage', amount: 40, allEnemies: true }, // The Bomb (inside a schedule)
  { type: 'enemyLoseHp', amount: 6 }, // Choking
  { type: 'setCost', piles: ['hand'], cost: 1, duration: 'turn', onlyIfHigher: true }, // Enlightenment
  {
    type: 'conditional',
    if: { kind: 'handHasNone', filter: { types: ['attack'] } },
    then: [{ type: 'draw', amount: 2 }],
  }, // Impatience
  { type: 'repeat', per: 'enemyVulnerable', effects: [{ type: 'gainStrength', amount: 1 }] }, // Dominate
  { type: 'attackFrom', damage: 5, hits: 1, extraHitsPer: { per: 'hpLossesThisCombat', amount: 1 } }, // Tear Asunder
  { type: 'gainBlockFrom', amount: 15, bonusPer: { per: 'playerStrength', amount: 5 } }, // Expect a Fight
  { type: 'growDamage', amount: 5, scope: 'self' }, // Rampage
  { type: 'moveCards', from: 'discard', to: 'drawTop', count: 1, mode: 'choose' }, // Headbutt
  { type: 'moveSelf', to: 'hand', when: 'nextTurnStart' }, // Bolas
  { type: 'upgradeCards', piles: ['hand', 'draw', 'discard', 'exhaust'], mode: 'all' }, // Apotheosis
  { type: 'playCards', from: 'draw', mode: 'top', count: 1, exhaust: true }, // Havoc
  { type: 'addReplay', amount: 2, from: 'draw', mode: 'random', filter: { noReplay: true } }, // Hidden Gem
  {
    type: 'addCards',
    source: { kind: 'random', pool: { character: 'own', types: ['attack'] } },
    count: 1,
    to: 'hand',
    freeThisTurn: true,
  }, // Infernal Blade
  {
    type: 'transformCards',
    from: 'hand',
    mode: 'all',
    filter: { types: ['attack'] },
    into: { kind: 'card', cardId: 'giant_rock' },
  }, // Primal Force
  { type: 'heal', amount: 10 }, // Not Yet
  { type: 'gainMaxHp', amount: 3 }, // Feed
  { type: 'loseMaxHp', amount: 2 }, // Brightest Flame
  { type: 'script', id: 'perfectedStrike', values: [2] }, // Perfected Strike (#111)
];
