/** Effect lists, including the #105 contract shapes (filters, conditions, sources, triggers). */
import {
  CARD_TYPES,
  CARD_RARITIES,
  CONTRACT_EFFECTS,
  PILES,
  DESTINATIONS,
  SELECT_MODES,
  COUNTERS,
  POWER_IDS,
  ENEMY_POWER_IDS,
  TRIGGER_WHENS,
  POOL_CHARACTERS,
  AMOUNT_EFFECTS,
} from './lists';
import { type Obj, isOneOf, isObj, has, Reporter, optInt, optBool, enumList } from './shared';

export function checkEffects(r: Reporter, list: unknown, path: string): void {
  if (!Array.isArray(list)) {
    r.add(path, 'must be an array');
    return;
  }
  list.forEach((e, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(e)) {
      r.add(p, 'must be an object');
      return;
    }
    if (e.type === 'attack') {
      r.int(e, 'damage', 0, `${p}.damage`);
      r.int(e, 'hits', 1, `${p}.hits`);
      optBool(r, e, 'allEnemies', p);
      optBool(r, e, 'xTimes', p);
      optBool(r, e, 'randomTarget', p);
      checkXBonus(r, e, p);
    } else if (isOneOf(e.type, AMOUNT_EFFECTS)) {
      r.int(e, 'amount', 0, `${p}.amount`);
      // #5: debuffs on enemies may hit every enemy.
      if (e.type === 'applyVulnerable' || e.type === 'applyWeak' || e.type === 'applyPoison') {
        optBool(r, e, 'allEnemies', p);
      }
    } else if (isOneOf(e.type, CONTRACT_EFFECTS)) {
      checkContractEffect(r, e, p);
    } else {
      r.oneOf(e, 'type', ['attack', ...AMOUNT_EFFECTS, ...CONTRACT_EFFECTS], `${p}.type`);
    }
  });
}

export function checkFilter(r: Reporter, v: unknown, p: string): void {
  if (!isObj(v)) {
    r.add(p, 'must be an object');
    return;
  }
  if (has(v, 'types')) enumList(r, v, 'types', CARD_TYPES, p);
  if (has(v, 'notTypes')) enumList(r, v, 'notTypes', CARD_TYPES, p);
  if (has(v, 'rarity')) enumList(r, v, 'rarity', CARD_RARITIES, p);
  if (has(v, 'nameIncludes')) r.str(v, 'nameIncludes', `${p}.nameIncludes`);
  if (has(v, 'cardId')) r.str(v, 'cardId', `${p}.cardId`);
  optBool(r, v, 'upgraded', p);
  optBool(r, v, 'noReplay', p);
}

function optFilter(r: Reporter, o: Obj, field: string, p: string): void {
  if (has(o, field)) checkFilter(r, o[field], `${p}.${field}`);
}

/** `min` is the lowest allowed amount; attackFrom allows negative (#260 Precise Cut: 2 less per card in hand). */
export function checkPer(r: Reporter, v: unknown, p: string, min = 0): void {
  if (!isObj(v)) {
    r.add(p, 'must be an object with "per" and "amount"');
    return;
  }
  r.oneOf(v, 'per', COUNTERS, `${p}.per`);
  if (min >= 0) r.int(v, 'amount', min, `${p}.amount`);
  else if (typeof v.amount !== 'number' || !Number.isInteger(v.amount) || v.amount < min)
    r.add(`${p}.amount`, `must be an integer >= ${min}`);
}

export function checkCondition(r: Reporter, v: unknown, p: string): void {
  if (!isObj(v)) {
    r.add(p, 'must be an object');
    return;
  }
  const kind = r.oneOf(
    v,
    'kind',
    ['lostHpThisTurn', 'enemyHas', 'counter', 'handHasNone', 'handAll', 'fatal', 'drewMatching'],
    `${p}.kind`,
  );
  if (kind === 'enemyHas') r.oneOf(v, 'status', ['vulnerable', 'weak', 'frail', 'poison'], `${p}.status`);
  if (kind === 'counter') {
    r.oneOf(v, 'counter', COUNTERS, `${p}.counter`);
    optInt(r, v, 'min', 0, p);
    optInt(r, v, 'max', 0, p);
    if (!has(v, 'min') && !has(v, 'max')) r.add(p, 'needs "min" or "max"');
  }
  if (kind === 'handHasNone' || kind === 'handAll' || kind === 'drewMatching') checkFilter(r, v.filter, `${p}.filter`);
}

