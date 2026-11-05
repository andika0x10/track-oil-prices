import { addMonths, currentMonth } from "./data";
import type { Outlook, Projection } from "./types";

/** Dates are taken from the API snapshot so a stale cache never shifts its path. */
export function outlookPeriods(
  outlook: Outlook,
  horizon: number,
  now = new Date(),
): Projection[] {
  const start = addMonths(currentMonth(now), 1);
  const end = addMonths(currentMonth(now), horizon);
  if (horizon <= 36)
    return outlook.projections.filter(
      (p) => p.month >= start && p.month <= end,
    );
  const scenarios = outlook.scenarios;
  if (!scenarios || scenarios.startMonth !== start) return [];
  return horizon >= 180
    ? scenarios.annual.slice(0, horizon / 12)
    : scenarios.monthly.slice(0, horizon);
}
