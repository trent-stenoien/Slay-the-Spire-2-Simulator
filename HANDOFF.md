# Handoff (2026-11-13, afternoon)

Read CLAUDE.md first. No agents running. Phase: **building v2**. v1 is complete.

## v2 scope (Trent, Nov 13)
One character per version. v2 = **the Silent**, **multi-enemy fights**, and **all Act 2 and Act 3 bosses**.
Other characters (Defect, Necrobinder, Regent) are `version: future` until Trent picks the next one.
Full scoping report: `docs/v2-scoping.md` (cards #258–#276; each card body has its own scope and questions).

## Done in v2
- #254 / PR #257: UI polish (chart filters wrap, Colorblind/Percentiles, Generate new seed button,
  rarity folders incl. Basic/Ancient/Event/Token, Statuses/Curses collapsed, alphabetical lists,
  borderless relic ×, "Slay the Spire 2 v0.107.1"). Chart layout on phones still needs Trent's eye.
- #258 / PR #277: Ring of the Snake. The Silent unlocks automatically once Survivor (#259) is simulated.
- #262 / PR #278: Shiv cards (Blade Dance, Cloak and Dagger, Leading Strike, Up My Sleeve, Storm of Steel).
  Hidden Daggers waits for #259; Blade of Ink waits for its Inky enchantment.
- #5 / PR #279: multi-enemy fights (up to 5 enemies in Setup), per-strategy target priority
  ("Lowest HP first" / "Biggest incoming attack first"). types.ts gained optional fields (listed in the PR).
  Random-target cards hit the current target / leftmost living enemy until #45.

## Ready to build
- #45 random-target cards (rule: play them first, re-plan; prefer a targeted attack to finish a low-HP enemy).
- #46 Poison-only play rule (before attacks if the enemy lives 2+ turns; enemy Block favours Poison; Artifact counts against it).
- #12 cheapest block set (confirmed).
- #264 temporary powers, #265 counters/conditions, #266 trigger powers (types.ts additions approved).
- #256 docs: version definitions (CLAUDE.md "Board and phases", README). Also CLAUDE.md's turn-order line still describes one enemy.
- After #45: #269 Silent multi-enemy cards, #267 Shiv powers, #275 Kaiser Crab, #276 Queen (these also have questions).

## Questions waiting for Trent (also on each card)
- #5 follow-ups: Vicious once per enemy on ALL Vulnerable (as built);
  "lowest HP" ignores Block (as built); Omnislice splash not simulated in multi-enemy fights (new card?).
- #262: keep the Shiv play-order default (Blade Dance/Up My Sleeve first; Storm of Steel last, only with other cards in hand)?
- #259 discard order (curses/statuses, Sly, Strikes, Defends?) and Well-Laid Plans' retain; Dodge and Roll Block and Dexterity.
- #260 Bullet Time / X-cost, Precise Cut floor. #261 Sly target, destination, end-of-turn discard.
- #263 data disagreements (Outbreak, Tracking, Haze, Expertise, Well-Laid Plans, Flick Flack: re-check with the wiki skill first); Accelerant extra triggers; Envenom.
- #268 The Hunt's reward. #270 Mind Rot/Sloth/Waste Away as status cards or powers.
- Bosses: #271 Knowledge Demon choice rule; #272 Sandpit/Frantic Escape; #273 Aeonglass beta? and Wither+X;
  #274 Test Subject phases; #275 Back Attack facing; #276 Queen win condition and Chains of Binding.
- Trent will record a Silent golden combat with Poison.
- v2 data: combat 2 Leaf Slime (S) T2 Slimed? (#179); combat 4 Inklet HP 14/11/13 at A0 vs data 11–12 (#197).

## Working notes
- Trent's preferences: concise replies; link every PR/card; cheapest model that can do the job; batch questions per card.
- Parallel agents each get their own `git worktree` under /home/claude/wt. Expect conflicts in engine/combat.ts, engine/strategies.ts, data/validate/*, FEATURES.md, docs/feature-test-map.md; the later PR merges `main` and re-runs the checks.
- Merge only after the PR's CI check finishes green; sub-agents run `npm run format` before handing back.
- Golden screenshots live on the `golden-screenshots` branch (`combat-NN/`, compressed JPEGs + notes.md). Review uses the combat-junior-reviewer and combat-senior-reviewer agents. Fixtures can script Havoc's top-card plays with `playedFromDraw`.
- WebFetch accepts a wiki URL once it has appeared in a WebSearch result or the conversation, so search first, then fetch (also in the skill).

## Sandbox notes
- GitHub: REST only (GraphQL blocked). Create issues and PRs with `gh api repos/.../issues|pulls`.
- Board moves: add a `status: <column>` label; the board-sync Action does the rest.
- Versions: `version: v1`, `v2`, `future`, `multiplayer`.
- Live site: https://trent-stenoien.github.io/Slay-the-Spire-2-Simulator/ (Vite base is `'./'`).
