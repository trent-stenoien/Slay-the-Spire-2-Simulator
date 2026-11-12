/** #180 Slimed: costs 1, draws 1 card, exhausts. Uses the real card data. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { cfg, deckOf, events, logged, scripted } from './combatTestHelpers';

describe('Slimed (#180)', () => {
  it('costs 1 energy, draws 1 card and exhausts', () => {
    // 6 Slimed: 5 in hand, 1 in the draw pile.
    const r = logged(
      gameData,
      scripted((t) => (t === 1 ? ['slimed'] : [])),
      {
        ...cfg(),
        deck: deckOf(['slimed', 6]),
      },
    );
    const log = r.log!;
    const play = events(log, 'play')[0]!;
    expect(play.cardId).toBe('slimed');
    expect(play.energyLeft).toBe(2);
    const at = log.findIndex((e) => e.t === 'play');
    const rest = log.slice(at + 1);
    const after = rest.slice(
      0,
      rest.findIndex((e) => e.t === 'turnEnd'),
    ); // draws during the play itself
    expect(after.filter((e) => e.t === 'draw')).toHaveLength(1);
    expect(events(log, 'exhaust')[0]).toMatchObject({ uid: play.uid, cardId: 'slimed', reason: 'keyword' });
  });
});
