# Quality-review loop

Runs after each major update (for example, completing a version), never per card. It answers
three questions: do the tests check what we agreed, does everything pass, and is the code easy
to read. `FEATURES.md` is the test plan.

## Setup

- One card on the board for the loop, one branch (`quality-loop-<version>`), one pull request.
- Three sub-agents take turns on that branch. The orchestrator starts each one, reads its short
  report and merges at the end. Nobody else works on `main` while the loop runs.
- Models: Sonnet for the two reviewers, Haiku for the runner. Opus only if a reviewer reports an
  engine problem it can't resolve.

## The three agents

### 1. Test reviewer

Checks the tests against `FEATURES.md`, item by item, and adds or fixes tests.

- **Feature-to-test map.** Keeps `docs/feature-test-map.md`: one row per `FEATURES.md` item (or
  sub-rule, when an item holds several) with the test file and test name that proves it. An item
  with no test gets one. A test that only checks "it doesn't crash" doesn't count.
- **Break-it check** (items under "Simulation correctness" and "Strategy behaviour"). For each
  row, make one small wrong change to the rule in the code (for example Vulnerable ×1.25, or tick
  enemy debuffs a turn early), run only the mapped test file, and confirm a test fails. Then undo
  the change. A break that no test catches means the test is too weak: strengthen it and try
  again. This is a real, temporary edit to the code in the agent's own working copy, not an extra test, and it is never committed. The map records caught / not caught.
- **Known failure points.** Re-measures everything listed under "Known failure points" in
  `FEATURES.md` (for example the Scared Block stress deck at 0% deaths) and reports the numbers.
- **UI items** ("Results and UI"): a component test per item is enough; no break-it check.
- May edit: test files, test helpers, the map. May not edit: engine or app behaviour,
  `engine/types.ts`, `FEATURES.md`.
- **If a test shows the code disagrees with `FEATURES.md`:** stop and report it. Don't change the
  code and don't bend the test to fit. The orchestrator decides (small fix on the loop branch by a
  sub-agent, or a new card; a question for Trent if the rule itself is unclear).

### 2. Readability reviewer

Makes the code shorter and clearer without changing what it does.

- Looks for: long functions, unclear names, repeated code, dead code, stale comments, files that
  mix topics, test files too big to scan.
- May not: change behaviour, change `engine/types.ts`, weaken or delete a test's assertions, or
  rename anything saved or shared (card/enemy codes, URL parameters, localStorage keys, JSON fields).
- Proof of no behaviour change, before handing back: `npm test` passes with the same test count
  or more, `npm run compare-main` prints `identical`, and the known-failure-point numbers are
  unchanged (`compare-main` covers only the starter deck).
- Reports what it changed and what it would still change, if anything.

### 3. Test runner

Runs the checks and reports. It edits nothing.

- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (twice, to catch flaky
  tests), `npm run build`, `npm run compare-main`.
- No `.skip`, `.only` or `.todo` in test files; no `Math.random()` in `engine/` outside comments.
- Reports GREEN or RED with the first failure and the test count.

## Rounds and passing

Each round runs in order: test reviewer → readability reviewer → test runner. At most 4 rounds.

The loop passes when one round ends with all of these true:

1. Every `FEATURES.md` item has a row in the map with a named test.
2. Every break-it check was caught.
3. The known failure points are within their stated limits.
4. Neither reviewer has anything left it would change.
5. The runner is GREEN.

There are no scores. If round 4 ends without passing, the orchestrator stops and brings Trent what is left.

## Finishing

- The orchestrator reads the diff and the map, waits for the pull request's CI check to finish
  green, merges, and confirms the Pages deploy from `main` succeeded.
- Opens the live site and checks the Results chart by eye, because `npm run shot` can't show it.
- Bugs or gaps found but not fixed in the loop become cards. `HANDOFF.md` is updated.

## Rules for every merge (not just the loop)

- Before handing back, sub-agents run `npm run format`, then `npm run format:check`,
  `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
- The orchestrator merges a pull request only after its CI check has finished green. A cancelled
  or still-running check is not a pass.
- When a card settles a new rule, it is added to `FEATURES.md` in that card's pull request.
