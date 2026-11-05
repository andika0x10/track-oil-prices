# Brent Outlook

A mobile-first Brent dashboard built with Astro, React, Tailwind CSS, GSAP, and a Rust/WebAssembly forecast engine. The English interface separates the live **Hyperliquid `xyz:BRENTOIL` perpetual mark price** from **EIA Europe Brent monthly spot benchmark projections**.

The animated dashboard is a `client:only="react"` island. Astro serves page metadata and a lightweight loading fallback; GSAP and React initialize in the browser, avoiding animation timers during Worker module evaluation. JavaScript is required for the dashboard.

## Local development

Requirements: Node >=22.23.4, npm, Rustup, and a native Rust linker (Visual Studio C++ Build Tools on Windows). `rust-toolchain.toml` pins Rust 1.99.1 and the `wasm32-unknown-unknown` target.

```sh
npm ci
cargo install wasm-bindgen-cli --version 0.2.105 --locked
```

Alternatively, use the official [wasm-bindgen 0.2.105 release binary](https://github.com/wasm-bindgen/wasm-bindgen/releases/tag/0.2.105) and set `WASM_BINDGEN_BIN` to its executable. The build also recognizes an unpacked release in `.tools/wasm-bindgen-0.2.105-<platform>/`. Tooling and generated binaries are ignored by Git.

Copy `.dev.vars.example` to `.dev.vars`, then set `EIA_API_KEY` to a [registered EIA API key](https://www.eia.gov/opendata/). Leave an existing `.dev.vars` intact. Secrets stay server-side. Without a key, the live market still works; the outlook explicitly shows unavailable estimates.

```sh
npm run dev -- --background
npx astro dev status
npx astro dev logs
npx astro dev stop
```

The first command builds Wasm before starting Astro in background mode. The local URL is normally `http://localhost:4321`. KV is persisted by the Cloudflare Vite plugin under `.wrangler/`.

## Data flow

- `GET /api/market`: Hyperliquid mark price, 24-hour change, volume, source, unit, timestamp, freshness. HTTP snapshots are cached for 15 seconds per isolate.
- `GET /api/history?range=1D|1W|1M|ALL`: validated OHLCV history, cached for 60 seconds. Intervals are 5m, 1h, 4h, and 1d respectively. `ALL` starts at the earliest available candle, not an assumed historical date.
- The browser subscribes to `activeAssetCtx` and the selected candle interval. It merges snapshots and buffered updates by timestamp, reconnects with capped exponential backoff, and reloads history after reconnect. Missing live ticks trigger stale status and reconnection after 45 seconds.
- `GET /api/outlook`: complete monthly EIA observations, 36 upcoming calendar months of projections, empirical intervals, model diagnostics, and engine timings. Source identifiers remain separate from the perpetual market.
- The server requests EIA `petroleum/pri/spt`, monthly series `RBRTE`, excluding incomplete months. It requires positive, contiguous observations and at least 180 complete months. Missing months are not interpolated.
- The `OUTLOOK` KV binding stores the source dataset and last valid result under `brent-outlook:0.1.0`. Bootstrap occurs on the first request. The custom Worker preserves Astro's fetch handler and runs its scheduled refresh at **00:00 UTC daily**. Unchanged data avoids recomputation; source revisions or advancing calendar coverage trigger a new result.
- On refresh failure, the last valid result is returned with `freshness: stale`. If none exists, the endpoint returns a structured 503. No production fixture, mock forecast, or invented price is used.

## Forecast engine

`crates/outlook` is a Rust library compiled to Wasm using pinned `wasm-bindgen` bindings. The Worker initializes the module once per isolate. JSON is the boundary: `{ values: number[], horizon: number }` in, forecasts and diagnostics out. Browser bundles do not contain the Wasm binary or EIA key.

The engine compares a last-observation baseline with damped Holt trend fitted to log prices. Holt parameters use a fixed grid: alpha 0.2/0.5/0.8, beta 0.05/0.2/0.5, and damping 0.8/0.9/0.98. Each origin fits only its training prefix, with a 120-month minimum. Mean model/baseline MAE ratios across 3/6/12/36 months choose one model; ties favor the baseline.

Prediction intervals use the 10th/90th percentiles of out-of-sample log errors at each horizon, expanded if needed to contain the central estimate. Coverage evaluation uses only errors whose target months had already occurred, with at least 24 matured calibration errors. Metrics report both total forecast tests and coverage test counts.

All horizon controls slice the same projection. Estimates target monthly average prices, not end-of-month prices. Flat projections are a valid outcome when the baseline wins.

These diagnostics use revised historical data and the same backtest used for model selection; they are not vintage-data evaluation or an independent final holdout. The model does not directly model supply, geopolitics, or macroeconomic variables. Interval coverage is empirical, not a guarantee.

## Verification

```sh
npm run build:wasm
npm run check
npm test
npm run test:rust
npm run test:wasm
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:smoke
```

Browser and smoke tests expect the background server to be running. Override `PLAYWRIGHT_BASE_URL` when using another port. Browser fixtures are isolated under `tests/`; screenshots go to ignored `.qa/`. Smoke tests use real upstream data and safely report an unconfigured EIA key.

Tests cover Rust/native-Wasm numerical parity, finite intervals, training-prefix isolation, EIA completeness, month/year boundaries, duplicate candles, model initialization failure, upstream failures, stale cache retention, unchanged-data reuse, four viewport sizes (360/390/768/1440), reduced motion, dialog keyboard behavior, and WebSocket reconnect/backfill.

For production-runtime verification without publishing, run `npx wrangler dev --config dist/server/wrangler.json --port 4322` after a build, then run smoke tests against port 4322. The generated config contains local development secrets; `dist/` is ignored and must not be shared. Run `npm run test:cron` to invoke the scheduled handler through Cloudflare's Local Explorer API on port 4322. Run `npm run preview:capture` to capture the real-data interface at all four viewport sizes; this requires working upstream connectivity and a configured EIA key.

## Production configuration

No production deployment is performed as part of local development. Before deploying yourself:

1. Provision the `OUTLOOK` KV namespace (Wrangler also supports automatic provisioning for the binding-only configuration). Ensure the deployed Worker uses the same namespace for scheduled and HTTP handlers.
2. Set `EIA_API_KEY` using `wrangler secret put EIA_API_KEY`; never put it in source or public environment variables.
3. Build and deploy using `npm run deploy` only when ready to publish. Confirm the daily cron in the Cloudflare dashboard.
4. Budget Worker CPU for the first forecast/backtest computation; cached reads are much cheaper. Measure on the deployed runtime before choosing limits. The development measurement on full EIA history was approximately 145ms; this is not a production performance guarantee.

Structured logs record source/cache/model failures, model version, initialization time, computation time, and successful refreshes without logging keys or upstream URLs. Check scheduled failures and the last successful `checkedAt`; stale results retain their original calculation timestamp.

Instrument Sans is served locally through Fontsource under its included OFL license. Animations respect `prefers-reduced-motion`; native dialogs provide modal focus behavior and Escape dismissal.
