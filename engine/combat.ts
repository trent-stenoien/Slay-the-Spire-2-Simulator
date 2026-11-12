import { createRng } from './rng';
import { cardPool, chooseGenerated } from './generate';
import { patternMoveIds, patternPool, resolveEnemy } from './enemy';
import {
  COLOSSUS_REDUCTION,
  attackDamage,
  attackHits,
  blockGain,
  cardCost,
  conditionHolds,
  counterValue,
  countStrikes,
  isPlayable,
  isStrikeName,
  perCounterValue,
} from './rules';
import type { CounterContext } from './rules';
import {
  CONFUSED_COST,
  ORNAMENTAL_FAN_ATTACKS,
  type ActiveRelic,
  activeRelics,
  cardsPerTurnLimit,
  hookEffects,
  hooksFor,
  hpLossCap,
  isStrikeOrDefend,
  minUnblockedAttack,
  modifiersOf,
  modifierTotal,
  scriptMods,
  turnMatches,
} from './relics';
import { chooseExhaust, createStrategy } from './strategies';
import {
  HAND_LIMIT,
  TURN_CAP,
  type CardDef,
  type CardDestination,
  type CardFilter,
  type CardInstance,
  type CardPool,
  type CharacterDef,
  type ChoiceRequest,
  type CombatConfig,
  type CombatCounters,
  type CombatResult,
  type CombatState,
  type Condition,
  type Counter,
  type DebuffKind,
  type Debuffs,
  type Effect,
  type EnemyDef,
  type EnemyIntent,
  type EnemyMove,
  type EnemyPowerId,
  type GameData,
  type GameEvent,
  type Outcome,
  type PerCounter,
  type PileName,
  type PowerId,
  type Rng,
  type SelectMode,
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
  enemy: { strength: number; debuffs: Debuffs; powers?: Partial<Record<EnemyPowerId, number>> },
  player: { debuffs: Debuffs; powers?: Partial<Record<PowerId, number>> },
): EnemyIntent {
  const attacks: EnemyIntent['attacks'] = [];
  let totalIncoming = 0;
  // #110: Mangle / Dark Shackles lower the enemy's Strength through the end of its turn.
  const strength = enemy.strength - (enemy.powers?.strengthLossThisTurn ?? 0);
  // #110: Colossus halves damage from a Vulnerable enemy.
  const reduce = colossusReduction(player.powers, enemy.debuffs);
  for (const e of move.effects) {
    if (e.type !== 'attack') continue;
    const dph = attackDamage(e.damage, strength, enemy.debuffs.weak, player.debuffs.vulnerable, 0, 0, reduce);
    attacks.push({ damagePerHit: dph, hits: e.hits });
    totalIncoming += dph * e.hits;
  }
  return { moveId, name: move.name, attacks, totalIncoming };
}

