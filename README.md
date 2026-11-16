# BD Analytics — Company Website

Static marketing site + interactive demo of **Civix Analytics**, the
verified AI intelligence platform by BD Analytics.

## Stack

Pure static HTML/CSS/JS — deploys to **GitHub Pages** with zero build step.

- `index.html` — company site (services, platform spotlight, founder, contact)
- `platform.html` — Civix Analytics demo (chat + ECharts dashboards + province map)
- `config.js` — runtime config: `apiBase` switches between **live API mode**
  (deployed Civix FastAPI backend) and **demo mode** (bundled snapshot)
- `data/snapshot.json` — precomputed survey-weighted indicator values
  (regenerate with `scripts/export_snapshot.py` in the civix-analytics repo)

## Live mode

Set `apiBase` in `config.js` to the deployed backend, e.g.:

```js
apiBase: "https://your-civix-api.onrender.com"
```

The chat then calls `POST /api/v1/ask` on the real verified agent.
Dashboard charts always render from the bundled snapshot.

## Contact

Bulelani Dlamini (Founder & CEO) — Juniorlurh@gmail.com — 075 161 8439 —
369 Lyeds Street, Sunnyside, Pretoria
