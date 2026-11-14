import type {
  CardInstance,
  ChoiceRequest,
  ChoiceResponse,
  DeepReadonly,
  Decision,
  CardFilter,
  Effect,
  PileName,
  PowerId,
  Strategy,
  StrategyConfig,
  StrategyGroup,
  StrategyView,
  TargetPriority,
} from './types';
import { attackDamage, attackHits, conditionHolds, countStrikes, perCounterValue } from './rules';
import { chooseGenerated, chooseRetained } from './generate';
import { pickPotion } from './potions';

type Card = DeepReadonly<CardInstance>;

/**
 * Cards played first within the Attack group when they are affordable (#1: Tremble, v1;
 * #130). Kept as a list so the rule can grow later.
 */
export const PLAY_FIRST_CARD_IDS: readonly string[] = ['tremble'];

/**
 * Energy a card gains when played (sum of its `gainEnergy` effects). #246 Expect a Fight gains 1 per Attack
 * in `hand`; without a hand it counts 0.
 */
export function energyGain(card: Card, hand: readonly Card[] = []): number {
  let sum = 0;
  for (const e of card.effects) {
    if (e.type === 'gainEnergy') sum += e.amount;
    else if (e.type === 'script' && e.id === 'expectAFight')
      sum += hand.filter((c) => c !== card && c.type === 'attack').length;
  }
  return sum;
}

/** True for a card that leaves you with more energy than it costs (e.g. Fuel, Forgotten Ritual; Expect a Fight given its hand). */
export function isNetEnergyCard(card: Card, hand: readonly Card[] = []): boolean {
  return !card.xCost && card.cost !== null && energyGain(card, hand) > card.cost;
}

/** True when an X-cost card is in `card`'s position to be played: never at 0 energy. */
function xCostPlayable(card: Card, energy: number): boolean {
  return !card.xCost || energy > 0;
}

type State = StrategyView['state'];

/** #111: an effect that is an attack in the strategy's eyes: `attack`, `attackFrom`, Perfected Strike, or a conditional holding one. */
function isAttackEffect(e: DeepReadonly<Effect>): boolean {
  if (e.type === 'attack' || e.type === 'attackFrom') return true;
  if (e.type === 'script') return e.id === 'perfectedStrike';
  return e.type === 'conditional' && [...e.then, ...(e.else ?? [])].some(isAttackEffect);
}

/**
 * v1: an attack is any card with an `attack` effect (Bash included); #111 adds `attackFrom` and Perfected Strike.
 * #114 (Trent): Cascade, an X-cost card that plays the top X cards of the draw pile, is played with the X-cost
 * attacks; its damage counts as 0, so it comes after every other X-cost attack and after every other attack.
 */
export function isAttackCard(card: Card): boolean {
  return card.effects.some(isAttackEffect) || isCascade(card);
}

/**
 * v1: a block card is any card with a `gainBlock` effect; #111 adds `gainBlockFrom` (Stack, Entrench,
 * Expect a Fight), except Fisticuffs' Block, which only follows its attack (it is an attack card).
 */
export function isBlockCard(card: Card): boolean {
  return card.effects.some(
    (e) => e.type === 'gainBlock' || (e.type === 'gainBlockFrom' && e.bonusPer.per !== 'lastAttackDamage'),
  );
}

/** #111 (Trent): Entrench ("double your Block") is planned with the block cards, played after them. */
function doublesBlock(card: Card): boolean {
  return card.effects.some((e) => e.type === 'gainBlockFrom' && e.bonusPer.per === 'playerBlock');
}

/** #111 (Trent): Body Slam (damage equal to your Block) is played after the other block cards. */
function waitsForBlock(card: Card): boolean {
  return card.effects.some((e) => e.type === 'attackFrom' && e.bonusPer?.per === 'playerBlock');
}

/** #265: Finisher (damage per Attack already played this turn) waits for the other Attacks. */
function waitsForAttacks(card: Card): boolean {
  return card.effects.some((e) => e.type === 'attackFrom' && e.extraHitsPer?.per === 'attacksPlayedBeforeThis');
}

/**
 * #265: Finisher is left out of `playable` while another Attack (one that doesn't wait itself) can be
 * played, so it is played last with every earlier Attack counted. Without one it is played like any attack.
 */
function withoutWaitingForAttacks(view: StrategyView): StrategyView {
  if (!view.playable.some(waitsForAttacks)) return view;
  const { energy } = view.state.player;
  const other = view.playable.some((c) => isAttackCard(c) && !waitsForAttacks(c) && xCostPlayable(c, energy));
  return other ? { ...view, playable: view.playable.filter((c) => !waitsForAttacks(c)) } : view;
}

/** The effects a card would run now: with a state, a `conditional` is replaced by the branch that holds (#111). */
function activeEffects(card: Card, state: State | undefined): DeepReadonly<Effect>[] {
  const out: DeepReadonly<Effect>[] = [];
  const walk = (effects: readonly DeepReadonly<Effect>[]) => {
    for (const e of effects) {
      if (e.type !== 'conditional') out.push(e);
      else if (state && conditionHolds(e.if, state, filterMatches, card.uid)) walk(e.then);
      else walk(e.else ?? []);
    }
  };
  walk(card.effects);
  return out;
}

/** #114: Cascade, an X-cost card that plays the top X cards of the draw pile. */
export function isCascade(card: Card): boolean {
  return !!card.xCost && card.effects.some((e) => e.type === 'playCards' && e.xTimes === true);
}

/** #114: Havoc, which plays the top card of the draw pile and exhausts it. Played early (Trent). */
export function isHavoc(card: Card): boolean {
  return card.effects.some(
    (e) => e.type === 'playCards' && e.from === 'draw' && e.mode === 'top' && e.exhaust === true,
  );
}

/**
 * #114: a support card: plays other cards from a pile (Catastrophe, Beat Down), gives Replay
 * (Hidden Gem) or copies a card (Dual Wield), without being an attack, Block or Power card.
 * The orchestrator's default, not a rule from Trent: played once the groups are done, with the
 * leftover energy, when it has something to act on.
 */
export function isSupportCard(card: Card): boolean {
  return (
    !isAttackCard(card) &&
    !isBlockCard(card) &&
    !isPowerCard(card) &&
    !isHavoc(card) &&
    card.effects.some(
      (e) => e.type === 'playCards' || e.type === 'addReplay' || (e.type === 'addCards' && e.source.kind === 'copyOf'),
    )
  );
}

const makesShiv = (e: DeepReadonly<Effect>): boolean =>
  e.type === 'addCards' && e.source.kind === 'card' && (e.source.cardId === 'shiv' || e.source.cardId === 'inky_shiv');

/**
 * #262: a card that only makes Shivs (Blade Dance, Up My Sleeve, Storm of Steel): it is in no group, since
 * it deals no damage and gains no Block itself. The orchestrator's default, not a rule from Trent.
 * #284: Blade Dance and Up My Sleeve are compared with the attacks by energy efficiency (pickShivMaker);
 * Storm of Steel (Discard your Hand) waits until nothing else is left to play (pickStorm).
 */
export function isShivMaker(card: Card): boolean {
  return (
    !isAttackCard(card) &&
    !isBlockCard(card) &&
    !isPowerCard(card) &&
    card.effects.some((e) => (e.type === 'repeat' ? e.effects : [e]).some(makesShiv))
  );
}

/** #262: Storm of Steel discards the whole hand. */
function isStorm(card: Card): boolean {
  return card.effects.some((e) => e.type === 'moveCards' && e.from === 'hand' && e.mode === 'all');
}

/**
 * #314: the Sly cards in the hand that `card`'s "discard N" (by choice) would discard now, in
 * chooseDiscard's order (a card that hurts in the hand goes first, so it may leave no room for them).
 */
function slyDiscardedBy(card: Card, view: StrategyView, config: StrategyConfig): Card[] {
  const e = card.effects.find(
    (x): x is Extract<Effect, { type: 'moveCards' }> =>
      x.type === 'moveCards' && x.from === 'hand' && x.to === 'discard' && x.mode === 'choose',
  );
  if (!e) return [];
  const options = view.state.player.hand.filter((c) => c.uid !== card.uid) as CardInstance[];
  if (options.length === 0 || !options.some((c) => c.keywords.includes('sly'))) return [];
  const max = Math.min(e.count ?? 1, options.length);
  const request: ChoiceRequest = { purpose: 'move', from: 'hand', to: 'discard', options, min: max, max };
  const picked = new Set(chooseDiscard(view, request, config).uids);
  return options.filter((c) => picked.has(c.uid) && c.keywords.includes('sly'));
}

/** #314: the Sly cards a stand-in card (withSlyEffects) discards, by stand-in. */
const SLY_PARTS = new WeakMap<Card, readonly Card[]>();

/**
 * #314 Sly (Trent, Nov 13 round 3): a card that discards from the hand is weighed with the free effect
 * of the Sly card(s) it would discard added to its own, the same way other plays are weighed: in the
 * view, the card stands in (same uid, in the hand and in `playable`) with the Sly cards' effects
 * appended (Survivor + Untouchable is a 14-Block card for 1; Survivor + Tactician gains 1 energy).
 */
function withSlyEffects(view: StrategyView, config: StrategyConfig): StrategyView {
  const swap = new Map<number, Card>();
  for (const c of view.playable) {
    const sly = slyDiscardedBy(c, view, config);
    if (sly.length === 0) continue;
    const stand: Card = { ...c, effects: [...c.effects, ...sly.flatMap((o) => o.effects)] };
    SLY_PARTS.set(stand, sly);
    swap.set(c.uid, stand);
  }
  if (swap.size === 0) return view;
  const sub = (c: Card) => swap.get(c.uid) ?? c;
  const player = { ...view.state.player, hand: view.state.player.hand.map(sub) };
  return { ...view, state: { ...view.state, player }, playable: view.playable.map(sub) };
}

/**
 * #314 Sly: a discard card played before the groups (cheapest first, ties to the lowest uid) when
 * - the Sly cards' energy pays for it (Survivor + Tactician: free Block) and another card in the hand
 *   wants energy, or
 * - a Sly card's free effect is worth its Energy cost (at least the discard card's cost) but no group weighs
 *   it: Poison when the #46 estimate says it pays off (Haze), a Power or other effect (Abrasive), or
 * - a Sly card draws (Reflex) and energy is left afterwards to play what it draws.
 * Otherwise the discard card is played in its group like any card, with the Sly effects counted (withSlyEffects).
 */
function pickSlyDiscarder(view: StrategyView): Card | undefined {
  const { hand, energy } = view.state.player;
  return best(
    view.playable.filter((c) => {
      const sly = SLY_PARTS.get(c);
      if (!sly || c.xCost) return false;
      const cost = c.cost ?? 0;
      const gain = energyGain(c, hand);
      const others = hand.filter((o) => o.uid !== c.uid && !sly.some((s) => s.uid === o.uid));
      if (sly.some((s) => energyGain(s) > 0) && gain >= cost && others.some(wantsEnergy)) return true;
      if (sly.some((s) => (s.cost ?? 0) >= cost && slyWorthOutsideGroups(s, view, energy - cost + gain))) return true;
      return sly.some(isDrawCard) && canDraw(view) && energy - cost + gain > 0;
    }),
    (c) => [-(c.cost ?? 0)],
  );
}

