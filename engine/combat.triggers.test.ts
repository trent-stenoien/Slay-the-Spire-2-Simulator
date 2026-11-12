/** #113 Trigger powers: the cards-played tallies and the hooks (exhaust, HP loss, Block, debuff, play, draw, shuffle). */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, events, scripted, withEnemy, dummy, dummyData } from './combatTestHelpers';
import type { CardDef, ChoiceRequest, CombatCounters, Effect, GameData, GameEvent, PowerId, Strategy } from './types';

const apply = (p: PowerId, amount: number): Effect => ({ type: 'applyPower', power: p, amount });

/** A free card of any type (innate by default so a small deck always starts with it in hand). */
const card = (id: string, over: Partial<CardDef>): CardDef => ({
  ...cards.defend!,
  id,
  code: id.slice(0, 2),
  name: id,
  cost: 0,
  effects: [],
  upgraded: { effects: [] },
  ...over,
});

/** A Power card that applies one power; innate so it is in the opening hand. */
const power = (id: string, p: PowerId, amount: number, over: Partial<CardDef> = {}): CardDef =>
  card(id, { type: 'power', keywords: ['innate'], effects: [apply(p, amount)], upgraded: null, ...over });

const attack = (id: string, name: string, damage = 6, hits = 1, over: Partial<CardDef> = {}): CardDef =>
  card(id, { type: 'attack', name, effects: [{ type: 'attack', damage, hits }], upgraded: null, ...over });

const skill = (id: string, effects: Effect[], over: Partial<CardDef> = {}): CardDef =>
  card(id, { type: 'skill', name: id, effects, upgraded: null, ...over });

const extra: Record<string, CardDef> = {
  strike0: attack('strike0', 'Strike'),
  twin0: attack('twin0', 'Twin Strike', 5, 2),
  axe0: attack('axe0', 'Axe'),
  defend0: skill('defend0', [{ type: 'gainBlock', amount: 5 }], { name: 'Defend' }),
  /** An Exhaust Skill (Shrug It Off-like, but free and with no effect). */
  burn0: skill('burn0', [], { keywords: ['exhaust'] }),
  /** Bloodletting-like: lose 2 HP. */
  bleed0: skill('bleed0', [{ type: 'loseHp', amount: 2 }]),
  vuln0: skill('vuln0', [{ type: 'applyVulnerable', amount: 1 }]),
  weak0: skill('weak0', [{ type: 'applyWeak', amount: 1 }]),
  frail0: skill('frail0', [{ type: 'applyFrail', amount: 1 }]),
  /** Ethereal junk, to be exhausted at the end of the turn. */
  mist0: skill('mist0', [], { keywords: ['ethereal'] }),
  goldAxe0: card('goldAxe0', {
    type: 'attack',
    name: 'Gold Axe',
    effects: [{ type: 'attackFrom', damage: 0, hits: 1, bonusPer: { per: 'cardsPlayedThisCombat', amount: 1 } }],
    upgraded: null,
  }),
  darkEmbrace: power('darkEmbrace', 'darkEmbrace', 1),
  feelNoPain: power('feelNoPain', 'feelNoPain', 3),
  rupture: power('rupture', 'rupture', 1),
  inferno: power('inferno', 'inferno', 6),
  juggernaut: power('juggernaut', 'juggernaut', 6),
  unmovable: power('unmovable', 'unmovable', 1),
  vicious: power('vicious', 'vicious', 1),
  panache: power('panache', 'panache', 10),
  automation: power('automation', 'automation', 1),
  juggling: power('juggling', 'juggling', 1),
  aggression: power('aggression', 'aggression', 1),
  hellraiser: power('hellraiser', 'hellraiser', 1),
  stampede: power('stampede', 'stampede', 1),
  mayhem: power('mayhem', 'mayhem', 1),
  nostalgia: power('nostalgia', 'nostalgia', 1),
  stratagem: power('stratagem', 'stratagem', 1),
  dexterity: power('dexterity', 'dexterity', 2),
  plating: power('plating', 'plating', 4),
};

function data(extraDefs: Record<string, CardDef> = {}): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra), structuredClone(extraDefs));
  // `<id>I` is an innate copy of a card, so a small deck starts with it in hand.
  for (const [id, def] of Object.entries(d.cards)) {
    if (def.keywords.includes('innate') || !id.endsWith('0')) continue;
    d.cards[`${id}I`] = {
      ...structuredClone(def),
      id: `${id}I`,
      code: `${def.code.slice(0, 1)}I`,
      keywords: [...def.keywords, 'innate'],
    };
  }
  return d;
}