/** #110: the percent less damage a Vulnerable enemy deals while the player has Colossus (else 0). */
function colossusReduction(powers: Partial<Record<PowerId, number>> | undefined, enemyDebuffs: Debuffs): number {
  return (powers?.colossus ?? 0) > 0 && enemyDebuffs.vulnerable > 0 ? COLOSSUS_REDUCTION : 0;
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
  // #110: Stomp's cost reduction.
  if (def.costLessPer) inst.costLessPer = { ...def.costLessPer };
  // #111: "can only be played if" (Clash).
  if (def.playableIf) inst.playableIf = structuredClone(def.playableIf);
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
 * #114 noReplay: only cards with no Replay. #112 rarity: the card's rarity is one of the listed ones.
 * #111 nameIncludes: the name contains the text (case-sensitive; the upgraded "+" does not matter).
 */
export function matchesFilter(card: CardInstance, filter: CardFilter): boolean {
  if (filter.nameIncludes !== undefined && !card.name.includes(filter.nameIncludes)) return false;
  if (filter.rarity && (card.rarity === undefined || !filter.rarity.includes(card.rarity))) return false;
  if (filter.noReplay && (card.replay ?? 0) > 0) return false;
  if (filter.types && !filter.types.includes(card.type)) return false;
  if (filter.notTypes?.includes(card.type)) return false;
  if (filter.cardId !== undefined && card.cardId !== filter.cardId) return false;
  if (filter.upgraded !== undefined && card.upgraded !== filter.upgraded) return false;
  // #111: the name rule is case-sensitive and ignores the upgraded "+" (see isStrikeName).
  if (filter.nameIncludes !== undefined && !card.name.includes(filter.nameIncludes)) return false;
  return true;
}

/** Card triggers the engine runs (#108 exhausted, #115 drawn and turnEndInHand, #114 turnEndInExhaust). */
const SIMULATED_TRIGGERS: readonly string[] = ['exhausted', 'drawn', 'turnEndInHand', 'turnEndInExhaust'];

/** #108: per-hit damage an Attack adds to Thrash: its first attack effect's base damage plus its own bonus. */
export function perHitBaseDamage(card: CardInstance): number {
  for (const e of card.effects) {
    if (e.type === 'attack' || e.type === 'attackFrom') return e.damage + (card.damageBonus ?? 0);
  }
  return 0;
}

/** #111/#113: counters the engine reads (every Counter in the contract; playCard keeps the cards-played tallies). */
export const SIMULATED_COUNTERS: readonly Counter[] = [
  'playerBlock',
  'playerStrength',
  'enemyVulnerable',
  'enemyUniqueDebuffs',
  'handSize',
  'drawPileSize',
  'discardPileSize',
  'exhaustPileSize',
  'hpLossesThisCombat',
  'cardsPlayedThisTurn',
  'cardsPlayedThisCombat',
  'attacksPlayedThisTurn',
  'cardsExhaustedThisTurn',
  'cardsExhaustedThisCombat',
  'lastEffectCount',
  'lastAttackDamage',
];

/** Safety guard: at most this many cards drawn by one `drawUntil` effect. */
const MAX_DRAW_UNTIL = 1000;

/**
 * #107/#109: player powers the engine simulates. `applyPower` with any other PowerId throws
 * "not simulated yet" (every PowerId is simulated now).
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
  // #110 temporary and next-turn powers
  'strengthThisTurn',
  'rage',
  'flameBarrier',
  'colossus',
  'noBlockFromCards',
  'retainHand',
  'freeAttack',
  'doubleAttack',
  'nextCardToDrawTop',
  'choking',
  // #113 trigger powers
  'darkEmbrace',
  'feelNoPain',
  'rupture',
  'inferno',
  'juggernaut',
  'unmovable',
  'vicious',
  'panache',
  'automation',
  'juggling',
  'aggression',
  'hellraiser',
  'stampede',
  'mayhem',
  'nostalgia',
  'stratagem',
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

/** #113 Inferno: HP lost at the start of each turn per copy played (like Crimson Mantle). */
export const INFERNO_HP_LOSS = 1;

/** #113 Panache: every this many cards played in a turn (counted while the power is on). */
export const PANACHE_CARDS = 5;

/** #113 Automation: every this many cards drawn (counted while the power is on). */
export const AUTOMATION_CARDS = 10;

/** #113 Juggling: the Attack played this many times in a turn (the 3rd) is copied into the hand. */
export const JUGGLING_ATTACK = 3;

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
  /** #110: true while scheduled effects run: Block they gain is not changed by Dexterity or Frail. */
  private unpowered = false;
  /** #116: uid for the next created card (the deck uses 0..n-1). */
  private nextUid: number;
  /** #116: pools already computed, keyed by pool + upgraded. */
  private readonly pools = new Map<string, CardDef[]>();
  /** #112: cards played with `moveSelf` (nextTurnStart) that come back at the start of the next turn. */
  private returning: { uid: number; to: CardDestination }[] = [];
  /** #116: cost a card had before it became free this turn (restored at the end of the turn). */
  private readonly freeBackup = new Map<number, number | null>();
  /** #205: HP at the start of combat (config.startHp, or Max HP); `hpLost` is measured against it. */
  private readonly startHp: number;
  /** #205: relics in play, in pick order. */
  private readonly relics: ActiveRelic[];
  /** #205 (Trent): healing beyond Max HP. It is not added to HP, but it still lowers `hpLost`. */
  private overheal = 0;
  /** #205: total HP healed this combat (cards and relics, overheal included). */
  private healedTotal = 0;
  /** #205: relic id while a relic's hook resolves (heal events name it as `source`). */
  private relicSource: string | undefined;
  /** #205 Beating Remnant: HP lost so far in the current turn (the player's or the enemy's). */
  private relicTurnLoss = 0;
  /** #104: gold and potions gained so far this combat (rewards only; no combat effect). */
  private gold = 0;
  private potions = 0;
  /** #111: damage the last attack hit dealt to Block and HP together, overkill included (Fisticuffs). */
  private lastAttackDamage = 0;
  /** #113 Inferno copies played; each loses 1 HP a turn (the sum of their damage is in powers). */
  private infernoCopies = 0;
  /** #113: cards played this turn while Panache was on (reset each turn). */
  private panacheCount = 0;
  /** #113: cards drawn while Automation was on (kept across turns). */
  private automationCount = 0;
  /** #113 Unmovable: the turn's first Block gain from a card has been doubled. */
  private unmovableUsed = false;
  /** #113 Rupture, Inferno: true from the start of the player's turn to the start of the enemy's. */
  private playerTurn = false;

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
    this.relics = activeRelics(data, config);
    const startHp = config.startHp ?? character.maxHp;
    if (!Number.isInteger(startHp) || startHp < 1 || startHp > character.maxHp) {
      throw new Error(`startHp ${startHp} must be an integer from 1 to Max HP ${character.maxHp}`);
    }
    this.startHp = startHp;
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
        hp: startHp,
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
        ...(config.potions && config.potions.length > 0 ? { potions: this.potionSlots(data, config.potions) } : {}),
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
    this.log?.push({ t: 'combatStart', seed: config.seed, enemyHp, playerHp: startHp });
    // #203: powers the enemy starts with (Cubex Construct: Artifact; Byrdonis: Strength per turn).
    for (const [power, amount] of Object.entries(enemyDef.startPowers ?? {}) as [EnemyPowerId, number][]) {
      if (amount > 0) this.applyEnemyPower(power, amount);
    }
    this.log?.push({ t: 'shuffle', reason: 'start', count: deck.length });
  }

  /** #204: the potion ids in slot order; an unknown id is a setup error. */
  private potionSlots(data: GameData, ids: readonly string[]): string[] {
    for (const id of ids) {
      if (!data.potions?.[id]) throw new Error(`Unknown potion "${id}"`);
    }
    return [...ids];
  }

  private get player() {
    return this.state.player;
  }

  private get enemy() {
    return this.state.enemy;
  }

  /** Turns until one side dies or the turn cap is reached. */
  run(): CombatResult {
    const opened = this.relicCombatStart();
    if (opened) return this.finish(opened);
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
    this.playerTurn = true;
    counters.hpLostThisTurn = 0;
    counters.cardsDrawnThisTurn = 0;
    counters.cardsExhaustedThisTurn = 0;
    counters.cardsPlayedThisTurn = 0;
    counters.attacksPlayedThisTurn = 0;
    counters.skillsPlayedThisTurn = 0;
    this.panacheCount = 0;
    this.unmovableUsed = false;
    if (!this.power('barricade')) {
      player.block = 0;
      log?.push({ t: 'blockReset', side: 'player' });
    }
    this.relicTurnLoss = 0;
    // #205: Ice Cream keeps unspent energy; Sozu / Velvet Choker add to every refill.
    const refill = this.character.energyPerTurn + modifierTotal(this.relics, 'energyPerTurn');
    player.energy = (modifiersOf(this.relics, 'conserveEnergy').length > 0 ? player.energy : 0) + refill;
    this.returnCards();
    // #205 Snecko Eye: extra cards in the normal draw.
    const draw = this.character.drawPerTurn + modifierTotal(this.relics, 'drawPerTurn');
    for (let i = 0; i < draw; i++) {
      if (!this.drawOne()) break;
      if (player.hp <= 0) return 'loss';
      if (this.enemy.hp <= 0) return 'win';
    }
    // #110: effects scheduled for this turn's start (Outmaneuver, Relax, Toric Toughness, Prolong), after the draw.
    const scheduled = this.runScheduled('turnStart');
    if (scheduled) return scheduled;
    const powers = this.turnStartPowers();
    if (powers) return powers;
    return this.relicTurnStart();
  }

  /**
   * #110: run the scheduled effects due on this turn at `at`, in the order they were scheduled.
   * Block they gain is not changed by Dexterity or Frail. Returns the outcome if one ended combat.
   */
  private runScheduled(at: 'turnStart' | 'turnEnd'): Outcome | null {
    const { player, enemy } = this;
    const due = (player.scheduled ?? []).filter((s) => s.turn === this.state.turn && s.at === at);
    if (due.length === 0) return null;
    player.scheduled = (player.scheduled ?? []).filter((s) => !due.includes(s));
    for (const s of due) {
      this.unpowered = true;
      const died = this.resolveEffects('player', s.effects);
      this.unpowered = false;
      if (died === 'player' || player.hp <= 0) return 'loss';
      if (died === 'enemy' || enemy.hp <= 0) return 'win';
    }
    return null;
  }

  /** #110: what a card costs right now (Enlightenment, Stomp, Unrelenting); null if unplayable. */
  private costOf(card: CardInstance): number | null {
    return cardCost(card, this.counters.attacksPlayedThisTurn, this.power('freeAttack') > 0);
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
      // #113: an earlier power (Rolling Boulder, Inferno, Mayhem's card) may have won the combat.
      if (this.enemy.hp <= 0) return 'win';
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
        case 'inferno':
          // #113: lose 1 HP per copy played (one loss), which Rupture and Inferno itself react to.
          if (this.loseHp(INFERNO_HP_LOSS * this.infernoCopies)) return 'loss';
          break;
        case 'aggression':
          for (let i = 0; i < amount; i++) this.aggression();
          break;
        case 'mayhem': {
          const died = this.playFromPile({ type: 'playCards', from: 'draw', mode: 'top', count: amount }, 0, 'power');
          if (died) return died === 'enemy' && player.hp > 0 ? 'win' : 'loss';
          if (player.hp <= 0) return 'loss';
          break;
        }
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
    return this.enemy.hp <= 0 ? 'win' : null;
  }

  /**
   * #113 Aggression: a random Attack from the discard pile is upgraded (if it can be) and put into
   * the hand. A full hand leaves it in the discard pile (upgraded). Nothing happens with no Attack there.
   */
  private aggression(): void {
    const { player } = this;
    const attacks = player.discardPile.filter((c) => c.type === 'attack');
    if (attacks.length === 0) return;
    const picked = attacks[this.rng.int(0, attacks.length - 1)]!;
    if (this.canUpgrade(picked)) this.upgradeInstance(picked, player.discardPile);
    const c = player.discardPile.find((x) => x.uid === picked.uid)!;
    if (player.hand.length >= HAND_LIMIT) return;
    player.discardPile.splice(player.discardPile.indexOf(c), 1);
    const to = this.placeCard(c, 'hand');
    this.log?.push({ t: 'moved', uid: c.uid, cardId: c.cardId, from: 'discard', to });
  }

  /** #109: Block from a power (Plating, Crimson Mantle): not a card, so Dexterity and Frail don't apply. */
  private gainPowerBlock(amount: number): void {
    const { player } = this;
    player.block += amount;
    this.log?.push({ t: 'block', side: 'player', amount, total: player.block });
    this.blockGained(amount);
  }

  /**
   * #113 Juggernaut: whenever the player gains Block (from a card, a power or a scheduled effect),
   * the enemy takes its damage (a power's damage: Block absorbs it, nothing else changes it).
   * Gaining 0 Block is not a gain. The caller sees a kill through `enemy.hp`.
   */
  private blockGained(amount: number): void {
    const juggernaut = this.power('juggernaut');
    if (amount > 0 && juggernaut > 0) this.powerDamage(juggernaut);
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
    const hpLoss = this.slipperyLoss(amount - blocked);
    enemy.hp -= hpLoss;
    this.log?.push({ t: 'damage', source: 'player', target: 'enemy', amount, blocked, hpLoss });
    return enemy.hp <= 0;
  }

  /**
   * #109: Block gained from a card's `gainBlock`: + Dexterity, + Fasten on cards named "Defend",
   * then Frail (×0.75, floored), minimum 0.
   */
  private cardBlock(amount: number, card: CardInstance): number {
    // #110 Panic Button: no Block from cards while the power lasts.
    if (this.power('noBlockFromCards') > 0) return 0;
    const fasten = card.name.includes(FASTEN_NAME) ? this.power('fasten') : 0;
    const raw = amount + this.power('dexterity') + this.beltBuckle() + fasten;
    // #113 Unmovable: the first Block gain from a card each turn is doubled; Frail and the doubling
    // are multipliers, so they are applied together and floored once (raw × 0.75 × 2).
    const double = raw > 0 && this.power('unmovable') > 0 && !this.unmovableUsed;
    if (double) this.unmovableUsed = true;
    const frail = this.player.debuffs.frail > 0 ? 0.75 : 1;
    return Math.max(0, Math.floor(raw * frail * (double ? 2 : 1)));
  }

  /**
   * #204: before each move the strategy may use potions (asked again until it returns null).
   * A potion costs no energy and is not a card: its effects resolve, its slot empties, and a
   * `potion` event is logged first. Returns 'win' when the potion kills the enemy.
   */
  private usePotions(): Outcome | null {
    const { player, enemy } = this;
    const slots = player.potions;
    if (!slots || !this.strategy.usePotion) return null;
    for (let used = 0; used <= slots.length; used++) {
      const use = this.strategy.usePotion(this.view());
      if (!use) return null;
      const id = slots[use.slot];
      const def = id ? this.data.potions?.[id] : undefined;
      if (!id || !def) throw new Error(`Strategy tried to use empty or unknown potion slot ${use.slot}`);
      slots[use.slot] = null;
      this.log?.push({ t: 'potion', potionId: id, slot: use.slot });
      const died = this.resolveEffects('player', def.effects);
      if (died === 'player' || player.hp <= 0) return 'loss';
      if (died === 'enemy' || enemy.hp <= 0) return 'win';
    }
    return null;
  }

  /**
   * The strategy plays cards until it ends its turn. Each decision gets a fresh view (current
   * hand and energy), so cards drawn mid-turn are considered. Returns the outcome if combat ended:
   * 'win' when the enemy died, 'loss' when the player's own card dropped them to 0 HP.
   */
  private playCards(): Outcome | null {
    const { player, enemy } = this;
    for (let decisions = 0; decisions < MAX_DECISIONS_PER_TURN; decisions++) {
      const potionOutcome = this.usePotions();
      if (potionOutcome) return potionOutcome;
      const decision = this.strategy.decide(this.view());
      if (decision.kind === 'endTurn') break;
      const idx = player.hand.findIndex((c) => c.uid === decision.uid);
      const card = idx >= 0 ? player.hand[idx] : undefined;
      const cost = card ? this.costOf(card) : null;
      if (
        !card ||
        !isPlayable(cost === card.cost ? card : { ...card, cost }, player.energy) ||
        !this.playableNow(card)
      ) {
        throw new Error(`Strategy tried to play illegal card uid ${decision.uid} on turn ${this.state.turn}`);
      }
      player.hand.splice(idx, 1);
      // #110 Unrelenting: the next Attack played costs 0 (an X-cost Attack still gets X = all the energy, free).
      const free = card.type === 'attack' && this.power('freeAttack') > 0;
      if (free) this.applyPower('freeAttack', -1);
      // X-cost: X is all the energy available, and the card spends all of it.
      const x = card.xCost ? player.energy : 0;
      player.energy -= free ? 0 : card.xCost ? x : (cost as number);
      const died = this.playCard(card, x);
      if (died === 'player' || player.hp <= 0) return 'loss';
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

  /**
   * #114: play a card that is already out of its pile and whose cost is paid or waived: log it,
   * resolve its effects, play it again once per Replay (never used up, Trent #114 Q1; the cost is
   * not paid again and X stays the same), then put it where a played card goes. `by` marks a card
   * played by an effect or trigger rather than the strategy; `exhaust` sends it to the Exhaust pile
   * (Havoc). Returns the side that died, if one did.
   */
  private playCard(
    card: CardInstance,
    xPaid: number,
    by?: 'effect' | 'trigger' | 'power',
    exhaust = false,
  ): Side | null {
    const { player, enemy, log, counters } = this;
    // #205 Chemical X: X-cost cards act as if X were higher (the energy spent is unchanged).
    const x = card.xCost ? xPaid + modifierTotal(this.relics, 'xBonus') : xPaid;
    const logPlay = (how?: 'effect' | 'replay' | 'trigger' | 'power') => {
      if (!log) return;
      const ev: GameEvent = { t: 'play', uid: card.uid, cardId: card.cardId, energyLeft: player.energy };
      if (card.xCost) ev.x = x;
      if (how) ev.by = how;
      log.push(ev);
    };
    logPlay(by);
    // #113: the one place cards played are counted (any way a card is played, once; Replay is not a new play).
    // Nostalgia's "first Attack or Skill this turn" is read before this card is counted.
    const firstAttackOrSkill =
      (card.type === 'attack' || card.type === 'skill') &&
      counters.attacksPlayedThisTurn + counters.skillsPlayedThisTurn === 0;
    counters.cardsPlayedThisTurn++;
    counters.cardsPlayedThisCombat++;
    if (card.type === 'attack') counters.attacksPlayedThisTurn++;
    if (card.type === 'skill') counters.skillsPlayedThisTurn++;
    // #113 Panache counts only cards played after it was on (not the Panache card itself).
    const panacheOn = this.power('panache') > 0;
    // #109 Vigor: an Attack adds all of it to every hit, then it is used up.
    const vigor = card.type === 'attack' ? this.power('vigor') : 0;
    this.activeVigor = vigor;
    // #110 powers that react to this play, read before its own effects can add to them.
    const choking = this.power('choking');
    const toDrawTop = this.power('nextCardToDrawTop') > 0;
    // #113 Nostalgia: the first Attack or Skill each turn goes on top of the draw pile (like Rebound).
    const nostalgia = firstAttackOrSkill && this.power('nostalgia') > 0;
    const again = card.type === 'attack' && this.power('doubleAttack') > 0;
    if (again) this.applyPower('doubleAttack', -1);
    if (toDrawTop) this.applyPower('nextCardToDrawTop', -1);
    // Rage: Block from the power, not the card (no Dexterity or Frail).
    if (card.type === 'attack' && this.power('rage') > 0) this.gainPowerBlock(this.power('rage'));
    if (enemy.hp <= 0) {
      // Juggernaut, triggered by Rage's Block.
      this.activeVigor = 0;
      return 'enemy';
    }
    // Choking: the enemy loses HP whenever a card is played (cards played after it, not itself).
    if (choking > 0 && this.enemyLoseHp(choking)) {
      this.activeVigor = 0;
      return 'enemy';
    }
    this.lastAttackDamage = 0;
    let died = this.resolveEffects('player', card.effects, x, card);
    this.activeVigor = 0;
    if (vigor > 0) this.applyPower('vigor', -vigor);
    // #110 One-Two Punch: the Attack is played one more time, like a Replay (never uses Replay up).
    const replays = (card.replay ?? 0) + (again ? 1 : 0);
    for (let left = replays - 1; left >= 0 && !died && player.hp > 0 && enemy.hp > 0; left--) {
      log?.push({ t: 'replay', uid: card.uid, cardId: card.cardId, left });
      logPlay('replay');
      died = this.resolveEffects('player', card.effects, x, card);
    }
    if (died === 'player' || player.hp <= 0) return 'player';
    if (card.type === 'power') {
      // #109: a played Power leaves the deck for the rest of combat (no discard, no exhaust pile).
    } else if (exhaust) {
      died = this.exhaustCard(card, 'effect') ?? died;
    } else if (card.keywords.includes('exhaust')) {
      died = this.exhaustCard(card, 'keyword') ?? died;
    } else if (card.type === 'skill' && this.power('corruption')) {
      // #109 Corruption: a played Skill is exhausted (Drum of Battle still gains its energy).
      died = this.exhaustCard(card, 'power') ?? died;
    } else if (toDrawTop || nostalgia) {
      // #110 Rebound, #113 Nostalgia: the card goes on top of the draw pile (its end).
      player.drawPile.push(card);
      log?.push({ t: 'moved', uid: card.uid, cardId: card.cardId, from: 'hand', to: 'drawTop' });
    } else {
      player.discardPile.push(card);
    }
    if (!died && enemy.hp > 0) died = this.afterPlay(card, panacheOn);
    if (!died && enemy.hp > 0 && player.hp > 0) died = this.relicCardPlayed(card);
    return died ?? (enemy.hp <= 0 ? 'enemy' : null);
  }

  /**
   * #113 "after a card is played" powers, once per play (a Replay does not repeat them), after the
   * card has gone to its pile. Panache: every 5th card played this turn while it was on, its damage.
   * Juggling: the 3rd Attack played this turn is copied into the hand (one copy per Juggling).
   */
  private afterPlay(card: CardInstance, panacheOn: boolean): Side | null {
    if (panacheOn && this.power('panache') > 0 && ++this.panacheCount % PANACHE_CARDS === 0) {
      if (this.powerDamage(this.power('panache'))) return 'enemy';
    }
    const juggling = this.power('juggling');
    if (juggling > 0 && card.type === 'attack' && this.counters.attacksPlayedThisTurn === JUGGLING_ATTACK) {
      this.addCopies({ type: 'addCards', source: { kind: 'self' }, count: juggling, to: 'hand' }, card);
    }
    return null;
  }

  /** What the strategy sees right now: current hand, energy and the enemy's intent. */
  private view(): StrategyView {
    const { player } = this;
    const { id: moveId, move } = this.currentMove();
    const state = this.stateWithCosts();
    return {
      state,
      intent: this.intent(moveId, move),
      playable: state.player.hand.filter((c) => isPlayable(c, player.energy) && this.playableNow(c)),
    };
  }

  /**
   * #110: the state a strategy sees. Cards in hand whose cost is not their plain `cost` right now
   * (Enlightenment, Stomp, Unrelenting) are shown as copies with the current cost, so strategies
   * and isPlayable read one number. The real cards (same uids) are untouched.
   */
  private stateWithCosts(): CombatState {
    const { player } = this;
    let changed = false;
    const hand = player.hand.map((c) => {
      const cost = this.costOf(c);
      if (cost === c.cost) return c;
      changed = true;
      return { ...c, cost };
    });
    return changed ? { ...this.state, player: { ...player, hand } } : this.state;
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

  /**
   * Plating Block (#109); Ethereal exhausts first (even if Retain), Retain stays, the rest is discarded;
   * then the Exhaust-pile triggers (#114 Howl from Beyond); then player debuffs tick.
   * Returns the outcome if a trigger ended combat.
   */
  private endPlayerTurn(): Outcome | null {
    const { player, log } = this;
    // #205: end-of-turn relics (Stone Calendar, Orichalcum) before Plating.
    const relicEnd = this.relicHooks('turnEnd');
    if (relicEnd) return relicEnd;
    // #109 Plating: gain Block equal to it at the end of your turn.
    const plating = this.power('plating');
    if (plating > 0) this.gainPowerBlock(plating);
    if (this.enemy.hp <= 0) return 'win';
    // #110: The Bomb and other end-of-turn scheduled effects.
    const scheduled = this.runScheduled('turnEnd');
    if (scheduled) return scheduled;
    // #113 Stampede: random Attacks in the hand are played (for free) before the hand is discarded.
    const stampede = this.power('stampede');
    if (stampede > 0) {
      const died = this.playFromPile(
        { type: 'playCards', from: 'hand', mode: 'random', count: stampede, filter: { types: ['attack'] } },
        0,
        'power',
      );
      if (died) return died === 'enemy' && player.hp > 0 ? 'win' : 'loss';
    }
    // #115: curses and statuses in hand act (Burn, Bad Luck), before the hand is discarded.
    for (const card of [...player.hand]) {
      if (this.runJunkTriggers(card, 'turnEndInHand')) return 'loss';
      if (this.enemy.hp <= 0) return 'win';
    }
    // #110 Equilibrium, Salvo: the whole hand is retained this turn (Ethereal cards still exhaust).
    // #205 Runic Pyramid: the hand is kept like Retain (Ethereal cards still exhaust).
    const retainHand = this.power('retainHand') > 0 || modifiersOf(this.relics, 'keepHand').length > 0;
    const ghostSeed = scriptMods(this.relics, 'ghostSeed').length > 0;
    const retained: CardInstance[] = [];
    // #113: cards drawn while exhausting (Dark Embrace) join the new hand and stay in it.
    const handNow = player.hand;
    player.hand = retained;
    for (const card of handNow) {
      if (card.keywords.includes('ethereal') || (ghostSeed && isStrikeOrDefend(card.name))) {
        const died = this.exhaustCard(card, 'ethereal');
        if (died) return died === 'enemy' && player.hp > 0 ? 'win' : 'loss';
      } else if (card.keywords.includes('retain') || retainHand) {
        retained.push(card);
      } else {
        player.discardPile.push(card);
        log?.push({ t: 'discard', uid: card.uid, cardId: card.cardId, reason: 'endOfTurn' });
      }
    }
    this.endTurnPowers();
    const died = this.turnEndExhaustTriggers();
    if (died) return died === 'player' || player.hp <= 0 ? 'loss' : 'win';
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

  /**
   * #110: "this turn" effects end with the player's turn: Strength gained this turn is removed, and
   * Rage, Choking, One-Two Punch, Rebound, Retain Hand and cost changes for the turn are cleared.
   */
  private endTurnPowers(): void {
    const { player, log } = this;
    const temporary = this.power('strengthThisTurn');
    if (temporary > 0) {
      player.strength -= temporary;
      log?.push({ t: 'strength', side: 'player', amount: -temporary, total: player.strength });
    }
    for (const id of [
      'strengthThisTurn',
      'rage',
      'choking',
      'doubleAttack',
      'nextCardToDrawTop',
      'retainHand',
    ] as const) {
      if (this.power(id) > 0) this.applyPower(id, -this.power(id));
    }
    for (const pile of [player.hand, player.drawPile, player.discardPile, player.exhaustPile]) {
      for (const c of pile) delete c.costThisTurn;
    }
  }

  /**
   * #110: after the enemy's move, the powers that cover "the enemy turn that follows" end: Flame
   * Barrier, the enemy's temporary Strength loss; Colossus and Panic Button's no-Block go down by 1.
   */
  private endEnemyTurnPowers(): void {
    for (const id of ['colossus', 'noBlockFromCards'] as const) {
      if (this.power(id) > 0) this.applyPower(id, -1);
    }
    if (this.power('flameBarrier') > 0) this.applyPower('flameBarrier', -this.power('flameBarrier'));
    const loss = this.enemy.powers?.strengthLossThisTurn ?? 0;
    if (loss > 0) this.applyEnemyPower('strengthLossThisTurn', -loss);
  }

  /** Block resets, Poison, the move, pattern advance, then enemy debuffs tick. Returns the outcome if combat ended. */
  private enemyTurn(): Outcome | null {
    const { player, enemy, log } = this;
    log?.push({ t: 'turnStart', turn: this.state.turn, side: 'enemy' });
    this.playerTurn = false;
    this.relicTurnLoss = 0;
    enemy.block = 0;
    log?.push({ t: 'blockReset', side: 'enemy' });
    // Poison: HP loss equal to stacks (ignores Block and modifiers), then -1. A kill ends combat before the move.
    if (enemy.poison > 0) {
      const amount = this.slipperyLoss(enemy.poison);
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
    this.endEnemyTurnPowers();
    // #203 Strength per turn (Byrdonis): at the end of its own turn, after the move.
    const perTurn = enemy.powers?.strengthPerTurn ?? 0;
    if (perTurn > 0) {
      enemy.strength += perTurn;
      log?.push({ t: 'strength', side: 'enemy', amount: perTurn, total: enemy.strength });
    }
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
  /** #226: once-per-fight enemy moves already made. */
  private readonly usedOnce = new Set<string>();

  private poolMove(patternIndex: number, last: string | null): string {
    const { pattern } = this.enemyDef;
    if (pattern.type === 'cycle') return pattern.order[patternIndex] as string;
    // #226: a once-per-fight move that was already made is out of the pool for good.
    const fresh = pattern.moves.filter((id) => !this.usedOnce.has(id));
    const pool = fresh.length > 0 ? fresh : pattern.moves;
    const notLast = pattern.noRepeat && last !== null ? pool.filter((id) => id !== last) : pool;
    const options = notLast.length > 0 ? notLast : pool;
    return options[this.rng.int(0, options.length - 1)] as string;
  }

  /** #4: after a move: opener moves first, then the cycle advances (only past cycle moves) or a random pick. */
  private advancePattern(lastMoveId: string): void {
    const { enemy } = this;
    const { pattern } = this.enemyDef;
    const openerLength = pattern.opener?.length ?? 0;
    const made = (enemy.movesMade ?? 0) + 1;
    enemy.movesMade = made;
    if (this.enemyDef.moves[lastMoveId]?.oncePerFight) this.usedOnce.add(lastMoveId);
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
          died = this.attack(
            source,
            other,
            e.damage + (card?.damageBonus ?? 0) + this.relicCardDamage(card),
            attackHits(e, x),
          );
          break;
        case 'gainBlock': {
          // #109: Block from a card gets Dexterity and Fasten; other Block (enemy moves, triggers) does not.
          const amt = this.unpowered
            ? e.amount
            : source === 'player' && card
              ? this.cardBlock(e.amount, card)
              : blockGain(e.amount, self.debuffs.frail);
          self.block += amt;
          log?.push({ t: 'block', side: source, amount: amt, total: self.block });
          if (source === 'player') this.blockGained(amt);
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
          if (e.amount > 0 && this.artifactNegates('poison')) break;
          enemy.poison += e.amount;
          log?.push({ t: 'poison', amount: e.amount, total: enemy.poison });
          break;
        case 'gainEnergy':
          if (source !== 'player') throw new Error('Enemies have no energy');
          player.energy += e.amount;
          log?.push({ t: 'energy', amount: e.amount, total: player.energy });
          break;
        case 'loseEnergy': {
          if (source !== 'player') throw new Error('Enemies have no energy');
          // #206 Void: energy never goes below 0; only the energy actually lost is logged.
          const lost = Math.min(e.amount, player.energy);
          player.energy -= lost;
          if (lost > 0) log?.push({ t: 'energy', amount: -lost, total: player.energy });
          break;
        }
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
          // #110: Strength "this turn" is real Strength now, taken back at the end of the turn.
          if (e.power === 'strengthThisTurn') {
            player.strength += e.amount;
            log?.push({ t: 'strength', side: 'player', amount: e.amount, total: player.strength });
          }
          this.applyPower(e.power, e.amount);
          break;
        case 'applyEnemyPower':
          if (source !== 'player' || (e.power !== 'stun' && e.power !== 'strengthLossThisTurn')) {
            throw new Error(`Effect "applyEnemyPower" is not simulated yet (power "${e.power}")`);
          }
          if (e.amount > 0 && this.artifactNegates(e.power)) break;
          this.applyEnemyPower(e.power, e.amount);
          break;
        case 'schedule':
          if (source !== 'player') throw new Error('Effect "schedule" is not simulated yet on enemy moves');
          (player.scheduled ??= []).push({
            turn: this.state.turn + e.delay,
            at: e.at ?? 'turnStart',
            effects: e.effects.map((fx) => ({ ...fx })),
            ...(card ? { sourceUid: card.uid } : {}),
          });
          break;
        case 'dealDamage':
          // The Bomb: fixed damage (no Strength, Weak, Vigor); the enemy's Block absorbs it.
          if (source !== 'player') throw new Error('Effect "dealDamage" is not simulated yet on enemy moves');
          if (this.powerDamage(e.amount)) died = 'enemy';
          break;
        case 'enemyLoseHp':
          if (source !== 'player') throw new Error('Effect "enemyLoseHp" is not simulated yet on enemy moves');
          if (this.enemyLoseHp(e.amount)) died = 'enemy';
          break;
        case 'enemyGainStrength':
          if (source !== 'player') throw new Error('Effect "enemyGainStrength" is not simulated yet on enemy moves');
          enemy.strength += e.amount;
          log?.push({ t: 'strength', side: 'enemy', amount: e.amount, total: enemy.strength });
          break;
        case 'setCost':
          if (source !== 'player') throw new Error('Effect "setCost" is not simulated yet on enemy moves');
          this.setCost(e);
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
          // #108/#111: N = counter × times, read once before the first repeat.
          if (source !== 'player' || !SIMULATED_COUNTERS.includes(e.per)) {
            throw new Error(`Effect "repeat" is not simulated yet (counter "${e.per}")`);
          }
          const n = this.counter(e.per, lastCount) * (e.times ?? 1);
          for (let i = 0; i < n && !died; i++) died = this.resolveEffects(source, e.effects, x, card);
          break;
        }
        case 'attackFrom': {
          // #111: per hit damage + amount × counter; hits + extra × counter; both read before the attack.
          if (source !== 'player') throw new Error('Effect "attackFrom" is not simulated yet on enemy moves');
          this.checkCounters(e.bonusPer, e.extraHitsPer);
          const per = e.damage + (card?.damageBonus ?? 0) + this.perCounter(e.bonusPer, lastCount);
          const hits = e.hits + this.perCounter(e.extraHitsPer, lastCount);
          died = this.attack(source, other, per, Math.max(0, hits));
          break;
        }
        case 'gainBlockFrom': {
          // #111: one gain of amount + amount × counter. From a card it gets Dexterity and Frail
          // (Fisticuffs, Trent); doubling the Block you have (Entrench) is not a Block value, so
          // Dexterity and Frail don't change it.
          if (source !== 'player') throw new Error('Effect "gainBlockFrom" is not simulated yet on enemy moves');
          this.checkCounters(e.bonusPer);
          const raw = e.amount + this.perCounter(e.bonusPer, lastCount);
          const amt = e.bonusPer.per === 'playerBlock' ? Math.max(0, raw) : card ? this.cardBlock(raw, card) : 0;
          self.block += amt;
          log?.push({ t: 'block', side: source, amount: amt, total: self.block });
          this.blockGained(amt);
          break;
        }
        case 'growDamage': {
          // #111: 'self' = this copy (Rampage); 'sameCard' = every copy of the card in every pile (Maul).
          if (source !== 'player' || !card) throw new Error('Effect "growDamage" is not simulated yet on enemy moves');
          const grow = (c: CardInstance) => {
            c.damageBonus = (c.damageBonus ?? 0) + e.amount;
          };
          if (e.scope === 'self') grow(card);
          else {
            grow(card);
            for (const pile of [player.hand, player.drawPile, player.discardPile, player.exhaustPile]) {
              for (const c of pile) if (c.cardId === card.cardId) grow(c);
            }
          }
          break;
        }
        case 'addCards':
          // #203: an enemy move may add a named card (Vantom's Wounds); other sources are player-only.
          if (source !== 'player' && e.source.kind !== 'card') throw new Error('Enemies only create named cards');
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
          // #205 Sozu: no potions can be obtained.
          if (modifiersOf(this.relics, 'noPotions').length === 0) this.potions++;
          break;
        case 'conditional': {
          if (source !== 'player') throw new Error('Effect "conditional" is not simulated yet on enemy moves');
          if (e.if.kind === 'fatal') {
            // #104: a kill returns early, so a fatal conditional right after the killing attack is
            // resolved at the return below; if this is reached, nothing was killed.
            died = this.resolveEffects(source, e.else ?? [], x, card);
            break;
          }
          this.checkCondition(e.if);
          const holds = this.holds(e.if, card, lastCount);
          died = this.resolveEffects(source, holds ? e.then : (e.else ?? []), x, card);
          break;
        }
        case 'playCards':
          if (source !== 'player') throw new Error('Effect "playCards" is not simulated yet on enemy moves');
          died = this.playFromPile(e, x);
          break;
        case 'addReplay':
          if (source !== 'player') throw new Error('Effect "addReplay" is not simulated yet on enemy moves');
          this.addReplay(e);
          break;
        case 'script':
          if (source === 'player' && e.id === 'playSelf') died = this.playSelf(card);
          else if (source === 'player' && e.id === 'primalForcePlus') count = this.primalForcePlus();
          else if (source === 'player' && e.id === 'fiendFire') died = this.fiendFire(e.values?.[0] ?? 0);
          else if (source === 'player' && e.id === 'thrash') died = this.thrash(card);
          else if (source === 'player' && e.id === 'perfectedStrike') died = this.perfectedStrike(e.values, card);
          else if (source === 'player' && e.id === 'prolong') this.prolong();
          else throw new Error(`Effect "script" is not simulated yet (id "${e.id}")`);
          break;
        default:
          // Every contract effect is simulated now; this guards effects added to the contract later.
          throw new Error(`Effect "${(e as Effect).type}" is not simulated yet`);
      }
      // #113: a trigger (Juggernaut, Vicious's draw, Hellraiser's Strike...) can end combat during any effect.
      if (!died && source === 'player') died = player.hp <= 0 ? 'player' : enemy.hp <= 0 ? 'enemy' : null;
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
    // #113 Feel No Pain (Block from a power) and Dark Embrace (draw), for every card exhausted.
    const feelNoPain = this.power('feelNoPain');
    if (feelNoPain > 0) this.gainPowerBlock(feelNoPain);
    const darkEmbrace = this.power('darkEmbrace');
    if (darkEmbrace > 0 && this.enemy.hp > 0) this.drawCards(darkEmbrace);
    return player.hp <= 0 ? 'player' : this.enemy.hp <= 0 ? 'enemy' : null;
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

  /** #111: the value of a counter right now (`lastCount` = cards moved by the previous effect). */
  private counter(counter: Counter, lastCount = 0): number {
    return counterValue(counter, this.state, this.counterContext(lastCount));
  }

  private counterContext(lastCount: number): CounterContext {
    return { lastEffectCount: lastCount, lastAttackDamage: this.lastAttackDamage };
  }

  private perCounter(per: PerCounter | undefined, lastCount: number): number {
    return perCounterValue(per, this.state, this.counterContext(lastCount));
  }

  /** #111: counters the engine tracks; the cards-played tallies wait for #113. */
  private checkCounters(...pers: (PerCounter | undefined)[]): void {
    for (const per of pers) {
      if (per && !SIMULATED_COUNTERS.includes(per.per)) {
        throw new Error(`Counter "${per.per}" is not simulated yet`);
      }
    }
  }

  private checkCondition(cond: Condition): void {
    if (cond.kind === 'counter' && !SIMULATED_COUNTERS.includes(cond.counter)) {
      throw new Error(`Counter "${cond.counter}" is not simulated yet`);
    }
  }

  /** #111: whether a condition holds for the card being played (the card itself is not in hand). */
  private holds(cond: Condition, card: CardInstance | undefined, lastCount = 0): boolean {
    return conditionHolds(cond, this.state, matchesFilter, card?.uid, this.counterContext(lastCount));
  }

  /** #111: a card with `playableIf` (Clash) can be played only while it holds. */
  private playableNow(card: CardInstance): boolean {
    // #205 Velvet Choker: no more cards once the turn's limit is reached.
    const limit = cardsPerTurnLimit(this.relics);
    if (limit !== null && this.counters.cardsPlayedThisTurn >= limit) return false;
    return !card.playableIf || this.holds(card.playableIf, card);
  }

  /**
   * #111 Perfected Strike: `values` = [base damage, damage per Strike]. Counts every card with
   * "Strike" in its name in all four piles, plus this card itself (it is in play, not in a pile).
   */
  private perfectedStrike(values: readonly number[] | undefined, card: CardInstance | undefined): Side | null {
    const [base = 0, per = 0] = values ?? [];
    const strikes = countStrikes(this.player) + (card && isStrikeName(card.name) ? 1 : 0);
    return this.attack(
      'player',
      'enemy',
      base + per * strikes + (card?.damageBonus ?? 0) + this.relicCardDamage(card),
      1,
    );
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
    if (c.costThisCombat !== undefined) next.costThisCombat = c.costThisCombat;
    if (c.costThisTurn !== undefined) next.costThisTurn = c.costThisTurn;
    if (c.freeThisTurn) {
      this.freeBackup.set(c.uid, next.cost);
      next.cost = 0;
      next.freeThisTurn = true;
    }
    pile[pile.indexOf(c)] = next;
    this.log?.push({ t: 'upgraded', uid: c.uid, cardId: c.cardId });
  }

  /**
   * #213 Slippery: an HP loss of `amount` (> 0) on the enemy becomes 1 and uses one stack. Every loss
   * counts (attack hit, power damage, Poison, direct HP loss); a loss of 0 (fully blocked) does not.
   */
  private slipperyLoss(amount: number): number {
    const { enemy } = this;
    if (amount <= 0 || (enemy.powers?.slippery ?? 0) <= 0) return amount;
    this.applyEnemyPower('slippery', -1);
    return 1;
  }

  /** #110: the enemy loses HP directly (ignores Block and modifiers). Returns true if it died. */
  private enemyLoseHp(requested: number): boolean {
    const { enemy } = this;
    const amount = this.slipperyLoss(requested);
    enemy.hp -= amount;
    this.log?.push({ t: 'loseHp', side: 'enemy', amount, hpAfter: Math.max(enemy.hp, 0) });
    return enemy.hp <= 0;
  }

  /**
   * #110 Enlightenment: set the cost of the cards in `e.piles` (matching the filter) for this turn
   * or the rest of combat. Unplayable and X-cost cards are skipped; `onlyIfHigher` leaves cards
   * that already cost that much or less.
   */
  private setCost(e: Extract<Effect, { type: 'setCost' }>): void {
    const p = this.player;
    for (const name of e.piles) {
      const pile = name === 'exhaust' ? p.exhaustPile : this.pile(name);
      for (const c of pile) {
        if (c.cost === null || c.xCost) continue;
        if (e.filter && !matchesFilter(c, e.filter)) continue;
        const current = cardCost(c, this.counters.attacksPlayedThisTurn, false) as number;
        if (e.onlyIfHigher && current <= e.cost) continue;
        if (e.duration === 'turn') c.costThisTurn = e.cost;
        else c.costThisCombat = e.cost;
        this.log?.push({ t: 'costChanged', uid: c.uid, cardId: c.cardId, cost: e.cost, duration: e.duration });
      }
    }
  }

  /** #110 Prolong: next turn, gain Block equal to the Block you have right now. */
  private prolong(): void {
    const { player } = this;
    if (player.block <= 0) return;
    (player.scheduled ??= []).push({
      turn: this.state.turn + 1,
      at: 'turnStart',
      effects: [{ type: 'gainBlock', amount: player.block }],
    });
  }

  /** True when a card can be played at all, whatever the energy: it has a cost and is not Unplayable. */
  private canPlayFree(card: CardInstance): boolean {
    return card.cost !== null && !card.keywords.includes('unplayable');
  }

  /**
   * #114 `playCards`: play cards from a pile without paying their cost (Havoc, Cascade,
   * Catastrophe, Beat Down). `count` cards, or count × (X + xBonus) for `xTimes`, X being the X of
   * the card being played. 'top' plays the top card of the pile (the end of the array), one at a
   * time, reshuffling the discard pile into an empty draw pile first. 'random' picks all its
   * cards up front, without repeats, among the cards that can be played (an Unplayable card is
   * never picked), so a card that comes back to the pile is not picked twice.
   * A top card that can't be played (a curse, a status) is not played: it is exhausted when the
   * effect exhausts, otherwise discarded. An X-cost card played this way gets X = the energy left,
   * and doesn't spend it. A card played this way counts as any played card (Replay, Exhaust,
   * Corruption, Powers); `exhaust` sends it to the Exhaust pile instead of the discard pile.
   */
  private playFromPile(
    e: Extract<Effect, { type: 'playCards' }>,
    x: number,
    by: 'effect' | 'power' = 'effect',
  ): Side | null {
    const { player } = this;
    const total = e.xTimes ? e.count * Math.max(0, x + (e.xBonus ?? 0)) : e.count;
    const matches = (c: CardInstance) => !e.filter || matchesFilter(c, e.filter);
    let picks: CardInstance[] | null = null;
    if (e.mode === 'random') {
      const pool = this.pile(e.from).filter((c) => this.canPlayFree(c) && matches(c));
      picks = [];
      for (let i = 0; i < total && pool.length > 0; i++) {
        picks.push(pool.splice(this.rng.int(0, pool.length - 1), 1)[0]!);
      }
    }
    for (let i = 0; i < total; i++) {
      let pile = this.pile(e.from);
      let card: CardInstance | undefined;
      if (picks) {
        card = picks[i];
        if (!card) break;
      } else {
        if (e.from === 'draw' && pile.length === 0) {
          this.reshuffleDiscard();
          pile = this.pile(e.from);
        }
        for (let j = pile.length - 1; j >= 0 && !card; j--) if (matches(pile[j]!)) card = pile[j];
        if (!card) break;
      }
      const at = pile.indexOf(card);
      if (at < 0) continue;
      pile.splice(at, 1);
      if (!this.canPlayFree(card)) {
        if (e.exhaust) {
          const died = this.exhaustCard(card, 'effect');
          if (died) return died;
        } else {
          player.discardPile.push(card);
        }
        continue;
      }
      const died = this.playCard(card, card.xCost ? player.energy : 0, by, e.exhaust);
      if (died) return died;
    }
    return null;
  }

  /** #114 `script` playSelf (Howl from Beyond): play this card from the Exhaust pile for free; it then goes where a played card goes (the discard pile). */
  private playSelf(card: CardInstance | undefined): Side | null {
    const { player } = this;
    const at = card ? player.exhaustPile.indexOf(card) : -1;
    if (!card || at < 0) return null;
    player.exhaustPile.splice(at, 1);
    return this.playCard(card, card.xCost ? player.energy : 0, 'trigger');
  }

  /**
   * #114 `turnEndInExhaust`: at the end of the player's turn, each card in the Exhaust pile with
   * this trigger runs its effects (Howl from Beyond plays itself), once per card, in the order
   * the cards were exhausted.
   */
  private turnEndExhaustTriggers(): Side | null {
    const { player } = this;
    for (const card of [...player.exhaustPile]) {
      for (const t of card.triggers ?? []) {
        if (t.when !== 'turnEndInExhaust' || !player.exhaustPile.includes(card)) continue;
        const died = this.resolveEffects('player', t.effects, 0, card);
        if (died) return died;
      }
    }
    return null;
  }

  /**
   * Choose `n` of `candidates` for an effect that picks cards from a pile: every one ('all'),
   * at random (seeded Rng), the top ones (the end of the pile), or Strategy.choose.
   */
  private selectCards(
    candidates: CardInstance[],
    mode: SelectMode,
    n: number,
    request: Omit<ChoiceRequest, 'options' | 'min' | 'max'>,
  ): CardInstance[] {
    const count = Math.min(n, candidates.length);
    switch (mode) {
      case 'all':
        return candidates;
      case 'top':
        return candidates.slice(candidates.length - count).reverse();
      case 'random': {
        const pool = [...candidates];
        const picked: CardInstance[] = [];
        for (let i = 0; i < count; i++) picked.push(pool.splice(this.rng.int(0, pool.length - 1), 1)[0]!);
        return picked;
      }
      case 'choose':
        if (count === 0) return [];
        // Every candidate must be taken: no choice to make.
        if (count === candidates.length) return [...candidates];
        return this.choose({ ...request, options: candidates, min: count, max: count }, candidates);
    }
  }

  /**
   * #114 `addReplay`: the picked card(s) of the pile gain `amount` Replay (Hidden Gem: one random
   * draw-pile card without Replay). It stays for the rest of combat and is never used up.
   */
  private addReplay(e: Extract<Effect, { type: 'addReplay' }>): void {
    const candidates = this.pile(e.from).filter((c) => !e.filter || matchesFilter(c, e.filter));
    const request = { purpose: 'replay' as const, from: e.from };
    for (const c of this.selectCards(candidates, e.mode, 1, request)) c.replay = (c.replay ?? 0) + e.amount;
  }

  /**
   * #114 `addCards` for sources `self` and `copyOf`: put `count` copies of a card in `to`: of the
   * card being played (`self`, Anger) or of a card picked from a pile (`copyOf`, Dual Wield: one
   * card, `count` copies). A copy keeps the card's upgrade, damage bonus, Replay and cost for the
   * rest of combat, but not "this turn" costs. Returns how many cards were created.
   */
  private addCopies(e: Extract<Effect, { type: 'addCards' }>, card: CardInstance | undefined): number {
    const { source } = e;
    if (
      (source.kind !== 'self' && source.kind !== 'copyOf') ||
      e.options !== undefined ||
      e.upgraded ||
      e.freeThisTurn ||
      e.costThisCombat !== undefined
    ) {
      throw new Error(`Effect "addCards" is not simulated yet (source "${source.kind}")`);
    }
    let originals: CardInstance[];
    if (source.kind === 'self') {
      if (!card) throw new Error('Effect "addCards" with source "self" needs a card');
      originals = [card];
    } else {
      const candidates = this.pile(source.from).filter((c) => !source.filter || matchesFilter(c, source.filter));
      const request: Omit<ChoiceRequest, 'options' | 'min' | 'max'> = { purpose: 'copy', from: source.from, to: e.to };
      if (card) {
        request.sourceUid = card.uid;
        request.sourceCardId = card.cardId;
      }
      originals = this.selectCards(candidates, source.mode, 1, request);
    }
    let made = 0;
    for (const original of originals) {
      for (let i = 0; i < e.count; i++, made++) {
        const copy: CardInstance = {
          ...original,
          uid: this.nextUid++,
          keywords: [...original.keywords],
          effects: original.effects.map((fx) => ({ ...fx })),
          generated: true,
        };
        if (original.triggers) {
          copy.triggers = original.triggers.map((t) => ({ when: t.when, effects: [...t.effects] }));
        }
        delete copy.costThisTurn;
        delete copy.freeThisTurn;
        const to = this.placeCard(copy, e.to);
        this.log?.push({ t: 'generated', uid: copy.uid, cardId: copy.cardId, to, source: source.kind });
      }
    }
    return made;
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

  /** `addCards`: #114 copies (self, copyOf), #116 sources `random` and `card`. Returns how many cards were created. */
  private addCards(e: Extract<Effect, { type: 'addCards' }>, card?: CardInstance): number {
    const { source } = e;
    if (source.kind === 'self' || source.kind === 'copyOf') return this.addCopies(e, card);
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
  private loseHp(lost: number): boolean {
    const { player } = this;
    const amount = this.reduceHpLoss(lost);
    player.hp -= amount;
    this.recordHpLoss(amount);
    this.log?.push({ t: 'loseHp', side: 'player', amount, hpAfter: Math.max(player.hp, 0) });
    return player.hp <= 0;
  }

  /**
   * #115/#205 (Trent): the player heals the full amount for `hpLost`, even past Max HP. HP itself
   * stops at Max HP; the rest is kept as overheal, which lowers `hpLost` too (so it can go negative).
   * The event's `amount` is the full heal; `hpAfter` is the real HP.
   */
  private heal(amount: number): void {
    const { player } = this;
    if (amount <= 0) return;
    const restored = Math.max(0, Math.min(amount, player.maxHp - player.hp));
    player.hp += restored;
    this.overheal += amount - restored;
    this.healedTotal += amount;
    const ev: GameEvent = { t: 'heal', amount, hpAfter: player.hp };
    if (this.relicSource) ev.source = this.relicSource;
    this.log?.push(ev);
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

  /** #110/#115: change an enemy power (Stun, temporary Strength loss; negative to use it up); it is removed at 0. */
  private applyEnemyPower(power: EnemyPowerId, amount: number): void {
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
    const hpLoss = this.reduceHpLoss(amount - blocked);
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
    if (!this.playerTurn) return;
    // #113 "on your turn" = from the start of the player's turn to its end (Crimson Mantle's and
    // Inferno's own HP loss, Offering, Burn at the end of the turn; not the enemy's attacks).
    const { player } = this;
    const rupture = this.power('rupture');
    if (rupture > 0) {
      player.strength += rupture;
      this.log?.push({ t: 'strength', side: 'player', amount: rupture, total: player.strength });
    }
    const inferno = this.power('inferno');
    if (inferno > 0) this.powerDamage(inferno);
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
    if (power === 'inferno' && amount > 0) this.infernoCopies++;
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
      if (this.drawBlocked() || this.enemy.hp <= 0 || !this.drawOne()) return;
    }
  }

  /**
   * #107: draw one card at a time. Stops when the hand is full (Scrawl), after drawing a card
   * matching `stopOn` (Pillage), when nothing is left to draw, or when drawing is blocked.
   * It never draws into a full hand, so it never discards for the hand limit.
   */
  private drawUntil(stopOn: CardFilter | undefined): void {
    for (let i = 0; i < MAX_DRAW_UNTIL; i++) {
      if (this.drawBlocked() || this.player.hand.length >= HAND_LIMIT || this.enemy.hp <= 0) return;
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
    // #110: the enemy's Strength is lowered through its turn by Mangle / Dark Shackles (0 damage at worst),
    // and Colossus cuts what a Vulnerable enemy deals.
    const strength = source === 'enemy' ? a.strength - (this.enemy.powers?.strengthLossThisTurn ?? 0) : a.strength;
    const reduce = source === 'enemy' ? colossusReduction(this.player.powers, this.enemy.debuffs) : 0;
    let perHit = attackDamage(base, strength, a.debuffs.weak, t.debuffs.vulnerable, cruelty, shrink, reduce);
    if (source === 'player') this.lastAttackDamage = 0;
    // #115 Intangible: every hit on the player is 1 (a 0-damage hit stays 0).
    if (target === 'player' && this.power('intangible') > 0) perHit = Math.min(perHit, 1);
    for (let h = 0; h < hits; h++) {
      const blocked = Math.min(t.block, perHit);
      t.block -= blocked;
      // #205 The Boot / Tungsten Rod / Beating Remnant first, then #213 Slippery on the enemy.
      const raw = this.attackHpLoss(target, perHit - blocked);
      const hpLoss = target === 'enemy' ? this.slipperyLoss(raw) : raw;
      t.hp -= hpLoss;
      this.log?.push({ t: 'damage', source, target, amount: perHit, blocked, hpLoss });
      if (source === 'player') this.lastAttackDamage += perHit;
      if (target === 'player') this.recordHpLoss(hpLoss);
      // #115 The Gambit: unblocked attack damage from the enemy loses the combat.
      if (target === 'player' && hpLoss > 0 && this.power('gambit') > 0) t.hp = 0;
      if (t.hp <= 0) return target;
      // Thorns and #110 Flame Barrier hit back after every hit, even one reduced to 0 damage.
      const thorns = target === 'player' ? this.power('thorns') + this.power('flameBarrier') : 0;
      if (thorns > 0 && this.powerDamage(thorns)) return source;
    }
    return null;
  }

  /**
   * #203 Artifact: negates the next debuff applied to the enemy and uses one stack. Debuffs it
   * negates: Vulnerable, Weak, Frail, Poison, Stun and the temporary Strength loss. Returns true
   * when the debuff was negated (the caller must not apply it).
   */
  private artifactNegates(status: DebuffKind | EnemyPowerId | 'poison'): boolean {
    const left = this.enemy.powers?.artifact ?? 0;
    if (left <= 0) return false;
    this.applyEnemyPower('artifact', -1);
    this.log?.push({ t: 'negated', side: 'enemy', status, left: left - 1 });
    return true;
  }

  private applyDebuff(side: Side, kind: DebuffKind, amount: number): void {
    if (side === 'enemy' && amount > 0 && this.artifactNegates(kind)) return;
    const f = this.fighter(side);
    f.debuffs[kind] += amount;
    this.log?.push({ t: 'debuff', side, kind, amount, total: f.debuffs[kind] });
    // #113 Vicious: applying Vulnerable (to the enemy) draws cards.
    const vicious = side === 'enemy' && kind === 'vulnerable' && amount > 0 ? this.power('vicious') : 0;
    if (vicious > 0) this.drawCards(vicious);
  }

  /** Shuffle the discard pile into the (empty) draw pile. Returns false when the discard pile is empty. */
  private reshuffleDiscard(): boolean {
    const { player } = this;
    if (player.discardPile.length === 0) return false;
    player.drawPile = player.discardPile;
    player.discardPile = [];
    this.rng.shuffle(player.drawPile);
    this.log?.push({ t: 'shuffle', reason: 'reshuffle', count: player.drawPile.length });
    this.stratagem();
    return true;
  }

  /**
   * #113 Stratagem: after the draw pile is reshuffled, choose a card from it (one per Stratagem) to
   * put into the hand. Picks by Strategy.choose (the shared generate order when it has none).
   * A full hand takes fewer; nothing is picked when the hand is full.
   */
  private stratagem(): void {
    const { player } = this;
    const n = Math.min(this.power('stratagem'), player.drawPile.length, HAND_LIMIT - player.hand.length);
    if (n <= 0) return;
    const options = [...player.drawPile];
    const request: ChoiceRequest = {
      purpose: 'move',
      sourcePower: 'stratagem',
      from: 'draw',
      to: 'hand',
      options,
      min: n,
      max: n,
    };
    for (const c of options.length === n ? options : this.choose(request, options)) {
      player.drawPile.splice(player.drawPile.indexOf(c), 1);
      const to = this.placeCard(c, 'hand');
      this.log?.push({ t: 'moved', uid: c.uid, cardId: c.cardId, from: 'draw', to });
    }
  }

  /**
   * Draw one card, reshuffling the discard pile if the draw pile is empty. Returns the card
   * (in hand, or discarded when the hand is full), or null when both piles are empty.
   */
  private drawOne(): CardInstance | null {
    const { player, log } = this;
    if (player.drawPile.length === 0 && !this.reshuffleDiscard()) return null;
    // #113 Stratagem can take the last card of a fresh draw pile into the hand.
    if (player.drawPile.length === 0) return null;
    const card = player.drawPile.pop() as CardInstance;
    log?.push({ t: 'draw', uid: card.uid, cardId: card.cardId });
    this.counters.cardsDrawnThisTurn++;
    this.counters.cardsDrawnThisCombat++;
    // #113 Automation: every 10th card drawn while it is on gains energy.
    const automation = this.power('automation');
    if (automation > 0 && ++this.automationCount % AUTOMATION_CARDS === 0) {
      player.energy += automation;
      log?.push({ t: 'energy', amount: automation, total: player.energy });
    }
    if (player.hand.length >= HAND_LIMIT) {
      player.discardPile.push(card);
      log?.push({ t: 'discard', uid: card.uid, cardId: card.cardId, reason: 'handLimit' });
    } else {
      player.hand.push(card);
      this.confuse(card);
      // #115: "when drawn" triggers; a death is seen by the caller through player.hp.
      this.runJunkTriggers(card, 'drawn');
      // #113 Hellraiser: a drawn card with "Strike" in its name is played for free (if it can be).
      if (
        this.power('hellraiser') > 0 &&
        isStrikeName(card.name) &&
        this.canPlayFree(card) &&
        player.hp > 0 &&
        this.enemy.hp > 0
      ) {
        const at = player.hand.indexOf(card);
        if (at >= 0) {
          player.hand.splice(at, 1);
          this.playCard(card, card.xCost ? player.energy : 0, 'power');
        }
      }
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

  // ---------------------------------------------------------------------------
  // #205 Relics (which hooks fire is decided in engine/relics.ts)
  // ---------------------------------------------------------------------------

  /**
   * Resolve one relic's effects as the player (Block from a relic is not from a card, so
   * Dexterity and Frail don't change it). Heals name the relic as their source.
   */
  private resolveRelic(relic: ActiveRelic, effects: readonly Effect[]): Side | null {
    this.log?.push({ t: 'relic', relicId: relic.def.id });
    this.unpowered = true;
    this.relicSource = relic.def.id;
    const died = this.resolveEffects('player', effects);
    this.unpowered = false;
    this.relicSource = undefined;
    return died;
  }

  /** The outcome after a relic effect, or null when both sides live. */
  private relicOutcome(died: Side | null): Outcome | null {
    if (died === 'player' || this.player.hp <= 0) return 'loss';
    if (died === 'enemy' || this.enemy.hp <= 0) return 'win';
    return null;
  }

  /** Every hook for `when` whose turn conditions hold this turn, in pick order. */
  private relicHooks(when: 'combatStart' | 'turnStart' | 'turnEnd'): Outcome | null {
    for (const { relic, hook } of hooksFor(this.relics, when)) {
      if (when !== 'combatStart' && !turnMatches(hook, this.state.turn)) continue;
      const out = this.relicOutcome(this.resolveRelic(relic, hookEffects(hook, relic.choice)));
      if (out) return out;
    }
    return null;
  }

  /** combatStart hooks (Vajra, Bronze Scales, Blood Vial…), then Sling of Courage against an Elite. */
  private relicCombatStart(): Outcome | null {
    const out = this.relicHooks('combatStart');
    if (out) return out;
    if (this.enemyDef.difficulty !== 'elite') return null;
    for (const { relic, mod } of scriptMods(this.relics, 'slingOfCourage')) {
      const died = this.resolveRelic(relic, [{ type: 'gainStrength', amount: mod.amount ?? 0 }]);
      if (died) return this.relicOutcome(died);
    }
    return null;
  }

  /** turnStart hooks after the draw and the start-of-turn powers; on turn 1 Bellows upgrades the hand last. */
  private relicTurnStart(): Outcome | null {
    const out = this.relicHooks('turnStart');
    if (out) return out;
    if (this.state.turn !== 1) return null;
    for (const { relic } of scriptMods(this.relics, 'bellows')) {
      this.log?.push({ t: 'relic', relicId: relic.def.id });
      const { hand } = this.player;
      for (const c of [...hand]) if (this.canUpgrade(c)) this.upgradeInstance(c, hand);
    }
    return null;
  }

  /**
   * After a card is played (once per play): `cardPlayed` hooks count matching cards in
   * PlayerState.relicCounters and fire on every `everyCards`-th one (Iron Club); Ornamental Fan
   * gains its Block on every 3rd Attack played this turn.
   */
  private relicCardPlayed(card: CardInstance): Side | null {
    for (const { relic, hook } of hooksFor(this.relics, 'cardPlayed')) {
      if (hook.filter && !matchesFilter(card, hook.filter)) continue;
      if (hook.everyCards !== undefined) {
        const counters = (this.player.relicCounters ??= {});
        const n = (counters[relic.def.id] ?? 0) + 1;
        counters[relic.def.id] = n;
        if (n % hook.everyCards !== 0) continue;
      }
      const died = this.resolveRelic(relic, hookEffects(hook, relic.choice));
      if (died) return died;
    }
    const attacks = this.counters.attacksPlayedThisTurn;
    if (card.type === 'attack' && attacks % ORNAMENTAL_FAN_ATTACKS === 0) {
      for (const { relic, mod } of scriptMods(this.relics, 'ornamentalFan')) {
        const died = this.resolveRelic(relic, [{ type: 'gainBlock', amount: mod.amount ?? 0 }]);
        if (died) return died;
      }
    }
    return null;
  }

  /** Strike Dummy: extra damage per hit for the player's cards that match the modifier's filter. */
  private relicCardDamage(card: CardInstance | undefined): number {
    if (!card) return 0;
    let bonus = 0;
    for (const { mod } of modifiersOf(this.relics, 'cardDamageBonus')) {
      if (!mod.filter || matchesFilter(card, mod.filter)) bonus += mod.amount ?? 0;
    }
    return bonus;
  }

  /** Belt Buckle: extra Dexterity while the player holds no potion. */
  private beltBuckle(): number {
    const held = (this.player.potions ?? []).some((p) => p !== null);
    return held ? 0 : modifierTotal(this.relics, 'dexterityWithoutPotions');
  }

  /**
   * HP the player loses from any source: Tungsten Rod takes N off each loss, then Beating Remnant
   * caps the total for the current turn (the player's turn and the enemy's turn count separately).
   */
  private reduceHpLoss(amount: number): number {
    if (amount <= 0 || this.relics.length === 0) return amount;
    let n = Math.max(0, amount - modifierTotal(this.relics, 'hpLossReduce'));
    const cap = hpLossCap(this.relics);
    if (cap !== null) n = Math.min(n, Math.max(0, cap - this.relicTurnLoss));
    this.relicTurnLoss += n;
    return n;
  }

  /** Unblocked attack damage: reduced on the player (reduceHpLoss); raised by The Boot on the enemy. */
  private attackHpLoss(target: Side, unblocked: number): number {
    if (target === 'player') return this.reduceHpLoss(unblocked);
    const boot = minUnblockedAttack(this.relics);
    return unblocked > 0 && unblocked < boot ? boot : unblocked;
  }

  /** Snecko Eye (Confused): a drawn card with a printed cost costs a random 0–3 for the rest of combat. */
  private confuse(card: CardInstance): void {
    if (card.cost === null || card.xCost || scriptMods(this.relics, 'confused').length === 0) return;
    card.costThisCombat = this.rng.int(CONFUSED_COST[0], CONFUSED_COST[1]);
  }

  /**
   * #205: on a win the combatEnd relics heal (Burning Blood). `hpLost` = start HP − final HP −
   * overheal: every heal counts in full, so it can be negative (lose 5, heal 8 → −3).
   */
  private finish(outcome: Outcome): CombatResult {
    const { player, enemy, log } = this;
    if (outcome === 'win') {
      for (const { relic, hook } of hooksFor(this.relics, 'combatEnd')) {
        this.resolveRelic(relic, hookEffects(hook, relic.choice));
      }
    }
    const hpLost = this.startHp - Math.max(player.hp, 0) - this.overheal;
    const result: CombatResult = {
      seed: this.config.seed,
      outcome,
      turns: this.state.turn,
      hpLost,
      enemyHpRemaining: Math.max(enemy.hp, 0),
    };
    if (this.healedTotal > 0) result.healed = this.healedTotal;
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
