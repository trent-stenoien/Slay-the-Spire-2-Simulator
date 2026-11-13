# Handoff (2026-11-13)

Read CLAUDE.md first. No agents running. Phase: building. **v1 is complete and live** on
https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/ (Results chart checked by eye after the last deploy).

## Done since the last handoff
- #245 / PR #247: v1 quality-review loop passed. `docs/feature-test-map.md` maps every FEATURES.md item
  to a test with break-it results. Seven stale `simulated: false` cards fixed (Tear Asunder, Spite, Ashen
  Strike, Evil Eye, Pact's End, Impatience, Restlessness). `engine/types.ts` "open" comments reworded
  (comment-only, approved by Trent). Vulnerable rule added (attacks from the player or its pets only;
  fixed damage ignores it). Plating comment fixed (−1 at start of turn, not on hits).
- #248 / PR #249: live site was blank because `vite.config.ts` base was lowercase and the repo name is
  capitalised. Base is now `'./'`, guarded by a test in `tools/checks.test.ts`.
- #246 / PR #252: Expect a Fight simulated as an X-Energy card (1 per Attack in hand); its "cannot gain
  additional Energy" clause is not modelled (later).
- #250 / PR #251: golden combat 10 (Nibbit, Ascension 10, Havoc+) is fixture `engine/golden/nibbit-a10-01.json`
  and matches. Harness gained an optional per-turn `playedFromDraw` (cards Havoc plays from the draw pile).
  Golden screenshots are on the `golden-screenshots` branch (`combat-10/`).

## Not checked (low priority)
- Compare view stacking on a phone-width screen (CSS only; no test can see it).
- Design doc (claude.ai artifact) vs code: not compared in the loop.

## Open
- v2 questions for Trent: combat 2, was Leaf Slime (S)'s T2 card Slimed? (#179). Combat 4 was A0, so the
  Inklet HPs 14, 11, 13 don't fit the data's 11–12 (#197).
- v2: #179, #197, #198, #211, #228, #19 (Osty; Sweeping Gaze waits for it). Future: #207.

## Working notes
- Trent's preferences: minimal progress updates; link every PR/card; cheapest model that can do the job.
- Parallel agents each get their own `git worktree` under /home/claude/wt. Expect conflicts in engine/combat.ts, engine/strategies.ts, data/validate/*.
- Merge only after the PR's CI check finishes green; sub-agents run `npm run format` before handing back.
- WebFetch accepts a wiki URL once it has appeared in a WebSearch result or the conversation, so search first, then fetch (also in the skill).

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
