import type {
  CardInstance,
  ChoiceRequest,
  ChoiceResponse,
  DeepReadonly,
  Decision,
  Effect,
  Strategy,
  StrategyConfig,
  StrategyGroup,
  StrategyView,
} from './types';
import { attackDamage, attackHits } from './rules';

type Card = DeepReadonly<CardInstance>;

/**
 * Cards played first within the Attack group when they are affordable (#1: Tremble, v1;
 * #130). Kept as a list so the rule can grow later.
 */
export const PLAY_FIRST_CARD_IDS: readonly string[] = ['tremble'];

/** Energy a card gains when played (sum of its `gainEnergy` effects). */
export function energyGain(card: Card): number {
  let sum = 0;
  for (const e of card.effects) if (e.type === 'gainEnergy') sum += e.amount;
  return sum;
}

/** True for a card that leaves you with more energy than it costs (e.g. Fuel, Forgotten Ritual). */
export function isNetEnergyCard(card: Card): boolean {
  return !card.xCost && card.cost !== null && energyGain(card) > card.cost;
}

/** True when an X-cost card is in `card`'s position to be played: never at 0 energy. */
function xCostPlayable(card: Card, energy: number): boolean {
  return !card.xCost || energy > 0;
}

/** v1: an attack is any card with an `attack` effect (Bash included). */
export function isAttackCard(card: Card): boolean {
  return card.effects.some((e) => e.type === 'attack');
}

/** v1: a block card is any card with a `gainBlock` effect. */
export function isBlockCard(card: Card): boolean {
  return card.effects.some((e) => e.type === 'gainBlock');
}

function appliesVulnerable(card: Card): boolean {
  return card.effects.some((e) => e.type === 'applyVulnerable');
}

/**
 * Total base damage (damage × hits), including the card's own damage bonus (Thrash, #108).
 * For X-cost cards, X is `energy` (all of it gets spent).
 */
function totalBaseDamage(card: Card, energy: number): number {
  const x = card.xCost ? energy : 0;
  let sum = 0;
  for (const e of card.effects) {
    if (e.type !== 'attack') continue;
    sum += (e.damage + (card.damageBonus ?? 0)) * attackHits(e, x);
  }
  return sum;
}

/** #107: true for a card that draws cards (`draw` or `drawUntil`). */
export function isDrawCard(card: Card): boolean {
  return card.effects.some((e) => e.type === 'draw' || e.type === 'drawUntil');
}

/** #107: a draw card with no attack or block part (Master of Strategy, Soul, Scrawl, Offering). */
export function isPureDrawCard(card: Card): boolean {
  return isDrawCard(card) && !isAttackCard(card) && !isBlockCard(card);
}

/** #107: true for a card that stops all further draws this turn (Battle Trance). */
export function stopsDrawing(card: Card): boolean {
  return card.effects.some((e) => e.type === 'applyPower' && e.power === 'noDraw');
}

/** #106: HP the card makes you lose when played (sum of its `loseHp` effects). */
export function selfDamage(card: Card): number {
  let sum = 0;
  for (const e of card.effects) if (e.type === 'loseHp') sum += e.amount;
  return sum;
}

/** #107: a draw would find a card: draws aren't blocked and the draw or discard pile has cards. */
export function canDraw(view: StrategyView): boolean {
  const p = view.state.player;
  return !(p.powers?.noDraw ?? 0) && p.drawPile.length + p.discardPile.length > 0;
}

/**
 * #106: the view with every self-damage card that would drop the player to 0 HP removed from
 * `playable`. Strategies otherwise ignore the HP cost (Trent, #106 Q4).
 */
function withoutLethal(view: StrategyView): StrategyView {
  const hp = view.state.player.hp;
  if (!view.playable.some((c) => selfDamage(c) >= hp)) return view;
  return { ...view, playable: view.playable.filter((c) => selfDamage(c) < hp) };
}

/** 1 for a card that draws: draw cards win ties against cards that don't (#107). */
const draws = (c: Card): number => (isDrawCard(c) ? 1 : 0);

function totalBlock(card: Card): number {
  let sum = 0;
  for (const e of card.effects) if (e.type === 'gainBlock') sum += e.amount;
  return sum;
}

