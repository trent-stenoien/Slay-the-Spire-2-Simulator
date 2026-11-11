/** Pure combat rules shared by the combat loop and the strategies. */
import type { CardInstance, DeepReadonly } from './types';

/**
 * Damage per hit = floor((base + Strength) × (Weak ? 0.75 : 1) × (Vulnerable ? 1.5 : 1) × Shrink),
 * floored once at the end, minimum 0. #109 Cruelty: `crueltyPercent` adds to Vulnerable's 50%
 * (25 → ×1.75, 50 → ×2); it only matters when the target is Vulnerable. #4 Shrink: the attacker
 * deals `shrinkPercent`% less, applied after every other modifier (×0.7 for 30). #110 Colossus:
 * `reducePercent` is a further percent less on the same floor (50 → ×0.5, so Weak + Colossus = ×0.375).
 */
export function attackDamage(
  base: number,
  attackerStrength: number,
  attackerWeak: number,
  targetVulnerable: number,
  crueltyPercent = 0,
  shrinkPercent = 0,
  reducePercent = 0,
): number {
  let dmg = base + attackerStrength;
  if (attackerWeak > 0) dmg *= 0.75;
  if (targetVulnerable > 0) dmg *= 1.5 + crueltyPercent / 100;
  // Integer percent math (× 70 / 100) so e.g. 10 × 0.7 can't floor to 6.
  if (shrinkPercent > 0) dmg = (dmg * (100 - shrinkPercent)) / 100;
  if (reducePercent > 0) dmg = (dmg * (100 - reducePercent)) / 100;
  return Math.max(0, Math.floor(dmg));
}

/** Block gained = floor(amount × (Frail ? 0.75 : 1)), minimum 0. */
export function blockGain(amount: number, frail: number): number {
  return Math.max(0, Math.floor(amount * (frail > 0 ? 0.75 : 1)));
}

/** Total hits of an attack effect, given X (the energy spent on an X-cost card; 0 otherwise). */
export function attackHits(e: { hits: number; xTimes?: boolean; xBonus?: number }, x: number): number {
  return e.xTimes ? e.hits * Math.max(0, x + (e.xBonus ?? 0)) : e.hits;
}

/** #110 Colossus: the percent less damage taken from a Vulnerable enemy while Colossus is on. */
export const COLOSSUS_REDUCTION = 50;

/**
 * #110: what a card costs right now, or null if unplayable. `costThisTurn` beats `costThisCombat`
 * beats the base cost (Enlightenment); `costLessPer` then takes its amount off for each counted
 * Attack played this turn (Stomp), minimum 0; `freeAttack` (Unrelenting) makes a non-X Attack 0.
 * X-cost cards stay 0 here: X is the energy available.
 */
export function cardCost(
  card: DeepReadonly<CardInstance>,
  attacksPlayedThisTurn: number,
  freeAttack: boolean,
): number | null {
  if (card.cost === null) return null;
  if (card.xCost) return 0;
  if (freeAttack && card.type === 'attack') return 0;
  let cost = card.costThisTurn ?? card.costThisCombat ?? card.cost;
  if (card.costLessPer) cost = Math.max(0, cost - card.costLessPer.amount * attacksPlayedThisTurn);
  return cost;
}

/** True when the card has a cost, the energy covers it, and it isn't Unplayable. */
export function isPlayable(card: DeepReadonly<CardInstance>, energy: number): boolean {
  return card.cost !== null && card.cost <= energy && !card.keywords.includes('unplayable');
}