/** #284: a Shiv's damage (data/cards/colorless/shiv.json: 4, 6 upgraded). Buffs such as Accuracy (#267) would add here. */
const SHIV_DAMAGE = 4;
const SHIV_DAMAGE_UPGRADED = 6;

/**
 * #284: the damage of the Shivs a card makes (Storm of Steel excluded: its count is the hand it discards).
 * Counted in the card's damage-per-energy so Blade Dance (3 Shivs = 12 damage for 1) is compared with attacks.
 */
function shivDamageMade(card: Card): number {
  let sum = 0;
  for (const e of card.effects) {
    if (makesShiv(e) && e.type === 'addCards') sum += e.count * (e.upgraded ? SHIV_DAMAGE_UPGRADED : SHIV_DAMAGE);
  }
  return sum;
}

/** #284: damage per energy of a Shiv maker (Infinity at cost 0). */
function makerEfficiency(card: Card): number {
  const cost = card.cost ?? 0;
  return cost <= 0 ? Infinity : shivDamageMade(card) / cost;
}

/**
 * #284 (Trent): Shiv makers are compared with the costed attacks by energy efficiency (damage per energy,
 * counting the Shivs made). The best maker is played when it is at least as efficient as the best attack
 * (a tie goes to the maker: its Shivs are free). Shivs themselves are ordinary attacks in pickAttack.
 */
function pickShivMaker(view: StrategyView, atk: Card | undefined): Card | undefined {
  const maker = best(
    view.playable.filter((c) => isShivMaker(c) && !isStorm(c)),
    (c) => [makerEfficiency(c), -(c.cost ?? 0)],
  );
  if (!maker) return undefined;
  const costed = atk && (atk.xCost || (atk.cost ?? 0) > 0) ? atk : undefined;
  return !costed || makerEfficiency(maker) >= attackDamagePerEnergy(costed, view.state) ? maker : undefined;
}

/**
 * #262: Storm of Steel once nothing else is played, when another card is still in the hand to discard
 * (each discarded card becomes a Shiv).
 */
function pickStorm(view: StrategyView): Card | undefined {
  return best(
    view.playable.filter((c) => isShivMaker(c) && isStorm(c) && view.state.player.hand.some((o) => o.uid !== c.uid)),
    () => [],
  );
}

function pileOf(view: StrategyView, name: PileName): readonly Card[] {
  const p = view.state.player;
  return name === 'hand' ? p.hand : name === 'draw' ? p.drawPile : name === 'discard' ? p.discardPile : p.exhaustPile;
}

/** #114: true when one of the card's play / Replay / copy effects has a card to act on right now. */
function hasPlayTarget(view: StrategyView, card: Card): boolean {
  const others = (name: PileName, f?: DeepReadonly<CardFilter>) =>
    pileOf(view, name).filter((c) => c.uid !== card.uid && (!f || filterMatches(c, f)));
  return card.effects.some((e) => {
    if (e.type === 'playCards') {
      if (e.from === 'draw' && e.mode === 'top')
        return pileOf(view, 'draw').length + pileOf(view, 'discard').length > 0;
      return others(e.from, e.filter).some((c) => c.cost !== null && !c.keywords.includes('unplayable'));
    }
    if (e.type === 'addReplay') return others(e.from, e.filter).length > 0;
    if (e.type === 'addCards' && e.source.kind === 'copyOf') return others(e.source.from, e.source.filter).length > 0;
    return false;
  });
}

/** #114: the view without Havoc, Cascade and support cards that have no card to act on (nothing to play, copy or give Replay). */
function withoutIdle(view: StrategyView): StrategyView {
  const idle = (c: Card) => (isHavoc(c) || isCascade(c) || isSupportCard(c)) && !hasPlayTarget(view, c);
  if (!view.playable.some(idle)) return view;
  return { ...view, playable: view.playable.filter((c) => !idle(c)) };
}

/**
 * #169 (Trent): Enlightenment, a 0-cost card that sets the cost of the cards in hand. Always played, early
 * (the only exception would be a cost to playing cards, e.g. Tainted, not in v1).
 */
export function isEnlightenment(card: Card): boolean {
  return !card.xCost && card.cost === 0 && card.effects.some((e) => e.type === 'setCost' && e.piles.includes('hand'));
}

/** Havoc, when affordable and the draw pile or discard pile has a card (played early, Trent #114 Q2). */
function pickHavoc(view: StrategyView): Card | undefined {
  return best(view.playable.filter(isHavoc), () => []);
}

/** #114: the support card to play with leftover energy: the cheapest, ties to the lowest uid. */
function pickSupport(view: StrategyView): Card | undefined {
  return best(view.playable.filter(isSupportCard), (c) => [-(c.cost ?? 0)]);
}

function appliesVulnerable(card: Card): boolean {
  return card.effects.some((e) => e.type === 'applyVulnerable');
}

/**
 * Total base damage (damage × hits), including the card's own damage bonus (Thrash, #108).
 * For X-cost cards, X is `energy` (all of it gets spent).
 */
export function totalBaseDamage(card: Card, energy: number, state?: State): number {
  const x = card.xCost ? energy : 0;
  let sum = 0;
  for (const e of activeEffects(card, state)) {
    if (e.type === 'attack') sum += (e.damage + (card.damageBonus ?? 0)) * attackHits(e, x);
    // #111: scaling attacks count what they would deal now (the base alone without a state).
    else if (e.type === 'attackFrom') {
      // #314 Precise Cut: the floor at 0 comes after Strength (max(0, base + Strength − penalty)); the value
      // stays without Strength (callers add Strength × hits), so it can be −Strength at worst.
      const str = state?.player.strength ?? 0;
      const raw = e.damage + (card.damageBonus ?? 0) + (state ? perCounterValue(e.bonusPer, state) : 0);
      const per = Math.max(0, raw + str) - str;
      sum += per * (e.hits + (state ? perCounterValue(e.extraHitsPer, state) : 0));
    } else if (e.type === 'script' && e.id === 'perfectedStrike') {
      const [base = 0, per = 0] = e.values ?? [];
      sum += base + (card.damageBonus ?? 0) + (state ? per * countStrikes(state.player) : 0);
    }
  }
  return sum;
}

