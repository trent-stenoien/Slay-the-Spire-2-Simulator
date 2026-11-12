# Handoff (2026-11-11)

Read CLAUDE.md first. State: v1 is complete — every v1 card is merged (last: #169 PR #173, #170 PR #172); 1440 tests pass. No agents running.
Phase: building. Confirm with Trent before starting anything new.

## Next up
- Run the full quality-review loop for v1 (test reviewer, test runner, readability), per CLAUDE.md. Known: `prettier --check` warns on 7 files.
- All v1 questions are answered. Future: #149, #150, #171. v2: #148, #151. Multiplayer: #117.

## Working notes
- Trent's preferences: minimal progress updates; link every PR/card; cheapest model that can do the job (Haiku, Sonnet, Opus only if needed).
- Shared sub-agent rules: /home/claude/agent-rules.md (recreate from CLAUDE.md if the sandbox was reset).
- Parallel agents each get their own `git worktree` (Agent isolation is not allowed here). Expect merge conflicts in engine/combat.ts, engine/strategies.ts and data/validate/*; have the agent merge origin/main and resolve.
- `npm run shot -- results` can't show the chart (no simulation runs); agents wrote throwaway scripts instead. Possible small tooling card.

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues with `gh api repos/.../issues`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer` (new: multiplayer-only cards, e.g. #117).
