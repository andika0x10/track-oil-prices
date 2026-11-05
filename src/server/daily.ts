import type { DailySummary } from "../lib/types";
import { currentMonth } from "../lib/data";
import { ServiceError, upstreamJson } from "./http";

export function summarizeDaily(
  rows: unknown[],
  now = new Date(),
): DailySummary[] {
  const days = new Map<string, number>();
  for (const row of rows) {
    const r = row as { period?: string; value?: unknown };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.period ?? "")) continue;
    const date = r.period!;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      continue;
    const price = Number(r.value);
    if (
      date < now.toISOString().slice(0, 10) &&
      Number.isFinite(price) &&
      price > 0
    )
      days.set(date, price);
  }
  const months = new Map<string, [string, number][]>();
  for (const day of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const month = day[0].slice(0, 7);
    if (month >= currentMonth(now)) continue;
    const list = months.get(month) ?? [];
    list.push(day);
    months.set(month, list);
  }
  return [...months].flatMap(([month, days]) => {
    const last = days.at(-1)!;
    const end = new Date(`${month}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    // Reject truncated pages/months rather than calling an early quote a month-end close.
    if (days.length < 10 || end.getTime() - Date.parse(last[0]) > 7 * 86400_000)
      return [];
    const returns = days.slice(1).map((d, i) => Math.log(d[1] / days[i][1]));
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length,
    );
    return [{ month, lastDate: last[0], close: last[1], volatility }];
  });
}

export async function fetchDaily(key: string): Promise<DailySummary[]> {
  const rows: unknown[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += 5000) {
    const params = new URLSearchParams({
      api_key: key,
      frequency: "daily",
      "data[0]": "value",
      "facets[series][]": "RBRTE",
      "sort[0][column]": "period",
      "sort[0][direction]": "asc",
      length: "5000",
      offset: String(offset),
    });
    const page = (await upstreamJson(
      `https://api.eia.gov/v2/petroleum/pri/spt/data/?${params}`,
    )) as { response?: { total?: number | string; data?: unknown[] } };
    total = Number(page.response?.total);
    const data = page.response?.data;
    if (
      !Number.isFinite(total) ||
      total < 1 ||
      total > 50000 ||
      !Array.isArray(data) ||
      !data.length
    )
      throw new ServiceError(
        "INVALID_DAILY_DATA",
        "Daily benchmark history is incomplete.",
      );
    rows.push(...data);
  }
  if (rows.length !== total)
    throw new ServiceError(
      "INVALID_DAILY_DATA",
      "Daily benchmark history is incomplete.",
    );
  return summarizeDaily(rows);
}
