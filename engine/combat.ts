import { createRng } from './rng';
import { patternMoveIds, patternPool, resolveEnemy } from './enemy';
import { attackDamage, attackHits, blockGain, isPlayable } from './rules';
import { chooseExhaust, createStrategy } from './strategies';
import {
  HAND_LIMIT,
  TURN_CAP,
  type CardDef,
  type CardFilter,
  type CardInstance,
  type CharacterDef,
  type ChoiceRequest,
  type CombatConfig,
  type CombatCounters,
  type CombatResult,
  type CombatState,
  type DebuffKind,
  type Debuffs,
  type Effect,
  type EnemyDef,
  type EnemyIntent,
  type EnemyMove,
  type GameData,
  type GameEvent,
  type Outcome,
  type PileName,
  type PowerId,
  type Rng,
  type RunCombat,
  type Side,
  type Strategy,
  type StrategyView,
} from './types';

/** Safety guard: at most this many decisions per player turn. */
export const MAX_DECISIONS_PER_TURN = 50;

const DEBUFF_KINDS: readonly DebuffKind[] = ['vulnerable', 'weak', 'frail'];

// ---------------------------------------------------------------------------
// Intent and card instances (exported for tests)
// ---------------------------------------------------------------------------

/** Intent for an enemy move as the player sees it right now. */
export function computeIntent(
  moveId: string,
  move: { name: string; effects: readonly Effect[] },
  enemy: { strength: number; debuffs: Debuffs },
  player: { debuffs: Debuffs },
): EnemyIntent {
  const attacks: EnemyIntent['attacks'] = [];
  let totalIncoming = 0;
  for (const e of move.effects) {
    if (e.type !== 'attack') continue;
    const dph = attackDamage(e.damage, enemy.strength, enemy.debuffs.weak, player.debuffs.vulnerable);
    attacks.push({ damagePerHit: dph, hits: e.hits });
    totalIncoming += dph * e.hits;
  }
  return { moveId, name: move.name, attacks, totalIncoming };
}

