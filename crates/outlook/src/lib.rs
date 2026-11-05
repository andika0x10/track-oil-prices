use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const MIN_TRAIN: usize = 120;
const VERSION: &str = "brent-0.1.0";

#[derive(Deserialize)]
pub struct Input {
    pub values: Vec<f64>,
    pub horizon: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub horizon: usize,
    pub estimate: f64,
    pub lower: f64,
    pub upper: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    pub horizon: usize,
    pub mae: f64,
    pub baseline_mae: f64,
    pub coverage: Option<f64>,
    pub samples: usize,
    pub coverage_samples: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub version: &'static str,
    pub model: &'static str,
    pub points: Vec<Point>,
    pub metrics: Vec<Metric>,
    pub minimum_training_months: usize,
    pub interval_level: f64,
}

#[derive(Clone, Copy)]
struct Fit {
    level: f64,
    trend: f64,
    phi: f64,
    loss: f64,
}

fn fit(y: &[f64]) -> Fit {
    let mut best = Fit {
        level: y[0],
        trend: 0.0,
        phi: 0.8,
        loss: f64::INFINITY,
    };
    for alpha in [0.2, 0.5, 0.8] {
        for beta in [0.05, 0.2, 0.5] {
            for phi in [0.8, 0.9, 0.98] {
                let mut level = y[0];
                let mut trend = 0.0;
                let mut loss = 0.0;
                for (i, &value) in y.iter().enumerate().skip(1) {
                    let predicted = level + phi * trend;
                    if i >= 12 {
                        loss += (value - predicted).powi(2);
                    }
                    let previous = level;
                    level = alpha * value + (1.0 - alpha) * predicted;
                    trend = beta * (level - previous) + (1.0 - beta) * phi * trend;
                }
                if loss < best.loss {
                    best = Fit {
                        level,
                        trend,
                        phi,
                        loss,
                    };
                }
            }
        }
    }
    best
}

fn predict(f: Fit, h: usize) -> f64 {
    let damping = f.phi * (1.0 - f.phi.powi(h as i32)) / (1.0 - f.phi);
    (f.level + damping * f.trend).exp()
}

fn fit_at_origin(logs: &[f64], origin: usize) -> Fit {
    fit(&logs[..origin])
}

fn quantile(values: &[f64], p: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let position = p * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower as f64)
}

