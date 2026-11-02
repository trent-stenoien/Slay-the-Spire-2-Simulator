/** #106 / #107 strategy rules: self-damage cards, draw cards, Battle Trance, re-planning after a draw. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import { createStrategy, pickAttack, pickBlock, GREEDY_CONFIG, blockFirstConfig } from './strategies';
import { cards } from './testFixtures';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import type { CardDef, GameData, StrategyConfig } from './types';

const extra: Record<string, CardDef> = {
  hemo: {
    ...cards.strike!,
    id: 'hemo',
    code: 'Hm',
    effects: [
      { type: 'loseHp', amount: 2 },
      { type: 'attack', damage: 15, hits: 1 },
    ],
    upgraded: null,
  },
  /** Strike-sized attack that draws: wins the tie against Strike. */
  pommel: {
    ...cards.strike!,
    id: 'pommel',
    code: 'Pm',
    effects: [
      { type: 'attack', damage: 6, hits: 1 },
      { type: 'draw', amount: 1 },
    ],
    upgraded: null,
  },
  /** Defend-sized block that draws: wins the tie against Defend. */
  shrug: {
    ...cards.defend!,
    id: 'shrug',
    code: 'Sh',
    effects: [
      { type: 'gainBlock', amount: 5 },
      { type: 'draw', amount: 1 },
    ],
    upgraded: null,
  },
  soul: { ...cards.defend!, id: 'soul', code: 'So', cost: 0, effects: [{ type: 'draw', amount: 2 }], upgraded: null },
  trance: {
    ...cards.defend!,
    id: 'trance',
    code: 'Tr',
    cost: 0,
    effects: [
      { type: 'draw', amount: 3 },
      { type: 'applyPower', power: 'noDraw', amount: 1 },
    ],
    upgraded: null,
  },
  /** 0-cost 30-damage attack, for the re-planning test. */
  big: {
    ...cards.strike!,
    id: 'big',
    code: 'Bg',
    cost: 0,
    effects: [{ type: 'attack', damage: 30, hits: 1 }],
    upgraded: null,
  },
};

/** Dummy-enemy data with the extra cards; `innate` card ids get Innate so the opening hand is fixed. */
function data(...innate: string[]): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  for (const id of innate) d.cards[id] = { ...d.cards[id]!, keywords: [...d.cards[id]!.keywords, 'innate'] };
  return d;
}

const GREEDY: StrategyConfig = GREEDY_CONFIG;
const BLOCK0: StrategyConfig = blockFirstConfig(0);

/** Card ids the strategy played on `turn`. */
function playsOnTurn(d: GameData, strategy: StrategyConfig, deck: ReturnType<typeof deckOf>, turn = 1, seed = 1) {
  const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck, strategy, seed }), createStrategy(strategy), { log: true });
  const log = r.log!;
  const start = log.findIndex((e) => e.t === 'turnStart' && e.turn === turn && e.side === 'player');
  const end = log.findIndex((e) => e.t === 'turnEnd' && e.turn === turn && e.side === 'player');
  return events(log.slice(start, end), 'play').map((p) => p.cardId);
}

describe('#106 strategies and self-damage cards', () => {
  it('rank self-damage cards like normal attacks, ignoring the HP cost', () => {
    const d = data('hemo', 'strike');
    const plays = playsOnTurn(d, GREEDY, deckOf(['hemo', 1], ['strike', 4]));
    expect(plays[0]).toBe('hemo');
  });

  it('never play a self-damage card that would drop you to 0 HP; play it when you survive', () => {
    const d = data();
    d.characters.ironclad!.maxHp = 2;
    for (const config of [GREEDY, BLOCK0]) {
      const r = simulateCombat(
        d,
        cfg({ enemyId: 'dummy', deck: deckOf(['hemo', 5]), strategy: config }),
        createStrategy(config),
        {
          log: true,
        },
      );
      expect(events(r.log, 'play')).toHaveLength(0);
      expect(r.outcome).toBe('turnCap');
    }
    d.characters.ironclad!.maxHp = 3;
    expect(playsOnTurn(d, GREEDY, deckOf(['hemo', 5]))).toEqual(['hemo']);
  });
});

