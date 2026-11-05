export const COIN = "xyz:BRENTOIL";
export const HORIZONS = [3, 6, 12, 36, 60, 120, 180, 360] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Freshness = "fresh" | "stale";
export type Connection = "connecting" | "live" | "reconnecting" | "stale";
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface Market {
  source: "Hyperliquid";
  instrument: typeof COIN;
  unit: "USD/barrel";
  price: number;
  previousDay: number;
  change: number;
  volume: number;
  updatedAt: string;
  freshness: Freshness;
}
export interface History {
  source: "Hyperliquid";
  instrument: typeof COIN;
  unit: "USD/barrel";
  interval: string;
  candles: Candle[];
  updatedAt: string;
  freshness: Freshness;
}
export interface Observation {
  month: string;
  value: number;
}
export interface Projection {
  month: string;
  horizon: number;
  estimate: number;
  lower: number;
  upper: number;
  model?: string;
  scenario?: boolean;
  endMonth?: string;
}
export interface Scenarios {
  startMonth: string;
  anchorMonth: string;
  anchor: number;
  assumptions: { inflation: number; realGrowth: number[] };
  monthly: Projection[];
  annual: Projection[];
}
export interface DailySummary {
  month: string;
  lastDate: string;
  close: number;
  volatility: number;
}
export interface DriverValues {
  stocks: (number | null)[];
  production: (number | null)[];
}
export interface DriverSeries {
  series: string;
  name: string;
  unit: string;
  lastObservation: string;
  observations: Observation[];
}
export interface Metric {
  horizon: number;
  mae: number;
  baselineMae: number;
  rmse?: number;
  baselineRmse?: number;
  directionAccuracy?: number;
  meanIntervalWidth?: number | null;
  coverage: number | null;
  samples: number;
  coverageSamples: number;
  selectedModel?: string;
  validationMae?: number;
  validationBaselineMae?: number;
}
export interface ModelResult {
  version: string;
  model: string;
  points: Omit<Projection, "month">[];
  metrics: Metric[];
  minimumTrainingMonths: number;
  intervalLevel: number;
  validationWindowMonths?: number;
  evaluationMonths?: number;
  driverLagMonths?: number;
}
export interface Outlook {
  source: "EIA";
  instrument: "Europe Brent spot benchmark";
  unit: "USD/barrel";
  freshness: Freshness;
  generatedAt: string;
  checkedAt: string;
  lastObservation: string;
  observations: Observation[];
  drivers?: DriverSeries[];
  daily?: DailySummary[];
  scenarios?: Scenarios;
  projections: Projection[];
  model: Omit<ModelResult, "points">;
  performance: { initializationMs: number; computationMs: number };
}
export interface ApiFailure {
  error: { code: string; message: string };
  status: "unavailable";
}
