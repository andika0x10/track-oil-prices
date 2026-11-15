import type { BrowserModel } from "./types";

/** Immutable public exports verified by forecast-web 1.0.0. */
export const MODEL_EXPORTS = {
  "chronos-bolt-small": {
    repository: "bakshinghampalace/chronos-bolt-small-onnx",
    revision: "b0239c09f35fe4cac94fada5ea207b692c30d3af",
    files: {
      "onnx/model_fp16w.onnx": { bytes: 395405, sha256: "c58d048824d9341d801d781314dc4c77780964138d2cfbc6a1a41de8933d4447" },
      "onnx/model_fp16w.f16": { bytes: 95395840, sha256: "a7643ba50cc79164d1726e6a5da8d5271e65a89e70d652804ae534102180dee5" },
    },
  },
  "chronos-bolt-tiny": {
    repository: "bakshinghampalace/chronos-bolt-tiny-onnx",
    revision: "19060f64e0195f77d7c7416535087239f1f69e7b",
    files: {
      "onnx/model_fp16w.onnx": { bytes: 258653, sha256: "299f2a04cc31a2064eb45e094f4ca5c0a9d138c082869d29a103f43b3b95b31d" },
      "onnx/model_fp16w.f16": { bytes: 17289216, sha256: "099882c876b116e8252ea30378d8150d9140443955b9f62e1623b34391f54f8e" },
    },
  },
} as const;

// Must match the installed, lockfile-pinned onnxruntime-web version.
export const MODEL_RUNTIME_VERSION = "1.31.1";

export function browserModelUrls(origin: string, model: BrowserModel) {
  return {
    weights: new URL(`/api/models/${model}/${MODEL_EXPORTS[model].revision}/`, origin).href,
    wasmPaths: new URL(`/api/model-runtime/${MODEL_RUNTIME_VERSION}/`, origin).href,
  };
}
