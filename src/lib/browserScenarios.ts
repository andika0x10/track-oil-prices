import { addMonths } from "./data";
import type { Projection, Scenarios } from "./types";

/** Browser equivalent of the retained Rust scenario builder. No inference here. */
export function createBrowserScenarios(projections: Projection[], startMonth: string): Scenarios {
  const byMonth = new Map(projections.map((point) => [point.month, point]));
  const monthly = Array.from({ length: 36 }, (_, i) => {
    const point = byMonth.get(addMonths(startMonth, i));
    if (!point || ![point.estimate, point.lower, point.upper].every(Number.isFinite) ||
        point.estimate <= 0 || point.lower > point.estimate || point.estimate > point.upper)
      throw new Error("Scenarios require 36 consecutive valid monthly predictions.");
    return { ...point, horizon: i + 1, scenario: false };
  });
  const anchor = monthly[35].estimate;
  const assumptions = { inflation: 0.02, realGrowth: [-0.02, 0, 0.02] };
  for (let i = 36; i < 360; i++) {
    const prices = assumptions.realGrowth.map((growth) =>
      anchor * ((1 + assumptions.inflation) * (1 + growth)) ** ((i - 35) / 12),
    );
    monthly.push({
      month: addMonths(startMonth, i), horizon: i + 1,
      lower: prices[0], estimate: prices[1], upper: prices[2],
      scenario: true, model: "Assumption-based scenario",
    });
  }
  const annual = Array.from({ length: 30 }, (_, i) => {
    const rows = monthly.slice(i * 12, i * 12 + 12);
    const average = (field: "estimate" | "lower" | "upper") =>
      rows.reduce((sum, point) => sum + point[field], 0) / 12;
    return {
      month: rows[0].month, endMonth: rows[11].month, horizon: (i + 1) * 12,
      estimate: average("estimate"), lower: average("lower"), upper: average("upper"),
      scenario: i >= 3,
      model: i < 3 ? "Annual average of monthly predictions" : "Assumption-based scenario",
    };
  });
  return { startMonth, anchorMonth: addMonths(startMonth, 35), anchor, assumptions, monthly, annual };
}
