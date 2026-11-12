# Handoff (2026-11-12)

Read CLAUDE.md first. No agents running. Phase: planning (Trent: "only planning notes and golden combats for now, to save tokens"). Confirm with Trent before starting any sub-agent.

## State
- v1 was called complete, then reopened: Trent added potions, relics, three enemies, Artifact and Void to v1, and the card data turned out to hold beta-branch values. The v1 quality-review loop has NOT run; run it after the v1 cards below.
- Merged this session: #176 (Prettier fix, per-branch CI), #178 (golden harness + Combat 1), #182 (Setup Strike 2/3, Slimed simulated, Combat 3). 1446 tests. Deploy is green.
- Open PR for Trent to review: #175 (docs/quality-loop.md: loop steps and pass conditions, no scores; FEATURES items 34-36).

## Next up (ask Trent which first)
- v1 Backlog: #208 fix beta values (audit table on #181) · #203 Mawler, Byrdonis, Cubex Construct, Artifact · #204 Strength and Fire Potions · #206 Void · #210 golden harness scripting · golden combats #200 (Mawler), #201 (Byrdonis), #202 (Cubex Construct).
- Questions for Trent: #205 relics + new HP-lost rule (can HP lost go negative? which relics are "easy"?) · #209 six card values and Kettlebell text to read from the game · #199 which version is the Vantom combat?
- v2: #179, #197, #198 (multi-enemy golden combats), #211 Energy Potion. Future: #199, #207.
- Then: the v1 quality-review loop per docs/quality-loop.md (once #175 is merged).

## Golden combats
- Harness: `engine/golden/` (README there). Fixtures in: Combat 1 (Nibbit), Combat 3 (Shrinker Beetle). Each other combat has its own card with the turn-by-turn record.
- Screenshots (compressed, one folder per combat): branch `golden-screenshots`.
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
