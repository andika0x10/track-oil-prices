import { useCallback, useEffect, useRef, useState } from "react";
import {
  COIN,
  type Candle,
  type Connection,
  type History,
  type Market,
} from "../lib/types";
import { mergeCandles, parseCandle } from "../lib/data";

export async function api<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = (await response.json()) as { error?: { message?: string } };
  if (!response.ok)
    throw new Error(
      data.error?.message || "Data is unavailable. Try again shortly.",
    );
  return data as T;
}
const intervals: Record<string, string> = {
  "1D": "5m",
  "1W": "1h",
  "1M": "4h",
  ALL: "1d",
};
export function useMarket(range: string) {
  const [market, setMarket] = useState<Market>();
  const [history, setHistory] = useState<History>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [marketError, setMarketError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const lastTick = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let hasOpened = false;
    let bufferedCandles: Candle[] = [];
    setLoading(true);
    setHistoryError("");
    setHistory(undefined);
    const loadHistory = async () => {
      try {
        const data = await api<History>(
          `/api/history?range=${range}`,
          controller.signal,
        );
        if (!stopped) {
          setHistory((previous) => ({
            ...data,
            candles: mergeCandles(
              mergeCandles(data.candles, bufferedCandles),
              previous?.interval === data.interval ? previous.candles : [],
            ),
          }));
          setHistoryError(
            data.freshness === "stale"
              ? "Showing the last available history."
              : "",
          );
        }
      } catch (e) {
        if (!stopped)
          setHistoryError(
            e instanceof Error ? e.message : "History is unavailable.",
          );
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    const loadMarket = async () => {
      try {
        const data = await api<Market>("/api/market", controller.signal);
        if (!stopped) {
          // A slower HTTP snapshot must not overwrite a more recent stream tick.
          setMarket((previous) =>
            previous &&
            Date.parse(previous.updatedAt) > Date.parse(data.updatedAt)
              ? previous
              : data,
          );
          setMarketError("");
          if (data.freshness === "stale") setConnection("stale");
        }
      } catch (e) {
        if (!stopped)
          setMarketError(
            e instanceof Error ? e.message : "Market price is unavailable.",
          );
      }
    };
    void loadHistory();
    void loadMarket();
    const connect = () => {
      if (stopped) return;
      setConnection(hasOpened ? "reconnecting" : "connecting");
      socket = new WebSocket("wss://api.hyperliquid.xyz/ws");
      socket.onopen = () => {
        if (stopped) {
          socket?.close();
          return;
        }
        const wasOpen = hasOpened;
        hasOpened = true;
        lastTick.current = Date.now();
        for (const subscription of [
          { type: "activeAssetCtx", coin: COIN },
          { type: "candle", coin: COIN, interval: intervals[range] },
        ]) {
          socket?.send(JSON.stringify({ method: "subscribe", subscription }));
        }
        if (wasOpen) {
          void loadHistory();
          void loadMarket();
        }
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (
            message.channel === "activeAssetCtx" &&
            message.data?.coin === COIN
          ) {
            const { markPx, prevDayPx, dayNtlVlm } = message.data.ctx || {};
            const price = Number(markPx),
              previousDay = Number(prevDayPx),
              volume = Number(dayNtlVlm);
            if (
              ![price, previousDay, volume].every(Number.isFinite) ||
              price <= 0 ||
              previousDay <= 0
            )
              return;
            lastTick.current = Date.now();
            attempts = 0;
            setMarket({
              source: "Hyperliquid",
              instrument: COIN,
              unit: "USD/barrel",
              price,
              previousDay,
              volume,
              change: (price / previousDay - 1) * 100,
              updatedAt: new Date().toISOString(),
              freshness: "fresh",
            });
            setConnection("live");
            setMarketError("");
          }
          if (message.channel === "candle") {
            const rows: Record<string, unknown>[] = Array.isArray(message.data)
              ? message.data
              : [message.data];
            const candles = rows
              .filter((row) => row?.s === COIN && row?.i === intervals[range])
              .map(parseCandle)
              .filter((c): c is NonNullable<typeof c> => c !== null);
            if (candles.length) {
              bufferedCandles = mergeCandles(bufferedCandles, candles);
              setHistory((previous) =>
                previous
                  ? {
                      ...previous,
                      candles: mergeCandles(previous.candles, candles),
                    }
                  : previous,
              );
            }
          }
        } catch {
          /* Ignore malformed or unrelated stream messages. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnection("reconnecting");
        reconnect = setTimeout(
          connect,
          Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)) +
            Math.random() * 500,
        );
      };
    };
    connect();
    const heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ method: "ping" }));
      if (!lastTick.current || Date.now() - lastTick.current > 45_000) {
        setConnection("stale");
        void loadMarket();
        if (socket?.readyState === WebSocket.OPEN) socket.close();
      }
    }, 15_000);
    const online = () => {
      socket?.close();
    };
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(reconnect);
      clearInterval(heartbeat);
      window.removeEventListener("online", online);
      socket?.close();
    };
  }, [range, revision]);
  return {
    market,
    history,
    connection,
    marketError,
    historyError,
    loading,
    retry,
  };
}
