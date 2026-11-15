# Brent Outlook

A white, spacious Brent dashboard with live Hyperliquid prices and monthly EIA benchmark predictions calculated in the visitor's browser.

**Stack:** Astro, React, Tailwind, GSAP, Cloudflare Workers/KV, Chronos-Bolt through forecast-web/ONNX Runtime Web.

## Local setup

Requires Node >=22.23.4.

```sh
npm ci
```

Copy `.dev.vars.example` to `.dev.vars` and configure your [EIA API key](https://www.eia.gov/opendata/). Keep existing secrets intact. Without a key, live prices still work and the monthly outlook displays an unavailable state. No synthetic or archived prices are substituted in production.

```sh
npm run dev -- --background
npx astro dev status
npx astro dev logs
npx astro dev stop
```

Open `http://localhost:4321`.

## Predictions on page open

- `/api/benchmark` proxies complete monthly Europe Brent spot averages from EIA. The API key stays on the server. It deduplicates nearby page opens for 60 seconds and retains the last valid data if EIA fails.
- The browser runs Amazon's pretrained **Chronos-Bolt Small**, using the immutable, hash-verified community ONNX export pinned by **forecast-web 1.0.0**. The standard fp16 weight download is about 96 MB. An explicit **Lightweight** option selects Chronos-Bolt Tiny (about 18 MB), and remembers that choice on the device.
- Inference runs in a cancellable Web Worker. WebGPU is attempted when available; CPU execution through ONNX Runtime's WebAssembly backend is the fallback. This is a pretrained neural model, separate from the retained custom Rust statistical engine.
- Only monthly price history is input. This model does not consume live Hyperliquid ticks, fundamentals, or news. EIA observations follow their monthly publication schedule.
- q50 is the estimate; q10 and q90 form a nominal 80% range. They are model quantiles, not a Brent-calibrated coverage guarantee. No legacy-model accuracy metrics are reused.
- The browser caches model files where supported, and caches each model's prediction separately. The data fingerprint, model/export version, horizon and current month determine whether a calculation can be reused. Revisions or month rollover invalidate the prediction. Browser storage is optional.
- Each page open checks EIA. **Check latest data** performs another check; unchanged inputs reuse the prediction. There is no background schedule, GitHub Actions workflow, server-side ML inference, or paid model API.
- Future months through month 36 use model predictions. After month 36, 5Y/10Y monthly and 15Y/30Y annual views use the existing inflation/real-growth assumptions. These are scenarios, not model prediction intervals. Annual interval endpoints are averages of monthly bounds, not calibrated annual intervals.

The UI distinguishes the live Hyperliquid perpetual from the EIA monthly spot benchmark. It includes download progress, retry, retained results after refresh failures, keyboard-accessible month details and progressively expanded calendars.

## Preserved legacy implementation

All Rust/Wasm source, generated bindings, benchmark inputs/results and original research remain in place. The previous dashboard is preserved as `src/components/Dashboard.legacy.tsx`; its browser tests are retained as `tests/browser/dashboard.legacy.ts`. The original `/api/outlook` statistical API and scheduled handler also remain available, but the active dashboard does not call them and `triggers.crons` is empty.

See [original setup and model documentation](docs/legacy-setup.md) and [historical model research](docs/model-research.md). Their model-selection and backtest results describe the legacy engine, not Chronos-Bolt.

## Checks

```sh
npm run check
npm test
npm run build
npm run test:e2e
npm run test:smoke
```

Browser tests require the background dev server. Override `PLAYWRIGHT_BASE_URL` for another port. They mock model outputs only inside the test suite, and cover fresh/cache/revised inputs, failed downloads and retries, four viewports, reduced motion, dialog focus and calendar pagination. Unit tests include numerical parity with the retained Rust scenario builder.

A real-model smoke check can be run with `npm run test:browser-model` against a running server. By default it uses the archived public EIA research snapshot explicitly for testing, downloads the actual pinned model, verifies browser inference and cache reuse, and saves screenshots/runtime details under ignored `.qa/`. Set `BROWSER_MODEL_LIVE=1` and `PLAYWRIGHT_BASE_URL` to test the deployed page with its live EIA endpoint and no mocked data. This is an inference/transport check, not an accuracy benchmark.

## Deploy

Build with `npm run build`, then deploy through the existing Cloudflare workflow or `npm run deploy`. Preserve the `OUTLOOK` KV binding and configure `EIA_API_KEY` as a Worker secret. No ML-service credentials are needed. The Worker streams pinned model files from Hugging Face and runtime files from jsDelivr through same-origin, allowlisted `/api/models/` and `/api/model-runtime/` paths. This avoids third-party CORS failures on deployed origins. Large binaries are streamed without buffering or cloning, and browser SHA-256 checks retain the pinned model manifest. No server-side inference is performed. The dependency lockfile pins the runtime version; increment the prediction-cache version when changing model/runtime behavior.

If a Content Security Policy is added, account for model/runtime downloads and module workers. Browser inference requires a secure origin (HTTPS, or localhost for development). Private browsing or disabled storage can require downloads again.
