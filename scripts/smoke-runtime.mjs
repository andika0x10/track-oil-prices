import assert from 'node:assert/strict';
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4321';
const document = await fetch(base);
assert.equal(document.status,200);
assert.ok((await document.text()).includes('Brent Outlook'));
for (const path of ['/api/market','/api/history?range=ALL','/api/benchmark']) {
  const response = await fetch(`${base}${path}`);
  const body = await response.json();
  if (path === '/api/benchmark' && body.error?.code === 'EIA_NOT_CONFIGURED') {
    console.log('Benchmark safely unavailable: configure EIA_API_KEY to use current EIA data.');
    continue;
  }
  assert.equal(response.status,200,JSON.stringify(body.error));
  if (path === '/api/market') { assert.equal(body.instrument,'xyz:BRENTOIL'); assert.ok(body.price>0); }
  if (path.includes('history')) assert.ok(body.candles.length>0 && body.candles.length<=5000);
  if (path === '/api/benchmark') {
    assert.equal(body.source,'EIA');
    assert.ok(body.observations.length>=180);
    assert.equal(body.lastObservation,body.observations.at(-1).month);
    assert.match(body.fingerprint,/^[a-f0-9]{64}$/);
    assert.equal(body.projections,undefined,'The data API must not run inference');
    assert.equal(body.model,undefined);
  }
  console.log(JSON.stringify({ path,status:response.status,freshness:body.freshness }));
}
assert.equal((await fetch(`${base}/api/history?range=INVALID`)).status,400);
console.log('Runtime smoke checks passed.');
