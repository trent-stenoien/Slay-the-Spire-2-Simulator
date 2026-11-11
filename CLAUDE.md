# STS2 Combat Simulator — working notes for agents

Client-side React + TypeScript app (Vite, Vitest) that auto-plays Slay the Spire 2
combats and runs Monte Carlo comparisons of play strategies. Deployed to GitHub
Pages by `.github/workflows/deploy.yml` on push to `main`.

## Working model

The main session is the orchestrator: it plans, delegates, reviews and merges.
All programming (code, tests, data files) is done by sub-agents on their own branches,
never directly by the orchestrator.

Only the orchestrator approves and merges changes into `main`. Sub-agents never commit
to, merge into or push `main`: they commit on their own branch and hand back a merge
request (branch name, what changed, test/typecheck/build results).

## Board and phases

All work is tracked on the Kanban board https://github.com/users/trent-stenoien/projects/4.
Each card is an issue in this repo (auto-added to the board in Backlog), labelled with an area
(`engine`, `data`, `ui`, `strategy`) and a version: `version: v1` (Ironclad focus),
`version: v2` (other characters' mechanics, multi-enemy fights), or `version: future` when none
was set. Cards for a version later than the one in development stay in Backlog. Columns: Backlog → Questions or Ready → In progress → In review → Done.

- Planning phase: the user and orchestrator add cards. No new sub-agents start.
- Building phase: the orchestrator assigns Ready cards to sub-agents.
- Sub-agents work only on their assigned issue. They push their branch and open a pull request
  whose body says `Closes #<issue>`, so it links to the card. They never merge.
- The orchestrator moves cards on the board, reviews, merges the PR and moves the card to Done.

Moving cards: the orchestrator moves a card by adding a `status: <column>` label to its issue
(`status: backlog`, `status: questions`, `status: ready`, `status: in progress`,
`status: in review`, `status: done`). The `board-sync` Action (`.github/workflows/board-sync.yml`)
sets the card's Status, adds the issue to the board if needed, and removes any other `status: *` label.

## Layout

- `engine/` — pure TypeScript. No React, no DOM, no imports from `app/`. Must run
  inside Web Workers and Vitest.
- `data/` — hand-entered JSON: `manifest.json`, `cards/` (shared Strike/Defend at the top level; `ironclad/`, `colorless/`, `curses/` subfolders), `enemies/`, `characters/`.
  Source: slaythespire.wiki.gg (CC BY-SA 4.0; keep attribution in `data/LICENSE`).
  Import main-release data only (the version in `manifest.json`), never beta. The wiki marks
  beta content with a "Beta Content Warning" or "(Beta only currently)".
- `app/` — React UI, workers, charts. May import from `engine/` and `data/`.

## The contract

`engine/types.ts` is the shared contract. Do not change it on a feature branch.
If a task needs a type change, stop and report what you need and why.
The "Contract map" at the top of `engine/types.ts` says which declared-but-unsimulated type
(#105) serves which mechanic card (#106–#116); implement those instead of adding new ones.

## Rules that are easy to get wrong

- Determinism: all randomness goes through a seeded `Rng`. Same config + seed must
  produce an identical event log. Never call `Math.random()` in `engine/`.
- Damage per hit = floor((base + Strength) × modifiers). Vulnerable on the target ×1.5.
  Block absorbs hits in order.
- Turn order: player block resets → energy refills → draw 5 (reshuffle discard into
  draw pile mid-draw if needed) → strategy plays → end of player turn: Ethereal
  cards in hand exhaust, rest of hand discarded, debuffs on the PLAYER tick down
  by 1 → enemy block resets → Poison: enemy loses HP equal to its Poison (ignores
  Block and modifiers; a kill wins before the move), then Poison −1 → enemy move →
  pattern advances → end of enemy turn:
  debuffs on the ENEMY tick down by 1 (so 1 Vulnerable applied by the player
  lasts through that player turn and the enemy's next move).
- Ascension overrides are cumulative (A9 applies A8 then A9). Ascender's Bane is
  added automatically at A5+ via `manifest.ascensionCards`.
- `hpLost` = Max HP at the start of combat − final HP (minimum 0). Healing (Not Yet) lowers it by the
  HP actually healed; a Max HP gain (Feed) raises current HP too, so it lowers it; HP removed when
  Max HP drops below current HP (Brightest Flame) counts as lost. Burning Blood is not simulated.
- Intangible makes every enemy hit on the player 1 (and curse/status damage); Gambit loses the combat
  on any unblocked enemy attack damage. "Take X damage" statuses are blockable; "Lose X HP" ones are not.
  A Stunned enemy skips its move (no damage) but its pattern still advances (#148 confirms).
- Turn cap is 100 (`TURN_CAP`). Codes (cards, enemies, characters) are permanent; codes of
  removed cards are kept in `data/reserved-codes.json` and must never be reused.

## Conventions

- Tests live next to code as `*.test.ts`. Every rule gets a test.
- `npm test`, `npm run typecheck`, and `npm run build` must pass before handing back.
- Work on your own branch and request a merge; never touch `main`.
- Design doc: https://claude.ai/artifact/D79XTt7hTXmws6JnNBGt7h

## Keeping token use low

- Orchestrator: start a fresh session with a handoff note (`HANDOFF.md`) when context gets long;
  batch questions per card; use Sonnet for most sub-agents, Opus only for engine or design work.
- Sub-agents: report back in a few lines (branch, PR, verdict, anything surprising). Put long
  output (tables, logs) in a file and give its path instead of pasting it.
- Run only the checks your task names. Once the check scripts exist (see the board card),
  use `npm run compare-main` for engine behaviour (prints `identical` or the first difference; full output in `.check-output/`)
  and `npm run shot -- <panel>` for UI (`setup|deck|strategies|results|log`; prints the PNG path), not ad-hoc scripts.
- Take few, small screenshots.
- The full quality-review loop (test reviewer, test runner, readability) runs only after each
  major update, such as completing a version, not per card.
