/** Shared setup for the combat test files (not a test file itself). */
import { simulateCombat } from './combat';
import { makeEnemy, makeGameData } from './testFixtures';
import type { CombatConfig, Deck, GameData, GameEvent, Strategy, StrategyView } from './types';
import { GREEDY_CONFIG } from './strategies';

/** Ironclad starter deck vs Nibbit at A0, seed 1, greedy; `overrides` replace any field. */
export function cfg(overrides: Partial<CombatConfig> = {}): CombatConfig {
  return {
    characterId: 'ironclad',
    deck: [
      { cardId: 'strike', upgraded: false, count: 5 },
      { cardId: 'defend', upgraded: false, count: 4 },
      { cardId: 'bash', upgraded: false, count: 1 },
    ],
    enemyId: 'nibbit',
    ascension: 0,
    strategy: GREEDY_CONFIG,
    seed: 1,
    ...overrides,
  };
}

/** Deck entries from [cardId, count, upgraded?] tuples. */
export const deckOf = (...entries: [string, number, boolean?][]): Deck =>
  entries.map(([cardId, count, upgraded]) => ({ cardId, upgraded: upgraded ?? false, count }));

/** Strategy that ends every turn immediately. */
export const passive: Strategy = { decide: () => ({ kind: 'endTurn' }) };

/** Plays the listed cardIds in order each turn (a missing card throws). */
export function scripted(plan: (turn: number) => string[]): Strategy {
  let turn = -1;
  let queue: string[] = [];
  return {
    decide(view: StrategyView) {
      if (view.state.turn !== turn) {
        turn = view.state.turn;
        queue = [...plan(turn)];
      }
      const want = queue.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`scripted: ${want} not playable on turn ${turn}`);
      return { kind: 'play', uid: c.uid };
    },
  };
}

export const withEnemy = (data: GameData, ...enemies: ReturnType<typeof makeEnemy>[]) => {
  for (const e of enemies) data.enemies[e.id] = e;
  return data;
};

/** A 999-HP enemy that never acts. */
export const dummy = () => makeEnemy('dummy', 999, { wait: { name: 'Wait', effects: [] } });

/** Game data with the `dummy` enemy added. */
export const dummyData = () => withEnemy(makeGameData(), dummy());

export const noDebuffs = () => ({ vulnerable: 0, weak: 0, frail: 0 });

/** Run a combat with the event log on; `overrides` go to `cfg`. */
export const logged = (data: GameData, strategy: Strategy, overrides: Partial<CombatConfig> = {}) =>
  simulateCombat(data, cfg(overrides), strategy, { log: true });

export type Ev<T extends GameEvent['t']> = Extract<GameEvent, { t: T }>;

/** The logged events of one type. */
export const events = <T extends GameEvent['t']>(log: GameEvent[] | undefined, t: T): Ev<T>[] =>
  (log ?? []).filter((e): e is Ev<T> => e.t === t);
