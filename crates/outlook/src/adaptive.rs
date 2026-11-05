use super::{
    fit_at_origin, predict, quantile, Drivers, Input, Metric, Output, Point, MIN_TRAIN, VERSION,
};

const NAMES: [&str; 4] = [
    "Last-observation baseline",
    "Damped Holt trend",
    "Rolling mean reversion",
    "Supply & inventory ridge",
];
const VALIDATION: usize = 120;
const EVALUATION: usize = 60;
const MIN_ERRORS: usize = 24;
const FEATURES: usize = 6;
type Features = [f64; FEATURES];

#[derive(Clone, Copy)]
struct ErrorRecord {
    target: usize,
    absolute: f64,
    log_ratio: f64,
    covered: Option<bool>,
}

// Two-month publication lag. Only values available by this origin are read.
fn features(logs: &[f64], drivers: &Drivers, t: usize) -> Option<Features> {
    if t < 59 {
        return None;
    }
    let stocks = drivers.stocks.get(t - 2).copied().flatten()?;
    let old_stocks = drivers.stocks.get(t - 14).copied().flatten()?;
    let production = drivers.production.get(t - 2).copied().flatten()?;
    let old_production = drivers.production.get(t - 14).copied().flatten()?;
    let mean = logs[t - 59..=t].iter().sum::<f64>() / 60.0;
    Some([
        logs[t] - logs[t - 1],
        logs[t] - logs[t - 3],
        logs[t] - logs[t - 12],
        logs[t] - mean,
        (stocks / old_stocks).ln(),
        (production / old_production).ln(),
    ])
}

#[derive(Default, Clone)]
struct Ridge {
    n: usize,
    x: Features,
    xx: [[f64; FEATURES]; FEATURES],
    y: f64,
    xy: Features,
}
impl Ridge {
    fn update(&mut self, x: Features, y: f64, add: bool) {
        let sign = if add {
            self.n += 1;
            1.0
        } else {
            self.n -= 1;
            -1.0
        };
        self.y += sign * y;
        for i in 0..FEATURES {
            self.x[i] += sign * x[i];
            self.xy[i] += sign * x[i] * y;
            for j in 0..FEATURES {
                self.xx[i][j] += sign * x[i] * x[j];
            }
        }
    }
    fn forecast(&self, x: Features) -> Option<f64> {
        if self.n < 24 {
            return None;
        }
        let n = self.n as f64;
        let mean_y = self.y / n;
        let means = self.x.map(|v| v / n);
        let scales: Features = std::array::from_fn(|i| {
            let variance = (self.xx[i][i] / n - means[i].powi(2)).max(0.0);
            if variance < 1e-12 {
                1.0
            } else {
                variance.sqrt()
            }
        });
        let mut matrix = [[0.0; FEATURES + 1]; FEATURES];
        for i in 0..FEATURES {
            for j in 0..FEATURES {
                matrix[i][j] = (self.xx[i][j] - n * means[i] * means[j]) / (scales[i] * scales[j]);
            }
            matrix[i][i] += 10.0; // Fixed ridge penalty on standardized predictors.
            matrix[i][FEATURES] = (self.xy[i] - self.x[i] * mean_y) / scales[i];
        }
        for col in 0..FEATURES {
            let pivot = (col..FEATURES)
                .max_by(|&a, &b| matrix[a][col].abs().total_cmp(&matrix[b][col].abs()))?;
            matrix.swap(col, pivot);
            let divisor = matrix[col][col];
            if divisor.abs() < 1e-12 {
                return None;
            }
            for j in col..=FEATURES {
                matrix[col][j] /= divisor;
            }
            for i in 0..FEATURES {
                if i == col {
                    continue;
                }
                let multiplier = matrix[i][col];
                for j in col..=FEATURES {
                    matrix[i][j] -= multiplier * matrix[col][j];
                }
            }
        }
        let estimate = mean_y
            + (0..FEATURES)
                .map(|i| matrix[i][FEATURES] * (x[i] - means[i]) / scales[i])
                .sum::<f64>();
        estimate.is_finite().then_some(estimate)
    }
}

fn mean_reversion(logs: &[f64], origin: usize) -> (f64, f64) {
    let start = origin.saturating_sub(120);
    let previous = &logs[start..origin - 1];
    let next = &logs[start + 1..origin];
    let count = previous.len() as f64;
    let mean_x = previous.iter().sum::<f64>() / count;
    let mean_y = next.iter().sum::<f64>() / count;
    let variance = previous.iter().map(|x| (x - mean_x).powi(2)).sum::<f64>();
    if variance < 1e-12 {
        return (logs[origin - 1], 0.99);
    }
    let covariance = previous
        .iter()
        .zip(next)
        .map(|(x, y)| (x - mean_x) * (y - mean_y))
        .sum::<f64>();
    let phi = (covariance / variance).clamp(0.5, 0.995);
    ((mean_y - phi * mean_x) / (1.0 - phi), phi)
}

