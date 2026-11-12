/** Plain-language card text, e.g. "Deal 8 damage. Apply 2 Vulnerable." */
import type {
  CardDef,
  CardFilter,
  CardKeyword,
  CardTrigger,
  CardType,
  Effect,
  PileName,
  PowerId,
} from '../../engine/types';

const KEYWORD_LABEL: Record<CardKeyword, string> = {
  unplayable: 'Unplayable',
  ethereal: 'Ethereal',
  eternal: 'Eternal',
  exhaust: 'Exhaust',
  retain: 'Retain',
  innate: 'Innate',
  sly: 'Sly',
};

export function effectText(e: Effect): string {
  switch (e.type) {
    case 'attack': {
      const target = e.allEnemies ? ' to ALL enemies' : '';
      if (e.xTimes) {
        const x = e.xBonus ? `X+${e.xBonus}` : 'X';
        return `Deal ${e.damage} damage${target} ${e.hits === 1 ? x : `${e.hits}×(${x})`} times`;
      }
      return e.hits === 1 ? `Deal ${e.damage} damage${target}` : `Deal ${e.damage} damage${target} ${e.hits} times`;
    }
    case 'gainBlock':
      return `Gain ${e.amount} Block`;
    case 'gainStrength':
      return `Gain ${e.amount} Strength`;
    case 'applyVulnerable':
      return `Apply ${e.amount} Vulnerable`;
    case 'applyWeak':
      return `Apply ${e.amount} Weak`;
    case 'applyFrail':
      return `Apply ${e.amount} Frail`;
    case 'applyPoison':
      return `Apply ${e.amount} Poison`;
    case 'applyShrink':
      return `Apply Shrink (attacks deal ${e.amount}% less damage)`;
    case 'gainEnergy':
      return `Gain ${e.amount} Energy`;
    case 'gainStars':
      return `Gain ${e.amount} Stars`;
    // #106, #107: simulated.
    case 'loseHp':
      return `Lose ${e.amount} HP`;
    case 'draw':
      return `Draw ${e.amount} ${e.amount === 1 ? 'card' : 'cards'}`;
    case 'drawUntil':
      if (e.handFull) return 'Draw cards until your Hand is full';
      return e.stopOn ? `Draw cards until you draw ${filterText(e.stopOn)}` : 'Draw cards until a condition is met';
    // #108: simulated.
    case 'exhaustCards': {
      const where = e.from && e.from !== 'hand' ? ` from your ${PILE_LABEL[e.from]}` : '';
      if (e.mode === 'all') {
        if (!e.filter) return where ? `Exhaust all cards${where}` : 'Exhaust your Hand';
        return `Exhaust all ${filterText(e.filter, true)}${where || ' in your Hand'}`;
      }
      const n = e.count ?? 1;
      return `Exhaust ${e.upTo ? 'up to ' : ''}${n} ${n === 1 ? 'card' : 'cards'}${where}${e.mode === 'random' ? ' at random' : ''}`;
    }
    // #105: plain fallback text for mechanics that are not simulated yet.
    case 'applyPower':
      return powerText(e.power, e.amount);
    case 'applyEnemyPower':
      return `Apply ${e.amount} ${cap(e.power)} to the enemy`;
    case 'schedule':
      return e.delay === 1 ? 'Next turn: special effect' : `In ${e.delay} turns: special effect`;
    case 'dealDamage':
      return `Deal ${e.amount} damage${e.allEnemies ? ' to ALL enemies' : ''}`;
    case 'enemyLoseHp':
      return `Enemy loses ${e.amount} HP`;
    case 'setCost':
      return `Set card costs to ${e.cost} this ${e.duration}`;
    case 'conditional':
      return 'Conditional effect';
    case 'repeat':
      // #108 Second Wind: "Gain 5 Block for each card Exhausted".
      if (e.per === 'lastEffectCount') return `${e.effects.map(effectText).join('. ')} for each card Exhausted`;
      return 'Repeated effect';
    case 'attackFrom':
      return `Deal ${e.damage}+ damage${e.allEnemies ? ' to ALL enemies' : ''}`;
    case 'gainBlockFrom':
      return `Gain ${e.amount}+ Block`;
    case 'growDamage':
      return `Increase damage by ${e.amount} this combat`;
    case 'moveCards':
      return `Move ${e.mode === 'all' ? 'cards' : `${e.upTo ? 'up to ' : ''}${e.count ?? 1} card(s)`} from ${e.from} to ${e.to}`;
    case 'moveSelf':
      return e.when === 'nextTurnStart' ? `Next turn, move this card to ${e.to}` : `Move this card to ${e.to}`;
    case 'upgradeCards':
      return e.mode === 'all' ? 'Upgrade cards' : `Upgrade ${e.count ?? 1} card(s)`;
    case 'playCards':
      return `Play ${e.xTimes ? 'X' : e.count} card(s) from ${e.from}`;
    case 'addReplay':
      return `Give a card ${e.amount} Replay`;
    case 'addCards':
      return `Add ${e.count} card(s) to ${e.to}`;
    case 'transformCards':
      return 'Transform cards';
    case 'heal':
      return `Heal ${e.amount} HP`;
    case 'gainMaxHp':
      return `Raise Max HP by ${e.amount}`;
    case 'loseMaxHp':
      return `Lose ${e.amount} Max HP`;
    case 'gainGold':
      return `Gain ${e.amount} Gold`;
    case 'gainPotion':
      return 'Gain a Random Potion';
    case 'script':
      // #108: Fiend Fire, Thrash.
      if (e.id === 'fiendFire') return `Exhaust your Hand. Deal ${e.values?.[0] ?? 0} damage for each card Exhausted`;
      if (e.id === 'thrash') return 'Exhaust a random Attack in your Hand and add its damage to this card';
      return 'Special effect';
  }
}

