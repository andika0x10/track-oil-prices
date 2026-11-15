import { test, expect, type Page } from "@playwright/test";
import { addMonths, currentMonth } from "../../src/lib/data";
import { createBrowserOutlook, forecastRequest } from "../../src/lib/forecast";
import type { Benchmark } from "../../src/lib/types";

const now = new Date(), month = currentMonth(now);
const benchmark: Benchmark = {
  source: "EIA", instrument: "Europe Brent spot benchmark", unit: "USD/barrel",
  checkedAt: now.toISOString(), freshness: "fresh", fingerprint: "browser-fixture-a",
  lastObservation: addMonths(month, -1),
  observations: Array.from({ length: 240 }, (_, i) => ({ month: addMonths(month, i - 240), value: 70 + Math.sin(i) * 5 })),
};
const horizon = forecastRequest(benchmark, "chronos-bolt-small", now).horizon;
const outlook = createBrowserOutlook(benchmark, {
  median: Array.from({ length: horizon }, (_, i) => 75 + i * .1),
  q10: Array.from({ length: horizon }, (_, i) => 60 - i * .2),
  q90: Array.from({ length: horizon }, (_, i) => 90 + i * .4),
}, "chronos-bolt-small", { backend: "wasm", dtype: "fp16", performance: { initializationMs: 1, computationMs: 10 } }, now);
const saved = JSON.stringify({ key: forecastRequest(benchmark, "chronos-bolt-small", now).key,
  generatedAt: outlook.generatedAt, projections: outlook.projections, inference: outlook.inference, performance: outlook.performance });

// Synthetic predictions and workers are confined to browser tests; production loads the real model.
const fakeWorker = `self.onmessage = ({data}) => {
  self.postMessage({type:'progress',progress:{loaded:25,total:100,cached:false}});
  setTimeout(() => {
    self.postMessage({type:'predicting'});
    const median = Array.from({length:data.horizon},(_,i)=>data.values.at(-1)+i*.1);
    self.postMessage({type:'result',forecast:{median,q10:median.map(n=>n-15),q90:median.map(n=>n+20)},
      runtime:{backend:'wasm',dtype:'fp16',performance:{initializationMs:1,computationMs:10}}});
  }, 500);
};`;

async function setup(page: Page, options: { seed?: boolean; available?: boolean } = {}) {
  const { seed = true, available = true } = options;
  if (seed) await page.addInitScript((value) => {
    if (!localStorage.getItem("brent:prediction:v1:chronos-bolt-small"))
      localStorage.setItem("brent:prediction:v1:chronos-bolt-small", value);
  }, saved);
  await page.route("**/api/benchmark", route => available
    ? route.fulfill({ json: benchmark })
    : route.fulfill({ status: 503, json: { status: "unavailable", error: { code: "EIA_NOT_CONFIGURED", message: "Monthly Brent data is not connected yet. Live market prices remain available." } } }));
  await page.route("**/api/outlook", () => { throw new Error("The active dashboard must not call the preserved Wasm API"); });
  await page.context().route(/forecast\.worker[^/]*\.(ts|js)(\?.*)?$/, r => r.fulfill({ contentType: "text/javascript", body: fakeWorker }));
  await page.route("**/api/market", route => route.fulfill({ json: {
    source: "Hyperliquid", instrument: "xyz:BRENTOIL", unit: "USD/barrel", price: 80,
    previousDay: 75, change: 6.67, volume: 1000000, updatedAt: now.toISOString(), freshness: "fresh",
  } }));
  await page.route("**/api/history?*", route => route.fulfill({ json: {
    source: "Hyperliquid", interval: "4h", freshness: "fresh", updatedAt: now.toISOString(),
    candles: Array.from({ length: 60 }, (_, i) => ({ time: now.getTime() - (60 - i) * 3600000,
      close: 75 + Math.sin(i / 5) * 3, open: 75, high: 80, low: 70, volume: 1 })),
  } }));
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", ws => {
    ws.onMessage(message => {
      if (JSON.parse(String(message)).subscription?.type === "activeAssetCtx")
        ws.send(JSON.stringify({ channel: "activeAssetCtx", data: { coin: "xyz:BRENTOIL", ctx: { markPx: "81", prevDayPx: "75", dayNtlVlm: "1000000" } } }));
    });
  });
}