fn validation(
    candidate: &[ErrorRecord],
    baseline: &[ErrorRecord],
    origin: usize,
) -> Option<(f64, f64)> {
    let first_target = baseline.first()?.target;
    let mut candidate_sum = 0.0;
    let mut baseline_sum = 0.0;
    let mut n = 0;
    for error in candidate
        .iter()
        .filter(|e| e.target < origin && e.target >= origin.saturating_sub(VALIDATION))
    {
        let matched = baseline.get(error.target - first_target)?;
        candidate_sum += error.absolute;
        baseline_sum += matched.absolute;
        n += 1;
    }
    (n >= MIN_ERRORS).then(|| (candidate_sum / n as f64, baseline_sum / n as f64))
}
fn select(records: &[Vec<ErrorRecord>], candidates: &[Option<f64>; 4], origin: usize) -> usize {
    let mut selected = 0;
    let mut best_ratio = 0.98; // Require at least 2% lower validation MAE than baseline.
    for model in 1..NAMES.len() {
        if candidates[model].is_none() {
            continue;
        }
        if let Some((mae, baseline)) = validation(&records[model], &records[0], origin) {
            if baseline > 1e-10 && mae / baseline < best_ratio {
                selected = model;
                best_ratio = mae / baseline;
            }
        }
    }
    selected
}
fn interval(errors: &[ErrorRecord], origin: usize, estimate: f64) -> Option<(f64, f64)> {
    let logs: Vec<f64> = errors
        .iter()
        .filter(|e| e.target < origin && e.target >= origin.saturating_sub(VALIDATION))
        .map(|e| e.log_ratio)
        .collect();
    (logs.len() >= MIN_ERRORS).then(|| {
        (
            estimate * quantile(&logs, 0.1).min(0.0).exp(),
            estimate * quantile(&logs, 0.9).max(0.0).exp(),
        )
    })
}