/** #107/#109: card text for the simulated powers; others get "Gain N <Power>". */
function powerText(power: PowerId, n: number): string {
  switch (power) {
    case 'noDraw':
      return 'You cannot draw additional cards this turn';
    case 'demonForm':
      return `At the start of your turn, gain ${n} Strength`;
    case 'energyPerTurn':
      return `Gain ${n} Energy at the start of each turn`;
    case 'rollingBoulder':
      return `At the start of your turn, deal ${n} damage to ALL enemies and increase this damage by 5`;
    case 'crimsonMantle':
      return `At the start of your turn, lose 1 HP and gain ${n} Block`;
    case 'plating':
      return `Gain ${n} Plating`;
    case 'barricade':
      return 'Block is not removed at the start of your turn';
    case 'cruelty':
      return `Vulnerable enemies take an additional ${n}% damage`;
    case 'dexterity':
      return `Gain ${n} Dexterity`;
    case 'fasten':
      return `Gain an additional ${n} Block from Defend cards`;
    case 'thorns':
      return `Whenever you are attacked, deal ${n} damage back`;
    case 'vigorPerTurn':
      return `At the start of your turn, gain ${n} Vigor`;
    case 'vigor':
      return `Gain ${n} Vigor`;
    case 'powersCostLess':
      return `Powers cost ${n} Energy less`;
    case 'upgradeAtCombatEnd':
      return 'At the end of combat, Upgrade a random card';
    case 'corruption':
      return 'Skills cost 0 Energy. Whenever you play a Skill, Exhaust it';
    case 'darkEmbrace':
      return `Whenever a card is Exhausted, draw ${n} card${n === 1 ? '' : 's'}`;
    case 'feelNoPain':
      return `Whenever a card is Exhausted, gain ${n} Block`;
    case 'rupture':
      return `Whenever you lose HP on your turn, gain ${n} Strength`;
    case 'inferno':
      return `At the start of your turn, lose 1 HP. Whenever you lose HP on your turn, deal ${n} damage to ALL enemies`;
    case 'juggernaut':
      return `Whenever you gain Block, deal ${n} damage to a random enemy`;
    case 'unmovable':
      return 'The first time you gain Block from a card each turn, double the amount gained';
    case 'vicious':
      return `Whenever you apply Vulnerable, draw ${n} card${n === 1 ? '' : 's'}`;
    case 'panache':
      return `Every time you play 5 cards in a single turn, deal ${n} damage to ALL enemies`;
    case 'automation':
      return `Every 10 cards you draw, gain ${n} Energy`;
    case 'juggling':
      return 'Add a copy of the third Attack you play each turn into your Hand';
    case 'aggression':
      return 'At the start of your turn, put a random Attack from your Discard Pile into your Hand and Upgrade it';
    case 'hellraiser':
      return 'Whenever you draw a card containing "Strike", it is played against a random enemy';
    case 'stampede':
      return 'At the end of your turn, 1 random Attack in your Hand is played against a random enemy';
    case 'mayhem':
      return 'At the start of your turn, play the top card of your Draw Pile';
    case 'nostalgia':
      return 'The first Attack or Skill you play each turn is placed on top of your Draw Pile';
    case 'stratagem':
      return 'Whenever you shuffle your Draw Pile, choose a card from it to put into your Hand';
    default:
      return `Gain ${n} ${cap(power)}`;
  }
}

