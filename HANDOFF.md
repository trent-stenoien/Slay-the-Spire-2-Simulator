# Handoff (2026-11-13, evening)

Read CLAUDE.md first. Phase: **building v2**. v1 is complete.

## v2 scope (Trent, Nov 13)
One character per version. v2 = **the Silent**, **multi-enemy fights**, and **all Act 2 and Act 3 bosses**.
Other characters (Defect, Necrobinder, Regent) are `version: future` until Trent picks the next one.
Scoping report: `docs/v2-scoping.md` (cards #258–#276). Trent's answers are in each card's comments.

## Done in v2 (this session, all CI green)
- #281 / PR #288: enemies take their full turns in order, left to right.
- #282 / PR #290: "Lowest HP first" = HP + Block; HP-direct effects (Poison, ...) rank by plain HP. Add Doom/Capture Spirit to the check in `decide` when they exist.
- Contract PRs #289 (randomTarget, character `ascension.startHp`, `alternate` pattern) and #297 (Silent PowerIds, counters, conditions).
- #287 / PR #292: Inklet (HP 11–17, A8 12–18; alternate pattern with per-slot opener).
- #286 / PR #293: A2+ lowers starting HP only (Ironclad 64, Silent 56); Max HP unchanged. No start-HP field in the setup UI yet.
- #45 / PR #294: random-target cards (per-hit random target via Rng when 2+ enemies live; play first, re-plan).
- #46 / PR #296: Poison-only cards before attacks when the enemy lives 2+ turns.
- #285 / PR #298: Inky Shivs (Blade of Ink).
- #265 / PR #299, #266 / PR #300, #264 / PR #301: Silent counters/conditions, trigger powers (incl. Well-Laid Plans retain rule, Tracking), temporary powers (incl. Dodge and Roll).

## In review
- #283 / PR #291 Omnislice splash: Trent confirmed splash = total damage dealt incl. Blocked. Builder is merging `main` (was conflicting); merge once CI is green.

## Ready to build (suggested order)
- #303 Bygone Effigy, Slow, Sleeping, Poison Potion, Fishing Rod (unblocks golden combat 12).
- #259 draw/discard/energy (Survivor etc.; discard order = `chooseDiscard` in strategies.ts from #266), #260 (incl. Footwork's empty effects), #261 Sly, #263 Poison powers (Envenom: Attack cards only; Accelerant extra triggers also reduce Poison; re-check Outbreak, Haze, Flick Flack on the wiki), #268.
- #284 Shiv play rule, #304 targeted-vs-random refinement, #12 cheapest block set.
- Bosses: #270, #271 (modal per strategy for Curse of Knowledge; all enemy heals capped at max HP), #272, #273, #274 (Nemesis was a scoping error: re-check phase 3 on the wiki), #276.
- #256 docs: CLAUDE.md "Board and phases" version definitions still say v2 = "other characters' mechanics".
- After those: #269 Silent multi-enemy cards, #267 Shiv powers (both may still have questions; check the card bodies).

## Questions waiting for Trent
- #275 Kaiser Crab: circle back near the end of v2.

## Golden combats
- #295 (combat 11, Shrinker Beetle) and #302 (combat 12, Bygone Effigy): reviewed, all items resolved. Fixtures need `startHp` (40 and 30: mid-run). Combat 12 waits for #303, #259, #260.
- Screenshots: compress to ~1024 px wide JPEG (quality ~72, 55–80 KB) before review, as for combats 10–12.

## Working notes
- Trent's preferences: concise replies; link every PR/card; cheapest model that can do the job; batch questions per card.
- Parallel agents each get their own `git worktree` under /home/claude/wt. Expect conflicts in engine/combat.ts, engine/strategies.ts, engine/rules.ts, data/validate/*, FEATURES.md, docs/feature-test-map.md; the later PR merges `main` and re-runs the checks (resume its builder).
- Type changes: a separate contract PR to main first (orchestrator-authorised branch), then the feature cards. Builders stop and report when they need one.
- Merge only after the PR's CI check finishes green; sub-agents run `npm run format` before handing back.
- Golden screenshots live on the `golden-screenshots` branch (`combat-NN/`, compressed JPEGs + notes.md + junior/senior review files). Review uses the combat-junior-reviewer (Haiku) and combat-senior-reviewer (Sonnet) agents. Fixtures can script Havoc's top-card plays with `playedFromDraw`.
- WebFetch accepts a wiki URL once it has appeared in a WebSearch result or the conversation, so search first, then fetch (also in the skill).

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
- Live site: https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/ (Vite base is `'./'`).
