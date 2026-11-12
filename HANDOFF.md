# Handoff (2026-11-12, evening)

Read CLAUDE.md first. No agents running. Phase: building; all v1 build cards are merged. Next: the golden-combat review, then the v1 quality-review loop.

## State
- Merged today: #217 (shared `sts2-wiki-import` skill, replaces sts2-card-import), #218 (contract #215), #219 (#208 beta values), #221 (#206 Void), #222 (#213 Slippery), #223 (#203 Mawler, Byrdonis, Cubex Construct, Vantom, Artifact), #224 (#204 Strength/Fire Potion), #225 (#220 card values), #227 (#205 relics, 44 simulated; negative HP lost), #230 (#229 card text), #231 (#226 once-per-fight moves), #232 (#210 harness scripting), #233–#236 (golden combats 6, 9, 7, 5), #239 (#238 Byrdonis Egg), #240 (#237 scripted enemy moves). Duplicates #183–#196 closed.
- Golden fixtures in `engine/golden/`: combats 1, 3, 5, 6, 7, 9 match the engine with no known diffs. Trent's final HP figures are before Burning Blood's +6; fixtures record HP after it. Combat 9: Byrd Swoop is simulated and matches (the card's "22 twice" was wrong; turn 5 shows 133→118).

## Next up (Trent's order)
1. Golden-combat review of combats 1–9 with `.claude/agents/combat-junior-reviewer` (Haiku, notes only), then `combat-senior-reviewer` (Opus, resolves from screenshots and data). The orchestrator posts outcomes on each combat card, batches leftover questions for Trent, and turns findings into cards. Multi-enemy combats (2, 4, 8) are v2: review them, but they can't be replayed yet.
2. v1 quality-review loop per `docs/quality-loop.md`.

## Open
- Nothing blocking.
- v2: #179, #197, #198, #211, #228 (Eidolon). Future: #207.

## Rules settled today
(also in FEATURES.md and card comments)
- Vantom 8 Slippery at A0 (9 at A9); Dismember 26.
- Slippery: any HP loss (Poison and Fire Potion included) becomes 1 and uses a stack; fully blocked hits keep it.
- Artifact blocks Poison and Stun, one stack per application (Bouncing Flask: per bounce). Mawler's Roar once per fight.
- Fire Potion: fixed damage, ignores Vulnerable and Strength; reduced by Intangible and Slippery.
- Relics: Beating Remnant counts each side's turn separately; Girya defaults to 1; Ghost Seed affects only basic Strike/Defend; carried counters (Happy Flower, Pollinous Core, Iron Club) default 0 with a setup input.

## Working notes
- Trent's preferences: minimal progress updates; link every PR/card; cheapest model that can do the job.
- Parallel agents each get their own `git worktree` under /home/claude/wt. Expect conflicts in engine/combat.ts, engine/strategies.ts, data/validate/*.
- Merge only after the PR's CI check finishes green; sub-agents run `npm run format` before handing back.
- WebFetch accepts a wiki URL once it has appeared in a WebSearch result or the conversation, so search first, then fetch (also in the skill).

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