const TYPE_LABEL: Record<CardType, string> = {
  attack: 'Attack',
  skill: 'Skill',
  power: 'Power',
  status: 'Status',
  curse: 'Curse',
  quest: 'Quest',
};

const PILE_LABEL: Record<PileName, string> = {
  hand: 'Hand',
  draw: 'Draw Pile',
  discard: 'Discard Pile',
  exhaust: 'Exhaust Pile',
};

/**
 * "a non-Attack card", "a Skill card", or "a matching card" for filters without a type rule.
 * `plural`: "non-Attack cards", "Skill cards", "matching cards".
 */
function filterText(f: CardFilter, plural = false): string {
  const [a, noun] = plural ? ['', 'cards'] : ['a ', 'card'];
  if (f.notTypes?.length) return `${a}non-${f.notTypes.map((t) => TYPE_LABEL[t]).join('/')} ${noun}`;
  if (f.types?.length) return `${a}${f.types.map((t) => TYPE_LABEL[t]).join('/')} ${noun}`;
  return `${a}matching ${noun}`;
}

/** #108: "When Exhausted: Gain 2 Energy" for a card's own triggers. */
const TRIGGER_LABEL: Record<CardTrigger['when'], string> = {
  exhausted: 'When Exhausted',
  drawn: 'When drawn',
  turnEndInHand: 'At the end of your turn, if in your Hand',
  turnEndInExhaust: 'At the end of your turn, if in your Exhaust Pile',
};

function triggerText(t: CardTrigger): string {
  const fx = t.effects.map(effectText).join('. ');
  return `${TRIGGER_LABEL[t.when]}: ${fx || 'special effect'}`;
}

/** "noDraw" → "No Draw". */
function cap(id: string): string {
  const words = id.replace(/([A-Z])/g, ' $1');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface CardText {
  name: string;
  /** "1", "0", "X" for X-cost, or "—" for unplayable. */
  cost: string;
  /** Keywords first, then effects, then the card's own triggers (#108), one phrase each. */
  lines: string[];
}

/** Text for a card as it would be in combat (upgrade applied). */
export function cardText(def: CardDef, upgraded: boolean): CardText {
  const up = upgraded ? def.upgraded : null;
  const keywords = up?.keywords ?? def.keywords;
  const effects = up?.effects ?? def.effects;
  const triggers = up?.triggers ?? def.triggers ?? [];
  const cost = keywords.includes('unplayable') ? null : up?.cost !== undefined ? up.cost : def.cost;
  return {
    name: up ? `${def.name}+` : def.name,
    cost: cost === null ? '—' : def.xCost ? 'X' : String(cost),
    lines: [...keywords.map((k) => KEYWORD_LABEL[k]), ...effects.map(effectText), ...triggers.map(triggerText)],
  };
}
