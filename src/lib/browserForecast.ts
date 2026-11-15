import type { Progress } from "forecast-web";
import { createBrowserOutlook, forecastRequest } from "./forecast";
import type { Benchmark, BrowserModel } from "./types";

export async function runBrowserForecast(benchmark: Benchmark, modelId: BrowserModel,
  signal: AbortSignal, onProgress: (progress: Progress) => void, onPredicting: () => void) {
  signal.throwIfAborted();
  const now = new Date();
  const request = forecastRequest(benchmark, modelId, now);
  const worker = new Worker(new URL("../workers/forecast.worker.ts", import.meta.url), { type: "module" });
  return new Promise<ReturnType<typeof createBrowserOutlook>>((resolve, reject) => {
    const finish = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); worker.terminate(); };
    const fail = (error: unknown) => { finish(); reject(error); };
    const abort = () => fail(new DOMException("Prediction cancelled", "AbortError"));
    const timeout = setTimeout(() => fail(new Error("The model is taking too long to load. Retry or use the smaller 18 MB model.")), 180_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => fail(new Error("The prediction worker could not start. Retry or use the smaller 18 MB model."));
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress(data.progress);
      else if (data.type === "predicting") onPredicting();
      else if (data.type === "error") fail(Object.assign(new Error(data.message), { code: data.code }));
      else if (data.type === "result") {
        try {
          const completedAt = new Date();
          if (forecastRequest(benchmark, modelId, completedAt).key !== request.key)
            throw new Error("The calendar month changed during calculation. Check the latest data again.");
          const result = createBrowserOutlook(benchmark, data.forecast, modelId, data.runtime, completedAt);
          finish(); resolve(result);
        } catch (error) { fail(error); }
      }
    };
    worker.postMessage({ modelId, values: benchmark.observations.map((row) => row.value),
      horizon: request.horizon });
  });
}
