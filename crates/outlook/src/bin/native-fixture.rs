fn main() {
    let values = (0..240)
        .map(|i| 65.0 + (i as f64 / 9.0).sin() * 15.0 + i as f64 * 0.02)
        .collect();
    let output = brent_outlook::calculate(brent_outlook::Input {
        values,
        horizon: 38,
    })
    .unwrap();
    println!("{}", serde_json::to_string(&output).unwrap());
}
