/** Potion validation (#204): identity fields, effects, and the effects the engine can resolve. */
import { CHARACTER_CODES } from './lists';
import { checkEffects } from './effects';
import { type Obj, isObj, Reporter, checkTwoCharCode } from './shared';

export const POTION_RARITIES = ['common', 'uncommon', 'rare', 'event'] as const;

/** Effects a simulated potion may use (resolved as if a card played them; no X, no card context). */
export const SIMULATED_POTION_EFFECTS = new Set(['gainStrength', 'dealDamage', 'applyPoison']);

export function checkPotion(r: Reporter, p: Obj): void {
  checkTwoCharCode(r, p);
  r.str(p, 'name');
  r.oneOf(p, 'rarity', POTION_RARITIES);
  r.oneOf(p, 'character', ['any', ...CHARACTER_CODES]);
  r.str(p, 'description');
  r.bool(p, 'simulated');
  r.str(p, 'source');
  r.str(p, 'lastUpdateVersion');
  checkEffects(r, p.effects, 'effects');
  if (p.simulated === true && Array.isArray(p.effects)) {
    p.effects.forEach((e, i) => {
      if (isObj(e) && !SIMULATED_POTION_EFFECTS.has(String(e.type))) {
        r.add(`effects[${i}].type`, `is "${String(e.type)}", which a simulated potion cannot use yet`);
      }
    });
  }
}
