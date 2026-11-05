import {
  addMonths,
  currentMonth,
  monthIndex,
  normalizeObservations,
} from "../lib/data";
import type { Outlook } from "../lib/types";
import { ServiceError, upstreamJson } from "./http";
import type { runModel } from "./model";

export interface OutlookEnv {
  EIA_API_KEY?: string;
  OUTLOOK?: Pick<KVNamespace, "get" | "put">;
}
type ModelEngine = (
  values: number[],
  horizon: number,
) => ReturnType<typeof runModel> | Promise<ReturnType<typeof runModel>>;
export function createOutlookService(
  engine: ModelEngine = async (values, horizon) => {
    const { runModel } = await import("./model");
    return runModel(values, horizon);
  },
) {
  const CACHE_KEY = "brent-outlook:0.1.0";
  let memory: Outlook | undefined;
  let pending: Promise<Outlook> | undefined;

  async function readCache(env: OutlookEnv): Promise<Outlook | undefined> {
    if (memory && Date.now() - Date.parse(memory.checkedAt) < 86400_000)
      return memory;
    try {
      return (await env.OUTLOOK?.get<Outlook>(CACHE_KEY, "json")) ?? memory;
    } catch {
      console.error(JSON.stringify({ event: "cache_read_failed" }));
      return memory;
    }
  }
  async function writeCache(env: OutlookEnv, result: Outlook) {
    if (env.OUTLOOK) await env.OUTLOOK.put(CACHE_KEY, JSON.stringify(result));
    memory = result;
  }
  async function refreshOutlook(
    env: OutlookEnv,
    cached?: Outlook,
  ): Promise<Outlook> {
    if (!env.EIA_API_KEY)
      throw new ServiceError(
        "EIA_NOT_CONFIGURED",
        "The benchmark outlook is not available yet. Live market prices remain available.",
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
      throw new ServiceError(
        "INCOMPLETE_EIA_DATA",
        "The benchmark history could not be loaded in full.",
      );
    let observations;
    try {
      observations = normalizeObservations(response.response?.data);
    } catch {
      throw new ServiceError(
        "INVALID_EIA_DATA",
        "The benchmark history is incomplete. The last valid outlook will be retained.",
      );
    }
    const lastObservation = observations.at(-1)!.month;
    const now = new Date().toISOString();
    const targetMonth = addMonths(currentMonth(), 36);
    if (
      cached &&
      cached.projections.at(-1)!.month >= targetMonth &&
      JSON.stringify(cached.observations) === JSON.stringify(observations)
    ) {
      const checked: Outlook = {
        ...cached,
        checkedAt: now,
        freshness: "fresh",
      };
      await writeCache(env, checked);
      return checked;
    }
    const horizon = monthIndex(targetMonth) - monthIndex(lastObservation);
    if (horizon < 36 || horizon > 60)
      throw new ServiceError(
        "EIA_TOO_OLD",
        "The latest benchmark data is too old to generate this outlook.",
      );
    let computed;
    try {
      computed = await engine(
        observations.map((row) => row.value),
        horizon,
      );
    } catch {
      throw new ServiceError(
        "MODEL_UNAVAILABLE",
        "The projection engine is temporarily unavailable. Try again shortly.",
      );
    }
    const { points, ...model } = computed.result;
    const result: Outlook = {
      source: "EIA",
      instrument: "Europe Brent spot benchmark",
      unit: "USD/barrel",
      freshness: "fresh",
      generatedAt: now,
      checkedAt: now,
      lastObservation,
      observations,
      model,
      performance: computed.performance,
      projections: points.map((point) => ({
        ...point,
        month: addMonths(lastObservation, point.horizon),
      })),
    };
    await writeCache(env, result);
    console.info(
      JSON.stringify({
        event: "outlook_refreshed",
        version: model.version,
        lastObservation,
      }),
    );
    return result;
  }
  async function getOutlook(env: OutlookEnv, force = false): Promise<Outlook> {
    const cached = await readCache(env);
    if (
      !force &&
      cached &&
      Date.now() - Date.parse(cached.checkedAt) < 86400_000
    )
      return cached;
    try {
      pending ??= refreshOutlook(env, cached).finally(() => {
        pending = undefined;
      });
      return await pending;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "outlook_refresh_failed",
          code:
            error instanceof ServiceError ? error.code : "CACHE_OR_MODEL_ERROR",
        }),
      );
      if (cached) return { ...cached, freshness: "stale" };
      throw error;
    }
  }
  return { getOutlook, refreshOutlook };
}
export const { getOutlook, refreshOutlook } = createOutlookService();