pub(super) fn calculate(input: Input) -> Result<Output, String> {
    let values = &input.values;
    let n = values.len();
    let max_h = input.horizon;
    if n < 180 {
        return Err("At least 180 complete monthly observations are required".into());
    }
    if !(36..=60).contains(&max_h) {
        return Err("Horizon must be between 36 and 60 months".into());
    }
    if values
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.0 || *v > 100_000.0)
    {
        return Err("Prices must be finite and positive".into());
    }
    let logs: Vec<f64> = values.iter().map(|v| v.ln()).collect();
    if let Some(drivers) = &input.drivers {
        if drivers.stocks.len() != n
            || drivers.production.len() != n
            || drivers
                .stocks
                .iter()
                .chain(&drivers.production)
                .flatten()
                .any(|v| !v.is_finite() || *v <= 0.0)
        {
            return Err(
                "Driver observations must align with prices and contain positive values or null"
                    .into(),
            );
        }
        if (MIN_TRAIN - 1..n).any(|t| features(&logs, drivers, t).is_none()) {
            return Err("Lagged supply and inventory observations are incomplete".into());
        }
    }
    let xs: Vec<Option<Features>> = (0..n)
        .map(|t| input.drivers.as_ref().and_then(|d| features(&logs, d, t)))
        .collect();
    let mut ridge = vec![Ridge::default(); max_h];
    // At the first origin, only train on targets that have already occurred.
    for h in 1..=max_h {
        for t in 59..MIN_TRAIN.saturating_sub(h + 1) {
            if let Some(x) = xs[t] {
                ridge[h - 1].update(x, logs[t + h] - logs[t], true);
            }
        }
    }
    let mut records = vec![vec![Vec::<ErrorRecord>::new(); 4]; max_h];
    let mut policy = vec![Vec::<ErrorRecord>::new(); max_h];
    let mut points = Vec::new();
    let mut selected_models = Vec::new();
    for origin in MIN_TRAIN..=n {
        let trend = fit_at_origin(&logs, origin);
        let (equilibrium, phi) = mean_reversion(&logs, origin);
        for h in 1..=max_h {
            let t = origin - 1 - h;
            if let Some(x) = xs.get(t).copied().flatten() {
                ridge[h - 1].update(x, logs[t + h] - logs[t], true);
            }
            if let Some(old) = t.checked_sub(240) {
                if let Some(x) = xs[old] {
                    ridge[h - 1].update(x, logs[old + h] - logs[old], false);
                }
            }
            let last = values[origin - 1];
            let candidates = [
                Some(last),
                Some(predict(trend, h)),
                Some((equilibrium + phi.powi(h as i32) * (logs[origin - 1] - equilibrium)).exp()),
                xs[origin - 1]
                    .and_then(|x| ridge[h - 1].forecast(x))
                    .map(|change| last * change.exp()),
            ]
            .map(|value| value.filter(|v| v.is_finite() && *v > 0.0));
            let selected = select(&records[h - 1], &candidates, origin);
            let estimate = candidates[selected].unwrap_or(last);
            let bounds = interval(&policy[h - 1], origin, estimate);
            if origin == n {
                let (lower, upper) =
                    bounds.ok_or("Insufficient matured forecast errors for this horizon")?;
                if ![estimate, lower, upper].iter().all(|v| v.is_finite()) {
                    return Err("Non-finite projection".into());
                }
                points.push(Point {
                    horizon: h,
                    estimate,
                    lower,
                    upper,
                    model: NAMES[selected],
                });
                selected_models.push(selected);
            } else if origin + h <= n {
                let target = origin + h - 1;
                let actual = values[target];
                policy[h - 1].push(ErrorRecord {
                    target,
                    absolute: (actual - estimate).abs(),
                    log_ratio: (actual / estimate).ln(),
                    covered: bounds.map(|(lo, hi)| actual >= lo && actual <= hi),
                });
                for model in 0..NAMES.len() {
                    if let Some(price) = candidates[model] {
                        records[h - 1][model].push(ErrorRecord {
                            target,
                            absolute: (actual - price).abs(),
                            log_ratio: (actual / price).ln(),
                            covered: None,
                        });
                    }
                }
            }
        }
    }
    let mut metrics = Vec::new();
    for h in [3, 6, 12, 36] {
        let selected = selected_models[h - 1];
        let recent: Vec<_> = policy[h - 1]
            .iter()
            .filter(|e| e.target >= n.saturating_sub(EVALUATION))
            .collect();
        let baseline: Vec<_> = records[h - 1][0]
            .iter()
            .filter(|e| e.target >= n.saturating_sub(EVALUATION))
            .collect();
        let covered: Vec<_> = recent.iter().filter_map(|e| e.covered).collect();
        let (validation_mae, validation_baseline_mae) =
            validation(&records[h - 1][selected], &records[h - 1][0], n).unwrap_or((0.0, 0.0));
        metrics.push(Metric {
            horizon: h,
            mae: recent.iter().map(|e| e.absolute).sum::<f64>() / recent.len() as f64,
            baseline_mae: baseline.iter().map(|e| e.absolute).sum::<f64>() / baseline.len() as f64,
            coverage: (!covered.is_empty())
                .then(|| covered.iter().filter(|&&v| v).count() as f64 / covered.len() as f64),
            samples: recent.len(),
            coverage_samples: covered.len(),
            selected_model: NAMES[selected],
            validation_mae,
            validation_baseline_mae,
        });
    }
    Ok(Output {
        version: VERSION,
        model: if selected_models.iter().all(|&m| m == 0) {
            NAMES[0]
        } else {
            "Adaptive multi-model outlook"
        },
        points,
        metrics,
        minimum_training_months: MIN_TRAIN,
        interval_level: 0.8,
        validation_window_months: VALIDATION,
        evaluation_months: EVALUATION,
        driver_lag_months: if input.drivers.is_some() { 2 } else { 0 },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn future_errors_cannot_change_selection() {
        let baseline: Vec<_> = (0..80)
            .map(|target| ErrorRecord {
                target,
                absolute: 10.0,
                log_ratio: 0.0,
                covered: None,
            })
            .collect();
        let challenger: Vec<_> = baseline
            .iter()
            .map(|e| ErrorRecord {
                absolute: if e.target < 50 { 5.0 } else { 5000.0 },
                ..*e
            })
            .collect();
        let mut records = vec![baseline.clone(), challenger, baseline.clone(), baseline];
        assert_eq!(select(&records, &[Some(1.0); 4], 50), 1);
        for e in records[1].iter_mut().filter(|e| e.target >= 50) {
            e.absolute = 0.0;
        }
        assert_eq!(select(&records, &[Some(1.0); 4], 50), 1);
    }
    #[test]
    fn fundamental_features_respect_publication_lag() {
        let logs = vec![70.0f64.ln(); 180];
        let mut drivers = Drivers {
            stocks: vec![Some(400.0); 180],
            production: vec![Some(10.0); 180],
        };
        let before = features(&logs, &drivers, 150).unwrap();
        drivers.stocks[149] = Some(10000.0);
        drivers.production[150] = Some(50.0);
        assert_eq!(before, features(&logs, &drivers, 150).unwrap());
        drivers.stocks[148] = Some(500.0);
        assert_ne!(before, features(&logs, &drivers, 150).unwrap());
    }
}
