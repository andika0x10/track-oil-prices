use std::io::Read;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut json = String::new();
    std::io::stdin().read_to_string(&mut json)?;
    let input = serde_json::from_str(&json)?;
    let start = std::time::Instant::now();
    let result = brent_outlook::research::benchmark(input)?;
    println!(
        "{}",
        serde_json::to_string_pretty(
            &serde_json::json!({ "protocol": "frozen tuning before first holdout origin; 60 matched target months; pseudo-real-time revised data", "computationMs": start.elapsed().as_secs_f64()*1000.0, "experiments": result })
        )?
    );
    Ok(())
}
