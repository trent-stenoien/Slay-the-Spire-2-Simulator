/** #261 Sly: the strategies play a "discard N" card first while a Sly card is in the hand. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { gameData } from '../data';

const firstPlays = (sly: boolean) => {
  const d = dummyData();
  for (const id of ['survivor', 'untouchable', 'dagger_throw', 'strike', 'defend']) {
    d.cards[id] = structuredClone(gameData.cards[id]!);
  }
  if (!sly) d.cards.untouchable!.keywords = [];
  for (const id of ['survivor', 'untouchable', 'dagger_throw']) d.cards[id]!.keywords.push('innate');
  const deck = deckOf(['survivor', 1], ['untouchable', 1], ['dagger_throw', 1], ['strike', 4], ['defend', 4]);
  const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck, seed: 2 }), createStrategy(GREEDY_CONFIG), {
    log: true,
  });
  const log = r.log ?? [];
  const end = log.findIndex((e) => e.t === 'turnStart' && e.side === 'enemy');
  return events(log.slice(0, end), 'play');
};

describe('#261 strategies with a Sly card in hand', () => {
  it('play the cheapest discard card first, and the Sly card is discarded and played for free', () => {
    const plays = firstPlays(true);
    expect(plays[0]!.cardId).toBe('survivor');
    expect(plays[1]).toMatchObject({ cardId: 'untouchable', by: 'effect' });
  });

  it('without a Sly card the discard card is not pulled to the front', () => {
    expect(firstPlays(false)[0]!.cardId).not.toBe('survivor');
  });
});
