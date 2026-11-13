/** #110 strategy defaults: boosters only before an Attack, Dark Shackles only vs an attack, Panic Button last, utility cards. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import { createStrategy, GREEDY_CONFIG, isAttackBooster, isEnemyWeakener, isPanicButton } from './strategies';
import { cards } from './testFixtures';
import type { CardDef, CardInstance, Effect, PowerId, StrategyView } from './types';

const apply = (p: PowerId, amount: number): Effect => ({ type: 'applyPower', power: p, amount });
const def = (id: string, type: CardDef['type'], cost: number, effects: Effect[]): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  type,
  cost,
  effects,
  upgraded: null,
});
const defs: Record<string, CardDef> = {
  strike: cards.strike!,
  defend: cards.defend!,
  frenzy: def('frenzy', 'skill', 0, [apply('strengthThisTurn', 5)]),
  setup: def('setup', 'attack', 1, [{ type: 'attack', damage: 7, hits: 1 }, apply('strengthThisTurn', 3)]),
  shackles: def('shackles', 'skill', 0, [{ type: 'applyEnemyPower', power: 'strengthLossThisTurn', amount: 9 }]),
  panic: def('panic', 'skill', 0, [{ type: 'gainBlock', amount: 30 }, apply('noBlockFromCards', 2)]),
  punch: def('punch', 'skill', 1, [apply('doubleAttack', 1)]),
  bomb: def('bomb', 'skill', 2, [
    { type: 'schedule', delay: 2, at: 'turnEnd', effects: [{ type: 'dealDamage', amount: 40 }] },
  ]),
  prolong: def('prolong', 'skill', 0, [{ type: 'script', id: 'prolong' }]),
};

let uid = 0;
const inst = (id: string): CardInstance => makeCardInstance(defs[id]!, false, uid++);

function view(
  ids: string[],
  o: {
    energy?: number;
    incoming?: number;
    hp?: number;
    block?: number;
    powers?: Partial<Record<PowerId, number>>;
  } = {},
): StrategyView {
  const hand = ids.map(inst);
  const energy = o.energy ?? 3;
  const player = {
    hp: o.hp ?? 80,
    maxHp: 80,
    block: o.block ?? 0,
    energy,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    drawPile: [],
    hand,
    discardPile: [],
    exhaustPile: [],
    powers: o.powers,
  };
  const enemy = {
    enemyId: 'e',
    name: 'e',
    hp: 50,
    maxHp: 50,
    block: 0,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    poison: 0,
    patternIndex: 0,
  };
  const incoming = o.incoming ?? 0;
  return {
    state: { turn: 1, player, enemy } as StrategyView['state'],
    intent: {
      moveId: 'm',
      name: 'm',
      attacks: incoming > 0 ? [{ damagePerHit: incoming, hits: 1 }] : [],
      totalIncoming: incoming,
    },
    playable: hand.filter((c) => (c.cost ?? 99) <= energy),
  };
}

const next = (v: StrategyView) => {
  const d = createStrategy(GREEDY_CONFIG).decide(v);
  return d.kind === 'endTurn' ? 'end' : v.state.player.hand.find((c) => c.uid === d.uid)!.cardId;
};

describe('#110 strategy defaults', () => {
  it('classifies the cards', () => {
    expect(isAttackBooster(inst('frenzy'))).toBe(true);
    expect(isAttackBooster(inst('punch'))).toBe(true);
    expect(isAttackBooster(inst('setup'))).toBe(false); // an Attack, always counted as 7 damage
    expect(isEnemyWeakener(inst('shackles'))).toBe(true);
    expect(isPanicButton(inst('panic'))).toBe(true);
  });

  it('plays temporary Strength first when an Attack follows, never alone', () => {
    expect(next(view(['strike', 'frenzy']))).toBe('frenzy');
    expect(next(view(['frenzy', 'defend']))).toBe('defend');
    expect(next(view(['frenzy', 'strike'], { energy: 0 }))).toBe('end'); // the Strike is unaffordable
  });

  it('One-Two Punch needs energy left for the Attack', () => {
    expect(next(view(['punch', 'strike'], { energy: 2 }))).toBe('punch');
    expect(next(view(['punch', 'strike'], { energy: 1 }))).toBe('strike');
  });

  it('Setup Strike is ranked as a 7-damage Attack: before a 6-damage Strike', () => {
    expect(next(view(['strike', 'setup']))).toBe('setup');
  });

  it('plays Dark Shackles only when the enemy is attacking', () => {
    expect(next(view(['shackles', 'strike'], { incoming: 9 }))).toBe('shackles');
    expect(next(view(['shackles', 'strike'], { incoming: 0 }))).toBe('strike');
    expect(next(view(['shackles'], { incoming: 0 }))).toBe('end');
  });

  it('keeps Panic Button as the last resort: only after everything else, and only against lethal damage', () => {
    expect(next(view(['panic', 'defend'], { incoming: 30, hp: 80 }))).toBe('defend');
    expect(next(view(['panic'], { incoming: 30, hp: 80 }))).toBe('end');
    expect(next(view(['panic'], { incoming: 30, hp: 20 }))).toBe('panic');
    expect(next(view(['panic'], { incoming: 30, hp: 20, block: 15 }))).toBe('end'); // 15 gets through, not lethal
  });

  it('Panic Button boundary: played when the unblocked damage equals HP, not when it is 1 short', () => {
    expect(next(view(['panic'], { incoming: 30, hp: 20, block: 10 }))).toBe('panic'); // 20 gets through = HP
    expect(next(view(['panic'], { incoming: 30, hp: 20, block: 11 }))).toBe('end'); // 19 gets through
  });

  it('does not play Panic Button, or Block-only cards, while Block from cards is off', () => {
    expect(next(view(['panic'], { incoming: 30, hp: 20, powers: { noBlockFromCards: 1 } }))).toBe('end');
    expect(next(view(['defend'], { incoming: 30, powers: { noBlockFromCards: 1 } }))).toBe('end');
  });

  it('plays The Bomb and Prolong (with Block) only with leftover energy', () => {
    expect(next(view(['bomb', 'strike'], { energy: 3 }))).toBe('strike');
    expect(next(view(['bomb'], { energy: 3 }))).toBe('bomb');
    expect(next(view(['prolong']))).toBe('end');
    expect(next(view(['prolong'], { block: 5 }))).toBe('prolong');
  });
});
