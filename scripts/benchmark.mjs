import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = process.argv[2];
let input;
if (file) input = JSON.parse(readFileSync(file, "utf8"));
else {
  const response = await fetch(
    `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4321"}/api/outlook`,
  );
  if (!response.ok)
    throw new Error(
      "A valid running outlook API is required, or pass a benchmark input JSON path.",
    );
  const outlook = await response.json();
  if (!outlook.daily?.length)
    throw new Error(
      "Daily EIA summaries unavailable; refusing an incomplete benchmark.",
    );
  const daily = new Map(outlook.daily.map((row) => [row.month, row]));
  const align = (rows) => {
    const m = new Map(rows.map((row) => [row.month, row.value]));
    return outlook.observations.map((row) => m.get(row.month) ?? null);
  };
  input = {
    values: outlook.observations.map((row) => row.value),
    horizon: 36,
    drivers: {
      stocks: align(outlook.drivers[0].observations),
      production: align(outlook.drivers[1].observations),
    },
    dailyClose: outlook.observations.map(
      (row) => daily.get(row.month)?.close ?? null,
    ),
    dailyVolatility: outlook.observations.map(
      (row) => daily.get(row.month)?.volatility ?? null,
    ),
    provenance: {
      source: "EIA revised observations; assumed two-month fundamental lag",
      fetchedAt: outlook.generatedAt,
      firstMonth: outlook.observations[0].month,
      lastMonth: outlook.lastObservation,
    },
  };
}
mkdirSync("docs/benchmarks", { recursive: true });
writeFileSync(
  "docs/benchmarks/input.json",
  JSON.stringify(input, null, 2) + "\n",
);
const result = spawnSync(
  "cargo",
  [
    "run",
    "--quiet",
    "--release",
    "--locked",
    "--manifest-path",
    "crates/outlook/Cargo.toml",
    "--bin",
    "benchmark",
  ],
  {
    input: JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  },
);
if (result.status !== 0) throw new Error(result.stderr || "Benchmark failed");
const report = JSON.parse(result.stdout);
writeFileSync(
  "docs/benchmarks/results.json",
  JSON.stringify({ provenance: input.provenance, ...report }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      computationMs: report.computationMs,
      results: report.experiments.map((e) => ({
        horizon: e.horizon,
        selected: e.selectedBeforeHoldout,
        promotionPassed: e.promotionPassed,
        productionModel: e.productionModel,
      })),
    },
    null,
    2,
  ),
);