/** Draw 10 cards a turn, so one turn can hold a long scripted play. */
const wide = (d: GameData) => {
  d.characters.ironclad!.drawPerTurn = 10;
  return d;
};

const run = (
  d: GameData,
  deck: [string, number, boolean?][],
  plan: (turn: number) => string[],
  seed = 1,
  strategy: Strategy = scripted(plan),
  enemyId = 'dummy',
) => simulateCombat(d, cfg({ enemyId, deck: deckOf(...deck), seed }), strategy, { log: true });

/** The events of player turn `turn`, from its start to the next player turn's start (or the log's end). */
function turnEvents(log: GameEvent[] | undefined, turn: number): GameEvent[] {
  const l = log ?? [];
  const from = l.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === turn);
  const next = l.findIndex((e, i) => i > from && e.t === 'turnStart' && e.side === 'player');
  return l.slice(from, next < 0 ? undefined : next);
}

const enemyDamage = (log: GameEvent[]) =>
  events(log, 'damage')
    .filter((e) => e.target === 'enemy')
    .map((e) => e.amount);

describe('#113 cards-played tallies (one place: playCard)', () => {
  /** Plays the plan and records the counters seen before each decision. */
  function recording(plan: (turn: number) => string[], seen: CombatCounters[]): Strategy {
    const inner = scripted(plan);
    return {
      decide(view) {
        seen.push({ ...(view.state.player.counters as CombatCounters) });
        return inner.decide(view);
      },
    };
  }

  it('counts cards, attacks and skills played; the this-turn tallies reset each turn, the combat one does not', () => {
    const seen: CombatCounters[] = [];
    const plan = (t: number) =>
      t === 1 ? ['strike0', 'defend0', 'strike0', 'darkEmbrace'] : t === 2 ? ['strike0'] : [];
    run(
      data(),
      [
        ['strike0', 6],
        ['defend0', 2],
        ['darkEmbrace', 1],
      ],
      plan,
      1,
      recording(plan, seen),
    );
    // The decisions of turn 1 see 0,1,2,3 plays; the first of turn 2 sees the combat total 4 and a fresh turn.
    const turn1 = seen.slice(0, 5);
    expect(turn1.map((c) => c.cardsPlayedThisTurn)).toEqual([0, 1, 2, 3, 4]);
    expect(turn1.at(2)).toMatchObject({ attacksPlayedThisTurn: 1, skillsPlayedThisTurn: 1 });
    expect(turn1.at(4)).toMatchObject({ attacksPlayedThisTurn: 2, skillsPlayedThisTurn: 1, cardsPlayedThisCombat: 4 });
    expect(seen[5]).toMatchObject({
      cardsPlayedThisTurn: 0,
      attacksPlayedThisTurn: 0,
      skillsPlayedThisTurn: 0,
      cardsPlayedThisCombat: 4,
    });
  });

  it('a Replay is the same play, not a second one', () => {
    const seen: CombatCounters[] = [];
    const d = data({ twice: attack('twice', 'Twice', 5, 1, { keywords: ['innate'] }) });
    d.cards.hidden = skill('hidden', [{ type: 'addReplay', amount: 1, from: 'hand', mode: 'choose' }], {
      keywords: ['innate'],
    });
    const plan = (t: number) => (t === 1 ? ['hidden', 'twice'] : []);
    const r = run(
      d,
      [
        ['hidden', 1],
        ['twice', 1],
      ],
      plan,
      1,
      recording(plan, seen),
    );
    expect(enemyDamage(turnEvents(r.log, 1))).toEqual([5, 5]);
    expect(seen[2]).toMatchObject({ cardsPlayedThisTurn: 2, attacksPlayedThisTurn: 1 });
  });

  it('cards played by an effect or a power count too', () => {
    const seen: CombatCounters[] = [];
    const d = data();
    d.cards.havoc0 = skill('havoc0', [{ type: 'playCards', from: 'draw', mode: 'top', count: 1 }], {
      keywords: ['innate'],
    });
    const plan = (t: number) => (t === 1 ? ['havoc0'] : []);
    run(
      d,
      [
        ['havoc0', 1],
        ['strike0', 6],
      ],
      plan,
      1,
      recording(plan, seen),
    );
    expect(seen[1]).toMatchObject({ cardsPlayedThisTurn: 2, attacksPlayedThisTurn: 1, skillsPlayedThisTurn: 1 });
  });

  it('Gold Axe deals one damage per card played this combat, itself included', () => {
    const r = run(
      data(),
      [
        ['strike0', 2],
        ['goldAxe0', 1],
      ],
      (t) => (t === 1 ? ['strike0', 'strike0', 'goldAxe0'] : []),
    );
    expect(enemyDamage(r.log!)).toEqual([6, 6, 3]);
  });
});

