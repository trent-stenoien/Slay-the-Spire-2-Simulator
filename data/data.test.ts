/** The real game data: validation, versions and key cards, enemies and characters. */
import { describe, expect, it } from 'vitest';
import { cardByCode, characterByCode, enemyByCode, gameData } from './index';
import { resolveEnemy } from '../engine/enemy';
import { VERSION, errorsOf } from './dataTestHelpers';

describe('real game data', () => {
  it('validates with zero errors', () => {
    expect(errorsOf(gameData)).toEqual([]);
  });

  it('manifest is at the current game version', () => {
    expect(gameData.manifest.gameVersion).toBe(VERSION);
  });

  const expected = [
    {
      id: 'strike',
      code: 'St',
      name: 'Strike',
      type: 'attack',
      character: 'shared',
      cost: 1,
      keywords: [],
      effects: [{ type: 'attack', damage: 6, hits: 1 }],
      upgraded: { effects: [{ type: 'attack', damage: 9, hits: 1 }] },
    },
    {
      id: 'defend',
      code: 'De',
      name: 'Defend',
      type: 'skill',
      character: 'shared',
      cost: 1,
      keywords: [],
      effects: [{ type: 'gainBlock', amount: 5 }],
      upgraded: { effects: [{ type: 'gainBlock', amount: 8 }] },
    },
    {
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
    },
    {
      id: 'ultimate_strike',
      code: 'US',
      name: 'Ultimate Strike',
      type: 'attack',
      character: 'colorless',
      cost: 1,
      keywords: [],
      effects: [{ type: 'attack', damage: 14, hits: 1 }],
      upgraded: { effects: [{ type: 'attack', damage: 20, hits: 1 }] },
    },
    {
      id: 'ultimate_defend',
      code: 'UD',
      name: 'Ultimate Defend',
      type: 'skill',
      character: 'colorless',
      cost: 1,
      keywords: [],
      effects: [{ type: 'gainBlock', amount: 11 }],
      upgraded: { effects: [{ type: 'gainBlock', amount: 15 }] },
    },
    {
      id: 'ascenders_bane',
      code: 'AB',
      name: "Ascender's Bane",
      type: 'curse',
      character: 'colorless',
      cost: null,
      keywords: ['unplayable', 'ethereal', 'eternal'],
      effects: [],
      upgraded: null,
    },
  ];

  it.each(expected)('card $id has the wiki values', (card) => {
    expect(gameData.cards[card.id]).toMatchObject({ ...card, simulated: true, lastUpdateVersion: VERSION });
    expect(cardByCode(card.code)?.id).toBe(card.id);
  });

  it('Bash deals damage before applying Vulnerable', () => {
    expect(gameData.cards.bash?.effects.map((e) => e.type)).toEqual(['attack', 'applyVulnerable']);
    expect(gameData.cards.bash?.upgraded?.effects?.map((e) => e.type)).toEqual(['attack', 'applyVulnerable']);
  });

  it('Ironclad has the v1 stats and a 10-card starting deck', () => {
    const ic = characterByCode('I');
    expect(ic?.id).toBe('ironclad');
    expect(ic).toMatchObject({
      name: 'Ironclad',
      maxHp: 80,
      energyPerTurn: 3,
      drawPerTurn: 5,
      startingRelic: 'Burning Blood',
      lastUpdateVersion: VERSION,
    });
    expect(ic?.startingDeck.reduce((n, e) => n + e.count, 0)).toBe(10);
    expect(ic?.startingDeck).toEqual([
      { cardId: 'strike', upgraded: false, count: 5 },
      { cardId: 'defend', upgraded: false, count: 4 },
      { cardId: 'bash', upgraded: false, count: 1 },
    ]);
  });

  // Random-target damage is the one enemy in a single-enemy fight (#6): plain attack, no target flag.
  it.each([
    ['sword_boomerang', 3, 3, 3, 4, true],
    ['rip_and_tear', 7, 2, 9, 2, true],
    ['ricochet', 3, 4, 3, 5, false], // Sly keeps it unsimulated
  ] as const)('random-target card %s is a plain multi-hit attack', (id, dmg, hits, upDmg, upHits, simulated) => {
    const c = gameData.cards[id]!;
    expect(c.effects).toEqual([{ type: 'attack', damage: dmg, hits }]);
    expect(c.upgraded?.effects).toEqual([{ type: 'attack', damage: upDmg, hits: upHits }]);
    expect(c.simulated).toBe(simulated);
  });

  it('Nibbit is at code Nb', () => {
    expect(enemyByCode('Nb')?.id).toBe('nibbit');
    expect(gameData.enemies.nibbit?.code).toBe('Nb');
  });

  it('Nibbit has the wiki moves: Butt, Hesitant Slice, Hiss', () => {
    const nb = gameData.enemies.nibbit!;
    expect(nb.pattern).toMatchObject({ order: ['butt', 'hesitantSlice', 'hiss'] });
    expect(nb.moves.hesitantSlice?.name).toBe('Hesitant Slice');
    expect(nb.moves).not.toHaveProperty('hesitantStrike');
  });

  // data/raw/intents.txt: Hesitant Slice "Deals (6;7 9) damage. Gains (5;6 8) Block."
  it.each([
    [0, { min: 42, max: 46 }, 12, [6, 5], 2],
    [7, { min: 42, max: 46 }, 12, [6, 5], 2],
    [8, { min: 44, max: 48 }, 12, [6, 6], 2],
    [9, { min: 44, max: 48 }, 13, [7, 6], 3],
    [20, { min: 44, max: 48 }, 13, [7, 6], 3],
  ] as const)('Nibbit at A%i has the wiki numbers', (asc, hp, butt, [slice, block], hiss) => {
    const e = resolveEnemy(gameData.enemies.nibbit!, asc);
    expect(e.hp).toEqual(hp);
    expect(e.moves.butt!.effects).toEqual([{ type: 'attack', damage: butt, hits: 1 }]);
    expect(e.moves.hesitantSlice).toEqual({
      name: 'Hesitant Slice',
      effects: [
        { type: 'attack', damage: slice, hits: 1 },
        { type: 'gainBlock', amount: block },
      ],
    });
    expect(e.moves.hiss!.effects).toEqual([{ type: 'gainStrength', amount: hiss }]);
  });

  it('lookups return undefined for unknown codes', () => {
    expect(cardByCode('zz')).toBeUndefined();
    expect(enemyByCode('zz')).toBeUndefined();
    expect(characterByCode('X')).toBeUndefined();
  });

  it("Ascender's Bane referenced by the manifest exists", () => {
    for (const { cardId } of gameData.manifest.ascensionCards) {
      expect(gameData.cards[cardId]).toBeDefined();
    }
  });
});

