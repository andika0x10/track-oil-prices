import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Explicit research fixture. Never imported or served by the production application.
const input = JSON.parse(readFileSync('docs/benchmarks/input.json', 'utf8'));
const modelId = process.env.BROWSER_MODEL_ID || 'chronos-bolt-small';
assert.ok(['chronos-bolt-small', 'chronos-bolt-tiny'].includes(modelId));
const storageKey = `brent:prediction:v1:${modelId}`;
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4321';
const live = process.env.BROWSER_MODEL_LIVE === '1';
const addMonth = (s,n) => { const [y,m] = s.split('-').map(Number); return new Date(Date.UTC(y,m-1+n)).toISOString().slice(0,7); };
const observations = input.values.map((value,i) => ({ month:addMonth(input.provenance.firstMonth,i), value }));
const benchmark = { source:'EIA', instrument:'Europe Brent spot benchmark', unit:'USD/barrel', observations,
  lastObservation:observations.at(-1).month, checkedAt:new Date().toISOString(), freshness:'fresh',
  fingerprint:createHash('sha256').update(JSON.stringify(observations)).digest('hex') };
mkdirSync('.qa', { recursive:true });
const context = await chromium.launchPersistentContext('.qa/model-profile', {
  headless:true, viewport:{ width:1440, height:1000 }, args:['--enable-unsafe-webgpu'],
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.addInitScript(({ storageKey, modelId }) => {
    // Force one real inference, while retaining the downloaded model across smoke runs.
    if (!sessionStorage.getItem('qa:prediction-reset')) {
      localStorage.removeItem(storageKey);
      sessionStorage.setItem('qa:prediction-reset','true');
    }
    localStorage.setItem('brent:preferred-model',modelId);
  }, { storageKey, modelId });
  await page.emulateMedia({ reducedMotion:'reduce' });
  let inputProvenance = input.provenance;
  if (live) {
    const response = await fetch(`${base}/api/benchmark`);
    assert.equal(response.status,200,'Live EIA data must be available');
    const data = await response.json();
    inputProvenance = { source:'Live EIA API', lastMonth:data.lastObservation, checkedAt:data.checkedAt };
  } else await page.route('**/api/benchmark',r => r.fulfill({ json:benchmark }));
  page.on('request',request => {
    if (/^https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//.test(request.url()))
      errors.push('Model assets must load from the application origin');
  });
  await page.goto(base, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => /Calculated in your browser|Prediction unavailable/.test(document.querySelector('.forecast-status')?.textContent || ''), {}, { timeout:200000 });
  assert.ok((await page.locator('.forecast-status').innerText()).includes('Calculated in your browser'), await page.locator('#outlook').innerText());
  const result = await page.evaluate(key => JSON.parse(localStorage.getItem(key)),storageKey);
  assert.equal(result.inference.modelId,modelId);
  assert.equal(result.inference.engine,'forecast-web');
  assert.ok(result.projections.length >= 36);
  assert.ok(result.projections.every(p => Number.isFinite(p.estimate) && p.lower <= p.estimate && p.estimate <= p.upper));
  for (const width of [1440,390]) {
    await page.setViewportSize({ width, height:1000 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('.price-chart').first().evaluate(el =>
      Math.abs(el.querySelector('svg').viewBox.baseVal.width-el.getBoundingClientRect().width)<1)).toBe(true);
    await page.locator('#outlook').scrollIntoViewIfNeeded();
    await page.screenshot({ path:`.qa/${modelId}-${width}.png`,fullPage:true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.locator('.month-cell').first().click();
  await expect(page.getByRole('dialog')).toContainText('actual coverage on Brent has not yet been established');
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(page.locator('.forecast-status')).toContainText('Saved calculation', { timeout:15000 });
  assert.deepEqual(errors,[]);
  const summary = { modelId, inputProvenance, inference:result.inference,
    performance:result.performance, projections:result.projections.length, cacheReuse:true, pageErrors:errors };
  writeFileSync(`.qa/${modelId}-runtime.json`,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
} finally { await context.close(); }
