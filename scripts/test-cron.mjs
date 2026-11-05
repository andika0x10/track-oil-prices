import assert from "node:assert/strict";
const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4322";
const response = await fetch(
  `${base}/cdn-cgi/local/explorer/api/local/scheduled?worker=track-oil-prices`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cron: "0 0 * * *" }),
  },
);
const result = await response.json();
assert.equal(response.status, 200);
assert.equal(result.result?.outcome, "ok", JSON.stringify(result));
console.log("Daily scheduled refresh passed in the local Cloudflare runtime.");