describe('#107 strategies and draw cards', () => {
  it('pure draw cards are played first while there is something to draw', () => {
    const d = data('soul', 'strike');
    for (const config of [GREEDY, BLOCK0]) {
      expect(playsOnTurn(d, config, deckOf(['soul', 1], ['strike', 4], ['defend', 5]))[0]).toBe('soul');
    }
  });

  it('pure draw cards are not played when nothing is left to draw', () => {
    const d = data();
    // Exactly 5 cards: the whole deck is in hand and both piles are empty, so Soul waits. Once a
    // Strike is in the discard pile there is something to draw again.
    const plays = playsOnTurn(d, GREEDY, deckOf(['soul', 1], ['strike', 4]));
    expect(plays.slice(0, 2)).toEqual(['strike', 'soul']);
  });

  it('pure draw cards are not played under Battle Trance (no draw)', () => {
    // Opening hand (Innate): Battle Trance + 4 Strikes; the draw pile is 3 Souls. Battle Trance
    // draws the Souls, and they are useless for the rest of the turn.
    const d = data('trance', 'strike');
    const plays = playsOnTurn(d, GREEDY, deckOf(['trance', 1], ['strike', 4], ['soul', 3]));
    expect(plays).toEqual(['trance', 'strike', 'strike', 'strike']);
  });

  it('draw cards that attack or block rank by their attack/block value and win ties', () => {
    const strike = makeCardInstance(cards.strike!, false, 0);
    const pommel = makeCardInstance(extra.pommel!, false, 1);
    const bash = makeCardInstance(cards.bash!, false, 2);
    expect(pickAttack([strike, pommel], 3)).toBe(pommel);
    // Value comes first: Bash (Vulnerable) still beats a drawing Strike-sized attack.
    expect(pickAttack([strike, pommel, bash], 3)).toBe(bash);
    const defend = makeCardInstance(cards.defend!, false, 3);
    const shrug = makeCardInstance(extra.shrug!, false, 4);
    expect(pickBlock([defend, shrug], 3)).toBe(shrug);
    const bigDefend = makeCardInstance({ ...cards.defend!, effects: [{ type: 'gainBlock', amount: 8 }] }, false, 5);
    expect(pickBlock([shrug, bigDefend], 3)).toBe(bigDefend);
  });

  it('Battle Trance is played after every other draw card that turn', () => {
    // Opening hand (all Innate): Battle Trance, Soul, Pommel, Strike, Strike. Greedy: Soul (pure
    // draw) → Pommel (wins the tie with Strike) → Battle Trance once no other draw card is playable.
    const d = data('trance', 'soul', 'pommel', 'strike');
    const plays = playsOnTurn(
      d,
      GREEDY,
      deckOf(['trance', 1], ['soul', 1], ['pommel', 1], ['strike', 2], ['defend', 10]),
    );
    expect(plays.slice(0, 3)).toEqual(['soul', 'pommel', 'trance']);
  });

  it('Battle Trance waits while a draw card is still playable, then goes once none is', () => {
    // Block strategy, no incoming damage: it attacks. Hand: Battle Trance, Pommel, Strike x3 (Innate).
    const d = data('trance', 'pommel', 'strike');
    const plays = playsOnTurn(d, BLOCK0, deckOf(['trance', 1], ['pommel', 1], ['strike', 3], ['defend', 10]));
    expect(plays.indexOf('trance')).toBeGreaterThan(plays.indexOf('pommel'));
  });

  it('after a draw, the next decision uses the current hand and energy (re-planning)', () => {
    // Opening hand (Innate): Pommel + 4 Strikes. The draw pile is a single 0-cost 30-damage card.
    // Greedy plays Pommel (ties Strike, draws), draws the big card, and must play it next.
    const d = data('pommel', 'strike');
    const plays = playsOnTurn(d, GREEDY, deckOf(['pommel', 1], ['strike', 4], ['big', 1]));
    expect(plays).toEqual(['pommel', 'big', 'strike', 'strike']);
  });
});
