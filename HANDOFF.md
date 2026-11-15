# Handoff (2026-11-14, afternoon)

Read CLAUDE.md first. Phase: **building v2**. v1 is complete.

## v2 scope (Trent, Nov 13)

One character per version. v2 = **the Silent**, **multi-enemy fights**, and **all Act 2 and Act 3 bosses**.
Other characters are `version: future`. Scoping report: `docs/v2-scoping.md`. Trent's answers are in each card's comments.

## Done this session (Nov 14)

PRs #336–#365: #256 docs, #295 golden combat 11, #284 Shiv play rule, #304 + #344 targeted kill check (all modifiers),
#268 Sly/Nightmare/Master Planner/The Hunt, #12 cheapest set (attacks: most total damage for the Energy),
#270 boss player debuffs, #269 Silent multi-enemy cards, #267 Shiv powers, #356 Shiv refinements,
#271 Knowledge Demon (Curse of Knowledge choice + per-strategy modal, enemy heal log, Act 2 picker),
#272 The Insatiable (Sandpit, Frantic Escape), #273 Aeonglass (Act 3 picker, Withering Presence, Wither levels).

## Waiting on Trent (questions are on the cards)

- Builder calls shipped, awaiting confirmation: #270 Disintegration stacks add, Sloth counts hand plays only; #269 Echoing Slash repeat kills chain, Bouncing Flask re-rolls each target; #271 Curse amounts Mind Rot 1 / Sloth 3 / Waste Away 1; #272 Sandpit loss checked at the enemy's turn start after Poison; #273 Wither +3 per level, X starts at 0, Ebb 22 (A9 26) vs brokenbuilds' 26 (32); #346 Nightmare doesn't copy this-turn cost changes, The Hunt's card rewards not shown in Results; #267/#356 Phantom Blades keeps 1 Shiv.
- #276: do 3 Chains of Binding bind the first 3 cards drawn each turn? #275 Kaiser Crab: Trent wants it near the end of v2.
- #368 Up My Sleeve long-combat bonus: pinned by Trent (version future); don't build.

## Next (Ready; answers in each card's comments, Nov 14 pm)

- #339 Shiv makers and attack factors: Shivs first unless lethal to the player; Storm of Steel = attack worth its Shivs' damage, played after all other cards; Shadow Step vs Storm by synergies; Cloak and Dagger preferred over other Block; all attack factors for every attack; enemies that punish Skills (Infested Prism's Tainted, Test Subject phase 1), Attacks (Thorns: Spiny Toad, Toadpole), Powers (Globe Head), card count (Aeonglass), or reward card count (Bygone Effigy). Large: split into smaller PRs.
- #347 value Vulnerable over its duration: use the enemy's next attack and the estimated extra damage on attacks played while it lasts.
- #274 Test Subject: enemy debuffs and Block clear between phases; player buffs/debuffs carry; enemy Intangible ends at the end of the player's turn, player Intangible at the end of the enemy's turn.
- #276 once answered (or with a builder call); #275 last; #323 (low priority).
- #348 closed (not planned): golden combats are the benchmark; no per-enemy stats needed.
- Possible small cards: golden harness can't check enemy HP after plays on a Poison-kill turn.
- After v2's cards: the full quality-review loop (docs/quality-loop.md).

## Working notes

- Trent: concise replies; link every PR/card; cheapest model that can do the job (Opus for bosses/engine design); batch questions per card.
- Trent authorised the orchestrator to merge reviewed, green PRs. Before merging: if the PR is behind main, `PUT pulls/N/update-branch`, wait for CI green, then merge (squash). Partial PRs say "Part of #N".
- Builders follow `/home/claude/wt/BUILDER_RULES.md` (session-local; recreate from this list if missing): own worktree under /home/claude/wt from origin/main with a `node_modules` symlink; never commit node_modules; no types.ts changes on feature branches; tests + FEATURES.md + docs/feature-test-map.md; format/lint/typecheck/test/build + compare-main; REST-only PRs; short reports; `npm run format` may rewrite engine/golden/README.md (revert it).
- Type changes: the builder stops and reports; the orchestrator authorises a `contract-<N>-types` branch (types only, not simulated, compare-main identical), merges it, then the builder finishes the card. Resuming the same builder (SendMessage) saves context.
- Parallel PRs clash on FEATURES.md item numbers and docs/feature-test-map.md rows; the later PR merges main and renumbers.
- Board: card leaves via `status: <column>` label; board-sync Action does the rest.
- Wiki: WebFetch accepts a wiki URL only after it appeared in a WebSearch result; several boss pages never surface, so builders fall back to data/raw (v0.107.1) and note it.

## Sandbox notes

- GitHub: REST only (GraphQL blocked). Issues/PRs via `gh api repos/.../issues|pulls`.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
- Live site: https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/
