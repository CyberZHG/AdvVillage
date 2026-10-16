# Adventurer Village

A pixel-art village builder in the spirit of Kairosoft games. You build the village; adventurers, gatherers, villagers and visitors run it on their own.

## Development

```sh
npm install
npm run dev        # local dev server
npm run build      # type-check + production build into dist/
npm run sim -- maple 16   # headless 16-year balance run with a naive auto-builder
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages.
Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Project layout

- `src/game/` — simulation (pure TypeScript, no DOM): data tables, AI, economy, saves
- `src/render/` — isometric canvas renderer, sprite atlas loader
- `src/ui/` — HUD, panels, styles
- `src/i18n/` — language packs; add a language by creating a pack and registering it in `index.ts`
- `public/assets/sprites.png` + `sprites.json` — sprite sheet and atlas (frame name → rect + anchor)
