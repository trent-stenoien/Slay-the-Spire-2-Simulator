/** #203: Artifact, enemy start powers, Strength per turn, and the Mawler / Byrdonis / Cubex Construct / Vantom data. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { resolveEnemy } from './enemy';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { deckOf, dummy, events, logged, passive, scripted, withEnemy } from './combatTestHelpers';
import type { EnemyDef, GameData, GameEvent } from './types';

/** Test data: a 999-HP dummy with start powers, plus 0-cost cards that apply debuffs. */
function artifactData(startPowers: EnemyDef['startPowers']): GameData {
  const data = withEnemy(makeGameData(), { ...dummy(), startPowers });
  const zero = { ...cards.defend!, cost: 0, upgraded: null };
  data.cards.venom = { ...zero, id: 'venom', code: 'Vn', effects: [{ type: 'applyPoison', amount: 3 }] };
  data.cards.sap = {
    ...zero,
    id: 'sap',
    code: 'Sp',
    effects: [
      { type: 'applyWeak', amount: 1 },
      { type: 'applyVulnerable', amount: 2 },
      { type: 'applyFrail', amount: 1 },
    ],
  };
  data.cards.dazzle = {
    ...zero,
    id: 'dazzle',
    code: 'Dz',
    effects: [{ type: 'applyEnemyPower', power: 'stun', amount: 1 }],
  };
  return data;
}

const run = (data: GameData, plays: string[], deck: [string, number][]) =>
  logged(
    data,
    scripted((t) => (t === 1 ? plays : [])),
    { enemyId: 'dummy', deck: deckOf(...deck, ['defend', 9]) },
  );

const negated = (log: GameEvent[] | undefined) => events(log, 'negated');

describe('Artifact (#203)', () => {
  it('negates the first debuff only: Weak is negated, Vulnerable and Frail land (Cubex golden)', () => {
    const r = run(artifactData({ artifact: 1 }), ['sap'], [['sap', 1]]);
    expect(negated(r.log)).toEqual([{ t: 'negated', side: 'enemy', status: 'weak', left: 0 }]);
    expect(events(r.log, 'debuff').map((d) => d.kind)).toEqual(['vulnerable', 'frail']);
  });

  it('uses one stack per debuff', () => {
    const r = run(artifactData({ artifact: 2 }), ['sap'], [['sap', 1]]);
    expect(negated(r.log).map((n) => [n.status, n.left])).toEqual([
      ['weak', 1],
      ['vulnerable', 0],
    ]);
    expect(events(r.log, 'debuff').map((d) => d.kind)).toEqual(['frail']);
  });

  it('removes the power when the last stack is used, and does not apply the debuff', () => {
    const r = run(artifactData({ artifact: 1 }), ['sap'], [['sap', 1]]);
    expect(events(r.log, 'powerRemoved')).toContainEqual({ t: 'powerRemoved', side: 'enemy', power: 'artifact' });
  });

  it('negates Poison and Stun too', () => {
    const r = run(
      artifactData({ artifact: 2 }),
      ['venom', 'dazzle'],
      [
        ['venom', 1],
        ['dazzle', 1],
      ],
    );
    expect(negated(r.log).map((n) => n.status)).toEqual(['poison', 'stun']);
    expect(events(r.log, 'poison')).toEqual([]);
    expect(events(r.log, 'poisonDamage')).toEqual([]);
  });

  it('a large Poison application uses exactly one stack', () => {
    const data = artifactData({ artifact: 2 });
    data.cards.venom!.effects = [{ type: 'applyPoison', amount: 50 }];
    const r = run(data, ['venom'], [['venom', 1]]);
    expect(negated(r.log)).toEqual([{ t: 'negated', side: 'enemy', status: 'poison', left: 1 }]);
    expect(events(r.log, 'poison')).toEqual([]);
  });

  it('does nothing without Artifact', () => {
    const r = run(artifactData(undefined), ['sap'], [['sap', 1]]);
    expect(negated(r.log)).toEqual([]);
    expect(events(r.log, 'debuff').map((d) => d.kind)).toEqual(['weak', 'vulnerable', 'frail']);
  });
});

