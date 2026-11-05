import type { Candle, Observation, Projection } from "./types";

export function monthIndex(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  const [year, m] = month.split("-").map(Number);
  return year * 12 + m - 1;
}
export function addMonths(month: string, count: number): string {
  const index = monthIndex(month) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
export function upcomingMonths(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) =>
    addMonths(currentMonth(now), i + 1),
  );
}
export function visibleProjections(
  points: Projection[],
  horizon: number,
  now = new Date(),
): Projection[] {
  const allowed = new Set(upcomingMonths(horizon, now));
  return points.filter((point) => allowed.has(point.month));
}
export function normalizeObservations(
  rows: unknown,
  now = new Date(),
): Observation[] {
  if (!Array.isArray(rows)) throw new Error("Missing EIA observations");
  const unique = new Map<string, number>();
  for (const row of rows) {
    if (
      !row ||
      typeof row.period !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period)
    )
      continue;
    if (row.value === null || row.value === "" || row.value === undefined)
      continue;
    const value = Number(row.value);
    if (row.period < currentMonth(now) && Number.isFinite(value) && value > 0)
      unique.set(row.period, value);
  }
  const result = [...unique]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
  if (result.length < 180) throw new Error("Insufficient complete EIA history");
  for (let i = 1; i < result.length; i++) {
    if (addMonths(result[i - 1].month, 1) !== result[i].month)
      throw new Error("EIA monthly history contains gaps");
  }
  return result;
}
export function parseCandle(row: unknown): Candle | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const c = {
    time: Number(r.t),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
    volume: Number(r.v),
  };
  return Object.values(c).every(Number.isFinite) &&
    c.time > 0 &&
    Math.min(c.open, c.high, c.low, c.close) > 0 &&
    c.volume >= 0
    ? c
    : null;
}
export function mergeCandles(
  old: Candle[],
  incoming: Candle[],
  limit = 5000,
): Candle[] {
  const map = new Map(old.map((candle) => [candle.time, candle]));
  for (const candle of incoming) map.set(candle.time, candle);
  return [...map.values()].sort((a, b) => a.time - b.time).slice(-limit);
}