// ---------------------------------------------------------------------------
// #108 Exhaust. Self-contained helpers: the exhaust choice (every strategy), and where Brand /
// Burning Pact / Purity (early) and Second Wind / Fiend Fire (last) go in a turn.
// ---------------------------------------------------------------------------

/** #108 tier 1: a card that benefits from being exhausted (has a "when exhausted" trigger: Drum of Battle). */
export function benefitsFromExhaust(card: Card): boolean {
  return (card.triggers ?? []).some((t) => t.when === 'exhausted');
}

/** #108: a curse or status that hurts while it sits in hand or is drawn (a trigger that loses HP or deals damage). */
function isDamagingJunk(card: Card): boolean {
  const hurts = (e: DeepReadonly<Effect>) => e.type === 'loseHp' || e.type === 'attack' || e.type === 'dealDamage';
  return (card.triggers ?? []).some((t) => t.when !== 'exhausted' && t.effects.some(hurts));
}

/**
 * #108 exhaust tier (Trent, #108 Q1 final), lower goes first, for every strategy:
 * 1 benefits from being exhausted (Drum of Battle), 2 curses and statuses, 3 Strike, 4 Defend,
 * 5 Strike+, 6 Defend+, 7 anything else (lowest value first).
 */
export function exhaustTier(card: Card): number {
  if (benefitsFromExhaust(card)) return 1;
  if (card.type === 'curse' || card.type === 'status') return 2;
  if (card.cardId === 'strike') return card.upgraded ? 5 : 3;
  if (card.cardId === 'defend') return card.upgraded ? 6 : 4;
  return 7;
}

/**
 * #108: rough worth of a card, used only to pick "the lowest-value card" (tier 7). Sum of its
 * attack damage (damage × hits), Block, 3 per card drawn, 4 per energy and per Strength,
 * 3 per debuff stack, Poison, and 10 for a scripted effect (Fiend Fire, Thrash's growth).
 * Effects repeated "for each" count twice. Not a rule from Trent; the orchestrator's default.
 */
export function cardValue(card: Card): number {
  const bonus = card.damageBonus ?? 0;
  const value = (effects: readonly DeepReadonly<Effect>[]): number => {
    let v = 0;
    for (const e of effects) {
      switch (e.type) {
        case 'attack':
          v += (e.damage + bonus) * e.hits;
          break;
        case 'attackFrom':
          v += (e.damage + bonus) * e.hits;
          break;
        case 'gainBlock':
        case 'applyPoison':
          v += e.amount;
          break;
        case 'gainBlockFrom':
          v += e.amount;
          break;
        case 'draw':
          v += 3 * e.amount;
          break;
        case 'drawUntil':
          v += 9;
          break;
        case 'gainEnergy':
        case 'gainStrength':
          v += 4 * e.amount;
          break;
        case 'applyVulnerable':
        case 'applyWeak':
        case 'applyFrail':
          v += 3 * e.amount;
          break;
        case 'repeat':
          v += 2 * value(e.effects);
          break;
        case 'script':
          v += 10;
          break;
        default:
          break;
      }
    }
    return v;
  };
  return value(card.effects);
}

/** #108: the order cards are exhausted in (ascending): tier, damaging junk first, non-upgraded first, value, uid. */
function exhaustKey(card: Card): number[] {
  const tier = exhaustTier(card);
  return [
    tier,
    tier === 2 && isDamagingJunk(card) ? 0 : 1,
    card.upgraded ? 1 : 0,
    tier === 7 ? cardValue(card) : 0,
    card.uid,
  ];
}

/** #108: `cards` sorted in the order they should be exhausted. */
export function exhaustOrder(cards: readonly Card[]): Card[] {
  const keyed = cards.map((c) => ({ c, k: exhaustKey(c) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i]! - b.k[i]!;
    return 0;
  });
  return keyed.map((x) => x.c);
}

/** #108: a card worth spending an exhaust effect on: tiers 1–2, or a non-upgraded Strike or Defend. */
export function worthExhausting(card: Card): boolean {
  return exhaustTier(card) <= 4;
}

/**
 * #108 Strategy.choose for exhaust picks, shared by every strategy. A fixed count ("Exhaust 1
 * card") takes the first cards in the exhaust order. "Up to N" (Purity, #108 Q2) takes every
 * tier 1–2 card, then non-upgraded Strikes, then non-upgraded Defends, up to N, and nothing else.
 */
