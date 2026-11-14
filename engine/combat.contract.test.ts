/** #105 contract effects throw until their mechanic cards implement them. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, runCombat, simulateCombat } from './combat';
import { CONTRACT_EFFECT_SAMPLES, cards, makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, passive, scripted, withEnemy } from './combatTestHelpers';
import type { CardDef } from './types';

/**
 * Contract effects the engine simulates now: #106 loseHp, #107 draw and drawUntil, #108 exhaustCards, #116 addCards and
 * transformCards, #115 heal, gainMaxHp, loseMaxHp (combat.statuses.test.ts), #114 playCards and addReplay
 * (combat.playCards.test.ts), #110 applyEnemyPower, schedule, dealDamage, enemyLoseHp, setCost (combat.temporary.test.ts),
 * #111 conditional, repeat, attackFrom, gainBlockFrom, growDamage and the perfectedStrike script (combat.conditional.test.ts).
 */
const SIMULATED = [
  'loseHp',
  'draw',
  'drawUntil',
  'exhaustCards',
  'heal',
  'applyPower',
  'gainMaxHp',
  'loseMaxHp',
  'addCards',
  'transformCards',
  'conditional',
  'repeat',
  'attackFrom',
  'gainBlockFrom',
  'growDamage',
  'script',
  'applyEnemyPower',
  'schedule',
  'dealDamage',
  'enemyLoseHp',
  'enemyGainStrength',
  'setCost',
  'playCards',
  'addReplay',
  'moveCards',
  'moveSelf',
  'upgradeCards',
  'spawnEnemies', // #322: simulated on enemy moves and onDeath (combat.summon322.test.ts); a card throws a different error
];

describe('#105 contract effects are not simulated yet', () => {
  it('covers every contract effect type exactly once', () => {
    const types = CONTRACT_EFFECT_SAMPLES.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toHaveLength(28);
  });

  it.each(CONTRACT_EFFECT_SAMPLES.filter((e) => !SIMULATED.includes(e.type)).map((e) => [e.type, e] as const))(
    'playing a card with "%s" throws "not simulated yet"',
    (type, effect) => {
      const data = makeGameData();
      const probe: CardDef = {
        ...cards.strike!,
        id: 'probe',
        code: 'Pr',
        name: 'Probe',
        cost: 0,
        effects: [effect],
        upgraded: null,
      };
      data.cards.probe = probe;
      const strat = scripted((turn) => (turn === 1 ? ['probe'] : []));
      expect(() => simulateCombat(data, cfg({ deck: deckOf(['probe', 5]) }), strat)).toThrow(
        new RegExp(`Effect "${type}" is not simulated yet`),
      );
    },
  );

  it('a contract effect on an enemy move also throws', () => {
    // #271: `heal` is simulated on enemy moves now (the enemy heals itself); gainMaxHp is not.
    const e = makeEnemy('grower', 50, { grow: { name: 'Grow', effects: [{ type: 'gainMaxHp', amount: 5 }] } });
    const data = withEnemy(makeGameData(), e);
    expect(() => simulateCombat(data, cfg({ enemyId: 'grower', deck: [] }), passive)).toThrow(
      /"gainMaxHp" is not simulated yet/,
    );
  });

  it('new optional state and card fields are absent, so existing combats are unchanged', () => {
    const r = runCombat(makeGameData(), cfg(), { log: true });
    expect(
      r.log!.some((ev) =>
        [
          'loseHp',
          'heal',
          'maxHp',
          'powerApplied',
          'powerRemoved',
          'moved',
          'generated',
          'upgraded',
          'transformed',
          'costChanged',
          'replay',
          'enemySkip',
        ].includes(ev.t),
      ),
    ).toBe(false);
    const inst = makeCardInstance(cards.strike!, false, 0);
    expect(Object.keys(inst).sort()).toEqual([
      'cardId',
      'cost',
      'effects',
      'keywords',
      'name',
      'rarity',
      'type',
      'uid',
      'upgraded',
    ]);
  });
});
