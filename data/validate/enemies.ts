/** Enemy validation: moves, patterns and Ascension overrides. */
import {
  CONTRACT_EFFECTS,
  ENEMY_POWER_IDS,
  ZONES,
  DIFFICULTIES,
  PATTERN_STARTS,
  PATTERN_TYPES,
  NUMERIC_KEY,
  SIMULATED_POWERS,
} from './lists';
import { type Obj, isOneOf, isObj, Reporter, checkTwoCharCode } from './shared';
import { checkEffects } from './effects';

/**
 * Effects an enemy move may not use: v1 simulates Poison on enemies only, enemies have no
 * energy, #105 contract effects are card-only, and "X times" needs an X-cost card.
 */
function checkEnemyOnlyEffects(r: Reporter, list: unknown, path: string): void {
  if (!Array.isArray(list)) return;
  list.forEach((e, i) => {
    if (!isObj(e)) return;
    if (e.type === 'applyPoison')
      r.add(`${path}[${i}].type`, 'is "applyPoison", but Poison on the player is not simulated');
    if (e.type === 'gainEnergy') r.add(`${path}[${i}].type`, 'is "gainEnergy", but enemies have no energy');
    // #203: an enemy move may add a named card to a pile (Vantom's Dismember adds Wounds).
    const namedCard = e.type === 'addCards' && isObj(e.source) && e.source.kind === 'card';
    // #303: an enemy move may buff its own Strength (Bygone Effigy's Wake).
    // #322: an enemy move or onDeath may summon enemies.
    // #270: an enemy move may put a simulated power on the player (Curse of Knowledge's debuffs).
    const playerPower = e.type === 'applyPower' && SIMULATED_POWERS.has(String(e.power));
    if (
      !namedCard &&
      !playerPower &&
      e.type !== 'enemyGainStrength' &&
      e.type !== 'spawnEnemies' &&
      isOneOf(e.type, CONTRACT_EFFECTS)
    ) {
      r.add(`${path}[${i}].type`, `is "${e.type}", which is not simulated on enemy moves`);
    }
    if (e.type === 'applyShrink' && typeof e.amount === 'number' && e.amount > 100) {
      r.add(`${path}[${i}].amount`, 'is a percent and must be at most 100');
    }
    if (e.xTimes === true) r.add(`${path}[${i}].xTimes`, 'is only allowed on X-cost cards');
  });
}

function checkMoveEffects(r: Reporter, list: unknown, path: string): void {
  checkEffects(r, list, path);
  checkEnemyOnlyEffects(r, list, path);
}

/** #203: powers an enemy starts combat with: known EnemyPowerId keys, whole amounts of at least 1. */
function checkStartPowers(r: Reporter, v: unknown, path: string): void {
  if (!isObj(v)) {
    r.add(path, 'must be an object');
    return;
  }
  for (const [id, amount] of Object.entries(v)) {
    if (!isOneOf(id, ENEMY_POWER_IDS))
      r.add(`${path}.${id}`, `is not a known enemy power (${ENEMY_POWER_IDS.join(', ')})`);
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
      r.add(`${path}.${id}`, 'must be a whole number of at least 1');
    }
  }
}

function checkRange(r: Reporter, v: unknown, path: string): void {
  if (!isObj(v)) {
    r.add(path, 'must be an object with min and max');
    return;
  }
  const min = r.int(v, 'min', 1, `${path}.min`);
  const max = r.int(v, 'max', 1, `${path}.max`);
  if (min !== undefined && max !== undefined && min > max) {
    r.add(path, `has min (${min}) greater than max (${max})`);
  }
}

/** A list of move ids that must all exist; `allowEmpty` for the opener. Returns the list. */
function checkMoveList(
  r: Reporter,
  list: unknown[] | undefined,
  path: string,
  moveIds: Set<string>,
  allowEmpty = false,
): unknown[] | undefined {
  if (!list) return undefined;
  if (list.length === 0 && !allowEmpty) r.add(path, 'must not be empty');
  list.forEach((id, i) => {
    if (typeof id !== 'string') {
      r.add(`${path}[${i}]`, 'must be a string');
    } else if (!moveIds.has(id)) {
      r.add(`${path}[${i}]`, `references unknown move id "${id}"`);
    }
  });
  return list;
}

