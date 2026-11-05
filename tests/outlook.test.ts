import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOutlookService, type OutlookEnv } from "../src/server/outlook";
import { addMonths, currentMonth } from "../src/lib/data";
import type { ModelResult } from "../src/lib/types";
import { initSync, forecast } from "../src/generated/outlook/outlook.js";

initSync({
  module: new WebAssembly.Module(
    readFileSync("src/generated/outlook/outlook_bg.wasm"),
  ),
});
test("real Wasm service bootstraps, skips unchanged data, retains cache on failure, and reports missing configuration", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0,
    offset = 0,
    failure = false,
    storageFailure = false;
  const service = createOutlookService((values, horizon) => {
    calls++;
    return {
      result: JSON.parse(
        forecast(JSON.stringify({ values, horizon })),
      ) as ModelResult,
      performance: { initializationMs: 0, computationMs: 0 },
    };
  });
  const records = new Map<string, string>();
  const cache = {
    get: async (key: string) =>
      records.has(key) ? JSON.parse(records.get(key)!) : null,
    put: async (key: string, value: string) => {
      if (storageFailure) throw new Error("Storage unavailable");
      records.set(key, value);
    },
  } as unknown as OutlookEnv["OUTLOOK"];
  const env = { OUTLOOK: cache, EIA_API_KEY: "test-only-key" };
  await assert.rejects(
    () => service.getOutlook({ OUTLOOK: cache }),
    /not available yet/,
  );
  globalThis.fetch = async () => {
    if (failure) return new Response("", { status: 429 });
    return Response.json({
      response: {
        total: 240,
        data: Array.from({ length: 240 }, (_, i) => ({
          period: addMonths(currentMonth(), i - 240),
          value: 65 + Math.sin(i / 9) * 15 + offset,
        })),
      },
    });
  };
  const first = await service.getOutlook(env);
  assert.equal(first.freshness, "fresh");
  assert.equal(first.projections.at(-1)?.month, addMonths(currentMonth(), 36));
  assert.equal(calls, 1);
  const unchanged = await service.getOutlook(env, true);
  assert.equal(calls, 1);
  assert.equal(unchanged.generatedAt, first.generatedAt);
  failure = true;
  const stale = await service.getOutlook(env, true);
  assert.equal(stale.freshness, "stale");
  assert.deepEqual(stale.projections, first.projections);
  failure = false;
  offset = 5;
  storageFailure = true;
  const retained = await service.getOutlook(env, true);
  assert.equal(retained.freshness, "stale");
  assert.deepEqual(retained.projections, first.projections);
  assert.equal(calls, 2);
});
test("model initialization failure is a safe API error", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    Response.json({
      response: {
        total: 240,
        data: Array.from({ length: 240 }, (_, i) => ({
          period: addMonths(currentMonth(), i - 240),
          value: 70,
        })),
      },
    });
  const service = createOutlookService(() => {
    throw new Error("Wasm initialization failed");
  });
  await assert.rejects(
    () => service.getOutlook({ EIA_API_KEY: "test-only-key" }),
    (error) =>
      error instanceof Error &&
      error.message ===
        "The projection engine is temporarily unavailable. Try again shortly.",
  );
});
