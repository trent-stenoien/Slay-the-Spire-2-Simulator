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
} from './types';
import { attackDamage, attackHits, conditionHolds, countStrikes, perCounterValue } from './rules';
import { chooseGenerated } from './generate';

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

type State = StrategyView['state'];

/** #111: an effect that is an attack in the strategy's eyes: `attack`, `attackFrom`, Perfected Strike, or a conditional holding one. */
function isAttackEffect(e: DeepReadonly<Effect>): boolean {
  if (e.type === 'attack' || e.type === 'attackFrom') return true;
  if (e.type === 'script') return e.id === 'perfectedStrike';
  return e.type === 'conditional' && [...e.then, ...(e.else ?? [])].some(isAttackEffect);
}

/** v1: an attack is any card with an `attack` effect (Bash included); #111 adds `attackFrom` and Perfected Strike. */
export function isAttackCard(card: Card): boolean {
  return card.effects.some(isAttackEffect);
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

function appliesVulnerable(card: Card): boolean {
  return card.effects.some((e) => e.type === 'applyVulnerable');
}

/**
 * Total base damage (damage × hits), including the card's own damage bonus (Thrash, #108).
 * For X-cost cards, X is `energy` (all of it gets spent).
 */
function totalBaseDamage(card: Card, energy: number, state?: State): number {
  const x = card.xCost ? energy : 0;
  let sum = 0;
  for (const e of activeEffects(card, state)) {
    if (e.type === 'attack') sum += (e.damage + (card.damageBonus ?? 0)) * attackHits(e, x);
    // #111: scaling attacks count what they would deal now (the base alone without a state).
    else if (e.type === 'attackFrom') {
      const per = e.damage + (card.damageBonus ?? 0) + (state ? perCounterValue(e.bonusPer, state) : 0);
      sum += per * (e.hits + (state ? perCounterValue(e.extraHitsPer, state) : 0));
    } else if (e.type === 'script' && e.id === 'perfectedStrike') {
      const [base = 0, per = 0] = e.values ?? [];
      sum += base + (card.damageBonus ?? 0) + (state ? per * countStrikes(state.player) : 0);
    }
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
 * 1 curse/status that makes you lose HP, 2 exhaust-benefit cards (Drum of Battle), 3 curse/status
 * with flat blockable damage, 4 other non-Ethereal curse/status, 5 non-upgraded Strike or Defend
 * of the lower-priority group, 6 the other non-upgraded one, 6.5 a draw-only card costing 1+ while
 * the draw cards are exhaustible (#144, see TallyConfig), 7 Ethereal curse/status, 8 anything
 * else (the cards that won't be played; see exhaustOrder).
 */
export function exhaustTier(card: Card, config: StrategyConfig = GREEDY_CONFIG): number {
  if (dealsDirectHpDamage(card)) return 1;
  if (benefitsFromExhaust(card)) return 2;
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
function energyAfter(played: readonly Card[], energy: number): number {
  let e = energy;
  for (const c of played) {
    e -= c.xCost ? e : (c.cost ?? 0);
    for (const fx of c.effects) if (fx.type === 'gainEnergy') e += fx.amount;
  }
  return e;
}

/**
 * #139 Ethereal exception: true when exhausting `base` (the next Strike or Defend) would leave
 * energy unused this turn, i.e. the turn planned without it spends less than the turn planned with it.
 */
function leavesEnergyUnused(view: StrategyView, config: StrategyConfig, base: Card): boolean {
  const energy = view.state.player.energy;
  const withIt = energyAfter(planTurn(view, config, energy), energy);
  const without = energyAfter(planTurn(withoutCards(view, [base]), config, energy), energy);
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
  return true;
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
  return cost <= 0 ? Infinity : totalBaseDamage(card, 0, state) / cost;
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
  const other = best(
    attacks.filter((c) => !c.xCost),
    (c) => [vuln(c), totalBaseDamage(c, energy, state), draws(c)],
  );
  const x = best(
    attacks.filter((c) => c.xCost),
    (c) => [vuln(c), totalBaseDamage(c, 1, state), draws(c)],
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
 * Burning Pact / Purity worth playing (#108); a card that nets energy (#22), as long as some other
 * card in hand could use it (#127: before any pure draw card); then a pure draw card when the
 * hand can't fill the top group (#132).
 * Other pure draw cards wait until the groups are done (decide); attack and block draw cards are
 * ranked within their group.
 */
function pickTop(view: StrategyView, config: StrategyConfig): Card | undefined {
  const heal = pickNotYet(view);
  if (heal) return heal;
  const zero = pickZeroCostDraw(view);
  if (zero) return zero;
  if (config.order[0] === 'attack') {
    const tremble = pickPlayFirst(view);
    if (tremble) return tremble;
  }
  const enabler = pickExhaustEnabler(view, config);
  if (enabler) return enabler;
  const energy = best(view.playable.filter(isNetEnergyCard), (c) => [netEnergy(c)]);
  if (energy && view.state.player.hand.some((c) => c.uid !== energy.uid && wantsEnergy(c))) return energy;
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

/** #115: Not Yet is played first, but only when it would heal at least this much HP now. */
export const NOT_YET_MIN_HEAL = 8;

/** #115 (Trent): the playable healing card (Not Yet) that would restore the most HP, if at least NOT_YET_MIN_HEAL. */
function pickNotYet(view: StrategyView): Card | undefined {
  const { hp, maxHp } = view.state.player;
  const heals = (c: Card): number =>
    Math.min(
      c.effects.reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0),
      maxHp - hp,
    );
  return best(
    view.playable.filter((c) => heals(c) >= NOT_YET_MIN_HEAL),
    (c) => [heals(c)],
  );
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
  for (const c of planTurn(sub, config, e)) e = (c.xCost ? 0 : e - (c.cost ?? 0)) + energyGain(c);
  return e <= 0;
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
      const atk = pickAttack(view.playable, energy, view.state.enemy.debuffs.vulnerable, view.state);
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
  return decideWith(
    withoutWaitingForBlock(withoutGuardBroken(withoutLethal(withoutNeverPlayed(raw)), config), config),
    config,
    false,
  );
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
  if (planning) return END;
  const preferBlock = config.order.indexOf('block') < config.order.indexOf('attack');
  const last = pickLast(view, preferBlock);
  if (last) return play(last);
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
  return {
    decide: (view) => {
      tally.observe(view);
      const d = decide(view, withTally());
      tally.record(view, d);
      playing = d.kind === 'play' ? view.playable.find((p) => p.uid === d.uid) : undefined;
      return d;
    },
    choose: (view, request) =>
      request.purpose === 'generate'
        ? chooseGenerated(request, c.order)
        : chooseExhaust(view, request, withTally(), playing && playing.uid === request.sourceUid ? playing : undefined),
  };
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
