use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub struct ScenarioPoint {
    pub horizon: usize,
    pub estimate: f64,
    pub lower: f64,
    pub upper: f64,
    pub scenario: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assumptions {
    inflation: f64,
    real_growth: [f64; 3],
}

#[derive(Serialize)]
pub struct ScenarioOutput {
    pub anchor: f64,
    pub assumptions: Assumptions,
    pub monthly: Vec<ScenarioPoint>,
    pub annual: Vec<ScenarioPoint>,
}

pub fn calculate(first: Vec<ScenarioPoint>) -> Result<ScenarioOutput, String> {
    if first.len() != 36
        || first.iter().enumerate().any(|(i, p)| {
            p.horizon != i + 1
                || ![p.estimate, p.lower, p.upper]
                    .iter()
                    .all(|v| v.is_finite() && *v > 0.0)
                || p.lower > p.estimate
                || p.estimate > p.upper
        })
    {
        return Err("Scenarios require 36 consecutive valid monthly projections".into());
    }
    let anchor = first[35].estimate;
    let mut monthly = first;
    for p in &mut monthly {
        p.scenario = false;
    }
    let inflation = 0.02_f64;
    let real_growth = [-0.02_f64, 0.0, 0.02];
    for horizon in 37..=360 {
        let years = (horizon - 36) as f64 / 12.0;
        let prices = real_growth.map(|g| anchor * ((1.0 + inflation) * (1.0 + g)).powf(years));
        monthly.push(ScenarioPoint {
            horizon,
            lower: prices[0],
            estimate: prices[1],
            upper: prices[2],
            scenario: true,
        });
    }
    let annual = monthly
        .chunks_exact(12)
        .enumerate()
        .map(|(i, rows)| ScenarioPoint {
            horizon: (i + 1) * 12,
            estimate: rows.iter().map(|p| p.estimate).sum::<f64>() / 12.0,
            lower: rows.iter().map(|p| p.lower).sum::<f64>() / 12.0,
            upper: rows.iter().map(|p| p.upper).sum::<f64>() / 12.0,
            scenario: i >= 3,
        })
        .collect();
    Ok(ScenarioOutput {
        anchor,
        assumptions: Assumptions {
            inflation,
            real_growth,
        },
        monthly,
        annual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_compounds_from_month_36_and_annual_means_match() {
        let points = (1..=36)
            .map(|horizon| ScenarioPoint {
                horizon,
                estimate: 80.0,
                lower: 60.0,
                upper: 100.0,
                scenario: false,
            })
            .collect();
        let result = calculate(points).unwrap();
        assert_eq!(result.monthly.len(), 360);
        assert_eq!(result.annual.len(), 30);
        assert!((result.monthly[47].estimate - 80.0 * 1.02).abs() < 1e-9);
        assert!((result.monthly[36].estimate - 80.0 * 1.02_f64.powf(1.0 / 12.0)).abs() < 1e-9);
        assert!(result
            .monthly
            .iter()
            .all(|p| p.lower <= p.estimate && p.estimate <= p.upper));
        for (year, rows) in result.annual.iter().zip(result.monthly.chunks_exact(12)) {
            assert!(
                (year.estimate - rows.iter().map(|p| p.estimate).sum::<f64>() / 12.0).abs() < 1e-9
            );
        }
        assert!(calculate(vec![]).is_err());
    }
}
