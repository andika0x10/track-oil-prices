import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { initSync, forecast } from "../src/generated/outlook/outlook.js";

const start = performance.now();
initSync({
  module: new WebAssembly.Module(
    readFileSync("src/generated/outlook/outlook_bg.wasm"),
  ),
});
const initializationMs = performance.now() - start;
const input = {
  values: Array.from(
    { length: 240 },
    (_, i) => 65 + Math.sin(i / 9) * 15 + i * 0.02,
  ),
  horizon: 38,
};
const computeStart = performance.now();
const wasm = JSON.parse(forecast(JSON.stringify(input)));
const computationMs = performance.now() - computeStart;
const native = spawnSync(
  "cargo",
  [
    "run",
    "--quiet",
    "--locked",
    "--release",
    "--manifest-path",
    "crates/outlook/Cargo.toml",
    "--bin",
    "native-fixture",
  ],
  { encoding: "utf8" },
);
assert.equal(native.status, 0, native.stderr);
const expected = JSON.parse(native.stdout);
function compare(a, b) {
  if (typeof a === "number")
    assert.ok(
      Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)),
      `${a} != ${b}`,
    );
  else if (a && typeof a === "object") {
    assert.deepEqual(Object.keys(a), Object.keys(b));
    for (const key of Object.keys(a)) compare(a[key], b[key]);
  } else assert.equal(a, b);
}
compare(wasm, expected);
const driverInput = {
  ...input,
  drivers: {
    stocks: Array.from({ length: 240 }, (_, i) =>
      i < 238 ? 400 + Math.cos(i / 7) * 20 : null,
    ),
    production: Array.from({ length: 240 }, (_, i) =>
      i < 238 ? 10 + i * 0.01 + Math.sin(i / 10) * 0.2 : null,
    ),
  },
};
const nativeDrivers = spawnSync(
  "cargo",
  [
    "run",
    "--quiet",
    "--locked",
    "--release",
    "--manifest-path",
    "crates/outlook/Cargo.toml",
    "--bin",
    "native-fixture",
    "--",
    "--drivers",
  ],
  { encoding: "utf8" },
);
assert.equal(nativeDrivers.status, 0, nativeDrivers.stderr);
compare(
  JSON.parse(forecast(JSON.stringify(driverInput))),
  JSON.parse(nativeDrivers.stdout),
);
assert.throws(() =>
  forecast(
    JSON.stringify({ ...input, drivers: { stocks: [1], production: [1] } }),
  ),
);
assert.throws(() =>
  forecast(JSON.stringify({ values: [1, 2, 3], horizon: 36 })),
);
const short = JSON.parse(forecast(JSON.stringify({ ...input, horizon: 36 })));
assert.deepEqual(short.points, wasm.points.slice(0, 36));
console.log(
  JSON.stringify(
    {
      test: "native-wasm-parity",
      passed: true,
      initializationMs,
      computationMs,
      bytes: statSync("src/generated/outlook/outlook_bg.wasm").size,
      model: wasm.model,
    },
    null,
    2,
  ),
);
