import { loadForecaster } from "forecast-web";
import { BROWSER_MODELS } from "../lib/forecast";
import { browserModelUrls } from "../lib/modelAssets";
import type { BrowserModel } from "../lib/types";

self.onmessage = async ({ data }: MessageEvent<{ modelId: BrowserModel; values: number[]; horizon: number }>) => {
  const start = performance.now();
  let model;
  try {
    model = await loadForecaster({ model: data.modelId, revision: BROWSER_MODELS[data.modelId].revision,
      ...browserModelUrls(self.location.origin, data.modelId),
      dtype: "fp16", worker: false, cache: true,
      onProgress: (progress) => self.postMessage({ type: "progress", progress }) });
    const initializationMs = performance.now() - start;
    self.postMessage({ type: "predicting" });
    const predictionStart = performance.now();
    const [forecast] = await model.forecast([data.values], { horizon: data.horizon });
    self.postMessage({ type: "result", forecast, runtime: {
      backend: model.backend, dtype: model.dtype,
      performance: { initializationMs, computationMs: performance.now() - predictionStart },
    } });
  } catch (error) {
    self.postMessage({ type: "error", code: (error as { code?: string })?.code,
      message: error instanceof Error ? error.message : "The model could not calculate a prediction." });
  } finally { await model?.dispose(); }
};