function checkSource(r: Reporter, v: unknown, p: string): void {
  if (!isObj(v)) {
    r.add(p, 'must be an object');
    return;
  }
  const kind = r.oneOf(v, 'kind', ['self', 'card', 'copyOf', 'random'], `${p}.kind`);
  if (kind === 'card') r.str(v, 'cardId', `${p}.cardId`);
  if (kind === 'copyOf') {
    r.oneOf(v, 'from', PILES, `${p}.from`);
    r.oneOf(v, 'mode', SELECT_MODES, `${p}.mode`);
    optFilter(r, v, 'filter', p);
  }
  if (kind === 'random') {
    const pool = v.pool;
    const pp = `${p}.pool`;
    if (!isObj(pool)) {
      r.add(pp, 'must be an object');
      return;
    }
    if (has(pool, 'character')) r.oneOf(pool, 'character', POOL_CHARACTERS, `${pp}.character`);
    if (has(pool, 'types')) enumList(r, pool, 'types', CARD_TYPES, pp);
    if (has(pool, 'rarity')) enumList(r, pool, 'rarity', CARD_RARITIES, pp);
    optInt(r, pool, 'cost', 0, pp);
  }
}

/** Optional `xBonus`, only alongside `"xTimes": true`. */
function checkXBonus(r: Reporter, e: Obj, p: string): void {
  if (!has(e, 'xBonus')) return;
  r.int(e, 'xBonus', 0, `${p}.xBonus`);
  if (e.xTimes !== true) r.add(`${p}.xBonus`, 'is only allowed with "xTimes": true');
}

/** `count` is required unless mode is "all". */
function checkCountMode(r: Reporter, e: Obj, p: string): void {
  const mode = r.oneOf(e, 'mode', SELECT_MODES, `${p}.mode`);
  if (has(e, 'count')) r.int(e, 'count', 1, `${p}.count`);
  else if (mode !== undefined && mode !== 'all') r.add(`${p}.count`, 'is required unless "mode" is "all"');
}

type ContractEffect = (typeof CONTRACT_EFFECTS)[number];
type EffectCheck = (r: Reporter, e: Obj, p: string) => void;

const amountOnly: EffectCheck = (r, e, p) => {
  r.int(e, 'amount', 0, `${p}.amount`);
};

