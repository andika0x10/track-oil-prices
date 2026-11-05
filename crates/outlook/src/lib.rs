use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const MIN_TRAIN: usize = 120;
const VERSION: &str = "brent-0.2.0";
mod adaptive;

#[derive(Deserialize)]
pub struct Input {
    pub values: Vec<f64>,
    pub horizon: usize,
    #[serde(default)]
    pub drivers: Option<Drivers>,
}

#[derive(Deserialize)]
pub struct Drivers {
    pub stocks: Vec<Option<f64>>,
    pub production: Vec<Option<f64>>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub horizon: usize,
    pub estimate: f64,
    pub lower: f64,
    pub upper: f64,
    pub model: &'static str,
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
    pub selected_model: &'static str,
    pub validation_mae: f64,
    pub validation_baseline_mae: f64,
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
    pub validation_window_months: usize,
    pub evaluation_months: usize,
    pub driver_lag_months: usize,
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
    adaptive::calculate(input)
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
            drivers: None,
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
            horizon: 36,
            drivers: None
        })
        .is_err());
        let mut values = vec![70.0; 240];
        values[12] = f64::NAN;
        assert!(calculate(Input {
            values,
            horizon: 36,
            drivers: None
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
            drivers: None,
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
        assert!(output
            .points
            .windows(2)
            .any(|pair| (pair[1].estimate - pair[0].estimate).abs() > 0.01));
        assert!(output.metrics.iter().all(|m| m.samples <= 60));
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