/** Resolve a CardDef (optionally upgraded) into a CardInstance. */
export function makeCardInstance(def: CardDef, upgraded: boolean, uid: number): CardInstance {
  const up = upgraded ? def.upgraded : null;
  if (upgraded && !up) {
    throw new Error(`Card ${def.id} cannot be upgraded`);
  }
  const keywords = [...(up?.keywords ?? def.keywords)];
  const effects = (up?.effects ?? def.effects).map((e) => ({ ...e }));
  let cost: number | null = up?.cost !== undefined ? up.cost : def.cost;
  if (keywords.includes('unplayable')) cost = null;
  const inst: CardInstance = {
    uid,
    cardId: def.id,
    name: upgraded ? `${def.name}+` : def.name,
    type: def.type,
    upgraded,
    cost,
    keywords,
    effects,
  };
  if (def.xCost) {
    inst.cost = cost === null ? null : 0;
    inst.xCost = true;
  }
  // #108: the card's own triggers (Drum of Battle); an upgrade replaces the list.
  const triggers = up?.triggers ?? def.triggers;
  if (triggers) inst.triggers = triggers.map((t) => ({ when: t.when, effects: t.effects.map((e) => ({ ...e })) }));
  return inst;
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

interface Fighter {
  hp: number;
  block: number;
  strength: number;
  debuffs: Debuffs;
}

function emptyDebuffs(): Debuffs {
  return { vulnerable: 0, weak: 0, frail: 0 };
}

/** The combat deck: config deck in order, then Ascension cards. uids 0..n-1. */
function buildDeck(data: GameData, config: CombatConfig): CardInstance[] {
  const deck: CardInstance[] = [];
  const addCard = (cardId: string, upgraded: boolean) => {
    const def = data.cards[cardId];
    if (!def) throw new Error(`Unknown card "${cardId}"`);
    if (!def.simulated) throw new Error(`Card "${def.name}" is not supported by the simulator yet`);
    const triggers = [...(def.triggers ?? []), ...(def.upgraded?.triggers ?? [])];
    const open = triggers.find((t) => !SIMULATED_TRIGGERS.includes(t.when));
    if (open) throw new Error(`Card trigger "${open.when}" is not simulated yet`);
    deck.push(makeCardInstance(def, upgraded, deck.length));
  };
  for (const entry of config.deck) {
    for (let i = 0; i < entry.count; i++) addCard(entry.cardId, entry.upgraded);
  }
  for (const ac of data.manifest.ascensionCards) {
    if (ac.level <= config.ascension) addCard(ac.cardId, false);
  }
  return deck;
}

/** The enemy with Ascension applied, after checking its pattern only names known moves. */
function resolveCheckedEnemy(data: GameData, config: CombatConfig): EnemyDef {
  const baseEnemy = data.enemies[config.enemyId];
  if (!baseEnemy) throw new Error(`Unknown enemy "${config.enemyId}"`);
  const enemyDef = resolveEnemy(baseEnemy, config.ascension);
  const { pattern } = enemyDef;
  const pool = patternPool(pattern);
  if (pool.length === 0) throw new Error(`Enemy ${enemyDef.id} has an empty pattern`);
  if (pattern.type === 'random' && pattern.noRepeat && pool.length < 2) {
    throw new Error(`Enemy ${enemyDef.id}: a no-repeat random pattern needs at least 2 moves`);
  }
  for (const id of patternMoveIds(pattern)) {
    if (!enemyDef.moves[id]) throw new Error(`Enemy ${enemyDef.id} pattern uses unknown move "${id}"`);
  }
  return enemyDef;
}

/**
 * Innate rule (#2): Innate cards go on top of the draw pile at the start of combat, keeping
 * their shuffled relative order. The turn-1 draw is the normal amount; Innate cards beyond it
 * stay on top for later turns. Uses no randomness.
 */
export function innateOnTop(drawPile: CardInstance[]): CardInstance[] {
  const innate = drawPile.filter((c) => c.keywords.includes('innate'));
  if (innate.length === 0) return drawPile;
  return [...drawPile.filter((c) => !c.keywords.includes('innate')), ...innate];
}

function emptyCounters(): CombatCounters {
  return {
    hpLostThisTurn: 0,
    hpLostThisCombat: 0,
    hpLossesThisCombat: 0,
    cardsPlayedThisTurn: 0,
    cardsPlayedThisCombat: 0,
    attacksPlayedThisTurn: 0,
    skillsPlayedThisTurn: 0,
    cardsExhaustedThisTurn: 0,
    cardsExhaustedThisCombat: 0,
    cardsDrawnThisTurn: 0,
    cardsDrawnThisCombat: 0,
  };
}

/**
 * True when `card` matches every present field of `filter` (#107: Pillage's non-Attack stop rule).
 * Fields whose rules are still open (rarity, nameIncludes, noReplay) throw until their cards land.
 */
export function matchesFilter(card: CardInstance, filter: CardFilter): boolean {
  for (const field of ['rarity', 'nameIncludes', 'noReplay'] as const) {
    if (filter[field] !== undefined) throw new Error(`Card filter "${field}" is not simulated yet`);
  }
  if (filter.types && !filter.types.includes(card.type)) return false;
  if (filter.notTypes?.includes(card.type)) return false;
  if (filter.cardId !== undefined && card.cardId !== filter.cardId) return false;
  if (filter.upgraded !== undefined && card.upgraded !== filter.upgraded) return false;
  return true;
}

/** #108: card triggers the engine runs; the others (#114, #115) are not simulated yet. */
const SIMULATED_TRIGGERS: readonly string[] = ['exhausted'];

/** #108: per-hit damage an Attack adds to Thrash: its first attack effect's base damage plus its own bonus. */
export function perHitBaseDamage(card: CardInstance): number {
  for (const e of card.effects) {
    if (e.type === 'attack' || e.type === 'attackFrom') return e.damage + (card.damageBonus ?? 0);
  }
  return 0;
}

/** Safety guard: at most this many cards drawn by one `drawUntil` effect. */
const MAX_DRAW_UNTIL = 1000;

/**
 * #107/#109: player powers the engine simulates. `applyPower` with any other PowerId throws
 * "not simulated yet" (temporary powers #110, trigger powers #113, #115, #116).
 */
export const SIMULATED_POWER_IDS: readonly PowerId[] = [
  'noDraw',
  'demonForm',
  'energyPerTurn',
  'rollingBoulder',
  'crimsonMantle',
  'plating',
  'barricade',
  'cruelty',
  'dexterity',
  'fasten',
  'thorns',
  'vigorPerTurn',
  'vigor',
  'powersCostLess',
  'upgradeAtCombatEnd',
  'corruption',
];

/** #109 Rolling Boulder: its damage grows by this much after each hit ("increase this damage by 5"). */
export const ROLLING_BOULDER_GROWTH = 5;

/** #109 Crimson Mantle: HP lost at the start of each turn, however many copies were played (contract). */
export const CRIMSON_MANTLE_HP_LOSS = 1;

/** #109 Fasten (Trent, #109 Q1): it adds Block to every card with this in its name (Defend, Ultimate Defend). */
export const FASTEN_NAME = 'Defend';

/**
 * One combat in progress. Each method is a named step of the turn order in CLAUDE.md; all
 * randomness goes through `rng`, and events are recorded only when logging is on.
 */
class Combat {
  private readonly state: CombatState;
  private readonly log: GameEvent[] | null;
  private readonly rng: Rng;
  /** #109: Vigor added to every hit of the Attack card being played (0 otherwise). */
  private activeVigor = 0;

  constructor(
    private readonly config: CombatConfig,
    private readonly character: CharacterDef,
    private readonly enemyDef: EnemyDef,
    deck: CardInstance[],
    private readonly strategy: Strategy,
    logging: boolean,
  ) {
    this.log = logging ? [] : null;
    // RNG use order is fixed: (1) enemy HP, (2) random cycle start or first random pick (when
    // there is no opener), (3) shuffle. Later random picks happen right after each enemy move.
    this.rng = createRng(config.seed);
    const enemyHp = this.rng.int(enemyDef.hp.min, enemyDef.hp.max);
    const { pattern } = enemyDef;
    const startIndex =
      pattern.type === 'cycle' && pattern.start === 'random' ? this.rng.int(0, pattern.order.length - 1) : 0;
    const firstMove = pattern.opener?.[0] ?? this.poolMove(startIndex, null);
    this.rng.shuffle(deck);
    this.state = {
      turn: 0,
      player: {
        hp: character.maxHp,
        maxHp: character.maxHp,
        block: 0,
        energy: 0,
        strength: 0,
        debuffs: emptyDebuffs(),
        drawPile: innateOnTop(deck),
        hand: [],
        discardPile: [],
        exhaustPile: [],
        counters: emptyCounters(),
      },
      enemy: {
        enemyId: enemyDef.id,
        name: enemyDef.name,
        hp: enemyHp,
        maxHp: enemyHp,
        block: 0,
        strength: 0,
        debuffs: emptyDebuffs(),
        poison: 0,
        patternIndex: startIndex,
        movesMade: 0,
        nextMoveId: firstMove,
      },
    };
    this.log?.push({ t: 'combatStart', seed: config.seed, enemyHp, playerHp: character.maxHp });
    this.log?.push({ t: 'shuffle', reason: 'start', count: deck.length });
  }

  private get player() {
    return this.state.player;
  }

  private get enemy() {
    return this.state.enemy;
  }

  /** Turns until one side dies or the turn cap is reached. */
  run(): CombatResult {
    for (;;) {
      this.state.turn++;
      const started = this.startPlayerTurn();
      if (started) return this.finish(started);
      const played = this.playCards();
      if (played) return this.finish(played);
      this.endPlayerTurn();
      const outcome = this.enemyTurn();
      if (outcome) return this.finish(outcome);
      if (this.state.turn >= TURN_CAP) return this.finish('turnCap');
    }
  }

  private get counters(): CombatCounters {
    return this.state.player.counters as CombatCounters;
  }

  /**
   * "This turn" counters reset, block resets (not under Barricade, #109), energy refills, the
   * normal draw, then the start-of-turn powers (#109). Returns the outcome if a power ended combat
   * (Crimson Mantle's HP loss, Rolling Boulder's damage).
   */
  private startPlayerTurn(): Outcome | null {
    const { player, log, counters } = this;
    log?.push({ t: 'turnStart', turn: this.state.turn, side: 'player' });
    counters.hpLostThisTurn = 0;
    counters.cardsDrawnThisTurn = 0;
    counters.cardsExhaustedThisTurn = 0;
    if (!this.power('barricade')) {
      player.block = 0;
      log?.push({ t: 'blockReset', side: 'player' });
    }
    player.energy = this.character.energyPerTurn;
    for (let i = 0; i < this.character.drawPerTurn; i++) {
      if (!this.drawOne()) break;
    }
    return this.turnStartPowers();
  }

  /** #109: the current amount of a player power (0 when off). */
  private power(id: PowerId): number {
    return this.player.powers?.[id] ?? 0;
  }

  /**
   * #109 start-of-turn powers, after the draw, in the order the powers were first gained (the
   * order of PlayerState.powers). Plating drops by 1; Demon Form gains Strength; Pyre gains
   * energy; Prep Time gains Vigor; Crimson Mantle loses 1 HP, then gains Block; Rolling Boulder
   * deals its damage, then grows by 5. Returns the outcome if one of them ended combat.
   */
  private turnStartPowers(): Outcome | null {
    const { player, log } = this;
    if (!player.powers) return null;
    for (const id of Object.keys(player.powers) as PowerId[]) {
      const amount = this.power(id);
      if (amount <= 0) continue;
      switch (id) {
        case 'plating':
          this.applyPower('plating', -1);
          break;
        case 'demonForm':
          player.strength += amount;
          log?.push({ t: 'strength', side: 'player', amount, total: player.strength });
          break;
        case 'energyPerTurn':
          player.energy += amount;
          log?.push({ t: 'energy', amount, total: player.energy });
          break;
        case 'vigorPerTurn':
          this.applyPower('vigor', amount);
          break;
        case 'crimsonMantle':
          if (this.loseHp(CRIMSON_MANTLE_HP_LOSS)) return 'loss';
          this.gainPowerBlock(amount);
          break;
        case 'rollingBoulder':
          if (this.powerDamage(amount)) return 'win';
          this.applyPower('rollingBoulder', ROLLING_BOULDER_GROWTH);
          break;
        default:
          break;
      }
    }
    return null;
  }

  /** #109: Block from a power (Plating, Crimson Mantle): not a card, so Dexterity and Frail don't apply. */
  private gainPowerBlock(amount: number): void {
    const { player } = this;
    player.block += amount;
    this.log?.push({ t: 'block', side: 'player', amount, total: player.block });
  }

  /**
   * #109: damage to the enemy from a power (Rolling Boulder, Thorns): not an Attack, so Strength,
   * Weak, Vigor, Vulnerable and Cruelty don't change it; the enemy's Block absorbs it.
   * Returns true if the enemy died.
   */
  private powerDamage(amount: number): boolean {
    const { enemy } = this;
    const blocked = Math.min(enemy.block, amount);
    enemy.block -= blocked;
    const hpLoss = amount - blocked;
    enemy.hp -= hpLoss;
    this.log?.push({ t: 'damage', source: 'player', target: 'enemy', amount, blocked, hpLoss });
    return enemy.hp <= 0;
  }

  /**
   * #109: Block gained from a card's `gainBlock`: + Dexterity, + Fasten on cards named "Defend",
   * then Frail (×0.75, floored), minimum 0.
   */
  private cardBlock(amount: number, card: CardInstance): number {
    const fasten = card.name.includes(FASTEN_NAME) ? this.power('fasten') : 0;
    return blockGain(amount + this.power('dexterity') + fasten, this.player.debuffs.frail);
  }

  /**
   * The strategy plays cards until it ends its turn. Each decision gets a fresh view (current
   * hand and energy), so cards drawn mid-turn are considered. Returns the outcome if combat ended:
   * 'win' when the enemy died, 'loss' when the player's own card dropped them to 0 HP.
   */
  private playCards(): Outcome | null {
    const { player, enemy, log } = this;
    for (let decisions = 0; decisions < MAX_DECISIONS_PER_TURN; decisions++) {
      const decision = this.strategy.decide(this.view());
      if (decision.kind === 'endTurn') break;
      const idx = player.hand.findIndex((c) => c.uid === decision.uid);
      const card = idx >= 0 ? player.hand[idx] : undefined;
      if (!card || !isPlayable(card, player.energy)) {
        throw new Error(`Strategy tried to play illegal card uid ${decision.uid} on turn ${this.state.turn}`);
      }
      player.hand.splice(idx, 1);
      // X-cost: X is all the energy available, and the card spends all of it.
      const x = card.xCost ? player.energy : 0;
      player.energy -= card.xCost ? x : (card.cost as number);
      if (log) {
        const ev: GameEvent = { t: 'play', uid: card.uid, cardId: card.cardId, energyLeft: player.energy };
        if (card.xCost) ev.x = x;
        log.push(ev);
      }
      // #109 Vigor: an Attack adds all of it to every hit, then it is used up.
      const vigor = card.type === 'attack' ? this.power('vigor') : 0;
      this.activeVigor = vigor;
      const died = this.resolveEffects('player', card.effects, x, card);
      this.activeVigor = 0;
      if (vigor > 0) this.applyPower('vigor', -vigor);
      if (died === 'player' || player.hp <= 0) return 'loss';
      if (card.type === 'power') {
        // #109: a played Power leaves the deck for the rest of combat (no discard, no exhaust pile).
      } else if (card.keywords.includes('exhaust')) {
        this.exhaustCard(card, 'keyword');
      } else if (card.type === 'skill' && this.power('corruption')) {
        // #109 Corruption: a played Skill is exhausted (Drum of Battle still gains its energy).
        this.exhaustCard(card, 'power');
      } else {
        player.discardPile.push(card);
      }
      if (died === 'enemy' || enemy.hp <= 0) return 'win';
    }
    return null;
  }

  /** What the strategy sees right now: current hand, energy and the enemy's intent. */
  private view(): StrategyView {
    const { player, enemy } = this;
    const { id: moveId, move } = this.currentMove();
    return {
      state: this.state,
      intent: computeIntent(moveId, move, enemy, player),
      playable: player.hand.filter((c) => isPlayable(c, player.energy)),
    };
  }

  /** Plating Block (#109); Ethereal exhausts first (even if Retain), Retain stays, the rest is discarded; then player debuffs tick. */
  private endPlayerTurn(): void {
    const { player, log } = this;
    // #109 Plating: gain Block equal to it at the end of your turn.
    const plating = this.power('plating');
    if (plating > 0) this.gainPowerBlock(plating);
    const retained: CardInstance[] = [];
    for (const card of player.hand) {
      if (card.keywords.includes('ethereal')) {
        this.exhaustCard(card, 'ethereal');
      } else if (card.keywords.includes('retain')) {
        retained.push(card);
      } else {
        player.discardPile.push(card);
        log?.push({ t: 'discard', uid: card.uid, cardId: card.cardId, reason: 'endOfTurn' });
      }
    }
    player.hand = retained;
    // Battle Trance's no-draw lasts for the rest of this turn only.
    if (player.powers?.noDraw) {
      delete player.powers.noDraw;
      log?.push({ t: 'powerRemoved', side: 'player', power: 'noDraw' });
    }
    this.tickDebuffs('player');
    log?.push({ t: 'turnEnd', turn: this.state.turn, side: 'player' });
  }

  /** Block resets, Poison, the move, pattern advance, then enemy debuffs tick. Returns the outcome if combat ended. */
  private enemyTurn(): Outcome | null {
    const { player, enemy, log } = this;
    log?.push({ t: 'turnStart', turn: this.state.turn, side: 'enemy' });
    enemy.block = 0;
    log?.push({ t: 'blockReset', side: 'enemy' });
    // Poison: HP loss equal to stacks (ignores Block and modifiers), then -1. A kill ends combat before the move.
    if (enemy.poison > 0) {
      const amount = enemy.poison;
      enemy.hp -= amount;
      enemy.poison--;
      log?.push({ t: 'poisonDamage', amount, hpAfter: Math.max(enemy.hp, 0) });
      if (enemy.hp <= 0) return 'win';
    }
    const { id: moveId, move } = this.currentMove();
    log?.push({ t: 'enemyMove', moveId, name: move.name });
    const died = this.resolveEffects('enemy', move.effects);
    this.advancePattern(moveId);
    if (died === 'player' || player.hp <= 0) return 'loss';
    // #109 Thorns can kill the enemy during its own move.
    if (died === 'enemy' || enemy.hp <= 0) return 'win';
    // Debuffs on the enemy tick down at the end of the enemy's own turn, after its move.
    this.tickDebuffs('enemy');
    log?.push({ t: 'turnEnd', turn: this.state.turn, side: 'enemy' });
    return null;
  }

  private currentMove(): { id: string; move: EnemyMove } {
    const id = this.enemy.nextMoveId as string;
    return { id, move: this.enemyDef.moves[id]! };
  }

  /**
   * #4: the pool move after `last` (null at combat start). Cycle: order[patternIndex].
   * Random: a seeded pick from the pool, skipping `last` when the pattern says noRepeat.
   */
  private poolMove(patternIndex: number, last: string | null): string {
    const { pattern } = this.enemyDef;
    if (pattern.type === 'cycle') return pattern.order[patternIndex] as string;
    const options = pattern.noRepeat && last !== null ? pattern.moves.filter((id) => id !== last) : pattern.moves;
    return options[this.rng.int(0, options.length - 1)] as string;
  }

  /** #4: after a move: opener moves first, then the cycle advances (only past cycle moves) or a random pick. */
  private advancePattern(lastMoveId: string): void {
    const { enemy } = this;
    const { pattern } = this.enemyDef;
    const openerLength = pattern.opener?.length ?? 0;
    const made = (enemy.movesMade ?? 0) + 1;
    enemy.movesMade = made;
    if (made < openerLength) {
      enemy.nextMoveId = pattern.opener![made];
      return;
    }
    if (pattern.type === 'cycle' && made > openerLength) {
      enemy.patternIndex = (enemy.patternIndex + 1) % pattern.order.length;
    }
    enemy.nextMoveId = this.poolMove(enemy.patternIndex, lastMoveId);
  }

  private fighter(side: Side): Fighter {
    return side === 'player' ? this.player : this.enemy;
  }

  /**
   * Resolve effects from `source`. Attacks and debuffs hit the opponent; block
   * and Strength go to the source. Stops and returns the side that died, if one did.
   * `card` is the player's card being played (its damage bonus, Thrash), absent for enemy moves.
   */
  private resolveEffects(source: Side, effects: readonly Effect[], x = 0, card?: CardInstance): Side | null {
    const { player, enemy, log } = this;
    const other: Side = source === 'player' ? 'enemy' : 'player';
    const self = this.fighter(source);
    /** #108 `lastEffectCount`: cards exhausted by the previous effect of this list (0 for other effects). */
    let lastCount = 0;
    for (const e of effects) {
      let count = 0;
      let died: Side | null = null;
      switch (e.type) {
        case 'attack':
          died = this.attack(source, other, e.damage + (card?.damageBonus ?? 0), attackHits(e, x));
          break;
        case 'gainBlock': {
          // #109: Block from a card gets Dexterity and Fasten; other Block (enemy moves, triggers) does not.
          const amt =
            source === 'player' && card ? this.cardBlock(e.amount, card) : blockGain(e.amount, self.debuffs.frail);
          self.block += amt;
          log?.push({ t: 'block', side: source, amount: amt, total: self.block });
          break;
        }
        case 'gainStrength':
          self.strength += e.amount;
          log?.push({ t: 'strength', side: source, amount: e.amount, total: self.strength });
          break;
        case 'applyVulnerable':
          this.applyDebuff(other, 'vulnerable', e.amount);
          break;
        case 'applyWeak':
          this.applyDebuff(other, 'weak', e.amount);
          break;
        case 'applyFrail':
          this.applyDebuff(other, 'frail', e.amount);
          break;
        case 'applyShrink': {
          // #4: enemy moves only. Does not stack: a second Shrink keeps the larger percent.
          if (source !== 'enemy') throw new Error('Shrink on enemies is not simulated yet');
          player.shrink = Math.max(player.shrink ?? 0, e.amount);
          log?.push({ t: 'shrink', percent: player.shrink });
          break;
        }
        case 'applyPoison':
          if (source !== 'player') throw new Error('Poison on the player is not simulated yet');
          enemy.poison += e.amount;
          log?.push({ t: 'poison', amount: e.amount, total: enemy.poison });
          break;
        case 'gainEnergy':
          if (source !== 'player') throw new Error('Enemies have no energy');
          player.energy += e.amount;
          log?.push({ t: 'energy', amount: e.amount, total: player.energy });
          break;
        case 'gainStars':
          throw new Error('Stars are not simulated yet');
        case 'loseHp':
          if (source !== 'player') throw new Error(`Effect "loseHp" is not simulated yet on enemy moves`);
          if (this.loseHp(e.amount)) return 'player';
          break;
        case 'draw':
          if (source !== 'player') throw new Error('Enemies do not draw cards');
          this.drawCards(e.amount);
          break;
        case 'drawUntil':
          if (source !== 'player') throw new Error('Enemies do not draw cards');
          this.drawUntil(e.stopOn);
          break;
        case 'applyPower':
          if (source !== 'player' || !SIMULATED_POWER_IDS.includes(e.power)) {
            throw new Error(`Effect "applyPower" is not simulated yet (power "${e.power}")`);
          }
          this.applyPower(e.power, e.amount);
          break;
        case 'exhaustCards':
          if (source !== 'player') throw new Error('Effect "exhaustCards" is not simulated yet on enemy moves');
          ({ count, died } = this.exhaustCards(e, card));
          break;
        case 'repeat': {
          // #108: only "for each card Exhausted" (Second Wind) so far; other counters are #111.
          if (source !== 'player' || e.per !== 'lastEffectCount') {
            throw new Error(`Effect "repeat" is not simulated yet (counter "${e.per}")`);
          }
          const n = lastCount * (e.times ?? 1);
          for (let i = 0; i < n && !died; i++) died = this.resolveEffects(source, e.effects, x, card);
          break;
        }
        case 'script':
          if (source === 'player' && e.id === 'fiendFire') died = this.fiendFire(e.values?.[0] ?? 0);
          else if (source === 'player' && e.id === 'thrash') died = this.thrash(card);
          else throw new Error(`Effect "script" is not simulated yet (id "${e.id}")`);
          break;
        default:
          // #105: declared in the contract, implemented by later mechanic cards.
          throw new Error(`Effect "${e.type}" is not simulated yet`);
      }
      if (died) return died;
      lastCount = count;
    }
    return null;
  }

  /** #108: the cards of a pile (the live array). */
  private pile(name: PileName): CardInstance[] {
    const p = this.player;
    switch (name) {
      case 'hand':
        return p.hand;
      case 'draw':
        return p.drawPile;
      case 'discard':
        return p.discardPile;
      case 'exhaust':
        throw new Error('Exhausting from the exhaust pile is not possible');
    }
  }

  /**
   * #108: move one card (already out of its pile) to the exhaust pile, count it, then run its
   * "when exhausted" triggers (Drum of Battle). Returns the side that died, if one did.
   */
  private exhaustCard(card: CardInstance, reason: 'ethereal' | 'keyword' | 'effect' | 'power'): Side | null {
    const { player, counters } = this;
    player.exhaustPile.push(card);
    this.log?.push({ t: 'exhaust', uid: card.uid, cardId: card.cardId, reason });
    counters.cardsExhaustedThisTurn++;
    counters.cardsExhaustedThisCombat++;
    for (const t of card.triggers ?? []) {
      if (t.when !== 'exhausted') continue;
      const died = this.resolveEffects('player', t.effects);
      if (died) return died;
    }
    return null;
  }

  /** #108: take these cards out of `from` and exhaust them one by one, in order. */
  private exhaustAll(from: PileName, picked: readonly CardInstance[]): { count: number; died: Side | null } {
    let count = 0;
    for (const c of picked) {
      const pile = this.pile(from);
      const i = pile.indexOf(c);
      if (i < 0) continue;
      pile.splice(i, 1);
      count++;
      const died = this.exhaustCard(c, 'effect');
      if (died) return { count, died };
    }
    return { count, died: null };
  }

  /**
   * #108 `exhaustCards`: pick qualifying cards of the pile (the played card is already out of the
   * hand) by mode — every one, at random (seeded Rng), the top ones, or by Strategy.choose (the
   * shared exhaust order when the strategy has no `choose`) — and exhaust them.
   */
  private exhaustCards(
    e: Extract<Effect, { type: 'exhaustCards' }>,
    card: CardInstance | undefined,
  ): { count: number; died: Side | null } {
    const from = e.from ?? 'hand';
    const candidates = this.pile(from).filter((c) => !e.filter || matchesFilter(c, e.filter));
    const n = Math.min(e.count ?? candidates.length, candidates.length);
    let picked: CardInstance[];
    switch (e.mode) {
      case 'all':
        picked = candidates;
        break;
      case 'random': {
        const pool = [...candidates];
        picked = [];
        for (let i = 0; i < n; i++) picked.push(pool.splice(this.rng.int(0, pool.length - 1), 1)[0]!);
        break;
      }
      case 'top':
        picked = candidates.slice(candidates.length - n).reverse();
        break;
      case 'choose': {
        const min = e.upTo ? 0 : n;
        // Nothing to pick, or every candidate must go: no choice to make.
        if (n === 0 || (min === candidates.length && !e.upTo)) {
          picked = candidates.slice(0, n);
        } else {
          const request: ChoiceRequest = { purpose: 'exhaust', from, to: 'exhaust', options: candidates, min, max: n };
          if (card) {
            request.sourceUid = card.uid;
            request.sourceCardId = card.cardId;
          }
          picked = this.choose(request, candidates);
        }
        break;
      }
    }
    return this.exhaustAll(from, picked);
  }

  /** #108: ask the strategy to pick cards (the shared exhaust order if it has no `choose`) and check the answer. */
  private choose(request: ChoiceRequest, options: readonly CardInstance[]): CardInstance[] {
    const view = this.view();
    const { uids } = this.strategy.choose ? this.strategy.choose(view, request) : chooseExhaust(view, request);
    const picked = uids.map((uid) => options.find((c) => c.uid === uid));
    if (
      uids.length < request.min ||
      uids.length > request.max ||
      new Set(uids).size !== uids.length ||
      picked.some((c) => !c)
    ) {
      throw new Error(
        `Strategy made an illegal ${request.purpose} choice [${uids.join(', ')}] on turn ${this.state.turn}`,
      );
    }
    return picked as CardInstance[];
  }

  /**
   * #108 Fiend Fire: exhaust every other card in hand, then deal `perCard` damage once per card
   * exhausted (one hit each; Strength and modifiers apply per hit). Fiend Fire itself doesn't count.
   */
  private fiendFire(perCard: number): Side | null {
    const { count, died } = this.exhaustAll('hand', [...this.player.hand]);
    if (died) return died;
    return count > 0 ? this.attack('player', 'enemy', perCard, count) : null;
  }

  /**
   * #108 Thrash: exhaust a random Attack in hand (seeded Rng) and add its per-hit base damage to
   * this Thrash copy for the rest of combat (stacks). Nothing happens with no Attack in hand.
   */
  private thrash(card: CardInstance | undefined): Side | null {
    const attacks = this.player.hand.filter((c) => c.type === 'attack');
    if (attacks.length === 0) return null;
    const target = attacks[this.rng.int(0, attacks.length - 1)]!;
    const bonus = perHitBaseDamage(target);
    const { died } = this.exhaustAll('hand', [target]);
    if (card) card.damageBonus = (card.damageBonus ?? 0) + bonus;
    return died;
  }

  /** #106: the player loses HP directly (ignores Block; not an attack). Returns true if they died. */
  private loseHp(amount: number): boolean {
    const { player } = this;
    player.hp -= amount;
    this.recordHpLoss(amount);
    this.log?.push({ t: 'loseHp', side: 'player', amount, hpAfter: Math.max(player.hp, 0) });
    return player.hp <= 0;
  }

  /** #106: tallies for every drop in the player's HP, from any source. A drop of 0 is not a loss. */
  private recordHpLoss(amount: number): void {
    if (amount <= 0) return;
    const c = this.counters;
    c.hpLostThisTurn += amount;
    c.hpLostThisCombat += amount;
    c.hpLossesThisCombat++;
  }

  /**
   * #107/#109: change a player power by `amount` (stacks add; negative reduces). A power that
   * reaches 0 is removed (powerRemoved). Corruption and Curious change card costs at once.
   */
  private applyPower(power: PowerId, amount: number): void {
    const powers = (this.player.powers ??= {});
    const total = (powers[power] ?? 0) + amount;
    if (total <= 0) {
      delete powers[power];
      this.log?.push({ t: 'powerRemoved', side: 'player', power });
      return;
    }
    powers[power] = total;
    this.log?.push({ t: 'powerApplied', side: 'player', power, amount, total });
    if (power === 'corruption' || power === 'powersCostLess') this.applyCostPower(power, amount);
  }

  /**
   * #109: Corruption sets every Skill's cost to 0; Curious lowers every Power's cost by `amount`
   * (minimum 0). Applied to the card instances in every pile, for the rest of combat, so
   * strategies and isPlayable see the new cost. X-cost and unplayable cards are unchanged.
   */
  private applyCostPower(power: 'corruption' | 'powersCostLess', amount: number): void {
    const p = this.player;
    for (const pile of [p.hand, p.drawPile, p.discardPile, p.exhaustPile]) {
      for (const c of pile) {
        if (c.cost === null || c.xCost) continue;
        if (power === 'corruption' && c.type === 'skill') c.cost = 0;
        if (power === 'powersCostLess' && c.type === 'power') c.cost = Math.max(0, c.cost - amount);
      }
    }
  }

  /** #107: true while Battle Trance's no-draw is active; it blocks every draw from any source. */
  private drawBlocked(): boolean {
    return (this.player.powers?.noDraw ?? 0) > 0;
  }

  /** #107: draw `amount` cards one by one (full hand → discarded, as at turn start). */
  private drawCards(amount: number): void {
    for (let i = 0; i < amount; i++) {
      if (this.drawBlocked() || !this.drawOne()) return;
    }
  }

  /**
   * #107: draw one card at a time. Stops when the hand is full (Scrawl), after drawing a card
   * matching `stopOn` (Pillage), when nothing is left to draw, or when drawing is blocked.
   * It never draws into a full hand, so it never discards for the hand limit.
   */
  private drawUntil(stopOn: CardFilter | undefined): void {
    for (let i = 0; i < MAX_DRAW_UNTIL; i++) {
      if (this.drawBlocked() || this.player.hand.length >= HAND_LIMIT) return;
      const card = this.drawOne();
      if (!card) return;
      if (stopOn && matchesFilter(card, stopOn)) return;
    }
  }

  /**
   * Deal one attack effect, hit by hit (Block absorbs hits in order). The player's attacks add
   * Vigor to the base (#109) and Cruelty to Vulnerable. After each enemy hit on the player
   * (blocked or not) Thorns deals its damage back (#109). Returns the side that died, if one did.
   */
  private attack(source: Side, target: Side, damage: number, hits: number): Side | null {
    const a = this.fighter(source);
    const t = this.fighter(target);
    const base = damage + (source === 'player' ? this.activeVigor : 0);
    const cruelty = target === 'enemy' ? this.power('cruelty') : 0;
    // #4 Shrink is on the player only (v1), so only the player's attacks shrink.
    const shrink = source === 'player' ? (this.player.shrink ?? 0) : 0;
    const perHit = attackDamage(base, a.strength, a.debuffs.weak, t.debuffs.vulnerable, cruelty, shrink);
    for (let h = 0; h < hits; h++) {
      const blocked = Math.min(t.block, perHit);
      t.block -= blocked;
      const hpLoss = perHit - blocked;
      t.hp -= hpLoss;
      this.log?.push({ t: 'damage', source, target, amount: perHit, blocked, hpLoss });
      if (target === 'player') this.recordHpLoss(hpLoss);
      if (t.hp <= 0) return target;
      const thorns = target === 'player' ? this.power('thorns') : 0;
      if (thorns > 0 && this.powerDamage(thorns)) return source;
    }
    return null;
  }

  private applyDebuff(side: Side, kind: DebuffKind, amount: number): void {
    const f = this.fighter(side);
    f.debuffs[kind] += amount;
    this.log?.push({ t: 'debuff', side, kind, amount, total: f.debuffs[kind] });
  }

  /**
   * Draw one card, reshuffling the discard pile if the draw pile is empty. Returns the card
   * (in hand, or discarded when the hand is full), or null when both piles are empty.
   */
  private drawOne(): CardInstance | null {
    const { player, log } = this;
    if (player.drawPile.length === 0) {
      if (player.discardPile.length === 0) return null;
      player.drawPile = player.discardPile;
      player.discardPile = [];
      this.rng.shuffle(player.drawPile);
      log?.push({ t: 'shuffle', reason: 'reshuffle', count: player.drawPile.length });
    }
    const card = player.drawPile.pop() as CardInstance;
    log?.push({ t: 'draw', uid: card.uid, cardId: card.cardId });
    this.counters.cardsDrawnThisTurn++;
    this.counters.cardsDrawnThisCombat++;
    if (player.hand.length >= HAND_LIMIT) {
      player.discardPile.push(card);
      log?.push({ t: 'discard', uid: card.uid, cardId: card.cardId, reason: 'handLimit' });
    } else {
      player.hand.push(card);
    }
    return card;
  }

  /** Each debuff on `side` goes down by 1 (at the end of that side's turn). */
  private tickDebuffs(side: Side): void {
    const f = this.fighter(side);
    for (const kind of DEBUFF_KINDS) {
      if (f.debuffs[kind] > 0) {
        f.debuffs[kind]--;
        this.log?.push({ t: 'debuffTick', side, kind, total: f.debuffs[kind] });
      }
    }
  }

  private finish(outcome: Outcome): CombatResult {
    const { player, enemy, log } = this;
    const hpLost = player.maxHp - Math.max(player.hp, 0);
    const result: CombatResult = {
      seed: this.config.seed,
      outcome,
      turns: this.state.turn,
      hpLost,
      enemyHpRemaining: Math.max(enemy.hp, 0),
    };
    if (log) {
      log.push({ t: 'combatEnd', outcome, turns: this.state.turn, hpLost });
      result.log = log;
    }
    return result;
  }
}

/**
 * Run one combat with an explicit Strategy object. `runCombat` builds the
 * strategy from `config.strategy`; tests use this to script exact plays.
 */
export function simulateCombat(
  data: GameData,
  config: CombatConfig,
  strategy: Strategy,
  options?: { log?: boolean },
): CombatResult {
  const character = data.characters[config.characterId];
  if (!character) throw new Error(`Unknown character "${config.characterId}"`);
  const enemyDef = resolveCheckedEnemy(data, config);
  const deck = buildDeck(data, config);
  return new Combat(config, character, enemyDef, deck, strategy, options?.log === true).run();
}

export const runCombat: RunCombat = (data, config, options) =>
  simulateCombat(data, config, createStrategy(config.strategy), options);
