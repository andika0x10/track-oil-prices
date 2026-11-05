//! Small, reproducible monthly experiment. No shuffled splits or future-error weights.
use crate::{adaptive, quantile, Input};
use serde::{Deserialize, Serialize};

const P: usize = 8;
const K: usize = 13;
const NAMES: [&str; K] = [
    "legacy",
    "monthly-no-change",
    "daily-close-no-change",
    "ridge-0.01",
    "ridge-0.1",
    "ridge-1",
    "elastic-0.001",
    "elastic-0.01",
    "elastic-0.1",
    "tuned-ridge",
    "tuned-elastic",
    "equal-ensemble",
    "inverse-mse-ensemble",
];

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchInput {
    #[serde(flatten)]
    pub history: Input,
    pub daily_close: Vec<Option<f64>>,
    pub daily_volatility: Vec<Option<f64>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub model: &'static str,
    pub mae: f64,
    pub rmse: f64,
    pub direction_accuracy: f64,
    pub coverage: Option<f64>,
    pub mean_interval_width: Option<f64>,
    pub samples: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Experiment {
    pub horizon: usize,
    pub selected_before_holdout: &'static str,
    pub promotion_passed: bool,
    pub production_model: &'static str,
    pub scores: Vec<Score>,
    pub current_estimate: f64,
    pub tuning_frozen_at_origin: usize,
    pub ridge_penalty: f64,
    pub elastic_penalty: f64,
    pub inverse_mse_weights: [f64; 5],
}
#[derive(Clone)]
struct Record {
    target: usize,
    actual: f64,
    last: f64,
    predictions: [Option<f64>; K],
    bounds: [Option<(f64, f64)>; K],
}

fn features(input: &ResearchInput, t: usize) -> Option<[f64; P]> {
    if t < 59 {
        return None;
    }
    let values = &input.history.values;
    let d = input.history.drivers.as_ref()?;
    let mean = values[t - 59..=t].iter().map(|v| v.ln()).sum::<f64>() / 60.0;
    Some([
        (values[t] / values[t - 1]).ln(),
        (values[t] / values[t - 3]).ln(),
        (values[t] / values[t - 12]).ln(),
        values[t].ln() - mean,
        (d.stocks[t - 2]? / d.stocks[t - 14]?).ln(),
        (d.production[t - 2]? / d.production[t - 14]?).ln(),
        (input.daily_close[t]? / values[t]).ln(),
        input.daily_volatility[t]?,
    ])
}

fn regularized(rows: &[([f64; P], f64)], x: [f64; P], penalty: f64, alpha: f64) -> Option<f64> {
    if rows.len() < 24 {
        return None;
    }
    let n = rows.len() as f64;
    let means: [f64; P] = std::array::from_fn(|j| rows.iter().map(|r| r.0[j]).sum::<f64>() / n);
    let scales: [f64; P] = std::array::from_fn(|j| {
        (rows
            .iter()
            .map(|r| (r.0[j] - means[j]).powi(2))
            .sum::<f64>()
            / n)
            .sqrt()
            .max(1e-8)
    });
    let mean_y = rows.iter().map(|r| r.1).sum::<f64>() / n;
    let mut xx = [[0.0; P]; P];
    let mut xy = [0.0; P];
    for (raw, y) in rows {
        let z: [f64; P] = std::array::from_fn(|j| (raw[j] - means[j]) / scales[j]);
        for j in 0..P {
            xy[j] += z[j] * (y - mean_y) / n;
            for k in 0..P {
                xx[j][k] += z[j] * z[k] / n;
            }
        }
    }
    let mut beta = [0.0; P];
    for _ in 0..100 {
        let mut delta = 0.0_f64;
        for j in 0..P {
            let residual = xy[j]
                - (0..P)
                    .filter(|&k| k != j)
                    .map(|k| xx[j][k] * beta[k])
                    .sum::<f64>();
            let shrunk = residual.signum() * (residual.abs() - penalty * alpha).max(0.0);
            let next = shrunk / (xx[j][j] + penalty * (1.0 - alpha)).max(1e-10);
            delta = delta.max((next - beta[j]).abs());
            beta[j] = next;
        }
        if delta < 1e-8 {
            break;
        }
    }
    let prediction = mean_y
        + (0..P)
            .map(|j| beta[j] * (x[j] - means[j]) / scales[j])
            .sum::<f64>();
    prediction.is_finite().then_some(prediction)
}

fn errors(records: &[Record], index: usize, origin: usize) -> Vec<(f64, f64)> {
    records
        .iter()
        .filter(|r| r.target < origin && r.target >= origin.saturating_sub(120))
        .filter_map(|r| r.predictions[index].map(|p| ((r.actual - p).abs(), (r.actual / p).ln())))
        .collect()
}
fn best(records: &[Record], indices: &[usize], origin: usize, default: usize) -> usize {
    indices
        .iter()
        .copied()
        .filter_map(|i| {
            let e = errors(records, i, origin);
            (e.len() >= 24).then(|| (i, e.iter().map(|r| r.0).sum::<f64>() / e.len() as f64))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|v| v.0)
        .unwrap_or(default)
}
fn weights(records: &[Record], origin: usize) -> [f64; 5] {
    [0, 1, 2, 9, 10].map(|i| {
        let e = errors(records, i, origin);
        if e.len() < 24 {
            1.0
        } else {
            1.0 / (e.iter().map(|r| r.0.powi(2)).sum::<f64>() / e.len() as f64).max(1e-8)
        }
    })
}

pub fn benchmark(input: ResearchInput) -> Result<Vec<Experiment>, String> {
    let n = input.history.values.len();
    if n < 300 || input.daily_close.len() != n || input.daily_volatility.len() != n {
        return Err(
            "Benchmark requires 300+ monthly observations and aligned daily summaries".into(),
        );
    }
    if input
        .daily_close
        .iter()
        .flatten()
        .any(|v| !v.is_finite() || *v <= 0.0)
        || input
            .daily_volatility
            .iter()
            .flatten()
            .any(|v| !v.is_finite() || *v < 0.0)
    {
        return Err("Invalid daily summaries".into());
    }
    let legacy = adaptive::calculate_audit(input.history.clone(), true)?;
    let xs: Vec<_> = (0..n).map(|t| features(&input, t)).collect();
    let mut experiments = Vec::new();
    for h in [3, 6, 12, 36] {
        let mut legacy_predictions = vec![None; n + 1];
        for p in legacy.audit.iter().filter(|p| p.horizon == h) {
            legacy_predictions[p.origin] = Some(p.estimate);
        }
        // Freeze tuning before the first forecast whose target enters the 60-month holdout.
        let freeze = n - 60 - h + 1;
        let mut frozen = None;
        let mut records: Vec<Record> = Vec::new();
        let mut current = [None; K];
        for origin in 120..=n {
            let choices = if let Some(config) = frozen {
                config
            } else {
                let config = (
                    best(&records, &[3, 4, 5], origin, 4),
                    best(&records, &[6, 7, 8], origin, 7),
                    weights(&records, origin),
                    best(&records, &[2, 9, 10, 11, 12], origin, 2),
                );
                if origin == freeze {
                    frozen = Some(config);
                }
                config
            };
            let last = input.history.values[origin - 1];
            let mut predictions = [None; K];
            predictions[0] = legacy_predictions[origin];
            predictions[1] = Some(last);
            predictions[2] = input.daily_close[origin - 1];
            if let Some(x) = xs[origin - 1] {
                let rows: Vec<_> = (59.max(origin.saturating_sub(240))..origin - h)
                    .filter_map(|t| {
                        xs[t].map(|f| {
                            (
                                f,
                                (input.history.values[t + h] / input.history.values[t]).ln(),
                            )
                        })
                    })
                    .collect();
                for (i, penalty) in [0.01, 0.1, 1.0].iter().enumerate() {
                    predictions[3 + i] =
                        regularized(&rows, x, *penalty, 0.0).map(|r| last * r.exp());
                }
                for (i, penalty) in [0.001, 0.01, 0.1].iter().enumerate() {
                    predictions[6 + i] =
                        regularized(&rows, x, *penalty, 0.5).map(|r| last * r.exp());
                }
            }
            predictions[9] = predictions[choices.0];
            predictions[10] = predictions[choices.1];
            let components = [0, 1, 2, 9, 10];
            if components.iter().all(|&i| predictions[i].is_some()) {
                predictions[11] = Some(
                    components
                        .iter()
                        .map(|&i| predictions[i].unwrap())
                        .sum::<f64>()
                        / 5.0,
                );
                predictions[12] = Some(
                    components
                        .iter()
                        .enumerate()
                        .map(|(j, &i)| predictions[i].unwrap() * choices.2[j])
                        .sum::<f64>()
                        / choices.2.iter().sum::<f64>(),
                );
            }
            for p in &mut predictions {
                *p = p.filter(|v| v.is_finite() && *v > 0.0);
            }
            if origin == n {
                current = predictions;
            }
            if origin + h > n {
                continue;
            }
            let bounds = std::array::from_fn(|i| {
                let past: Vec<_> = errors(&records, i, origin).iter().map(|e| e.1).collect();
                predictions[i].and_then(|p| {
                    (past.len() >= 24).then(|| {
                        (
                            p * quantile(&past, 0.1).min(0.0).exp(),
                            p * quantile(&past, 0.9).max(0.0).exp(),
                        )
                    })
                })
            });
            records.push(Record {
                target: origin + h - 1,
                actual: input.history.values[origin + h - 1],
                last,
                predictions,
                bounds,
            });
        }
        let selected = frozen.unwrap().3;
        let mut scores = Vec::new();
        // Compare all methods on exactly the same targets, including daily-data availability.
        let common: Vec<_> = records
            .iter()
            .filter(|r| r.target >= n - 60 && r.predictions.iter().all(Option::is_some))
            .collect();
        if common.len() != 60 {
            return Err(format!(
                "Horizon {h}: need all 60 matched holdout targets, got {}",
                common.len()
            ));
        }
        for i in [0, 1, 2, 9, 10, 11, 12] {
            let count = common.len() as f64;
            let bounds: Vec<_> = common
                .iter()
                .filter_map(|r| r.bounds[i].map(|b| (b, r.actual)))
                .collect();
            scores.push(Score {
                model: NAMES[i],
                samples: common.len(),
                mae: common
                    .iter()
                    .map(|r| (r.actual - r.predictions[i].unwrap()).abs())
                    .sum::<f64>()
                    / count,
                rmse: (common
                    .iter()
                    .map(|r| (r.actual - r.predictions[i].unwrap()).powi(2))
                    .sum::<f64>()
                    / count)
                    .sqrt(),
                direction_accuracy: common
                    .iter()
                    .filter(|r| {
                        crate::direction(r.actual - r.last)
                            == crate::direction(r.predictions[i].unwrap() - r.last)
                    })
                    .count() as f64
                    / count,
                coverage: (!bounds.is_empty()).then(|| {
                    bounds
                        .iter()
                        .filter(|((lo, hi), actual)| actual >= lo && actual <= hi)
                        .count() as f64
                        / bounds.len() as f64
                }),
                mean_interval_width: (!bounds.is_empty()).then(|| {
                    bounds.iter().map(|((lo, hi), _)| hi - lo).sum::<f64>() / bounds.len() as f64
                }),
            });
        }
        let candidate = scores.iter().find(|s| s.model == NAMES[selected]).unwrap();
        let old = &scores[0];
        let baseline = scores[1..3]
            .iter()
            .min_by(|a, b| a.mae.total_cmp(&b.mae))
            .unwrap();
        let passed = candidate.mae <= old.mae * 0.95
            && candidate.mae <= baseline.mae * 0.95
            && candidate.rmse <= old.rmse
            && candidate.rmse <= baseline.rmse;
        let config = frozen.unwrap();
        experiments.push(Experiment {
            horizon: h,
            selected_before_holdout: NAMES[selected],
            promotion_passed: passed,
            production_model: if passed { NAMES[selected] } else { "legacy" },
            current_estimate: current[if passed { selected } else { 0 }]
                .ok_or("Current forecast unavailable")?,
            tuning_frozen_at_origin: freeze,
            ridge_penalty: [0.01, 0.1, 1.0][config.0 - 3],
            elastic_penalty: [0.001, 0.01, 0.1][config.1 - 6],
            inverse_mse_weights: config.2.map(|w| w / config.2.iter().sum::<f64>()),
            scores,
        });
    }
    Ok(experiments)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unobserved_targets_do_not_affect_selection_or_weights() {
        let record = |target, actual| Record {
            target,
            actual,
            last: 70.0,
            predictions: [Some(70.0); K],
            bounds: [None; K],
        };
        let mut records: Vec<_> = (0..60).map(|t| record(t, 71.0)).collect();
        let w = weights(&records, 50);
        let b = best(&records, &[3, 4, 5], 50, 4);
        for r in records.iter_mut().filter(|r| r.target >= 50) {
            r.actual = 10000.0;
            r.predictions[3] = Some(1.0);
        }
        assert_eq!(w, weights(&records, 50));
        assert_eq!(b, best(&records, &[3, 4, 5], 50, 4));
    }
    #[test]
    fn regression_standardizes_using_training_only() {
        let rows: Vec<_> = (0..100).map(|i| ([i as f64; P], i as f64 * 0.01)).collect();
        assert!(regularized(&rows, [50.0; P], 0.1, 0.0).unwrap().is_finite());
        assert!(regularized(&[], [0.0; P], 0.1, 0.5).is_none());
    }
    #[test]
    fn future_prices_do_not_change_pre_holdout_choices() {
        let n = 360;
        let values: Vec<_> = (0..n)
            .map(|i| 70.0 + (i as f64 / 10.0).sin() * 8.0)
            .collect();
        let mut input = ResearchInput {
            daily_close: values.iter().map(|v| Some(v * 1.01)).collect(),
            daily_volatility: vec![Some(0.01); n],
            history: Input {
                values,
                horizon: 36,
                drivers: Some(crate::Drivers {
                    stocks: vec![Some(400.0); n],
                    production: vec![Some(10.0); n],
                }),
            },
        };
        let before = benchmark(input.clone()).unwrap();
        for t in n - 60..n {
            input.history.values[t] *= 2.0;
            input.daily_close[t] = Some(100.0);
        }
        let after = benchmark(input).unwrap();
        for (a, b) in before.iter().zip(after) {
            assert_eq!(a.selected_before_holdout, b.selected_before_holdout);
            assert_eq!(a.ridge_penalty, b.ridge_penalty);
            assert_eq!(a.elastic_penalty, b.elastic_penalty);
            assert_eq!(a.inverse_mse_weights, b.inverse_mse_weights);
        }
        assert_eq!(crate::direction(0.0), 0);
    }
}
