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
 * - `cost` matches the printed (base) cost; unplayable and hidden / multiplayer-only cards never qualify;
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
        (pool.cost === undefined || c.cost === pool.cost) &&
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

/**
 * Pick which generated card to keep: the first group in the strategy's priority order that has
 * a card (Attack: most damage; Block: most Block; Powers: the first), else the first option.
 * Ties go to the earlier option. The cards are free or cheap, so cost is ignored.
 */
export function chooseGenerated(
  request: ChoiceRequest,
  order: readonly StrategyGroup[] = DEFAULT_ORDER,
): ChoiceResponse {
  const options = request.options;
  const pick = (cards: readonly Card[], score: (c: Card) => number): Card | undefined => {
    let best: Card | undefined;
    for (const c of cards) if (best === undefined || score(c) > score(best)) best = c;
    return best;
  };
  let chosen: Card | undefined;
  for (const group of order) {
    if (group === 'attack')
      chosen = pick(
        options.filter((c) => c.type === 'attack'),
        damageOf,
      );
    else if (group === 'block')
      chosen = pick(
        options.filter((c) => c.type === 'skill' && blockOf(c) > 0),
        blockOf,
      );
    else
      chosen = pick(
        options.filter((c) => c.type === 'power'),
        () => 0,
      );
    if (chosen) break;
  }
  chosen ??= options[0];
  return { uids: chosen && request.max > 0 ? [chosen.uid] : [] };
}
