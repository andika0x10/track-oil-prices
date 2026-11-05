import { COIN, type Market, type History } from "../lib/types";
import { parseCandle, mergeCandles } from "../lib/data";
import { ServiceError, upstreamJson } from "./http";

const URL = "https://api.hyperliquid.xyz/info";
export const HISTORY_RANGES = {
  "1D": { interval: "5m", days: 1 },
  "1W": { interval: "1h", days: 7 },
  "1M": { interval: "4h", days: 30 },
  ALL: { interval: "1d", days: 5000 },
} as const;
let lastMarket: Market | undefined;
const histories = new Map<string, History>();
async function info(body: unknown) {
  return upstreamJson(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export async function getMarket(): Promise<Market> {
  if (lastMarket && Date.now() - Date.parse(lastMarket.updatedAt) < 15_000)
    return lastMarket;
  try {
    const response = (await info({ type: "metaAndAssetCtxs", dex: "xyz" })) as [
      { universe: { name: string }[] },
      Record<string, string>[],
    ];
    const index = response?.[0]?.universe?.findIndex(
      (item) => item.name === COIN,
    );
    const ctx = index >= 0 ? response[1]?.[index] : undefined;
    const price = Number(ctx?.markPx),
      previousDay = Number(ctx?.prevDayPx),
      volume = Number(ctx?.dayNtlVlm);
    if (
      ![price, previousDay, volume].every(Number.isFinite) ||
      price <= 0 ||
      previousDay <= 0
    )
      throw new ServiceError(
        "INVALID_MARKET",
        "Brent market data is currently unavailable.",
      );
    lastMarket = {
      source: "Hyperliquid",
      instrument: COIN,
      unit: "USD/barrel",
      price,
      previousDay,
      volume,
      change: (price / previousDay - 1) * 100,
      updatedAt: new Date().toISOString(),
      freshness: "fresh",
    };
    return lastMarket;
  } catch (error) {
    if (lastMarket) return { ...lastMarket, freshness: "stale" };
    throw error;
  }
}
export async function getHistory(range: string): Promise<History> {
  if (!Object.hasOwn(HISTORY_RANGES, range))
    throw new ServiceError("INVALID_RANGE", "Choose 1D, 1W, 1M, or ALL.", 400);
  const config = HISTORY_RANGES[range as keyof typeof HISTORY_RANGES];
  const cached = histories.get(range);
  if (cached && Date.now() - Date.parse(cached.updatedAt) < 60_000)
    return cached;
  try {
    const rows = await info({
      type: "candleSnapshot",
      req: {
        coin: COIN,
        interval: config.interval,
        startTime: Math.max(0, Date.now() - config.days * 86400_000),
        endTime: Date.now(),
      },
    });
    if (!Array.isArray(rows))
      throw new ServiceError(
        "INVALID_HISTORY",
        "Historical prices are temporarily unavailable.",
      );
    const candles = mergeCandles(
      [],
      rows
        .map(parseCandle)
        .filter((c): c is NonNullable<typeof c> => c !== null),
    );
    if (!candles.length)
      throw new ServiceError(
        "EMPTY_HISTORY",
        "No historical prices are available for this period.",
      );
    const result: History = {
      source: "Hyperliquid",
      instrument: COIN,
      unit: "USD/barrel",
      interval: config.interval,
      candles,
      updatedAt: new Date().toISOString(),
      freshness: "fresh",
    };
    histories.set(range, result);
    return result;
  } catch (error) {
    if (cached) return { ...cached, freshness: "stale" };
    throw error;
  }
}
