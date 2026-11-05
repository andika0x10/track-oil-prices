import { build_scenarios } from "../generated/outlook/outlook.js";
import { addMonths } from "../lib/data";
import type { Projection, Scenarios } from "../lib/types";

/** Called after the shared Wasm engine has initialized and produced projections. */
export function createScenarios(
  projections: Projection[],
  startMonth: string,
): Scenarios {
  const first = Array.from({ length: 36 }, (_, i) => {
    const point = projections.find((p) => p.month === addMonths(startMonth, i));
    if (!point) throw new Error("Missing scenario anchor history");
    return { ...point, horizon: i + 1, scenario: false };
  });
  const output = JSON.parse(build_scenarios(JSON.stringify(first))) as {
    anchor: number;
    assumptions: Scenarios["assumptions"];
    monthly: Projection[];
    annual: Projection[];
  };
  return {
    ...output,
    startMonth,
    anchorMonth: addMonths(startMonth, 35),
    monthly: output.monthly.map((p, i) => ({
      ...p,
      month: addMonths(startMonth, i),
      model: i < 36 ? first[i].model : "Assumption-based scenario",
    })),
    annual: output.annual.map((p, i) => ({
      ...p,
      month: addMonths(startMonth, i * 12),
      endMonth: addMonths(startMonth, i * 12 + 11),
      model:
        i < 3
          ? "Annual average of monthly projections"
          : "Assumption-based scenario",
    })),
  };
}
