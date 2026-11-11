import type { Effect, EnemyDef, EnemyMove, MovePattern } from './types';

function cloneEffects(effects: readonly Effect[]): Effect[] {
  return effects.map((e) => ({ ...e }));
}

function clonePattern(p: MovePattern): MovePattern {
  const opener = p.opener ? { opener: [...p.opener] } : {};
  return p.type === 'cycle' ? { ...p, order: [...p.order], ...opener } : { ...p, moves: [...p.moves], ...opener };
}

/** #4: the moves a pattern repeats or picks from (cycle `order`, random `moves`), without the opener. */
export function patternPool(p: MovePattern): readonly string[] {
  return p.type === 'cycle' ? p.order : p.moves;
}

/** #4: every move id a pattern names: opener first, then the pool. */
export function patternMoveIds(p: MovePattern): string[] {
  return [...(p.opener ?? []), ...patternPool(p)];
}

/**
 * Apply Ascension overrides cumulatively: every override keyed at or below
 * `ascension`, in ascending numeric order. `hp` and `pattern` replace; a move
 * override replaces that move's whole effect list and keeps its name.
 * Returns a fresh EnemyDef; the input is not mutated.
 */
export function resolveEnemy(def: EnemyDef, ascension: number): EnemyDef {
  const moves: Record<string, EnemyMove> = {};
  for (const [id, move] of Object.entries(def.moves)) {
    moves[id] = { name: move.name, effects: cloneEffects(move.effects) };
  }
  let hp = { ...def.hp };
  let pattern = clonePattern(def.pattern);

  const levels = Object.keys(def.ascension)
    .map((k) => ({ key: k, level: Number(k) }))
    .filter(({ level }) => Number.isFinite(level) && level <= ascension)
    .sort((a, b) => a.level - b.level);

  for (const { key } of levels) {
    const o = def.ascension[key];
    if (!o) continue;
    if (o.hp) hp = { ...o.hp };
    if (o.pattern) pattern = clonePattern(o.pattern);
    if (o.moves) {
      for (const [id, mo] of Object.entries(o.moves)) {
        const base = moves[id];
        if (!base) throw new Error(`Enemy ${def.id}: A${key} overrides unknown move "${id}"`);
        moves[id] = { name: base.name, effects: cloneEffects(mo.effects) };
      }
    }
  }

  return { ...def, hp, moves, pattern, ascension: {} };
}
