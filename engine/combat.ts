import { createRng } from './rng';
import { cardPool, chooseGenerated } from './generate';
import { patternMoveIds, patternPool, resolveEnemy } from './enemy';
import { attackDamage, attackHits, blockGain, isPlayable } from './rules';
import { chooseExhaust, createStrategy } from './strategies';
import {
  HAND_LIMIT,
  TURN_CAP,
  type CardDef,
  type CardDestination,
  type SelectMode,
  type CardFilter,
  type CardInstance,
  type CardPool,
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
    rarity: def.rarity,
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
 * Fields whose rules are still open (nameIncludes, noReplay) throw until their cards land.
 */
export function matchesFilter(card: CardInstance, filter: CardFilter): boolean {
  for (const field of ['nameIncludes', 'noReplay'] as const) {
    if (filter[field] !== undefined) throw new Error(`Card filter "${field}" is not simulated yet`);
  }
  if (filter.rarity && (card.rarity === undefined || !filter.rarity.includes(card.rarity))) return false;
  if (filter.types && !filter.types.includes(card.type)) return false;
  if (filter.notTypes?.includes(card.type)) return false;
  if (filter.cardId !== undefined && card.cardId !== filter.cardId) return false;
  if (filter.upgraded !== undefined && card.upgraded !== filter.upgraded) return false;
  return true;
}

/** Card triggers the engine runs (#108 exhausted, #115 drawn and turnEndInHand); the rest wait for #114. */
const SIMULATED_TRIGGERS: readonly string[] = ['exhausted', 'drawn', 'turnEndInHand'];

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
  'calamity',
  'helloWorld',
  'entropy',
  'intangible',
  'gambit',
];

/** #116 Hello World: a random Common card from the player's character. */
const HELLO_WORLD_POOL: CardPool = { character: 'own', rarity: ['common'] };

/** #116 Entropy: a transformed card becomes any random card of the player's character. */
const ENTROPY_POOL: CardPool = { character: 'own' };

/** #116 Calamity: each Attack played adds a random Attack of the player's character. */
const CALAMITY_POOL: CardPool = { character: 'own', types: ['attack'] };

/** #109 Rolling Boulder: its damage grows by this much after each hit ("increase this damage by 5"). */
export const ROLLING_BOULDER_GROWTH = 5;

