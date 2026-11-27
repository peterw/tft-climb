# TFT Climb

Short, concrete Teamfight Tactics lessons in the style of a swipe file: one idea per card, a real example from this patch's ranked games, and what to do differently.

The site rebuilds itself every 6 hours (GitHub Actions cron) from:
- Community Dragon game data (champions, traits, items, icons)
- MetaTFT public ranked comp, item and augment stats
- Riot's latest TFT patch notes

`node scripts/fetch.mjs && node scripts/render.mjs` builds `site/` locally. Not affiliated with Riot Games.
