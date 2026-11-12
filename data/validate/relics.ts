/** #205 Relic validation (data/relics/). */
import { RELIC_SCRIPTS } from '../../engine/relics';
import { CHARACTER_CODES } from './lists';
import { type Obj, isObj, has, Reporter, checkTwoCharCode, optInt, optBool } from './shared';
import { checkEffects, checkFilter } from './effects';
import { unsimulatedIn } from './cards';

export const RELIC_RARITIES = ['starter', 'common', 'uncommon', 'rare', 'shop', 'boss', 'ancient', 'event'] as const;
export const RELIC_WHENS = ['combatStart', 'turnStart', 'turnEnd', 'combatEnd', 'cardPlayed'] as const;
export const RELIC_MODIFIER_KINDS = [
  'energyPerTurn',
  'drawPerTurn',
  'cardDamageBonus',
  'hpLossReduce',
  'hpLossCapPerTurn',
  'minUnblockedAttack',
  'conserveEnergy',
  'keepHand',
  'cardsPerTurnLimit',
  'xBonus',
  'dexterityWithoutPotions',
  'noPotions',
  'script',
] as const;

/** Modifier kinds whose rule needs an `amount`. */
const NEEDS_AMOUNT = new Set<string>([
  'energyPerTurn',
  'drawPerTurn',
  'cardDamageBonus',
  'hpLossReduce',
  'hpLossCapPerTurn',
  'minUnblockedAttack',
  'cardsPerTurnLimit',
  'xBonus',
  'dexterityWithoutPotions',
]);

function checkHook(r: Reporter, h: unknown, p: string, hasChoice: boolean, simulated: boolean): void {
  if (!isObj(h)) {
    r.add(p, 'must be an object');
    return;
  }
  const when = r.oneOf(h, 'when', RELIC_WHENS, `${p}.when`);
  optInt(r, h, 'turn', 1, p);
  optInt(r, h, 'everyTurns', 1, p);
  optInt(r, h, 'everyCards', 1, p);
  optBool(r, h, 'amountFromChoice', p);
  if (has(h, 'filter')) checkFilter(r, h.filter, `${p}.filter`);
  if ((has(h, 'everyCards') || has(h, 'filter')) && when !== undefined && when !== 'cardPlayed') {
    r.add(p, '"everyCards" and "filter" are only allowed on "cardPlayed" hooks');
  }
  if (
    (has(h, 'turn') || has(h, 'everyTurns')) &&
    (when === 'combatStart' || when === 'combatEnd' || when === 'cardPlayed')
  ) {
    r.add(p, '"turn" and "everyTurns" are only allowed on "turnStart" and "turnEnd" hooks');
  }
  if (h.amountFromChoice === true && !hasChoice) r.add(`${p}.amountFromChoice`, 'needs the relic to have a "choice"');
  checkEffects(r, h.effects, `${p}.effects`);
  if (simulated) {
    const bad = unsimulatedIn(h.effects);
    if (bad !== undefined) r.add(`${p}.effects`, `uses "${bad}", which is not simulated yet (set "simulated": false)`);
  }
}

function checkModifier(r: Reporter, m: unknown, p: string): void {
  if (!isObj(m)) {
    r.add(p, 'must be an object');
    return;
  }
  const kind = r.oneOf(m, 'kind', RELIC_MODIFIER_KINDS, `${p}.kind`);
  if (kind !== undefined && NEEDS_AMOUNT.has(kind)) r.int(m, 'amount', 0, `${p}.amount`);
  else optInt(r, m, 'amount', 0, p);
  if (has(m, 'filter')) checkFilter(r, m.filter, `${p}.filter`);
  if (kind === 'script') r.oneOf(m, 'id', RELIC_SCRIPTS, `${p}.id`);
  else if (has(m, 'id')) r.add(`${p}.id`, 'is only allowed with kind "script"');
}

function checkChoice(r: Reporter, c: unknown): void {
  if (!isObj(c)) {
    r.add('choice', 'must be an object');
    return;
  }
  r.str(c, 'label', 'choice.label');
  const values = r.arr(c, 'values', 'choice.values');
  if (values && values.length === 0) r.add('choice.values', 'must not be empty');
  values?.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) r.add(`choice.values[${i}]`, 'must be an integer >= 0');
  });
  const def = r.int(c, 'default', 0, 'choice.default');
  if (def !== undefined && values && !values.includes(def)) r.add('choice.default', 'must be one of "values"');
}

export function checkRelic(r: Reporter, o: Obj): void {
  checkTwoCharCode(r, o);
  r.str(o, 'name');
  r.oneOf(o, 'rarity', RELIC_RARITIES);
  r.oneOf(o, 'character', [...CHARACTER_CODES, 'any']);
  r.str(o, 'description');
  r.bool(o, 'simulated');
  r.str(o, 'lastUpdateVersion');
  if (has(o, 'choice')) checkChoice(r, o.choice);
  const simulated = o.simulated === true;
  const hooks = r.arr(o, 'hooks');
  hooks?.forEach((h, i) => checkHook(r, h, `hooks[${i}]`, has(o, 'choice'), simulated));
  // #205: a choice is either an amount (Girya) or the starting count of a counting hook (Happy Flower).
  const usesChoice = (h: unknown) =>
    isObj(h) && (h.amountFromChoice === true || has(h, 'everyTurns') || has(h, 'everyCards'));
  if (has(o, 'choice') && hooks && !hooks.some(usesChoice)) {
    r.add('choice', 'needs a hook with "amountFromChoice", "everyTurns" or "everyCards"');
  }
  if (has(o, 'modifiers')) r.arr(o, 'modifiers')?.forEach((m, i) => checkModifier(r, m, `modifiers[${i}]`));
}