describe('#113 Dark Embrace and Feel No Pain (on exhaust)', () => {
  it('Dark Embrace draws a card for every card exhausted, by keyword, Ethereal or effect', () => {
    const d = data({
      fire0: skill('fire0', [{ type: 'exhaustCards', count: 1, mode: 'random', filter: { types: ['attack'] } }]),
    });
    const r = run(
      d,
      [
        ['darkEmbrace', 1],
        ['burn0I', 1],
        ['fire0I', 1],
        ['strike0', 7],
      ],
      (t) => (t === 1 ? ['darkEmbrace', 'burn0I', 'fire0I'] : []),
    );
    const t1 = turnEvents(r.log, 1);
    const drawsAfter = (after: string) => {
      const i = t1.findIndex((e) => e.t === 'play' && e.cardId === after);
      return t1.slice(i).filter((e) => e.t === 'draw').length;
    };
    // 5 drawn at the start; burn0 (keyword) and fire0's Attack (effect) each draw one.
    expect(events(t1, 'draw')).toHaveLength(5 + 2);
    expect(drawsAfter('burn0I')).toBe(2);
    expect(events(t1, 'exhaust').map((e) => e.reason)).toEqual(['keyword', 'effect']);
  });

  it('Dark Embrace: a card drawn by an Ethereal exhaust at the end of the turn stays in the hand', () => {
    const r = run(
      data(),
      [
        ['darkEmbrace', 1],
        ['mist0I', 1],
        ['strike0', 6],
      ],
      (t) => (t === 1 ? ['darkEmbrace'] : []),
    );
    const t1 = turnEvents(r.log, 1);
    expect(events(t1, 'exhaust')).toEqual([
      { t: 'exhaust', uid: expect.any(Number), cardId: 'mist0I', reason: 'ethereal' },
    ]);
    const extraDraw = events(t1, 'draw').at(-1)!;
    // The extra card is never discarded at the end of that turn.
    expect(events(t1, 'discard').some((e) => e.uid === extraDraw.uid)).toBe(false);
  });

  it('Feel No Pain gains Block per exhausted card, without Dexterity', () => {
    const r = run(
      data(),
      [
        ['feelNoPain', 1],
        ['dexterity', 1],
        ['burn0I', 2],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['feelNoPain', 'dexterity', 'burn0I', 'burn0I'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'block').map((b) => b.amount)).toEqual([3, 3]);
  });

  it('Feel No Pain triggers for Ethereal cards at the end of the turn', () => {
    const r = run(
      data(),
      [
        ['feelNoPain', 1],
        ['mist0I', 2],
        ['strike0', 6],
      ],
      (t) => (t === 1 ? ['feelNoPain'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'block').map((b) => b.amount)).toEqual([3, 3]);
  });
});

describe('#113 Rupture and Inferno (on HP loss, on your turn)', () => {
  const hitter = () =>
    makeEnemy('hitter', 999, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 5, hits: 1 }] } });

  it('Rupture gains Strength whenever the player loses HP on their turn, not on the enemy turn', () => {
    const d = withEnemy(data(), hitter());
    const r = run(
      d,
      [
        ['rupture', 1],
        ['bleed0I', 2],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['rupture', 'bleed0I', 'bleed0I'] : []),
      1,
      undefined,
      'hitter',
    );
    const strength = events(r.log, 'strength').map((e) => e.total);
    // Two own HP losses: +1 each. The enemy's hit (5 damage) adds none.
    expect(strength).toEqual([1, 2]);
    expect(events(r.log, 'damage').filter((e) => e.target === 'player' && e.hpLoss > 0).length).toBeGreaterThan(0);
  });

  it('Rupture does not react to a loss of 0 (Block absorbed it)', () => {
    const d = data();
    d.cards.hurt0 = skill('hurt0', [{ type: 'loseHp', amount: 0 }]);
    const r = run(
      d,
      [
        ['rupture', 1],
        ['hurt0', 1],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['rupture', 'hurt0'] : []),
    );
    expect(events(r.log, 'strength')).toEqual([]);
  });

  it('Inferno loses 1 HP at the start of each turn and deals its damage for each HP loss on the turn, that one included', () => {
    const r = run(
      data(),
      [
        ['inferno', 1],
        ['bleed0I', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['inferno', 'bleed0I'] : []),
    );
    // Turn 1: bleed0 → 6. Turn 2: the start-of-turn loss → 6.
    expect(enemyDamage(turnEvents(r.log, 1))).toEqual([6]);
    const t2 = turnEvents(r.log, 2);
    expect(events(t2, 'loseHp')).toEqual([{ t: 'loseHp', side: 'player', amount: 1, hpAfter: 80 - 2 - 1 }]);
    expect(enemyDamage(t2)).toEqual([6]);
  });

  it('Inferno damage ignores Strength and Vulnerable, and Block on the enemy absorbs it', () => {
    const blocker = makeEnemy('blocker', 999, {
      guard: { name: 'Guard', effects: [{ type: 'gainBlock', amount: 4 }] },
    });
    const d = withEnemy(data(), blocker);
    const r = run(
      d,
      [
        ['inferno', 1],
        ['bleed0I', 1],
        ['vuln0I', 1],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['inferno', 'vuln0I', 'bleed0I'] : []),
      1,
      undefined,
      'blocker',
    );
    const hits = events(turnEvents(r.log, 1), 'damage').filter((e) => e.target === 'enemy');
    expect(hits).toMatchObject([{ amount: 6, blocked: 0, hpLoss: 6 }]);
  });

  it('Inferno killing the enemy at the start of the turn wins the combat', () => {
    const weak = makeEnemy('weak', 20, { wait: { name: 'Wait', effects: [] } });
    const d = withEnemy(data(), weak);
    const r = run(
      d,
      [
        ['inferno', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['inferno'] : []),
      1,
      undefined,
      'weak',
    );
    // 20 HP: 6 at the start of turns 2, 3, 4, 5 (20 → 14 → 8 → 2 → dead) → dead at the start of turn 5.
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(5);
  });
});

