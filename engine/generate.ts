/**
 * #116 random card generation: which cards a CardPool can produce, and how a strategy picks
 * one of several generated cards (Discovery, Abundance). Pure functions; no randomness here.
 */
import type {
  CardDef,
  CardInstance,
  CardPool,
  CardRarity,
  CardType,
  ChoiceRequest,
  ChoiceResponse,
  DeepReadonly,
  StrategyGroup,
} from './types';

/** Pool rule: unless the pool names rarities, only Common, Uncommon and Rare cards qualify (no Basic, Ancient, Event, Token). */
export const DEFAULT_POOL_RARITIES: readonly CardRarity[] = ['common', 'uncommon', 'rare'];

/** Pool rule: unless the pool names types, only Attacks, Skills and Powers qualify (no Status, Curse, Quest). */
export const DEFAULT_POOL_TYPES: readonly CardType[] = ['attack', 'skill', 'power'];

/**
 * The cards a pool can produce, sorted by id (so the seeded pick is stable). Membership rule:
 * - only cards whose JSON has `simulated: true`, so newly simulated cards join by themselves;
 * - `character` 'own' (the default) = the player's character, 'colorless' = Colorless cards;
 *   'otherCharacters' (Splash, #151) is not simulated yet;
 * - rarity and type default to DEFAULT_POOL_RARITIES / DEFAULT_POOL_TYPES;
 * - `cost` matches the printed (base) cost; an upgraded pool also takes cards whose upgrade sets that cost (#170, Jackpot+ gets Body Slam+); unplayable and hidden / multiplayer-only cards never qualify;
 * - `upgraded`: only cards that can be upgraded.
 */
export function cardPool(
  cards: Readonly<Record<string, CardDef>>,
  characterCode: string,
  pool: CardPool,
  upgraded = false,
): CardDef[] {
  const character = pool.character ?? 'own';
  if (character === 'otherCharacters') throw new Error('Card pool "otherCharacters" is not simulated yet (#151)');
  const wanted = character === 'own' ? characterCode : 'colorless';
  const rarities = pool.rarity ?? DEFAULT_POOL_RARITIES;
  const types = pool.types ?? DEFAULT_POOL_TYPES;
  return Object.values(cards)
    .filter(
      (c) =>
        c.simulated &&
        !c.hidden &&
        !c.multiplayerOnly &&
        c.character === wanted &&
        rarities.includes(c.rarity) &&
        types.includes(c.type) &&
        c.cost !== null &&
        !c.keywords.includes('unplayable') &&
        (pool.cost === undefined || c.cost === pool.cost || (upgraded && c.upgraded?.cost === pool.cost)) &&
        (!upgraded || c.upgraded !== null),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Card = DeepReadonly<CardInstance>;

/** Total base damage of a card's attack effects (hits counted). */
function damageOf(card: Card): number {
  let sum = 0;
  for (const e of card.effects) if (e.type === 'attack') sum += e.damage * e.hits;
  return sum;
}

/** Total Block a card's effects give. */
function blockOf(card: Card): number {
  let sum = 0;
  for (const e of card.effects) if (e.type === 'gainBlock') sum += e.amount;
  return sum;
}

/** Default group order when a strategy has no `choose` of its own. */
const DEFAULT_ORDER: readonly StrategyGroup[] = ['attack', 'powers', 'block'];

/** The strategy-priority rank of a card: the index of the first group in `order` it belongs to; after all of them for other cards, after those for curses and statuses. */
function groupRank(card: Card, order: readonly StrategyGroup[]): number {
  for (let i = 0; i < order.length; i++) {
    const group = order[i];
    if (
      group === 'attack'
        ? card.type === 'attack'
        : group === 'block'
          ? card.type === 'skill' && blockOf(card) > 0
          : card.type === 'power'
    ) {
      return i;
    }
  }
  return card.type === 'curse' || card.type === 'status' ? order.length + 1 : order.length;
}

/** Within a group: Attacks by most damage, Block cards by most Block, anything else equal. */
function groupScore(card: Card): number {
  return card.type === 'attack' ? damageOf(card) : blockOf(card);
}

/**
 * #266 Well-Laid Plans (Trent): retain the card the strategy needs next turn for its top priority (the
 * first group of its order that has a card among the options; a Block-first strategy keeps a Block
 * card), best card of the group first, unless more than half of the draw pile is cards of that group,
 * in which case other cards come first. Curses and statuses are never kept. Up to `max` cards; any
 * left-over slot takes the demoted cards.
 */
export function chooseRetained(
  request: ChoiceRequest,
  drawPile: readonly Card[],
  order: readonly StrategyGroup[] = DEFAULT_ORDER,
): ChoiceResponse {
  const junk = order.length + 1;
  const ranked = request.options
    .map((c, i) => ({ c, i, rank: groupRank(c, order), score: groupScore(c) }))
    .filter((x) => x.rank < junk);
  if (ranked.length === 0) return { uids: [] };
  const top = Math.min(...ranked.map((x) => x.rank));
  const inTop = drawPile.filter((c) => groupRank(c, order) === top).length;
  const crowded = top < order.length && drawPile.length > 0 && inTop * 2 > drawPile.length;
  const demoted = (x: { rank: number }) => (crowded && x.rank === top ? 1 : 0);
  ranked.sort((a, b) => demoted(a) - demoted(b) || a.rank - b.rank || b.score - a.score || a.i - b.i);
  return { uids: ranked.slice(0, request.max).map((x) => x.c.uid) };
}

/**
 * #116/#112: answer a "pick cards by the strategy's priorities" request (Discovery, Abundance,
 * Headbutt, Armaments, Seeker Strike...). Cards are ranked by the first group of the strategy's
 * order they belong to (Attack: most damage; Block: most Block; Powers: equal), then the other
 * cards, then curses and statuses; ties go to the earlier option. The best `max` are taken; an
 * "up to" request (min below max) never takes a curse or status. The cards are free or cheap, so
 * cost is ignored. One exception: cards put from the hand back on top of the draw pile
 * (Thinking Ahead) are the worst ranked, so the best cards stay playable this turn.
 */
export function chooseGenerated(
  request: ChoiceRequest,
  order: readonly StrategyGroup[] = DEFAULT_ORDER,
): ChoiceResponse {
  const ranked = request.options
    .map((c, i) => ({ c, i, rank: groupRank(c, order), score: groupScore(c) }))
    .sort((a, b) => a.rank - b.rank || b.score - a.score || a.i - b.i);
  if (request.purpose === 'move' && request.from === 'hand' && request.to?.startsWith('draw')) ranked.reverse();
  const junk = order.length + 1;
  const wanted = request.min < request.max ? ranked.filter((x) => x.rank < junk) : ranked;
  const picked = wanted.slice(0, request.max);
  for (const x of ranked) {
    if (picked.length >= request.min) break;
    if (!picked.includes(x)) picked.push(x);
  }
  return { uids: picked.map((x) => x.c.uid) };
}
