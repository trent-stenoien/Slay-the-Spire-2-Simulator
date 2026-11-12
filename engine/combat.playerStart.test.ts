/** #210: CombatConfig.playerStart — statuses the player starts the combat with (golden fixtures). */
import { describe, expect, it } from 'vitest';
import { cfg, dummyData, events, logged, passive } from './combatTestHelpers';
import { simulateCombat } from './combat';
import type { Strategy, StrategyView } from './types';

/** Records the first view the strategy sees, then ends every turn. */
function firstView(): { strategy: Strategy; seen: () => StrategyView } {
  let first: StrategyView | undefined;
  return {
    strategy: {
      decide(view) {
        first ??= structuredClone(view) as StrategyView;
        return { kind: 'endTurn' };
      },
    },
    seen: () => first!,
  };
}

describe('#210 playerStart', () => {
  it('starts the player with Strength, debuffs and powers before the first turn', () => {
    const { strategy, seen } = firstView();
    simulateCombat(
      dummyData(),
      cfg({
        enemyId: 'dummy',
        playerStart: { strength: 2, debuffs: { vulnerable: 3, weak: 1 }, powers: { plating: 4 } },
      }),
      strategy,
    );
    const p = seen().state.player;
    expect(p.strength).toBe(2);
    expect(p.debuffs).toMatchObject({ vulnerable: 3, weak: 1, frail: 0 });
    // Plating then drops by 1 at the start of turn 1, like every turn.
    expect(p.powers?.plating).toBe(3);
  });

  it('logs the statuses before the first shuffle', () => {
    const r = logged(dummyData(), passive, { enemyId: 'dummy', playerStart: { strength: 1, debuffs: { frail: 2 } } });
    const log = r.log!;
    const shuffle = log.findIndex((e) => e.t === 'shuffle');
    expect(log.findIndex((e) => e.t === 'strength')).toBeLessThan(shuffle);
    expect(events(log, 'debuff')[0]).toMatchObject({ side: 'player', kind: 'frail', amount: 2 });
  });

  it('changes nothing when absent or empty', () => {
    const base = logged(dummyData(), passive, { enemyId: 'dummy' });
    const empty = logged(dummyData(), passive, { enemyId: 'dummy', playerStart: {} });
    expect(empty.log).toEqual(base.log);
  });
});
