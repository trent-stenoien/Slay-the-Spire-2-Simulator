# Handoff (2026-11-14, early morning)

Read CLAUDE.md first. Phase: **building v2**. v1 is complete.

## v2 scope (Trent, Nov 13)

One character per version. v2 = **the Silent**, **multi-enemy fights**, and **all Act 2 and Act 3 bosses**.
Other characters (Defect, Necrobinder, Regent) are `version: future` until Trent picks the next one.
Scoping report: `docs/v2-scoping.md` (cards #258–#276). Trent's answers are in each card's comments.

## Done in v2

- Earlier: #281, #282, #286, #287, #45, #46, #285, #265, #266, #264, #283 (see git log / closed cards).
- Nov 13–14: #260 (PR #306), #303 (PRs #307, #309, #310), #259 (PR #308), #261 Sly (PR #312), #314 Sly timing / Precise Cut / Slow corrections (PR #319), #315 start-HP field + URL `h` (PR #316), #211 Energy Potion (PR #318), #263 Poison powers (PR #320), #322 slimes, Phrog Parasite, Wriggler, spawns, weighted patterns, golden `randomPicks` (PRs #324, #325 contract, #326), #329 Wriggler arrival stun keeps its opener (PR #330).
- Golden combats replayed and passing: 2 (#179), 4 (#197), 8 (#198), 12 (#302). The harness supports several enemies, per-enemy states, forced enemy moves, `randomPicks` and `spawned`.
- Calculated Gamble moved to #311 (`version: future`; Trent unsure it should exist).

## Questions waiting for Trent

- #263 builder rulings: one Poison card/trigger = one Outbreak application however many enemies; Artifact-negated applications don't count; Outbreak damage is Blockable, no Strength; Envenom's Poison counts for Outbreak; Corrosive Wave also fires on draws at the hand limit; Mirage with 0 Poison still gains Dexterity as Block.
- Outbreak: we kept our data (Uncommon Power, cost 2/1, 11 damage every 3 applications) over the wiki's (looks like beta V0.110).
- Spawns have no GameEvent, so the log does not show them: does Trent want a `spawn` event (contract change)?
- Unconfirmed builder calls (low risk): #314 (queued Sly card not played if reshuffled away; Calamity after the Sly plays), #318 (Energy Potion never held for X-cost cards).

## Ready to build (suggested order)

- #295 golden combat 11 (Shrinker Beetle, A10, `startHp` 40): move to Ready and build.
- #268 dynamic Sly, Nightmare, The Hunt; #284 Shiv play rule; #304 targeted-vs-random refinement; #12 cheapest block set.
- Bosses: #270, #271 (modal per strategy for Curse of Knowledge; all enemy heals capped at max HP), #272, #273, #274 (Nemesis was a scoping error: re-check phase 3 on the wiki), #275 (Back Attack: you face the enemy you last targeted with any targeted card; the other claw hits +50%; won when both claws die), #276.
- #256 docs: CLAUDE.md "Board and phases" still says v2 = "other characters' mechanics".
- Backlog, check for questions first: #269 Silent multi-enemy cards, #267 Shiv powers, #323 Sly strategy crediting Poison powers (low priority).

## Working notes

- Trent's preferences: concise replies; link every PR/card; cheapest model that can do the job; batch questions per card.
- Trent authorised the orchestrator to merge reviewed, green PRs (Nov 13). Merge only after the PR's CI check finishes green. A partial PR must say "Part of #N", not `Closes #N`.
- Builders follow `/home/claude/wt/BUILDER_RULES.md` (session-local; recreate it from this list if missing): own worktree under /home/claude/wt with a `node_modules` symlink, never commit `node_modules`, no types.ts changes on feature branches, tests + FEATURES.md + docs/feature-test-map.md, format/lint/typecheck/test/build (+ compare-main for engine), REST-only PRs, short reports.
- Type changes: a separate contract PR to main first (orchestrator-authorised branch), then the feature cards.
- Expect conflicts in engine/combat.ts, engine/strategies.ts, FEATURES.md, docs/feature-test-map.md; the later PR merges `main` and re-runs the checks (resume its builder).
- Golden screenshots live on the `golden-screenshots` branch (`combat-NN/`). Review uses the combat-junior-reviewer (Haiku) and combat-senior-reviewer (Sonnet) agents. Trent's "HP lost" notes are before Burning Blood's heal; fixtures use the net value (#205).
- WebFetch accepts a wiki URL once it has appeared in a WebSearch result, so search first, then fetch.

## Sandbox notes

- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
- Live site: https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/ (Vite base is `'./'`).
