/** #270: boss player debuffs Disintegration, Mind Rot, Sloth, Waste Away (powers, not status cards). */
import { describe, expect, it } from 'vitest';
import { cfg, deckOf, dummyData, events, logged, passive, withEnemy } from './combatTestHelpers';
import { simulateCombat } from './combat';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import type { PowerId, Strategy, StrategyView } from './types';

/** Records the first view of each turn, then ends the turn. */
function turnViews(): { strategy: Strategy; views: StrategyView[] } {
  const views: StrategyView[] = [];
  let turn = -1;
  return {
    views,
    strategy: {
      decide(view) {
        if (view.state.turn !== turn) {
          turn = view.state.turn;
          views.push(structuredClone(view) as StrategyView);
        }
        return { kind: 'endTurn' };
      },
    },
  };
}

const start = (powers: Partial<Record<PowerId, number>>) => ({ enemyId: 'dummy', playerStart: { powers } });

describe('#270 boss player debuffs', () => {
  it('Waste Away: the energy refill is [amount] lower, never below 0', () => {
    const a = turnViews();
    simulateCombat(dummyData(), cfg(start({ wasteAway: 1 })), a.strategy);
    expect(a.views[0]!.state.player.energy).toBe(2);
    const b = turnViews();
    simulateCombat(dummyData(), cfg(start({ wasteAway: 5 })), b.strategy);
    expect(b.views[0]!.state.player.energy).toBe(0);
  });

  it('Mind Rot: the start-of-turn draw is [amount] smaller, never below 0', () => {
    const a = turnViews();
    simulateCombat(dummyData(), cfg(start({ mindRot: 1 })), a.strategy);
    expect(a.views[0]!.state.player.hand).toHaveLength(4);
    const b = turnViews();
    simulateCombat(dummyData(), cfg(start({ mindRot: 9 })), b.strategy);
    expect(b.views[0]!.state.player.hand).toHaveLength(0);
  });

  it('Sloth: after [amount] cards played from the hand, nothing more is playable this turn', () => {
    const playableCounts: number[] = [];
    const strategy: Strategy = {
      decide(view) {
        if (view.state.turn !== 1) return { kind: 'endTurn' };
        playableCounts.push(view.playable.length);
        const c = view.playable[0];
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    const r = simulateCombat(
      dummyData(),
      cfg({ ...start({ sloth: 1, energyPerTurn: 5 }), deck: deckOf(['defend', 10]) }),
      strategy,
      { log: true },
    );
    const turn1Plays = r
      .log!.slice(
        0,
        r.log!.findIndex((e) => e.t === 'turnEnd'),
      )
      .filter((e) => e.t === 'play');
    expect(turn1Plays).toHaveLength(1);
    expect(playableCounts.at(-1)).toBe(0);
  });

  it('Sloth: cards played by an effect do not count toward the cap (Havoc plays the top card for free)', () => {
    const data = dummyData();
    data.cards.havoc = {
      ...cards.defend!,
      id: 'havoc',
      code: 'Zz',
      name: 'havoc',
      cost: 1,
      effects: [{ type: 'playCards', from: 'draw', mode: 'top', count: 1, exhaust: true }],
      upgraded: null,
    };
    const r = logged(
      data,
      {
        decide(view) {
          if (view.state.turn !== 1) return { kind: 'endTurn' };
          const c = view.playable.find((p) => p.cardId === 'havoc') ?? view.playable[0];
          return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
        },
      },
      { ...start({ sloth: 2 }), deck: deckOf(['havoc', 1], ['defend', 9]) },
    );
    const turn1 = r.log!.slice(
      0,
      r.log!.findIndex((e) => e.t === 'turnEnd'),
    );
    const plays = turn1.filter((e) => e.t === 'play');
    // Havoc (hand) + the card it plays (by effect) + one more from the hand.
    expect(plays.filter((e) => e.t === 'play' && !e.by)).toHaveLength(2);
    expect(plays.filter((e) => e.t === 'play' && e.by === 'effect')).toHaveLength(1);
  });

  it('Disintegration: take [amount] damage at the end of the turn; Block absorbs it', () => {
    const r = logged(dummyData(), passive, start({ disintegration: 6 }));
    const dmg = events(r.log, 'damage').filter((e) => e.target === 'player');
    expect(dmg[0]).toMatchObject({ amount: 6, blocked: 0, hpLoss: 6 });
    const blocked = logged(dummyData(), passive, {
      enemyId: 'dummy',
      playerStart: { powers: { disintegration: 6, plating: 5 } },
    });
    // Plating gives 4 Block (5 − 1 at turn start) before Disintegration hits.
    expect(events(blocked.log, 'damage').find((e) => e.target === 'player')).toMatchObject({
      amount: 6,
      blocked: 4,
      hpLoss: 2,
    });
  });

  it('Disintegration: Intangible makes it 1', () => {
    const r = logged(dummyData(), passive, start({ disintegration: 8, intangible: 5 }));
    expect(events(r.log, 'damage').find((e) => e.target === 'player')).toMatchObject({ amount: 1 });
  });

  it('Disintegration can kill the player', () => {
    const r = simulateCombat(dummyData(), cfg({ ...start({ disintegration: 100 }), startHp: 5 }), passive);
    expect(r.outcome).toBe('loss');
    expect(r.turns).toBe(1);
  });

  it('an enemy move applyPower puts the power on the player, and stacks add', () => {
    const curse = makeEnemy('curser', 999, {
      curse: { name: 'Curse', effects: [{ type: 'applyPower', power: 'disintegration', amount: 6 }] },
    });
    const { strategy, views } = turnViews();
    const r = simulateCombat(withEnemy(makeGameData(), curse), cfg({ enemyId: 'curser' }), strategy, { log: true });
    expect(views[1]!.state.player.powers?.disintegration).toBe(6);
    expect(views[2]!.state.player.powers?.disintegration).toBe(12);
    expect(events(r.log, 'powerApplied')[0]).toMatchObject({ side: 'player', power: 'disintegration' });
  });
});