/** #287 alternate: `fixed`, weighted `random` picks, optional `startWith` and `openerBySlot`. */
function checkAlternate(r: Reporter, v: Obj, path: string, moveIds: Set<string>): void {
  const known = (id: unknown, p: string) => {
    if (typeof id !== 'string') r.add(p, 'must be a string');
    else if (!moveIds.has(id)) r.add(p, `references unknown move id "${id}"`);
  };
  known(v.fixed, `${path}.fixed`);
  const random = r.arr(v, 'random', `${path}.random`);
  if (random) {
    if (random.length === 0) r.add(`${path}.random`, 'must not be empty');
    random.forEach((entry, i) => {
      const p = `${path}.random[${i}]`;
      if (!isObj(entry)) return r.add(p, 'must be an object');
      known(entry.move, `${p}.move`);
      if (!Number.isInteger(entry.weight) || (entry.weight as number) < 1)
        r.add(`${p}.weight`, 'must be an integer of at least 1');
    });
  }
  if (v.startWith !== undefined && v.startWith !== 'fixed' && v.startWith !== 'random')
    r.add(`${path}.startWith`, 'must be "fixed" or "random"');
  if (v.openerBySlot !== undefined) {
    if (!isObj(v.openerBySlot)) r.add(`${path}.openerBySlot`, 'must be an object');
    else
      for (const [slot, id] of Object.entries(v.openerBySlot)) {
        if (slot !== 'outer' && slot !== 'middle') r.add(`${path}.openerBySlot.${slot}`, 'must be "outer" or "middle"');
        else known(id, `${path}.openerBySlot.${slot}`);
      }
  }
}

/** Cycle: `order` + `start`. #4 random: `moves` + `noRepeat`. Both: optional `opener`. */
function checkPattern(r: Reporter, v: unknown, path: string, moveIds: Set<string>): void {
  if (!isObj(v)) {
    r.add(path, 'must be an object');
    return;
  }
  r.oneOf(v, 'type', PATTERN_TYPES, `${path}.type`);
  if (v.type === 'alternate') {
    checkAlternate(r, v, path, moveIds);
    return;
  }
  if (v.opener !== undefined) checkMoveList(r, r.arr(v, 'opener', `${path}.opener`), `${path}.opener`, moveIds, true);
  if (v.type === 'random') {
    const moves = checkMoveList(r, r.arr(v, 'moves', `${path}.moves`), `${path}.moves`, moveIds);
    // #322: weights (positive whole numbers by move id) and noRepeatMoves (ids from the pool).
    if (v.weights !== undefined) {
      const w = r.obj(v, 'weights');
      for (const [id, n] of Object.entries(w ?? {})) {
        if (!moveIds.has(id)) r.add(`${path}.weights.${id}`, 'is not a move of this enemy');
        else if (moves && !moves.includes(id)) r.add(`${path}.weights.${id}`, 'is not in the pattern moves');
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
          r.add(`${path}.weights.${id}`, 'must be a whole number of at least 1');
      }
    }
    if (v.noRepeatMoves !== undefined) {
      const list = checkMoveList(
        r,
        r.arr(v, 'noRepeatMoves', `${path}.noRepeatMoves`),
        `${path}.noRepeatMoves`,
        moveIds,
      );
      if (list && moves)
        for (const id of list)
          if (!moves.includes(id)) r.add(`${path}.noRepeatMoves`, `"${id}" is not in the pattern moves`);
      if (v.noRepeat !== true) r.add(`${path}.noRepeatMoves`, 'needs "noRepeat": true');
    }
    if (typeof v.noRepeat !== 'boolean') r.add(`${path}.noRepeat`, 'must be true or false');
    else if (v.noRepeat && moves && moves.length === 1) r.add(`${path}.moves`, 'needs at least 2 moves with noRepeat');
    return;
  }
  r.oneOf(v, 'start', PATTERN_STARTS, `${path}.start`);
  const order = checkMoveList(r, r.arr(v, 'order', `${path}.order`), `${path}.order`, moveIds);
  // #322: startBySlot names two moves of the cycle.
  if (v.startBySlot !== undefined) {
    const sbs = r.obj(v, 'startBySlot');
    for (const k of ['odd', 'even']) {
      const id = sbs?.[k];
      if (typeof id !== 'string' || !moveIds.has(id))
        r.add(`${path}.startBySlot.${k}`, 'must name a move of this enemy');
      else if (order && !order.includes(id)) r.add(`${path}.startBySlot.${k}`, 'is not in the pattern order');
    }
  }
}

