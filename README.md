# slay-the-spire-2-simulator

A simulator that tests various card strategies in Slay the Spire 2 combats.

It auto-plays a combat with a shuffled deck against an enemy with scripted moves,
then runs 10,000 combats per strategy and charts the HP lost.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # Vitest
npm run build      # typecheck + production build
```

## Data

Card and enemy data is entered by hand from the
[Slay the Spire Wiki](https://slaythespire.wiki.gg/), licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The files in
`data/` carry the same license. Slay the Spire 2 is a trademark of Mega Crit;
this is an unofficial fan project.
