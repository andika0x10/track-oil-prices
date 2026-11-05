# Brent model research and implementation results

Evaluated 5 November 2026. The public EIA snapshot covers May 1987–October 2026 (474 monthly observations). The deployed inference policy is **retained**, because no preselected challenger passed the agreed promotion gate. This release adds experiments and honest diagnostics, not a claim that forecast accuracy has improved.

## Findings

The existing engine selects a no-change, damped Holt, mean-reversion or fundamental ridge forecast using matured errors. Its fundamental inputs represent U.S. production and inventories, not the complete global oil market. Monthly average Brent spot prices are also a different target from the live Hyperliquid perpetual mark price. A flat forecast can be a valid no-change baseline; making its line more dynamic does not establish predictive skill.

Daily EIA Brent observations are now paginated, validated and summarized into the last available close and within-month log-return volatility. Incomplete daily months are excluded. Those summaries are research inputs; a daily-data failure does not disable the monthly production model.

## Research basis

- [Benmoussa, Ellwanger & Snudden, Bank of Canada (2020)](https://www.bankofcanada.ca/wp-content/uploads/2020/09/swp2020-39.pdf) show why the last high-frequency observation can be a stronger no-change benchmark than an aggregated monthly price. We test both rather than assuming the daily close wins.
- [Costa et al., Banco Central do Brasil, Working Paper 544](https://www.bcb.gov.br/pec/wps/port/wp544.asp?frame=1) compare regularization, tree methods and combinations with a much broader predictor database. Their short-horizon lasso results justify a regularized challenger; they do not establish performance on this smaller Brent dataset.
- [Baumeister & Kilian, Bank of Canada (2013)](https://publications.gc.ca/collections/collection_2013/banque-bank-canada/FB3-2-113-28-eng.pdf) motivate combinations of forecasts with different strengths. Their real-oil-price results are not directly transferable to our nominal Brent target.
- [EIA Brent history](https://www.eia.gov/dnav/pet/hist/RBRTEd.htm) supplies the daily and monthly benchmark series. No paid futures feed or external model service is required.

The implemented candidates are small enough for the existing Rust/Wasm stack. A neural network or Transformer has not been substituted without evidence. Futures-curve and global-demand models remain research directions requiring additional reliable histories and publication/vintage handling.

## Reproducible evaluation

Run `npm run benchmark -- docs/benchmarks/input.json`. To refresh the public snapshot from a running configured local server, run `npm run benchmark`.

- Minimum origin: 120 observed months. Regularized regressions use at most 240 monthly origins with already-observed direct targets.
- Predictors: 1/3/12-month momentum, deviation from the trailing 60-month geometric mean, lagged inventory/production growth, month-end close versus monthly average, and daily volatility. Fundamentals retain the two-month assumed publication lag.
- Ridge penalties: 0.01, 0.1, 1; elastic-net penalties: 0.001, 0.01, 0.1 with a 50/50 L1/L2 mix. Standardization uses each training window only. Penalties apply to the mean-squared objective.
- Tuned ridge, tuned elastic net, equal-weight and inverse-MSE ensembles compete with the daily-close baseline. Ensemble components are the legacy policy, monthly baseline, daily baseline, tuned ridge and tuned elastic net.
- Use the latest 120 matured target errors, with at least 24 errors, for selection and weighting. Freeze penalties, weights and challenger identity **before the first origin forecasting into the final 60 target months**. Training may subsequently absorb observations once available; tuning does not use the holdout.
- Every reported method uses the same 60 held-out target months. No missing daily targets are silently dropped. Intervals use only matured past residuals and may update their calibration as errors mature.
- Promote only if the preselected challenger reduces MAE by at least 5% against both legacy and the stronger no-change baseline, without increasing RMSE against either. The comparison does not choose a new winner after seeing holdout performance.

## Results

MAE is nominal USD/barrel; lower is better. The “challenger” column is selected before the holdout, not retrospectively chosen from the best test score.

| Horizon | Legacy MAE | Strongest baseline MAE | Preselected challenger | Challenger MAE | Promote |
|---|---:|---:|---|---:|---|
| 3 months | 11.15 | 11.55 | Daily close | 11.88 | No |
| 6 months | 13.88 | 13.11 | Tuned ridge | 13.49 | No |
| 12 months | 17.13 | 19.29 | Daily close | 19.29 | No |
| 36 months | 22.88 | 27.96 | Daily close | 28.40 | No |

The inverse-MSE ensemble achieves a 6-month MAE of 12.99, but it was not the preselected challenger and is less than 5% better than the strongest baseline. At 36 months, regularized regressions and their combinations can produce large misses. None justifies replacing production under this protocol.

[Full results](benchmarks/results.json) include RMSE, up/down/unchanged accuracy, empirical interval coverage, mean interval width, sample counts, frozen penalties and weights. [Input snapshot](benchmarks/input.json) records public values and provenance, without credentials. [Performance comparison](benchmarks/performance.json) records Wasm bytes and local execution measurements against the previous committed engine. Production point estimates and bounds are checked to be unchanged.

These are pseudo-real-time backtests on revised data, not reconstructed release vintages. Monthly-price availability is approximated at month boundaries and fundamental availability by a fixed lag. Overlapping long-horizon errors are dependent; no statistical-significance claim is made. A single recent holdout cannot establish performance across all market regimes, and choosing candidates after inspecting these results would require a fresh validation protocol.

## Long-horizon scenarios

5Y and 10Y contain 60 and 120 monthly values. 15Y and 30Y contain averages over consecutive 12-month periods from that same monthly path. The first 36 future months use the statistical engine, anchored relative to the current snapshot month rather than the older last observation.

After month 36, the low/base/high paths compound from the same central anchor. Annual USD inflation is 2%; annual real-price changes are −2%/0%/+2%. The monthly multiplier is `((1 + inflation) * (1 + realGrowth))^(1/12)`. Assumptions are fixed and explicitly shown. These paths are nominal scenarios, not fitted forecasts or probability bounds. Annual averages of monthly interval endpoints are likewise not calibrated annual 80% intervals.

The original monthly projection API remains available. Additive `scenarios` data supplies 360 monthly values, 30 annual aggregates, the anchor month and assumptions. `daily` carries the public research summaries. Cache version 0.3 invalidates older payloads; a new calendar month rebuilds the scenario anchor. Failed refreshes preserve the previous valid snapshot and never shift stale scenarios into new dates.
