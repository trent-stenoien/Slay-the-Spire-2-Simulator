import type { CharacterDef, Effect, EnemyDef, EnemyMove, MovePattern } from './types';

function cloneEffects(effects: readonly Effect[]): Effect[] {
  return effects.map((e) => ({ ...e }));
}

function clonePattern(p: MovePattern): MovePattern {
  if (p.type === 'alternate')
    return { ...p, random: p.random.map((r) => ({ ...r })), openerBySlot: p.openerBySlot && { ...p.openerBySlot } };
  const opener = p.opener ? { opener: [...p.opener] } : {};
  return p.type === 'cycle' ? { ...p, order: [...p.order], ...opener } : { ...p, moves: [...p.moves], ...opener };
}

/** #4: the moves a pattern repeats or picks from (cycle `order`, random `moves`), without the opener. */
export function patternPool(p: MovePattern): readonly string[] {
  if (p.type === 'alternate') return [p.fixed, ...p.random.map((r) => r.move)];
  return p.type === 'cycle' ? p.order : p.moves;
}

/** #4: every move id a pattern names: opener first, then the pool. */
export function patternMoveIds(p: MovePattern): string[] {
  const opener = p.type === 'alternate' ? Object.values(p.openerBySlot ?? {}) : (p.opener ?? []);
  return [...opener, ...patternPool(p)];
}

/**
 * #286: the HP a combat starts at when `startHp` is not given. Applies the character's Ascension
 * overrides cumulatively (levels at or below `ascension`, ascending); Max HP is not changed.
 */
export function defaultStartHp(character: CharacterDef, ascension: number): number {
  let hp = character.maxHp;
  const levels = Object.keys(character.ascension ?? {})
    .map(Number)
    .filter((l) => l <= ascension)
    .sort((a, b) => a - b);
  for (const l of levels) {
    const o = character.ascension![String(l)]!.startHp;
    if (o !== undefined) hp = o;
  }
  return hp;
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
    if (move.oncePerFight) moves[id].oncePerFight = true;
  }
  let hp = { ...def.hp };
  let pattern = clonePattern(def.pattern);
  let startPowers = def.startPowers ? { ...def.startPowers } : undefined;

  const levels = Object.keys(def.ascension)
    .map((k) => ({ key: k, level: Number(k) }))
    .filter(({ level }) => Number.isFinite(level) && level <= ascension)
    .sort((a, b) => a.level - b.level);

  for (const { key } of levels) {
    const o = def.ascension[key];
    if (!o) continue;
    if (o.hp) hp = { ...o.hp };
    if (o.pattern) pattern = clonePattern(o.pattern);
    if (o.startPowers) startPowers = { ...o.startPowers };
    if (o.moves) {
      for (const [id, mo] of Object.entries(o.moves)) {
        const base = moves[id];
        if (!base) throw new Error(`Enemy ${def.id}: A${key} overrides unknown move "${id}"`);
        moves[id] = { name: base.name, effects: cloneEffects(mo.effects) };
        if (base.oncePerFight) moves[id].oncePerFight = true;
      }
    }
  }

  const resolved: EnemyDef = { ...def, hp, moves, pattern, ascension: {} };
  if (startPowers) resolved.startPowers = startPowers;
  return resolved;
}
