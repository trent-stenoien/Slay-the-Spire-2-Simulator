# Handoff (2026-11-11)

Read CLAUDE.md first. State: every v1 card is merged (last: #113, PR #168); 1432 tests pass. No agents running.
Phase: building (Trent said "let's build" on 2026-11-11). Confirm with Trent before starting new cards.

## Next up
- Get Trent's answers to the open questions below; turn any changes into new v1 cards.
- Then run the full quality-review loop for v1 (test reviewer, test runner, readability), per CLAUDE.md.

## Open questions for Trent (on Done cards)
- #104 Alchemize is never played: should strategies play it, and when?
- #110 Enlightenment has no play rule. Fight Me needs an "enemy gains Strength" effect (contract change) — OK?
- #111 Entrench's "double your Block" ignores Dexterity/Frail — right?
- #112 Apotheosis is played first whenever something can be upgraded (2 of 3 energy) — OK?
- #113 Cards drawn by Dark Embrace during the end-of-turn Ethereal exhaust stay in hand — discard them?
- #114 Agent-chosen defaults for Catastrophe, Beat Down, Hidden Gem, Dual Wield; Howl from Beyond in exhaust tier 2?
- #116 Random-card cards draw from the character's own pool only, not Colorless — right?

## Working notes
- Trent's preferences: minimal progress updates; link every PR/card; cheapest model that can do the job (Haiku, Sonnet, Opus only if needed).
- Shared sub-agent rules: /home/claude/agent-rules.md (recreate from CLAUDE.md if the sandbox was reset).
- Parallel agents each get their own `git worktree` (Agent isolation is not allowed here). Expect merge conflicts in engine/combat.ts, engine/strategies.ts and data/validate/*; have the agent merge origin/main and resolve.
- `npm run shot -- results` can't show the chart (no simulation runs); agents wrote throwaway scripts instead. Possible small tooling card.

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues with `gh api repos/.../issues`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer` (new: multiplayer-only cards, e.g. #117).
