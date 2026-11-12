import { describe, expect, it, vi } from 'vitest';
import { gameData } from '../../data/index';
import { simulateCombat } from '../combat';
import { GREEDY_CONFIG } from '../strategies';
import type { CombatConfig, DebuffKind, Strategy, StrategyView } from '../types';

/** Test-side control of the engine's Rng: forced enemy HP roll and forced draw order. */
const control = vi.hoisted(() => ({
  enemyHp: 0,
  rolled: false,
  /** Card ids still to be drawn, in draw order. */
  demand: [] as string[],
  error: null as string | null,
}));

vi.mock('../rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rng')>();
  return {
    ...real,
    createRng: (seed: number) => {
      const rng = real.createRng(seed);
      return {
        ...rng,
        // The engine's first Rng call is the enemy HP roll (see the constructor in combat.ts).
        int: (min: number, max: number) => {
          if (!control.rolled) {
            control.rolled = true;
            return control.enemyHp;
          }
          return rng.int(min, max);
        },
        // Order the pile so that popping from the end follows the recorded hands.
        shuffle: <T extends { cardId: string }>(items: T[]): T[] => {
          const wanted = control.demand.splice(0, items.length);
          const rest = [...items];
          const ordered: T[] = [];
          for (const id of wanted) {
            const i = rest.findIndex((c) => c.cardId === id);
            if (i < 0) {
              control.error ??= `recorded hands need ${id} but the pile being shuffled does not have it`;
              break;
            }
            ordered.push(rest.splice(i, 1)[0]!);
          }
          // The last shuffle may be longer than the recorded draws: the rest is never drawn, so any order will do.
          const full = [...ordered, ...rest].reverse();
          items.splice(0, items.length, ...full);
          return items;
        },
      };
    },
  };
});

type Side = Partial<Record<'hp' | 'block' | 'strength' | 'shrink' | DebuffKind, number>>;
interface State {
  player?: Side;
  enemy?: Side;
}
interface Fixture {
  combat: string;
  gameVersion: string;
  character: string;
  ascension: number;
  deck: { card: string; count: number; upgraded?: boolean }[];
  enemy: { id: string; startHp: number };
  player: { startHp: number; maxHp: number };
  turns: {
    hand: string[];
    plays: string[];
    atStart?: State;
    afterPlays?: State;
    afterEnemy?: State;
    enemyHpAfterEachPlay?: number[];
  }[];
  result: { outcome: 'win' | 'loss'; turns: number; finalHp: number; hpLost: number };
}

const files = import.meta.glob<Fixture>('./*.json', { eager: true, import: 'default' });

/** Every field is read off a snapshot of the live state. */
function snapshot(view: StrategyView): { player: Side; enemy: Side } {
  const { player, enemy } = view.state;
  return {
    player: {
      hp: player.hp,
      block: player.block,
      strength: player.strength,
      shrink: player.shrink ?? 0,
      ...player.debuffs,
    },
    enemy: { hp: enemy.hp, block: enemy.block, strength: enemy.strength, ...enemy.debuffs },
  };
}

