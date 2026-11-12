/** Card validation. */
import {
  CARD_TYPES,
  CARD_RARITIES,
  CARD_KEYWORDS,
  SIMULATED_KEYWORDS,
  SIMULATED_POWERS,
  SIMULATED_FILTER_FIELDS,
  SIMULATED_REPEAT_COUNTERS,
  SIMULATED_ENEMY_POWERS,
  SIMULATED_SCRIPTS,
  SIMULATED_CARD_SOURCES,
  UNSIMULATED_ADD_CARDS_FIELDS,
  SIMULATED_TRIGGERS,
  UNSIMULATED_EFFECTS,
  UNSIMULATED_CARD_FIELDS,
  CHARACTER_CODES,
} from './lists';
import { type Obj, isOneOf, isObj, has, oneOfText, Reporter, checkTwoCharCode } from './shared';
import { checkEffects, checkPer, checkCondition, checkTriggers } from './effects';

function checkKeywords(r: Reporter, list: unknown, path: string): void {
  if (!Array.isArray(list)) {
    r.add(path, 'must be an array');
    return;
  }
  list.forEach((k, i) => {
    if (!isOneOf(k, CARD_KEYWORDS)) {
      r.add(`${path}[${i}]`, oneOfText(CARD_KEYWORDS));
    }
  });
}

/** `xTimes` effects only on X-cost cards. */
function checkXTimes(r: Reporter, c: Obj, list: unknown, path: string): void {
  if (!Array.isArray(list) || c.xCost === true) return;
  list.forEach((e, i) => {
    if (isObj(e) && e.xTimes === true) r.add(`${path}[${i}].xTimes`, 'is only allowed on X-cost cards ("xCost": true)');
  });
}

/** True when some effect in the list scales with X. */
function usesX(list: unknown): boolean {
  return Array.isArray(list) && list.some((e) => isObj(e) && e.xTimes === true);
}

/** The first filter field the engine does not match on, as `<path>.<field>`, or undefined. */
function unsimulatedFilter(f: unknown, path: string): string | undefined {
  if (!isObj(f)) return undefined;
  const field = Object.keys(f).find((k) => !SIMULATED_FILTER_FIELDS.has(k));
  return field === undefined ? undefined : `${path}.${field}`;
}

/** The first unsimulated effect in a nested list (repeat, triggers), or undefined. */
function unsimulatedIn(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  for (const item of list) {
    if (!isObj(item) || typeof item.type !== 'string') continue;
    const bad = unsimulatedEffect(item, item.type);
    if (bad !== undefined) return bad;
  }
  return undefined;
}

/** #116: a random pool is simulated except Splash's `otherCharacters`. */
function unsimulatedPool(source: unknown): string | undefined {
  const pool = isObj(source) ? source.pool : undefined;
  return isObj(pool) && pool.character === 'otherCharacters' ? 'cardPool.otherCharacters' : undefined;
}

/**
 * The name to report when a simulated card's effect is not simulated, or undefined when it is.
 * `applyPower` is simulated only for SIMULATED_POWERS; `drawUntil.stopOn` and `exhaustCards.filter`
 * only with simulated filter fields; `exhaustCards` not from the exhaust pile; `repeat` only per
 * SIMULATED_REPEAT_COUNTERS (#108) with simulated inner effects; `script` only for SIMULATED_SCRIPTS.
 */
function unsimulatedEffect(e: Obj, name: string): string | undefined {
  if (name === 'applyPower') return SIMULATED_POWERS.has(String(e.power)) ? undefined : name;
  if (name === 'repeat') return SIMULATED_REPEAT_COUNTERS.has(String(e.per)) ? unsimulatedIn(e.effects) : name;
  if (name === 'applyEnemyPower') return SIMULATED_ENEMY_POWERS.has(String(e.power)) ? undefined : name;
  // #104: only "if Fatal" (the previous attack killed the enemy) is simulated, with simulated branches.
  if (name === 'conditional') {
    const fatal = isObj(e.if) && e.if.kind === 'fatal';
    return fatal ? (unsimulatedIn(e.then) ?? unsimulatedIn(e.else)) : name;
  }
  if (name === 'script') return SIMULATED_SCRIPTS.has(String(e.id)) ? undefined : name;
  if (name === 'addCards') {
    const kind = isObj(e.source) ? String(e.source.kind) : '';
    // #114: a copy of the card itself or of a picked card, without the #116 fields.
    if (SIMULATED_CARD_SOURCES.has(kind)) {
      if (UNSIMULATED_ADD_CARDS_FIELDS.some((f) => has(e, f))) return name;
      return unsimulatedFilter(isObj(e.source) ? e.source.filter : undefined, 'addCards.source.filter');
    }
    if (kind !== 'random' && kind !== 'card') return 'addCards.source.' + kind;
    return unsimulatedPool(e.source);
  }
  if (name === 'transformCards') {
    const kind = isObj(e.into) ? String(e.into.kind) : '';
    if (kind !== 'random' && kind !== 'card') return 'transformCards.into.' + kind;
    if (e.mode === 'choose') return 'transformCards.mode.choose';
    if (e.from === 'exhaust') return 'transformCards.from.exhaust';
    return unsimulatedPool(e.into) ?? unsimulatedFilter(e.filter, 'transformCards.filter');
  }
  if (name === 'playCards' || name === 'addReplay') {
    if (e.from === 'exhaust') return `${name}.from.exhaust`;
    return unsimulatedFilter(e.filter, `${name}.filter`);
  }
  if (UNSIMULATED_EFFECTS.has(name)) return name;
  // #4: Shrink is simulated on enemy moves only (it Shrinks the player).
  if (name === 'applyShrink') return name;
  if (name === 'drawUntil') return unsimulatedFilter(e.stopOn, 'drawUntil.stopOn');
  if (name === 'exhaustCards') {
    if (e.from === 'exhaust') return 'exhaustCards.from.exhaust';
    return unsimulatedFilter(e.filter, 'exhaustCards.filter');
  }
  return undefined;
}

