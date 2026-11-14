/**
 * #204 potion-use rules shared by every built-in strategy (one helper: `pickPotion`).
 *
 * - Strength Potion: used at the first chance, which is turn 1 before any card.
 * - Poison Potion (Apply 6 Poison, Silent): used at the first chance, right after the Strength Potion
 *   (Poison ticks every enemy turn, so earlier is always more damage).
 * - Energy Potion (Gain 2 Energy, #211): used on the first turn the hand holds at least 2 Energy of
 *   playable cards beyond what the current Energy affords (sum of the cost of every playable card in
 *   hand − Energy ≥ 2). X-cost cards count as 0 (they use whatever Energy there is, so the potion
 *   is never held for one). It sits after the Poison Potion and before the Fire Potion.
 * - Fire Potion (20 damage through Block, not affected by Strength): used when it does the most.
 *   Slippery (enemy power, #213; missing counts as 0) holds the damage down, so it waits until
 *   Slippery is gone. Then it is used when it kills, or when the enemy has no Block (full 20 to
 *   HP). Fallback so the player does not die holding it: used at once when the enemy's coming
 *   attack could kill the player (intent total ≥ HP + Block), whatever Slippery or Block say.
 */
import { cardCost } from './rules';
import type { DeepReadonly, PotionUse, StrategyView } from './types';

export const STRENGTH_POTION = 'strength_potion';
export const FIRE_POTION = 'fire_potion';
export const POISON_POTION = 'poison_potion';
export const ENERGY_POTION = 'energy_potion';
/** Energy of the Energy Potion (data/potions/energy_potion.json). */
export const ENERGY_POTION_AMOUNT = 2;
/** Damage of the Fire Potion (data/potions/fire_potion.json). */
export const FIRE_POTION_DAMAGE = 20;

/** Slot of the first held potion with this id, or -1. */
function slotOf(view: DeepReadonly<StrategyView>, id: string): number {
  return (view.state.player.potions ?? []).findIndex((p) => p === id);
}

/** Total cost of the playable cards in hand beyond the current Energy (0 or more). */
function unaffordableEnergy(view: DeepReadonly<StrategyView>): number {
  const { player } = view.state;
  const counters = player.counters;
  let total = 0;
  for (const c of player.hand) {
    if (c.keywords.includes('unplayable')) continue;
    total += cardCost(c, counters?.attacksPlayedThisTurn ?? 0, false, counters?.skillsPlayedThisTurn ?? 0, false) ?? 0;
  }
  return Math.max(0, total - player.energy);
}

export function pickPotion(view: StrategyView): PotionUse | null {
  const { player, enemy } = view.state;
  const strength = slotOf(view, STRENGTH_POTION);
  if (strength >= 0) return { slot: strength };
  const poison = slotOf(view, POISON_POTION);
  if (poison >= 0) return { slot: poison };
  const energy = slotOf(view, ENERGY_POTION);
  if (energy >= 0 && unaffordableEnergy(view) >= ENERGY_POTION_AMOUNT) return { slot: energy };
  const fire = slotOf(view, FIRE_POTION);
  if (fire < 0) return null;
  const slippery = enemy.powers?.slippery ?? 0;
  const kills = slippery === 0 && enemy.hp + enemy.block <= FIRE_POTION_DAMAGE;
  const fullDamage = slippery === 0 && enemy.block === 0;
  const dying = view.intent.totalIncoming >= player.hp + player.block;
  return kills || fullDamage || dying ? { slot: fire } : null;
}