/** #213: hits an attack card makes (X-cost: X = `energy`), for stripping Slippery stacks. */
function attackHitCount(card: Card, energy: number): number {
  const x = card.xCost ? energy : 0;
  let hits = 0;
  for (const e of card.effects) {
    if (e.type === 'attack') hits += attackHits(e, x);
    else if (e.type === 'attackFrom') hits += e.hits;
  }
  return hits;
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

/**
 * #106: HP the card makes you lose when played (sum of its `loseHp` effects). #109: a Crimson
 * Mantle power counts its 1 HP per turn, so it is never played at 1 HP.
 */
export function selfDamage(card: Card): number {
  let sum = 0;
  for (const e of card.effects) {
    if (e.type === 'loseHp') sum += e.amount;
    if (e.type === 'applyPower' && e.power === 'crimsonMantle') sum += 1;
  }
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

/** Cards a strategy never plays: Mad Science (Improvement) does nothing within one combat (#135 Q7). */
const NEVER_PLAYED_CARD_IDS: readonly string[] = ['mad_science_improvement'];

/** The view with the never-played cards removed from `playable`. */
function withoutNeverPlayed(view: StrategyView): StrategyView {
  if (!view.playable.some((c) => NEVER_PLAYED_CARD_IDS.includes(c.cardId))) return view;
  return { ...view, playable: view.playable.filter((c) => !NEVER_PLAYED_CARD_IDS.includes(c.cardId)) };
}

/** 1 for a card that draws: draw cards win ties against cards that don't (#107). */
const draws = (c: Card): number => (isDrawCard(c) ? 1 : 0);

function totalBlock(card: Card, state?: State): number {
  let sum = 0;
  for (const e of card.effects) {
    if (e.type === 'gainBlock') sum += e.amount;
    // #111: Stack, Expect a Fight and Entrench count what they would give now (their base alone without a state).
    else if (e.type === 'gainBlockFrom' && e.bonusPer.per !== 'lastAttackDamage') {
      sum += Math.max(0, e.amount + (state ? perCounterValue(e.bonusPer, state) : 0));
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------
// #108 Exhaust. Self-contained helpers: the exhaust choice (every strategy), and where Brand /
// Burning Pact / Purity (early) and Second Wind / Fiend Fire (last) go in a turn.
// ---------------------------------------------------------------------------

/** #108: a card that benefits from being exhausted (has a "when exhausted" trigger: Drum of Battle). */
export function benefitsFromExhaust(card: Card): boolean {
  return (card.triggers ?? []).some((t) => t.when === 'exhausted');
}

/** #170: a card that plays itself from the Exhaust pile at turn end (Howl from Beyond) also benefits from exhaust. */
function hasTurnEndInExhaust(card: Card): boolean {
  return (card.triggers ?? []).some((t) => t.when === 'turnEndInExhaust');
}

/** The effects a curse or status has on its own or from a trigger other than "when exhausted", nested ones included. */
function junkEffects(card: Card): DeepReadonly<Effect>[] {
  const out: DeepReadonly<Effect>[] = [];
  const walk = (effects: readonly DeepReadonly<Effect>[]) => {
    for (const e of effects) {
      out.push(e);
      if (e.type === 'repeat') walk(e.effects);
      else if (e.type === 'schedule') walk(e.effects);
      else if (e.type === 'conditional') walk([...e.then, ...(e.else ?? [])]);
    }
  };
  walk(card.effects);
  for (const t of card.triggers ?? []) if (t.when !== 'exhausted') walk(t.effects);
  return out;
}

/** #139 class "deals direct HP damage": a curse or status whose effect makes you lose HP (`loseHp`). */
export function dealsDirectHpDamage(card: Card): boolean {
  return isJunk(card) && junkEffects(card).some((e) => e.type === 'loseHp');
}

/**
 * #139 class "flat, blockable damage": a curse or status whose effect deals damage that Block
 * absorbs (`attack` or `dealDamage`). No curse or status in the data has such an effect yet.
 */
export function dealsBlockableDamage(card: Card): boolean {
  return isJunk(card) && junkEffects(card).some((e) => e.type === 'attack' || e.type === 'dealDamage');
}

function isJunk(card: Card): boolean {
  return card.type === 'curse' || card.type === 'status';
}

const isEthereal = (card: Card): boolean => card.keywords.includes('ethereal');

/** The group a card is played from: the highest-priority group of the strategy it belongs to, or null. */
function groupOf(card: Card, config: StrategyConfig): StrategyGroup | null {
  for (const g of config.order) {
    if (g === 'attack' ? isAttackCard(card) : g === 'block' ? isBlockCard(card) : isPowerCard(card)) return g;
  }
  return null;
}

/**
 * #139: the base card of the strategy's lower-priority group, 'strike' (Attack) or 'defend'
 * (Block): the group that comes later in the strategy's order is the lower priority one.
 */
export function lowerPriorityBase(config: StrategyConfig): 'strike' | 'defend' {
  return config.order.indexOf('attack') > config.order.indexOf('block') ? 'strike' : 'defend';
}

/**
 * #139 exhaust tier (Trent, #108 final order), lower goes first, for every strategy:
 * 1 curse/status that makes you lose HP, 2 exhaust-benefit cards (Drum of Battle, Howl from Beyond), 3 curse/status
 * with flat blockable damage, 4 other non-Ethereal curse/status, 5 non-upgraded Strike or Defend
 * of the lower-priority group, 6 the other non-upgraded one, 6.5 a draw-only card costing 1+ while
 * the draw cards are exhaustible (#144, see TallyConfig), 7 Ethereal curse/status, 8 anything
 * else (the cards that won't be played; see exhaustOrder).
 */
export function exhaustTier(card: Card, config: StrategyConfig = GREEDY_CONFIG): number {
  if (dealsDirectHpDamage(card)) return 1;
  if (benefitsFromExhaust(card) || hasTurnEndInExhaust(card)) return 2;
  if (dealsBlockableDamage(card)) return 3;
  if (isJunk(card)) return isEthereal(card) ? 7 : 4;
  if (!card.upgraded && (card.cardId === 'strike' || card.cardId === 'defend')) {
    return card.cardId === lowerPriorityBase(config) ? 5 : 6;
  }
  if (drawCardExhaustible(card, config)) return DRAW_TIER;
  return 8;
}

/** #144: the exhaust tier of a draw-only card costing 1+ while draw cards are exhaustible: right after Strikes and Defends. */
const DRAW_TIER = 6.5;

/** #144: draw cards are exhaustible once at least this share of the turns so far this combat ended with 0 energy. */
export const DRAW_EXHAUST_ZERO_ENERGY_SHARE = 0.8;

/**
 * #144 (Trent): the strategy's config plus what it has seen this combat. `drawExhaustible` is true
 * when at least DRAW_EXHAUST_ZERO_ENERGY_SHARE of the turns so far ended with 0 energy (so every
 * point of energy goes to cards, and a draw card that costs energy is worth less than a Strike).
 * createStrategy sets it per decision; a plain StrategyConfig means false.
 */
export interface TallyConfig extends StrategyConfig {
  drawExhaustible?: boolean;
}

/** #144: true when `config` says draw cards are exhaustible (see TallyConfig). */
function drawsExhaustible(config: StrategyConfig | undefined): boolean {
  return !!(config as TallyConfig | undefined)?.drawExhaustible;
}

/** #144: a card that only draws: every effect is a draw (or Battle Trance's no-more-draws power). Burning Pact exhausts too, so it is not. */
export function isDrawOnly(card: Card): boolean {
  return (
    isDrawCard(card) &&
    card.effects.every(
      (e) => e.type === 'draw' || e.type === 'drawUntil' || (e.type === 'applyPower' && e.power === 'noDraw'),
    )
  );
}

/**
 * #144: a draw-only card costing 1+ energy, while the draw cards are
 * exhaustible. A 0-cost one (and any, otherwise) is never exhausted: its draw counts in the deck floor.
 */
function drawCardExhaustible(card: Card, config: StrategyConfig | undefined): boolean {
  return drawsExhaustible(config) && isDrawOnly(card) && !card.xCost && (card.cost ?? 0) >= 1;
}

/** `hand` with `card` removed, as a view (for planning the turn without it). */
function withoutCards(view: StrategyView, cards: readonly Card[]): StrategyView {
  const hand = view.state.player.hand.filter((c) => !cards.some((x) => x.uid === c.uid));
  const state = { ...view.state, player: { ...view.state.player, hand } };
  return { ...view, state, playable: view.playable.filter((c) => hand.some((h) => h === c)) };
}

/** Energy left after playing `played` from `energy` (X-cost cards spend all of it). */
function energyAfter(played: readonly Card[], energy: number, hand: readonly Card[] = []): number {
  let e = energy;
  for (const c of played) {
    e -= c.xCost ? e : (c.cost ?? 0);
    e += energyGain(c, hand);
  }
  return e;
}

/**
 * #139 Ethereal exception: true when exhausting `base` (the next Strike or Defend) would leave
 * energy unused this turn, i.e. the turn planned without it spends less than the turn planned with it.
 */
function leavesEnergyUnused(view: StrategyView, config: StrategyConfig, base: Card): boolean {
  const energy = view.state.player.energy;
  const withIt = energyAfter(planTurn(view, config, energy), energy, view.state.player.hand);
  const without = energyAfter(planTurn(withoutCards(view, [base]), config, energy), energy, view.state.player.hand);
  return without > withIt;
}

/**
 * Exhaust sort key for tier 8: draw-only cards last (#144: never exhausted unless forced), then
 * planned cards, upgraded Strike/Defend first, lowest group first, uid.
 */
function tier8Key(card: Card, config: StrategyConfig, planned: ReadonlySet<number>): number[] {
  const g = groupOf(card, config);
  const lowFirst = g === null ? -1 : -config.order.indexOf(g);
  const basic = card.cardId === 'strike' || card.cardId === 'defend';
  return [isDrawOnly(card) ? 1 : 0, planned.has(card.uid) ? 1 : 0, basic ? 0 : 1, lowFirst, card.uid];
}

/**
 * #139: `cards` in the order to exhaust them (first = exhausted first). `view` is the state at
 * the choice: the hand is `cards` and the exhausting card is already played. Tiers 1–7 as in
 * exhaustTier, with Ethereal junk moved above tiers 5–6 when exhausting the next Strike/Defend
 * would leave energy unused. Tier 8 cards the turn plan (planTurn, without the exhausting card)
 * does not play come first.
 */
export function exhaustOrder(
  cards: readonly Card[],
  view?: StrategyView,
  config: StrategyConfig = GREEDY_CONFIG,
): Card[] {
  const rest = [...cards].sort((a, b) => a.uid - b.uid);
  const out: Card[] = [];
  let planned: ReadonlySet<number> | undefined;
  const plannedSet = (): ReadonlySet<number> => {
    if (!planned) {
      // Second Wind and Fiend Fire are played last, so they count as played.
      const plan = view ? planTurn(withoutCards(view, out), config, view.state.player.energy) : [];
      planned = new Set([...plan, ...rest.filter(playsLast)].map((c) => c.uid));
    }
    return planned;
  };
  while (rest.length > 0) {
    const tierOf = (c: Card) => exhaustTier(c, config);
    const lowest = Math.min(...rest.map(tierOf));
    let pickTier = lowest;
    // Ethereal junk jumps ahead of a Strike/Defend that would still be played.
    if ((lowest === 5 || lowest === 6) && view && rest.some((c) => tierOf(c) === 7)) {
      const next = rest.find((c) => tierOf(c) === lowest)!;
      if (leavesEnergyUnused(withoutCards(view, out), config, next)) pickTier = 7;
    }
    let next: Card;
    if (pickTier === 8) {
      const set = plannedSet();
      next = rest
        .filter((c) => tierOf(c) === 8)
        .sort((a, b) => cmp(tier8Key(a, config, set), tier8Key(b, config, set)))[0]!;
    } else {
      next = rest.find((c) => tierOf(c) === pickTier)!;
    }
    out.push(next);
    rest.splice(rest.indexOf(next), 1);
    planned = undefined;
  }
  return out;
}

function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** #108: a card worth spending an exhaust effect on: any junk, Drum of Battle, or a non-upgraded Strike or Defend (tiers 1–7). */
export function worthExhausting(card: Card, config: StrategyConfig = GREEDY_CONFIG): boolean {
  return exhaustTier(card, config) <= 7;
}

/**
 * #139 / #141 Q3d: Purity's order: the regular exhaust order (exhaustOrder, with its Ethereal
 * exception), limited to tiers 1–7: never upgraded Strikes/Defends or other cards (tier 8).
 */
function purityOrder(cards: readonly Card[], config: StrategyConfig, view?: StrategyView): Card[] {
  return exhaustOrder(
    cards.filter((c) => exhaustTier(c, config) <= 7),
    view,
    config,
  );
}

/**
 * #108 Strategy.choose for exhaust picks, shared by every strategy. A fixed count ("Exhaust 1
 * card") takes the first cards in the exhaust order. "Up to N" (Purity, #139) takes cards of
 * tiers 1–7 in the same order (#141 Q3d), up to N, and nothing else.
 * #141: both skip every card whose removal would break the deck-health guard (see below).
 * `played` is the card whose effect asks (already out of the hand): it is still in the active deck
 * unless it leaves (Exhaust keyword, Power, Corruption). Without it, it counts as gone.
 */
export function chooseExhaust(
  view: StrategyView,
  request: ChoiceRequest,
  config: StrategyConfig = GREEDY_CONFIG,
  played?: Card,
): ChoiceResponse {
  // #114: copying a card (Dual Wield) or giving it Replay takes the best cards first, not the worst.
  if (request.purpose === 'copy' || request.purpose === 'replay') {
    const worth = (c: Card) => (isPowerCard(c) ? powerValue(c) : cardValue(c));
    const ranked = [...request.options].sort((a, b) => worth(b) - worth(a) || a.uid - b.uid);
    return { uids: ranked.slice(0, request.max).map((c) => c.uid) };
  }
  const upTo = request.max > request.min;
  const ordered = upTo ? purityOrder(request.options, config, view) : exhaustOrder(request.options, view, config);
  const picked =
    request.purpose === 'exhaust'
      ? guardedPicks(deckWhilePlaying(view.state, played), ordered, request.max, config)
      : ordered.slice(0, request.max);
  if (picked.length < request.min) {
    for (const c of exhaustOrder(request.options, view, config)) {
      if (picked.length >= request.min) break;
      if (!picked.includes(c)) picked.push(c);
    }
  }
  return { uids: picked.map((c) => c.uid) };
}

/** #259: a card that loses HP or deals damage while it stays in the hand (discarded before Sly cards). */
function hurtsInHand(c: Card): boolean {
  return dealsDirectHpDamage(c) || dealsBlockableDamage(c);
}

/**
 * #266 Strategy.choose for "discard N from the hand" (Tools of the Trade; #259 Trent): the shared exhaust
 * order, except that Sly cards go ahead of curses and statuses, but not ahead of those that hurt if kept
 * (they lose HP or deal damage while in the hand). Always exactly the requested number.
 */
export function chooseDiscard(
  view: StrategyView,
  request: ChoiceRequest,
  config: StrategyConfig = GREEDY_CONFIG,
): ChoiceResponse {
  const ordered = exhaustOrder(request.options, view, config);
  const hurts = hurtsInHand;
  const sly = (c: Card) => c.keywords.includes('sly') && !hurts(c);
  const ranked = [...ordered.filter(hurts), ...ordered.filter(sly), ...ordered.filter((c) => !hurts(c) && !sly(c))];
  return { uids: ranked.slice(0, request.max).map((c) => c.uid) };
}

// ---------------------------------------------------------------------------
// #141 Deck-health guard (Trent): exhausting must not thin the deck too far.
// ---------------------------------------------------------------------------

/** #141: the active deck never drops below this many cards (plus its extra draw, see deckFloor) through an exhaust. */
export const MIN_ACTIVE_DECK = 5;

/** #141: the active deck keeps at least 1 damaging card per this many cards (rounded up). */
export const DECK_CARDS_PER_DAMAGING = 5;

/** #141 (Trent, 2026-11-09): the active deck always keeps at least this many damaging cards. */
export const MIN_DAMAGING = 2;

/** #141: extra draw counted for "draw until the hand is full" (a 10-card hand after the 5-card draw). */
export const DRAW_UNTIL_FULL_EXTRA = 5;

/** #141: ids of `script` effects that deal damage to the enemy (Fiend Fire; Thrash also has an `attack`). */
const DAMAGING_SCRIPT_IDS: readonly string[] = ['fiendFire', 'thrash', 'perfectedStrike'];

/** Every effect of the card on its own, nested ones (repeat, schedule, conditional) included. */
function allEffects(card: Card): DeepReadonly<Effect>[] {
  const out: DeepReadonly<Effect>[] = [];
  const walk = (effects: readonly DeepReadonly<Effect>[]) => {
    for (const e of effects) {
      out.push(e);
      if (e.type === 'repeat' || e.type === 'schedule') walk(e.effects);
      else if (e.type === 'conditional') walk([...e.then, ...(e.else ?? [])]);
    }
  };
  walk(card.effects);
  return out;
}

/**
 * #141: a damaging card is one whose effects deal damage to the enemy: an `attack`, `dealDamage`,
 * `enemyLoseHp` or `applyPoison` effect (nested ones too), or a damaging `script` (Fiend Fire,
 * Thrash). Curses, statuses and Unplayable cards never count: they can't be played to deal it.
 */
export function dealsDamageToEnemy(card: Card): boolean {
  if (isJunk(card) || card.keywords.includes('unplayable')) return false;
  return allEffects(card).some(
    (e) =>
      e.type === 'attack' ||
      e.type === 'attackFrom' ||
      e.type === 'dealDamage' ||
      e.type === 'enemyLoseHp' ||
      e.type === 'applyPoison' ||
      (e.type === 'script' && DAMAGING_SCRIPT_IDS.includes(e.id)),
  );
}

/** #141: the active deck is hand + draw pile + discard pile (played Powers and exhausted cards are out). */
export function activeDeck(state: StrategyView['state']): Card[] {
  const p = state.player;
  return [...p.hand, ...p.drawPile, ...p.discardPile];
}

/** #147: a "draw until" estimate needs at least this chance (4:1) that the next card keeps the draw going. */
export const DRAW_UNTIL_MIN_CHANCE = 0.8;

/** #147: the most cards a hand holds; a "draw until" estimate never draws past it. */
export const MAX_HAND_SIZE = 10;

/** #147: true when drawing `card` does not stop a "draw until" with this `stopOn` (an Attack for Pillage). */
function keepsDrawing(card: Card, stopOn: DeepReadonly<CardFilter> | undefined): boolean {
  if (!stopOn) return true;
  if (stopOn.types && stopOn.types.includes(card.type)) return false;
  if (stopOn.notTypes && !stopOn.notTypes.includes(card.type)) return false;
  return true;
}

/**
 * #147 (Trent, option C): the estimated draw of a "draw until a card matches `stopOn`" (Pillage),
 * with `pile` standing in for the draw pile. It draws at least 1. Step through the pile one card at
 * a time: while the chance that the next card keeps the draw going is at least 80%, add 1; stop at
 * the first step below. Capped at 10 − `handAfter` (the hand size after the card is played).
 * 4 Strikes + 1 Defend: 4/5 = 80% (+1), then 3/4 = 75% (stop) → 2.
 */
export function drawUntilEstimate(
  pile: readonly Card[],
  stopOn: DeepReadonly<CardFilter> | undefined,
  handAfter: number,
): number {
  let going = pile.filter((c) => keepsDrawing(c, stopOn)).length;
  let left = pile.length;
  let n = 1;
  while (left > 0 && going / left >= DRAW_UNTIL_MIN_CHANCE) {
    n++;
    going--;
    left--;
  }
  return Math.max(0, Math.min(n, MAX_HAND_SIZE - handAfter));
}

/**
 * #141: the extra cards a card draws when played, from its effects (nested ones counted once):
 * `draw` N counts N; `drawUntil` counts DRAW_UNTIL_FULL_EXTRA when it fills the hand, else the
 * drawUntilEstimate (Pillage, #147) with the rest of `deck` as the draw pile and a hand of 4 after
 * it (the 5-card draw, minus the card). #147: a card that exhausts (Scrawl) adds nothing: it draws
 * once and is gone. Pommel Strike = 1, Burning Pact = 2, Battle Trance = 3.
 */
export function extraDraw(card: Card, deck: readonly Card[] = []): number {
  if (card.keywords.includes('exhaust')) return 0;
  let n = 0;
  for (const e of allEffects(card)) {
    if (e.type === 'draw') n += e.amount;
    else if (e.type === 'drawUntil') {
      if (e.handFull) n += DRAW_UNTIL_FULL_EXTRA;
      else {
        const pile = deck.filter((c) => c.uid !== card.uid);
        n += drawUntilEstimate(pile, e.stopOn, MIN_ACTIVE_DECK - 1);
      }
    }
  }
  return n;
}

/** #141 (Trent, 2026-11-09): the deck floor, the most cards drawn in a turn: 5 + the extra draw of every card in the deck. */
export function deckFloor(deck: readonly Card[], config?: StrategyConfig): number {
  // #144: a draw card that is exhaustible is expected to go, so its draw is not counted; otherwise it is.
  return deck.reduce((sum, c) => sum + (drawCardExhaustible(c, config) ? 0 : extraDraw(c, deck)), MIN_ACTIVE_DECK);
}

/** #141: damaging cards an active deck of this size needs: max(2, ceil(size / 5)). */
export function damagingNeeded(size: number): number {
  return Math.max(MIN_DAMAGING, Math.ceil(size / DECK_CARDS_PER_DAMAGING));
}

/**
 * #141: true when an active deck is healthy: at least deckFloor cards, and at least
 * max(2, ceil(size / 5)) damaging cards.
 */
export function deckHealthy(deck: readonly Card[], config?: StrategyConfig): boolean {
  if (deck.length < deckFloor(deck, config)) return false;
  return deck.filter(dealsDamageToEnemy).length >= damagingNeeded(deck.length);
}

/**
 * #141 (Trent): damage per energy, for choosing which damaging card to exhaust (lower goes first).
 * Damage is the card's base damage to the enemy: attack damage × hits (+ its damage bonus), plus
 * dealDamage, enemyLoseHp and Poison amounts, plus a damaging script's first value (Fiend Fire per
 * card). X-cost cards count X = 1 (damage per energy spent). A 0-cost card (not X) is Infinity:
 * it is free damage, so it is kept longest. Ignores Strength, Vulnerable and the like.
 */
export function damagePerEnergy(card: Card): number {
  let dmg = 0;
  for (const e of allEffects(card)) {
    if (e.type === 'attack') dmg += (e.damage + (card.damageBonus ?? 0)) * attackHits(e, 1);
    else if (e.type === 'attackFrom') dmg += (e.damage + (card.damageBonus ?? 0)) * e.hits;
    else if (e.type === 'dealDamage' || e.type === 'enemyLoseHp' || e.type === 'applyPoison') dmg += e.amount;
    else if (e.type === 'script' && DAMAGING_SCRIPT_IDS.includes(e.id)) dmg += e.values?.[0] ?? 0;
  }
  if (card.xCost) return dmg;
  const cost = card.cost ?? 0;
  return cost <= 0 ? Infinity : dmg / cost;
}

/** `deck` without `removed` (by uid). */
function without(deck: readonly Card[], removed: readonly Card[]): Card[] {
  const gone = new Set(removed.map((c) => c.uid));
  return deck.filter((c) => !gone.has(c.uid));
}

/** #141: a played card leaves the active deck for good: a Power, an Exhaust card, or a Skill under Corruption. */
function leavesActiveDeck(card: Card, state: StrategyView['state']): boolean {
  return (
    card.type === 'power' ||
    card.keywords.includes('exhaust') ||
    (card.type === 'skill' && !!state.player.powers?.corruption)
  );
}

/** #141: the active deck while `played` resolves (it is out of the hand; it stays unless it leaves, and unknown counts as gone). */
function deckWhilePlaying(state: StrategyView['state'], played?: Card): Card[] {
  const deck = activeDeck(state);
  if (played && !leavesActiveDeck(played, state)) deck.push(played);
  return deck;
}

/**
 * #141: up to `max` cards of `ordered`, in order, each taken only when the deck stays healthy
 * with it (and the ones before it) removed. A card that would break the guard is skipped.
 * Damage per energy (Trent): when the next pick is a damaging card and it is the last damaging
 * card the guard lets go, the damaging card of `ordered` with the lowest damage per energy goes
 * instead (ties: the one earlier in the order), so the best damage stays. With only Bash (4 per
 * energy) and a Strike (6) to choose from, Bash goes before the last Strike.
 */
function guardedPicks(deck: readonly Card[], ordered: readonly Card[], max: number, config?: StrategyConfig): Card[] {
  const picked: Card[] = [];
  const keeps = (cs: readonly Card[]) => deckHealthy(without(deck, [...picked, ...cs]), config);
  for (const c of ordered) {
    if (picked.length >= max) break;
    if (picked.includes(c) || !keeps([c])) continue;
    let pick = c;
    if (dealsDamageToEnemy(c)) {
      const damaging = ordered.filter((d) => dealsDamageToEnemy(d) && !picked.includes(d));
      const last = !damaging.some((d) => d !== c && keeps([c, d]));
      if (last) {
        for (const d of damaging) {
          if (damagePerEnergy(d) < damagePerEnergy(pick) && keeps([d])) pick = d;
        }
      }
    }
    picked.push(pick);
  }
  return picked;
}

/** The effects of a card that exhaust cards: `exhaustCards`, Fiend Fire and Thrash. */
function exhaustSources(card: Card): DeepReadonly<Effect>[] {
  return allEffects(card).filter(
    (e) => e.type === 'exhaustCards' || (e.type === 'script' && (e.id === 'fiendFire' || e.id === 'thrash')),
  );
}

function filterMatches(card: Card, f: DeepReadonly<CardFilter>): boolean {
  if (f.types && !f.types.includes(card.type)) return false;
  if (f.notTypes?.includes(card.type)) return false;
  if (f.cardId !== undefined && card.cardId !== f.cardId) return false;
  if (f.upgraded !== undefined && card.upgraded !== f.upgraded) return false;
  if (f.noReplay && (card.replay ?? 0) > 0) return false;
  return true;
}

/** #303 Slow: +10% per card already played this turn when the current enemy has Slow (else 0). */
function slowPercentOf(state: {
  enemy: { powers?: { slow?: number } };
  counters?: { cardsPlayedThisTurn: number };
}): number {
  return (state.enemy.powers?.slow ?? 0) > 0 ? (state.counters?.cardsPlayedThisTurn ?? 0) * 10 : 0;
}

/** #141 existing kill checks: Fiend Fire's (fiendFireKills), or the card's own attack damage covering HP + Block. */
function playKillsEnemy(view: StrategyView, card: Card): boolean {
  if (isFiendFire(card)) return fiendFireKills(view, card);
  const { player, enemy } = view.state;
  const x = card.xCost ? player.energy : 0;
  const vigor = card.type === 'attack' ? (player.powers?.vigor ?? 0) : 0;
  let dmg = 0;
  for (const e of card.effects) {
    if (e.type !== 'attack') continue;
    const base = e.damage + (card.damageBonus ?? 0) + vigor;
    const perHit = attackDamage(
      base,
      player.strength,
      player.debuffs.weak,
      enemy.debuffs.vulnerable,
      player.powers?.cruelty ?? 0,
      player.shrink ?? 0,
      0,
      (player.powers?.tracking ?? 0) > 0 && enemy.debuffs.weak > 0,
      1,
      slowPercentOf(view.state),
    );
    dmg += perHit * attackHits(e, x);
  }
  return dmg > 0 && dmg >= enemy.hp + enemy.block;
}

/**
 * #141 worst case of a random exhaust of `n` of `candidates`, for the damaging-card count:
 * damaging cards go first (as many as there are), then the rest.
 */
function worstCaseRandom(candidates: readonly Card[], n: number): Card[] {
  const damaging = candidates.filter(dealsDamageToEnemy);
  const other = candidates.filter((c) => !dealsDamageToEnemy(c));
  return [...damaging, ...other].slice(0, n);
}

/**
 * #141 worst case of a random exhaust of `n` of `candidates`, for the deck floor: the cards with
 * the least extra draw go (so the floor drops least).
 */
function worstCaseRandomForFloor(candidates: readonly Card[], n: number, config?: StrategyConfig): Card[] {
  const draw = (c: Card) => (drawCardExhaustible(c, config) ? 0 : extraDraw(c));
  return [...candidates].sort((a, b) => draw(a) - draw(b)).slice(0, n);
}

/**
 * #141: false when playing `card` could leave the deck unhealthy (see deckHealthy), so the
 * strategy doesn't play it. Only cards that exhaust are held back; everything else is allowed.
 * - a kill is the exception: the card (Fiend Fire, an attack like Cinder) would end the combat;
 * - choice exhausts (Burning Pact, Brand, Purity, True Grit+): it needs a guard-keeping pick, in
 *   the exhaust order (Purity, "up to N": at least one, it may take fewer; Brand / Burning Pact /
 *   Purity only when a pick is worth exhausting, as before);
 * - forced and random exhausts (Fiend Fire, Second Wind, Cinder, True Grit, Thrash): the result
 *   must be healthy, with random picks counted at their worst case.
 * The card itself leaves the deck if it exhausts (Fiend Fire, Brand, Purity).
 */
export function exhaustKeepsDeckHealthy(view: StrategyView, card: Card, config: StrategyConfig): boolean {
  const sources = exhaustSources(card);
  if (sources.length === 0 || playKillsEnemy(view, card)) return true;
  const rest = withoutCards(view, [card]);
  const player = rest.state.player;
  const removed: Card[] = [];
  let deck = deckWhilePlaying(rest.state, card);
  const piles: Record<PileName, readonly Card[]> = {
    hand: player.hand,
    draw: player.drawPile,
    discard: player.discardPile,
    exhaust: [],
  };
  for (const e of sources) {
    let gone: Card[];
    // Random exhausts: also the worst case for the floor, which must be healthy too.
    const randomFloorOk = (candidates: readonly Card[], n: number) =>
      n === 0 || deckHealthy(without(deck, worstCaseRandomForFloor(candidates, n, config)), config);
    if (e.type === 'script') {
      const hand = without(piles.hand, removed);
      if (e.id === 'fiendFire') gone = hand;
      else {
        const attacks = hand.filter((c) => c.type === 'attack');
        if (!randomFloorOk(attacks, Math.min(1, attacks.length))) return false;
        gone = worstCaseRandom(attacks, 1);
      }
    } else if (e.type === 'exhaustCards') {
      const candidates = without(piles[e.from ?? 'hand'], removed).filter(
        (c) => !e.filter || filterMatches(c, e.filter),
      );
      const n = Math.min(e.count ?? candidates.length, candidates.length);
      if (n === 0) continue;
      if (e.mode === 'all') gone = candidates;
      else if (e.mode === 'random') {
        if (!randomFloorOk(candidates, n)) return false;
        gone = worstCaseRandom(candidates, n);
      } else if (e.mode === 'top') gone = candidates.slice(candidates.length - n);
      else {
        const ordered = e.upTo ? purityOrder(candidates, config, rest) : exhaustOrder(candidates, rest, config);
        gone = guardedPicks(deck, ordered, n, config);
        if (gone.length < (e.upTo ? 1 : n)) return false;
        if (isExhaustEnabler(card) && !gone.some((c) => worthExhausting(c, config))) return false;
      }
    } else {
      continue;
    }
    removed.push(...gone);
    deck = without(deck, gone);
    if (gone.length > 0 && !deckHealthy(deck, config)) return false;
  }
  return true;
}

/** #141: the view with every exhaust card that could break the deck-health guard removed from `playable`. */
function withoutGuardBroken(view: StrategyView, config: StrategyConfig): StrategyView {
  if (!view.playable.some((c) => exhaustSources(c).length > 0)) return view;
  const playable = view.playable.filter((c) => exhaustKeepsDeckHealthy(view, c, config));
  return playable.length === view.playable.length ? view : { ...view, playable };
}

/**
 * #108: rough worth of a card, used for Power cards (powerValue). Sum of its
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
  const cruelty = player.powers?.cruelty ?? 0;
  const perHit = attackDamage(
    fiendFirePerCard(card),
    player.strength,
    player.debuffs.weak,
    enemy.debuffs.vulnerable,
    cruelty,
    player.shrink ?? 0,
    0,
    (player.powers?.tracking ?? 0) > 0 && enemy.debuffs.weak > 0,
    1,
    slowPercentOf(view.state),
  );
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
    const a = pickAttack(affordable, energy, view.state.enemy.debuffs.vulnerable);
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
export function pickExhaustEnabler(view: StrategyView, config: StrategyConfig = GREEDY_CONFIG): Card | undefined {
  const worth = (card: Card) => view.state.player.hand.some((c) => c.uid !== card.uid && worthExhausting(c, config));
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
 * #147: an attack's base damage per energy for play order: an X-cost attack counts its damage for
 * X = 1, a 0-cost attack is Infinity (it is free), others total base damage / cost.
 */
function attackDamagePerEnergy(card: Card, state?: State): number {
  if (card.xCost) return totalBaseDamage(card, 1, state);
  const cost = card.cost ?? 0;
  // #284: an attack that makes Shivs (Leading Strike) counts their damage too.
  return cost <= 0 ? Infinity : (totalBaseDamage(card, 0, state) + shivDamageMade(card)) / cost;
}

/**
 * #11 (Trent): a Vulnerable-applier goes before other attacks only when the enemy has no
 * Vulnerable and the energy covers it plus the cheapest other attack (an X-cost one needs 1);
 * otherwise attacks are ranked by damage as usual (the estimate-based version is #149).
 */
function vulnerableFirst(card: Card, attacks: readonly Card[], energy: number, enemyVulnerable: number): boolean {
  if (enemyVulnerable > 0 || card.xCost) return false;
  const others = attacks.filter((c) => c.uid !== card.uid).map((c) => (c.xCost ? 1 : (c.cost ?? 0)));
  return others.length > 0 && (card.cost ?? 0) + Math.min(...others) <= energy;
}

/**
 * Best attack to play: Vulnerable-appliers first (only under vulnerableFirst, #11), then highest total base damage
 * (damage × hits), then cards that draw (#107), ties → lowest uid. X-cost attacks (never at 0
 * energy; they spend all of it) are compared with the best other attack by damage per energy
 * (#147, single enemy): the X-cost attack goes first only when it applies Vulnerable and the other
 * doesn't, or (same Vulnerable) its damage for 1 energy is higher than the other's damage per
 * energy. At 3 energy: Whirlwind (5) after Strike (6), Whirlwind+ (8) before Strike.
 */
export function pickAttack(
  playable: readonly Card[],
  energy = 0,
  enemyVulnerable = 0,
  state?: State,
): Card | undefined {
  const attacks = playable.filter((c) => isAttackCard(c) && xCostPlayable(c, energy));
  const vuln = (c: Card) => (appliesVulnerable(c) && vulnerableFirst(c, attacks, energy, enemyVulnerable) ? 1 : 0);
  // #213 Slippery: each hit costs one stack and loses only 1 HP, so while it is up the card with the
  // most hits goes first and a big single hit (least total damage first on a tie) waits.
  const slippery = (state?.enemy.powers?.slippery ?? 0) > 0;
  const rank = (c: Card, x: number) =>
    slippery
      ? [vuln(c), attackHitCount(c, energy), -totalBaseDamage(c, x, state), draws(c)]
      : [vuln(c), totalBaseDamage(c, x, state), draws(c)];
  const other = best(
    attacks.filter((c) => !c.xCost),
    (c) => rank(c, energy),
  );
  const x = best(
    attacks.filter((c) => c.xCost),
    (c) => rank(c, 1),
  );
  if (!x || !other) return x ?? other;
  if (vuln(x) !== vuln(other)) return vuln(x) > vuln(other) ? x : other;
  return attackDamagePerEnergy(x, state) > attackDamagePerEnergy(other, state) ? x : other;
}

/**
 * Best block card: X-cost block cards only once no other block card is
 * playable (never at 0 energy), then largest block amount, then cards that
 * draw (#107), ties → lowest uid.
 */
export function pickBlock(playable: readonly Card[], energy = 0, state?: State): Card | undefined {
  const blocks = playable.filter((c) => isBlockCard(c) && xCostPlayable(c, energy));
  return best(blocks, (c) => [notXCost(c), totalBlock(c, state), draws(c)]);
}

/** The Block still wanted to satisfy the strategy: `Infinity` when Block is last (it spends leftover energy). */
function blockTarget(view: StrategyView, config: StrategyConfig): number {
  return blockIsLast(config) ? Infinity : view.intent.totalIncoming - config.allowThrough;
}

/**
 * #111 (Trent): the block card to play now. Without an Entrench (a card that doubles your Block)
 * in hand this is pickBlock. With one, the block cards are planned as a set: every combination
 * that fits the energy is tried, the other cards in their usual order and the Entrench last, and
 * the plan that reaches `target` with the least excess Block wins (fewer energy, then fewer
 * cards on a tie); when none reaches it, the plan with the most Block. The plan's first card is
 * played. With 14 incoming, 7 Block then Entrench (14) beats 7 + 5 Block then Entrench (24).
 * An empty plan (Entrench with no Block to double) plays nothing.
 */
function pickBlockPlanned(view: StrategyView, target: number): Card | undefined {
  const { state } = view;
  const energy = state.player.energy;
  const blocks = view.playable.filter((c) => isBlockCard(c) && xCostPlayable(c, energy));
  if (!blocks.some(doublesBlock)) return pickBlock(view.playable, energy, state);
  const sized = blocks.filter((c) => !c.xCost);
  const plain = sized
    .filter((c) => !doublesBlock(c))
    .sort((a, b) => totalBlock(b, state) - totalBlock(a, state) || a.uid - b.uid);
  const doublers = sized.filter(doublesBlock).sort((a, b) => a.uid - b.uid);
  const cards = [...plain, ...doublers];
  let bestPlan: { picks: Card[]; block: number; cost: number } | undefined;
  const startBlock = state.player.block;
  for (let mask = 0; mask < 1 << cards.length; mask++) {
    const picks = cards.filter((_, i) => mask & (1 << i));
    const cost = picks.reduce((n, c) => n + (c.cost ?? 0), 0);
    if (cost > energy) continue;
    let block = startBlock;
    for (const c of picks) block = doublesBlock(c) ? block * 2 : block + totalBlock(c, state);
    const reaches = block >= target;
    const better =
      !bestPlan ||
      (reaches
        ? bestPlan.block < target ||
          block < bestPlan.block ||
          (block === bestPlan.block &&
            (cost < bestPlan.cost || (cost === bestPlan.cost && picks.length < bestPlan.picks.length)))
        : bestPlan.block < target && (block > bestPlan.block || (block === bestPlan.block && cost < bestPlan.cost)));
    if (better) bestPlan = { picks, block, cost };
  }
  return bestPlan?.picks[0];
}

/**
 * #111 (Trent): Body Slam waits for the block cards: it is left out of `playable` while the Block
 * group still wants Block (or Block is last, or there is no Block yet) and a block card can be
 * played. Once none is wanted or affordable, it is played like any attack, with the Block gained.
 */
function withoutWaitingForBlock(view: StrategyView, config: StrategyConfig): StrategyView {
  if (!view.playable.some(waitsForBlock)) return view;
  const { block } = view.state.player;
  // With no Block yet it would deal nothing, so it waits even when no more Block is wanted.
  const wants = block < blockTarget(view, config) || block === 0;
  const energy = view.state.player.energy;
  if (!wants || !view.playable.some((c) => isBlockCard(c) && xCostPlayable(c, energy))) return view;
  return { ...view, playable: view.playable.filter((c) => !waitsForBlock(c)) };
}

/** #130 / #109: a Power card (the Powers group). */
export function isPowerCard(card: Card): boolean {
  return card.type === 'power';
}

/**
 * #109: worth of one stack of each simple power, in cardValue's units (4 per Strength or energy,
 * 1 per Block or damage). Per-turn powers count one turn's worth; on/off powers a flat value.
 * The orchestrator's default ("highest immediate value first"), not a rule from Trent.
 */
const POWER_VALUE: Partial<Record<PowerId, number>> = {
  demonForm: 4,
  energyPerTurn: 4,
  rollingBoulder: 1,
  crimsonMantle: 1,
  plating: 1,
  dexterity: 4,
  fasten: 1,
  thorns: 1,
  vigorPerTurn: 1,
  vigor: 1,
  powersCostLess: 4,
  /** Per 1%: Cruelty 25 → 5. */
  cruelty: 0.2,
};

/** #109: flat worth of on/off powers. Improvement does nothing inside one combat (0). */
const POWER_FLAT_VALUE: Partial<Record<PowerId, number>> = { barricade: 6, corruption: 10, upgradeAtCombatEnd: 0 };

/** #109: a Power card's immediate value: cardValue (Inflame's Strength) plus its powers (POWER_VALUE). */
export function powerValue(card: Card): number {
  let v = cardValue(card);
  for (const e of card.effects) {
    if (e.type !== 'applyPower') continue;
    v += POWER_FLAT_VALUE[e.power] ?? (POWER_VALUE[e.power] ?? 0) * e.amount;
  }
  return v;
}

/**
 * #130/#109: best Power to play: X-cost Powers only once no other Power is playable (never at 0
 * energy), then the highest immediate value (powerValue), then the cheaper, ties → lowest uid.
 */
export function pickPower(playable: readonly Card[], energy = 0): Card | undefined {
  const powers = playable.filter((c) => isPowerCard(c) && xCostPlayable(c, energy));
  return best(powers, (c) => [notXCost(c), powerValue(c), -(c.cost ?? 0)]);
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
      return (
        !pickPlayFirst(view) && !pickAttack(view.playable, energy, view.state.enemy.debuffs.vulnerable, view.state)
      );
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

// ---------------------------------------------------------------------------
// #110 temporary and next-turn effects (Trent's defaults)
// ---------------------------------------------------------------------------

const appliesPower = (c: Card, power: PowerId): boolean =>
  c.effects.some((e) => e.type === 'applyPower' && e.power === power);

/** Panic Button: big Block now, but no Block from cards for 2 turns. */
export function isPanicButton(c: Card): boolean {
  return appliesPower(c, 'noBlockFromCards');
}

/**
 * A card that only pays off when an Attack follows: temporary Strength (Feeding Frenzy), Rage,
 * One-Two Punch. Setup Strike is not one: it is an Attack and always counts as one (its damage is
 * 7, whatever follows).
 */
export function isAttackBooster(c: Card): boolean {
  return !isAttackCard(c) && (['strengthThisTurn', 'rage', 'doubleAttack'] as const).some((p) => appliesPower(c, p));
}

/**
 * #264: a card that only pays off when a Block Skill follows: Anticipate (Dexterity this turn),
 * Shadowmeld (double Block) and Burst (the next Skills twice). Not a rule from Trent.
 */
export function isBlockBooster(c: Card): boolean {
  return (
    !isAttackCard(c) &&
    !isBlockCard(c) &&
    (['dexterityThisTurn', 'doubleBlock', 'burst'] as const).some((p) => appliesPower(c, p))
  );
}

/** #264 Shadow Step: discards the hand, so it is only played once nothing else is left to play. */
export function isShadowStep(c: Card): boolean {
  return appliesPower(c, 'doubleAttackNextTurn');
}

/** Dark Shackles: a non-Attack that lowers the enemy's Strength this turn (Mangle is an Attack). */
export function isEnemyWeakener(c: Card): boolean {
  return !isAttackCard(c) && c.effects.some((e) => e.type === 'applyEnemyPower' && e.power === 'strengthLossThisTurn');
}

/** A card in no group whose payoff comes later (Outmaneuver, Prolong, The Bomb). */
function isUtilityCard(c: Card): boolean {
  return (
    !isAttackCard(c) &&
    !isBlockCard(c) &&
    !isPowerCard(c) &&
    !isAttackBooster(c) &&
    !isEnemyWeakener(c) &&
    c.effects.some((e) => e.type === 'schedule' || (e.type === 'script' && e.id === 'prolong'))
  );
}

/** A card whose only effects are Block. */
const isPureBlock = (c: Card): boolean => c.effects.length > 0 && c.effects.every((e) => e.type === 'gainBlock');

/**
 * #110: the view with the cards a strategy holds back removed from `playable`: Panic Button
 * (see pickPanic) always, and cards that only gain Block while Panic Button stops Block from cards.
 */
function withoutHeldBack(view: StrategyView): StrategyView {
  const noBlock = (view.state.player.powers?.noBlockFromCards ?? 0) > 0;
  const held = (c: Card) => isPanicButton(c) || (noBlock && isPureBlock(c));
  if (!view.playable.some(held)) return view;
  return { ...view, playable: view.playable.filter((c) => !held(c)) };
}

/**
 * #110 (Trent): Panic Button is a last resort: played only after everything else, and only when
 * the enemy's attack would still kill (unblocked damage at least the player's HP).
 */
function pickPanic(view: StrategyView): Card | undefined {
  const p = view.state.player;
  if ((p.powers?.noBlockFromCards ?? 0) > 0) return undefined;
  if (view.intent.totalIncoming - p.block < p.hp) return undefined;
  return best(view.playable.filter(isPanicButton), () => []);
}

/** #110 (Trent): Dark Shackles only when the enemy is attacking; played before Block so the Block need drops. */
function pickShackles(view: StrategyView): Card | undefined {
  if (view.intent.totalIncoming <= 0) return undefined;
  return best(view.playable.filter(isEnemyWeakener), (c) => [-(c.cost ?? 0)]);
}

/**
 * #264: a Block booster is played before the Block cards, only if a Block Skill follows that the energy
 * left after the booster still pays for; one already on this turn (Shadowmeld, Burst, Anticipate) is not stacked again.
 */
function pickBlockBooster(view: StrategyView): Card | undefined {
  const p = view.state.player;
  const energy = p.energy;
  const on = (c: Card) =>
    (['dexterityThisTurn', 'doubleBlock', 'burst'] as const).some(
      (id) => appliesPower(c, id) && (p.powers?.[id] ?? 0) > 0,
    );
  const followed = (b: Card) =>
    view.playable.some(
      (a) =>
        a.uid !== b.uid &&
        a.type === 'skill' &&
        isBlockCard(a) &&
        (a.xCost ? energy - (b.cost ?? 0) > 0 : (a.cost ?? 0) <= energy - (b.cost ?? 0)),
    );
  return best(
    view.playable.filter((c) => isBlockBooster(c) && !on(c) && followed(c)),
    (c) => [-(c.cost ?? 0)],
  );
}

/**
 * #110 (Trent): an Attack booster is played before the Attacks, only if an Attack will follow:
 * one other Attack in hand that the energy left after the booster still pays for.
 */
function pickBooster(view: StrategyView): Card | undefined {
  const energy = view.state.player.energy;
  const followed = (b: Card) =>
    view.playable.some(
      (a) =>
        a.uid !== b.uid &&
        isAttackCard(a) &&
        (a.xCost ? energy - (b.cost ?? 0) > 0 : (a.cost ?? 0) <= energy - (b.cost ?? 0)),
    );
  return best(
    view.playable.filter((c) => isAttackBooster(c) && followed(c)),
    (c) => [-(c.cost ?? 0)],
  );
}

/**
 * Cards in no group with a later payoff (The Bomb, Outmaneuver, Prolong) are played with leftover
 * energy once everything else is done; Prolong only with Block to carry over, and last.
 * Not a rule from Trent: without it these cards would never be played.
 */
function pickUtility(view: StrategyView): Card | undefined {
  const block = view.state.player.block;
  const prolong = (c: Card) => c.effects.some((e) => e.type === 'script');
  return best(
    view.playable.filter((c) => isUtilityCard(c) && (!prolong(c) || block > 0)),
    (c) => [prolong(c) ? 0 : 1],
  );
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
 * #112: a "tutor" (Secret Technique, Secret Weapon, Wish, Anointed) puts draw-pile cards in the
 * hand; Apotheosis upgrades every card. Neither is an Attack or Block card, so no group plays them.
 */
function pickFetchOrUpgrade(view: StrategyView): Card | undefined {
  const p = view.state.player;
  const fits = (c: Card, f: DeepReadonly<CardFilter> | undefined) =>
    !f ||
    ((!f.types || f.types.includes(c.type)) &&
      !f.notTypes?.includes(c.type) &&
      (!f.rarity || (c.rarity !== undefined && f.rarity.includes(c.rarity))));
  const useful = (c: Card): boolean => {
    if (isAttackCard(c) || isBlockCard(c)) return false;
    return c.effects.some((e) => {
      if (e.type === 'moveCards')
        return e.from === 'draw' && e.to === 'hand' && p.drawPile.some((d) => fits(d, e.filter));
      if (e.type === 'upgradeCards') {
        return [p.hand, p.drawPile, p.discardPile].some((pile) =>
          pile.some((d) => d.uid !== c.uid && !d.upgraded && !isJunk(d)),
        );
      }
      return false;
    });
  };
  return best(view.playable.filter(useful), (c) => [-(c.cost ?? 0)]);
}

/**
 * Plays made before the groups, in this order: a 0-cost draw card (#132); Enlightenment (#169); a tutor or Apotheosis (#112); Tremble when Attack
 * ranks first (it is first within the Attack group, and Attack is the top priority); a Brand /
 * Burning Pact / Purity worth playing (#108); a card that nets energy (#22), as long as some other
 * card in hand could use it (#127: before any pure draw card); then a pure draw card when the
 * hand can't fill the top group (#132).
 * Other pure draw cards wait until the groups are done (decide); attack and block draw cards are
 * ranked within their group.
 */
function pickTop(view: StrategyView, config: StrategyConfig): Card | undefined {
  const zero = pickZeroCostDraw(view);
  if (zero) return zero;
  const enlightenment = best(view.playable.filter(isEnlightenment), () => []);
  if (enlightenment) return enlightenment;
  const slyDiscarder = pickSlyDiscarder(view);
  if (slyDiscarder) return slyDiscarder;
  const fetched = pickFetchOrUpgrade(view);
  if (fetched) return fetched;
  if (config.order[0] === 'attack') {
    const tremble = pickPlayFirst(view);
    if (tremble) return tremble;
  }
  const havoc = pickHavoc(view);
  if (havoc) return havoc;
  const enabler = pickExhaustEnabler(view, config);
  if (enabler) return enabler;
  const energy = best(
    view.playable.filter((c) => isNetEnergyCard(c, view.state.player.hand)),
    (c) => [netEnergy(c, view.state.player.hand)],
  );
  if (energy && view.state.player.hand.some((c) => c.uid !== energy.uid && wantsEnergy(c))) return energy;
  const shackles = pickShackles(view);
  if (shackles) return shackles;
  const booster = pickBooster(view);
  if (booster) return booster;
  const blockBooster = pickBlockBooster(view);
  if (blockBooster) return blockBooster;
  const pure = pickPureDraw(view);
  if (
    pure &&
    cannotFillTopGroup(view, config) &&
    (config.order[0] === 'block' || !spendsAllWithoutDraw(view, config))
  ) {
    return pure;
  }
  return undefined;
}

/**
 * #205 (Trent): every heal counts in full in HP lost, so a healing card (Not Yet) is worth its whole
 * heal whatever the current HP. It is played with the energy left once the groups are done (it never
 * takes energy from an Attack or Block the strategy wants); the biggest heal first.
 */
function pickNotYet(view: StrategyView): Card | undefined {
  const heals = (c: Card): number => c.effects.reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0);
  return best(
    view.playable.filter((c) => heals(c) > 0),
    (c) => [heals(c)],
  );
}

// ---------------------------------------------------------------------------
// #46 Poison-only cards (Trent)
// ---------------------------------------------------------------------------

/** #46: Poison applications a Poison-only card makes (a repeat counts its fixed `times`, else 1); 0 when it isn't Poison-only. */
export function poisonApplications(card: Card): number {
  if (isJunk(card) || card.keywords.includes('unplayable')) return 0;
  const leaves = allEffects(card).filter((e) => e.type !== 'repeat');
  if (leaves.length === 0 || !leaves.every((e) => e.type === 'applyPoison')) return 0;
  let n = 0;
  const walk = (effects: readonly DeepReadonly<Effect>[], mult: number) => {
    for (const e of effects) {
      if (e.type === 'repeat') walk(e.effects, mult * (e.times ?? 1));
      else if (e.type === 'applyPoison') n += mult;
    }
  };
  walk(card.effects, 1);
  return n;
}

/** #46: a card whose only effect is applying Poison (Deadly Poison). */
export function isPoisonOnly(card: Card): boolean {
  return poisonApplications(card) > 0;
}

/**
 * #46: damage the Attacks in hand would deal this turn with `energy` (greedy by damage per energy),
 * counting Strength and Vulnerable; an estimate for "how long will the enemy live".
 */
function attackDamageThisTurn(view: StrategyView, energy: number): number {
  const { state } = view;
  const e = state.enemy;
  const mult = e.debuffs.vulnerable > 0 ? 1.5 : 1;
  const attacks = view.playable
    .filter((c) => isAttackCard(c) && !c.xCost)
    .map((c) => ({
      cost: c.cost ?? 0,
      dmg: Math.floor((totalBaseDamage(c, 0, state) + attackHitCount(c, 0) * state.player.strength) * mult),
    }))
    .sort((a, b) => b.dmg / Math.max(b.cost, 0.01) - a.dmg / Math.max(a.cost, 0.01));
  let left = energy;
  let sum = 0;
  for (const a of attacks) {
    if (a.cost <= left) {
      left -= a.cost;
      sum += a.dmg;
    }
  }
  return sum;
}

/**
 * #46 (Trent): play a Poison-only card before the Attacks when the enemy will live at least two more
 * turns. Estimate: the Attacks in hand deal D a turn (Block absorbs it first, but Poison ignores
 * Block); the enemy lives 2+ turns when HP - Poison - 2 x max(0, D - Block) > 0, so Block makes Poison
 * likelier. Artifact counts against it: each application uses one stack and is negated, so a card
 * whose applications the enemy's Artifact fully absorbs is not played.
 */
function pickPoison(view: StrategyView): Card | undefined {
  const e = view.state.enemy;
  const energy = view.state.player.energy;
  const live = view.playable.filter((c) => isPoisonOnly(c) && poisonApplications(c) > (e.powers?.artifact ?? 0));
  const card = best(live, (c) => [-(c.cost ?? 0), damagePerEnergy(c)]);
  if (!card) return undefined;
  return enemyOutlivesAttacks(view, Math.max(0, energy - (card.cost ?? 0))) ? card : undefined;
}

/** #46: the enemy lives 2+ more turns against the Attacks in hand with `energy`: HP - Poison - 2 x max(0, D - Block) > 0. */
function enemyOutlivesAttacks(view: StrategyView, energy: number): boolean {
  const e = view.state.enemy;
  const through = Math.max(0, attackDamageThisTurn(view, energy) - e.block);
  return e.hp - e.poison - 2 * through > 0;
}

/**
 * #314: a Sly card whose free play is worth its normal Energy cost outside the groups: a Poison card
 * (Haze) when the #46 estimate says Poison pays off (the enemy outlives the Attacks with the energy left,
 * and Artifact does not absorb it), or a Power or a card with effects the groups do not weigh (Abrasive).
 */
function slyWorthOutsideGroups(sly: Card, view: StrategyView, energyLeft: number): boolean {
  if (poisonApplications(sly) > 0) {
    return poisonApplications(sly) > (view.state.enemy.powers?.artifact ?? 0) && enemyOutlivesAttacks(view, energyLeft);
  }
  if (sly.type === 'power') return true;
  const weighed = ['attack', 'attackFrom', 'gainBlock', 'draw', 'gainEnergy', 'applyPoison'];
  return sly.effects.some((e) => !weighed.includes(e.type));
}

/**
 * #127 (Trent): true when the rest of the turn, with no pure draw card, spends all the energy
 * (X-cost cards or expensive Powers can), so a pure draw card has nothing to add. Not used when
 * Block ranks first: the #132 block rule (draw first when the block cards can't reach the target) wins.
 */
function spendsAllWithoutDraw(view: StrategyView, config: StrategyConfig): boolean {
  const keep = (c: Card) => !(isPureDrawCard(c) && !stopsDrawing(c) && !isExhaustEnabler(c));
  const p = view.state.player;
  const sub = {
    ...view,
    state: { ...view.state, player: { ...p, hand: p.hand.filter(keep) } },
    playable: view.playable.filter(keep),
  };
  let e = p.energy;
  for (const c of planTurn(sub, config, e)) e = (c.xCost ? 0 : e - (c.cost ?? 0)) + energyGain(c, p.hand);
  return e <= 0;
}

/** Energy left over after playing a net-energy card. */
function netEnergy(card: Card, hand: readonly Card[]): number {
  return energyGain(card, hand) - (card.cost as number);
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
      isShivMaker(c) ||
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
      const atk = pickAttack(view.playable, energy, view.state.enemy.debuffs.vulnerable, view.state);
      const maker = pickShivMaker(
        view,
        pickAttack(
          view.playable.filter((c) => c.xCost || (c.cost ?? 0) > 0),
          energy,
          view.state.enemy.debuffs.vulnerable,
          view.state,
        ),
      );
      if (maker) return maker;
      return planning ? atk : (pickFiendFire(view, config, atk) ?? atk);
    }
    case 'powers':
      return pickPower(view.playable, energy);
    case 'block': {
      if (!blockIsLast(config) && view.intent.totalIncoming - view.state.player.block <= config.allowThrough) {
        return undefined;
      }
      const blk = pickBlockPlanned(view, blockTarget(view, config));
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
    e += energyGain(c, hand);
    for (const fx of c.effects) if (fx.type === 'gainBlock') block += fx.amount;
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
  const view = withSlyEffects(
    withoutWaitingForAttacks(
      withoutWaitingForBlock(
        withoutGuardBroken(withoutLethal(withoutIdle(withoutNeverPlayed(withoutHeldBack(raw)))), config),
        config,
      ),
    ),
    config,
  );
  const d = decideWith(view, config, false);
  if (d.kind !== 'endTurn') return d;
  // #110: Panic Button is the last resort, once nothing else is left to play.
  const panic = pickPanic(raw);
  return panic ? play(panic) : d;
}

function decideWith(view: StrategyView, config: StrategyConfig, planning: boolean): Decision {
  const d = decideCore(view, config, planning);
  return planning ? d : fiendFireLast(view, config, d);
}

/** #132 (answers 7, 8): true for Bash, the Vulnerable-applier played before Fiend Fire. */
function isBash(card: Card): boolean {
  return card.cardId === 'bash';
}

/**
 * #132 (answers 7, 8): once the decision is to play Fiend Fire (and it would not kill), play it
 * last: Bash first, even when that leaves too little energy for it; then spend the spare energy
 * (energy beyond its cost) on other plays, draw cards first (they grow the hand it exhausts).
 * Re-decided after every play, so a draw that changes the hand re-checks the Fiend Fire call.
 */
function fiendFireLast(view: StrategyView, config: StrategyConfig, d: Decision): Decision {
  if (d.kind !== 'play') return d;
  const fire = view.playable.find((c) => c.uid === d.uid);
  if (!fire || !isFiendFire(fire) || fiendFireKills(view, fire)) return d;
  const bash = best(view.playable.filter(isBash), (c) => [-(c.cost ?? 0)]);
  if (bash) return play(bash);
  const spare = view.state.player.energy - (fire.cost ?? 0);
  const fits = (c: Card) => !playsLast(c) && c.cost !== null && (c.xCost ? spare > 0 : c.cost <= spare);
  const playable = view.playable.filter(fits);
  if (playable.length === 0) return d;
  if (canDraw(view)) {
    const draw = best(
      playable.filter((c) => isDrawCard(c) && !stopsDrawing(c)),
      (c) => [isPureDrawCard(c) ? 1 : 0],
    );
    if (draw) return play(draw);
  }
  const state = { ...view.state, player: { ...view.state.player, energy: spare } };
  const other = decideCore({ ...view, state, playable }, config, false);
  return other.kind === 'play' ? other : d;
}

function decideCore(view: StrategyView, config: StrategyConfig, planning: boolean): Decision {
  if (!planning) {
    const fire = playableFiendFire(view);
    if (fire && fiendFireKills(view, fire)) return play(fire);
  }
  const top = pickTop(view, config);
  if (top) return play(top);
  for (const g of config.order) {
    const poison = g === 'attack' ? pickPoison(view) : undefined;
    if (poison) return play(poison);
    const c = pickFromGroup(view, g, config, planning);
    if (c) return play(c);
  }
  const drawing = canDraw(view);
  const pure = drawing ? pickPureDraw(view) : undefined;
  if (pure) return play(pure);
  const blk = pickBlockPlanned(view, Infinity);
  if (blk) return play(blk);
  const trance = drawing ? pickTrance(view) : undefined;
  if (trance) return play(trance);
  const heal = planning ? undefined : pickNotYet(view);
  if (heal) return play(heal);
  const utility = planning ? undefined : pickUtility(view);
  if (utility) return play(utility);
  if (planning) return END;
  const support = pickSupport(view);
  if (support) return play(support);
  const preferBlock = config.order.indexOf('block') < config.order.indexOf('attack');
  const last = pickLast(view, preferBlock);
  if (last) return play(last);
  // #284: Storm of Steel goes after all other energy is spent (the last play before Shadow Step).
  const storm = pickStorm(view);
  if (storm) return play(storm);
  // #264: Shadow Step goes last: it discards what is left in the hand for double Attacks next turn.
  const shadowStep = best(view.playable.filter(isShadowStep), () => []);
  if (shadowStep) return play(shadowStep);
  return END;
}

const END: Decision = { kind: 'endTurn' };
const play = (c: Card): Decision => ({ kind: 'play', uid: c.uid });

/**
 * #144: the turns of one combat so far, to tell whether at least 80% of them ended with 0 energy.
 * Built only from what decide sees (the turn number, the energy at endTurn), so it is deterministic.
 */
class EnergyTally {
  private turn = 0;
  private played = 0;
  private ended = false;
  private endEnergy = 0;
  private turns = 0;
  private zero = 0;

  /** Call before each decision: closes the previous turn when a new one starts, resets on a new combat. */
  observe(view: StrategyView): void {
    const turn = view.state.turn;
    const played = view.state.player.counters?.cardsPlayedThisCombat ?? 0;
    const newCombat =
      this.turn === 0 ||
      turn < this.turn ||
      turn > this.turn + 1 ||
      (turn === this.turn && (this.ended || played < this.played));
    if (newCombat) {
      this.turns = 0;
      this.zero = 0;
    } else if (turn === this.turn + 1 && this.ended) {
      this.turns++;
      if (this.endEnergy === 0) this.zero++;
    }
    this.turn = turn;
    this.played = played;
    this.ended = false;
  }

  /** Call after each decision. */
  record(view: StrategyView, d: Decision): void {
    if (d.kind !== 'endTurn') return;
    this.ended = true;
    this.endEnergy = view.state.player.energy;
  }

  /** True when at least DRAW_EXHAUST_ZERO_ENERGY_SHARE of the finished turns ended with 0 energy (none finished: false). */
  get drawExhaustible(): boolean {
    return this.turns > 0 && this.zero / this.turns >= DRAW_EXHAUST_ZERO_ENERGY_SHARE;
  }
}

/**
 * Strategies re-compute each decision from the view (the current hand and energy, so cards drawn
 * mid-turn are re-planned around). Remembered: the card just played, for the choice it asks for
 * (#141), and the energy tally of the combat (#144, EnergyTally; it resets by itself on a new
 * combat, so one instance can still be reused across combats).
 */
export function createStrategy(config: StrategyConfig): Strategy {
  const c = normalizeConfig(config);
  if (!c) throw new Error(`Invalid strategy config ${JSON.stringify(config)}`);
  // The card just chosen by decide, so a choice it asks for knows whether the card stays in the deck (#141).
  let playing: Card | undefined;
  const tally = new EnergyTally();
  const withTally = (): TallyConfig => ({ ...c, drawExhaustible: tally.drawExhaustible });
  // #5: with several enemies every decision is made against the target the priority picks.
  const aim = (view: StrategyView) => {
    const target = pickTarget(view, c.target);
    return { target, view: targetView(view, target) };
  };
  return {
    decide: (raw) => {
      const { target, view } = aim(raw);
      tally.observe(view);
      const first = randomTargetFirst(raw);
      if (first) {
        // #45: random-target attacks first (or a targeted kill); the next decision re-plans the rest.
        tally.record(view, first.decision);
        playing = view.playable.find((p) => p.uid === first.decision.uid);
        return first.decision;
      }
      const d = decide(view, withTally());
      tally.record(view, d);
      playing = d.kind === 'play' ? view.playable.find((p) => p.uid === d.uid) : undefined;
      if (d.kind !== 'play' || target === undefined) return d;
      // #282: an HP-direct card (Poison, ...) ignores Block, so it targets the lowest plain HP.
      const direct = playing && playing.effects.some((e) => e.type === 'applyPoison' || e.type === 'enemyLoseHp');
      return { ...d, target: direct ? (pickTarget(raw, c.target, true) ?? target) : target };
    },
    usePotion: (raw) => {
      const { target, view } = aim(raw);
      const use = pickPotion(view);
      return use && target !== undefined ? { ...use, target } : use;
    },
    choose: (raw, request) => {
      const { view } = aim(raw);
      if (request.sourcePower === 'wellLaidPlans') return chooseRetained(request, view.state.player.drawPile, c.order);
      if (request.to === 'discard' && request.from === 'hand') return chooseDiscard(view, request, withTally());
      return request.purpose === 'generate' || request.purpose === 'move' || request.purpose === 'upgrade'
        ? chooseGenerated(request, c.order)
        : chooseExhaust(view, request, withTally(), playing && playing.uid === request.sourceUid ? playing : undefined);
    },
  };
}

function isRandomTargetAttack(card: Card): boolean {
  return card.effects.some((e) => e.type === 'attack' && e.randomTarget === true);
}

/** #45: damage a targeted attack card would deal to `enemy` now (Strength, Weak, Vulnerable; Block counts as HP). */
function wouldKill(
  card: Card,
  state: State,
  enemy: { hp: number; block: number; debuffs: { vulnerable: number; weak: number } },
) {
  const x = card.xCost ? state.player.energy : 0;
  let dmg = 0;
  for (const e of card.effects) {
    if (e.type !== 'attack' || e.allEnemies) continue;
    const per = attackDamage(
      e.damage + (card.damageBonus ?? 0),
      state.player.strength,
      state.player.debuffs.weak,
      enemy.debuffs.vulnerable,
      0,
      0,
      0,
      (state.player.powers?.tracking ?? 0) > 0 && enemy.debuffs.weak > 0,
    );
    dmg += per * attackHits(e, x);
  }
  return dmg >= enemy.hp + enemy.block;
}

/**
 * #45 (Trent): with 2+ enemies alive, random-target attacks (Sword Boomerang, Rip and Tear, ...) are
 * played first, and the turn is then re-planned with the new board (every decision is made afresh).
 * Exception: a targeted attack that would kill a living enemy goes first (the cheapest such card, at
 * the leftmost enemy it kills). The biggest random attack goes first. Undefined when the rule does not apply.
 */
function randomTargetFirst(view: StrategyView): { decision: Extract<Decision, { kind: 'play' }> } | undefined {
  const enemies = view.state.enemies;
  if (!enemies || enemies.filter((e) => e.hp > 0).length < 2) return undefined;
  const random = best(view.playable.filter(isRandomTargetAttack), (c) => [
    totalBaseDamage(c, view.state.player.energy, view.state),
  ]);
  if (!random) return undefined;
  for (const c of [...view.playable]
    .filter((c) => isAttackCard(c) && !isRandomTargetAttack(c))
    .sort((a, b) => (a.cost as number) - (b.cost as number))) {
    const i = enemies.findIndex((e) => e.hp > 0 && wouldKill(c, view.state, e));
    if (i >= 0) return { decision: { kind: 'play', uid: c.uid, target: i } };
  }
  return { decision: { kind: 'play', uid: random.uid } };
}

/**
 * #5 (Trent): the living enemy a strategy targets, as an index into `state.enemies`; undefined with
 * a single enemy. 'lowestHp': lowest effective HP (HP + Block, #282); `hpDirect` (Poison, Doom,
 * Capture Spirit: effects that lose HP past Block) ranks by HP alone. 'biggestAttack': biggest incoming attack this turn
 * (the enemy's intent), ties to the lowest HP. Remaining ties: the leftmost.
 */
export function pickTarget(
  view: StrategyView,
  priority: TargetPriority = 'lowestHp',
  hpDirect = false,
): number | undefined {
  const enemies = view.state.enemies;
  if (!enemies || enemies.length < 2) return undefined;
  const incoming = (i: number) => view.intents?.[i]?.totalIncoming ?? 0;
  const eff = (e: { hp: number; block: number }) => (hpDirect ? e.hp : e.hp + e.block);
  let best: number | undefined;
  enemies.forEach((e, i) => {
    if (e.hp <= 0) return;
    if (best === undefined) {
      best = i;
      return;
    }
    const b = enemies[best]!;
    const lower = eff(e) < eff(b);
    if (priority === 'biggestAttack') {
      if (incoming(i) > incoming(best) || (incoming(i) === incoming(best) && lower)) best = i;
    } else if (lower) {
      best = i;
    }
  });
  return best;
}

/** #5: the view with enemy `target` as `state.enemy`, so every single-enemy rule reads the target. */
function targetView(view: StrategyView, target: number | undefined): StrategyView {
  if (target === undefined) return view;
  const enemy = view.state.enemies![target]!;
  return enemy === view.state.enemy ? view : { ...view, state: { ...view.state, enemy } };
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
  // #5: target priority; absent or 'lowestHp' is the default and is left out of the canonical form.
  if (o.target !== undefined && !TARGET_PRIORITIES.includes(o.target as TargetPriority)) return null;
  const groups = order as StrategyGroup[];
  const config: StrategyConfig = {
    order: [...groups],
    allowThrough: groups[groups.length - 1] === 'block' ? 0 : o.allowThrough,
  };
  if (o.target === 'biggestAttack') config.target = 'biggestAttack';
  return config;
}

/** #5: the target priorities a strategy can use; the first is the default. */
export const TARGET_PRIORITIES: readonly TargetPriority[] = ['lowestHp', 'biggestAttack'];

/** True when two configs play the same (same order and, unless Block is last, same X). */
export function sameConfig(a: StrategyConfig, b: StrategyConfig): boolean {
  return strategyCode(a) === strategyCode(b);
}

const GROUP_LETTER: Record<StrategyGroup, string> = { attack: 'a', block: 'b', powers: 'p' };
const LETTER_GROUP: Record<string, StrategyGroup> = { a: 'attack', b: 'block', p: 'powers' };

/**
 * URL code: the order's letters, X after "b" unless Block is last ("apb", "b5pa", "pb5a"), then
 * #5 a trailing "i" for the 'biggestAttack' target priority ("apbi"); none for the default.
 */
export function strategyCode(config: StrategyConfig): string {
  const last = blockIsLast(config);
  const order = config.order.map((g) => (g === 'block' && !last ? `b${config.allowThrough}` : GROUP_LETTER[g]));
  return order.join('') + (config.target === 'biggestAttack' ? 'i' : '');
}

/** Parses a code from strategyCode, or an old one ("g", "b<X>"). Null for anything else. */
export function parseStrategyCode(code: string): StrategyConfig | null {
  // #5: a trailing "i" = 'biggestAttack' target priority (never on the old "g" / "b<X>" codes).
  if (code.endsWith('i')) {
    const base = code.slice(0, -1);
    const config = base === 'g' || /^b\d+$/.test(base) ? null : parseStrategyCode(base);
    return config && !config.target ? { ...config, target: 'biggestAttack' } : null;
  }
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