describe('Enemy start powers and Strength per turn (#203)', () => {
  it('start powers are on the enemy at combat start, logged right after combatStart', () => {
    const r = logged(artifactData({ artifact: 3 }), passive, { enemyId: 'dummy' });
    const start = r.log!.findIndex((e) => e.t === 'combatStart');
    expect(r.log![start + 1]).toEqual({ t: 'powerApplied', side: 'enemy', power: 'artifact', amount: 3, total: 3 });
  });

  it('an Ascension startPowers override replaces the base value from its level', () => {
    const def: EnemyDef = {
      ...dummy(),
      startPowers: { slippery: 8 },
      ascension: { '9': { startPowers: { slippery: 9 } } },
    };
    expect(resolveEnemy(def, 8).startPowers).toEqual({ slippery: 8 });
    expect(resolveEnemy(def, 9).startPowers).toEqual({ slippery: 9 });
    expect(resolveEnemy({ ...def, ascension: {} }, 9).startPowers).toEqual({ slippery: 8 });
  });

  it('strengthPerTurn adds Strength at the END of the enemy turn, after its move (0, 1, 2 seen)', () => {
    const hit = { name: 'Hit', effects: [{ type: 'attack' as const, damage: 10, hits: 1 }] };
    const enemy = { ...makeEnemy('hitter', 999, { hit }), startPowers: { strengthPerTurn: 1 } };
    const r = logged(withEnemy(makeGameData(), enemy), passive, { enemyId: 'hitter', deck: deckOf(['defend', 10]) });
    const log = r.log!;
    const first = log.findIndex((e) => e.t === 'enemyMove');
    // The first move is a plain 10; the Strength comes after it.
    expect(log.slice(first, first + 8).find((e) => e.t === 'strength')).toMatchObject({ side: 'enemy', total: 1 });
    const dmg = events(log, 'damage').filter((e) => e.target === 'player');
    expect(dmg.slice(0, 3).map((d) => d.amount)).toEqual([10, 11, 12]);
  });
});

describe('Mawler, Byrdonis, Cubex Construct, Vantom data (#203)', () => {
  const moveIds = (enemyId: string, turns: number) =>
    events(logged(gameData, passive, { enemyId, seed: 3 }).log, 'enemyMove')
      .slice(0, turns)
      .map((m) => m.moveId);
  const damages = (enemyId: string, ascension = 0) =>
    events(logged(gameData, passive, { enemyId, ascension }).log, 'damage')
      .filter((d) => d.target === 'player')
      .map((d) => d.amount);

  it('Mawler: 72 HP (76 at A8), opens with Claw, never repeats, Roar is Vulnerable 3', () => {
    const d = gameData.enemies.mawler!;
    expect([d.difficulty, resolveEnemy(d, 0).hp, resolveEnemy(d, 8).hp]).toEqual([
      'normal',
      { min: 72, max: 72 },
      { min: 76, max: 76 },
    ]);
    const ids = moveIds('mawler', 12);
    expect(ids[0]).toBe('claw');
    ids.slice(1).forEach((id, i) => expect(id).not.toBe(ids[i]));
    expect(d.moves.roar!.effects).toEqual([{ type: 'applyVulnerable', amount: 3 }]);
    expect([d.moves.ripAndTear!.effects, d.moves.claw!.effects]).toEqual([
      [{ type: 'attack', damage: 14, hits: 1 }],
      [{ type: 'attack', damage: 4, hits: 2 }],
    ]);
    const a9 = resolveEnemy(d, 9);
    expect([a9.moves.ripAndTear!.effects, a9.moves.claw!.effects, a9.moves.roar!.effects]).toEqual([
      [{ type: 'attack', damage: 16, hits: 1 }],
      [{ type: 'attack', damage: 5, hits: 2 }],
      [{ type: 'applyVulnerable', amount: 3 }],
    ]);
  });

  it('Byrdonis: elite, 81-84 HP (90 at A8), Swoop / Peck alternate, +1 Strength per turn', () => {
    const d = gameData.enemies.byrdonis!;
    expect([d.difficulty, d.hp, resolveEnemy(d, 8).hp, d.startPowers]).toEqual([
      'elite',
      { min: 81, max: 84 },
      { min: 90, max: 90 },
      { strengthPerTurn: 1 },
    ]);
    expect(moveIds('byrdonis', 5)).toEqual(['swoop', 'peck', 'swoop', 'peck', 'swoop']);
    // Golden combat 6: 17, 4x3 (Strength 1), 19 (Strength 2).
    expect(damages('byrdonis').slice(0, 5)).toEqual([17, 4, 4, 4, 19]);
    expect(damages('byrdonis', 8).slice(0, 5)).toEqual([19, 5, 5, 5, 21]);
  });

  it('Cubex Construct: 65 HP (70 at A8), 1 Artifact, Charge Up then Repeater, Repeater, Expel', () => {
    const d = gameData.enemies.cubex_construct!;
    expect([d.hp, resolveEnemy(d, 8).hp, d.startPowers]).toEqual([
      { min: 65, max: 65 },
      { min: 70, max: 70 },
      { artifact: 1 },
    ]);
    expect(moveIds('cubex_construct', 7)).toEqual([
      'chargeUp',
      'repeaterBlast',
      'repeaterBlast',
      'expelBlast',
      'repeaterBlast',
      'repeaterBlast',
      'expelBlast',
    ]);
    // Golden combat 7 / wiki schedule: 9, 11, 11x2, 13, 15, 15x2 (Strength 2, 4, 6, 6, 8, 10).
    expect(damages('cubex_construct').slice(0, 7)).toEqual([9, 11, 11, 11, 13, 15, 15]);
    expect(damages('cubex_construct', 9).slice(0, 3)).toEqual([10, 12, 12]);
  });

  it('Vantom: boss, 173 HP (183 at A8), Slippery 8 (9 at A9), Dismember 26 adds 3 Wounds to discard', () => {
    const d = gameData.enemies.vantom!;
    expect([d.difficulty, d.hp, resolveEnemy(d, 8).hp]).toEqual([
      'boss',
      { min: 173, max: 173 },
      { min: 183, max: 183 },
    ]);
    expect([resolveEnemy(d, 0).startPowers, resolveEnemy(d, 8).startPowers, resolveEnemy(d, 9).startPowers]).toEqual([
      { slippery: 8 },
      { slippery: 8 },
      { slippery: 9 },
    ]);
    expect(moveIds('vantom', 5)).toEqual(['inkBlot', 'inkyLance', 'dismember', 'prepare', 'inkBlot']);
    expect(damages('vantom').slice(0, 5)).toEqual([7, 6, 6, 26, 9]);
    expect(damages('vantom', 9).slice(0, 5)).toEqual([8, 7, 7, 30, 10]);
    const r = logged(gameData, passive, { enemyId: 'vantom', deck: deckOf(['defend', 10]) });
    const wounds = events(r.log, 'generated').filter((g) => g.cardId === 'wound');
    expect(wounds.slice(0, 3)).toHaveLength(3);
    expect(wounds.every((w) => w.to === 'discard' && w.source === 'card')).toBe(true);
    expect(wounds.length % 3).toBe(0);
  });
});