describe('imported characters and enemies', () => {
  it.each([
    ['S', 'silent', 70, 12, 'Ring of the Snake'],
    ['D', 'defect', 75, 10, 'Cracked Core'],
    ['N', 'necrobinder', 66, 10, 'Bound Phylactery'],
    ['R', 'regent', 75, 10, 'Divine Right'],
  ])('%s is %s with %i HP, %i starting cards and %s', (code, id, hp, cards, relic) => {
    const ch = characterByCode(code);
    expect(ch).toMatchObject({ id, maxHp: hp, startingRelic: relic });
    expect(ch?.startingDeck.reduce((n, e) => n + e.count, 0)).toBe(cards);
  });

  it('Seapunk cycles Sea Kick, Spinning Kick, Bubble Burp', () => {
    expect(enemyByCode('Sp')?.pattern).toMatchObject({ order: ['seaKick', 'spinningKick', 'bubbleBurp'] });
  });

  // #4, data/import/enemies-notes.md and data/raw/intents.txt.
  it('Shrinker Beetle opens with Shrinker (30% Shrink), then alternates Chomp / Stomp', () => {
    const e = enemyByCode('SB')!;
    expect(e).toMatchObject({ id: 'shrinker_beetle', zone: 'overgrowth', difficulty: 'easy' });
    expect(e.pattern).toEqual({ type: 'cycle', opener: ['shrinker'], order: ['chomp', 'stomp'], start: 'first' });
    expect(e.moves.shrinker!.effects).toEqual([{ type: 'applyShrink', amount: 30 }]);
  });

  it.each([
    [0, { min: 38, max: 40 }, 7, 13],
    [8, { min: 40, max: 42 }, 7, 13],
    [9, { min: 40, max: 42 }, 8, 14],
  ] as const)('Shrinker Beetle at A%i has the wiki numbers', (asc, hp, chomp, stomp) => {
    const e = resolveEnemy(gameData.enemies.shrinker_beetle!, asc);
    expect(e.hp).toEqual(hp);
    expect(e.moves.chomp!.effects).toEqual([{ type: 'attack', damage: chomp, hits: 1 }]);
    expect(e.moves.stomp!.effects).toEqual([{ type: 'attack', damage: stomp, hits: 1 }]);
  });

  it('Sludge Spinner opens with Oil Spray, then picks at random without repeats', () => {
    const e = enemyByCode('SS')!;
    expect(e).toMatchObject({ id: 'sludge_spinner', zone: 'underdocks', difficulty: 'easy' });
    expect(e.pattern).toEqual({
      type: 'random',
      opener: ['oilSpray'],
      moves: ['oilSpray', 'rage', 'slam'],
      noRepeat: true,
    });
  });

  it.each([
    [0, { min: 37, max: 39 }, 8, 6, 11],
    [8, { min: 41, max: 42 }, 8, 6, 11],
    [9, { min: 41, max: 42 }, 9, 7, 12],
  ] as const)('Sludge Spinner at A%i has the wiki numbers', (asc, hp, oil, rage, slam) => {
    const e = resolveEnemy(gameData.enemies.sludge_spinner!, asc);
    expect(e.hp).toEqual(hp);
    expect(e.moves.oilSpray!.effects).toEqual([
      { type: 'attack', damage: oil, hits: 1 },
      { type: 'applyWeak', amount: 1 },
    ]);
    expect(e.moves.rage!.effects).toEqual([
      { type: 'attack', damage: rage, hits: 1 },
      { type: 'gainStrength', amount: 3 },
    ]);
    expect(e.moves.slam!.effects).toEqual([{ type: 'attack', damage: slam, hits: 1 }]);
  });

  it('Fuzzy Wurm Crawler cycles Acid Goop, Inhale, Acid Goop', () => {
    expect(enemyByCode('FW')?.pattern).toMatchObject({ order: ['acidGoop', 'inhale', 'acidGoop'] });
  });
});
