import type {
  CardInstance,
  ChoiceRequest,
  ChoiceResponse,
  DeepReadonly,
  Decision,
  Effect,
  Strategy,
  StrategyConfig,
  StrategyView,
} from './types';
import { attackHits } from './rules';

type Card = DeepReadonly<CardInstance>;

/**
 * Cards every strategy plays before anything else when they are affordable
 * (#1: Tremble, v1). Kept as a list so the rule can grow later.
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

/** #108: how many other cards in hand `card` would exhaust (Second Wind: its filter; Fiend Fire: all). */
function wouldExhaust(view: StrategyView, card: Card): number {
  const others = view.state.player.hand.filter((c) => c.uid !== card.uid);
  if (isFiendFire(card)) return others.length;
  const f = exhaustEffects(card).find((e) => e.mode === 'all')?.filter;
  return others.filter((c) => !f || ((!f.types || f.types.includes(c.type)) && !f.notTypes?.includes(c.type))).length;
}

/** #108: Block Second Wind would give now: its per-card Block × the cards it would exhaust (block strategies). */
export function secondWindBlock(view: StrategyView, card: Card): number {
  let per = 0;
  for (const e of card.effects) {
    if (e.type === 'repeat' && e.per === 'lastEffectCount') {
      for (const inner of e.effects) if (inner.type === 'gainBlock') per += inner.amount * (e.times ?? 1);
    }
  }
  return per * wouldExhaust(view, card);
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
 * #108: block strategies count Second Wind as a block card worth its Block × the cards it would
 * exhaust. Returns it when that beats `blockCard` (ties go to the normal block card).
 */
export function secondWindOver(view: StrategyView, blockCard: Card | undefined): Card | undefined {
  const wind = best(view.playable.filter(isSecondWind), (c) => [secondWindBlock(view, c)]);
  const windBlock = wind ? secondWindBlock(view, wind) : 0;
  return wind && windBlock > 0 && windBlock > (blockCard ? totalBlock(blockCard) : 0) ? wind : undefined;
}

/**
 * #108: once nothing else is played, Second Wind and Fiend Fire, if they would exhaust at least
 * one card. With energy for both, Second Wind goes first (Fiend Fire would exhaust it); with
 * energy for one, greedy takes Fiend Fire and block strategies take Second Wind.
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

const END: Decision = { kind: 'endTurn' };
const play = (c: Card): Decision => ({ kind: 'play', uid: c.uid });

/**
 * Plays every strategy makes before its own logic: Tremble (#1); then, while there is
 * something to draw, a pure draw card (#107); then a card that nets energy (#22), as long as
 * some other card in hand could use it; then Battle Trance (#107), once no other draw card in
 * hand is playable, so every other draw that turn comes first.
 */
function pickFirst(view: StrategyView): Card | undefined {
  const first = best(
    view.playable.filter((c) => PLAY_FIRST_CARD_IDS.includes(c.cardId)),
    () => [],
  );
  if (first) return first;
  const enabler = pickExhaustEnabler(view);
  if (enabler) return enabler;
  const drawing = canDraw(view);
  if (drawing) {
    const pureDraw = best(
      view.playable.filter((c) => isPureDrawCard(c) && !stopsDrawing(c) && !isExhaustEnabler(c)),
      () => [],
    );
    if (pureDraw) return pureDraw;
  }
  const energy = best(view.playable.filter(isNetEnergyCard), (c) => [netEnergy(c)]);
  if (energy && view.state.player.hand.some((c) => c.uid !== energy.uid && wantsEnergy(c))) return energy;
  if (drawing) {
    const trance = best(view.playable.filter(stopsDrawing), () => []);
    if (trance && !view.playable.some((c) => c.uid !== trance.uid && isDrawCard(c) && !stopsDrawing(c))) {
      return trance;
    }
  }
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
    (isAttackCard(c) || isBlockCard(c) || isDrawCard(c) || isNetEnergyCard(c) || PLAY_FIRST_CARD_IDS.includes(c.cardId))
  );
}

function greedyDecide(raw: StrategyView): Decision {
  const view = withoutLethal(raw);
  const first = pickFirst(view);
  if (first) return play(first);
  return greedyMain(view);
}

function greedyMain(view: StrategyView, preferBlock = false): Decision {
  const energy = view.state.player.energy;
  const atk = pickAttack(view.playable, energy);
  if (atk) return play(atk);
  const blk = pickBlock(view.playable, energy);
  if (blk) return play(blk);
  const last = pickLast(view, preferBlock);
  if (last) return play(last);
  return END;
}

function blockDecide(raw: StrategyView, allowThrough: number): Decision {
  const view = withoutLethal(raw);
  const first = pickFirst(view);
  if (first) return play(first);
  // Phase 1: block until at most `allowThrough` damage would get through.
  const unblocked = view.intent.totalIncoming - view.state.player.block;
  if (unblocked > allowThrough) {
    const blk = pickBlock(view.playable, view.state.player.energy);
    const wind = secondWindOver(view, blk);
    if (wind) return play(wind);
    if (blk) return play(blk);
  }
  // Phase 2: attacks. Phase 3: leftover block. Then Second Wind / Fiend Fire (#108).
  return greedyMain(view, true);
}

/**
 * Strategies are stateless: each decision is recomputed from the view (the current hand and
 * energy, so cards drawn mid-turn are re-planned around), and one instance can safely be
 * reused across combats.
 */
export function createStrategy(config: StrategyConfig): Strategy {
  switch (config.kind) {
    case 'greedyDamage':
      return { decide: greedyDecide, choose: chooseExhaust };
    case 'block': {
      const x = config.allowThrough;
      return { decide: (view) => blockDecide(view, x), choose: chooseExhaust };
    }
  }
}

/** URL code: "g" or "b<X>". */
export function strategyCode(config: StrategyConfig): string {
  switch (config.kind) {
    case 'greedyDamage':
      return 'g';
    case 'block':
      return `b${config.allowThrough}`;
  }
}

export function parseStrategyCode(code: string): StrategyConfig | null {
  if (code === 'g') return { kind: 'greedyDamage' };
  const m = /^b(0|[1-9]\d{0,3})$/.exec(code);
  if (m) return { kind: 'block', allowThrough: Number(m[1]) };
  return null;
}
