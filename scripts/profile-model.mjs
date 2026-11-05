import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import * as current from "../src/generated/outlook/outlook.js";

const revision = process.argv[2] || "HEAD";
mkdirSync(".qa", { recursive: true });
mkdirSync("docs/benchmarks", { recursive: true });
const oldBytes = execFileSync("git", [
  "show",
  `${revision}:src/generated/outlook/outlook_bg.wasm`,
]);
writeFileSync(
  ".qa/baseline-outlook.mjs",
  execFileSync("git", ["show", `${revision}:src/generated/outlook/outlook.js`]),
);
const previous = await import(
  pathToFileURL(resolve(".qa/baseline-outlook.mjs"))
);
const input = JSON.parse(readFileSync("docs/benchmarks/input.json", "utf8"));
const json = JSON.stringify({
  values: input.values,
  drivers: input.drivers,
  horizon: 36,
});
const stats = [];
let latest;
let baselinePoints;
for (const [name, engine, bytes] of [
  ["baseline", previous, oldBytes],
  ["current", current, readFileSync("src/generated/outlook/outlook_bg.wasm")],
]) {
  const start = performance.now();
  engine.initSync({ module: new WebAssembly.Module(bytes) });
  const initializationMs = performance.now() - start;
  const runs = [];
  for (let i = 0; i < 16; i++) {
    const t = performance.now();
    const result = JSON.parse(engine.forecast(json));
    if (i > 0) runs.push(performance.now() - t);
    if (name === "baseline") baselinePoints = result.points;
    else {
      assert.deepEqual(result.points, baselinePoints);
      latest = result;
    }
  }
  runs.sort((a, b) => a - b);
  stats.push({
    name,
    wasmBytes: bytes.length,
    initializationMs,
    medianForecastMs: runs[7],
    samples: 15,
  });
}
const scenarioJson = JSON.stringify(
  latest.points.map((p) => ({ ...p, scenario: false })),
);
const scenarioStart = performance.now();
const path = JSON.parse(current.build_scenarios(scenarioJson));
const firstScenarioMs = performance.now() - scenarioStart;
assert.equal(path.monthly.length, 360);
const scenarioRuns = [];
for (let i = 0; i < 15; i++) {
  const start = performance.now();
  current.build_scenarios(scenarioJson);
  scenarioRuns.push(performance.now() - start);
}
scenarioRuns.sort((a, b) => a - b);
const result = {
  baselineRevision: execFileSync("git", ["rev-parse", revision], {
    encoding: "utf8",
  }).trim(),
  observations: input.values.length,
  environment:
    "Node native WebAssembly, local Windows; timings are not Cloudflare CPU guarantees",
  productionPointsUnchanged: true,
  engines: stats,
  firstScenarioMs,
  medianScenarioMs: scenarioRuns[7],
};
writeFileSync(
  "docs/benchmarks/performance.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