/** #109/#135 Crimson Mantle: HP lost at the start of each turn per copy played. */
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
  /** #135: each Rolling Boulder played is its own instance with its own damage (the sum is in powers). */
  private boulders: number[] = [];
  /** #135: Crimson Mantle copies played; each loses 1 HP a turn and adds its own Block. */
  private mantleCopies = 0;
  /** #116: uid for the next created card (the deck uses 0..n-1). */
  private nextUid: number;
  /** #116: pools already computed, keyed by pool + upgraded. */
  private readonly pools = new Map<string, CardDef[]>();
  /** #112: cards played with `moveSelf` (nextTurnStart) that come back at the start of the next turn. */
  private returning: { uid: number; to: CardDestination }[] = [];
  /** #116: cost a card had before it became free this turn (restored at the end of the turn). */
  private readonly freeBackup = new Map<number, number | null>();
  /** #115: Max HP at the start of combat; `hpLost` is measured against it (Feed and healing lower it). */
  private readonly startMaxHp: number;
  /** #104: gold and potions gained so far this combat (rewards only; no combat effect). */
  private gold = 0;
  private potions = 0;

  constructor(
    private readonly data: GameData,
    private readonly config: CombatConfig,
    private readonly character: CharacterDef,
    private readonly enemyDef: EnemyDef,
    deck: CardInstance[],
    private readonly strategy: Strategy,
    logging: boolean,
  ) {
    this.log = logging ? [] : null;
    this.nextUid = deck.length;
    this.startMaxHp = character.maxHp;
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
      const ended = this.endPlayerTurn();
      if (ended) return this.finish(ended);
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
    this.returnCards();
    for (let i = 0; i < this.character.drawPerTurn; i++) {
      if (!this.drawOne()) break;
      if (player.hp <= 0) return 'loss';
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
          if (this.loseHp(CRIMSON_MANTLE_HP_LOSS * this.mantleCopies)) return 'loss';
          this.gainPowerBlock(amount);
          break;
        case 'rollingBoulder':
          // #135: every instance hits and grows on its own.
          for (let i = 0; i < this.boulders.length; i++) {
            if (this.powerDamage(this.boulders[i]!)) return 'win';
            this.boulders[i]! += ROLLING_BOULDER_GROWTH;
            player.powers!.rollingBoulder = (player.powers!.rollingBoulder ?? 0) + ROLLING_BOULDER_GROWTH;
            log?.push({
              t: 'powerApplied',
              side: 'player',
              power: 'rollingBoulder',
              amount: ROLLING_BOULDER_GROWTH,
              total: this.boulders[i]!,
            });
          }
          break;
        case 'helloWorld':
          this.addCards({
            type: 'addCards',
            source: { kind: 'random', pool: HELLO_WORLD_POOL },
            count: amount,
            to: 'hand',
          });
          break;
        case 'entropy':
          this.transformCards({
            type: 'transformCards',
            from: 'hand',
            count: amount,
            mode: 'random',
            into: { kind: 'random', pool: ENTROPY_POOL },
          });
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
      // #116 Calamity: after an Attack is played, add random Attack(s) to the hand.
      const calamity = card.type === 'attack' ? this.power('calamity') : 0;
      if (calamity > 0) {
        this.addCards({
          type: 'addCards',
          source: { kind: 'random', pool: CALAMITY_POOL },
          count: calamity,
          to: 'hand',
        });
      }
    }
    return null;
  }

  /** What the strategy sees right now: current hand, energy and the enemy's intent. */
  private view(): StrategyView {
    const { player } = this;
    const { id: moveId, move } = this.currentMove();
    return {
      state: this.state,
      intent: this.intent(moveId, move),
      playable: player.hand.filter((c) => isPlayable(c, player.energy)),
    };
  }

  /** #115: the intent the player sees: a Stunned enemy does nothing; Intangible makes every hit 1. */
  private intent(moveId: string, move: EnemyMove): EnemyIntent {
    const { enemy, player } = this;
    if (this.enemyStunned()) return { moveId, name: move.name, attacks: [], totalIncoming: 0 };
    const intent = computeIntent(moveId, move, enemy, player);
    if (this.power('intangible') <= 0) return intent;
    const attacks = intent.attacks.map((a) => ({ ...a, damagePerHit: Math.min(a.damagePerHit, 1) }));
    return { ...intent, attacks, totalIncoming: attacks.reduce((n, a) => n + a.damagePerHit * a.hits, 0) };
  }

  private enemyStunned(): boolean {
    return (this.enemy.powers?.stun ?? 0) > 0;
  }

  /** Plating Block (#109); Ethereal exhausts first (even if Retain), Retain stays, the rest is discarded; then player debuffs tick. */
  private endPlayerTurn(): Outcome | null {
    const { player, log } = this;
    // #109 Plating: gain Block equal to it at the end of your turn.
    const plating = this.power('plating');
    if (plating > 0) this.gainPowerBlock(plating);
    // #115: curses and statuses in hand act (Burn, Bad Luck), before the hand is discarded.
    for (const card of [...player.hand]) {
      if (this.runJunkTriggers(card, 'turnEndInHand')) return 'loss';
    }
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
    this.endFreeCosts();
    this.tickDebuffs('player');
    log?.push({ t: 'turnEnd', turn: this.state.turn, side: 'player' });
    return null;
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
    let died: Side | null = null;
    if (this.enemyStunned()) {
      // #115 Stun: the move is skipped (no damage) but the pattern still advances (#148 confirms).
      log?.push({ t: 'enemySkip', reason: 'stun' });
      this.applyEnemyPower('stun', -1);
    } else {
      log?.push({ t: 'enemyMove', moveId, name: move.name });
      died = this.resolveEffects('enemy', move.effects);
    }
    this.advancePattern(moveId);
    if (died === 'player' || player.hp <= 0) return 'loss';
    // #109 Thorns can kill the enemy during its own move.
    if (died === 'enemy' || enemy.hp <= 0) return 'win';
    // #115 Intangible lasts through the enemy's next move, then goes down by 1.
    if (this.power('intangible') > 0) this.applyPower('intangible', -1);
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
    for (const [index, e] of effects.entries()) {
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
        case 'applyEnemyPower':
          if (source !== 'player' || e.power !== 'stun') {
            throw new Error(`Effect "applyEnemyPower" is not simulated yet (power "${e.power}")`);
          }
          this.applyEnemyPower('stun', e.amount);
          break;
        case 'heal':
        case 'gainMaxHp':
        case 'loseMaxHp':
          if (source !== 'player') throw new Error(`Effect "${e.type}" is not simulated yet on enemy moves`);
          if (e.type === 'heal') this.heal(e.amount);
          else this.changeMaxHp(e.type === 'gainMaxHp' ? e.amount : -e.amount);
          break;
        case 'exhaustCards':
          if (source !== 'player') throw new Error('Effect "exhaustCards" is not simulated yet on enemy moves');
          ({ count, died } = this.exhaustCards(e, card));
          break;
        case 'repeat': {
          // #108: only "for each card Exhausted" (Second Wind) so far; other counters are #111.
          if (source !== 'player' || (e.per !== 'lastEffectCount' && e.per !== 'handSize')) {
            throw new Error(`Effect "repeat" is not simulated yet (counter "${e.per}")`);
          }
          // #115: handSize (Regret) counts the cards in hand when the effect starts.
          const n = (e.per === 'handSize' ? player.hand.length : lastCount) * (e.times ?? 1);
          for (let i = 0; i < n && !died; i++) died = this.resolveEffects(source, e.effects, x, card);
          break;
        }
        case 'addCards':
          if (source !== 'player') throw new Error('Enemies do not create cards');
          count = this.addCards(e, card);
          break;
        case 'transformCards':
          if (source !== 'player') throw new Error('Enemies do not transform cards');
          count = this.transformCards(e);
          break;
        case 'moveCards':
          if (source !== 'player') throw new Error('Enemies do not move cards');
          count = this.moveCards(e, card);
          break;
        case 'moveSelf':
          if (source !== 'player' || e.when !== 'nextTurnStart') {
            throw new Error(`Effect "moveSelf" is not simulated yet (when "${e.when}")`);
          }
          if (card) this.returning.push({ uid: card.uid, to: e.to });
          break;
        case 'upgradeCards':
          if (source !== 'player') throw new Error('Enemies do not upgrade cards');
          count = this.upgradeCards(e, card);
          break;
        case 'gainGold':
          if (source !== 'player') throw new Error('Enemies do not gain gold');
          this.gold += e.amount;
          break;
        case 'gainPotion':
          if (source !== 'player') throw new Error('Enemies do not gain potions');
          this.potions++;
          break;
        case 'conditional': {
          // #104: only "if Fatal". A kill returns early, so a fatal conditional right after the
          // killing attack is resolved at the return below; if this is reached, nothing was killed.
          if (source !== 'player' || e.if.kind !== 'fatal')
            throw new Error('Effect "conditional" is not simulated yet');
          // Reached here means the enemy is alive, so the condition is false.
          died = this.resolveEffects(source, e.else ?? [], x, card);
          break;
        }
        case 'script':
          if (source === 'player' && e.id === 'primalForcePlus') count = this.primalForcePlus();
          else if (source === 'player' && e.id === 'fiendFire') died = this.fiendFire(e.values?.[0] ?? 0);
          else if (source === 'player' && e.id === 'thrash') died = this.thrash(card);
          else throw new Error(`Effect "script" is not simulated yet (id "${e.id}")`);
          break;
        default:
          // #105: declared in the contract, implemented by later mechanic cards.
          throw new Error(`Effect "${e.type}" is not simulated yet`);
      }
      if (died) {
        // #104: the killing attack was followed by a fatal conditional: its `then` still resolves.
        const next = effects[index + 1];
        if (died === 'enemy' && source === 'player' && next?.type === 'conditional' && next.if.kind === 'fatal') {
          this.resolveEffects(source, next.then, x, card);
        }
        return died;
      }
      lastCount = count;
    }
    return null;
  }

  /** #112: like `pile`, but the exhaust pile too (cards can be moved out of it or upgraded in it). */
  private anyPile(name: PileName): CardInstance[] {
    return name === 'exhaust' ? this.player.exhaustPile : this.pile(name);
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
    const byPriority = request.purpose === 'generate' || request.purpose === 'move' || request.purpose === 'upgrade';
    const fallback = () => (byPriority ? chooseGenerated(request) : chooseExhaust(view, request));
    const { uids } = this.strategy.choose ? this.strategy.choose(view, request) : fallback();
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

  /**
   * #112: pick cards from `candidates` for a move or an upgrade by `e.mode`: every one, at random
   * (seeded Rng), the top ones, or by Strategy.choose. `options` shows only that many random
   * qualifying cards (Seeker Strike: 1 of 3). No choice is asked when nothing needs deciding.
   */
  private pickCards(
    purpose: 'move' | 'upgrade',
    candidates: CardInstance[],
    e: { mode: SelectMode; count?: number; upTo?: boolean; options?: number },
    ask: { from?: PileName; to?: CardDestination },
    card: CardInstance | undefined,
  ): CardInstance[] {
    const n = Math.min(e.count ?? candidates.length, candidates.length);
    switch (e.mode) {
      case 'all':
        return candidates;
      case 'top':
        return candidates.slice(candidates.length - n).reverse();
      case 'random': {
        const rest = [...candidates];
        const picked: CardInstance[] = [];
        for (let i = 0; i < n; i++) picked.push(rest.splice(this.rng.int(0, rest.length - 1), 1)[0]!);
        return picked;
      }
      case 'choose': {
        let shown = candidates;
        if (e.options !== undefined && e.options < shown.length) {
          const rest = [...shown];
          shown = [];
          for (let i = 0; i < e.options; i++) shown.push(rest.splice(this.rng.int(0, rest.length - 1), 1)[0]!);
        }
        const max = Math.min(e.count ?? shown.length, shown.length);
        // Nothing to pick, or every shown card must be picked: no choice to make.
        if (max === 0 || (!e.upTo && max === shown.length)) return shown.slice(0, max);
        const request: ChoiceRequest = { purpose, options: shown, min: e.upTo ? 0 : max, max, ...ask };
        if (card) {
          request.sourceUid = card.uid;
          request.sourceCardId = card.cardId;
        }
        return this.choose(request, shown);
      }
    }
  }

  /**
   * #112 `moveCards`: pick qualifying cards of the `from` pile and put them in `to` (a full hand
   * sends them to the discard pile). Returns how many moved.
   */
  private moveCards(e: Extract<Effect, { type: 'moveCards' }>, card: CardInstance | undefined): number {
    if (e.to === 'exhaust' || e.upgrade)
      throw new Error('Effect "moveCards" is not simulated yet (exhaust or upgrade)');
    const pile = this.anyPile(e.from);
    const candidates = pile.filter((c) => !e.filter || matchesFilter(c, e.filter));
    const picked = this.pickCards('move', candidates, e, { from: e.from, to: e.to }, card);
    let count = 0;
    for (const c of picked) {
      const i = pile.indexOf(c);
      if (i < 0) continue;
      pile.splice(i, 1);
      const to = this.placeCard(c, e.to);
      this.log?.push({ t: 'moved', uid: c.uid, cardId: c.cardId, from: e.from, to });
      count++;
    }
    return count;
  }

  /**
   * #112 `moveSelf` (nextTurnStart): at the start of the next player turn, before the draw, the
   * card goes from the discard or draw pile to `to`. A card that was exhausted since stays gone.
   */
  private returnCards(): void {
    for (const { uid, to } of this.returning) {
      for (const from of ['discard', 'draw'] as const) {
        const pile = this.anyPile(from);
        const i = pile.findIndex((c) => c.uid === uid);
        if (i < 0) continue;
        const c = pile.splice(i, 1)[0]!;
        const dest = this.placeCard(c, to);
        this.log?.push({ t: 'moved', uid, cardId: c.cardId, from, to: dest });
        break;
      }
    }
    this.returning = [];
  }

  /** True when the card can still be upgraded: it has an upgrade and is not upgraded yet. */
  private canUpgrade(c: CardInstance): boolean {
    return !c.upgraded && !!this.data.cards[c.cardId]?.upgraded;
  }

  /**
   * #112 `upgradeCards`: upgrade cards in the named piles for the rest of combat. Only cards that
   * have an upgrade and are not upgraded yet qualify. Returns how many were upgraded.
   */
  private upgradeCards(e: Extract<Effect, { type: 'upgradeCards' }>, card: CardInstance | undefined): number {
    const places = e.piles.flatMap((name) =>
      this.anyPile(name)
        .filter((c) => this.canUpgrade(c))
        .map((c) => ({ c, pile: this.anyPile(name) })),
    );
    const ask = e.piles.length === 1 ? { from: e.piles[0]! } : {};
    const picked = this.pickCards(
      'upgrade',
      places.map((x) => x.c),
      e,
      ask,
      card,
    );
    for (const c of picked) this.upgradeInstance(c, places.find((x) => x.c === c)!.pile);
    return picked.length;
  }

  /** #112: the card keeps its uid and place but becomes its upgraded version, keeping what it gained in combat. */
  private upgradeInstance(c: CardInstance, pile: CardInstance[]): void {
    const def = this.data.cards[c.cardId]!;
    const next = makeCardInstance(def, true, c.uid);
    if (c.generated) next.generated = true;
    if (c.damageBonus !== undefined) next.damageBonus = c.damageBonus;
    if (c.replay !== undefined) next.replay = c.replay;
    this.applyCostPowersTo(next);
    if (c.costThisCombat !== undefined) {
      next.cost = c.cost;
      next.costThisCombat = c.costThisCombat;
    }
    if (c.freeThisTurn) {
      this.freeBackup.set(c.uid, next.cost);
      next.cost = 0;
      next.freeThisTurn = true;
    }
    pile[pile.indexOf(c)] = next;
    this.log?.push({ t: 'upgraded', uid: c.uid, cardId: c.cardId });
  }

  /** #116: the cards a pool can produce for this character (cached). */
  private poolCards(pool: CardPool, upgraded: boolean): CardDef[] {
    const key = `${JSON.stringify(pool)}|${upgraded}`;
    let cards = this.pools.get(key);
    if (!cards) {
      cards = cardPool(this.data.cards, this.character.code, pool, upgraded);
      this.pools.set(key, cards);
    }
    return cards;
  }

  /** #116: a new card instance with a fresh uid, marked generated, with cost powers applied. */
  private createCard(def: CardDef, upgraded: boolean): CardInstance {
    const c = makeCardInstance(def, upgraded, this.nextUid++);
    c.generated = true;
    this.applyCostPowersTo(c);
    return c;
  }

  /** #109 Corruption and Curious apply to cards made later too. */
  private applyCostPowersTo(c: CardInstance): void {
    if (c.cost === null || c.xCost) return;
    if (c.type === 'skill' && this.power('corruption')) c.cost = 0;
    if (c.type === 'power') c.cost = Math.max(0, c.cost - this.power('powersCostLess'));
  }

  /** #116: put a created card in `to`. A full hand sends it to the discard pile. Returns where it went. */
  private placeCard(c: CardInstance, to: CardDestination): CardDestination {
    const p = this.player;
    let dest = to;
    if (dest === 'hand' && p.hand.length >= HAND_LIMIT) dest = 'discard';
    switch (dest) {
      case 'hand':
        p.hand.push(c);
        break;
      case 'drawTop':
        p.drawPile.push(c);
        break;
      case 'drawBottom':
        p.drawPile.unshift(c);
        break;
      case 'drawRandom':
        p.drawPile.splice(this.rng.int(0, p.drawPile.length), 0, c);
        break;
      case 'discard':
        p.discardPile.push(c);
        break;
      case 'exhaust':
        p.exhaustPile.push(c);
        break;
    }
    return dest;
  }

  /** #116 `addCards` (sources `random` and `card`). Returns how many cards were created. */
  private addCards(e: Extract<Effect, { type: 'addCards' }>, card?: CardInstance): number {
    const { source } = e;
    if (source.kind !== 'random' && source.kind !== 'card') {
      throw new Error(`Effect "addCards" is not simulated yet (source "${source.kind}")`);
    }
    const upgraded = e.upgraded === true;
    let made = 0;
    for (let i = 0; i < e.count; i++) {
      let def: CardDef | undefined;
      if (source.kind === 'card') {
        def = this.data.cards[source.cardId];
        if (!def) throw new Error(`Unknown card "${source.cardId}"`);
      } else {
        const pool = this.poolCards(source.pool, upgraded);
        if (pool.length === 0) continue;
        if (e.options !== undefined && e.options > 1) {
          // Discovery-style: show distinct candidates, the strategy keeps one.
          const rest = [...pool];
          const shown: CardInstance[] = [];
          for (let k = 0; k < e.options && rest.length > 0; k++) {
            shown.push(this.createCard(rest.splice(this.rng.int(0, rest.length - 1), 1)[0]!, upgraded));
          }
          let keep = shown[0]!;
          if (shown.length > 1) {
            const request: ChoiceRequest = { purpose: 'generate', to: e.to, options: shown, min: 1, max: 1 };
            if (card) {
              request.sourceUid = card.uid;
              request.sourceCardId = card.cardId;
            }
            keep = this.choose(request, shown)[0]!;
          }
          this.finishCreated(keep, e);
          made++;
          continue;
        }
        def = pool[this.rng.int(0, pool.length - 1)]!;
      }
      this.finishCreated(this.createCard(def, upgraded), e);
      made++;
    }
    return made;
  }

  /** #116: apply the effect's cost overrides to a new card, place it and log it. */
  private finishCreated(c: CardInstance, e: Extract<Effect, { type: 'addCards' }>): void {
    if (c.cost !== null && !c.xCost) {
      if (e.costThisCombat !== undefined) {
        c.cost = e.costThisCombat;
        c.costThisCombat = e.costThisCombat;
        this.log?.push({ t: 'costChanged', uid: c.uid, cardId: c.cardId, cost: c.cost, duration: 'combat' });
      }
      if (e.freeThisTurn) {
        this.freeBackup.set(c.uid, c.cost);
        c.cost = 0;
        c.freeThisTurn = true;
        this.log?.push({ t: 'costChanged', uid: c.uid, cardId: c.cardId, cost: 0, duration: 'turn' });
      }
    }
    const to = this.placeCard(c, e.to);
    this.log?.push({ t: 'generated', uid: c.uid, cardId: c.cardId, to, source: e.source.kind });
  }

  /** #116: cards that were free this turn cost what they did before (Corruption still makes Skills free). */
  private endFreeCosts(): void {
    if (this.freeBackup.size === 0) return;
    const p = this.player;
    for (const pile of [p.hand, p.drawPile, p.discardPile, p.exhaustPile]) {
      for (const c of pile) {
        if (!c.freeThisTurn) continue;
        delete c.freeThisTurn;
        const before = this.freeBackup.get(c.uid) ?? null;
        c.cost = c.type === 'skill' && this.power('corruption') && before !== null ? 0 : before;
      }
    }
    this.freeBackup.clear();
  }

  /** #116: the card keeps its uid and place but becomes `def` (not upgraded unless asked). */
  private transformInto(c: CardInstance, pile: CardInstance[], def: CardDef, upgraded: boolean): void {
    const next = makeCardInstance(def, upgraded, c.uid);
    if (c.generated) next.generated = true;
    this.applyCostPowersTo(next);
    pile[pile.indexOf(c)] = next;
    this.log?.push({ t: 'transformed', uid: c.uid, fromCardId: c.cardId, toCardId: def.id });
  }

  /** #116 `transformCards`: modes random / all / top; replacements from a card or a random pool. Returns how many changed. */
  private transformCards(e: Extract<Effect, { type: 'transformCards' }>): number {
    if (e.mode === 'choose') throw new Error('Effect "transformCards" is not simulated yet (mode "choose")');
    if (e.into.kind !== 'random' && e.into.kind !== 'card') {
      throw new Error(`Effect "transformCards" is not simulated yet (into "${e.into.kind}")`);
    }
    const pile = this.pile(e.from);
    const candidates = pile.filter((c) => !e.filter || matchesFilter(c, e.filter));
    const n = Math.min(e.count ?? candidates.length, candidates.length);
    let picked: CardInstance[];
    if (e.mode === 'all') picked = candidates;
    else if (e.mode === 'top') picked = candidates.slice(candidates.length - n).reverse();
    else {
      const rest = [...candidates];
      picked = [];
      for (let i = 0; i < n; i++) picked.push(rest.splice(this.rng.int(0, rest.length - 1), 1)[0]!);
    }
    let count = 0;
    for (const c of picked) {
      let def: CardDef | undefined;
      if (e.into.kind === 'card') {
        def = this.data.cards[e.into.cardId];
        if (!def) throw new Error(`Unknown card "${e.into.cardId}"`);
      } else {
        const pool = this.poolCards(e.into.pool, false);
        if (pool.length === 0) continue;
        def = pool[this.rng.int(0, pool.length - 1)]!;
      }
      this.transformInto(c, pile, def, false);
      count++;
    }
    return count;
  }

  /** #116 Primal Force+: every Attack in hand becomes Giant Rock+ (the contract's card source has no "upgraded"). */
  private primalForcePlus(): number {
    const rock = this.data.cards['giant_rock'];
    if (!rock) throw new Error('Unknown card "giant_rock"');
    const { hand } = this.player;
    const attacks = hand.filter((c) => c.type === 'attack');
    for (const c of attacks) this.transformInto(c, hand, rock, true);
    return attacks.length;
  }

  /** #106: the player loses HP directly (ignores Block; not an attack). Returns true if they died. */
  private loseHp(amount: number): boolean {
    const { player } = this;
    player.hp -= amount;
    this.recordHpLoss(amount);
    this.log?.push({ t: 'loseHp', side: 'player', amount, hpAfter: Math.max(player.hp, 0) });
    return player.hp <= 0;
  }

  /** #115: the player heals; only the HP actually restored counts (and lowers `hpLost`). */
  private heal(amount: number): void {
    const { player } = this;
    const healed = Math.max(0, Math.min(amount, player.maxHp - player.hp));
    if (healed === 0) return;
    player.hp += healed;
    this.log?.push({ t: 'heal', amount: healed, hpAfter: player.hp });
  }

  /**
   * #115: Max HP changes. A gain (Feed) raises current HP too; a loss (Brightest Flame) only lowers
   * current HP when it is above the new Max HP. `hpLost` is Start Max HP − final HP, so a gain
   * reduces it and HP removed by the cap counts as lost.
   */
  private changeMaxHp(delta: number): void {
    const { player } = this;
    const maxHp = Math.max(1, player.maxHp + delta);
    const applied = maxHp - player.maxHp;
    player.maxHp = maxHp;
    if (applied > 0) player.hp += applied;
    else player.hp = Math.min(player.hp, maxHp);
    this.log?.push({ t: 'maxHp', amount: applied, maxHpAfter: maxHp, hpAfter: player.hp });
  }

  /** #115: change the enemy's Stun (negative to use it up); it is removed at 0. */
  private applyEnemyPower(power: 'stun', amount: number): void {
    const { enemy, log } = this;
    const powers = (enemy.powers ??= {});
    const total = (powers[power] ?? 0) + amount;
    if (total <= 0) {
      delete powers[power];
      log?.push({ t: 'powerRemoved', side: 'enemy', power });
      return;
    }
    powers[power] = total;
    log?.push({ t: 'powerApplied', side: 'enemy', power, amount, total });
  }

  /**
   * #115: run a curse or status trigger. Its `attack` effects are damage to the player (Burn,
   * Decay): Block absorbs it, Intangible makes it 1. `loseHp` ignores Block. Returns true if the
   * player died.
   */
  private runJunkTriggers(card: CardInstance, when: 'drawn' | 'turnEndInHand'): boolean {
    for (const t of card.triggers ?? []) {
      if (t.when !== when) continue;
      for (const e of t.effects) {
        if (e.type === 'attack') {
          for (let h = 0; h < e.hits; h++) if (this.takeDamage(e.damage)) return true;
        } else if (this.resolveEffects('player', [e], 0, card) === 'player') {
          return true;
        }
      }
    }
    return this.player.hp <= 0;
  }

  /** #115: non-attack damage to the player (Burn): Intangible → 1, Block absorbs. Returns true if they died. */
  private takeDamage(damage: number): boolean {
    const { player } = this;
    const amount = this.power('intangible') > 0 ? Math.min(damage, 1) : damage;
    const blocked = Math.min(player.block, amount);
    player.block -= blocked;
    const hpLoss = amount - blocked;
    player.hp -= hpLoss;
    this.log?.push({ t: 'damage', source: 'player', target: 'player', amount, blocked, hpLoss });
    this.recordHpLoss(hpLoss);
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
    if (power === 'rollingBoulder') this.boulders.push(amount);
    if (power === 'crimsonMantle') this.mantleCopies++;
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
    let perHit = attackDamage(base, a.strength, a.debuffs.weak, t.debuffs.vulnerable, cruelty, shrink);
    // #115 Intangible: every hit on the player is 1 (a 0-damage hit stays 0).
    if (target === 'player' && this.power('intangible') > 0) perHit = Math.min(perHit, 1);
    for (let h = 0; h < hits; h++) {
      const blocked = Math.min(t.block, perHit);
      t.block -= blocked;
      const hpLoss = perHit - blocked;
      t.hp -= hpLoss;
      this.log?.push({ t: 'damage', source, target, amount: perHit, blocked, hpLoss });
      if (target === 'player') this.recordHpLoss(hpLoss);
      // #115 The Gambit: unblocked attack damage from the enemy loses the combat.
      if (target === 'player' && hpLoss > 0 && this.power('gambit') > 0) t.hp = 0;
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
      // #115: "when drawn" triggers; a death is seen by the caller through player.hp.
      this.runJunkTriggers(card, 'drawn');
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
    // #115: against the Max HP at the start of combat; healing and Feed lower it, never below 0.
    const hpLost = Math.max(0, this.startMaxHp - Math.max(player.hp, 0));
    const result: CombatResult = {
      seed: this.config.seed,
      outcome,
      turns: this.state.turn,
      hpLost,
      enemyHpRemaining: Math.max(enemy.hp, 0),
    };
    if (this.gold > 0 || this.potions > 0) result.rewards = { gold: this.gold, potions: this.potions };
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
  return new Combat(data, config, character, enemyDef, deck, strategy, options?.log === true).run();
}

export const runCombat: RunCombat = (data, config, options) =>
  simulateCombat(data, config, createStrategy(config.strategy), options);
