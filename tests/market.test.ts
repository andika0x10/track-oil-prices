import { test } from "node:test";
import assert from "node:assert/strict";
import { getHistory, getMarket } from "../src/server/hyperliquid";
import { failure, ServiceError, upstreamJson } from "../src/server/http";
test("market source validation, empty history, range validation, and API failures", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    Response.json([
      { universe: [{ name: "xyz:BRENTOIL" }] },
      [{ markPx: "80", prevDayPx: "75", dayNtlVlm: "1000" }],
    ]);
  const market = await getMarket();
  assert.equal(market.instrument, "xyz:BRENTOIL");
  assert.equal(market.source, "Hyperliquid");
  assert.equal(market.price, 80);
  globalThis.fetch = async () => Response.json([]);
  await assert.rejects(() => getHistory("1D"), /No historical prices/);
  await assert.rejects(() => getHistory("unknown"), /Choose/);
  await assert.rejects(() => getHistory("constructor"), /Choose/);
  globalThis.fetch = async () => new Response("", { status: 429 });
  await assert.rejects(
    () => upstreamJson("https://example.com"),
    (error) => error instanceof ServiceError && error.code === "RATE_LIMITED",
  );
  const result = failure(new ServiceError("RATE_LIMITED", "Try again.", 503));
  assert.equal(result.headers.get("Retry-After"), "30");
  assert.equal(result.headers.get("Cache-Control"), "no-store");
});