export function chooseExhaust(_view: StrategyView, request: ChoiceRequest): ChoiceResponse {
  const ordered = exhaustOrder(request.options);
  const eligible = request.max > request.min ? ordered.filter(worthExhausting) : ordered;
  const picked = eligible.slice(0, request.max);
  for (const c of ordered) {
    if (picked.length >= request.min) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return { uids: picked.map((c) => c.uid) };
}

function exhaustEffects(card: Card) {
  return card.effects.filter((e) => e.type === 'exhaustCards');
}

/**
 * #108: a card played early to exhaust a chosen card (Brand, Burning Pact, Purity): it picks
 * from the hand and is neither an attack nor a block card.
 */
export function isExhaustEnabler(card: Card): boolean {
  return (
    !isAttackCard(card) &&
    !isBlockCard(card) &&
    exhaustEffects(card).some((e) => e.mode === 'choose' && (e.from ?? 'hand') === 'hand')
  );
}

/** #108: Fiend Fire (exhausts the whole hand for damage). */
function isFiendFire(card: Card): boolean {
  return card.effects.some((e) => e.type === 'script' && e.id === 'fiendFire');
}

/** #108: Second Wind (exhausts every matching card in hand, then gains Block for each). */
function isSecondWind(card: Card): boolean {
  return exhaustEffects(card).some((e) => e.mode === 'all') && card.effects.some((e) => e.type === 'repeat');
}

/** #108: cards played last, after everything else: Second Wind and Fiend Fire. */
export function playsLast(card: Card): boolean {
  return isFiendFire(card) || isSecondWind(card);
}

/** #108: true when playing `card` (Second Wind: its filter; Fiend Fire: all) would exhaust `other` from hand. */
function exhaustedBy(card: Card, other: Card): boolean {
  if (other.uid === card.uid) return false;
  if (isFiendFire(card)) return true;
  const f = exhaustEffects(card).find((e) => e.mode === 'all')?.filter;
  return !f || ((!f.types || f.types.includes(other.type)) && !f.notTypes?.includes(other.type));
}

/** #108: how many other cards in hand `card` would exhaust. */
function wouldExhaust(view: StrategyView, card: Card): number {
  return view.state.player.hand.filter((c) => exhaustedBy(card, c)).length;
}

/** #108: Second Wind's Block per card exhausted (5, or 7 upgraded). */
function secondWindPer(card: Card): number {
  let per = 0;
  for (const e of card.effects) {
    if (e.type === 'repeat' && e.per === 'lastEffectCount') {
      for (const inner of e.effects) if (inner.type === 'gainBlock') per += inner.amount * (e.times ?? 1);
    }
  }
  return per;
}

/** #108: Block Second Wind would give now: its per-card Block × the cards it would exhaust. */
export function secondWindBlock(view: StrategyView, card: Card): number {
  return secondWindPer(card) * wouldExhaust(view, card);
}

/**
 * #129: a "plain" block card for Second Wind: it only gains Block, and no more than Second Wind
 * gives for exhausting it (Defend vs Second Wind's 5). Second Wind goes before these.
 */
export function isPlainBlock(card: Card, perCard: number): boolean {
  return card.effects.length > 0 && card.effects.every((e) => e.type === 'gainBlock') && totalBlock(card) <= perCard;
}

/** #129: Fiend Fire's damage per card exhausted (7, or 10 upgraded). */
function fiendFirePerCard(card: Card): number {
  for (const e of card.effects) if (e.type === 'script' && e.id === 'fiendFire') return e.values?.[0] ?? 0;
  return 0;
}

/** #129: Fiend Fire's damage now, before Weak / Vulnerable: (per card + Strength) × the other cards in hand. */
export function fiendFireDamage(view: StrategyView, card: Card): number {
  return (fiendFirePerCard(card) + view.state.player.strength) * wouldExhaust(view, card);
}

/** #129: true when Fiend Fire would kill the enemy now (Strength, Weak, Vulnerable and enemy Block counted). */
export function fiendFireKills(view: StrategyView, card: Card): boolean {
  const { player, enemy } = view.state;
  const hits = wouldExhaust(view, card);
  if (hits === 0) return false;
  const perHit = attackDamage(fiendFirePerCard(card), player.strength, player.debuffs.weak, enemy.debuffs.vulnerable);
  return perHit * hits >= enemy.hp + enemy.block;
}

/**
 * #129: the damage the other playable attacks would deal with all the current energy instead
 * (picked like pickAttack while affordable; (damage + Strength) × hits, before Weak / Vulnerable).
 * Fiend Fire exhausts the hand, so after it the rest of the energy has no attack to spend on.
 */
export function otherAttackDamage(view: StrategyView, fire: Card): number {
  const str = view.state.player.strength;
  let energy = view.state.player.energy;
  let pool = view.playable.filter((c) => c.uid !== fire.uid && !isFiendFire(c));
  let sum = 0;
  for (;;) {
    const affordable = pool.filter((c) => c.cost !== null && (c.xCost ? energy > 0 : c.cost <= energy));
    const a = pickAttack(affordable, energy);
    if (!a) return sum;
    const x = a.xCost ? energy : 0;
    for (const e of a.effects) {
      if (e.type === 'attack') sum += (e.damage + (a.damageBonus ?? 0) + str) * attackHits(e, x);
    }
    energy -= a.xCost ? energy : (a.cost as number);
    pool = pool.filter((c) => c.uid !== a.uid);
  }
}

/** #129: the playable Fiend Fire that would exhaust something, if any. */
function playableFiendFire(view: StrategyView): Card | undefined {
  return best(
    view.playable.filter((c) => isFiendFire(c) && wouldExhaust(view, c) > 0),
    () => [],
  );
}

/** #129: a playable Fiend Fire whose damage beats what the other attacks would deal with the energy. */
export function fiendFireThatBeats(view: StrategyView): Card | undefined {
  const fire = playableFiendFire(view);
  return fire && fiendFireDamage(view, fire) > otherAttackDamage(view, fire) ? fire : undefined;
}

/** #108: the best Brand / Burning Pact / Purity to play now: only while another card in hand is worth exhausting. */
export function pickExhaustEnabler(view: StrategyView): Card | undefined {
  const worth = (card: Card) => view.state.player.hand.some((c) => c.uid !== card.uid && worthExhausting(c));
  return best(
    view.playable.filter((c) => isExhaustEnabler(c) && worth(c)),
    () => [],
  );
}

/**
 * #108: once nothing else is played, Second Wind and Fiend Fire, if they would exhaust at least
 * one card. With energy for both, Second Wind goes first (Fiend Fire would exhaust it); with
 * energy for one, Fiend Fire, or Second Wind when `preferBlock` (Block ranks above Attack, #130).
 */
export function pickLast(view: StrategyView, preferBlock = false): Card | undefined {
  const ready = view.playable.filter((c) => playsLast(c) && wouldExhaust(view, c) > 0);
  const wind = best(ready.filter(isSecondWind), () => []);
  const fire = best(ready.filter(isFiendFire), () => []);
  if (!wind || !fire) return wind ?? fire;
  if ((wind.cost ?? 0) + (fire.cost ?? 0) <= view.state.player.energy) return wind;
  return preferBlock ? wind : fire;
}

/**
 * The highest-ranked card among `cards`: ranks compare element by element (higher wins),
 * ties go to the lowest uid.
 */
function best(cards: readonly Card[], rank: (c: Card) => readonly number[]): Card | undefined {
  let top: Card | undefined;
  let topRank: readonly number[] = [];
  for (const c of cards) {
    const r = rank(c);
    if (!top || outranks(r, topRank) || (sameRank(r, topRank) && c.uid < top.uid)) {
      top = c;
      topRank = r;
    }
  }
  return top;
}

function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

function sameRank(a: readonly number[], b: readonly number[]): boolean {
  return a.every((v, i) => v === b[i]);
}

/** X-cost cards rank below every other card, so they only spend leftover energy. */
const notXCost = (c: Card): number => (c.xCost ? 0 : 1);

/**
 * Best attack to play: X-cost attacks only once no other attack is playable
 * (so they spend the leftover energy; never at 0 energy), then Vulnerable-appliers
 * first, then highest total base damage (damage × hits), then cards that draw (#107),
 * ties → lowest uid.
 */
export function pickAttack(playable: readonly Card[], energy = 0): Card | undefined {
  const attacks = playable.filter((c) => isAttackCard(c) && xCostPlayable(c, energy));
  return best(attacks, (c) => [notXCost(c), appliesVulnerable(c) ? 1 : 0, totalBaseDamage(c, energy), draws(c)]);
}

/**
 * Best block card: X-cost block cards only once no other block card is
 * playable (never at 0 energy), then largest block amount, then cards that
 * draw (#107), ties → lowest uid.
 */
export function pickBlock(playable: readonly Card[], energy = 0): Card | undefined {
  const blocks = playable.filter((c) => isBlockCard(c) && xCostPlayable(c, energy));
  return best(blocks, (c) => [notXCost(c), totalBlock(c), draws(c)]);
}

/** #130 / #109: a Power card (the Powers group). */
export function isPowerCard(card: Card): boolean {
  return card.type === 'power';
}

/**
 * #130: best Power to play: X-cost Powers only once no other Power is playable (never at 0
 * energy), then the highest cardValue, ties → lowest uid. No Power is simulated yet (#109).
 */
export function pickPower(playable: readonly Card[], energy = 0): Card | undefined {
  const powers = playable.filter((c) => isPowerCard(c) && xCostPlayable(c, energy));
  return best(powers, (c) => [notXCost(c), cardValue(c)]);
}

/** #130: a base card (named Strike or Defend, upgraded or not). */
export function isBaseCard(card: Card): boolean {
  return card.cardId === 'strike' || card.cardId === 'defend';
}

/**
 * #132 (Trent): true when the hand can't fill the strategy's top priority group, so a pure draw
 * card is worth playing first. Attack: no attack (or Tremble) is affordable. Powers: no Power is
 * affordable. Block: the block cards that fit the energy can't bring the incoming damage down to
 * the allowance (a Block group that is already satisfied counts as filled). An X-cost card in the
 * group counts as filling it. False when nothing can be drawn.
 */
export function cannotFillTopGroup(view: StrategyView, config: StrategyConfig): boolean {
  if (!canDraw(view)) return false;
  const energy = view.state.player.energy;
  switch (config.order[0]) {
    case 'attack':
      return !pickPlayFirst(view) && !pickAttack(view.playable, energy);
    case 'powers':
      return !pickPower(view.playable, energy);
    case 'block': {
      const blocks = view.playable.filter(isBlockCard);
      if (blocks.some((c) => c.xCost)) return false;
      return maxBlockWith(blocks, energy) < blockNeeded(view, config);
    }
    default:
      return false;
  }
}

/** Block still wanted for the Block group to be satisfied (incoming damage − Block − allowance). */
function blockNeeded(view: StrategyView, config: StrategyConfig): number {
  return view.intent.totalIncoming - view.state.player.block - config.allowThrough;
}

/** Most Block the cards give within `energy` (each card at most once). */
function maxBlockWith(blocks: readonly Card[], energy: number): number {
  const best = new Array<number>(energy + 1).fill(0);
  for (const c of blocks) {
    const cost = c.cost ?? 0;
    const gain = totalBlock(c);
    for (let e = energy; e >= cost; e--) best[e] = Math.max(best[e]!, best[e - cost]! + gain);
  }
  return best[energy]!;
}

/** #107: Battle Trance, once no other draw card in hand is playable (so every other draw comes first). */
function pickTrance(view: StrategyView): Card | undefined {
  const trance = best(view.playable.filter(stopsDrawing), () => []);
  if (trance && !view.playable.some((c) => c.uid !== trance.uid && isDrawCard(c) && !stopsDrawing(c))) return trance;
  return undefined;
}

/** #107: a pure draw card other than Battle Trance and the exhaust enablers. */
function pickPureDraw(view: StrategyView): Card | undefined {
  return best(
    view.playable.filter((c) => isPureDrawCard(c) && !stopsDrawing(c) && !isExhaustEnabler(c)),
    () => [],
  );
}

/** Tremble (#1), when affordable. */
function pickPlayFirst(view: StrategyView): Card | undefined {
  return best(
    view.playable.filter((c) => PLAY_FIRST_CARD_IDS.includes(c.cardId)),
    () => [],
  );
}

/**
 * #132: a 0-cost draw card (any 0-cost card whose effects include a draw) played first in the
 * turn; Battle Trance only once no other draw card is playable. Exhaust enablers keep their own
 * rule. Nothing when nothing can be drawn.
 */
function pickZeroCostDraw(view: StrategyView): Card | undefined {
  if (!canDraw(view)) return undefined;
  const zero = (c: Card) => !c.xCost && c.cost === 0;
  const draw = best(
    view.playable.filter((c) => zero(c) && isDrawCard(c) && !stopsDrawing(c) && !isExhaustEnabler(c)),
    () => [],
  );
  if (draw) return draw;
  const trance = pickTrance(view);
  return trance && zero(trance) ? trance : undefined;
}

/**
 * Plays made before the groups, in this order: a 0-cost draw card (#132); Tremble when Attack
 * ranks first (it is first within the Attack group, and Attack is the top priority); a Brand /
 * Burning Pact / Purity worth playing (#108); a pure draw card when the hand can't fill the top
 * group (#132); a card that nets energy (#22), as long as some other card in hand could use it.
 * Other pure draw cards wait until the groups are done (decide); attack and block draw cards are
 * ranked within their group.
 */
function pickTop(view: StrategyView, config: StrategyConfig): Card | undefined {
  const zero = pickZeroCostDraw(view);
  if (zero) return zero;
  if (config.order[0] === 'attack') {
    const tremble = pickPlayFirst(view);
    if (tremble) return tremble;
  }
  const enabler = pickExhaustEnabler(view);
  if (enabler) return enabler;
  if (cannotFillTopGroup(view, config)) {
    const pure = pickPureDraw(view);
    if (pure) return pure;
  }
  const energy = best(view.playable.filter(isNetEnergyCard), (c) => [netEnergy(c)]);
  if (energy && view.state.player.hand.some((c) => c.uid !== energy.uid && wantsEnergy(c))) return energy;
  return undefined;
}

/** Energy left over after playing a net-energy card. */
function netEnergy(card: Card): number {
  return energyGain(card) - (card.cost as number);
}

/** A card that costs energy and that some strategy would play. */
function wantsEnergy(c: Card): boolean {
  const costsEnergy = c.cost !== null && (c.xCost || c.cost > 0);
  return (
    costsEnergy &&
    (isAttackCard(c) ||
      isBlockCard(c) ||
      isPowerCard(c) ||
      isDrawCard(c) ||
      isNetEnergyCard(c) ||
      PLAY_FIRST_CARD_IDS.includes(c.cardId))
  );
}

/**
 * #130: the card a group plays now, or undefined to move on to the next group.
 * - attack: Tremble first (#1); then Fiend Fire when it beats the other attacks (#129, below);
 *   then the best attack.
 * - powers: the best Power.
 * - block, not last: while (incoming − Block) > allowThrough, the best block card or Second Wind
 *   (#129, below).
 * - block, last: the same, spending leftover energy (allowThrough is unused).
 * `planning` (a turn plan for Second Wind) leaves out the #129 rules.
 */
function pickFromGroup(
  view: StrategyView,
  group: StrategyGroup,
  config: StrategyConfig,
  planning: boolean,
): Card | undefined {
  const energy = view.state.player.energy;
  switch (group) {
    case 'attack': {
      const first = pickPlayFirst(view);
      if (first) return first;
      const atk = pickAttack(view.playable, energy);
      return planning ? atk : (pickFiendFire(view, config, atk) ?? atk);
    }
    case 'powers':
      return pickPower(view.playable, energy);
    case 'block': {
      if (!blockIsLast(config) && view.intent.totalIncoming - view.state.player.block <= config.allowThrough) {
        return undefined;
      }
      const blk = pickBlock(view.playable, energy);
      return planning ? blk : (pickSecondWind(view, config, blk) ?? blk);
    }
  }
}

/**
 * #129 Fiend Fire in the Attack group, when its damage beats what the other attacks would deal
 * with the energy (otherAttackDamage).
 * - Attack ranked first (Greedy Damage): Vulnerable-appliers and draw cards go first, as long as
 *   Fiend Fire stays affordable after them (a draw grows the hand it exhausts); then Fiend Fire.
 * - Other orders: Fiend Fire as soon as the Attack group is reached and it beats.
 */
function pickFiendFire(view: StrategyView, config: StrategyConfig, atk: Card | undefined): Card | undefined {
  const fire = fiendFireThatBeats(view);
  if (!fire || config.order[0] !== 'attack') return fire;
  const energy = view.state.player.energy;
  const leaves = (c: Card) => !c.xCost && (c.cost ?? 0) + (fire.cost ?? 0) <= energy;
  if (atk && appliesVulnerable(atk) && leaves(atk)) return atk;
  if (canDraw(view)) {
    const draw = best(
      view.playable.filter((c) => isDrawCard(c) && !stopsDrawing(c) && leaves(c)),
      (c) => [isPureDrawCard(c) ? 1 : 0],
    );
    if (draw) return draw;
    const trance = pickTrance(view);
    if (trance && leaves(trance)) return trance;
  }
  return fire;
}

/**
 * #129 Second Wind in the Block group. The rest of the turn is planned first (planTurn, without
 * Second Wind and Fiend Fire); a Power or block card that plan plays and Second Wind would exhaust
 * is played first, unless it is a plain block card (isPlainBlock: Defend). Then Second Wind goes
 * before plain block cards, and after a better block card only when that card gives more Block
 * than Second Wind would now.
 */
function pickSecondWind(view: StrategyView, config: StrategyConfig, blk: Card | undefined): Card | undefined {
  const wind = best(view.playable.filter(isSecondWind), (c) => [secondWindBlock(view, c)]);
  if (!wind) return undefined;
  const per = secondWindPer(wind);
  const planned = planTurn(view, config, view.state.player.energy - (wind.cost ?? 0));
  const keep = planned.find((c) => exhaustedBy(wind, c) && !isPlainBlock(c, per));
  if (keep) return keep;
  const windBlock = secondWindBlock(view, wind);
  if (windBlock <= 0) return undefined;
  if (!blk || isPlainBlock(blk, per)) return wind;
  return windBlock > totalBlock(blk) ? wind : undefined;
}

/**
 * #129: the cards the strategy would play for the rest of the turn with `energy`, leaving out
 * Second Wind and Fiend Fire. Tracks energy and Block only: draws and exhausts are not simulated.
 */
export function planTurn(view: StrategyView, config: StrategyConfig, energy: number): Card[] {
  const p = view.state.player;
  let hand = p.hand.filter((c) => !playsLast(c));
  let e = energy;
  let block = p.block;
  const played: Card[] = [];
  for (let i = 0; i < 20; i++) {
    const playable = view.playable.filter(
      (c) => hand.includes(c) && c.cost !== null && (c.xCost ? e >= 0 : c.cost <= e),
    );
    const state = { ...view.state, player: { ...p, hand, energy: e, block } };
    const d = decideWith({ ...view, state, playable }, config, true);
    if (d.kind === 'endTurn') break;
    const c = hand.find((x) => x.uid === d.uid)!;
    played.push(c);
    hand = hand.filter((x) => x !== c);
    e -= c.xCost ? e : (c.cost ?? 0);
    for (const fx of c.effects) {
      if (fx.type === 'gainBlock') block += fx.amount;
      if (fx.type === 'gainEnergy') e += fx.amount;
    }
  }
  return played;
}

/** #130: true when Block is the last group. */
export function blockIsLast(config: StrategyConfig): boolean {
  return config.order[config.order.length - 1] === 'block';
}

/**
 * #130 decision: Fiend Fire first when it would kill (#129); the top plays (pickTop); the groups
 * in order; once every group is done, a pure draw card (when it didn't go first, #132), leftover
 * block, Battle Trance, and last Second Wind / Fiend Fire (#108; with energy for one, Fiend Fire
 * when Attack ranks above Block). A self-damage card that would kill is never played (#106).
 */
function decide(raw: StrategyView, config: StrategyConfig): Decision {
  return decideWith(withoutLethal(raw), config, false);
}

function decideWith(view: StrategyView, config: StrategyConfig, planning: boolean): Decision {
  if (!planning) {
    const fire = playableFiendFire(view);
    if (fire && fiendFireKills(view, fire)) return play(fire);
  }
  const top = pickTop(view, config);
  if (top) return play(top);
  for (const g of config.order) {
    const c = pickFromGroup(view, g, config, planning);
    if (c) return play(c);
  }
  const drawing = canDraw(view);
  const pure = drawing ? pickPureDraw(view) : undefined;
  if (pure) return play(pure);
  const blk = pickBlock(view.playable, view.state.player.energy);
  if (blk) return play(blk);
  const trance = drawing ? pickTrance(view) : undefined;
  if (trance) return play(trance);
  if (planning) return END;
  const preferBlock = config.order.indexOf('block') < config.order.indexOf('attack');
  const last = pickLast(view, preferBlock);
  if (last) return play(last);
  return END;
}

const END: Decision = { kind: 'endTurn' };
const play = (c: Card): Decision => ({ kind: 'play', uid: c.uid });

/**
 * Strategies are stateless: each decision is recomputed from the view (the current hand and
 * energy, so cards drawn mid-turn are re-planned around), and one instance can safely be
 * reused across combats.
 */
export function createStrategy(config: StrategyConfig): Strategy {
  const c = normalizeConfig(config);
  if (!c) throw new Error(`Invalid strategy config ${JSON.stringify(config)}`);
  return { decide: (view) => decide(view, c), choose: chooseExhaust };
}

// ---------------------------------------------------------------------------
// #130 configs: defaults, validation, migration and URL codes
// ---------------------------------------------------------------------------

export const STRATEGY_GROUPS: readonly StrategyGroup[] = ['attack', 'block', 'powers'];

/** Largest allowThrough; URL codes hold at most 4 digits. */
export const MAX_ALLOW_THROUGH = 9999;

/** Greedy Damage: Attack, Powers, Block (the old 'greedyDamage'). */
export const GREEDY_CONFIG: StrategyConfig = { order: ['attack', 'powers', 'block'], allowThrough: 0 };

/** The old "block, allow X": Block (allow X), Powers, Attack. */
export function blockFirstConfig(allowThrough: number): StrategyConfig {
  return { order: ['block', 'powers', 'attack'], allowThrough };
}

function validAllow(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_ALLOW_THROUGH;
}

/**
 * A valid config in canonical form (allowThrough 0 when Block is last), or null. Also accepts the
 * pre-#130 shapes: { kind: 'greedyDamage' } → Attack, Powers, Block; { kind: 'block',
 * allowThrough: X } → Block (allow X), Powers, Attack.
 */
export function normalizeConfig(raw: unknown): StrategyConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'greedyDamage') return { ...GREEDY_CONFIG, order: [...GREEDY_CONFIG.order] };
  if (o.kind === 'block') return validAllow(o.allowThrough) ? blockFirstConfig(o.allowThrough) : null;
  const order = o.order;
  if (!Array.isArray(order) || order.length !== STRATEGY_GROUPS.length) return null;
  if (!STRATEGY_GROUPS.every((g) => order.includes(g))) return null;
  if (!validAllow(o.allowThrough)) return null;
  const groups = order as StrategyGroup[];
  return { order: [...groups], allowThrough: groups[groups.length - 1] === 'block' ? 0 : o.allowThrough };
}