describe('Bygone Effigy (#303)', () => {
  it('sleeps, wakes (+10 Strength), then Slashes for 13 + 10 (A9: 15 + 10)', () => {
    for (const [asc, slash] of [
      [0, 13],
      [9, 15],
    ] as const) {
      const data: GameData = { ...makeGameData(), enemies: { bygone_effigy: gameData.enemies.bygone_effigy! } };
      const r = logged(data, passive, { enemyId: 'bygone_effigy', ascension: asc });
      const moves = events(r.log, 'enemyMove').map((m) => m.moveId);
      expect(moves.slice(0, 4)).toEqual(['sleep', 'wake', 'slashes', 'slashes']);
      expect(events(r.log, 'strength').find((s) => s.side === 'enemy')).toMatchObject({ amount: 10, total: 10 });
      const hits = events(r.log, 'damage').filter((d) => d.target === 'player');
      expect(hits[0]?.amount).toBe(slash + 10);
      expect(hits[hits.length - 1]?.amount).toBe(slash + 10);
    }
  });
});

describe('Slow (#303)', () => {
  const slowData = (): GameData => {
    const data = withEnemy(makeGameData(), { ...dummy(), startPowers: { slow: 1 } });
    const zero = { ...cards.defend!, cost: 0, upgraded: null };
    data.cards.filler = { ...zero, id: 'filler', code: 'Fz', effects: [{ type: 'gainBlock', amount: 1 }] };
    data.cards.sting = { ...zero, id: 'sting', code: 'Sg', effects: [{ type: 'applyVulnerable', amount: 3 }] };
    data.cards.zstrike = { ...cards.strike!, id: 'zstrike', code: 'Zs', cost: 0 };
    data.cards.zstrike.upgraded = { effects: [{ type: 'attack', damage: 9, hits: 1 }] };
    return data;
  };
  const deck = (upgraded = false) => [
    { cardId: 'filler', upgraded: false, count: 4 },
    { cardId: 'sting', upgraded: false, count: 1 },
    { cardId: 'zstrike', upgraded, count: 5 },
  ];
  /** Damage dealt to the enemy by each attack card of turn 1, in play order, after `before` filler cards. */
  const hits = (plan: string[], upgraded = false, turns = 1, customDeck = deck(upgraded)) => {
    const r = logged(
      slowData(),
      scripted((t) => (t <= turns ? plan : [])),
      {
        enemyId: 'dummy',
        deck: customDeck,
      },
    );
    return events(r.log, 'damage')
      .filter((d) => d.target === 'enemy')
      .map((d) => d.amount);
  };

  it('the Strike played after 2 cards deals 7 (6 +20%), Strike+ deals 10 (9 +20%)', () => {
    expect(hits(['filler', 'filler', 'zstrike'])).toEqual([7]);
    expect(hits(['filler', 'filler', 'zstrike'], true)).toEqual([10]);
  });

  it('the card being played does not count: a first-card Strike deals 6, and +10% per earlier card', () => {
    expect(hits(['zstrike'])).toEqual([6]);
    expect(
      hits(['zstrike', 'zstrike', 'zstrike', 'zstrike', 'zstrike'], false, 1, [
        { cardId: 'zstrike', upgraded: false, count: 10 },
      ]),
    ).toEqual([6, 6, 7, 7, 8]);
  });

  it('shows 40% after 4 cards: Strike deals 8', () => {
    expect(
      hits(['filler', 'filler', 'filler', 'filler', 'zstrike'], false, 1, [
        { cardId: 'filler', upgraded: false, count: 4 },
        { cardId: 'zstrike', upgraded: false, count: 1 },
      ]),
    ).toEqual([8]);
  });

  it('resets at the end of the player turn', () => {
    expect(hits(['filler', 'filler', 'zstrike'], false, 2)).toEqual([7, 7]);
    expect(hits(['zstrike'], false, 2)).toEqual([6, 6]);
  });

  it('combines with Vulnerable as one multiplier, floored once (9 x 1.5 x 1.2 = 16)', () => {
    expect(hits(['sting', 'filler', 'zstrike'], true)).toEqual([16]);
  });

  it('does not change Poison damage', () => {
    const data = slowData();
    data.cards.venom = {
      ...cards.defend!,
      id: 'venom',
      cost: 0,
      code: 'Vn',
      effects: [{ type: 'applyPoison', amount: 5 }],
      upgraded: null,
    };
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['filler', 'filler', 'filler', 'venom'] : [])),
      {
        enemyId: 'dummy',
        deck: [
          { cardId: 'filler', upgraded: false, count: 5 },
          { cardId: 'venom', upgraded: false, count: 5 },
        ],
      },
    );
    expect(events(r.log, 'poisonDamage')[0]?.amount).toBe(5);
  });

  it('counts cards played by other cards for later hits (#314): Havoc playing the top Strike', () => {
    const data = slowData();
    data.cards.zhavoc = {
      ...cards.defend!,
      id: 'zhavoc',
      code: 'Zh',
      cost: 0,
      keywords: ['innate'],
      effects: [{ type: 'playCards', from: 'draw', mode: 'top', count: 1, exhaust: true }],
      upgraded: null,
    };
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['zhavoc', 'zstrike'] : [])),
      {
        enemyId: 'dummy',
        deck: [
          { cardId: 'zhavoc', upgraded: false, count: 1 },
          { cardId: 'zstrike', upgraded: false, count: 10 },
        ],
      },
    );
    const dealt = events(r.log, 'damage')
      .filter((d) => d.target === 'enemy')
      .map((d) => d.amount);
    // Havoc (0 before), its Strike (1 before: 6.6 -> 6), the hand Strike (2 before: 7.2 -> 7).
    expect(dealt).toEqual([6, 7]);
  });

  it('does not slow an enemy without the power', () => {
    const data = withEnemy(makeGameData(), dummy());
    data.cards.zstrike = { ...cards.strike!, id: 'zstrike', code: 'Zs', cost: 0 };
    data.cards.filler = { ...cards.defend!, id: 'filler', code: 'Fz', cost: 0, upgraded: null };
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['filler', 'filler', 'zstrike'] : [])),
      {
        enemyId: 'dummy',
        deck: [
          { cardId: 'filler', upgraded: false, count: 5 },
          { cardId: 'zstrike', upgraded: false, count: 5 },
        ],
      },
    );
    expect(events(r.log, 'damage').find((d) => d.target === 'enemy')?.amount).toBe(6);
  });

  it('Bygone Effigy starts with Slow', () => {
    expect(gameData.enemies.bygone_effigy?.startPowers).toEqual({ slow: 1 });
  });
});
