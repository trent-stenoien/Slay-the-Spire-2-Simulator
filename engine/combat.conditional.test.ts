/** #111 Conditional and scaling cards: the real card data run through the engine. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, dummy, events, passive, withEnemy } from './combatTestHelpers';
import { countStrikes, isStrikeName, uniqueDebuffs } from './rules';
import type { CardDef, Condition, Decision, Effect, Strategy, StrategyView } from './types';

/** Real cards by id. */
const real = (id: string): CardDef => structuredClone(gameData.cards[id]!);

/** A zero-cost helper card with the given effects. */
const helper = (id: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...real('defend'),
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  cost: 0,
  keywords: ['innate'],
  effects,
  upgraded: null,
  ...extra,
});

function world(extra: Record<string, CardDef> = {}, cardIds: string[] = [], enemy = dummy()) {
  const d = withEnemy(makeGameData(), enemy);
  for (const id of cardIds) d.cards[id] = real(id);
  Object.assign(d.cards, extra);
  return d;
}

/** Plays the listed cardIds in order on turn 1, then ends the turn (a missing card throws). */
function turnOne(...order: string[]): Strategy {
  const queue = [...order];
  return {
    decide(view: StrategyView): Decision {
      if (view.state.turn !== 1) return { kind: 'endTurn' };
      const want = queue.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable; playable: ${view.playable.map((p) => p.cardId).join(',')}`);
      return { kind: 'play', uid: c.uid };
    },
  };
}

const run = (data: ReturnType<typeof world>, strategy: Strategy, deck = deckOf(), overrides = {}) =>
  simulateCombat(data, cfg({ enemyId: 'dummy', deck, ...overrides }), strategy, { log: true });

const playerHits = (log: ReturnType<typeof run>['log']) => events(log, 'damage').filter((e) => e.source === 'player');
const blockGains = (log: ReturnType<typeof run>['log']) => events(log, 'block').filter((e) => e.side === 'player');

describe('#111 name and debuff rules', () => {
  it('"Strike" anywhere in the name counts, case-sensitive, upgraded "+" included', () => {
    for (const name of ['Strike', 'Strike+', 'Perfected Strike', 'Twin Strike+', 'Pommel Strike']) {
      expect(isStrikeName(name)).toBe(true);
    }
    for (const name of ['Defend', 'Bash', 'strike', 'Stroke']) expect(isStrikeName(name)).toBe(false);
  });

  it('uniqueDebuffs counts Vulnerable, Weak, Frail, Poison, negative Strength and temporary Strength loss once each', () => {
    const base = { debuffs: { vulnerable: 0, weak: 0, frail: 0 }, poison: 0, strength: 0 };
    expect(uniqueDebuffs(base as never)).toBe(0);
    const all = {
      debuffs: { vulnerable: 3, weak: 1, frail: 2 },
      poison: 4,
      strength: -2,
      powers: { strengthLossThisTurn: 9 },
    };
    expect(uniqueDebuffs(all as never)).toBe(6);
    expect(uniqueDebuffs({ ...base, debuffs: { vulnerable: 5, weak: 0, frail: 0 } } as never)).toBe(1);
  });

  it('countStrikes counts all four piles', () => {
    const c = (name: string) => ({ name }) as never;
    const player = {
      drawPile: [c('Strike')],
      hand: [c('Strike+'), c('Defend')],
      discardPile: [c('Twin Strike')],
      exhaustPile: [c('Perfected Strike')],
    };
    expect(countStrikes(player as never)).toBe(4);
  });
});

describe('#111 Perfected Strike', () => {
  // Innate so it is always in the opening hand, whatever the shuffle.
  const ps = (upgraded = false) => {
    const d = world({}, ['perfected_strike', 'strike']);
    d.cards.perfected_strike!.keywords = ['innate'];
    return { d, deck: deckOf(['perfected_strike', 1, upgraded], ['strike', 4], ['strike', 1, true], ['defend', 3]) };
  };

  it('counts itself and every Strike in the Draw, Hand, Discard and Exhaust piles, Strike+ included', () => {
    const { d, deck } = ps();
    const r = run(d, turnOne('perfected_strike'), deck);
    // 1 Perfected Strike + 4 Strike + 1 Strike+ = 6 cards: 6 + 2 × 6.
    expect(playerHits(r.log)[0]!.amount).toBe(18);
  });

  it('upgraded: 3 per Strike', () => {
    const { d, deck } = ps(true);
    const r = run(d, turnOne('perfected_strike'), deck);
    expect(playerHits(r.log)[0]!.amount).toBe(6 + 3 * 6);
  });

  it('a Strike played to the discard pile still counts; Strength and Vulnerable apply to the total', () => {
    const { d, deck } = ps();
    d.cards.bash = real('bash');
    d.cards.flex = helper('flex', [{ type: 'gainStrength', amount: 2 }]);
    d.cards.vuln = helper('vuln', [{ type: 'applyVulnerable', amount: 1 }]);
    const r = run(d, turnOne('vuln', 'flex', 'perfected_strike'), [...deck, ...deckOf(['flex', 1], ['vuln', 1])]);
    expect(playerHits(r.log)[0]!.amount).toBe(Math.floor((6 + 2 * 6 + 2) * 1.5));
  });

  it('Strikes created mid-combat count; the count drops only when one is transformed into a non-Strike', () => {
    const { d, deck } = ps();
    d.cards.maker = helper('maker', [
      { type: 'addCards', source: { kind: 'card', cardId: 'strike' }, count: 2, to: 'discard' },
    ]);
    d.cards.entropy = helper('entropy', [
      {
        type: 'transformCards',
        from: 'discard',
        mode: 'all',
        filter: { cardId: 'strike' },
        into: { kind: 'card', cardId: 'defend' },
      },
    ]);
    const withDeck = [...deck, ...deckOf(['maker', 1], ['entropy', 1])];
    // hand: PS + maker + entropy + 2 more; make sure they are all in the opening hand (innate).
    d.cards.maker!.keywords = ['innate'];
    d.cards.entropy!.keywords = ['innate'];
    d.characters.ironclad!.drawPerTurn = 7;
    const created = run(d, turnOne('maker', 'perfected_strike'), withDeck);
    expect(playerHits(created.log)[0]!.amount).toBe(6 + 2 * (6 + 2));
    // Transform every Strike in the discard pile (the 2 created ones) into Defend: back to 6.
    const dropped = run(d, turnOne('maker', 'entropy', 'perfected_strike'), withDeck);
    expect(playerHits(dropped.log)[0]!.amount).toBe(6 + 2 * 6);
  });
});

describe('#111 Rend, Bully, Dismantle', () => {
  const setup = (...effects: Effect[]) => helper('setup', effects);

  it('Rend: 15 + 5 per unique debuff (Vulnerable, Weak and Poison count; stacks do not)', () => {
    const d = world(
      {
        setup: setup(
          { type: 'applyVulnerable', amount: 3 },
          { type: 'applyWeak', amount: 2 },
          { type: 'applyPoison', amount: 4 },
        ),
      },
      ['rend'],
    );
    const r = run(d, turnOne('setup', 'rend'), deckOf(['setup', 1], ['rend', 1]));
    expect(playerHits(r.log)[0]!.amount).toBe(Math.floor((15 + 5 * 3) * 1.5));
  });

  it('Rend upgraded: 18 + 8 per unique debuff; Frail counts too; no debuff = base damage', () => {
    const d = world({ setup: setup({ type: 'applyFrail', amount: 1 }) }, ['rend']);
    const some = run(d, turnOne('setup', 'rend'), deckOf(['setup', 1], ['rend', 1, true]));
    expect(playerHits(some.log)[0]!.amount).toBe(18 + 8);
    const none = run(d, turnOne('rend'), deckOf(['rend', 1]));
    expect(playerHits(none.log)[0]!.amount).toBe(15);
  });

  it('Bully: +2 per Vulnerable stack (+3 upgraded), then the Vulnerable multiplier', () => {
    const d = world({ setup: setup({ type: 'applyVulnerable', amount: 2 }) }, ['bully']);
    const base = run(d, turnOne('setup', 'bully'), deckOf(['setup', 1], ['bully', 1]));
    expect(playerHits(base.log)[0]!.amount).toBe(Math.floor((4 + 2 * 2) * 1.5));
    const up = run(d, turnOne('setup', 'bully'), deckOf(['setup', 1], ['bully', 1, true]));
    expect(playerHits(up.log)[0]!.amount).toBe(Math.floor((4 + 3 * 2) * 1.5));
    const none = run(d, turnOne('bully'), deckOf(['bully', 1]));
    expect(playerHits(none.log)[0]!.amount).toBe(4);
  });

  it('Dismantle: hits twice only when the enemy is Vulnerable', () => {
    const d = world({ setup: setup({ type: 'applyVulnerable', amount: 1 }) }, ['dismantle']);
    const plain = run(d, turnOne('dismantle'), deckOf(['dismantle', 1]));
    expect(playerHits(plain.log).map((e) => e.amount)).toEqual([8]);
    const vuln = run(d, turnOne('setup', 'dismantle'), deckOf(['setup', 1], ['dismantle', 1, true]));
    expect(playerHits(vuln.log).map((e) => e.amount)).toEqual([15, 15]);
  });
});

describe('#111 Dominate and Molten Fist', () => {
  const vuln = (n: number) => helper('vuln', [{ type: 'applyVulnerable', amount: n }]);

  it('Dominate: Vulnerable first, then 1 Strength per Vulnerable on the enemy', () => {
    const d = world({ vuln: vuln(2) }, ['dominate']);
    const r = run(d, turnOne('vuln', 'dominate'), deckOf(['vuln', 1], ['dominate', 1]));
    expect(events(r.log, 'strength').at(-1)!.total).toBe(3);
    const up = run(d, turnOne('dominate'), deckOf(['dominate', 1, true]));
    expect(events(up.log, 'strength').at(-1)!.total).toBe(2);
  });

  it("Molten Fist: attacks first, then doubles the enemy's Vulnerable", () => {
    const d = world({ vuln: vuln(3) }, ['molten_fist']);
    const r = run(d, turnOne('vuln', 'molten_fist'), deckOf(['vuln', 1], ['molten_fist', 1]));
    expect(playerHits(r.log)[0]!.amount).toBe(15);
    expect(
      events(r.log, 'debuff')
        .filter((e) => e.side === 'enemy' && e.kind === 'vulnerable')
        .at(-1)!.total,
    ).toBe(6);
    const none = run(d, turnOne('molten_fist'), deckOf(['molten_fist', 1, true]));
    expect(playerHits(none.log)[0]!.amount).toBe(14);
    expect(events(none.log, 'debuff').filter((e) => e.kind === 'vulnerable')).toHaveLength(0);
  });
});

describe('#208 Forgotten Ritual (main release)', () => {
  const energyGains = (log: ReturnType<typeof run>['log']) => events(log, 'energy').filter((e) => e.amount > 0);

  it('gains no Energy unless a card was Exhausted this turn', () => {
    const d = world({}, ['forgotten_ritual']);
    const r = run(d, turnOne('forgotten_ritual'), deckOf(['forgotten_ritual', 1]));
    expect(energyGains(r.log).every((e) => e.total <= 3)).toBe(true);
  });

  it('gains 3 Energy (4 upgraded) once a card was Exhausted this turn', () => {
    const burn = helper('burn', [], { keywords: ['innate', 'exhaust'] });
    const d = world({ burn }, ['forgotten_ritual']);
    const r = run(d, turnOne('burn', 'forgotten_ritual'), deckOf(['burn', 1], ['forgotten_ritual', 1]));
    expect(energyGains(r.log).at(-1)!.amount).toBe(3);
    const up = run(d, turnOne('burn', 'forgotten_ritual'), deckOf(['burn', 1], ['forgotten_ritual', 1, true]));
    expect(energyGains(up.log).at(-1)!.amount).toBe(4);
  });
});

describe('#111 Rampage and Maul', () => {
  it('Rampage: +5 each play, and the growth stays with that copy across reshuffles', () => {
    const d = world({}, ['rampage']);
    const played = new Set<string>();
    const strategy: Strategy = {
      decide(view) {
        const mine = [...view.playable].sort((a, b) => a.uid - b.uid);
        const c = mine.find((x) => !played.has(`${x.uid}@${view.state.turn}`));
        if (!c || (view.state.turn === 1 && played.size >= 1)) return { kind: 'endTurn' };
        played.add(`${c.uid}@${view.state.turn}`);
        return { kind: 'play', uid: c.uid };
      },
    };
    const r = run(d, strategy, deckOf(['rampage', 2]));
    const hits = playerHits(r.log).map((e) => e.amount);
    // Turn 1: A 9. Turn 2: A 14, B 9. Turn 3: A 19, B 14.
    expect(hits.slice(0, 5)).toEqual([9, 14, 9, 19, 14]);
  });

  it('Rampage upgraded grows by 9', () => {
    const d = world({}, ['rampage']);
    const strategy: Strategy = {
      decide: (view) => (view.playable.length ? { kind: 'play', uid: view.playable[0]!.uid } : { kind: 'endTurn' }),
    };
    const r = run(d, strategy, deckOf(['rampage', 1, true]));
    expect(
      playerHits(r.log)
        .slice(0, 3)
        .map((e) => e.amount),
    ).toEqual([9, 18, 27]);
  });

  it('Maul: every Maul in every pile grows by 2, including copies in the draw pile', () => {
    const d = world({}, ['maul']);
    const played: Record<number, number> = {};
    // Turn 1: two Mauls. Turn 2: one more (a copy that was in the draw pile or hand during turn 1).
    const strategy: Strategy = {
      decide(view) {
        const turn = view.state.turn;
        const limit = turn === 1 ? 2 : turn === 2 ? 1 : 0;
        if ((played[turn] ?? 0) < limit && view.playable.length) {
          played[turn] = (played[turn] ?? 0) + 1;
          return { kind: 'play', uid: view.playable[0]!.uid };
        }
        return { kind: 'endTurn' };
      },
    };
    const r = run(d, strategy, deckOf(['maul', 7]));
    // First Maul 5, 5; the second already has +2: 7, 7; both grew every Maul to +4: 9, 9.
    expect(playerHits(r.log).map((e) => e.amount)).toEqual([5, 5, 7, 7, 9, 9]);
  });

  it('Maul upgraded grows by 3 and deals 6 twice', () => {
    const d = world({}, ['maul']);
    let plays = 0;
    const strategy: Strategy = {
      decide(view) {
        if (plays < 2 && view.playable.length) {
          plays++;
          return { kind: 'play', uid: view.playable[0]!.uid };
        }
        return { kind: 'endTurn' };
      },
    };
    const r = run(d, strategy, deckOf(['maul', 3, true]));
    expect(playerHits(r.log).map((e) => e.amount)).toEqual([6, 6, 9, 9]);
  });
});

describe('#111 Fisticuffs', () => {
  const hitter = makeEnemy('wall', 999, { wait: { name: 'Wait', effects: [] } });

  it('Block equals the damage dealt', () => {
    const d = world({}, ['fisticuffs']);
    const r = run(d, turnOne('fisticuffs'), deckOf(['fisticuffs', 1]));
    expect(blockGains(r.log).at(-1)!.amount).toBe(7);
    const up = run(d, turnOne('fisticuffs'), deckOf(['fisticuffs', 1, true]));
    expect(blockGains(up.log).at(-1)!.amount).toBe(9);
  });

  it('counts damage after Strength and Vulnerable, damage absorbed by enemy Block included', () => {
    const d = world(
      {
        flex: helper('flex', [{ type: 'gainStrength', amount: 3 }]),
        vuln: helper('vuln', [{ type: 'applyVulnerable', amount: 1 }]),
        wall: helper('wall', [{ type: 'attack', damage: 0, hits: 1 }]),
      },
      ['fisticuffs'],
    );
    const r = run(d, turnOne('flex', 'vuln', 'fisticuffs'), deckOf(['flex', 1], ['vuln', 1], ['fisticuffs', 1]));
    expect(blockGains(r.log).at(-1)!.amount).toBe(Math.floor((7 + 3) * 1.5));
    expect(hitter.id).toBe('wall');
  });

  it('damage soaked up by enemy Block still counts: 7 into 10 Block gains 7 (no HP lost by the enemy)', () => {
    const guard = makeEnemy('guard', 999, { up: { name: 'Up', effects: [{ type: 'gainBlock', amount: 10 }] } });
    const d = world({}, ['fisticuffs'], guard);
    const strategy: Strategy = {
      decide: (view) => {
        const c = view.state.turn === 2 && view.playable.find((p) => p.cardId === 'fisticuffs');
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    const r = run(d, strategy, deckOf(['fisticuffs', 1]), { enemyId: 'guard' });
    const hit = events(r.log, 'damage').find((e) => e.target === 'enemy')!;
    expect(hit).toMatchObject({ amount: 7, blocked: 7, hpLoss: 0 });
    expect(blockGains(r.log).at(-1)!.amount).toBe(7);
  });

  it('Dexterity applies to the Block gained', () => {
    const d = world({ dex: helper('dex', [{ type: 'applyPower', power: 'dexterity', amount: 2 }]) }, ['fisticuffs']);
    const r = run(d, turnOne('dex', 'fisticuffs'), deckOf(['dex', 1], ['fisticuffs', 1]));
    expect(blockGains(r.log).at(-1)!.amount).toBe(9);
  });

  it('Frail applies to the Block gained', () => {
    const frailer = makeEnemy('frailer', 999, { hex: { name: 'Hex', effects: [{ type: 'applyFrail', amount: 3 }] } });
    const d = world({}, ['fisticuffs'], frailer);
    const strategy: Strategy = {
      decide: (view) => {
        const c = view.state.turn === 2 && view.playable.find((p) => p.cardId === 'fisticuffs');
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    const r = run(d, strategy, deckOf(['fisticuffs', 1]), { enemyId: 'frailer' });
    expect(blockGains(r.log).at(-1)!.amount).toBe(Math.floor(7 * 0.75));
  });

  it('overkill counts: 7 damage to a 1 HP enemy is 7 (the damage dealt, not the HP lost)', () => {
    // A fatal conditional resolves after the kill, so the Block that follows reads the full hit.
    const tiny = makeEnemy('tiny', 1, { wait: { name: 'Wait', effects: [] } });
    const d = world(
      {
        overkill: helper('overkill', [
          { type: 'attack', damage: 7, hits: 1 },
          {
            type: 'conditional',
            if: { kind: 'fatal' },
            then: [{ type: 'gainBlockFrom', amount: 0, bonusPer: { per: 'lastAttackDamage', amount: 1 } }],
          },
        ]),
      },
      [],
      tiny,
    );
    const r = run(d, turnOne('overkill'), deckOf(['overkill', 1]), { enemyId: 'tiny' });
    expect(r.outcome).toBe('win');
    expect(blockGains(r.log).at(-1)!.amount).toBe(7);
  });
});

describe('#111 Body Slam, Entrench, Stack, Expect a Fight, Mind Blast', () => {
  const block = (n: number) => helper('block', [{ type: 'gainBlock', amount: n }]);

  it('Body Slam deals damage equal to the Block you have (Strength adds), 0 with no Block', () => {
    const d = world({ block: block(9), flex: helper('flex', [{ type: 'gainStrength', amount: 2 }]) }, ['body_slam']);
    const r = run(d, turnOne('block', 'flex', 'body_slam'), deckOf(['block', 1], ['flex', 1], ['body_slam', 1]));
    expect(playerHits(r.log)[0]!.amount).toBe(11);
    const none = run(d, turnOne('body_slam'), deckOf(['body_slam', 1]));
    expect(playerHits(none.log)[0]!.amount).toBe(0);
  });

  it('Entrench doubles your Block; Dexterity and Frail do not change the doubling', () => {
    const d = world({ block: block(9), dex: helper('dex', [{ type: 'applyPower', power: 'dexterity', amount: 3 }]) }, [
      'entrench',
    ]);
    const r = run(d, turnOne('block', 'entrench'), deckOf(['block', 1], ['entrench', 1]));
    expect(blockGains(r.log).map((e) => e.total)).toEqual([9, 18]);
    const dex = run(d, turnOne('dex', 'block', 'entrench'), deckOf(['block', 1], ['dex', 1], ['entrench', 1]));
    // block 9 + 3 Dexterity = 12, doubled: +12.
    expect(blockGains(dex.log).map((e) => e.total)).toEqual([12, 24]);
    const none = run(d, turnOne('entrench'), deckOf(['entrench', 1]));
    expect(blockGains(none.log).at(-1)!.amount).toBe(0);
  });

  it('Stack gains Block equal to the Discard pile size (+3 upgraded)', () => {
    const d = world({ zip: helper('zip', [{ type: 'gainStrength', amount: 0 }]) }, ['stack']);
    const base = run(d, turnOne('zip', 'zip', 'zip', 'stack'), deckOf(['zip', 3], ['stack', 1]));
    expect(blockGains(base.log).at(-1)!.amount).toBe(3);
    const up = run(d, turnOne('zip', 'zip', 'stack'), deckOf(['zip', 3], ['stack', 1, true]));
    expect(blockGains(up.log).at(-1)!.amount).toBe(2 + 3);
  });

  it('Block scaling with Strength: 15 + 5 per Strength (16 + 8 upgraded)', () => {
    // The main-release Expect a Fight is an Energy card (#208), so the Strength-scaling Block effect is covered by a stand-in.
    const scaling = (block: number, per: number) => ({
      type: 'gainBlockFrom' as const,
      amount: block,
      bonusPer: { per: 'playerStrength' as const, amount: per },
    });
    const fight = helper('fight', [scaling(15, 5)], { upgraded: { effects: [scaling(16, 8)] } });
    const d = world({ flex: helper('flex', [{ type: 'gainStrength', amount: 2 }]), fight });
    const r = run(d, turnOne('flex', 'fight'), deckOf(['flex', 1], ['fight', 1]));
    expect(blockGains(r.log).at(-1)!.amount).toBe(25);
    const up = run(d, turnOne('flex', 'fight'), deckOf(['flex', 1], ['fight', 1, true]));
    expect(blockGains(up.log).at(-1)!.amount).toBe(32);
  });

  it('Mind Blast deals damage equal to the Draw pile size', () => {
    const d = world({}, ['mind_blast']);
    const r = run(d, turnOne('mind_blast'), deckOf(['mind_blast', 1], ['defend', 7]));
    // 8 cards, 5 drawn (Mind Blast is Innate): 3 left in the draw pile.
    expect(playerHits(r.log)[0]!.amount).toBe(3);
  });
});

describe('#111 Clash', () => {
  it('is playable only while every other card in hand is an Attack', () => {
    const d = world({}, ['clash']);
    d.cards.clash!.keywords = ['innate'];
    const seen: string[][] = [];
    const strategy: Strategy = {
      decide(view) {
        if (view.state.turn !== 1) return { kind: 'endTurn' };
        seen.push(view.playable.map((c) => c.cardId).sort());
        const defend = view.playable.find((c) => c.cardId === 'defend');
        return defend ? { kind: 'play', uid: defend.uid } : { kind: 'endTurn' };
      },
    };
    run(d, strategy, deckOf(['clash', 1], ['strike', 2], ['defend', 2]));
    // Hand: Clash, 2 Strike, 2 Defend: Clash is not playable. After both Defends are played it is.
    expect(seen[0]).toEqual(['defend', 'defend', 'strike', 'strike']);
    expect(seen[1]).toEqual(['defend', 'strike', 'strike']);
    expect(seen[2]).toEqual(['clash', 'strike', 'strike']);
  });

  it('playing it while a non-Attack is in hand is rejected', () => {
    const d = world({}, ['clash']);
    d.cards.clash!.keywords = ['innate'];
    expect(() => run(d, turnOne('clash'), deckOf(['clash', 1], ['defend', 1]))).toThrow(/not playable/);
  });

  it('deals 14 (18 upgraded)', () => {
    const d = world({}, ['clash']);
    const r = run(d, turnOne('clash'), deckOf(['clash', 1, true], ['strike', 1]));
    expect(playerHits(r.log)[0]!.amount).toBe(18);
  });
});

describe('#111 conditions', () => {
  const branch = (cond: Condition) =>
    helper('branch', [
      {
        type: 'conditional',
        if: cond,
        then: [{ type: 'gainStrength', amount: 5 }],
        else: [{ type: 'gainStrength', amount: 1 }],
      },
    ]);
  const strengthAfter = (cond: Parameters<typeof branch>[0], setup: Effect[] = []) => {
    const d = world({ branch: branch(cond), setup: helper('setup', setup) });
    const r = run(d, turnOne('setup', 'branch'), deckOf(['setup', 1], ['branch', 1], ['defend', 1]));
    return events(r.log, 'strength').at(-1)!.total;
  };

  it('enemyHas: Poison and debuffs', () => {
    expect(strengthAfter({ kind: 'enemyHas', status: 'poison' }, [{ type: 'applyPoison', amount: 2 }])).toBe(5);
    expect(strengthAfter({ kind: 'enemyHas', status: 'poison' })).toBe(1);
    expect(strengthAfter({ kind: 'enemyHas', status: 'weak' }, [{ type: 'applyWeak', amount: 1 }])).toBe(5);
  });

  it('counter: min and max bounds', () => {
    expect(
      strengthAfter({ kind: 'counter', counter: 'enemyVulnerable', min: 2 }, [{ type: 'applyVulnerable', amount: 2 }]),
    ).toBe(5);
    expect(
      strengthAfter({ kind: 'counter', counter: 'enemyVulnerable', min: 2 }, [{ type: 'applyVulnerable', amount: 1 }]),
    ).toBe(1);
    expect(strengthAfter({ kind: 'counter', counter: 'enemyVulnerable', max: 0 })).toBe(5);
  });

  it('handHasNone / handAll ignore the card being played', () => {
    expect(strengthAfter({ kind: 'handHasNone', filter: { types: ['attack'] } })).toBe(5);
    expect(strengthAfter({ kind: 'handAll', filter: { types: ['skill'] } })).toBe(5);
    expect(strengthAfter({ kind: 'handAll', filter: { types: ['attack'] } })).toBe(1);
  });

  it('lostHpThisTurn', () => {
    expect(strengthAfter({ kind: 'lostHpThisTurn' }, [{ type: 'loseHp', amount: 1 }])).toBe(5);
    expect(strengthAfter({ kind: 'lostHpThisTurn' })).toBe(1);
  });

  it('counter: the cards-played tallies count the card that reads them (#113)', () => {
    // setup is played first, then the conditional card: 2 cards played this turn.
    expect(strengthAfter({ kind: 'counter', counter: 'cardsPlayedThisTurn', min: 2, max: 2 })).toBe(5);
    expect(strengthAfter({ kind: 'counter', counter: 'cardsPlayedThisTurn', min: 3 })).toBe(1);
  });

  it('repeat: N = counter × times, read once before the first repeat', () => {
    const d = world({
      grow: helper('grow', [
        { type: 'applyVulnerable', amount: 2 },
        { type: 'repeat', per: 'enemyVulnerable', times: 2, effects: [{ type: 'applyVulnerable', amount: 1 }] },
      ]),
    });
    const r = run(d, turnOne('grow'), deckOf(['grow', 1]));
    // 2 Vulnerable, then 2 × 2 = 4 more.
    expect(
      events(r.log, 'debuff')
        .filter((e) => e.kind === 'vulnerable')
        .at(-1)!.total,
    ).toBe(6);
  });

  it('attackFrom: extra hits per counter', () => {
    const d = world({
      multi: helper('multi', [
        { type: 'attackFrom', damage: 3, hits: 1, extraHitsPer: { per: 'handSize', amount: 1 } },
      ]),
    });
    const r = run(d, turnOne('multi'), deckOf(['multi', 1], ['defend', 3]));
    // 4 cards in hand, the card itself is in play: 3 in hand → 1 + 3 hits.
    expect(playerHits(r.log).map((e) => e.amount)).toEqual([3, 3, 3, 3]);
  });

  it('a scaling attack with no player action still passes the turn', () => {
    const r = run(world({}, ['rend']), passive, deckOf(['rend', 1]));
    expect(r.outcome).toBeDefined();
  });
});

describe('#245 Ironclad and Colorless cards unflagged by the quality loop', () => {
  /** Turn-1 events only (up to the first turn end). */
  const turn1 = (log: ReturnType<typeof run>['log']) =>
    log!.slice(
      0,
      log!.findIndex((e) => e.t === 'turnEnd'),
    );
  const hurt = helper('hurt', [{ type: 'loseHp', amount: 1 }]);
  const burn = helper('burn', [], { keywords: ['innate', 'exhaust'] });
  const hitsOf = (r: ReturnType<typeof run>) => playerHits(r.log).map((e) => e.amount);

  it('Tear Asunder: 5 damage and one more hit per time HP was lost this combat (7 upgraded)', () => {
    const d = world({ hurt }, ['tear_asunder']);
    const none = run(d, turnOne('tear_asunder'), deckOf(['tear_asunder', 1]));
    expect(hitsOf(none)).toEqual([5]);
    const two = run(d, turnOne('hurt', 'hurt', 'tear_asunder'), deckOf(['hurt', 2], ['tear_asunder', 1]));
    expect(hitsOf(two)).toEqual([5, 5, 5]);
    const up = run(d, turnOne('hurt', 'tear_asunder'), deckOf(['hurt', 1], ['tear_asunder', 1, true]));
    expect(hitsOf(up)).toEqual([7, 7]);
  });

  it('Spite: 5 damage, 2 hits if HP was lost this turn (3 upgraded)', () => {
    const d = world({ hurt }, ['spite']);
    expect(hitsOf(run(d, turnOne('spite'), deckOf(['spite', 1])))).toEqual([5]);
    expect(hitsOf(run(d, turnOne('hurt', 'spite'), deckOf(['hurt', 1], ['spite', 1])))).toEqual([5, 5]);
    expect(hitsOf(run(d, turnOne('hurt', 'spite'), deckOf(['hurt', 1], ['spite', 1, true])))).toEqual([5, 5, 5]);
    expect(hitsOf(run(d, turnOne('spite'), deckOf(['spite', 1, true])))).toEqual([5]);
  });

  it('Ashen Strike: 6 plus 3 per card in the Exhaust pile (4 upgraded)', () => {
    const d = world({ burn }, ['ashen_strike']);
    expect(hitsOf(run(d, turnOne('ashen_strike'), deckOf(['ashen_strike', 1])))).toEqual([6]);
    const two = run(d, turnOne('burn', 'burn', 'ashen_strike'), deckOf(['burn', 2], ['ashen_strike', 1]));
    expect(hitsOf(two)).toEqual([12]);
    const up = run(d, turnOne('burn', 'burn', 'ashen_strike'), deckOf(['burn', 2], ['ashen_strike', 1, true]));
    expect(hitsOf(up)).toEqual([14]);
  });

  it('Evil Eye: 8 Block, another 8 if a card was Exhausted this turn (11 + 11 upgraded)', () => {
    const d = world({ burn }, ['evil_eye']);
    const gains = (r: ReturnType<typeof run>) => blockGains(r.log).map((e) => e.amount);
    expect(gains(run(d, turnOne('evil_eye'), deckOf(['evil_eye', 1])))).toEqual([8]);
    expect(gains(run(d, turnOne('burn', 'evil_eye'), deckOf(['burn', 1], ['evil_eye', 1])))).toEqual([8, 8]);
    expect(gains(run(d, turnOne('burn', 'evil_eye'), deckOf(['burn', 1], ['evil_eye', 1, true])))).toEqual([11, 11]);
  });

  it("Pact's End: 17 damage (23 upgraded) only with 3+ cards in the Exhaust pile", () => {
    const d = world({ burn }, ['pacts_end']);
    const two = run(d, turnOne('burn', 'burn', 'pacts_end'), deckOf(['burn', 2], ['pacts_end', 1]));
    expect(hitsOf(two)).toEqual([]);
    const three = run(d, turnOne('burn', 'burn', 'burn', 'pacts_end'), deckOf(['burn', 3], ['pacts_end', 1]));
    expect(hitsOf(three)).toEqual([17]);
    const up = run(d, turnOne('burn', 'burn', 'burn', 'pacts_end'), deckOf(['burn', 3], ['pacts_end', 1, true]));
    expect(hitsOf(up)).toEqual([23]);
  });

  it('Impatience: draws 2 (3 upgraded) only when the hand holds no Attack', () => {
    const atk = helper('atk', [{ type: 'attack', damage: 1, hits: 1 }], { type: 'attack' });
    const d = world({ atk }, ['impatience']);
    const draws = (r: ReturnType<typeof run>) => turn1(r.log).filter((e) => e.t === 'draw').length;
    // Hand: 5 Impatience, 5 more in the draw pile; no Attack anywhere.
    expect(draws(run(d, turnOne('impatience'), deckOf(['impatience', 10])))).toBe(5 + 2);
    expect(draws(run(d, turnOne('impatience'), deckOf(['impatience', 10, true])))).toBe(5 + 3);
    // An innate Attack stays in hand: no draw.
    expect(draws(run(d, turnOne('impatience'), deckOf(['atk', 1], ['impatience', 9])))).toBe(5);
  });

  it('Restlessness: with an empty hand, draws 2 and gains 2 Energy (3 and 3 upgraded)', () => {
    const d = world({}, ['restlessness']);
    const five = () => turnOne('restlessness', 'restlessness', 'restlessness', 'restlessness', 'restlessness');
    const stats = (r: ReturnType<typeof run>) => ({
      draws: turn1(r.log).filter((e) => e.t === 'draw').length,
      energy: events(turn1(r.log), 'energy').map((e) => e.amount),
    });
    const base = stats(run(d, five(), deckOf(['restlessness', 8])));
    expect(base.draws).toBe(5 + 2);
    expect(base.energy.filter((a) => a > 0)).toContain(2);
    const up = stats(run(d, five(), deckOf(['restlessness', 8, true])));
    expect(up.draws).toBe(5 + 3);
    expect(up.energy.filter((a) => a > 0)).toContain(3);
  });
});