/** True when two configs play the same (same order and, unless Block is last, same X). */
export function sameConfig(a: StrategyConfig, b: StrategyConfig): boolean {
  return strategyCode(a) === strategyCode(b);
}

const GROUP_LETTER: Record<StrategyGroup, string> = { attack: 'a', block: 'b', powers: 'p' };
const LETTER_GROUP: Record<string, StrategyGroup> = { a: 'attack', b: 'block', p: 'powers' };

/** URL code: the order's letters, X after "b" unless Block is last ("apb", "b5pa", "pb5a"). */
export function strategyCode(config: StrategyConfig): string {
  const last = blockIsLast(config);
  return config.order.map((g) => (g === 'block' && !last ? `b${config.allowThrough}` : GROUP_LETTER[g])).join('');
}

/** Parses a code from strategyCode, or an old one ("g", "b<X>"). Null for anything else. */
export function parseStrategyCode(code: string): StrategyConfig | null {
  if (code === 'g') return normalizeConfig({ kind: 'greedyDamage' });
  const old = /^b(0|[1-9]\d{0,3})$/.exec(code);
  if (old) return blockFirstConfig(Number(old[1]));
  const m = /^([abp])(0|[1-9]\d{0,3})?([abp])(0|[1-9]\d{0,3})?([abp])$/.exec(code);
  if (!m) return null;
  const letters = [m[1]!, m[3]!, m[5]!];
  const digits = [m[2], m[4]];
  if (new Set(letters).size !== 3) return null;
  // Digits only right after a "b" that isn't last, and that "b" must have them.
  for (let i = 0; i < 2; i++) if ((letters[i] === 'b') !== (digits[i] !== undefined)) return null;
  const order = letters.map((l) => LETTER_GROUP[l]!);
  const x = digits[0] ?? digits[1];
  return { order, allowThrough: x === undefined ? 0 : Number(x) };
}