export function checkEnemy(r: Reporter, e: Obj): void {
  checkTwoCharCode(r, e);
  r.str(e, 'name');
  r.int(e, 'act', 1);
  r.oneOf(e, 'zone', ZONES);
  r.oneOf(e, 'difficulty', DIFFICULTIES);
  checkRange(r, e.hp, 'hp');

  const moveIds = new Set<string>();
  const moves = r.obj(e, 'moves');
  if (moves) {
    if (Object.keys(moves).length === 0) r.add('moves', 'must contain at least one move');
    for (const [id, m] of Object.entries(moves)) {
      moveIds.add(id);
      const p = `moves.${id}`;
      if (!isObj(m)) {
        r.add(p, 'must be an object');
        continue;
      }
      r.str(m, 'name', `${p}.name`);
      if (m.oncePerFight !== undefined && typeof m.oncePerFight !== 'boolean')
        r.add(`${p}.oncePerFight`, 'must be true or false');
      checkMoveEffects(r, m.effects, `${p}.effects`);
    }
  }
  checkPattern(r, e.pattern, 'pattern', moveIds);
  if (isObj(e.pattern) && isObj(moves)) {
    const once = (id: unknown) => isObj(moves[id as string]) && (moves[id as string] as Obj).oncePerFight === true;
    const pool = Array.isArray(e.pattern.moves)
      ? e.pattern.moves
      : Array.isArray(e.pattern.order)
        ? e.pattern.order
        : [];
    if (e.pattern.type === 'cycle' && pool.some(once))
      r.add('pattern.order', 'oncePerFight moves are only honoured in random patterns');
    if (e.pattern.type === 'random' && pool.length > 0 && pool.every(once))
      r.add('pattern.moves', 'needs at least one move that is not oncePerFight');
  }
  if (e.startPowers !== undefined) checkStartPowers(r, e.startPowers, 'startPowers');
  // #322: death effects are spawnEnemies only.
  if (e.onDeath !== undefined) {
    checkMoveEffects(r, e.onDeath, 'onDeath');
    if (Array.isArray(e.onDeath))
      e.onDeath.forEach((x, i) => {
        if (isObj(x) && x.type !== 'spawnEnemies') r.add(`onDeath[${i}].type`, 'must be "spawnEnemies"');
      });
  }

  const asc = r.obj(e, 'ascension');
  if (asc) {
    for (const [level, o] of Object.entries(asc)) {
      const p = `ascension.${level}`;
      if (!NUMERIC_KEY.test(level)) r.add(p, 'key must be a numeric string, e.g. "8"');
      if (!isObj(o)) {
        r.add(p, 'must be an object');
        continue;
      }
      if (o.hp !== undefined) checkRange(r, o.hp, `${p}.hp`);
      if (o.moves !== undefined) {
        if (!isObj(o.moves)) {
          r.add(`${p}.moves`, 'must be an object');
        } else {
          for (const [id, m] of Object.entries(o.moves)) {
            const mp = `${p}.moves.${id}`;
            if (!moveIds.has(id)) r.add(mp, `overrides unknown move id "${id}"`);
            if (!isObj(m)) r.add(mp, 'must be an object');
            else {
              checkMoveEffects(r, m.effects, `${mp}.effects`);
            }
          }
        }
      }
      if (o.startPowers !== undefined) checkStartPowers(r, o.startPowers, `${p}.startPowers`);
      if (o.pattern !== undefined) checkPattern(r, o.pattern, `${p}.pattern`, moveIds);
    }
  }
  r.str(e, 'source');
  r.str(e, 'lastUpdateVersion');
}
