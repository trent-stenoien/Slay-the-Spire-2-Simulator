# Handoff (2026-11-09)

Read CLAUDE.md first. State: main at PR #142 merge + docs; 1029 tests pass. No agents running.
Phase: building (user said "let's build"); confirm with the user before starting new cards.

## Next up
- #143 Check scripts (compare-main, shot) — Ready. Do this first; later agents should use them.
- #141 Deck-health guard follow-up:
  - Build the answered rule: among damaging cards, exhaust the one with LOWER damage per energy
    first (Bash before the last Strike).
  - Still open (ask user): Scared Block (Block 0) dies in 64% of combats with starter + Burning Pact
    + Purity + True Grit+; every death ends on a 5-card deck with 1 damaging card. Options:
    1) min 2 damaging cards, 2) count only playable damage, 3) raise floor to 6–7 cards. Q3 a–d also open.

## Waiting on the user (Questions column)
#4 Shrinker/Sludge, #11 Vulnerable meaning, #15/#21 (on hold), #78 two-strategy percentile
lines/band blend, #104 quick wins, #110–#117 mechanic groups, #122 Compare follow-ups,
#127 draw follow-ups, #135 Q2–Q4 (user testing). #81 on hold.

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues with `gh api repos/.../issues`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Wiki pages: WebFetch works; Chrome may be unavailable.