/** #108: the first trigger the engine does not run (its `when`, or an unsimulated effect in it), or undefined. */
function unsimulatedTrigger(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  for (const t of list) {
    if (!isObj(t)) continue;
    if (!SIMULATED_TRIGGERS.has(String(t.when))) return 'triggers';
    const bad = unsimulatedIn(t.effects);
    if (bad !== undefined) return bad;
  }
  return undefined;
}

/** A card marked `simulated` may only use keywords, effects and fields the engine handles. */
function checkSimulatable(r: Reporter, c: Obj): void {
  const unsupported = (name: string) =>
    r.add('simulated', `is true but the card uses "${name}", which the engine does not simulate`);
  const lists: unknown[] = [c.keywords, c.effects];
  if (isObj(c.upgraded)) lists.push(c.upgraded.keywords, c.upgraded.effects);
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === 'string') {
        if (!SIMULATED_KEYWORDS.has(item)) unsupported(item);
        continue;
      }
      if (!isObj(item) || typeof item.type !== 'string') continue;
      const bad = unsimulatedEffect(item, item.type);
      if (bad !== undefined) unsupported(bad);
    }
  }
  for (const list of [c.triggers, isObj(c.upgraded) ? c.upgraded.triggers : undefined]) {
    const bad = unsimulatedTrigger(list);
    if (bad !== undefined) unsupported(bad);
  }
  for (const field of UNSIMULATED_CARD_FIELDS) {
    if (has(c, field) || (isObj(c.upgraded) && has(c.upgraded, field))) {
      unsupported(field);
    }
  }
  if (c.starCost !== null) r.add('simulated', 'is true but the card has a Star cost');
  if (c.xStarCost === true) r.add('simulated', 'is true but X-Star cards are not simulated');
  if (c.xCost === true) {
    const upEffects = isObj(c.upgraded) && Array.isArray(c.upgraded.effects) ? c.upgraded.effects : c.effects;
    if (!usesX(c.effects) || (c.upgraded !== null && !usesX(upEffects))) {
      r.add('simulated', 'is true but the X-cost card has no effect that scales with X ("xTimes")');
    }
  }
}

export function checkCard(r: Reporter, c: Obj): void {
  checkTwoCharCode(r, c);
  r.str(c, 'name');
  r.oneOf(c, 'type', CARD_TYPES);
  r.oneOf(c, 'character', [...CHARACTER_CODES, 'colorless', 'shared']);
  r.oneOf(c, 'rarity', CARD_RARITIES);
  if (c.cost !== null) r.int(c, 'cost', 0);
  r.bool(c, 'xCost');
  if (c.starCost !== null) r.int(c, 'starCost', 0);
  if (has(c, 'xStarCost')) r.bool(c, 'xStarCost');
  r.str(c, 'description');
  if (c.upgradedDescription !== null) r.str(c, 'upgradedDescription');
  if ((c.upgraded === null) !== (c.upgradedDescription === null)) {
    r.add('upgradedDescription', 'must be null exactly when "upgraded" is null');
  }
  r.bool(c, 'simulated');
  r.bool(c, 'multiplayerOnly');
  if (has(c, 'hidden')) r.bool(c, 'hidden');
  if (has(c, 'maxCopies')) r.int(c, 'maxCopies', 1);
  if (has(c, 'triggers')) checkTriggers(r, c.triggers, 'triggers');
  if (has(c, 'playableIf')) checkCondition(r, c.playableIf, 'playableIf');
  if (has(c, 'costLessPer')) checkPer(r, c.costLessPer, 'costLessPer');
  if (c.simulated === true) checkSimulatable(r, c);
  checkKeywords(r, c.keywords, 'keywords');
  const unplayable = Array.isArray(c.keywords) && c.keywords.includes('unplayable');
  if (unplayable !== (c.cost === null)) {
    r.add('cost', 'must be null exactly when keywords include "unplayable"');
  }
  checkEffects(r, c.effects, 'effects');
  checkXTimes(r, c, c.effects, 'effects');
  if (isObj(c.upgraded)) checkXTimes(r, c, c.upgraded.effects, 'upgraded.effects');
  if (c.upgraded !== null) {
    if (!isObj(c.upgraded)) {
      r.add('upgraded', 'must be an object or null');
    } else {
      const u = c.upgraded;
      if (has(u, 'cost')) r.int(u, 'cost', 0, 'upgraded.cost');
      if (has(u, 'starCost')) r.int(u, 'starCost', 0, 'upgraded.starCost');
      if (has(u, 'effects')) checkEffects(r, u.effects, 'upgraded.effects');
      if (has(u, 'keywords')) checkKeywords(r, u.keywords, 'upgraded.keywords');
      if (has(u, 'triggers')) checkTriggers(r, u.triggers, 'upgraded.triggers');
    }
  }
  r.str(c, 'lastUpdateVersion');
}
