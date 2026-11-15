import { addMonths, currentMonth, monthIndex, normalizeObservations } from "./data";
import { createBrowserScenarios } from "./browserScenarios";
import { MODEL_EXPORTS } from "./modelAssets";
import type { Benchmark, BrowserInference, BrowserModel, Outlook, Projection } from "./types";

export const FORECAST_VERSION = "browser-chronos-v1:forecast-web@1.0.0";
// Match the immutable, hash-verified exports pinned by forecast-web 1.0.0.
export const BROWSER_MODELS = {
  "chronos-bolt-small": { name: "Chronos-Bolt Small", downloadMB: 96, revision: MODEL_EXPORTS["chronos-bolt-small"].revision },
  "chronos-bolt-tiny": { name: "Chronos-Bolt Tiny", downloadMB: 18, revision: MODEL_EXPORTS["chronos-bolt-tiny"].revision },
} as const;

export function validateBenchmark(value: unknown): Benchmark {
  const data = value as Benchmark;
  if (!data || data.source !== "EIA" || !Array.isArray(data.observations) ||
      typeof data.fingerprint !== "string" || !data.fingerprint ||
      !Number.isFinite(Date.parse(data.checkedAt)) ||
      !["fresh", "stale"].includes(data.freshness))
    throw new Error("Monthly Brent data could not be read. Check again.");
  const observations = normalizeObservations(data.observations.map((row) => ({ period: row.month, value: row.value })));
  if (data.lastObservation !== observations.at(-1)!.month || observations.length !== data.observations.length)
    throw new Error("Monthly Brent history is incomplete. Check again.");
  return { ...data, observations };
}

export function forecastRequest(benchmark: Benchmark, modelId: BrowserModel, now = new Date()) {
  const startMonth = addMonths(currentMonth(now), 1);
  const horizon = monthIndex(addMonths(currentMonth(now), 36)) - monthIndex(benchmark.lastObservation);
  if (horizon < 36 || horizon > 60)
    throw new Error("Newer monthly Brent observations are needed for this prediction.");
  return {
    startMonth, horizon,
    key: `${FORECAST_VERSION}:${modelId}:${BROWSER_MODELS[modelId].revision}:${benchmark.fingerprint}:${startMonth}:${horizon}`,
  };
}

function assembleOutlook(benchmark: Benchmark, projections: Projection[], inference: BrowserInference,
  performance: Outlook["performance"], generatedAt: string, now: Date): Outlook {
  return {
    source: benchmark.source, instrument: benchmark.instrument, unit: benchmark.unit,
    observations: benchmark.observations, lastObservation: benchmark.lastObservation,
    freshness: benchmark.freshness, checkedAt: benchmark.checkedAt, generatedAt,
    projections, inference, performance,
    model: { version: FORECAST_VERSION, model: BROWSER_MODELS[inference.modelId].name, intervalLevel: 0.8, metrics: [] },
    scenarios: createBrowserScenarios(projections, addMonths(currentMonth(now), 1)),
  };
}

export function createBrowserOutlook(benchmark: Benchmark,
  forecast: { median: number[]; q10: number[]; q90: number[] },
  modelId: BrowserModel, runtime: { backend: "webgpu" | "wasm"; dtype: string; performance: Outlook["performance"] },
  now = new Date()): Outlook {
  const request = forecastRequest(benchmark, modelId, now);
  if ([forecast.median, forecast.q10, forecast.q90].some((rows) => !Array.isArray(rows) || rows.length !== request.horizon))
    throw new Error("The model returned an incomplete prediction. Try again.");
  const projections = forecast.median.map((estimate, i) => {
    const lower = forecast.q10[i], upper = forecast.q90[i];
    // Do not clip, sort or fabricate model outputs, including negative lower quantiles.
    if (![estimate, lower, upper].every(Number.isFinite) || estimate <= 0 || lower > estimate || estimate > upper)
      throw new Error("The model returned an invalid prediction range. Try again.");
    return { month: addMonths(benchmark.lastObservation, i + 1), horizon: i + 1,
      estimate, lower, upper, model: BROWSER_MODELS[modelId].name };
  });
  return assembleOutlook(benchmark, projections, {
    engine: "forecast-web", modelId, revision: BROWSER_MODELS[modelId].revision,
    backend: runtime.backend, dtype: runtime.dtype, inputFingerprint: benchmark.fingerprint,
    intervalMethod: "model-quantiles",
  }, runtime.performance, now.toISOString(), now);
}

type PredictionStorage = Pick<Storage, "getItem" | "setItem">;
const storageKey = (model: BrowserModel) => `brent:prediction:v1:${model}`;

export function readCachedOutlook(storage: PredictionStorage, benchmark: Benchmark, modelId: BrowserModel,
  now = new Date()): Outlook | undefined {
  try {
    const cached = JSON.parse(storage.getItem(storageKey(modelId)) || "null");
    const request = forecastRequest(benchmark, modelId, now);
    if (!cached || cached.key !== request.key || !Number.isFinite(Date.parse(cached.generatedAt))) return;
    const inf = cached.inference as BrowserInference | undefined;
    if (!inf || inf.modelId !== modelId || inf.engine !== "forecast-web" ||
        inf.revision !== BROWSER_MODELS[modelId].revision || inf.inputFingerprint !== benchmark.fingerprint ||
        inf.intervalMethod !== "model-quantiles" || !["wasm", "webgpu"].includes(inf.backend)) return;
    const points = cached.projections as Projection[];
    if (!Array.isArray(points) || points.length !== request.horizon || points.some((p, i) =>
      p.month !== addMonths(benchmark.lastObservation, i + 1) || p.horizon !== i + 1 || p.estimate <= 0 ||
      ![p.estimate, p.lower, p.upper].every(Number.isFinite) || p.lower > p.estimate || p.estimate > p.upper)) return;
    if (![cached.performance?.initializationMs, cached.performance?.computationMs].every((n) => Number.isFinite(n) && n >= 0)) return;
    return assembleOutlook(benchmark, points, inf, cached.performance, cached.generatedAt, now);
  } catch { return undefined; }
}

export function cacheOutlook(storage: PredictionStorage, benchmark: Benchmark, outlook: Outlook, now = new Date()) {
  if (!outlook.inference) return;
  try {
    storage.setItem(storageKey(outlook.inference.modelId), JSON.stringify({
      key: forecastRequest(benchmark, outlook.inference.modelId, now).key,
      generatedAt: outlook.generatedAt, projections: outlook.projections,
      inference: outlook.inference, performance: outlook.performance,
    }));
  } catch { /* Predictions work when browser storage is full or disabled. */ }
}
