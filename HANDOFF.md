# Handoff (2026-11-15, evening)

Read CLAUDE.md first. Phase: **building v2**. v1 is complete.

## v2 scope (Trent, Nov 13)

One character per version. v2 = **the Silent**, **multi-enemy fights**, and **all Act 2 and Act 3 bosses**.
Other characters are `version: future`. Scoping report: `docs/v2-scoping.md`. Trent's answers are in each card's comments.

## Done (Nov 14–15)

PRs #370–#392: #347 Vulnerable value scaled by enemy intent; #339 Shiv makers + attack factors (parts in #371, #373, #377, #378, #380, #386; closed, leftovers → #391 future); #274 Test Subject (#372 contract, #381); #276 Queen + Chains of Binding (#375 contract, #374); #323 Sly Poison powers (#379); #382 Test Subject strategy (revive, Intangible, Enrage); #383 Bound in log (#388 contract, #387); #384 types comments (#385); #389 shot script (`--enemy`, `--click`, log opens a combat link) (#390); #275 contract (#392).

## Waiting on Trent

- #275 Kaiser Crab (status: questions): start facing + left claw, targeted potions turn you?, hidden effects of Targeting Reticle/Laser/Enlarging Strike, facing after one claw dies, HP raw 209/199 vs fan sites −10. Contract #392 merged; boss build waits for answers. Targeting: existing per-strategy priority for now; Trent will circle back.
- Builder calls Trent will circle back to: Enrage weighs Skills against 3 turns (ENRAGE_TURNS); Painful Stabs 1 Wound per HP-damaging hit; Queen finishes her opener if the Amalgam dies early; plus older ones on #270, #269, #271–#273, #346, #267/#356, and Vulnerable scale (×1.5 not attacking, 1 − unblocked/HP).
- #368 pinned (future); don't build.

## Next

- #275 once answered (Opus). Then the full quality-review loop (docs/quality-loop.md), since v2's cards are done.
- Possible small card: golden harness can't check enemy HP after plays on a Poison-kill turn.

## Working notes

- Trent: concise replies; link every PR/card; cheapest model that can do the job (Opus for bosses/engine design); batch questions per card.
- Trent authorised the orchestrator to merge reviewed, green PRs. Before merging: if the PR is behind main, `PUT pulls/N/update-branch`, wait for CI green, then merge (squash). Partial PRs say "Part of #N".
- Builders follow `/home/claude/wt/BUILDER_RULES.md` (session-local; recreate from this list if missing): own worktree under /home/claude/wt from origin/main with a `node_modules` symlink; never commit node_modules; no types.ts changes on feature branches; tests + FEATURES.md + docs/feature-test-map.md; format/lint/typecheck/test/build + compare-main; REST-only PRs; short reports; `npm run format` may rewrite engine/golden/README.md (revert it).
- Type changes: the builder stops and reports; the orchestrator authorises a `contract-<N>-types` branch (types only, not simulated, compare-main identical), merges it, then the builder finishes the card. Resuming the same builder (SendMessage) saves context.
- Parallel PRs clash on FEATURES.md item numbers and docs/feature-test-map.md rows; the later PR merges main and renumbers.
- Board: card leaves via `status: <column>` label; board-sync Action does the rest.
- Wiki: WebFetch accepts a wiki URL only after it appeared in a WebSearch result; several boss pages never surface, so builders fall back to data/raw (v0.107.1) and note it.
- Not v2 unless already labelled v2 (Trent, Nov 15): new enemies/relics outside v2 go to version: future.
- Wiki: WebFetch of a wiki URL needs Trent's approval unless he pasted it; ask him for the link when a builder is blocked.

## Sandbox notes

- GitHub: REST only (GraphQL blocked). Issues/PRs via `gh api repos/.../issues|pulls`.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
- Live site: https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/