for (const width of [360, 390, 768, 1440])
  for (const reducedMotion of ["reduce", "no-preference"] as const)
    test(`${width}px ${reducedMotion}: prediction, scenarios, keyboard and pagination`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion });
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (m.type() === "warning" && /GSAP|NaN|target.*not found/i.test(m.text())) errors.push(m.text()); });
      await setup(page);
      await page.goto("/");
      await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
      await expect(page.locator(".month-cell")).toHaveCount(12);
      await expect(page.locator(".forecast-status")).toContainText("Saved calculation");
      const first = await page.locator(".month-cell").first().innerText();
      await page.getByRole("button", { name: "36 month projection", exact: true }).click();
      await expect(page.locator(".month-cell")).toHaveCount(12);
      await page.getByRole("button", { name: "Show next 12 months", exact: true }).click();
      await expect(page.locator(".month-cell")).toHaveCount(24);
      await page.getByRole("button", { name: "3 month projection", exact: true }).click();
      await expect(page.locator(".month-cell")).toHaveCount(3);
      expect(await page.locator(".month-cell").first().innerText()).toBe(first);
      await page.locator(".month-cell").first().click();
      await expect(page.getByRole("dialog")).toContainText("Chronos-Bolt Small");
      await expect(page.getByRole("dialog")).toContainText("actual coverage on Brent has not yet been established");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".month-cell").first()).toBeFocused();
      await page.getByRole("button", { name: "5 year scenario", exact: true }).click();
      for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Show next 12 months", exact: true }).click();
      await expect(page.locator(".month-cell")).toHaveCount(48);
      await page.locator(".month-cell").nth(36).click();
      await expect(page.getByRole("dialog")).toContainText("Assumption-based scenarios, not a prediction interval");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "30 year scenario", exact: true }).click();
      await expect(page.locator(".month-cell")).toHaveCount(10);
      await page.getByRole("button", { name: "Show next 10 years", exact: true }).click();
      await expect(page.locator(".month-cell")).toHaveCount(20);
      await page.getByRole("button", { name: "How it works", exact: true }).click();
      await expect(page.locator(".method-body")).toContainText("Accuracy and range coverage on Brent have not yet been established");
      await expect(page.locator(".method-body")).toHaveCSS("opacity", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator("#outlook").scrollIntoViewIfNeeded();
      if (reducedMotion === "no-preference") {
        await expect(page.locator(".forecast-clip")).toHaveAttribute("transform", "matrix(1,0,0,1,0,0)");
        await expect(page.locator(".forecast-band").first()).toHaveCSS("opacity", "1");
      }
      expect(errors).toEqual([]);
      await page.screenshot({ path: `.qa/browser-${width}-${reducedMotion}.png` });
    });

test("missing EIA data leaves live market usable and does not load a model or empty calendar", async ({ page }) => {
  await setup(page, { seed: false, available: false });
  let workers = 0;
  page.on("worker", () => workers++);
  await page.goto("/");
  await expect(page.getByText("The outlook is not available yet.", { exact: true })).toBeVisible();
  await expect(page.locator(".month-cell")).toHaveCount(0);
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  expect(workers).toBe(0);
  await page.getByRole("button", { name: "1D", exact: true }).click();
  await expect(page.getByRole("button", { name: "1D", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("cold inference reports progress, writes cache, reuses unchanged input and recalculates revisions", async ({ page }) => {
  await setup(page, { seed: false });
  let workers = 0;
  page.on("worker", () => workers++);
  await page.goto("/");
  await expect(page.getByRole("progressbar", { name: "Prediction model download" })).toBeVisible();
  await expect(page.locator(".forecast-status")).toContainText("Calculated in your browser");
  await expect(page.locator(".month-cell")).toHaveCount(12);
  const initialWorkers = workers;
  await page.reload();
  await expect(page.locator(".forecast-status")).toContainText("Saved calculation");
  expect(workers).toBe(initialWorkers);
  await page.route("**/api/benchmark", r => r.fulfill({ json: { ...benchmark, fingerprint: "revised-b" } }));
  await page.getByRole("button", { name: "Check latest data", exact: true }).click();
  await expect(page.locator(".forecast-status")).toContainText("Calculated in your browser");
  expect(workers).toBe(initialWorkers + 1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("brent:prediction:v1:chronos-bolt-small")!).inference.inputFingerprint)).toBe("revised-b");
  await page.getByRole("button", { name: "Lightweight 18 MB", exact: true }).click();
  await expect(page.locator(".forecast-status")).toContainText("Chronos-Bolt Tiny");
});

test("failed refresh retains the previous valid prediction", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await expect(page.locator(".month-cell")).toHaveCount(12);
  const value = await page.locator(".month-cell").first().innerText();
  await page.route("**/api/benchmark", r => r.fulfill({ status: 503, json: { error: { message: "EIA is temporarily unavailable." } } }));
  await page.getByRole("button", { name: "Check latest data", exact: true }).click();
  await expect(page.locator(".forecast-status")).toContainText("Previous prediction retained");
  expect(await page.locator(".month-cell").first().innerText()).toBe(value);
});

test("failed model download can recover with the lightweight model", async ({ page }) => {
  await setup(page, { seed: false });
  let attempts = 0;
  await page.context().route(/forecast\.worker[^/]*\.(ts|js)(\?.*)?$/, r => r.fulfill({ contentType: "text/javascript", body: attempts++ === 0 ? `self.onmessage=()=>self.postMessage({type:'error',code:'LOAD_FAILED',message:'offline'});` : fakeWorker }));
  await page.goto("/");
  await expect(page.locator(".outlook-empty")).toContainText("The prediction model could not load");
  await page.getByRole("button", { name: "Lightweight 18 MB", exact: true }).click();
  await expect(page.locator(".forecast-status")).toContainText("Chronos-Bolt Tiny");
  await expect(page.locator(".month-cell")).toHaveCount(12);
});

test("real worker requests model config from the website origin, without relying on third-party CORS", async ({ page }) => {
  await setup(page, { seed: false });
  await page.context().unrouteAll();
  const configRequests: string[] = [];
  const externalRequests: string[] = [];
  await page.context().route("**/api/models/**/config.json", r => {
    configRequests.push(r.request().url());
    return r.fulfill({ status: 502, contentType: "application/json", body: '{"error":"test download failure"}' });
  });
  await page.context().route("https://huggingface.co/**", r => {
    externalRequests.push(r.request().url());
    return r.abort();
  });
  await page.goto("/");
  await expect(page.locator(".outlook-empty")).toContainText("The prediction model could not load");
  expect(configRequests).toHaveLength(1);
  expect(new URL(configRequests[0]).origin).toBe(new URL(page.url()).origin);
  expect(configRequests[0]).toContain("/api/models/chronos-bolt-small/");
  expect(externalRequests).toEqual([]);
});
