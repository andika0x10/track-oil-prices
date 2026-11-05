# Brent Outlook

Mobile-first Brent dashboard with live Hyperliquid prices and monthly EIA benchmark projections for 3M, 6M, 1Y, and 3Y.

**Stack:** Astro, React, Tailwind, GSAP, Rust/Wasm, Cloudflare Workers/KV.

## Local setup

Requires Node ≥22.23.4. The compiled Wasm binary and JavaScript bindings are committed; normal builds do not need Rust or wasm-bindgen.

```sh
npm ci
```

Copy `.dev.vars.example` to `.dev.vars` and set your [EIA API key](https://www.eia.gov/opendata/). Keep existing secrets intact.

```sh
npm run dev -- --background
npx astro dev status
npx astro dev logs
npx astro dev stop
```

Open `http://localhost:4321`. Without an EIA key, live prices work but forecasts remain unavailable. Animations run in the browser; Wasm runs on the server.

## Model

- Inputs: monthly Brent prices, U.S. commercial crude inventories (`PET.MCESTUS1.M`), and production (`PET.MCRFPUS2.M`), with a two-month fundamental-data lag.
- Each month selects baseline, damped trend, mean reversion, or fundamental ridge regression using only already-known forecast errors. Alternatives must improve validation MAE by 2%.
- Evaluation compares the adaptive strategy and baseline over the latest 60 observed target months. 80% intervals use matured strategy errors; actual coverage is reported.
- Historical revisions and assumed publication lags limit backtests. Individual horizons can underperform baseline. Flat estimates remain possible when justified.

Daily refresh at 00:00 UTC stores results in `OUTLOOK` KV. Price/fundamental revisions invalidate the cache; failures retain stale results. Version 0.2 uses a new cache key to replace old forecasts.

## Checks

```sh
npm run check && npm test && npm run build
npx playwright install chromium
npm run test:e2e
npm run test:smoke
```

Browser/smoke tests need a running server. Override `PLAYWRIGHT_BASE_URL` for another port. Tests cover native/Wasm parity, data lag, causal selection, cache revisions, reconnects, and four viewport sizes.

After changing Rust sources, install Rustup and `cargo install wasm-bindgen-cli --version 0.2.105 --locked`, then run `npm run build:wasm`, `npm run test:rust`, and `npm run test:wasm`. Commit all four generated files in `src/generated/outlook/` with the source changes.

For production-runtime checks, run `npx wrangler dev --config dist/server/wrangler.json --port 4322`, then `npm run test:cron` or `npm run preview:capture`.

## Deploy

Cloudflare build command: `npm run build` (runs only `astro build`). Deploy command: `npx wrangler deploy`. Configure the `OUTLOOK` KV binding and `EIA_API_KEY` Worker secret. For manual deployment, use `npm run deploy`. `.dev.vars` and `dist/` are ignored and must stay private.
