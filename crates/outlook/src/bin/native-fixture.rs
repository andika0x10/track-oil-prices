fn main() {
    let values = (0..240)
        .map(|i| 65.0 + (i as f64 / 9.0).sin() * 15.0 + i as f64 * 0.02)
        .collect();
    let output = brent_outlook::calculate(brent_outlook::Input {
        values,
        horizon: 38,
        drivers: std::env::args()
            .any(|arg| arg == "--drivers")
            .then(|| brent_outlook::Drivers {
                stocks: (0..240)
                    .map(|i| (i < 238).then(|| 400.0 + (i as f64 / 7.0).cos() * 20.0))
                    .collect(),
                production: (0..240)
                    .map(|i| {
                        (i < 238).then(|| 10.0 + i as f64 * 0.01 + (i as f64 / 10.0).sin() * 0.2)
                    })
                    .collect(),
            }),
    })
    .unwrap();
    println!("{}", serde_json::to_string(&output).unwrap());
}
