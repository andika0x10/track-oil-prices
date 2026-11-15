import { normalizeObservations } from "../lib/data";
import type { Benchmark } from "../lib/types";
import { ServiceError, upstreamJson } from "./http";

interface BenchmarkEnv {
  EIA_API_KEY?: string;
  OUTLOOK?: Pick<KVNamespace, "get" | "put">;
}

/** Separate from the preserved statistical engine: no model runs on this path. */
export function createBenchmarkService() {
  const key = "brent-benchmark:browser-v1";
  let memory: Benchmark | undefined;
  let pending: Promise<Benchmark> | undefined;

  async function refresh(env: BenchmarkEnv): Promise<Benchmark> {
    if (!env.EIA_API_KEY)
      throw new ServiceError(
        "EIA_NOT_CONFIGURED",
        "Monthly Brent data is not connected yet. Live market prices remain available.",
      );
    const params = new URLSearchParams({
      api_key: env.EIA_API_KEY,
      frequency: "monthly",
      "data[0]": "value",
      "facets[series][]": "RBRTE",
      "sort[0][column]": "period",
      "sort[0][direction]": "asc",
      length: "5000",
    });
    const response = (await upstreamJson(
      `https://api.eia.gov/v2/petroleum/pri/spt/data/?${params}`,
    )) as { response?: { data?: unknown; total?: string | number } };
    if (Number(response.response?.total) > 5000)
      throw new ServiceError("INCOMPLETE_EIA_DATA", "Monthly Brent history could not be loaded in full.");
    let observations;
    try {
      observations = normalizeObservations(response.response?.data);
    } catch {
      throw new ServiceError("INVALID_EIA_DATA", "Monthly Brent history is incomplete. Try checking again.");
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(observations)),
    );
    const result: Benchmark = {
      source: "EIA",
      instrument: "Europe Brent spot benchmark",
      unit: "USD/barrel",
      observations,
      lastObservation: observations.at(-1)!.month,
      checkedAt: new Date().toISOString(),
      freshness: "fresh",
      fingerprint: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    };
    // Storage is optional. A failed cache write must not discard newly fetched data.
    try {
      await env.OUTLOOK?.put(key, JSON.stringify(result));
    } catch {
      console.warn(JSON.stringify({ event: "benchmark_cache_write_failed" }));
    }
    memory = result;
    return result;
  }

  async function load(env: BenchmarkEnv): Promise<Benchmark> {
    let cached = memory;
    if (!cached) {
      try {
        cached = (await env.OUTLOOK?.get<Benchmark>(key, "json")) ?? undefined;
      } catch { /* Fetch directly when optional storage is unavailable. */ }
    }
    // Coalesce page opens for one minute, rather than refreshing on a schedule.
    if (cached && Date.now() - Date.parse(cached.checkedAt) < 60_000) {
      memory = cached;
      return cached;
    }
    return refresh(env).catch((error: unknown) => {
      if (cached) return { ...cached, freshness: "stale" as const };
      throw error;
    });
  }
  function getBenchmark(env: BenchmarkEnv): Promise<Benchmark> {
    // Set pending before the first KV await, including simultaneous cold starts.
    pending ??= load(env).finally(() => { pending = undefined; });
    return pending;
  }
  return { getBenchmark };
}

export const { getBenchmark } = createBenchmarkService();
