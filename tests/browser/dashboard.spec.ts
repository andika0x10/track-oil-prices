import { test, expect, type Page } from "@playwright/test";
import { addMonths, currentMonth } from "../../src/lib/data";
import { initSync } from "../../src/generated/outlook/outlook.js";
import { readFileSync } from "node:fs";
import { createScenarios } from "../../src/server/scenarios";
initSync({
  module: new WebAssembly.Module(
    readFileSync("src/generated/outlook/outlook_bg.wasm"),
  ),
});
test.use({ video: "on" });

// Synthetic fixtures exist only in this test file. They are never imported by the app.
const now = new Date(),
  month = currentMonth(now);
const projections = Array.from({ length: 38 }, (_, i) => ({
  month: addMonths(month, i),
  horizon: i + 1,
  estimate: 75 + i * 0.1,
  lower: 60 - i * 0.2,
  upper: 90 + i * 0.4,
  model: "Rolling mean reversion",
}));
const outlook = {
  source: "EIA",
  instrument: "Europe Brent spot benchmark",
  unit: "USD/barrel",
  freshness: "fresh",
  generatedAt: now.toISOString(),
  checkedAt: now.toISOString(),
  lastObservation: addMonths(month, -1),
  observations: Array.from({ length: 12 }, (_, i) => ({
    month: addMonths(month, i - 12),
    value: 70 + Math.sin(i) * 5,
  })),
  projections,
  scenarios: createScenarios(projections, addMonths(month, 1)),
  model: {
    version: "test-fixture",
    model: "Adaptive multi-model outlook",
    intervalLevel: 0.8,
    minimumTrainingMonths: 120,
    metrics: [
      {
        horizon: 12,
        mae: 8,
        baselineMae: 9,
        coverage: 0.76,
        samples: 100,
        coverageSamples: 60,
      },
    ],
  },
  performance: { initializationMs: 1, computationMs: 10 },
};
async function setup(page: Page, available = true) {
  await page.route("**/api/market", (route) =>
    route.fulfill({
      json: {
        source: "Hyperliquid",
        instrument: "xyz:BRENTOIL",
        price: 80,
        previousDay: 75,
        change: 6.67,
        volume: 1000000,
        updatedAt: now.toISOString(),
        freshness: "fresh",
      },
    }),
  );
  await page.route("**/api/history?*", (route) =>
    route.fulfill({
      json: {
        interval: "4h",
        source: "Hyperliquid",
        freshness: "fresh",
        updatedAt: now.toISOString(),
        candles: Array.from({ length: 60 }, (_, i) => ({
          time: now.getTime() - (60 - i) * 3600000,
          close: 75 + Math.sin(i / 5) * 3,
          open: 75,
          high: 80,
          low: 70,
          volume: 1,
        })),
      },
    }),
  );
  await page.route("**/api/outlook", (route) =>
    available
      ? route.fulfill({ json: outlook })
      : route.fulfill({
          status: 503,
          json: {
            status: "unavailable",
            error: {
              code: "EIA_NOT_CONFIGURED",
              message:
                "The benchmark outlook is not available yet. Live market prices remain available.",
            },
          },
        }),
  );
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.subscription?.type === "activeAssetCtx")
        ws.send(
          JSON.stringify({
            channel: "activeAssetCtx",
            data: {
              coin: "xyz:BRENTOIL",
              ctx: { markPx: "81", prevDayPx: "75", dayNtlVlm: "1000000" },
            },
          }),
        );
    });
  });
}
test.describe("extended outlook", () => {
  for (const width of [360, 390, 768, 1440])
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      test(`${width}px ${reducedMotion}: monthly and annual scenarios`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (
            m.type() === "warning" &&
            /GSAP|NaN|target.*not found/i.test(m.text())
          )
            errors.push(m.text());
        });
        await setup(page);
        await page.goto("/");
        await page
          .getByRole("button", { name: "60 month projection", exact: true })
          .click();
        await expect(page.locator(".month-cell")).toHaveCount(60);
        const first = await page.locator(".month-cell").first().innerText();
        await page
          .getByRole("button", { name: "120 month projection", exact: true })
          .click();
        await expect(page.locator(".month-cell")).toHaveCount(120);
        expect(await page.locator(".month-cell").first().innerText()).toBe(
          first,
        );
        const scenario = page.locator(".month-cell").nth(36);
        await scenario.click();
        await expect(page.getByRole("dialog")).toContainText(
          "Assumption-based scenarios, not a prediction interval",
        );
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(scenario).toBeFocused();
        for (const years of [15, 30]) {
          await page
            .getByRole("button", {
              name: `${years} year scenario`,
              exact: true,
            })
            .click();
          await expect(page.locator(".month-cell")).toHaveCount(years);
          await expect(
            page.getByRole("heading", { name: "Year by year" }),
          ).toBeVisible();
        }
        await page.locator(".month-cell").nth(3).click();
        await expect(page.getByRole("dialog")).toContainText("Annual average");
        await page.keyboard.press("Escape");
        for (const months of [3, 120, 60, 12])
          await page
            .getByRole("button", {
              name: `${months} month projection`,
              exact: true,
            })
            .click();
        await expect(page.locator(".month-cell")).toHaveCount(12);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.locator("#outlook").scrollIntoViewIfNeeded();
        if (reducedMotion === "no-preference") {
          await expect(page.locator(".forecast-clip")).toHaveAttribute(
            "transform",
            "matrix(1,0,0,1,0,0)",
          );
          await expect(page.locator(".forecast-band").first()).toHaveCSS(
            "opacity",
            "1",
          );
        }
        await page.screenshot({
          path: `.qa/extended-${width}-${reducedMotion}.png`,
        });
        expect(errors).toEqual([]);
      });
    }
});
for (const width of [360, 390, 768, 1440]) {
  test(`dashboard and month detail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "The price of now." }),
    ).toBeVisible();
    await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
    await expect(page.locator(".month-cell")).toHaveCount(12);
    await page
      .getByRole("button", { name: "36 month projection", exact: true })
      .click();
    await expect(page.locator(".month-cell")).toHaveCount(36);
    const text = await page.locator(".month-cell").first().innerText();
    await page
      .getByRole("button", { name: "3 month projection", exact: true })
      .click();
    await expect(page.locator(".month-cell")).toHaveCount(3);
    expect(await page.locator(".month-cell").first().innerText()).toBe(text);
    await page.locator(".month-cell").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Rolling mean reversion", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "How it works" }).click();
    await expect(
      page.getByText("Forward-tested strategy performance"),
    ).toBeVisible();
    await expect(page.locator(".method-body")).toHaveCSS("opacity", "1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.qa/dashboard-${width}.png`,
      fullPage: true,
    });
  });
}
test("missing benchmark data keeps live market usable and never fabricates estimates", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page, false);
  await page.goto("/");
  await expect(
    page.getByText("The outlook is not available yet.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".month-cell strong").first()).toHaveText("—");
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1D", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1D", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: ".qa/unavailable-mobile.png", fullPage: true });
});
test("reconnect refills history and duplicate streamed candles replace rather than append", async ({
  page,
}) => {
  await setup(page);
  let connections = 0,
    historyRequests = 0;
  await page.route("**/api/history?*", (route) => {
    historyRequests++;
    return route.fulfill({
      json: {
        interval: "4h",
        source: "Hyperliquid",
        freshness: "fresh",
        updatedAt: now.toISOString(),
        candles: [
          {
            time: now.getTime() - 3600000,
            close: 75,
            open: 75,
            high: 80,
            low: 70,
            volume: 1,
          },
        ],
      },
    });
  });
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (ws) => {
    connections++;
    ws.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.subscription?.type === "activeAssetCtx") {
        ws.send(
          JSON.stringify({
            channel: "activeAssetCtx",
            data: {
              coin: "xyz:BRENTOIL",
              ctx: {
                markPx: connections === 1 ? "81" : "82",
                prevDayPx: "75",
                dayNtlVlm: "1000",
              },
            },
          }),
        );
        if (connections === 1) setTimeout(() => ws.close(), 100);
      }
      if (parsed.subscription?.type === "candle" && connections > 1) {
        for (const close of [80, 82])
          ws.send(
            JSON.stringify({
              channel: "candle",
              data: {
                s: "xyz:BRENTOIL",
                i: "4h",
                t: now.getTime(),
                o: "80",
                h: "83",
                l: "79",
                c: String(close),
                v: "1",
              },
            }),
          );
      }
    });
  });
  await page.goto("/");
  await expect(page.getByText("Reconnecting", { exact: true })).toBeVisible();
  await expect(page.locator(".live-price")).toHaveAttribute(
    "aria-label",
    "Mark price $82.00 per barrel",
  );
  await expect.poll(() => historyRequests).toBeGreaterThanOrEqual(2);
  await expect(
    page.locator(".price-chart").first().locator(".sr-only"),
  ).toContainText("2 observations. Latest $82.00");
});
