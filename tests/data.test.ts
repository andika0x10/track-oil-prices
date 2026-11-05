import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  mergeCandles,
  normalizeObservations,
  parseCandle,
  upcomingMonths,
  visibleProjections,
} from "../src/lib/data";
test("calendar crosses years and preserves forecasts between horizons", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  assert.deepEqual(upcomingMonths(3, now), ["2026-12", "2027-01", "2027-02"]);
  const points = upcomingMonths(36, now).map((month, i) => ({
    month,
    horizon: i + 1,
    estimate: 70 + i,
    lower: 60,
    upper: 120,
  }));
  assert.deepEqual(
    visibleProjections(points, 3, now),
    visibleProjections(points, 36, now).slice(0, 3),
  );
});
test("candles merge in chronological order, replace duplicates, and cap memory", () => {
  const candle = (time: number, close = 80) => ({
    time,
    close,
    open: 80,
    high: 90,
    low: 70,
    volume: 1,
  });
  assert.deepEqual(
    mergeCandles([candle(2), candle(1)], [candle(2, 85), candle(3)], 2),
    [candle(2, 85), candle(3)],
  );
  assert.equal(parseCandle({ t: 10, o: 1, h: 2, l: 1, c: "bad", v: 1 }), null);
});
test("EIA excludes incomplete months and rejects gaps or insufficient history", () => {
  const rows = Array.from({ length: 242 }, (_, i) => ({
    period: addMonths("2006-10", i),
    value: "70",
  }));
  const normalized = normalizeObservations(
    rows,
    new Date("2026-11-05T00:00:00Z"),
  );
  assert.equal(normalized.at(-1)?.month, "2026-10");
  assert.throws(
    () =>
      normalizeObservations(
        rows.filter((_, i) => i !== 100),
        new Date("2026-11-05T00:00:00Z"),
      ),
    /gaps/,
  );
  assert.throws(() => normalizeObservations([], new Date()), /Insufficient/);
});
