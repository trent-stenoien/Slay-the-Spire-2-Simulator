# Handoff (2026-11-12)

Read CLAUDE.md first. No agents running. Phase: Trent will say when to build. The combat review (step 1 below) is approved; confirm before starting build agents.

## State
- v1 was called complete, then reopened: Trent added potions, relics, three enemies, Artifact and Void to v1, and the card data turned out to hold beta-branch values. The v1 quality-review loop has NOT run; run it after the v1 cards below.
- Merged this session: #176 (Prettier fix, per-branch CI), #178 (golden harness + Combat 1), #182 (Setup Strike 2/3, Slimed simulated, Combat 3). 1446 tests. Deploy is green.
- #175 is merged: `docs/quality-loop.md` defines the loop.

## Next up (Trent's order, Nov 12)
1. **Review the golden combats**, one combat at a time (1 to 9), with the two project agents in `.claude/agents/`:
   - `combat-junior-reviewer` (Haiku): reads only Trent's verbatim notes and lists inconsistencies and unexplained numbers.
   - `combat-senior-reviewer` (Opus): takes that list, resolves what it can from the screenshots, data and rules, and reports what is still unexplained.
   - Orchestrator: post the outcome on the combat's card, fix the card's record, batch the leftover questions for Trent, and turn data/rule findings into cards. Combats 1 and 3 are already fixtures and match the engine, so their review is a check of the notes only.
2. **Build the open v1 cards:** #208 fix beta values (Trent's values are on the card) · #203 Mawler, Byrdonis, Cubex Construct, Artifact · #204 Strength and Fire Potions · #205 relics and negative HP lost · #206 Void · #213 Slippery · #210 harness scripting · golden combats #200, #201, #202, #199.
3. **Then the v1 quality-review loop**, per `docs/quality-loop.md`.
- v2: #179, #197, #198 (multi-enemy golden combats), #211 Energy Potion. Future: #207.

## Golden combats
- Harness: `engine/golden/` (README there). Fixtures in: Combat 1 (Nibbit), Combat 3 (Shrinker Beetle). Each other combat has its own card with the turn-by-turn record.
- Branch `golden-screenshots`: one folder per combat with compressed screenshots and `notes.md`, Trent's notes verbatim (the cards hold the orchestrator's cleaned-up record, which is not verbatim).
- Trent's notation: enemy alias in [brackets]; IC = Ironclad; cards in play order; "4x2" = 4 damage, 2 hits. He plays main v0.107.1; his 5 mods are quality-of-life only.

## Working notes
- Trent's preferences: minimal progress updates; link every PR/card; cheapest model that can do the job.
- Parallel agents each get their own `git worktree` under /home/claude/wt. Expect conflicts in engine/combat.ts, engine/strategies.ts, data/validate/*.
- Merge only after the PR's CI check finishes green; sub-agents run `npm run format` before handing back.
- The wiki (slaythespire.wiki.gg) is not fetchable from the sandbox, and its card tables track the beta branch. Use main patch notes or Trent's game for values.

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
