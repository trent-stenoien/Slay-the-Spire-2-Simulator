/**
 * Groups a combat's event log into rounds (one player turn + the enemy turn
 * that follows) and tracks HP / block snapshots for display.
 */
import type { DebuffKind, Debuffs, Effect, EnemyIntent, GameEvent, Outcome } from '../../engine/types';
import { effectText } from './cardText';

export interface SideSnapshot {
  hp: number;
  maxHp: number;
  block: number;
  strength: number;
  debuffs: Debuffs;
  /** Poison stacks (enemy only; always 0 for the player). */
  poison: number;
}

/** Both sides at one moment. `enemy` is the first enemy; #5: `enemies` has every enemy, left to right. */
export interface RoundSnapshot {
  player: SideSnapshot;
  enemy: SideSnapshot;
  enemies: SideSnapshot[];
}

export interface Round {
  turn: number;
  /** State at the start of the round, before the player's block resets. */
  start: RoundSnapshot;
  /** State at the end of the round (after the enemy acts, or when combat ended). */
  end: RoundSnapshot;
  /** Card ids drawn at the start of this round's player turn, in order. Mid-turn draws are events. */
  drawn: string[];
  /** Player phase events (after turnStart player, up to the enemy turnStart). */
  playerEvents: GameEvent[];
  /** Enemy move name, or null if the combat ended first. #5: several enemies' moves joined by " + ". */
  enemyMove: string | null;
  /** Enemy move id, or null if the combat ended first. */
  enemyMoveId: string | null;
  /** Enemy phase events. */
  enemyEvents: GameEvent[];
  /** Total damage the enemy's move tried to deal (before block). */
  enemyAttack: number;
  /** Total damage the player's cards dealt before enemy block. */
  playerAttack: number;
}

export interface Replay {
  playerMaxHp: number;
  enemyMaxHp: number;
  seed: number;
  rounds: Round[];
  outcome: Outcome | null;
  hpLost: number | null;
}

function emptyDebuffs(): Debuffs {
  return { vulnerable: 0, weak: 0, frail: 0 };
}

function clone(s: SideSnapshot): SideSnapshot {
  return { ...s, debuffs: { ...s.debuffs } };
}

