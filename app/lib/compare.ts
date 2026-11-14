/**
 * Combat replay for the log views, and turn alignment for the side-by-side compare view:
 * every column shows the same turn; a column whose combat already ended shows that instead.
 */
import { computeIntent, simulateCombat } from '../../engine/combat';
import { resolveEnemy } from '../../engine/enemy';
import { createStrategy } from '../../engine/strategies';
import type {
  CombatResult,
  Effect,
  EnemyIntent,
  GameData,
  Outcome,
  Strategy,
  StrategyConfig,
} from '../../engine/types';
import { buildReplay, intendedMoveId, type Replay } from './logReplay';
import { enemyIdsField, type SetupState } from './url';
import { setupRelics } from './relics';

export type TurnIntent = { intent: EnemyIntent; effects: Effect[] } | null;

export type ReplayedCombat =
  { ok: true; replay: Replay; intents: TurnIntent[]; result: CombatResult } | { ok: false; error: string };

/** Re-run one combat with its log, grouped into rounds, with the intent the player saw each turn. */
export function replayCombat(
  data: GameData,
  setup: SetupState,
  strategy: StrategyConfig,
  seed: number,
): ReplayedCombat {
  try {
    // #4: record the intent the strategy sees each turn, so a final round the enemy never acted
    // in still shows its intent (a random pattern's next move can't be worked out from the log).
    const seen = new Map<number, string>();
    // #5: with several enemies the log shows the intents the strategy saw (first decision of each turn).
    const seenMulti = new Map<number, EnemyIntent>();
    const inner = createStrategy(strategy);
    const recording: Strategy = {
      decide: (view) => {
        if (!seen.has(view.state.turn)) {
          seen.set(view.state.turn, view.intent.moveId);
          if (view.intents && view.intents.length > 1)
            seenMulti.set(view.state.turn, multiIntent(view.intents, view.state.enemies ?? []));
        }
        return inner.decide(view);
      },
    };
    if (inner.choose) recording.choose = inner.choose;
    const result = simulateCombat(
      data,
      {
        characterId: setup.characterId,
        deck: setup.deck,
        enemyId: setup.enemyId,
        ...enemyIdsField(setup),
        ascension: setup.ascension,
        ...(setup.startHp !== undefined ? { startHp: setup.startHp } : {}),
        ...(setup.potions && setup.potions.length > 0 ? { potions: setup.potions } : {}),
        relics: setupRelics(data, setup),
        strategy,
        seed,
      },
      recording,
      { log: true },
    );
    const replay = buildReplay(result.log ?? []);
    if (seenMulti.size > 0) {
      const intents = replay.rounds.map((round): TurnIntent => {
        const intent = seenMulti.get(round.turn);
        return intent ? { intent, effects: [] } : null;
      });
      return { ok: true, replay, intents, result };
    }
    const base = data.enemies[setup.enemyId];
    const resolved = base ? resolveEnemy(base, setup.ascension) : null;
    const intents = replay.rounds.map((round, i): TurnIntent => {
      if (!resolved) return null;
      const id = intendedMoveId(replay.rounds, i, seen);
      const move = id ? resolved.moves[id] : undefined;
      return id && move
        ? { intent: computeIntent(id, move, round.start.enemy, round.start.player), effects: move.effects }
        : null;
    });
    return { ok: true, replay, intents, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * #5: one intent line for several enemies: the living enemies' move names joined by " + ", their
 * attacks and the summed incoming damage.
 */
export function multiIntent(intents: readonly EnemyIntent[], enemies: readonly { hp: number }[]): EnemyIntent {
  const alive = intents.filter((_, i) => (enemies[i]?.hp ?? 1) > 0);
  return {
    moveId: alive[0]?.moveId ?? '',
    name: alive.map((x) => x.name).join(' + '),
    attacks: alive.flatMap((x) => x.attacks),
    totalIncoming: alive.reduce((n, x) => n + x.totalIncoming, 0),
  };
}

/** "Won" / "Died" / "Hit the turn cap". */
export function outcomeLabel(outcome: Outcome): string {
  return outcome === 'win' ? 'Won' : outcome === 'loss' ? 'Died' : 'Hit the turn cap';
}

/** Turns in the shared selector: the longest column's round count (0 when nothing replayed). */
export function sharedTurnCount(roundCounts: readonly number[]): number {
  return roundCounts.reduce((m, n) => Math.max(m, n), 0);
}

/** Keep a 0-based turn index inside [0, count - 1] (0 when count is 0). */
export function clampTurn(idx: number, count: number): number {
  return Math.max(0, Math.min(count - 1, idx));
}

/** What a column shows at the shared 0-based turn: that round, or that its combat ended on turn N (1-based). */
export type ColumnTurn = { kind: 'round'; index: number } | { kind: 'ended'; endTurn: number };

export function columnTurn(roundCount: number, turnIdx: number): ColumnTurn {
  return turnIdx < roundCount ? { kind: 'round', index: turnIdx } : { kind: 'ended', endTurn: roundCount };
}
