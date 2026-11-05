import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/generated/outlook/outlook.js";
import { createScenarios } from "../src/server/scenarios";
import { summarizeDaily, fetchDaily } from "../src/server/daily";
import { outlookPeriods } from "../src/lib/scenarios";
import { addMonths } from "../src/lib/data";
import type { Outlook } from "../src/lib/types";
initSync({
  module: new WebAssembly.Module(
    readFileSync("src/generated/outlook/outlook_bg.wasm"),
  ),
});

test("monthly and annual horizons share one path and stale months never silently shift", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const projections = Array.from({ length: 36 }, (_, i) => ({
    month: addMonths("2026-12", i),
    horizon: i + 1,
    estimate: 80 + i / 10,
    lower: 60,
    upper: 100,
  }));
  const scenarios = createScenarios(projections, "2026-12");
  const outlook = { projections, scenarios } as Outlook;
  const five = outlookPeriods(outlook, 60, now),
    ten = outlookPeriods(outlook, 120, now);
  assert.equal(five.length, 60);
  assert.equal(ten.length, 120);
  assert.deepEqual(five, ten.slice(0, 60));
  assert.deepEqual(
    five.slice(0, 36).map((p) => p.estimate),
    projections.map((p) => p.estimate),
  );
  assert.equal(five[35].scenario, false);
  assert.equal(five[36].scenario, true);
  assert.equal(scenarios.anchorMonth, "2029-11");
  assert.ok(Math.abs(five[47].estimate - scenarios.anchor * 1.02) < 1e-9);
  for (const horizon of [180, 360]) {
    const years = outlookPeriods(outlook, horizon, now);
    assert.equal(years.length, horizon / 12);
    years.forEach((p, i) => {
      assert.equal(p.month, scenarios.monthly[i * 12].month);
      assert.equal(p.endMonth, scenarios.monthly[i * 12 + 11].month);
      assert.ok(
        Math.abs(
          p.estimate -
            scenarios.monthly
              .slice(i * 12, i * 12 + 12)
              .reduce((s, p) => s + p.estimate, 0) /
              12,
        ) < 1e-9,
      );
    });
  }
  assert.deepEqual(outlookPeriods(outlook, 120, new Date("2026-12-01")), []);
  assert.throws(() => createScenarios(projections.slice(1), "2026-12"));
});

test("daily summaries reject invalid dates, incomplete months and future quotes", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    period: `2026-10-${String(i + 10).padStart(2, "0")}`,
    value: 70 + i,
  }));
  const result = summarizeDaily(
    [
      ...rows,
      { period: "2026-13-01", value: 20 },
      { period: "2026-11-30", value: 100 },
    ],
    new Date("2026-11-05"),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].close, 89);
  assert.equal(result[0].lastDate, "2026-10-29");
  assert.ok(result[0].volatility > 0);
  assert.deepEqual(
    summarizeDaily(rows.slice(0, 10), new Date("2026-11-05")),
    [],
  );
});

test("daily history paginates and rejects a truncated second page", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const rows = Array.from({ length: 5020 }, (_, i) => ({
    period: new Date(Date.UTC(2010, 0, i + 1)).toISOString().slice(0, 10),
    value: 70 + Math.sin(i / 10),
  }));
  const offsets: number[] = [];
  let truncate = false;
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    offsets.push(offset);
    return Response.json({
      response: {
        total: rows.length,
        data: truncate && offset > 0 ? [] : rows.slice(offset, offset + 5000),
      },
    });
  };
  const result = await fetchDaily("test-only");
  assert.deepEqual(offsets, [0, 5000]);
  assert.ok(result.length > 150);
  truncate = true;
  await assert.rejects(() => fetchDaily("test-only"), /incomplete/);
});