/** Field checks for each #105 contract effect. Keyed by every contract effect, so a new one must add its check. */
const CONTRACT_CHECKS: Record<ContractEffect, EffectCheck> = {
  loseHp: amountOnly,
  draw: amountOnly,
  dealDamage: (r, e, p) => {
    amountOnly(r, e, p);
    optBool(r, e, 'allEnemies', p);
  },
  enemyLoseHp: amountOnly,
  enemyGainStrength: amountOnly,
  heal: amountOnly,
  gainMaxHp: amountOnly,
  loseMaxHp: amountOnly,
  gainGold: amountOnly,
  gainPotion: () => {},
  gainCardReward: () => {},
  loseEnergy: amountOnly,
  spawnEnemies: (r, e, p) => {
    r.str(e, 'enemyId', `${p}.enemyId`);
    r.int(e, 'count', 1, `${p}.count`);
    optBool(r, e, 'stunned', p);
  },
  drawUntil: (r, e, p) => {
    optBool(r, e, 'handFull', p);
    optFilter(r, e, 'stopOn', p);
    if (has(e, 'handSize')) r.int(e, 'handSize', 1, `${p}.handSize`);
    if (e.handFull !== true && !has(e, 'stopOn') && !has(e, 'handSize'))
      r.add(p, 'needs "handFull": true, "stopOn" or "handSize"');
  },
  exhaustCards: (r, e, p) => {
    if (has(e, 'from')) r.oneOf(e, 'from', PILES, `${p}.from`);
    checkCountMode(r, e, p);
    optBool(r, e, 'upTo', p);
    optFilter(r, e, 'filter', p);
  },
  applyPower: (r, e, p) => {
    r.oneOf(e, 'power', POWER_IDS, `${p}.power`);
    r.int(e, 'amount', 0, `${p}.amount`);
  },
  applyEnemyPower: (r, e, p) => {
    r.oneOf(e, 'power', ENEMY_POWER_IDS, `${p}.power`);
    r.int(e, 'amount', 0, `${p}.amount`);
  },
  schedule: (r, e, p) => {
    r.int(e, 'delay', 1, `${p}.delay`);
    if (has(e, 'at')) r.oneOf(e, 'at', ['turnStart', 'turnEnd'], `${p}.at`);
    checkEffects(r, e.effects, `${p}.effects`);
  },
  setCost: (r, e, p) => {
    enumList(r, e, 'piles', PILES, p, true);
    r.int(e, 'cost', 0, `${p}.cost`);
    r.oneOf(e, 'duration', ['turn', 'combat'], `${p}.duration`);
    optBool(r, e, 'onlyIfHigher', p);
    optFilter(r, e, 'filter', p);
  },
  conditional: (r, e, p) => {
    checkCondition(r, e.if, `${p}.if`);
    checkEffects(r, e.then, `${p}.then`);
    if (has(e, 'else')) checkEffects(r, e.else, `${p}.else`);
  },
  repeat: (r, e, p) => {
    r.oneOf(e, 'per', COUNTERS, `${p}.per`);
    optInt(r, e, 'times', 1, p);
    checkEffects(r, e.effects, `${p}.effects`);
  },
  attackFrom: (r, e, p) => {
    r.int(e, 'damage', 0, `${p}.damage`);
    r.int(e, 'hits', 0, `${p}.hits`);
    optBool(r, e, 'allEnemies', p);
    if (has(e, 'bonusPer')) checkPer(r, e.bonusPer, `${p}.bonusPer`, -100);
    if (has(e, 'extraHitsPer')) checkPer(r, e.extraHitsPer, `${p}.extraHitsPer`);
    if (!has(e, 'bonusPer') && !has(e, 'extraHitsPer'))
      r.add(p, 'needs "bonusPer" or "extraHitsPer" (use "attack" otherwise)');
  },
  gainBlockFrom: (r, e, p) => {
    r.int(e, 'amount', 0, `${p}.amount`);
    checkPer(r, e.bonusPer, `${p}.bonusPer`);
  },
  growDamage: (r, e, p) => {
    r.int(e, 'amount', 0, `${p}.amount`);
    r.oneOf(e, 'scope', ['self', 'sameCard'], `${p}.scope`);
  },
  moveCards: (r, e, p) => {
    r.oneOf(e, 'from', PILES, `${p}.from`);
    r.oneOf(e, 'to', DESTINATIONS, `${p}.to`);
    checkCountMode(r, e, p);
    optBool(r, e, 'upTo', p);
    optFilter(r, e, 'filter', p);
    optInt(r, e, 'options', 1, p);
    optBool(r, e, 'upgrade', p);
  },
  moveSelf: (r, e, p) => {
    r.oneOf(e, 'to', DESTINATIONS, `${p}.to`);
    r.oneOf(e, 'when', ['now', 'nextTurnStart'], `${p}.when`);
  },
  upgradeCards: (r, e, p) => {
    enumList(r, e, 'piles', PILES, p, true);
    checkCountMode(r, e, p);
  },
  playCards: (r, e, p) => {
    r.oneOf(e, 'from', PILES, `${p}.from`);
    r.oneOf(e, 'mode', ['top', 'random'], `${p}.mode`);
    r.int(e, 'count', 0, `${p}.count`);
    optBool(r, e, 'xTimes', p);
    checkXBonus(r, e, p);
    optFilter(r, e, 'filter', p);
    optBool(r, e, 'exhaust', p);
    optBool(r, e, 'all', p);
    optBool(r, e, 'upgradeFirst', p);
  },
  addReplay: (r, e, p) => {
    r.int(e, 'amount', 1, `${p}.amount`);
    r.oneOf(e, 'from', PILES, `${p}.from`);
    r.oneOf(e, 'mode', SELECT_MODES, `${p}.mode`);
    optFilter(r, e, 'filter', p);
  },
  addCards: (r, e, p) => {
    checkSource(r, e.source, `${p}.source`);
    r.int(e, 'count', 1, `${p}.count`);
    r.oneOf(e, 'to', DESTINATIONS, `${p}.to`);
    optInt(r, e, 'options', 1, p);
    optBool(r, e, 'upgraded', p);
    optBool(r, e, 'freeThisTurn', p);
    optInt(r, e, 'costThisCombat', 0, p);
  },
  transformCards: (r, e, p) => {
    r.oneOf(e, 'from', PILES, `${p}.from`);
    checkCountMode(r, e, p);
    optFilter(r, e, 'filter', p);
    checkSource(r, e.into, `${p}.into`);
  },
  script: (r, e, p) => {
    r.str(e, 'id', `${p}.id`);
    if (has(e, 'values')) {
      const vals = r.arr(e, 'values', `${p}.values`);
      vals?.forEach((v, i) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) r.add(`${p}.values[${i}]`, 'must be a number');
      });
    }
  },
};

function checkContractEffect(r: Reporter, e: Obj, p: string): void {
  CONTRACT_CHECKS[e.type as ContractEffect](r, e, p);
}

export function checkTriggers(r: Reporter, v: unknown, p: string): void {
  if (!Array.isArray(v)) {
    r.add(p, 'must be an array');
    return;
  }
  v.forEach((t, i) => {
    const tp = `${p}[${i}]`;
    if (!isObj(t)) {
      r.add(tp, 'must be an object');
      return;
    }
    r.oneOf(t, 'when', TRIGGER_WHENS, `${tp}.when`);
    checkEffects(r, t.effects, `${tp}.effects`);
  });
}
