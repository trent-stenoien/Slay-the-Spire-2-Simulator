/** Pure combat rules shared by the combat loop and the strategies. */
import type {
  CardFilter,
  CardInstance,
  CombatState,
  Condition,
  Counter,
  DeepReadonly,
  EnemyState,
  PlayerState,
} from './types';

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
  skillsPlayedThisTurn = 0,
): number | null {
  if (card.cost === null) return null;
  if (card.xCost) return 0;
  if (freeAttack && card.type === 'attack') return 0;
  let cost = card.costThisTurn ?? card.costThisCombat ?? card.cost;
  if (card.costLessPer)
    cost = Math.max(
      0,
      cost -
        card.costLessPer.amount *
          (card.costLessPer.per === 'skillsPlayedThisTurn' ? skillsPlayedThisTurn : attacksPlayedThisTurn),
    );
  return cost;
}

/** True when the card has a cost, the energy covers it, and it isn't Unplayable. */
export function isPlayable(card: DeepReadonly<CardInstance>, energy: number): boolean {
  return card.cost !== null && card.cost <= energy && !card.keywords.includes('unplayable');
}

// ---------------------------------------------------------------------------
// #111 Conditional and scaling cards: shared by the combat loop and the strategies
// ---------------------------------------------------------------------------

/** #111 (Trent): a card counts as a Strike when "Strike" appears anywhere in its name ("Strike+", "Twin Strike"). */
export const STRIKE_NAME = 'Strike';

/** #111/#113: the one name rule for Perfected Strike and Hellraiser. Case-sensitive; an upgraded "+" does not matter. */
export function isStrikeName(name: string): boolean {
  return name.includes(STRIKE_NAME);
}

/** #111 Perfected Strike: every card with "Strike" in its name in the Draw, Hand, Discard and Exhaust piles. */
export function countStrikes(player: DeepReadonly<PlayerState>): number {
  let n = 0;
  for (const pile of [player.drawPile, player.hand, player.discardPile, player.exhaustPile]) {
    for (const c of pile) if (isStrikeName(c.name)) n++;
  }
  return n;
}

/**
 * #111 Rend (Trent): the debuffs from the wiki's Debuffs table that the simulator models on an
 * enemy, each counted once: Vulnerable, Weak, Frail, Poison, negative Strength and the
 * temporary Strength loss (#110).
 */
export function uniqueDebuffs(enemy: DeepReadonly<EnemyState>): number {
  let n = 0;
  if (enemy.debuffs.vulnerable > 0) n++;
  if (enemy.debuffs.weak > 0) n++;
  if (enemy.debuffs.frail > 0) n++;
  if (enemy.poison > 0) n++;
  if (enemy.strength < 0) n++;
  if ((enemy.powers?.strengthLossThisTurn ?? 0) > 0) n++;
  return n;
}

/** Values a counter can read that live outside the piles and debuffs: the previous effects of the same card. */
export interface CounterContext {
  lastEffectCount?: number;
  lastAttackDamage?: number;
  /** #265: the card being played is an Attack, already counted in attacksPlayedThisTurn (Finisher reads "before this"). */
  playingAttack?: boolean;
  /** #265: the cards the previous `draw` effect of this card drew (Escape Plan). */
  drawnByLastDraw?: readonly DeepReadonly<CardInstance>[];
}

/** The value of a counter in `state` (#111). */
export function counterValue(counter: Counter, state: DeepReadonly<CombatState>, ctx: CounterContext = {}): number {
  const { player, enemy } = state;
  const c = player.counters;
  switch (counter) {
    case 'playerBlock':
      return player.block;
    case 'playerStrength':
      return player.strength;
    case 'enemyVulnerable':
      return enemy.debuffs.vulnerable;
    case 'enemyUniqueDebuffs':
      return uniqueDebuffs(enemy);
    case 'handSize':
      return player.hand.length;
    case 'drawPileSize':
      return player.drawPile.length;
    case 'discardPileSize':
      return player.discardPile.length;
    case 'exhaustPileSize':
      return player.exhaustPile.length;
    case 'hpLossesThisCombat':
      return c?.hpLossesThisCombat ?? 0;
    case 'cardsPlayedThisTurn':
      return c?.cardsPlayedThisTurn ?? 0;
    case 'cardsPlayedThisCombat':
      return c?.cardsPlayedThisCombat ?? 0;
    case 'attacksPlayedThisTurn':
      return c?.attacksPlayedThisTurn ?? 0;
    case 'skillsPlayedThisTurn':
      return c?.skillsPlayedThisTurn ?? 0;
    case 'cardsDrawnThisCombat':
      return c?.cardsDrawnThisCombat ?? 0;
    case 'cardsDiscardedThisTurn':
      return c?.cardsDiscardedThisTurn ?? 0;
    case 'skillsInHand':
      return player.hand.filter((card) => card.type === 'skill').length;
    case 'attacksPlayedBeforeThis':
      // The card being played is already counted; a card still in hand is not.
      return Math.max(0, (c?.attacksPlayedThisTurn ?? 0) - (ctx.playingAttack ? 1 : 0));
    case 'cardsExhaustedThisTurn':
      return c?.cardsExhaustedThisTurn ?? 0;
    case 'cardsExhaustedThisCombat':
      return c?.cardsExhaustedThisCombat ?? 0;
    case 'lastEffectCount':
      return ctx.lastEffectCount ?? 0;
    case 'lastAttackDamage':
      return ctx.lastAttackDamage ?? 0;
  }
}

/** `amount` × counter for a PerCounter, or 0 when absent. */
export function perCounterValue(
  per: { per: Counter; amount: number } | undefined,
  state: DeepReadonly<CombatState>,
  ctx: CounterContext = {},
): number {
  return per ? per.amount * counterValue(per.per, state, ctx) : 0;
}

/**
 * Whether a `conditional` / `playableIf` condition holds. `selfUid` is the card being played or
 * considered: it is ignored in "every card in hand" tests. `fatal` is decided by the engine
 * (the previous attack killed), so it is false here.
 */
export function conditionHolds(
  cond: DeepReadonly<Condition>,
  state: DeepReadonly<CombatState>,
  matches: (card: CardInstance, filter: CardFilter) => boolean,
  selfUid?: number,
  ctx: CounterContext = {},
): boolean {
  const { player, enemy } = state;
  switch (cond.kind) {
    case 'lostHpThisTurn':
      return (player.counters?.hpLostThisTurn ?? 0) > 0;
    case 'enemyHas':
      return cond.status === 'poison' ? enemy.poison > 0 : enemy.debuffs[cond.status] > 0;
    case 'counter': {
      const v = counterValue(cond.counter, state, ctx);
      return (cond.min === undefined || v >= cond.min) && (cond.max === undefined || v <= cond.max);
    }
    case 'handHasNone':
      return !player.hand.some((c) => c.uid !== selfUid && matches(c as CardInstance, cond.filter as CardFilter));
    case 'handAll':
      return player.hand.every((c) => c.uid === selfUid || matches(c as CardInstance, cond.filter as CardFilter));
    case 'drewMatching':
      return (ctx.drawnByLastDraw ?? []).some((c) => matches(c as CardInstance, cond.filter as CardFilter));
    case 'fatal':
      return false;
  }
}
