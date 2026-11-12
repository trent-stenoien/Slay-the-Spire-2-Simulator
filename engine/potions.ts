/**
 * #204 potion-use rules shared by every built-in strategy (one helper: `pickPotion`).
 *
 * - Strength Potion: used at the first chance, which is turn 1 before any card.
 * - Fire Potion (20 damage through Block, not affected by Strength): used when it does the most.
 *   Slippery (enemy power, #213; missing counts as 0) holds the damage down, so it waits until
 *   Slippery is gone. Then it is used when it kills, or when the enemy has no Block (full 20 to
 *   HP). Fallback so the player does not die holding it: used at once when the enemy's coming
 *   attack could kill the player (intent total ≥ HP + Block), whatever Slippery or Block say.
 */
import type { DeepReadonly, PotionUse, StrategyView } from './types';

export const STRENGTH_POTION = 'strength_potion';
export const FIRE_POTION = 'fire_potion';
/** Damage of the Fire Potion (data/potions/fire_potion.json). */
export const FIRE_POTION_DAMAGE = 20;

/** Slot of the first held potion with this id, or -1. */
function slotOf(view: DeepReadonly<StrategyView>, id: string): number {
  return (view.state.player.potions ?? []).findIndex((p) => p === id);
}

export function pickPotion(view: StrategyView): PotionUse | null {
  const { player, enemy } = view.state;
  const strength = slotOf(view, STRENGTH_POTION);
  if (strength >= 0) return { slot: strength };
  const fire = slotOf(view, FIRE_POTION);
  if (fire < 0) return null;
  const slippery = enemy.powers?.slippery ?? 0;
  const kills = slippery === 0 && enemy.hp + enemy.block <= FIRE_POTION_DAMAGE;
  const fullDamage = slippery === 0 && enemy.block === 0;
  const dying = view.intent.totalIncoming >= player.hp + player.block;
  return kills || fullDamage || dying ? { slot: fire } : null;
}
