import { initSync, forecast } from "../generated/outlook/outlook.js";
import module from "../generated/outlook/outlook_bg.wasm?module";
import type { DriverValues, ModelResult } from "../lib/types";

let initialized = false;
let initializationMs = 0;
export function runModel(
  values: number[],
  horizon: number,
  drivers?: DriverValues,
) {
  if (!initialized) {
    const start = performance.now();
    initSync({ module });
    initializationMs = performance.now() - start;
    initialized = true;
    console.info(
      JSON.stringify({ event: "wasm_initialized", initializationMs }),
    );
  }
  const start = performance.now();
  const result = JSON.parse(
    forecast(JSON.stringify({ values, horizon, drivers })),
  ) as ModelResult;
  const computationMs = performance.now() - start;
  console.info(
    JSON.stringify({
      event: "model_computed",
      version: result.version,
      computationMs,
    }),
  );
  return { result, performance: { initializationMs, computationMs } };
}
