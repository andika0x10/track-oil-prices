import assert from "node:assert/strict";
const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4321";
const document = await fetch(base);
assert.equal(
  document.status,
  200,
  "Dashboard document must render successfully",
);
assert.ok((await document.text()).includes("Brent Outlook"));
for (const path of ["/api/market", "/api/history?range=ALL", "/api/outlook"]) {
  const response = await fetch(`${base}${path}`);
  const body = await response.json();
  if (path === "/api/outlook" && body.error?.code === "EIA_NOT_CONFIGURED") {
    console.log("Outlook safely unavailable: EIA_API_KEY is not configured.");
    continue;
  }
  assert.equal(response.status, 200, JSON.stringify(body.error));
  if (path === "/api/market") {
    assert.equal(body.instrument, "xyz:BRENTOIL");
    assert.ok(body.price > 0);
  }
  if (path.includes("history")) {
    assert.ok(body.candles.length > 0);
    assert.ok(body.candles.length <= 5000);
  }
  if (path === "/api/outlook") {
    assert.equal(body.source, "EIA");
    assert.ok(body.projections.length >= 36);
    assert.ok(
      body.projections.every(
        (p) => p.lower > 0 && p.lower <= p.estimate && p.estimate <= p.upper,
      ),
    );
    assert.equal(body.model.metrics.length, 4);
  }
  console.log(
    JSON.stringify({
      path,
      status: response.status,
      freshness: body.freshness,
      observations: body.candles?.length ?? body.observations?.length,
      model: body.model?.model,
      performance: body.performance,
    }),
  );
}
const invalid = await fetch(`${base}/api/history?range=INVALID`);
assert.equal(invalid.status, 400);
console.log("Runtime smoke checks passed.");
