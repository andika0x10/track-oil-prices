# Brent Outlook

Mobile-first Brent dashboard with live Hyperliquid prices and monthly EIA benchmark projections for 3M, 6M, 1Y, and 3Y. 5Y/10Y keep monthly resolution; 15Y/30Y show annual averages. After month 36, explicitly labelled low/base/high scenarios replace statistical projections.

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

Daily refresh at 00:00 UTC stores results in `OUTLOOK` KV. Price/fundamental/daily-data revisions invalidate the cache; failures retain stale results. Version 0.3 adds scenario metadata and a new cache key. Scenario anchors rebuild at month rollover.

## Animation and research

GSAP coordinates a masked word entrance, chart drawing, scroll-triggered interval reveals, a moving horizon indicator and calendar groups. Reduced-motion displays final states immediately. Long calendars animate only groups entering the viewport.

Daily EIA Brent history supplies a month-end close baseline and volatility features for a native Rust benchmark. Ridge, elastic net and two ensembles are evaluated with frozen pre-holdout tuning. No challenger passed the 5% MAE/no-RMSE-regression gate on the included snapshot, so production model selection is unchanged. See [research findings and assumptions](docs/model-research.md).

```sh
npm run benchmark -- docs/benchmarks/input.json
# Refresh the public dataset from a configured running dev server:
npm run benchmark
# Compare local Wasm performance against the original engine:
npm run profile:model -- fb933385ab774f935539220e4a77ec184636f9b4
```

Scenario assumptions are 2% annual USD inflation and −2%/0%/+2% annual real price growth, compounded monthly. The low/high scenario range is not an 80% prediction interval.

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
