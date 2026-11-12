/**
 * #205 Relics: pure helpers the combat engine uses to decide which relic hooks fire and which
 * standing rules (modifiers) are on. No combat state is changed here; engine/combat.ts resolves
 * the effects. Hooks fire in the order the relics were picked, then in the order of each relic's
 * `hooks` list.
 */
import type { CombatConfig, Effect, GameData, RelicDef, RelicHook, RelicModifier, RelicWhen } from './types';

/** A relic in play with its setup choice (Girya's Strength). */
export interface ActiveRelic {
  def: RelicDef;
  choice?: number;
}

/** Ornamental Fan: Block every time this many Attacks are played in one turn. */
export const ORNAMENTAL_FAN_ATTACKS = 3;

/** Snecko Eye (Confused): a drawn card's cost becomes a random number in this range for the combat. */
export const CONFUSED_COST: readonly [number, number] = [0, 3];

/** Engine handlers for `script` modifiers. */
export const RELIC_SCRIPTS = ['ornamentalFan', 'bellows', 'ghostSeed', 'confused', 'slingOfCourage'] as const;

/** The relics of a combat config. Unknown or unsimulated relics throw, like unsimulated cards. */
export function activeRelics(data: GameData, config: CombatConfig): ActiveRelic[] {
  return (config.relics ?? []).map((setup) => {
    const def = data.relics?.[setup.relicId];
    if (!def) throw new Error(`Unknown relic "${setup.relicId}"`);
    if (!def.simulated) throw new Error(`Relic "${def.name}" is not simulated yet`);
    const choice = def.choice ? (setup.choice ?? def.choice.default) : undefined;
    if (def.choice && !def.choice.values.includes(choice as number)) {
      throw new Error(`Relic "${def.name}": choice ${choice} is not one of ${def.choice.values.join(', ')}`);
    }
    return choice === undefined ? { def } : { def, choice };
  });
}

/** Effects of a hook, with every `amount` replaced by the setup choice when `amountFromChoice` is set. */
export function hookEffects(hook: RelicHook, choice: number | undefined): Effect[] {
  if (!hook.amountFromChoice || choice === undefined) return hook.effects;
  return hook.effects.map((e) => ('amount' in e ? ({ ...e, amount: choice } as Effect) : e));
}

/** True when a turn-based hook's `turn` / `everyTurns` conditions hold on this player turn. */
export function turnMatches(hook: RelicHook, turn: number): boolean {
  if (hook.turn !== undefined && hook.turn !== turn) return false;
  if (hook.everyTurns !== undefined && turn % hook.everyTurns !== 0) return false;
  return true;
}

/** The hooks of every relic for `when`, in pick order. */
export function hooksFor(relics: readonly ActiveRelic[], when: RelicWhen): { relic: ActiveRelic; hook: RelicHook }[] {
  const out: { relic: ActiveRelic; hook: RelicHook }[] = [];
  for (const relic of relics) for (const hook of relic.def.hooks) if (hook.when === when) out.push({ relic, hook });
  return out;
}

/** Modifiers of one kind (with their relic), in pick order. */
export function modifiersOf(
  relics: readonly ActiveRelic[],
  kind: RelicModifier['kind'],
): { relic: ActiveRelic; mod: RelicModifier }[] {
  const out: { relic: ActiveRelic; mod: RelicModifier }[] = [];
  for (const relic of relics)
    for (const mod of relic.def.modifiers ?? []) if (mod.kind === kind) out.push({ relic, mod });
  return out;
}

/** Sum of `amount` over every modifier of one kind (0 when none). */
export function modifierTotal(relics: readonly ActiveRelic[], kind: RelicModifier['kind']): number {
  return modifiersOf(relics, kind).reduce((n, { mod }) => n + (mod.amount ?? 0), 0);
}

/** The `script` modifiers with this handler id. */
export function scriptMods(relics: readonly ActiveRelic[], id: string): { relic: ActiveRelic; mod: RelicModifier }[] {
  return modifiersOf(relics, 'script').filter(({ mod }) => mod.id === id);
}

/**
 * The smallest cap among `hpLossCapPerTurn` modifiers (Beating Remnant), or null when none.
 * Several caps don't add: the lowest wins.
 */
export function hpLossCap(relics: readonly ActiveRelic[]): number | null {
  const caps = modifiersOf(relics, 'hpLossCapPerTurn').map(({ mod }) => mod.amount ?? 0);
  return caps.length > 0 ? Math.min(...caps) : null;
}

/** The highest `minUnblockedAttack` (The Boot), or 0 when none. */
export function minUnblockedAttack(relics: readonly ActiveRelic[]): number {
  return modifiersOf(relics, 'minUnblockedAttack').reduce((n, { mod }) => Math.max(n, mod.amount ?? 0), 0);
}

/** The lowest `cardsPerTurnLimit` (Velvet Choker), or null when none. */
export function cardsPerTurnLimit(relics: readonly ActiveRelic[]): number | null {
  const limits = modifiersOf(relics, 'cardsPerTurnLimit').map(({ mod }) => mod.amount ?? 0);
  return limits.length > 0 ? Math.min(...limits) : null;
}

/** Ghost Seed: a Strike or Defend (name contains "Strike" or "Defend"). */
export function isStrikeOrDefend(name: string): boolean {
  return name.includes('Strike') || name.includes('Defend');
}
