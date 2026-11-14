/** #263 Silent Poison powers and counters: Accelerant, Envenom, Noxious Fumes, Corrosive Wave, Outbreak, Mirage. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummyData, events, scripted, withEnemy } from './combatTestHelpers';
import type { CardDef, Effect, GameData, PowerId, Strategy } from './types';

const card = (
  id: string,
  type: CardDef['type'],
  cost: number,
  effects: Effect[],
  extra: Partial<CardDef> = {},
): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  type,
  cost,
  effects,
  upgraded: null,
  keywords: ['innate'],
  ...extra,
});
const apply = (power: PowerId, amount: number): Effect => ({ type: 'applyPower', power, amount });
const poison = (amount: number, allEnemies = false): Effect => ({ type: 'applyPoison', amount, allEnemies });

const defs: Record<string, CardDef> = {
  accelerant: card('accelerant', 'power', 0, [apply('accelerant', 1)]),
  accelerant2: card('accelerant2', 'power', 0, [apply('accelerant', 2)]),
  envenom: card('envenom', 'power', 0, [apply('envenom', 1)]),
  fumes: card('fumes', 'power', 0, [apply('noxiousFumes', 2)]),
  wave: card('wave', 'skill', 0, [apply('corrosiveWave', 2)]),
  outbreak: card('outbreak', 'power', 0, [apply('outbreak', 11)]),
  mirage: card('mirage', 'skill', 0, [
    { type: 'gainBlockFrom', amount: 0, bonusPer: { per: 'enemyPoison', amount: 1 } },
  ]),
  venom5: card('venom5', 'skill', 0, [poison(5)]),
  venom1: card('venom1', 'skill', 0, [poison(1)]),
  haze: card('haze', 'skill', 0, [poison(4, true)]),
  strike: card('strike', 'attack', 0, [{ type: 'attack', damage: 6, hits: 1 }]),
  triple: card('triple', 'attack', 0, [{ type: 'attack', damage: 3, hits: 3 }]),
  sweep: card('sweep', 'attack', 0, [{ type: 'attack', damage: 6, hits: 1, allEnemies: true }]),
  blocker: card('blocker', 'skill', 0, [{ type: 'gainBlock', amount: 10 }], { keywords: [] }),
  drawer: card('drawer', 'skill', 0, [{ type: 'draw', amount: 2 }], { keywords: [] }),
  fire: card('fire', 'skill', 0, [{ type: 'dealDamage', amount: 7 }]),
};

const idle = makeEnemy('idle', 999, { wait: { name: 'Wait', effects: [] } });
const idle2 = makeEnemy('idle2', 999, { wait: { name: 'Wait', effects: [] } });
const shield = makeEnemy('shield', 999, {
  guard: { name: 'Guard', effects: [{ type: 'gainBlock', amount: 20 } as Effect] },
});

function data(): GameData {
  const d = withEnemy(dummyData(), idle, idle2, shield);
  Object.assign(d.cards, structuredClone(defs));
  return d;
}

const run = (
  deck: [string, number][],
  plan: (turn: number) => string[],
  over: Partial<Parameters<typeof cfg>[0]> = {},
  strategy: Strategy = scripted(plan),
) => simulateCombat(data(), cfg({ enemyId: 'dummy', deck: deckOf(...deck), ...over }), strategy, { log: true });

const poisonTicks = (r: ReturnType<typeof run>) => events(r.log, 'poisonDamage').map((e) => e.amount);

describe('Accelerant (Trent: each extra trigger also lowers Poison by 1)', () => {
  it('Poison 5 with 1 extra trigger deals 5 + 4 and leaves 3', () => {
    const r = run(
      [
        ['accelerant', 1],
        ['venom5', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['accelerant', 'venom5'] : []),
    );
    expect(poisonTicks(r).slice(0, 2)).toEqual([5, 4]);
    // Next turn: 3 left, so 3 + 2, then 1.
    expect(poisonTicks(r).slice(2, 4)).toEqual([3, 2]);
  });

  it('2 extra triggers (upgraded) deal 5 + 4 + 3; stops when Poison runs out', () => {
    const r = run(
      [
        ['accelerant2', 1],
        ['venom1', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['accelerant2', 'venom1'] : []),
    );
    expect(poisonTicks(r)).toEqual([1]);
    const r2 = run(
      [
        ['accelerant2', 1],
        ['venom5', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['accelerant2', 'venom5'] : []),
    );
    expect(poisonTicks(r2).slice(0, 3)).toEqual([5, 4, 3]);
    expect(poisonTicks(r2).slice(3, 5)).toEqual([2, 1]);
  });

  it('a kill on an extra trigger ends the combat', () => {
    const d = data();
    d.enemies.weak8 = makeEnemy('weak8', 8, { wait: { name: 'Wait', effects: [] } });
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'weak8', deck: deckOf(['accelerant', 1], ['venom5', 1], ['blocker', 3]) }),
      scripted((t) => (t === 1 ? ['accelerant', 'venom5'] : [])),
      { log: true },
    );
    expect(r.outcome).toBe('win');
    expect(poisonTicks(r)).toEqual([5, 4]);
  });
});

describe('Envenom (Trent: unblocked damage from Attack cards only)', () => {
  it('poisons only when the hit gets through Block; once per hit', () => {
    const r = run(
      [
        ['envenom', 1],
        ['triple', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['envenom', 'triple'] : []),
    );
    expect(events(r.log, 'poison').map((e) => e.total)).toEqual([1, 2, 3]);
  });

  it('a fully blocked hit does not poison', () => {
    const r = run(
      [
        ['envenom', 1],
        ['strike', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['envenom', 'strike'] : []),
      { enemyId: 'shield' },
    );
    // Turn 1 the shield enemy has no Block yet: the strike gets through.
    expect(events(r.log, 'poison')).toHaveLength(1);
    const r2 = run(
      [
        ['envenom', 1],
        ['strike', 1],
        ['blocker', 3],
      ],
      (t) => (t === 2 ? ['envenom', 'strike'] : []),
      { enemyId: 'shield' },
    );
    // Turn 2: Block 20 absorbs the 6 damage.
    expect(events(r2.log, 'poison')).toHaveLength(0);
  });

  it('does not trigger on fixed damage (Fire Potion style) or Poison damage', () => {
    const r = run(
      [
        ['envenom', 1],
        ['fire', 1],
        ['venom5', 1],
        ['blocker', 2],
      ],
      (t) => (t === 1 ? ['envenom', 'fire', 'venom5'] : []),
    );
    expect(events(r.log, 'poison')).toEqual([{ t: 'poison', amount: 5, total: 5 }]);
  });

  it('an attack on ALL enemies poisons each enemy it hurts', () => {
    const r = run(
      [
        ['envenom', 1],
        ['sweep', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['envenom', 'sweep'] : []),
      { enemyIds: ['idle', 'idle2'] },
    );
    expect(events(r.log, 'poison')).toHaveLength(2);
  });
});

describe('Noxious Fumes', () => {
  it('poisons ALL enemies at the start of each later turn, not the turn it is played', () => {
    const r = run(
      [
        ['fumes', 1],
        ['blocker', 4],
      ],
      (t) => (t === 1 ? ['fumes'] : []),
      { enemyIds: ['idle', 'idle2'] },
    );
    // Turn 2: 2 each. Turn 3: Poison ticked 2 -> 1 in between, so 3 each.
    expect(
      events(r.log, 'poison')
        .slice(0, 4)
        .map((e) => e.total),
    ).toEqual([2, 2, 3, 3]);
  });
});

describe('Corrosive Wave', () => {
  it('poisons ALL enemies for each card drawn after it is played, this turn only', () => {
    const r = run(
      [
        ['wave', 1],
        ['drawer', 1],
        ['blocker', 8],
      ],
      (t) => (t === 1 ? ['wave', 'drawer'] : []),
      { enemyIds: ['idle', 'idle2'] },
    );
    const p = events(r.log, 'poison');
    // Turn 1: 2 cards drawn x 2 enemies = 4 events. Draws on later turns add none.
    expect(p).toHaveLength(4);
    expect(p.map((e) => e.amount)).toEqual([2, 2, 2, 2]);
    expect(p.map((e) => e.total)).toEqual([2, 2, 4, 4]);
  });
});

describe('Outbreak', () => {
  it('deals its damage to ALL enemies on every 3rd Poison application (one effect = one application)', () => {
    const r = run(
      [
        ['outbreak', 1],
        ['haze', 3],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['outbreak', 'haze', 'haze', 'haze'] : []),
      { enemyIds: ['idle', 'idle2'] },
    );
    // 3 Hazes poison both enemies (2 events each) = 3 applications: Outbreak fires once, 11 to each enemy.
    const hits = events(r.log, 'damage').filter((e) => e.source === 'player');
    expect(hits.map((e) => e.hpLoss)).toEqual([11, 11]);
  });

  it('counts only while it is in play and does not count an Artifact-negated application', () => {
    const r = run(
      [
        ['outbreak', 1],
        ['venom1', 3],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['venom1', 'venom1', 'outbreak', 'venom1'] : []),
    );
    expect(events(r.log, 'damage').filter((e) => e.source === 'player')).toHaveLength(0);
    const r2 = run(
      [
        ['outbreak', 1],
        ['venom1', 3],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['outbreak', 'venom1', 'venom1', 'venom1'] : []),
    );
    expect(
      events(r2.log, 'damage')
        .filter((e) => e.source === 'player')
        .map((e) => e.hpLoss),
    ).toEqual([11]);
  });

  it('Envenom hits count as applications too', () => {
    const r = run(
      [
        ['outbreak', 1],
        ['envenom', 1],
        ['strike', 3],
        ['blocker', 2],
      ],
      (t) => (t === 1 ? ['outbreak', 'envenom', 'strike', 'strike', 'strike'] : []),
    );
    const outbreak = events(r.log, 'damage').filter((e) => e.amount === 11);
    expect(outbreak).toHaveLength(1);
  });
});

describe('Mirage', () => {
  it('gains Block equal to the Poison on ALL living enemies', () => {
    const r = run(
      [
        ['mirage', 1],
        ['haze', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['haze', 'mirage'] : []),
      { enemyIds: ['idle', 'idle2'] },
    );
    expect(events(r.log, 'block').map((e) => e.amount)).toEqual([8]);
  });

  it('is 0 with no Poison', () => {
    const r = run(
      [
        ['mirage', 1],
        ['blocker', 3],
      ],
      (t) => (t === 1 ? ['mirage'] : []),
    );
    expect(events(r.log, 'block').map((e) => e.amount)).toEqual([0]);
  });
});
