# Handoff (2026-11-12, night)

Read CLAUDE.md first. No agents running. Phase: building. v1 build and the golden-combat review are done. Next: the v1 quality-review loop.

## State
- Merged today: #217 (shared `sts2-wiki-import` skill, replaces sts2-card-import), #218 (contract #215), #219 (#208 beta values), #221 (#206 Void), #222 (#213 Slippery), #223 (#203 Mawler, Byrdonis, Cubex Construct, Vantom, Artifact), #224 (#204 Strength/Fire Potion), #225 (#220 card values), #227 (#205 relics, 44 simulated; negative HP lost), #230 (#229 card text), #231 (#226 once-per-fight moves), #232 (#210 harness scripting), #233–#236 (golden combats 6, 9, 7, 5), #239 (#238 Byrdonis Egg), #240 (#237 scripted enemy moves). #243 (#242 Burning Blood in fixtures 1 and 3; README and harness HP-lost check now use the overheal rule). Duplicates #183–#196 closed.
- Golden fixtures in `engine/golden/`: combats 1, 3, 5, 6, 7, 9 all match with no known diffs and all list Burning Blood (fixtures record HP after its +6; Trent's figures are before it). Combat 9: Byrd Swoop is simulated and matches (the card's "22 twice" was wrong; turn 5 shows 133→118).
- Golden-combat review (Nov 12) done for all nine combats (junior + senior reviewers). Every item resolved; no v1 data or rule contradicts the game. Outcomes are posted on #199–#202 (v1) and #179, #197, #198, #211 (v2 data: slimes, Inklets, Phrog Parasite and Wrigglers, Energy Potion +2). Combats 1 and 3 have no card of their own; their outcome is on #242.

## Next up
1. v1 quality-review loop per `docs/quality-loop.md` (test reviewer, test runner, readability; every FEATURES.md item needs a test).

## Open
- Questions for Trent, not blocking: combat 4 Inklet HP was 14, 11, 13 in game vs raw 11–12 (which Ascension?); combat 2, was Leaf Slime (S)'s T2 card Slimed? (#197, #179)
- v2: #179, #197, #198, #211, #228 (Eidolon). Future: #207.

## Rules settled today
(also in FEATURES.md and card comments)
- Vantom 8 Slippery at A0 (9 at A9); Dismember 26.
- Slippery: any HP loss (Poison and Fire Potion included) becomes 1 and uses a stack; fully blocked hits keep it.
- Artifact blocks Poison and Stun, one stack per application (Bouncing Flask: per bounce). Mawler's Roar once per fight.
- Fire Potion: fixed damage, ignores Vulnerable and Strength; reduced by Intangible and Slippery.
- Relics: Beating Remnant counts each side's turn separately; Girya defaults to 1; Ghost Seed affects only basic Strike/Defend; carried counters (Happy Flower, Pollinous Core, Iron Club) default 0 with a setup input.
- HP lost: every heal counts in full (Trent's figures are pre-heal; combat 2 starts at 80 = 77 + 6 capped).

## Working notes
- Trent's preferences: minimal progress updates; link every PR/card; cheapest model that can do the job.
- Parallel agents each get their own `git worktree` under /home/claude/wt. Expect conflicts in engine/combat.ts, engine/strategies.ts, data/validate/*.
- Merge only after the PR's CI check finishes green; sub-agents run `npm run format` before handing back.
- WebFetch accepts a wiki URL once it has appeared in a WebSearch result or the conversation, so search first, then fetch (also in the skill).

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
