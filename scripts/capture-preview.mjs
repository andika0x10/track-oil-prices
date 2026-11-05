import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 900 },
    recordVideo: { dir: ".qa/motion", size: { width: 1440, height: 900 } },
  });
  const issues = [];
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && /GSAP|NaN/.test(message.text()))
      issues.push(message.text());
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4322");
  await expect(page.locator(".connection.live")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".month-cell:not(.awaiting)").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".site-header")).toHaveCSS("opacity", "1");
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(".qa", { recursive: true });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const chart = document.querySelector(".price-chart");
          return (
            Math.abs(
              chart.querySelector("svg").viewBox.baseVal.width -
                chart.getBoundingClientRect().width,
            ) < 1
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `.qa/live-${width}.png`, fullPage: true });
  }
  for (const months of [60, 120, 180, 360]) {
    const name =
      months >= 180
        ? `${months / 12} year scenario`
        : `${months} month projection`;
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".month-cell")).toHaveCount(
      months >= 180 ? months / 12 : months,
    );
    await page.locator(".outlook-chart-wrap").scrollIntoViewIfNeeded();
    await expect(page.locator(".forecast-clip")).toHaveAttribute(
      "transform",
      "matrix(1,0,0,1,0,0)",
    );
    await expect(page.locator(".forecast-band").first()).toHaveCSS(
      "opacity",
      "1",
    );
    await page.screenshot({ path: `.qa/live-${months}-months.png` });
  }
  await page.locator(".month-cell").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".detail-content")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: ".qa/live-month-detail.png" });
  console.log(
    JSON.stringify({
      liveConnection: true,
      screenshots: 9,
      browserIssues: issues,
    }),
  );
  expect(issues).toEqual([]);
} finally {
  await browser.close();
}
