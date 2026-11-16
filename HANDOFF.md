# Handoff (2026-11-15, night)

Read CLAUDE.md first. Phase: **v2 complete** (all cards done, quality loop #396 passed in round 1). Waiting on Trent to pick what's next.

## Versions

- v1 (Ironclad): complete. v2 (the Silent, multi-enemy fights, Act 2 and Act 3 bosses): complete.
- v3: so far only #275 Kaiser Crab (moved from v2 by Trent, Nov 15). Its open questions are in the card's last comment (start facing/left claw, targeted potions turn you?, hidden effects of Targeting Reticle/Laser/Enlarging Strike, facing after one claw dies, HP raw 209/199 vs fan sites −10). Contract #392 is already merged.
- Other characters: `version: future` until Trent picks the next one.

## Done (Nov 14–15)

PRs #370–#395: Vulnerable scaled by intent (#347); Shiv makers (#339); Test Subject (#274, #382); Queen + Chains of Binding (#276); Sly Poison powers (#323); Bound in log (#383); shot script (#389); Kaiser Crab contract (#392); golden harness checks enemy HP after plays on a Poison-kill turn (#394). Umbrella cards #255 and #24 closed; #66 (Eradicate) and #8 (other relics/potions) moved to future.

Quality loop v2 (#396): +17 tests (2192), ~200 break-its all caught, Scared Block stress 0 deaths at 10,000 combats, compare-main identical; `decide()` filter chain flattened; map row ids de-duplicated; golden README and v2-scoping note updated.

## Open follow-ups (version: future, Backlog)

#397 golden multi-enemy fixture where order matters; #398 types.ts `sly` comment (contract branch); #399 FEATURES.md has two items 18; #400 split strategies.ts/combat.ts by topic; #401 design doc is still the v1 design.

## Waiting on Trent

- #275 questions (when v3 starts).
- Builder calls he'll circle back to: Enrage weighs Skills against 3 turns (ENRAGE_TURNS); Painful Stabs 1 Wound per HP-damaging hit; Queen finishes her opener if the Amalgam dies early; plus older ones on #270, #269, #271–#273, #346, #267/#356, and Vulnerable scale (×1.5 not attacking, 1 − unblocked/HP).
- #368 pinned (future); don't build.

## Working notes

- Trent: concise replies; link every PR/card; cheapest model that can do the job (Opus for bosses/engine design); batch questions per card.
- Trent authorised the orchestrator to merge reviewed, green PRs. Before merging: if the PR is behind main, `PUT pulls/N/update-branch`, wait for CI green, then merge (squash). Partial PRs say "Part of #N".
- Builders follow `/home/claude/wt/BUILDER_RULES.md` (session-local; recreate from this list if missing): own worktree under /home/claude/wt from origin/main with a `node_modules` symlink; never commit node_modules; no types.ts changes on feature branches; tests + FEATURES.md + docs/feature-test-map.md; `npm run format` plus the checks the task names (CI runs the rest) and compare-main for engine changes; REST-only PRs; short reports; `npm run format` may rewrite engine/golden/README.md (revert it).
- Type changes: the builder stops and reports; the orchestrator authorises a `contract-<N>-types` branch (types only, not simulated, compare-main identical), merges it, then the builder finishes the card. Resuming the same builder (SendMessage) saves context.
- Parallel PRs clash on FEATURES.md item numbers and docs/feature-test-map.md rows; the later PR merges main and renumbers.
- Board: card leaves via `status: <column>` label; board-sync Action does the rest.
- Not v2 unless already labelled v2 (Trent, Nov 15): new enemies/relics outside v2 go to version: future.
- Wiki: WebFetch of a wiki URL needs Trent's approval unless he pasted it (and only after it appeared in a WebSearch result); several boss pages never surface, so builders fall back to data/raw (v0.107.1) and note it. Ask Trent for the link when a builder is blocked.

## Sandbox notes

- GitHub: REST only (GraphQL blocked). Issues/PRs via `gh api repos/.../issues|pulls`. Repo needs `add_repo` (push) at session start.
- Versions: `version: v1`, `v2`, `v3`, `future`, `multiplayer`.
- Live site: https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/