export function buildReplay(log: readonly GameEvent[]): Replay {
  const startEv = log.find((e) => e.t === 'combatStart');
  const playerMaxHp = startEv?.t === 'combatStart' ? startEv.playerHp : 0;
  const enemyMaxHp = startEv?.t === 'combatStart' ? startEv.enemyHp : 0;
  const player: SideSnapshot = {
    hp: playerMaxHp,
    maxHp: playerMaxHp,
    block: 0,
    strength: 0,
    debuffs: emptyDebuffs(),
    poison: 0,
  };
  // #5: one snapshot per enemy; `target` events say which enemy later enemy-side events are about.
  const enemyHps = startEv?.t === 'combatStart' ? (startEv.enemyHps ?? [enemyMaxHp]) : [enemyMaxHp];
  const enemies: SideSnapshot[] = enemyHps.map((hp) => ({
    hp,
    maxHp: hp,
    block: 0,
    strength: 0,
    debuffs: emptyDebuffs(),
    poison: 0,
  }));
  let enemy = enemies[0]!;
  const side = (s: 'player' | 'enemy') => (s === 'player' ? player : enemy);
  const snapshot = (): RoundSnapshot => {
    const all = enemies.map(clone);
    return { player: clone(player), enemy: all[0]!, enemies: all };
  };

  const rounds: Round[] = [];
  let cur: Round | null = null;
  let phase: 'player' | 'enemy' = 'player';
  let outcome: Outcome | null = null;
  let hpLost: number | null = null;
  /** True once a card has been played this round: later draws come from card effects. */
  let played = false;

  const closeRound = () => {
    if (cur) cur.end = snapshot();
  };

  for (const ev of log) {
    switch (ev.t) {
      case 'turnStart':
        if (ev.side === 'player') {
          closeRound();
          const snap = snapshot();
          cur = {
            turn: ev.turn,
            start: snap,
            end: snap,
            drawn: [],
            playerEvents: [],
            enemyMove: null,
            enemyMoveId: null,
            enemyEvents: [],
            enemyAttack: 0,
            playerAttack: 0,
          };
          rounds.push(cur);
          phase = 'player';
          played = false;
          continue;
        }
        phase = 'enemy';
        continue;
      case 'target':
        enemy = enemies[ev.enemy] ?? enemy;
        break;
      case 'spawn':
        enemies[ev.index] = {
          hp: ev.hp,
          maxHp: ev.hp,
          block: 0,
          strength: 0,
          debuffs: emptyDebuffs(),
          poison: 0,
        };
        break;
      case 'blockReset':
        side(ev.side).block = 0;
        break;
      case 'block':
        side(ev.side).block = ev.total;
        break;
      case 'strength':
        side(ev.side).strength = ev.total;
        break;
      case 'debuff':
      case 'debuffTick':
        side(ev.side).debuffs[ev.kind as DebuffKind] = ev.total;
        break;
      case 'poison':
        enemy.poison = ev.total;
        break;
      case 'poisonDamage':
        enemy.hp = ev.hpAfter;
        enemy.poison = ev.amount - 1;
        break;
      case 'damage': {
        const t = side(ev.target);
        t.block -= ev.blocked;
        t.hp = Math.max(0, t.hp - ev.hpLoss);
        // #115: a curse or status hitting the player (source = target) is not an attack by either side.
        if (cur && ev.source !== ev.target) {
          if (ev.source === 'enemy') cur.enemyAttack += ev.amount;
          else cur.playerAttack += ev.amount;
        }
        break;
      }
      case 'play':
        played = true;
        break;
      case 'draw':
        // The turn-start draw is summarised in `drawn`; draws from cards are listed as events.
        if (!played) {
          cur?.drawn.push(ev.cardId);
          continue;
        }
        break;
      case 'loseHp':
        side(ev.side).hp = ev.hpAfter;
        break;
      case 'heal':
        player.hp = ev.hpAfter;
        break;
      case 'maxHp':
        player.maxHp = ev.maxHpAfter;
        player.hp = ev.hpAfter;
        break;
      case 'enemyMove':
        if (cur) {
          cur.enemyMove = cur.enemyMove === null ? ev.name : `${cur.enemyMove} + ${ev.name}`;
          cur.enemyMoveId ??= ev.moveId;
        }
        break;
      case 'combatEnd':
        outcome = ev.outcome;
        hpLost = ev.hpLost;
        break;
      default:
        break;
    }
    if (cur && ev.t !== 'combatStart' && ev.t !== 'combatEnd') {
      (phase === 'player' ? cur.playerEvents : cur.enemyEvents).push(ev);
    }
  }
  closeRound();

  const seed = startEv?.t === 'combatStart' ? startEv.seed : 0;
  return { playerMaxHp, enemyMaxHp, seed, rounds, outcome, hpLost };
}

/** One line of text per event, for the log view. `name` maps a cardId to a display name. */
/**
 * #205: HP lost as words: "lost 6 HP", or "gained 3 HP" when heals beat the damage (HP lost −3).
 * `ing` gives "losing" / "gaining".
 */
export function hpLostPhrase(hpLost: number, ing = false): string {
  if (hpLost < 0) return `${ing ? 'gaining' : 'gained'} ${-hpLost} HP`;
  return `${ing ? 'losing' : 'lost'} ${hpLost} HP`;
}