pub fn calculate(input: Input) -> Result<Output, String> {
    let values = input.values;
    if values.len() < 180 {
        return Err("At least 180 complete monthly observations are required".into());
    }
    if !(36..=60).contains(&input.horizon) {
        return Err("Horizon must be between 36 and 60 months".into());
    }
    if values
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.0 || *v > 100_000.0)
    {
        return Err("Prices must be finite and positive".into());
    }
    let logs: Vec<f64> = values.iter().map(|v| v.ln()).collect();
    let max_h = input.horizon;
    // Each residual is a log ratio. These make the interval scale with prices.
    let mut residuals = vec![vec![Vec::<f64>::new(); max_h]; 2];
    let mut absolute_errors = vec![vec![Vec::<f64>::new(); max_h]; 2];
    let mut hits = vec![vec![0usize; max_h]; 2];
    let mut evaluated = vec![vec![0usize; max_h]; 2];
    // Separate issued residuals from matured ones. At an origin, only residuals
    // whose targets have already occurred may calibrate the next interval.
    let mut pending: Vec<Vec<Vec<(usize, f64)>>> = vec![vec![Vec::new(); max_h]; 2];
    for origin in MIN_TRAIN..values.len() {
        let fitted = fit_at_origin(&logs, origin);
        for h in 1..=max_h.min(values.len() - origin) {
            let actual = values[origin + h - 1];
            let candidates = [values[origin - 1], predict(fitted, h)];
            for model in 0..2 {
                let matured: Vec<f64> = pending[model][h - 1]
                    .iter()
                    .filter(|(target, _)| *target < origin)
                    .map(|(_, error)| *error)
                    .collect();
                if matured.len() >= 24 {
                    let lo = candidates[model] * quantile(&matured, 0.1).min(0.0).exp();
                    let hi = candidates[model] * quantile(&matured, 0.9).max(0.0).exp();
                    evaluated[model][h - 1] += 1;
                    if actual >= lo && actual <= hi {
                        hits[model][h - 1] += 1;
                    }
                }
                let error = (actual / candidates[model]).ln();
                pending[model][h - 1].push((origin + h - 1, error));
                residuals[model][h - 1].push(error);
                absolute_errors[model][h - 1].push((actual - candidates[model]).abs());
            }
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
    let score = [3, 6, 12, 36]
        .iter()
        .map(|&h| {
            let baseline = mean(&absolute_errors[0][h - 1]);
            let candidate = mean(&absolute_errors[1][h - 1]);
            if baseline < 1e-10 {
                if candidate < 1e-10 {
                    1.0
                } else {
                    f64::INFINITY
                }
            } else {
                candidate / baseline
            }
        })
        .sum::<f64>()
        / 4.0;
    let selected = usize::from(score < 1.0);
    let fitted = fit(&logs);
    let mut points = Vec::new();
    for h in 1..=max_h {
        let errors = &residuals[selected][h - 1];
        if errors.len() < 24 {
            return Err("Insufficient out-of-sample history for this horizon".into());
        }
        let estimate = if selected == 0 {
            *values.last().unwrap()
        } else {
            predict(fitted, h)
        };
        // Include the central estimate even when the historical error is biased.
        let lower = estimate * quantile(errors, 0.1).min(0.0).exp();
        let upper = estimate * quantile(errors, 0.9).max(0.0).exp();
        if ![estimate, lower, upper].iter().all(|v| v.is_finite()) {
            return Err("Model produced a non-finite projection".into());
        }
        points.push(Point {
            horizon: h,
            estimate,
            lower,
            upper,
        });
    }
    let metrics = [3, 6, 12, 36]
        .iter()
        .map(|&h| Metric {
            horizon: h,
            mae: mean(&absolute_errors[selected][h - 1]),
            baseline_mae: mean(&absolute_errors[0][h - 1]),
            coverage: if evaluated[selected][h - 1] == 0 {
                None
            } else {
                Some(hits[selected][h - 1] as f64 / evaluated[selected][h - 1] as f64)
            },
            samples: absolute_errors[selected][h - 1].len(),
            coverage_samples: evaluated[selected][h - 1],
        })
        .collect();
    Ok(Output {
        version: VERSION,
        model: if selected == 0 {
            "Last-observation baseline"
        } else {
            "Damped Holt trend (log price)"
        },
        points,
        metrics,
        minimum_training_months: MIN_TRAIN,
        interval_level: 0.8,
    })
}

#[wasm_bindgen]
pub fn forecast(json: &str) -> Result<String, JsError> {
    let input: Input = serde_json::from_str(json).map_err(|e| JsError::new(&e.to_string()))?;
    let output = calculate(input).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&output).map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constant_series_selects_baseline() {
        let output = calculate(Input {
            values: vec![70.0; 240],
            horizon: 36,
        })
        .unwrap();
        assert_eq!(output.model, "Last-observation baseline");
        assert!(output
            .points
            .iter()
            .all(|p| (p.estimate - 70.0).abs() < 1e-8));
    }
    #[test]
    fn rejects_bad_data() {
        assert!(calculate(Input {
            values: vec![70.0; 120],
            horizon: 36
        })
        .is_err());
        let mut values = vec![70.0; 240];
        values[12] = f64::NAN;
        assert!(calculate(Input {
            values,
            horizon: 36
        })
        .is_err());
    }
    #[test]
    fn intervals_and_metrics_are_finite() {
        let values = (0..300)
            .map(|i| 65.0 + (i as f64 / 9.0).sin() * 15.0 + i as f64 * 0.02)
            .collect();
        let output = calculate(Input {
            values,
            horizon: 40,
        })
        .unwrap();
        assert_eq!(output.points.len(), 40);
        assert!(output
            .points
            .iter()
            .all(|p| p.lower > 0.0 && p.lower <= p.estimate && p.estimate <= p.upper));
        assert!(output
            .metrics
            .iter()
            .all(|m| m.mae.is_finite() && m.samples > 0));
    }
    #[test]
    fn fit_never_reads_future() {
        let prefix: Vec<f64> = (0..160).map(|i| (60.0 + i as f64 / 10.0).ln()).collect();
        let first = predict(fit_at_origin(&prefix, 160), 36);
        let mut all = prefix.clone();
        all.extend(vec![500.0; 40]);
        assert_eq!(first, predict(fit_at_origin(&all, 160), 36));
    }
}
