/** #268 Master Planner (a played Skill gains Sly) and The Hunt (extra card reward on a kill), real card data. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummy, scripted, withEnemy } from './combatTestHelpers';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import type { CardDef } from './types';

const real = (id: string, innate = true): CardDef => {
  const c = structuredClone(gameData.cards[id]!);
  return innate ? { ...c, keywords: [...c.keywords, 'innate'] } : c;
};
const skill = (id: string, cost: number, keywords: CardDef['keywords'] = ['innate']): CardDef => ({
  ...cards.defend!,
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  cost,
  keywords,
  effects: [{ type: 'gainBlock', amount: 5 }],
  upgraded: null,
});

describe('#268 Master Planner', () => {
  it('data: Power, cost 2 (1), applies masterPlanner; simulated', () => {
    const c = gameData.cards.master_planner!;
    expect(c.simulated).toBe(true);
    expect(c.cost).toBe(2);
    expect(c.upgraded?.cost).toBe(1);
    expect(c.effects).toEqual([{ type: 'applyPower', power: 'masterPlanner', amount: 1 }]);
  });

  it('a Skill played after it gains Sly for the rest of combat; one played before, and Attacks, do not', () => {
    const d = withEnemy(makeGameData(), dummy());
    d.cards.master_planner = real('master_planner');
    d.cards.early = skill('early', 0);
    d.cards.late = skill('late', 0);
    d.cards.strike = { ...d.cards.strike!, keywords: ['innate'] };
    let seen: string[] | undefined;
    const plan = scripted((t) => (t === 1 ? ['early', 'master_planner', 'late', 'strike'] : []));
    const r = simulateCombat(
      d,
      cfg({
        enemyId: 'dummy',
        deck: deckOf(['master_planner', 1], ['early', 1], ['late', 1], ['strike', 1], ['defend', 6]),
        seed: 3,
      }),
      {
        decide(view) {
          if (view.state.turn === 2 && !seen) {
            const all = [...view.state.player.hand, ...view.state.player.drawPile, ...view.state.player.discardPile];
            seen = all.filter((c) => c.keywords.includes('sly')).map((c) => c.cardId);
            return { kind: 'endTurn' };
          }
          return plan.decide(view);
        },
      },
    );
    expect(r.turns).toBeGreaterThan(1);
    expect(seen).toEqual(['late']);
  });
});

describe('#268 The Hunt', () => {
  const hunt = (hp: number, upgraded = false, turns = 1) => {
    const d = withEnemy(makeGameData(), makeEnemy('target', hp, { wait: { name: 'Wait', effects: [] } }));
    d.cards.the_hunt = real('the_hunt');
    return simulateCombat(
      d,
      cfg({ enemyId: 'target', deck: deckOf(['the_hunt', 5, upgraded]), seed: 3 }),
      scripted((t) => (t <= turns ? ['the_hunt'] : [])),
    );
  };

  it('data: 10 damage (15), then a fatal conditional with gainCardReward; simulated', () => {
    const c = gameData.cards.the_hunt!;
    expect(c.simulated).toBe(true);
    expect(c.effects[1]).toEqual({ type: 'conditional', if: { kind: 'fatal' }, then: [{ type: 'gainCardReward' }] });
    expect(c.upgraded?.effects?.[0]).toMatchObject({ damage: 15 });
  });

  it('a killing hit gains one card reward (upgraded: 15 damage kills 15 HP)', () => {
    expect(hunt(10).rewards).toEqual({ gold: 0, potions: 0, cardRewards: 1 });
    expect(hunt(15, true).rewards).toEqual({ gold: 0, potions: 0, cardRewards: 1 });
  });

  it('a hit that does not kill gains nothing (rewards omitted)', () => {
    expect(hunt(11).rewards).toBeUndefined();
    expect(hunt(15).rewards).toBeUndefined();
  });
});