/** #205: "burning_blood" → "Burning Blood" (the default relic name when none is given). */
export function relicIdName(id: string): string {
  return id
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function describeEvent(
  ev: GameEvent,
  name: (cardId: string) => string,
  relicName: (relicId: string) => string = relicIdName,
): string | null {
  const gains = (s: 'player' | 'enemy') => (s === 'player' ? 'You gain' : 'Enemy gains');
  switch (ev.t) {
    case 'play':
      return ev.x !== undefined
        ? `Play ${name(ev.cardId)} (X = ${ev.x}, ${ev.energyLeft} energy left)`
        : `Play ${name(ev.cardId)} (${ev.energyLeft} energy left)`;
    case 'energy':
      return `You gain ${ev.amount} energy (${ev.total} energy)`;
    case 'damage': {
      const by = ev.source !== ev.target ? (ev.source === 'player' ? 'You hit' : 'Enemy hits') : 'You take';
      const parts = [`${by} for ${ev.amount}`];
      if (ev.blocked > 0) parts.push(`${ev.blocked} blocked`);
      parts.push(`${ev.hpLoss} HP lost`);
      return parts.join(', ');
    }
    case 'block':
      return `${gains(ev.side)} ${ev.amount} Block (total ${ev.total})`;
    case 'strength':
      return `${gains(ev.side)} ${ev.amount} Strength (total ${ev.total})`;
    case 'debuff':
      return `${ev.side === 'player' ? 'You get' : 'Enemy gets'} ${ev.amount} ${cap(ev.kind)} (total ${ev.total})`;
    case 'poison':
      return `Enemy gets ${ev.amount} Poison (total ${ev.total})`;
    case 'shrink':
      return `You are Shrunk: your attacks deal ${ev.percent}% less damage`;
    case 'poisonDamage':
      return `Enemy loses ${ev.amount} HP from Poison (${ev.hpAfter} HP left)`;
    case 'loseHp':
      return ev.side === 'player'
        ? `You lose ${ev.amount} HP (${ev.hpAfter} HP left)`
        : `Enemy loses ${ev.amount} HP (${ev.hpAfter} HP left)`;
    case 'heal':
      return `You heal ${ev.amount} HP${ev.source ? ` from ${relicName(ev.source)}` : ''} (${ev.hpAfter} HP)`;
    case 'relic':
      return `${relicName(ev.relicId)} activates`;
    case 'maxHp':
      return ev.amount >= 0
        ? `Your Max HP rises by ${ev.amount} (${ev.hpAfter}/${ev.maxHpAfter} HP)`
        : `You lose ${-ev.amount} Max HP (${ev.hpAfter}/${ev.maxHpAfter} HP)`;
    case 'enemySkip':
      return 'Enemy is Stunned and skips its move';
    case 'draw':
      return `You draw ${name(ev.cardId)}`;
    case 'powerApplied':
      return powerAppliedText(ev);
    case 'powerRemoved':
      if (ev.power === 'noDraw') return null;
      if (ev.power === 'vigor') return 'Your Vigor is used up';
      return `${ev.side === 'player' ? 'Your' : "Enemy's"} ${powerName(ev.power)} ends`;
    case 'exhaust':
      // #108: 'effect' = a card's effect picked it (Burning Pact, True Grit, Fiend Fire).
      return `${name(ev.cardId)} exhausted${EXHAUST_NOTE[ev.reason]}`;
    case 'discard':
      return ev.reason === 'handLimit' ? `${name(ev.cardId)} discarded (hand full)` : null;
    case 'shuffle':
      return ev.reason === 'reshuffle' ? `Discard pile shuffled into draw pile (${ev.count} cards)` : null;
    case 'enemyMove':
      return `Enemy uses ${ev.name}`;
    case 'target':
      // #5: the following lines are about this enemy (1-based, left to right).
      return `Enemy ${ev.enemy + 1}:`;
    case 'spawn':
      // #333: an enemy joined mid-fight (1-based slot, left to right).
      return `${ev.enemyId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} appears as Enemy ${ev.index + 1} (${ev.hp} HP${ev.stunned ? ', Stunned' : ''})`;
    case 'potion':
      return `You use ${ev.potionId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
    default:
      return null;
  }
}

/** #109: log text for a power gain or change. */
function powerAppliedText(ev: Extract<GameEvent, { t: 'powerApplied' }>): string {
  const who = ev.side === 'player' ? 'You' : 'Enemy';
  const label = powerName(ev.power);
  switch (ev.power) {
    case 'noDraw':
      return 'You cannot draw additional cards this turn';
    case 'barricade':
      return 'Barricade: Block is no longer removed at the start of your turn';
    case 'corruption':
      return 'Corruption: Skills cost 0 and are Exhausted when played';
    case 'upgradeAtCombatEnd':
      return 'Improvement: a random card is Upgraded at the end of combat (no effect in this combat)';
    case 'cruelty':
      return `Cruelty: Vulnerable enemies take ${ev.total}% more damage`;
    case 'rollingBoulder':
      return ev.amount === ev.total
        ? `Rolling Boulder: ${ev.total} damage at the start of your turn`
        : `Rolling Boulder grows by ${ev.amount} (${ev.total} damage)`;
    default:
      return ev.amount < 0
        ? `${who === 'You' ? 'Your' : "Enemy's"} ${label} drops by ${-ev.amount} (${ev.total} left)`
        : `${who === 'You' ? 'You gain' : 'Enemy gains'} ${ev.amount} ${label} (total ${ev.total})`;
  }
}

const EXHAUST_NOTE: Record<Extract<GameEvent, { t: 'exhaust' }>['reason'], string> = {
  ethereal: ' (Ethereal)',
  keyword: '',
  effect: ' (by a card effect)',
  power: ' (by a power)',
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** #109: display names where the PowerId isn't the in-game name (it names the card instead). */
const POWER_LABEL: Record<string, string> = {
  energyPerTurn: 'Pyre',
  vigorPerTurn: 'Prep Time',
  powersCostLess: 'Curious',
  upgradeAtCombatEnd: 'Improvement',
};

/** "demonForm" → "Demon Form"; see POWER_LABEL. */
function powerName(id: string): string {
  return POWER_LABEL[id] ?? cap(id.replace(/([A-Z])/g, ' $1'));
}

/**
 * Move id the enemy intends in round `i`: the logged move, or (for a final round that ended
 * before the enemy acted) the intent the strategy saw that turn (`seen`: turn → move id).
 * Null when neither is known (e.g. combat ended before the player's first decision).
 */
export function intendedMoveId(rounds: readonly Round[], i: number, seen: ReadonlyMap<number, string>): string | null {
  const r = rounds[i];
  if (!r) return null;
  return r.enemyMoveId ?? seen.get(r.turn) ?? null;
}

/** "Ascension 5" (the log page spells the level out). */
export function ascensionLabel(level: number): string {
  return `Ascension ${level}`;
}

/**
 * What a move does, as shown in the intent line: attacks use the damage the player will actually
 * take (Strength, Weak and Vulnerable applied), other effects use the plain card-text wording.
 */
export function moveEffectsText(effects: readonly Effect[], intent: EnemyIntent): string {
  let a = 0;
  return effects
    .map((e) => {
      if (e.type !== 'attack') return effectText(e);
      const atk = intent.attacks[a++];
      const dmg = atk?.damagePerHit ?? e.damage;
      return e.hits === 1 ? `${dmg} damage` : `${dmg} damage ${e.hits} times`;
    })
    .join(', ');
}

/** "Enemy Intent: Butt (12 damage)". */
export function enemyIntentLabel(intent: EnemyIntent | null, effects: readonly Effect[] = []): string {
  if (!intent) return 'Enemy Intent: unknown';
  // #5: a combined intent of several enemies has no effect list; it shows the total incoming damage.
  const fx =
    moveEffectsText(effects, intent) || (intent.totalIncoming > 0 ? `${intent.totalIncoming} damage in all` : '');
  return `Enemy Intent: ${intent.name}${fx ? ` (${fx})` : ''}`;
}