function replay(fx: Fixture) {
  const mismatches: string[] = [];
  const startMaxHp = fx.player.maxHp;
  const miss = (turn: number | string, stage: string, field: string, expected: unknown, actual: unknown) =>
    mismatches.push(`${fx.combat} turn ${turn} ${stage}: ${field}: expected ${expected}, engine ${actual}`);

  /** Compare the recorded fields; player HP is compared as loss from the starting HP. */
  const compare = (turn: number, stage: string, want: State | undefined, got: { player: Side; enemy: Side }) => {
    for (const who of ['player', 'enemy'] as const) {
      for (const [field, value] of Object.entries(want?.[who] ?? {})) {
        if (field === 'hp' && who === 'player') {
          const expectedLoss = fx.player.startHp - value;
          const engineLoss = startMaxHp - (got.player.hp as number);
          if (expectedLoss !== engineLoss) miss(turn, stage, 'player HP lost from start', expectedLoss, engineLoss);
        } else {
          const actual = got[who][field as keyof Side];
          if (actual !== value) miss(turn, stage, `${who}.${field}`, value, actual);
        }
      }
    }
  };

  const queue: string[] = [];
  let turn = 0;
  let step = 0;
  const seen = new Set<number>();
  /** Snapshots after each play of a turn, and the last one seen. */
  const afterEach: Record<number, number[]> = {};

  const strategy: Strategy = {
    decide(view) {
      const t = view.state.turn;
      const snap = snapshot(view);
      const plan = fx.turns[t - 1];
      if (!plan) throw new Error(`${fx.combat}: engine reached turn ${t} but the fixture has ${fx.turns.length} turns`);
      if (!seen.has(t)) {
        // First decision of a turn: the previous enemy move is done and this turn's hand is drawn.
        if (t > 1) compare(t - 1, 'after enemy move', fx.turns[t - 2]!.afterEnemy, snap);
        seen.add(t);
        turn = t;
        step = 0;
        queue.splice(0, queue.length, ...plan.plays);
        const hand = view.state.player.hand.map((c) => c.cardId).sort();
        const want = [...plan.hand].sort();
        if (hand.join() !== want.join()) miss(t, 'draw', 'hand', want.join(' '), hand.join(' '));
        compare(t, 'start', plan.atStart, snap);
      } else {
        (afterEach[turn] ??= []).push(snap.enemy.hp as number);
      }
      const want = queue.shift();
      if (want === undefined) {
        compare(t, 'after plays', plan.afterPlays, snap);
        return { kind: 'endTurn' };
      }
      const card = view.playable.find((c) => c.cardId === want);
      if (!card) {
        throw new Error(`${fx.combat} turn ${t} play ${step + 1}: ${want} is not playable in the engine`);
      }
      step++;
      return { kind: 'play', uid: card.uid };
    },
  };

  const config: CombatConfig = {
    characterId: fx.character,
    deck: fx.deck.map((d) => ({ cardId: d.card, upgraded: d.upgraded ?? false, count: d.count })),
    enemyId: fx.enemy.id,
    ascension: fx.ascension,
    strategy: GREEDY_CONFIG,
    seed: 1,
  };

  control.enemyHp = fx.enemy.startHp;
  control.rolled = false;
  control.error = null;
  control.demand = fx.turns.flatMap((t) => t.hand);

  const character = gameData.characters[fx.character];
  expect(character?.maxHp, `${fx.combat}: fixture player.maxHp vs data`).toBe(fx.player.maxHp);
  expect(gameData.manifest.gameVersion, `${fx.combat}: fixture gameVersion vs data manifest`).toBe(fx.gameVersion);

  const result = simulateCombat(gameData, config, strategy);
  if (control.error) throw new Error(`${fx.combat}: ${control.error}`);

  // The combat ended on a turn: check what is known from the result for that turn.
  const endTurn = result.turns;
  const lastPlan = fx.turns[endTurn - 1];
  if (lastPlan && result.outcome === 'win') {
    if (lastPlan.afterPlays?.enemy?.hp !== undefined && lastPlan.afterPlays.enemy.hp !== result.enemyHpRemaining) {
      miss(endTurn, 'after plays', 'enemy.hp', lastPlan.afterPlays.enemy.hp, result.enemyHpRemaining);
    }
    // The final play's enemy HP is the result's.
    (afterEach[endTurn] ??= []).push(result.enemyHpRemaining);
  }

  fx.turns.forEach((plan, i) => {
    const expected = plan.enemyHpAfterEachPlay;
    if (!expected) return;
    const got = afterEach[i + 1] ?? [];
    expected.forEach((hp, k) => {
      if (got[k] !== hp) miss(i + 1, `after play ${k + 1}`, 'enemy.hp', hp, got[k]);
    });
  });

  if (fx.turns.length !== result.turns) {
    miss('-', 'result', 'turns in fixture vs engine', fx.turns.length, result.turns);
  }
  if (result.outcome !== fx.result.outcome) miss('-', 'result', 'outcome', fx.result.outcome, result.outcome);
  if (result.turns !== fx.result.turns) miss('-', 'result', 'turns', fx.result.turns, result.turns);
  if (result.hpLost !== fx.result.hpLost) miss('-', 'result', 'HP lost from start', fx.result.hpLost, result.hpLost);
  return mismatches;
}

describe('golden combats', () => {
  const fixtures = Object.entries(files);

  it('has at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const [path, fx] of fixtures) {
    describe(fx.combat, () => {
      it('is named after its file and is self-consistent', () => {
        expect(path).toBe(`./${fx.combat}.json`);
        expect(fx.result.hpLost, 'result.hpLost = startHp - finalHp').toBe(fx.player.startHp - fx.result.finalHp);
        for (const t of fx.turns) {
          if (t.afterEnemy?.player && 'block' in t.afterEnemy.player) {
            throw new Error(`${fx.combat}: afterEnemy.player.block cannot be checked (Block resets at turn start)`);
          }
        }
      });

      it('matches the engine turn by turn', () => {
        const mismatches = replay(fx);
        expect(mismatches, mismatches.join('\n')).toEqual([]);
      });
    });
  }
});