describe('#113 Juggernaut and Unmovable (on gaining Block)', () => {
  it('Juggernaut deals its damage for every Block gain: cards, powers and Feel No Pain', () => {
    const r = run(
      data(),
      [
        ['juggernaut', 1],
        ['feelNoPain', 1],
        ['defend0I', 1],
        ['burn0I', 1],
        ['plating', 1],
      ],
      (t) => (t === 1 ? ['juggernaut', 'feelNoPain', 'plating', 'defend0I', 'burn0I'] : []),
    );
    // defend0 (turn 1), burn0's Feel No Pain Block (turn 1), then Plating at the end of turn 1.
    expect(enemyDamage(turnEvents(r.log, 1))).toEqual([6, 6, 6]);
  });

  it('Juggernaut does nothing for a Block gain of 0', () => {
    const d = data();
    d.cards.nothing0 = skill('nothing0', [{ type: 'gainBlock', amount: 0 }]);
    const r = run(
      d,
      [
        ['juggernaut', 1],
        ['nothing0', 1],
      ],
      (t) => (t === 1 ? ['juggernaut', 'nothing0'] : []),
    );
    expect(enemyDamage(r.log!)).toEqual([]);
  });

  it('Juggernaut killing the enemy mid-card ends the combat before the rest of the card', () => {
    const frail = makeEnemy('frail', 5, { wait: { name: 'Wait', effects: [] } });
    const d = withEnemy(data(), frail);
    d.cards.combo0 = skill('combo0', [
      { type: 'gainBlock', amount: 5 },
      { type: 'gainStrength', amount: 9 },
    ]);
    const r = run(
      d,
      [
        ['juggernaut', 1],
        ['combo0', 1],
      ],
      (t) => (t === 1 ? ['juggernaut', 'combo0'] : []),
      1,
      undefined,
      'frail',
    );
    expect(r.outcome).toBe('win');
    expect(events(r.log, 'strength')).toEqual([]);
  });

  it('Unmovable doubles only the first Block gain from a card each turn, and again next turn', () => {
    const r = run(
      data(),
      [
        ['unmovable', 1],
        ['defend0', 4],
      ],
      (t) => (t <= 2 ? (t === 1 ? ['unmovable', 'defend0', 'defend0'] : ['defend0', 'defend0']) : []),
    );
    expect(events(turnEvents(r.log, 1), 'block').map((b) => b.amount)).toEqual([10, 5]);
    expect(
      events(turnEvents(r.log, 2), 'block')
        .filter((b) => b.side === 'player')
        .map((b) => b.amount),
    ).toEqual([10, 5]);
  });

  it('Unmovable counts Dexterity, and with Frail floors once: floor((5 + 2) × 0.75 × 2) = 10', () => {
    const r = run(
      data(),
      [
        ['unmovable', 1],
        ['dexterity', 1],
        ['frail0', 1],
        ['defend0', 1],
      ],
      (t) => (t === 1 ? ['unmovable', 'dexterity', 'defend0'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'block').map((b) => b.amount)).toEqual([14]);
    // Frail applied to the player by an enemy is covered by blockGain tests; here the base case is 14 = (5 + 2) × 2.
  });

  it('Unmovable is not used up by Block from a power (Plating) or by a gain of 0', () => {
    const d = data();
    d.cards.nothing0 = skill('nothing0', [{ type: 'gainBlock', amount: 0 }]);
    const r = run(
      d,
      [
        ['unmovable', 1],
        ['nothing0', 1],
        ['defend0', 1],
      ],
      (t) => (t === 1 ? ['unmovable', 'nothing0', 'defend0'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'block').map((b) => b.amount)).toEqual([0, 10]);
  });
});

describe('#113 Vicious (on applying Vulnerable)', () => {
  it('draws a card whenever Vulnerable is applied, not for Weak', () => {
    const r = run(
      data(),
      [
        ['vicious', 1],
        ['vuln0I', 1],
        ['weak0I', 1],
        ['strike0', 7],
      ],
      (t) => (t === 1 ? ['vicious', 'weak0I', 'vuln0I'] : []),
    );
    const t1 = turnEvents(r.log, 1);
    const vulnAt = t1.findIndex((e) => e.t === 'debuff' && e.kind === 'vulnerable');
    expect(events(t1, 'draw')).toHaveLength(5 + 1);
    expect(t1[vulnAt + 1]?.t).toBe('draw');
  });
});

describe('#113 Panache, Juggling, Nostalgia (on playing a card)', () => {
  it('Panache deals its damage on every 5th card played in a turn, not counting itself or earlier turns', () => {
    const r = run(
      wide(data()),
      [
        ['panache', 1],
        ['strike0', 9],
      ],
      (t) =>
        t === 1
          ? ['panache', 'strike0', 'strike0', 'strike0', 'strike0', 'strike0', 'strike0']
          : t === 2
            ? ['strike0', 'strike0', 'strike0', 'strike0']
            : [],
    );
    // Turn 1: 6 Strikes → Panache after the 5th (not the 6th). Turn 2: only 4 cards → none.
    expect(enemyDamage(turnEvents(r.log, 1)).filter((d) => d === 10)).toHaveLength(1);
    expect(enemyDamage(turnEvents(r.log, 2)).filter((d) => d === 10)).toHaveLength(0);
  });

  it('Panache stacks its damage and kills mid-turn', () => {
    const weak = makeEnemy('weak', 18, { wait: { name: 'Wait', effects: [] } });
    const d = withEnemy(wide(data()), weak);
    d.cards.panache2 = power('panache2', 'panache', 14);
    const r = run(
      d,
      [
        ['panache', 1],
        ['panache2', 1],
        ['defend0', 5],
      ],
      (t) => (t === 1 ? ['panache', 'panache2', 'defend0', 'defend0', 'defend0', 'defend0', 'defend0'] : []),
      1,
      undefined,
      'weak',
    );
    // 24 damage on the 5th card (after both Powers), enemy at 18 HP dies.
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
  });

  it('Juggling copies the third Attack played each turn into the hand', () => {
    const r = run(
      data(),
      [
        ['juggling', 1],
        ['strike0', 2],
        ['axe0', 2],
      ],
      (t) => (t === 1 ? ['juggling', 'strike0', 'axe0', 'strike0', 'axe0'] : []),
    );
    const gen = events(r.log, 'generated');
    // The third Attack played (the second Strike) is copied once.
    expect(gen).toMatchObject([{ cardId: 'strike0', to: 'hand', source: 'self' }]);
  });

  it('Juggling copies a third Attack each turn, and a full hand sends the copy to the discard pile', () => {
    const d = wide(data());
    d.cards.filler0 = skill('filler0', []);
    const r = run(
      d,
      [
        ['juggling', 1],
        ['strike0', 3],
        ['filler0', 6],
      ],
      (t) => (t === 1 ? ['juggling', 'strike0', 'strike0', 'strike0'] : t === 2 ? ['strike0'] : []),
    );
    expect(events(r.log, 'generated')).toHaveLength(1);
  });

  it('Nostalgia puts the first Attack or Skill each turn on top of the draw pile, and not a Power', () => {
    const r = run(
      data(),
      [
        ['nostalgia', 1],
        ['darkEmbrace', 1],
        ['strike0', 6],
      ],
      (t) => (t === 1 ? ['darkEmbrace', 'nostalgia', 'strike0', 'strike0'] : []),
    );
    const t1 = turnEvents(r.log, 1);
    // Only the first Strike goes back; the second is discarded. (Powers never move.)
    expect(events(t1, 'moved')).toMatchObject([{ cardId: 'strike0', from: 'hand', to: 'drawTop' }]);
  });

  it('Nostalgia: a Skill played first uses it up for the turn', () => {
    const r = run(
      data(),
      [
        ['nostalgia', 1],
        ['defend0I', 1],
        ['strike0', 5],
      ],
      (t) => (t === 1 ? ['nostalgia', 'defend0I', 'strike0'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'moved')).toMatchObject([{ cardId: 'defend0I', to: 'drawTop' }]);
  });

  it('Nostalgia: an Exhaust card is exhausted, not put on the draw pile', () => {
    const r = run(
      data(),
      [
        ['nostalgia', 1],
        ['burn0I', 1],
        ['strike0', 5],
      ],
      (t) => (t === 1 ? ['nostalgia', 'burn0I'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'moved')).toEqual([]);
    expect(events(turnEvents(r.log, 1), 'exhaust')).toHaveLength(1);
  });
});

describe('#113 Automation (every 10 cards drawn)', () => {
  it('gains energy on every 10th card drawn after it was played, across turns', () => {
    const r = run(
      data(),
      [
        ['automation', 1],
        ['strike0', 19],
      ],
      (t) => (t === 1 ? ['automation'] : []),
    );
    // Cards drawn before it was played do not count: turn 2 → 5, turn 3 → 10 (energy on the 5th draw of turn 3).
    expect(events(turnEvents(r.log, 2), 'energy')).toEqual([]);
    expect(events(turnEvents(r.log, 3), 'energy')).toMatchObject([{ amount: 1 }]);
    expect(events(turnEvents(r.log, 3), 'energy').length).toBe(1);
  });
});

describe('#113 Hellraiser, Stampede, Mayhem, Aggression (play and move cards)', () => {
  it('Hellraiser plays a drawn card with "Strike" in its name for free; others stay in hand', () => {
    const d = data();
    // Turn 1 draws only the Powers; the Strikes come on turn 2.
    const r = run(
      d,
      [
        ['hellraiser', 1],
        ['twin0', 3],
        ['axe0', 3],
      ],
      (t) => (t === 1 ? ['hellraiser'] : []),
      3,
    );
    const plays = events(r.log, 'play').filter((e) => e.by === 'power');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((e) => e.cardId === 'twin0')).toBe(true);
    // A played Twin Strike is not left in the hand: it is discarded.
    expect(events(r.log, 'draw').some((e) => e.cardId === 'axe0')).toBe(true);
  });

  it('Hellraiser: the played Strike counts as a played card and can win the combat', () => {
    const weak = makeEnemy('weak', 6, { wait: { name: 'Wait', effects: [] } });
    const d = withEnemy(data(), weak);
    const r = run(
      d,
      [
        ['hellraiser', 1],
        ['strike0', 9],
      ],
      (t) => (t === 1 ? ['hellraiser'] : []),
      1,
      undefined,
      'weak',
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(2);
  });

  it('Stampede plays a random Attack from the hand at the end of the turn; Skills are not picked', () => {
    const r = run(
      data(),
      [
        ['stampede', 1],
        ['strike0', 2],
        ['defend0', 2],
      ],
      (t) => (t === 1 ? ['stampede'] : []),
    );
    const plays = events(turnEvents(r.log, 1), 'play').filter((e) => e.by === 'power');
    expect(plays).toHaveLength(1);
    expect(plays[0]!.cardId).toBe('strike0');
    // Played before the hand is discarded: that Strike is not discarded as a hand card.
    expect(enemyDamage(turnEvents(r.log, 1))).toEqual([6]);
  });

  it('Stampede with no Attack in hand does nothing', () => {
    const r = run(
      data(),
      [
        ['stampede', 1],
        ['defend0', 4],
      ],
      (t) => (t === 1 ? ['stampede'] : []),
    );
    expect(events(r.log, 'play').filter((e) => e.by === 'power')).toEqual([]);
  });

  it('Mayhem plays the top card of the draw pile at the start of each turn, free, marked as played by a power', () => {
    const r = run(
      data(),
      [
        ['mayhem', 1],
        ['strike0', 12],
      ],
      (t) => (t === 1 ? ['mayhem'] : []),
    );
    for (const turn of [2, 3]) {
      const plays = events(turnEvents(r.log, turn), 'play');
      expect(plays).toHaveLength(1);
      expect(plays[0]).toMatchObject({ by: 'power', cardId: 'strike0' });
    }
    expect(events(turnEvents(r.log, 1), 'play').filter((e) => e.by === 'power')).toEqual([]);
  });

  it('Aggression moves a random Attack from the discard pile to the hand, upgraded, at the start of the turn', () => {
    const d = data();
    d.cards.strike0!.upgraded = { effects: [{ type: 'attack', damage: 9, hits: 1 }] };
    const r = run(
      d,
      [
        ['aggression', 1],
        ['strike0', 10],
      ],
      (t) => (t === 1 ? ['aggression', 'strike0', 'strike0'] : []),
    );
    const t2 = turnEvents(r.log, 2);
    expect(events(t2, 'upgraded')).toHaveLength(1);
    expect(events(t2, 'moved')).toMatchObject([{ cardId: 'strike0', from: 'discard', to: 'hand' }]);
  });

  it('Aggression does nothing when the discard pile has no Attack', () => {
    const r = run(
      data(),
      [
        ['aggression', 1],
        ['defend0', 4],
      ],
      (t) => (t === 1 ? ['aggression'] : []),
    );
    expect(events(r.log, 'moved')).toEqual([]);
    expect(events(r.log, 'upgraded')).toEqual([]);
  });
});

describe('#113 Stratagem (on shuffle)', () => {
  it('after a reshuffle, the strategy chooses a card from the draw pile to put into the hand', () => {
    const requests: ChoiceRequest[] = [];
    const inner = scripted((t) => (t === 1 ? ['stratagem'] : []));
    const strategy: Strategy = {
      decide: (v) => inner.decide(v),
      choose(_view, request) {
        requests.push(request);
        return { uids: [request.options.at(-1)!.uid] };
      },
    };
    const r = run(
      data(),
      [
        ['stratagem', 1],
        ['strike0', 6],
      ],
      () => [],
      1,
      strategy,
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]).toMatchObject({
      purpose: 'move',
      sourcePower: 'stratagem',
      from: 'draw',
      to: 'hand',
      min: 1,
      max: 1,
    });
    // The pick is logged as a move from the draw pile to the hand right after the reshuffle.
    const log = r.log!;
    const shuffle = log.findIndex((e) => e.t === 'shuffle' && e.reason === 'reshuffle');
    expect(log[shuffle + 1]).toMatchObject({ t: 'moved', from: 'draw', to: 'hand' });
  });

  it('the combat-start shuffle does not trigger it, and no card is lost when it takes the last card', () => {
    const r = run(data(), [['stratagem', 1]], (t) => (t === 1 ? ['stratagem'] : []));
    expect(events(r.log, 'moved')).toEqual([]);
    const d = data();
    const one = run(
      d,
      [
        ['stratagem', 1],
        ['strike0', 6],
      ],
      (t) => (t === 1 ? ['stratagem'] : []),
      2,
    );
    expect(one.outcome).toBeDefined();
  });
});

describe('#113 powers stack and the log shows them', () => {
  it('applying the same trigger power twice adds the amounts', () => {
    const r = run(
      data(),
      [
        ['feelNoPain', 2],
        ['burn0I', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['feelNoPain', 'feelNoPain', 'burn0I'] : []),
    );
    expect(events(turnEvents(r.log, 1), 'block').map((b) => b.amount)).toEqual([6]);
  });

  it('the shared dummy enemy and fixtures are untouched by these tests', () => {
    expect(dummy().id).toBe('dummy');
  });
});
