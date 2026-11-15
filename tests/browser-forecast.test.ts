import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/generated/outlook/outlook.js";
import { createScenarios } from "../src/server/scenarios";
import { createBrowserScenarios } from "../src/lib/browserScenarios";
import { addMonths } from "../src/lib/data";
import { createBrowserOutlook, forecastRequest, cacheOutlook, readCachedOutlook, validateBenchmark } from "../src/lib/forecast";
import { createBenchmarkService } from "../src/server/benchmark";
import type { Benchmark, Projection } from "../src/lib/types";

const now = new Date("2026-11-15T00:00:00Z");
const benchmark: Benchmark = {
  source: "EIA", instrument: "Europe Brent spot benchmark", unit: "USD/barrel",
  observations: Array.from({ length: 240 }, (_, i) => ({ month: addMonths("2006-11", i), value: 70 + Math.sin(i) })),
  lastObservation: "2026-10", checkedAt: now.toISOString(), freshness: "fresh", fingerprint: "fixture-a",
};
const runtime = { backend: "wasm" as const, dtype: "fp16", performance: { initializationMs: 2, computationMs: 3 } };
const prediction = { median: Array(37).fill(80), q10: Array(37).fill(50), q90: Array(37).fill(120) };

test("browser scenario paths match the retained Rust builder, including annual bounds", () => {
  initSync({ module: new WebAssembly.Module(readFileSync("src/generated/outlook/outlook_bg.wasm")) });
  const projections: Projection[] = Array.from({ length: 36 }, (_, i) => ({
    month: addMonths("2026-12", i), horizon: i + 1, estimate: 80 + i / 10,
    lower: 50 - i / 10, upper: 100 + i / 2, model: "test",
  }));
  const legacy = createScenarios(projections, "2026-12");
  const browser = createBrowserScenarios(projections, "2026-12");
  for (const resolution of ["monthly", "annual"] as const) {
    assert.equal(browser[resolution].length, legacy[resolution].length);
    browser[resolution].forEach((point, i) => {
      for (const field of ["estimate", "lower", "upper"] as const)
        assert.ok(Math.abs(point[field] - legacy[resolution][i][field]) < 1e-9);
      assert.equal(point.month, legacy[resolution][i].month);
      assert.equal(point.scenario, legacy[resolution][i].scenario);
    });
  }
  assert.equal(browser.anchorMonth, legacy.anchorMonth);
});

test("model ranges stay unchanged and cached predictions invalidate on revisions, model changes, and month rollover", () => {
  const outlook = createBrowserOutlook(benchmark, prediction, "chronos-bolt-small", runtime, now);
  assert.equal(outlook.projections[0].month, "2026-11");
  assert.equal(outlook.projections.at(-1)!.month, "2029-11");
  assert.equal(outlook.scenarios!.startMonth, "2026-12");
  assert.equal(outlook.model.metrics.length, 0, "Do not borrow accuracy metrics from the legacy model");
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } };
  cacheOutlook(storage, benchmark, outlook, now);
  assert.deepEqual(readCachedOutlook(storage, benchmark, "chronos-bolt-small", now)?.projections, outlook.projections);
  const updated = { ...benchmark, checkedAt: "2026-11-15T02:00:00Z", freshness: "stale" as const };
  assert.equal(readCachedOutlook(storage, updated, "chronos-bolt-small", now)?.checkedAt, updated.checkedAt);
  assert.equal(readCachedOutlook(storage, updated, "chronos-bolt-small", now)?.freshness, "stale");
  assert.equal(readCachedOutlook(storage, { ...benchmark, fingerprint: "revision-b" }, "chronos-bolt-small", now), undefined);
  assert.equal(readCachedOutlook(storage, benchmark, "chronos-bolt-tiny", now), undefined);
  assert.equal(readCachedOutlook(storage, benchmark, "chronos-bolt-small", new Date("2026-12-01")), undefined);
  records.set("brent:prediction:v1:chronos-bolt-small", "broken-json");
  assert.equal(readCachedOutlook(storage, benchmark, "chronos-bolt-small", now), undefined);
  assert.throws(() => createBrowserOutlook(benchmark, { ...prediction, median: [80] }, "chronos-bolt-small", runtime, now), /incomplete/);
  assert.throws(() => createBrowserOutlook(benchmark, { ...prediction, q10: Array(37).fill(90) }, "chronos-bolt-small", runtime, now), /invalid/);
  const negativeLower = createBrowserOutlook(benchmark, { ...prediction, q10: Array(37).fill(-10) }, "chronos-bolt-small", runtime, now);
  assert.equal(negativeLower.projections[0].lower, -10, "Do not silently clip model quantiles");
  assert.throws(() => forecastRequest({ ...benchmark, lastObservation: "2020-01" }, "chronos-bolt-small", now), /Newer/);
});

test("benchmark endpoint deduplicates reads, invalidates revised data, and retains stale history without running a model", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let clock = now.getTime(), calls = 0, fail = false, offset = 0;
  Date.now = () => clock;
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.get("frequency"), "monthly");
    if (fail) throw new Error("offline");
    return Response.json({ response: { total: 240,
      data: benchmark.observations.map((row) => ({ period: row.month, value: row.value + offset })) } });
  };
  // Use current wall clock for the normalizer and freshness timestamps.
  clock = originalNow();
  const service = createBenchmarkService();
  const [first, concurrent] = await Promise.all([
    service.getBenchmark({ EIA_API_KEY: "test-key" }),
    service.getBenchmark({ EIA_API_KEY: "test-key" }),
  ]);
  assert.deepEqual(first, concurrent);
  assert.equal(validateBenchmark(first).observations.length, 240);
  await Promise.all([service.getBenchmark({ EIA_API_KEY: "test-key" }), service.getBenchmark({ EIA_API_KEY: "test-key" })]);
  assert.equal(calls, 1);
  clock += 61_000; offset = 1;
  const revision = await service.getBenchmark({ EIA_API_KEY: "test-key" });
  assert.notEqual(revision.fingerprint, first.fingerprint);
  clock += 61_000; fail = true;
  const stale = await service.getBenchmark({ EIA_API_KEY: "test-key" });
  assert.equal(stale.freshness, "stale");
  assert.deepEqual(stale.observations, revision.observations);
  await assert.rejects(() => createBenchmarkService().getBenchmark({}), /not connected/);
});
