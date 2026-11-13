/** Damage, block and debuffs across the documented turn order. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, passive, scripted, withEnemy, dummyData, logged, events } from './combatTestHelpers';
import type { CardDef, GameEvent, Strategy } from './types';

describe('damage rules in combat', () => {
  it('Vulnerable: Bash then Strike = 8 + 9; Vulnerable 2 lasts two player turns', () => {
    const data = dummyData();
    const config = cfg({ enemyId: 'dummy', deck: deckOf(['bash', 1], ['strike', 4]) });
    const strat = scripted((turn) => (turn === 1 ? ['bash', 'strike'] : turn <= 3 ? ['strike'] : []));
    const r = simulateCombat(data, config, strat, { log: true });
    const log = r.log!;
    expect(
      events(log, 'damage')
        .slice(0, 4)
        .map((d) => d.amount),
    ).toEqual([8, 9, 9, 6]);
    const ticks = events(log, 'debuffTick').filter((e) => e.side === 'enemy' && e.kind === 'vulnerable');
    expect(ticks.slice(0, 2).map((t) => t.total)).toEqual([1, 0]);
    expect(ticks).toHaveLength(2);
    expect(events(log, 'debuff')[0]).toEqual({ t: 'debuff', side: 'enemy', kind: 'vulnerable', amount: 2, total: 2 });
  });

  it('multi-hit + Strength: intent 8 and block absorbs across hits', () => {
    const e = makeEnemy('twin', 999, {
      hiss: { name: 'Hiss', effects: [{ type: 'gainStrength', amount: 2 }] },
      double: { name: 'Double', effects: [{ type: 'attack', damage: 2, hits: 2 }] },
    });
    const data = withEnemy(makeGameData(), e);
    const intents: number[] = [];
    const strat: Strategy = {
      decide(view) {
        intents.push(view.intent.totalIncoming);
        // Play one Defend on turn 2 only.
        const d = view.playable.find((c) => c.cardId === 'defend');
        if (view.state.turn === 2 && view.state.player.block === 0 && d) return { kind: 'play', uid: d.uid };
        return { kind: 'endTurn' };
      },
    };
    const r = logged(data, strat, { enemyId: 'twin', deck: deckOf(['defend', 5]) });
    expect(intents.slice(0, 2)).toEqual([0, 8]);
    const dmg = events(r.log, 'damage').slice(0, 2);
    expect(dmg).toEqual([
      { t: 'damage', source: 'enemy', target: 'player', amount: 4, blocked: 4, hpLoss: 0 },
      { t: 'damage', source: 'enemy', target: 'player', amount: 4, blocked: 1, hpLoss: 3 },
    ]);
  });

  it('Block absorbs the hits of one attack in order, running out part-way through', () => {
    const e = makeEnemy('triple', 999, { slam: { name: 'Slam', effects: [{ type: 'attack', damage: 8, hits: 3 }] } });
    const data = withEnemy(makeGameData(), e);
    const strat: Strategy = {
      decide(view) {
        const d = view.playable.find((c) => c.cardId === 'defend');
        if (view.state.turn === 1 && d) return { kind: 'play', uid: d.uid };
        return { kind: 'endTurn' };
      },
    };
    const r = logged(data, strat, { enemyId: 'triple', deck: deckOf(['defend', 5]) });
    // Two Defends = 10 Block: the first hit is absorbed, the second partly (2 of 8), the third not at all.
    expect(
      events(r.log, 'damage')
        .slice(0, 3)
        .map((d) => [d.blocked, d.hpLoss]),
    ).toEqual([
      [8, 0],
      [2, 6],
      [0, 8],
    ]);
  });

  it('enemy Strength persists: Nibbit second Butt hits 14 at A0', () => {
    const r = logged(makeGameData(), passive, { deck: [] });
    expect(
      events(r.log, 'enemyMove')
        .slice(0, 4)
        .map((m) => m.moveId),
    ).toEqual(['butt', 'hesitantSlice', 'hiss', 'butt']);
    expect(
      events(r.log, 'damage')
        .slice(0, 3)
        .map((d) => d.amount),
    ).toEqual([12, 6, 14]);
  });

  it('A9 Nibbit uses the A9 numbers', () => {
    const r = logged(makeGameData(), passive, { deck: [], ascension: 9 });
    expect(
      events(r.log, 'damage')
        .slice(0, 3)
        .map((d) => d.amount),
    ).toEqual([13, 7, 16]);
  });

  it('enemy block protects it during the next player turn only', () => {
    // Guard (enemy turn 1) gives 10 Block. The player leaves it untouched on turn 2, so only the
    // reset at the start of enemy turn 2 can remove it: the turn-3 Strike lands in full.
    const turtle = makeEnemy('turtle', 999, {
      guard: { name: 'Guard', effects: [{ type: 'gainBlock', amount: 10 }] },
      wait: { name: 'Wait', effects: [] },
      wait2: { name: 'Wait', effects: [] },
    });
    const strat = scripted((turn) => (turn === 3 ? ['strike'] : []));
    const r = logged(withEnemy(makeGameData(), turtle), strat, { enemyId: 'turtle', deck: deckOf(['strike', 10]) });
    expect(events(r.log, 'damage')[0]).toMatchObject({ source: 'player', amount: 6, blocked: 0, hpLoss: 6 });
  });

  it('enemy block absorbs player hits during the player turn right after it is gained', () => {
    // Nibbit's Hesitant Slice (enemy turn 2) gives 5 Block: the turn-3 Strike is 5 blocked, 1 HP.
    const strat = scripted((turn) => (turn <= 4 ? ['strike'] : []));
    const r = logged(makeGameData(), strat, { deck: deckOf(['strike', 10]) });
    const playerHits = events(r.log, 'damage').filter((d) => d.source === 'player');
    expect(playerHits.map((d) => [d.blocked, d.hpLoss])).toEqual([
      [0, 6],
      [0, 6],
      [5, 1],
      [0, 6],
    ]);
  });

  it('player block resets at the start of each player turn', () => {
    const strat = scripted((turn) => (turn === 1 ? ['defend', 'defend', 'defend'] : []));
    const data = withEnemy(
      makeGameData(),
      makeEnemy('late', 999, {
        wait: { name: 'Wait', effects: [] },
        hit: { name: 'Hit', effects: [{ type: 'attack', damage: 10, hits: 1 }] },
      }),
    );
    const r = logged(data, strat, { enemyId: 'late', deck: deckOf(['defend', 10]) });
    // 15 block on turn 1 is gone by the enemy's turn-2 hit.
    expect(events(r.log, 'damage')[0]).toMatchObject({ amount: 10, blocked: 0, hpLoss: 10 });
  });

  it("enemy debuffs target the player, Weak reduces the enemy's hits, Frail reduces block, and each side ticks on its own turn end", () => {
    const e = makeEnemy('hexer', 999, {
      hex: {
        name: 'Hex',
        effects: [
          { type: 'applyFrail', amount: 2 },
          { type: 'applyVulnerable', amount: 1 },
        ],
      },
      hit: { name: 'Hit', effects: [{ type: 'attack', damage: 10, hits: 1 }] },
    });
    const weakener: CardDef = {
      ...cards.defend!,
      id: 'weakener',
      code: 'Wk',
      cost: 0,
      effects: [
        { type: 'applyWeak', amount: 1 },
        { type: 'gainBlock', amount: 8 },
      ],
      upgraded: null,
    };
    const data = withEnemy(makeGameData(), e);
    data.cards.weakener = weakener;
    const strat = scripted((turn) => (turn === 2 ? ['weakener'] : []));
    const r = logged(data, strat, { enemyId: 'hexer', deck: deckOf(['weakener', 5]) });
    const log = r.log!;
    expect(events(log, 'debuff').slice(0, 3)).toEqual([
      { t: 'debuff', side: 'player', kind: 'frail', amount: 2, total: 2 },
      { t: 'debuff', side: 'player', kind: 'vulnerable', amount: 1, total: 1 },
      { t: 'debuff', side: 'enemy', kind: 'weak', amount: 1, total: 1 },
    ]);
    // Frail 2 → block 8 × 0.75 = 6.
    expect(events(log, 'block')[0]).toMatchObject({ side: 'player', amount: 6, total: 6 });
    // End of player turn 2: player Frail 2→1, Vulnerable 1→0. Enemy Weak 1→0 only after its move.
    const turn2Ticks = events(log, 'debuffTick').slice(0, 3);
    expect(turn2Ticks).toEqual([
      { t: 'debuffTick', side: 'player', kind: 'vulnerable', total: 0 },
      { t: 'debuffTick', side: 'player', kind: 'frail', total: 1 },
      { t: 'debuffTick', side: 'enemy', kind: 'weak', total: 0 },
    ]);
    // Player Vulnerable expired, enemy Weak still active on its hit: 10 × 0.75 = 7, 6 blocked.
    expect(events(log, 'damage')[0]).toMatchObject({ amount: 7, blocked: 6, hpLoss: 1 });
    const hitIdx = log.findIndex((e) => e.t === 'damage');
    const weakTickIdx = log.findIndex((e) => e.t === 'debuffTick' && e.side === 'enemy');
    expect(weakTickIdx).toBeGreaterThan(hitIdx);
  });

  it('1 Vulnerable on the enemy boosts that player turn and is gone by the next one', () => {
    const data = dummyData();
    data.cards.tap = {
      ...cards.strike!,
      id: 'tap',
      code: 'Tp',
      cost: 0,
      effects: [{ type: 'applyVulnerable', amount: 1 }],
      upgraded: null,
    };
    const config = cfg({ enemyId: 'dummy', deck: deckOf(['tap', 1], ['strike', 9]) });
    const strat = scripted((turn) => (turn === 1 ? ['tap', 'strike', 'strike'] : turn === 2 ? ['strike'] : []));
    const r = simulateCombat(data, config, strat, { log: true });
    const log = r.log!;
    expect(
      events(log, 'damage')
        .slice(0, 3)
        .map((d) => d.amount),
    ).toEqual([9, 9, 6]);
    // The tick happens at the end of the enemy turn, after its move, not at the end of the player turn.
    const tickIdx = log.findIndex((e) => e.t === 'debuffTick' && e.side === 'enemy' && e.kind === 'vulnerable');
    const moveIdx = log.findIndex((e) => e.t === 'enemyMove');
    const playerEndIdx = log.findIndex((e) => e.t === 'turnEnd' && e.side === 'player');
    const enemyEndIdx = log.findIndex((e) => e.t === 'turnEnd' && e.side === 'enemy');
    expect(tickIdx).toBeGreaterThan(playerEndIdx);
    expect(tickIdx).toBeGreaterThan(moveIdx);
    expect(tickIdx).toBeLessThan(enemyEndIdx);
    expect(log[tickIdx]).toEqual({ t: 'debuffTick', side: 'enemy', kind: 'vulnerable', total: 0 });
  });

  it('Weak applied to the enemy reduces its very next attack', () => {
    const e = makeEnemy('brute', 999, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 12, hits: 1 }] } });
    const data = withEnemy(makeGameData(), e);
    data.cards.sap = {
      ...cards.strike!,
      id: 'sap',
      code: 'Sp',
      cost: 0,
      effects: [{ type: 'applyWeak', amount: 1 }],
      upgraded: null,
    };
    const intents: number[] = [];
    const strat: Strategy = {
      decide(view) {
        if (view.state.turn === 1) {
          const c = view.playable.find((p) => p.cardId === 'sap');
          if (c) return { kind: 'play', uid: c.uid };
          intents.push(view.intent.totalIncoming);
        }
        return { kind: 'endTurn' };
      },
    };
    const r = logged(data, strat, { enemyId: 'brute', deck: deckOf(['sap', 1], ['defend', 9]) });
    expect(intents).toEqual([9]); // intent already reflects Weak
    expect(
      events(r.log, 'damage')
        .slice(0, 2)
        .map((d) => d.amount),
    ).toEqual([9, 12]);
  });

  it('Weak on the player cuts its attacks by 25% for that whole player turn, then ticks off at its end', () => {
    // Enemy turn 1 applies Weak 1 to the player. Player turn 2: two Strikes deal floor(6 × 0.75) = 4.
    // The tick at the end of player turn 2 removes it, so the turn-3 Strike deals 6.
    const e = makeEnemy('hexer2', 999, {
      hex: { name: 'Hex', effects: [{ type: 'applyWeak', amount: 1 }] },
      wait: { name: 'Wait', effects: [] },
    });
    const data = withEnemy(makeGameData(), e);
    const strat = scripted((turn) => (turn === 2 ? ['strike', 'strike'] : turn === 3 ? ['strike'] : []));
    const r = logged(data, strat, { enemyId: 'hexer2', deck: deckOf(['strike', 15]) });
    const log = r.log!;
    expect(events(log, 'damage').map((d) => d.amount)).toEqual([4, 4, 6]);
    // The tick comes after the player's last play of turn 2 and right before that player turn ends.
    const ticks = events(log, 'debuffTick').filter((t) => t.side === 'player');
    expect(ticks[0]).toEqual({ t: 'debuffTick', side: 'player', kind: 'weak', total: 0 });
    const tickIdx = log.findIndex((ev) => ev.t === 'debuffTick' && ev.side === 'player');
    const t2End = log.findIndex((ev) => ev.t === 'turnEnd' && ev.turn === 2 && ev.side === 'player');
    const lastT2Play = log
      .slice(0, t2End)
      .map((ev) => ev.t)
      .lastIndexOf('play');
    expect(tickIdx).toBe(t2End - 1);
    expect(tickIdx).toBeGreaterThan(lastT2Play);
  });

  it('one full round logs its phases in the documented order', () => {
    // Player turn: block reset → draw → plays → Ethereal exhausts / rest discarded → PLAYER debuffs tick.
    // Enemy turn: block reset → Poison → move → ENEMY debuffs tick.
    const e = makeEnemy('hexer3', 999, { hex: { name: 'Hex', effects: [{ type: 'applyWeak', amount: 1 }] } });
    const data = withEnemy(makeGameData(), e);
    data.cards.mist = { ...cards.defend!, id: 'mist', code: 'Mi', keywords: ['ethereal'], upgraded: null };
    data.cards.venom = {
      ...cards.defend!,
      id: 'venom',
      code: 'Vn',
      cost: 0,
      effects: [
        { type: 'applyPoison', amount: 3 },
        { type: 'applyVulnerable', amount: 1 },
      ],
      upgraded: null,
    };
    const strat = scripted((turn) => (turn === 1 ? ['venom'] : []));
    const r = logged(data, strat, { enemyId: 'hexer3', deck: deckOf(['mist', 1], ['venom', 1], ['strike', 3]) });
    const log = r.log!;
    const at = (t: GameEvent['t'], turn: number, side: 'player' | 'enemy') =>
      log.findIndex((ev) => ev.t === t && 'turn' in ev && ev.turn === turn && 'side' in ev && ev.side === side);
    const types = (from: number, to: number) => log.slice(from, to).map((ev) => ev.t);

    const p1 = at('turnStart', 1, 'player');
    const p1End = at('turnEnd', 1, 'player');
    expect(types(p1, p1 + 7)).toEqual(['turnStart', 'blockReset', 'draw', 'draw', 'draw', 'draw', 'draw']);
    expect(types(p1 + 7, p1 + 10)).toEqual(['play', 'poison', 'debuff']);
    // End of player turn 1: the Ethereal card exhausts, the 3 Strikes are discarded (no player debuffs yet).
    expect([...types(p1 + 10, p1End)].sort()).toEqual(['discard', 'discard', 'discard', 'exhaust']);
    expect(events(log, 'exhaust')[0]).toMatchObject({ cardId: 'mist', reason: 'ethereal' });

    const e1 = at('turnStart', 1, 'enemy');
    const e1End = at('turnEnd', 1, 'enemy');
    expect(e1).toBe(p1End + 1);
    expect(types(e1, e1End + 1)).toEqual([
      'turnStart',
      'blockReset',
      'poisonDamage',
      'enemyMove',
      'debuff',
      'debuffTick',
      'turnEnd',
    ]);
    expect(log[e1End - 1]).toEqual({ t: 'debuffTick', side: 'enemy', kind: 'vulnerable', total: 0 });

    // Player turn 2: the empty draw pile reshuffles the discard; end of turn ticks the player's Weak last.
    const p2 = at('turnStart', 2, 'player');
    const p2End = at('turnEnd', 2, 'player');
    expect(p2).toBe(e1End + 1);
    expect(types(p2, p2 + 3)).toEqual(['turnStart', 'blockReset', 'shuffle']);
    expect(log[p2End - 1]).toEqual({ t: 'debuffTick', side: 'player', kind: 'weak', total: 0 });
  });
});
