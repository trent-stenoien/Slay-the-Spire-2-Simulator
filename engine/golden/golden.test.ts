import { describe, expect, it, vi } from 'vitest';
import { gameData } from '../../data/index';
import { SIMULATED_POWER_IDS, simulateCombat } from '../combat';
import { patternMoveIds, resolveEnemy } from '../enemy';
import { GREEDY_CONFIG } from '../strategies';
import { makeEnemy } from '../testFixtures';
import type {
  CardInstance,
  ChoiceRequest,
  ChoiceResponse,
  CombatConfig,
  DeepReadonly,
  EnemyPowerId,
  GameData,
  GameEvent,
  PotionUse,
  Strategy,
  StrategyView,
} from '../types';

/** Test-side control of the engine's Rng: forced enemy HP roll and forced draw order. */
const control = vi.hoisted(() => ({
  /** HP rolls still to be returned: the engine's first Rng calls, one per enemy, left to right. */
  enemyHps: [] as number[],
  /** Card refs ("id" or "id+" for upgraded) still to be drawn, in draw order. */
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
        // The engine's first Rng calls are the enemy HP rolls, one per enemy (see the constructor in combat.ts).
        int: (min: number, max: number) => {
          if (control.enemyHps.length > 0) return control.enemyHps.shift()!;
          return rng.int(min, max);
        },
        // Order the pile so that popping from the end follows the recorded draws.
        shuffle: <T extends { cardId: string; upgraded?: boolean }>(items: T[]): T[] => {
          const wanted = control.demand.splice(0, items.length);
          const rest = [...items];
          const ordered: T[] = [];
          for (const ref of wanted) {
            const { id, upgraded } = parseRef(ref);
            // Prefer the exact upgrade state; a card upgraded later (in the draw pile) still matches by id.
            let i = rest.findIndex((c) => c.cardId === id && (c.upgraded ?? false) === upgraded);
            if (i < 0) i = rest.findIndex((c) => c.cardId === id);
            if (i < 0) {
              control.error ??= `recorded draws need ${ref} but the pile being shuffled does not have it`;
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

/** A card in a fixture: its id, with "+" appended when upgraded ("strike+"). */
type CardRef = string;
function parseRef(ref: CardRef): { id: string; upgraded: boolean } {
  return ref.endsWith('+') ? { id: ref.slice(0, -1), upgraded: true } : { id: ref, upgraded: false };
}
const refOf = (c: DeepReadonly<CardInstance>): CardRef => c.cardId + (c.upgraded ? '+' : '');
const matches = (c: DeepReadonly<CardInstance>, ref: CardRef) => refOf(c) === ref;

const ENEMY_POWERS: EnemyPowerId[] = ['strengthLossThisTurn', 'stun', 'artifact', 'strengthPerTurn', 'slippery'];
const BASE_FIELDS = ['hp', 'block', 'strength', 'shrink', 'energy', 'vulnerable', 'weak', 'frail', 'poison'];

type Side = Record<string, number>;
interface State {
  player?: Side;
  enemy?: Side;
  /** Multi-enemy fights: one entry per enemy alias (an enemy that is dead reads hp 0). */
  enemies?: EnemyStates;
}
/** Fields of a multi-enemy state: one Side per enemy, keyed by alias. */
type EnemyStates = Record<string, Side>;
interface Turn {
  hand: CardRef[];
  /** Cards drawn during the turn (Pommel Strike), in draw order. */
  drawn?: CardRef[];
  /** Cards that left the draw pile without being drawn (Havoc's top card), in order. Forced after hand and drawn. Not checked. */
  playedFromDraw?: CardRef[];
  plays: CardRef[];
  /** Multi-enemy fights: the alias of the enemy each play targets (same length as plays; null = untargeted). */
  targets?: (string | null)[];
  /** Potions used this turn: before play N (1-based; plays.length + 1 = before ending the turn). `target`: enemy alias. */
  potions?: { potion: string; beforePlay: number; target?: string }[];
  /** Answers to Strategy.choose prompts this turn, in order (Armaments: which card to upgrade). */
  choices?: { source?: string; pick: CardRef[] }[];
  atStart?: State;
  afterPlays?: State;
  afterEnemy?: State;
  /** Enemy HP after each play. Multi-enemy: the HP of the enemy that play (or potion) targeted. */
  enemyHpAfterEachPlay?: number[];
  /** The move the enemy makes after this turn's plays (single enemy; all turns or none). */
  enemyMove?: string;
  /** Multi-enemy: each living enemy's move after this turn's plays, by alias (turn 1 = the opener). Give turn 1 for every enemy. */
  enemyMoves?: Record<string, string>;
}
interface Fixture {
  combat: string;
  source?: string;
  gameVersion: string;
  character: string;
  ascension: number;
  deck: { card: string; count: number; upgraded?: boolean }[];
  /** One enemy; or `enemies` for a multi-enemy fight (left to right; `alias` names each in targets and states). */
  enemy?: { id: string; startHp: number };
  enemies?: { id: string; startHp: number; alias: string }[];
  player: { startHp: number; maxHp: number };
  relics?: { id: string; choice?: number }[];
  potions?: string[];
  playerStart?: CombatConfig['playerStart'];
  turns: Turn[];
  result: { outcome: 'win' | 'loss'; turns: number; finalHp: number; hpLost: number };
  /** Mismatches the record has with the engine, kept as documented findings. Each must still occur. */
  knownDiffs?: { diff: string; reason: string }[];
  /** Skip the replay (the fixture is still checked for consistency). */
  skip?: string;
}

const files = import.meta.glob<Fixture>('./*.json', { eager: true, import: 'default' });

/** Every field is read off a snapshot of the live state; powers by id, absent = 0. */
interface Snap {
  player: Side;
  enemy: Side;
  enemies: EnemyStates;
}
function snapshot(view: StrategyView, aliases: string[] = []): Snap {
  const { player, enemy } = view.state;
  const side = (e: typeof enemy): Side => ({
    hp: Math.max(0, e.hp),
    block: e.block,
    strength: e.strength,
    poison: e.poison,
    ...e.debuffs,
    ...(e.powers as Side | undefined),
  });
  const enemies: EnemyStates = {};
  (view.state.enemies ?? []).forEach((e, i) => {
    if (aliases[i] !== undefined) enemies[aliases[i]!] = side(e);
  });
  return {
    enemies,
    player: {
      hp: player.hp,
      block: player.block,
      strength: player.strength,
      shrink: player.shrink ?? 0,
      energy: player.energy,
      ...player.debuffs,
      ...(player.powers as Side | undefined),
    },
    enemy: side(enemy),
  };
}

/** The fixture's enemies, left to right; a single `enemy` gets the alias "" and the multi-enemy code paths stay off. */
function enemyList(fx: Fixture): { id: string; startHp: number; alias: string }[] {
  return fx.enemies ?? [{ ...fx.enemy!, alias: '' }];
}

/** Fields a fixture state may name; anything else is a typo. */
function checkFields(fx: Fixture): string[] {
  const allowed = {
    player: new Set<string>([...BASE_FIELDS, ...SIMULATED_POWER_IDS]),
    enemy: new Set<string>([...BASE_FIELDS, ...ENEMY_POWERS]),
  };
  const bad: string[] = [];
  fx.turns.forEach((t, i) => {
    for (const stage of ['atStart', 'afterPlays', 'afterEnemy'] as const) {
      for (const who of ['player', 'enemy'] as const) {
        for (const f of Object.keys(t[stage]?.[who] ?? {})) {
          if (!allowed[who].has(f)) bad.push(`turn ${i + 1} ${stage}.${who}.${f}`);
        }
      }
      for (const [alias, side] of Object.entries(t[stage]?.enemies ?? {})) {
        if (!enemyList(fx).some((e) => e.alias === alias)) bad.push(`turn ${i + 1} ${stage}.enemies.${alias}`);
        for (const f of Object.keys(side))
          if (!allowed.enemy.has(f)) bad.push(`turn ${i + 1} ${stage}.enemies.${alias}.${f}`);
      }
    }
  });
  return bad;
}

/** Log events that put a card into, or take one out of, the draw pile other than by a draw or shuffle. */
function drawPileChanges(log: readonly GameEvent[]): { turn: number; text: string }[] {
  let turn = 0;
  const out: { turn: number; text: string }[] = [];
  for (const e of log) {
    if (e.t === 'turnStart' && e.side === 'player') turn = e.turn;
    const into = (e.t === 'generated' || e.t === 'moved') && e.to.startsWith('draw');
    const outOf = e.t === 'moved' && e.from === 'draw';
    if (into || outOf) {
      const where = e.t === 'moved' ? `moved from ${e.from} to ${e.to}` : `added to ${e.to} (${e.source})`;
      out.push({ turn, text: `${e.cardId} ${where}` });
    }
  }
  return out;
}

/**
 * Why the recorded enemy moves are not a legal run of the enemy's random pattern, or null when they are.
 * Turn 1's move is the one shown at combat start; turn N's is the one made after turn N's plays.
 */
function enemyMoveProblem(fx: Fixture, data: GameData): string | null {
  if (fx.enemies) return multiEnemyMoveProblem(fx, data);
  const def = data.enemies[fx.enemy!.id];
  if (!def) return `unknown enemy ${fx.enemy!.id}`;
  const { pattern, moves } = resolveEnemy(def, fx.ascension);
  if (pattern.type !== 'random') return `${fx.enemy!.id} follows a fixed cycle, not a random pick`;
  const used = new Set<string>();
  let last: string | null = null;
  for (const [i, t] of fx.turns.entries()) {
    const id = t.enemyMove;
    if (id === undefined) return `turn ${i + 1}: enemyMove is missing (list it on every turn)`;
    const opener = pattern.opener?.[i];
    if (opener !== undefined) {
      if (id !== opener) return `turn ${i + 1}: ${id} but the opener forces ${opener}`;
    } else {
      if (!pattern.moves.includes(id)) return `turn ${i + 1}: ${id} is not in ${fx.enemy!.id}'s move pool`;
      if (used.has(id)) return `turn ${i + 1}: ${id} is once per fight and was already made`;
      if (pattern.noRepeat && id === last) return `turn ${i + 1}: ${id} repeats the previous move (no-repeat)`;
    }
    if (moves[id]?.oncePerFight) used.add(id);
    last = id;
  }
  return null;
}

/**
 * Why the recorded per-enemy moves (`enemyMoves`) are not legal, or null when they are. Every enemy needs its
 * turn-1 move; a move must be in its pattern; an `alternate` pattern (Inklet) must take its two halves in turns.
 */
function multiEnemyMoveProblem(fx: Fixture, data: GameData): string | null {
  for (const e of fx.enemies!) {
    const def = data.enemies[e.id];
    if (!def) return `unknown enemy ${e.id}`;
    const { pattern } = resolveEnemy(def, fx.ascension);
    const all = patternMoveIds(pattern);
    let last: string | undefined;
    for (const [i, t] of fx.turns.entries()) {
      const id = t.enemyMoves?.[e.alias];
      if (id === undefined) {
        if (i === 0) return `turn 1: enemyMoves.${e.alias} is missing (every enemy needs its turn-1 move)`;
        last = undefined;
        continue;
      }
      if (!all.includes(id)) return `turn ${i + 1}: ${e.alias} (${e.id}) has no move ${id}`;
      if (pattern.type === 'alternate' && last !== undefined) {
        const wasFixed = last === pattern.fixed;
        const isFixed = id === pattern.fixed;
        if (wasFixed === isFixed) return `turn ${i + 1}: ${e.alias} makes ${id} after ${last} (alternate pattern)`;
      }
      last = id;
    }
  }
  return null;
}

/**
 * Multi-enemy fights: each enemy gets its own copy of its definition (id `<id>__<alias>`, so two Inklets can
 * differ) with the recorded moves as a harness-only cycle. A turn where the enemy has no entry (it is dead)
 * repeats its previous move.
 */
function withEnemyMovesMulti(fx: Fixture, data: GameData): { data: GameData; enemyIds: string[] } {
  const out = structuredClone(data);
  const enemyIds = fx.enemies!.map((e) => {
    const def = structuredClone(out.enemies[e.id]!);
    def.id = `${e.id}__${e.alias}`;
    let last = '';
    def.pattern = {
      type: 'cycle',
      order: fx.turns.map((t) => (last = t.enemyMoves?.[e.alias] ?? last)),
      start: 'first',
    };
    for (const o of Object.values(def.ascension)) delete o.pattern;
    out.enemies[def.id] = def;
    return def.id;
  });
  return { data: out, enemyIds };
}

/** The data with the enemy's random pattern replaced by the recorded move order (a harness-only cycle). */
function withEnemyMoves(fx: Fixture, data: GameData): GameData {
  const out = structuredClone(data);
  const def = out.enemies[fx.enemy!.id]!;
  def.pattern = { type: 'cycle', order: fx.turns.map((t) => t.enemyMove!), start: 'first' };
  for (const o of Object.values(def.ascension)) delete o.pattern;
  return out;
}

/** Replays a fixture through the engine; returns every mismatch, one line each. */
function replay(fx: Fixture, data: GameData = gameData): string[] {
  let enemyIds: string[] | undefined;
  if (fx.turns.some((t) => t.enemyMove !== undefined || t.enemyMoves !== undefined)) {
    const problem = enemyMoveProblem(fx, data);
    if (problem) return [`enemy moves: ${problem}`];
    if (fx.enemies) ({ data, enemyIds } = withEnemyMovesMulti(fx, data));
    else data = withEnemyMoves(fx, data);
  }
  const enemies = enemyList(fx);
  const multi = !!fx.enemies;
  const aliases = enemies.map((e) => e.alias);
  const mismatches: string[] = [];
  const miss = (turn: number | string, stage: string, field: string, expected: unknown, actual: unknown) =>
    mismatches.push(`turn ${turn} ${stage}: ${field}: expected ${expected}, engine ${actual}`);
  let aborted: string | null = null;
  const abort = (msg: string) => {
    aborted ??= msg;
  };
  const aliasIndex = (alias: string | null | undefined): number | undefined => {
    if (alias === null || alias === undefined) return undefined;
    const i = aliases.indexOf(alias);
    if (i < 0) abort(`unknown enemy alias ${alias}`);
    return i < 0 ? undefined : i;
  };

  const compare = (turn: number, stage: string, want: State | undefined, got: Snap) => {
    for (const who of ['player', 'enemy'] as const) {
      for (const [field, value] of Object.entries(want?.[who] ?? {})) {
        const actual = got[who][field] ?? 0;
        if (actual !== value) miss(turn, stage, `${who}.${field}`, value, actual);
      }
    }
    for (const [alias, side] of Object.entries(want?.enemies ?? {})) {
      for (const [field, value] of Object.entries(side)) {
        const actual = got.enemies[alias]?.[field] ?? 0;
        if (actual !== value) miss(turn, stage, `enemy ${alias}.${field}`, value, actual);
      }
    }
  };

  const queue: CardRef[] = [];
  let choices: NonNullable<Turn['choices']> = [];
  let turn = 0;
  let step = 0;
  /** A play was just made: the next call reads the enemy HP after it. */
  let pending = false;
  /** Index of the enemy the last play or potion targeted (multi-enemy fights). */
  let lastTarget: number | undefined;
  /** uids in hand when each turn's first decision came (the turn's draw). */
  const startHands: Record<number, Set<number>> = {};
  const afterEach: Record<number, number[]> = {};
  const usedPotions = new Set<string>();

  /** Turn bookkeeping on the first call of each turn, and the enemy HP after the last play. */
  const observe = (view: StrategyView): Turn | null => {
    const t = view.state.turn;
    if (pending && t === turn) {
      const hit = multi && lastTarget !== undefined ? view.state.enemies?.[lastTarget] : undefined;
      (afterEach[turn] ??= []).push(Math.max(0, (hit ?? view.state.enemy).hp));
    }
    pending = false;
    const plan = fx.turns[t - 1];
    if (!plan) {
      abort(`engine reached turn ${t} but the fixture has ${fx.turns.length} turns`);
      return null;
    }
    if (t !== turn) {
      const snap = snapshot(view, aliases);
      if (t > 1) compare(t - 1, 'after enemy move', fx.turns[t - 2]!.afterEnemy, snap);
      turn = t;
      step = 0;
      pending = false;
      queue.splice(0, queue.length, ...plan.plays);
      choices = [...(plan.choices ?? [])];
      startHands[t] = new Set(view.state.player.hand.map((c) => c.uid));
      const hand = view.state.player.hand.map(refOf).sort();
      const want = [...plan.hand].sort();
      if (hand.join() !== want.join()) miss(t, 'draw', 'hand', want.join(' '), hand.join(' '));
      compare(t, 'start', plan.atStart, snap);
    }
    return plan;
  };

  const strategy: Strategy = {
    usePotion(view): PotionUse | null {
      if (aborted) return null;
      const plan = observe(view);
      const use = plan?.potions?.find((p, i) => p.beforePlay === step + 1 && !usedPotions.has(`${turn}:${i}`));
      if (!plan || !use) return null;
      usedPotions.add(`${turn}:${plan.potions!.indexOf(use)}`);
      const target = aliasIndex(use.target);
      if (target !== undefined) lastTarget = target;
      const slot = (view.state.player.potions ?? []).indexOf(use.potion);
      if (slot < 0) {
        abort(`turn ${turn} before play ${step + 1}: potion ${use.potion} is not held`);
        return null;
      }
      return target === undefined ? { slot } : { slot, target };
    },
    decide(view) {
      if (aborted) return { kind: 'endTurn' };
      const plan = observe(view);
      if (!plan) return { kind: 'endTurn' };
      const want = queue.shift();
      if (want === undefined) {
        compare(turn, 'after plays', plan.afterPlays, snapshot(view, aliases));
        return { kind: 'endTurn' };
      }
      const card = view.playable.find((c) => matches(c, want));
      if (!card) {
        const hand = view.state.player.hand.map(refOf).join(' ');
        abort(`turn ${turn} play ${step + 1}: ${want} is not playable in the engine (hand: ${hand})`);
        return { kind: 'endTurn' };
      }
      const target = aliasIndex(plan.targets?.[step]);
      if (target !== undefined) lastTarget = target;
      step++;
      pending = true;
      return target === undefined ? { kind: 'play', uid: card.uid } : { kind: 'play', uid: card.uid, target };
    },
    choose(_view, request: ChoiceRequest): ChoiceResponse {
      const what = `${request.purpose} for ${request.sourceCardId ?? request.sourcePower ?? '?'}`;
      const options = request.options.map(refOf).join(' ');
      const answer = aborted ? undefined : choices.shift();
      if (!aborted && !answer) {
        abort(`turn ${turn}: Strategy.choose asked (${what}; options ${options}) but the fixture has no choice left`);
      }
      if (answer?.source !== undefined && answer.source !== request.sourceCardId) {
        abort(`turn ${turn}: choice for ${answer.source} but the engine asked ${what}`);
      }
      const uids: number[] = [];
      for (const ref of answer?.pick ?? []) {
        const c = request.options.find((o) => matches(o, ref) && !uids.includes(o.uid));
        if (!c) abort(`turn ${turn}: choice ${ref} is not among the options (${what}; options ${options})`);
        else uids.push(c.uid);
      }
      // After an abort, answer with the first legal pick so the run can finish.
      if (aborted) return { uids: request.options.slice(0, request.min).map((o) => o.uid) };
      return { uids };
    },
  };

  const config: CombatConfig = {
    characterId: fx.character,
    deck: fx.deck.map((d) => ({ cardId: d.card, upgraded: d.upgraded ?? false, count: d.count })),
    enemyId: enemyIds?.[0] ?? enemies[0]!.id,
    ...(multi ? { enemyIds: enemyIds ?? enemies.map((e) => e.id) } : {}),
    ascension: fx.ascension,
    strategy: GREEDY_CONFIG,
    seed: 1,
    startHp: fx.player.startHp,
    ...(fx.relics
      ? { relics: fx.relics.map((r) => ({ relicId: r.id, ...(r.choice ? { choice: r.choice } : {}) })) }
      : {}),
    ...(fx.potions ? { potions: fx.potions } : {}),
    ...(fx.playerStart ? { playerStart: fx.playerStart } : {}),
  };

  control.enemyHps = enemies.map((e) => e.startHp);
  control.error = null;
  control.demand = fx.turns.flatMap((t) => [...t.hand, ...(t.drawn ?? []), ...(t.playedFromDraw ?? [])]);

  const result = simulateCombat(data, config, strategy, { log: true });
  const log = result.log ?? [];
  if (control.error) mismatches.push(`draw order: ${control.error}`);
  if (aborted) mismatches.push(`replay stopped: ${aborted}`);

  // Cards drawn after each turn's first decision (mid-turn draws).
  let at = 0;
  const midDraws: Record<number, CardRef[]> = {};
  for (const e of log) {
    if (e.t === 'turnStart' && e.side === 'player') at = e.turn;
    if (e.t === 'draw' && startHands[at] && !startHands[at]!.has(e.uid)) {
      (midDraws[at] ??= []).push(e.cardId);
    }
  }
  const lastTurn = Math.min(fx.turns.length, Object.keys(startHands).length);
  for (let t = 1; t <= lastTurn; t++) {
    const want = (fx.turns[t - 1]!.drawn ?? []).map((r) => parseRef(r).id).join(' ') || '(none)';
    const got = (midDraws[t] ?? []).join(' ') || '(none)';
    if (want !== got) miss(t, 'mid-turn', 'drawn', want, got);
  }

  // A card put into (or taken from) the draw pile between shuffles shifts the forced order.
  for (const c of drawPileChanges(log)) {
    if (c.turn < fx.turns.length || (fx.turns[c.turn - 1]?.drawn?.length ?? 0) > 0) {
      mismatches.push(
        `turn ${c.turn}: ${c.text}; the shuffle mock cannot force later draws (state it in knownDiffs or skip)`,
      );
    }
  }

  if (aborted) return mismatches;

  // The combat ended on a turn: check what is known from the result for that turn.
  const endTurn = result.turns;
  const lastPlan = fx.turns[endTurn - 1];
  if (lastPlan && result.outcome === 'win') {
    if (lastPlan.afterPlays?.enemy?.hp !== undefined && lastPlan.afterPlays.enemy.hp !== result.enemyHpRemaining) {
      miss(endTurn, 'after plays', 'enemy.hp', lastPlan.afterPlays.enemy.hp, result.enemyHpRemaining);
    }
    (afterEach[endTurn] ??= []).push(result.enemyHpRemaining);
  }

  fx.turns.forEach((plan, i) => {
    plan.enemyHpAfterEachPlay?.forEach((hp, k) => {
      const got = afterEach[i + 1]?.[k];
      if (got !== hp) miss(i + 1, `after play ${k + 1}`, 'enemy.hp', hp, got);
    });
  });

  if (fx.turns.length !== result.turns)
    miss('-', 'result', 'turns in fixture vs engine', fx.turns.length, result.turns);
  if (result.outcome !== fx.result.outcome) miss('-', 'result', 'outcome', fx.result.outcome, result.outcome);
  if (result.turns !== fx.result.turns) miss('-', 'result', 'turns', fx.result.turns, result.turns);
  if (result.hpLost !== fx.result.hpLost) miss('-', 'result', 'hpLost', fx.result.hpLost, result.hpLost);
  return mismatches;
}

/** Mismatches not listed in knownDiffs, and knownDiffs that no longer occur. */
function unexplained(fx: Fixture, mismatches: string[]): string[] {
  const known = fx.knownDiffs ?? [];
  const extra = mismatches.filter((m) => !known.some((k) => k.diff === m));
  const stale = known.filter((k) => !mismatches.includes(k.diff)).map((k) => `stale knownDiff (fixed?): ${k.diff}`);
  return [...extra, ...stale];
}

/** Checks that do not need the engine. */
function consistency(fx: Fixture): void {
  // hpLost = startHp - finalHp - overheal (#205). Overheal is not recorded, so only the bound is checked.
  expect(fx.result.hpLost, 'result.hpLost <= startHp - finalHp (overheal >= 0)').toBeLessThanOrEqual(
    fx.player.startHp - fx.result.finalHp,
  );
  expect(checkFields(fx), 'unknown state fields').toEqual([]);
  for (const k of fx.knownDiffs ?? []) expect(k.reason, `knownDiff without reason: ${k.diff}`).toBeTruthy();
  fx.turns.forEach((t, i) => {
    if (t.afterEnemy?.player && 'block' in t.afterEnemy.player) {
      throw new Error(`turn ${i + 1}: afterEnemy.player.block cannot be checked (Block resets at turn start)`);
    }
    for (const p of t.potions ?? []) {
      if (!(fx.potions ?? []).includes(p.potion)) throw new Error(`turn ${i + 1}: potion ${p.potion} not in potions`);
      if (p.beforePlay < 1 || p.beforePlay > t.plays.length + 1) {
        throw new Error(`turn ${i + 1}: potion beforePlay ${p.beforePlay} is outside 1..${t.plays.length + 1}`);
      }
    }
  });
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
        consistency(fx);
        const character = gameData.characters[fx.character];
        expect(character?.maxHp, 'fixture player.maxHp vs data').toBe(fx.player.maxHp);
        expect(gameData.manifest.gameVersion, 'fixture gameVersion vs data manifest').toBe(fx.gameVersion);
      });

      it.skipIf(!!fx.skip)(`matches the engine turn by turn${fx.skip ? ` (skipped: ${fx.skip})` : ''}`, () => {
        const left = unexplained(fx, replay(fx));
        expect(left, left.join('\n')).toEqual([]);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Synthetic fixtures: each exercises one harness feature (#210). Not real combats.
// ---------------------------------------------------------------------------

const base = (over: Partial<Fixture>): Fixture => ({
  combat: 'synthetic',
  gameVersion: gameData.manifest.gameVersion,
  character: 'ironclad',
  ascension: 0,
  deck: [
    { card: 'strike', count: 5 },
    { card: 'defend', count: 4 },
    { card: 'bash', count: 1 },
  ],
  enemy: { id: 'nibbit', startHp: 20 },
  player: { startHp: 80, maxHp: 80 },
  turns: [],
  result: { outcome: 'win', turns: 1, finalHp: 80, hpLost: 0 },
  ...over,
});

/** Game data with test enemies: one that does nothing, one that adds Wounds to the discard / draw pile. */
function testData(): GameData {
  const data = structuredClone(gameData);
  const add = (to: 'discard' | 'drawRandom') => ({
    name: 'Add',
    effects: [{ type: 'addCards' as const, source: { kind: 'card' as const, cardId: 'wound' }, count: 2, to }],
  });
  for (const e of [
    makeEnemy('golden_wait', 99, { wait: { name: 'Wait', effects: [] } }),
    makeEnemy('golden_wounds', 99, { add: add('discard') }),
    makeEnemy('golden_wounds_draw', 99, { add: add('drawRandom') }),
  ]) {
    data.enemies[e.id] = e;
  }
  return data;
}

/** Enemy that cannot be forced: a random pattern with an opener, a no-repeat pool and a once-per-fight move. */
function moveData(): GameData {
  const data = testData();
  const hit = (name: string, damage: number, once = false) => ({
    name,
    ...(once ? { oncePerFight: true } : {}),
    effects: [{ type: 'attack' as const, damage, hits: 1 }],
  });
  const e = makeEnemy('golden_moves', 99, { a: hit('A', 1), b: hit('B', 2), r: hit('R', 3, true) });
  e.pattern = { type: 'random', opener: ['a'], moves: ['a', 'b', 'r'], noRepeat: true };
  data.enemies[e.id] = e;
  return data;
}

/** Relics with a choice, a potion before play 1, startHp below Max HP, playerStart, end-of-combat heal. */
const relicsAndPotion = base({
  player: { startHp: 50, maxHp: 80 },
  relics: [{ id: 'vajra' }, { id: 'girya', choice: 2 }, { id: 'burning_blood' }],
  potions: ['strength_potion'],
  playerStart: { powers: { plating: 3 }, debuffs: { frail: 1 } },
  turns: [
    {
      hand: ['strike', 'strike', 'strike', 'defend', 'defend'],
      potions: [{ potion: 'strength_potion', beforePlay: 1 }],
      // Plating drops by 1 at the start of each player turn, turn 1 included (engine rule).
      atStart: { player: { hp: 50, strength: 3, plating: 2, frail: 1, energy: 3 } },
      plays: ['strike', 'strike'],
      enemyHpAfterEachPlay: [9, 0],
    },
  ],
  // Burning Blood heals 6 after the win: HP lost from the start is negative.
  result: { outcome: 'win', turns: 1, finalHp: 56, hpLost: -6 },
});

/** Armaments choice, Pommel Strike draws, Wounds added to the discard pile and drawn after a reshuffle. */
const choicesAndDraws = base({
  deck: [
    { card: 'armaments', count: 1 },
    { card: 'pommel_strike', count: 1 },
    { card: 'strike', count: 4 },
    { card: 'defend', count: 4 },
  ],
  enemy: { id: 'golden_wounds', startHp: 40 },
  turns: [
    {
      hand: ['armaments', 'pommel_strike', 'strike', 'defend', 'defend'],
      plays: ['armaments', 'pommel_strike', 'strike+'],
      choices: [{ source: 'armaments', pick: ['strike'] }],
      drawn: ['strike'],
      afterPlays: { player: { block: 5 }, enemy: { hp: 22 } },
    },
    {
      hand: ['strike', 'strike', 'defend', 'defend', 'wound'],
      plays: ['strike', 'strike'],
      afterPlays: { enemy: { hp: 10 } },
    },
    {
      hand: ['strike+', 'pommel_strike', 'wound', 'armaments', 'defend'],
      drawn: ['strike'],
      plays: ['pommel_strike', 'strike+'],
      enemyHpAfterEachPlay: [1, 0],
    },
  ],
  result: { outcome: 'win', turns: 3, finalHp: 80, hpLost: 0 },
});

describe('golden harness (#210, synthetic fixtures)', () => {
  it('relics with choices, a potion before play 1, startHp below Max HP, playerStart', () => {
    consistency(relicsAndPotion);
    expect(replay(relicsAndPotion)).toEqual([]);
  });

  it('a potion at the wrong point shows up as a mismatch', () => {
    const late = structuredClone(relicsAndPotion);
    late.turns[0]!.potions = [{ potion: 'strength_potion', beforePlay: 2 }];
    expect(replay(late)).toContain('turn 1 after play 1: enemy.hp: expected 9, engine 11');
  });

  it('Armaments choice, mid-turn draws, Wounds added to the discard pile', () => {
    consistency(choicesAndDraws);
    expect(replay(choicesAndDraws, testData())).toEqual([]);
  });

  it('fails precisely when a choice is missing', () => {
    const fx = structuredClone(choicesAndDraws);
    delete fx.turns[0]!.choices;
    expect(replay(fx, testData())[0]).toMatch(
      /^replay stopped: turn 1: Strategy.choose asked \(upgrade for armaments; options .*\) but the fixture has no choice left$/,
    );
  });

  it('fails precisely when a mid-turn draw is not recorded', () => {
    const fx = structuredClone(choicesAndDraws);
    delete fx.turns[2]!.drawn;
    // Nothing forces the unrecorded draw, so the engine draws whatever is on top.
    expect(replay(fx, testData())).toEqual([
      expect.stringMatching(/^turn 3 mid-turn: drawn: expected \(none\), engine \w+$/),
    ]);
  });

  it('fails precisely when a card goes into the draw pile between shuffles', () => {
    const fx = base({
      enemy: { id: 'golden_wounds_draw', startHp: 30 },
      turns: [
        { hand: ['strike', 'strike', 'strike', 'defend', 'defend'], plays: ['strike', 'strike', 'strike'] },
        { hand: ['strike', 'strike', 'defend', 'defend', 'bash'], plays: ['bash', 'strike'] },
      ],
      result: { outcome: 'win', turns: 2, finalHp: 80, hpLost: 0 },
    });
    expect(replay(fx, testData())).toContain(
      'turn 1: wound added to drawRandom (card); the shuffle mock cannot force later draws (state it in knownDiffs or skip)',
    );
  });

  describe('enemyMove (forced random move order)', () => {
    const hand = ['strike', 'strike', 'strike', 'defend', 'defend'];
    const second = ['strike', 'strike', 'defend', 'defend', 'bash'];
    const withMoves = (moves: string[]) =>
      base({
        enemy: { id: 'golden_moves', startHp: 99 },
        turns: moves.map((enemyMove, i) => ({ hand: i === 1 ? [...second] : [...hand], plays: [], enemyMove })),
        result: { outcome: 'win', turns: moves.length, finalHp: 80, hpLost: 0 },
      });

    it('forces the listed moves: damage taken follows the order', () => {
      const fx = withMoves(['a', 'r', 'b']);
      fx.turns[0]!.afterEnemy = { player: { hp: 79 } };
      fx.turns[1]!.afterEnemy = { player: { hp: 76 } };
      // Nobody can kill the 99 HP enemy, so the engine runs past the fixture's last turn: the only mismatch.
      expect(replay(fx, moveData())).toEqual(['replay stopped: engine reached turn 4 but the fixture has 3 turns']);
      fx.turns[1]!.afterEnemy = { player: { hp: 77 } };
      expect(replay(fx, moveData())).toContain('turn 2 after enemy move: player.hp: expected 77, engine 76');
    });

    it('fails precisely on a second once-per-fight move, a repeat, an opener break and a missing turn', () => {
      const data = moveData();
      expect(replay(withMoves(['a', 'r', 'b', 'r']), data)).toEqual([
        'enemy moves: turn 4: r is once per fight and was already made',
      ]);
      expect(replay(withMoves(['a', 'b', 'b']), data)).toEqual([
        'enemy moves: turn 3: b repeats the previous move (no-repeat)',
      ]);
      expect(replay(withMoves(['b', 'a']), data)).toEqual(['enemy moves: turn 1: b but the opener forces a']);
      expect(replay(withMoves(['a', 'zz']), data)).toEqual([
        "enemy moves: turn 2: zz is not in golden_moves's move pool",
      ]);
      const gap = withMoves(['a', 'b']);
      delete gap.turns[1]!.enemyMove;
      expect(replay(gap, data)).toEqual(['enemy moves: turn 2: enemyMove is missing (list it on every turn)']);
    });
  });

  describe('multi-enemy fixtures (enemies, targets, per-enemy states and moves)', () => {
    const inklets = Object.values(files).find((f) => f.combat === 'inklets-a0-01')!;

    it('replays a real multi-enemy fixture with no mismatch', () => {
      expect(replay(inklets)).toEqual([]);
    });

    it("a different target shows up in that enemy's HP", () => {
      const fx = structuredClone(inklets);
      fx.turns[0]!.targets = ['B', 'B', 'C'];
      const out = replay(fx);
      expect(out).toContain('turn 1 after play 3: enemy.hp: expected 0, engine 12');
      expect(out).toContain('turn 1 after plays: enemy C.hp: expected 13, engine 12');
    });

    it('a per-enemy state is compared by alias', () => {
      const fx = structuredClone(inklets);
      fx.turns[1]!.afterPlays = { enemies: { C: { hp: 11 } } };
      expect(replay(fx)).toEqual(['turn 2 after plays: enemy C.hp: expected 11, engine 12']);
    });

    it('rejects an unknown alias and an unknown state field', () => {
      const fx = structuredClone(inklets);
      fx.turns[0]!.targets = ['B', 'B', 'Z'];
      expect(replay(fx)[0]).toBe('replay stopped: unknown enemy alias Z');
      const typo = structuredClone(inklets);
      typo.turns[0]!.atStart = { enemies: { A: { hpp: 1 }, Q: { hp: 1 } } };
      expect(checkFields(typo)).toEqual(['turn 1 atStart.enemies.A.hpp', 'turn 1 atStart.enemies.Q']);
    });

    it('fails precisely on a move the enemy does not have, a missing opener and a broken alternation', () => {
      const move = (turn: number, alias: string, id: string | undefined) => {
        const fx = structuredClone(inklets);
        if (id === undefined) delete fx.turns[turn]!.enemyMoves![alias];
        else fx.turns[turn]!.enemyMoves![alias] = id;
        return replay(fx);
      };
      expect(move(0, 'A', 'nope')).toEqual(['enemy moves: turn 1: A (inklet) has no move nope']);
      expect(move(0, 'B', undefined)).toEqual([
        'enemy moves: turn 1: enemyMoves.B is missing (every enemy needs its turn-1 move)',
      ]);
      expect(move(1, 'A', 'jab')).toEqual(['enemy moves: turn 2: A makes jab after jab (alternate pattern)']);
    });

    it('forced moves drive the damage: a different opener for C changes the player HP', () => {
      const fx = structuredClone(inklets);
      fx.turns[0]!.enemyMoves!.C = 'whirlwind';
      fx.turns[1]!.enemyMoves!.C = 'jab';
      fx.turns[2]!.enemyMoves!.C = 'whirlwind';
      fx.turns[3]!.enemyMoves!.C = 'jab';
      expect(replay(fx)).toContain('turn 1 after enemy move: player.hp: expected 74, engine 71');
    });
  });

  it('knownDiffs: listed mismatches pass, unlisted ones and stale entries fail', () => {
    const fx = structuredClone(relicsAndPotion);
    fx.turns[0]!.enemyHpAfterEachPlay = [8, 0];
    const diff = 'turn 1 after play 1: enemy.hp: expected 8, engine 9';
    expect(unexplained(fx, replay(fx))).toEqual([diff]);
    fx.knownDiffs = [{ diff, reason: 'recorded 8; engine says 9 (finding for review)' }];
    expect(unexplained(fx, replay(fx))).toEqual([]);
    fx.turns[0]!.enemyHpAfterEachPlay = [9, 0];
    expect(unexplained(fx, replay(fx))).toEqual([`stale knownDiff (fixed?): ${diff}`]);
  });

  it('rejects unknown state fields and potions outside the turn', () => {
    const fx = structuredClone(relicsAndPotion);
    fx.turns[0]!.atStart = { player: { platting: 2 } };
    expect(() => consistency(fx)).toThrow(/unknown state fields/);
    const late = structuredClone(relicsAndPotion);
    late.turns[0]!.potions = [{ potion: 'strength_potion', beforePlay: 4 }];
    expect(() => consistency(late)).toThrow(/beforePlay 4/);
  });
});
