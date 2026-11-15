import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODEL_EXPORTS, MODEL_RUNTIME_VERSION, browserModelUrls } from "../src/lib/modelAssets";
import { serveModelAsset, serveRuntimeAsset } from "../src/server/model-assets";

const request = new Request("https://dashboard.example/api/models");

test("production model and runtime URLs stay on the application's origin", () => {
  for (const model of ["chronos-bolt-small", "chronos-bolt-tiny"] as const) {
    const urls = browserModelUrls("https://dashboard.example", model);
    assert.equal(new URL(urls.weights).origin, "https://dashboard.example");
    assert.ok(urls.weights.includes(MODEL_EXPORTS[model].revision));
    assert.equal(new URL(urls.wasmPaths).origin, "https://dashboard.example");
  }
  const installed = JSON.parse(readFileSync("node_modules/onnxruntime-web/package.json", "utf8"));
  assert.equal(MODEL_RUNTIME_VERSION, installed.version);
});

test("model proxy allows only pinned files and restores immutable integrity hashes in config", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(String(url), `https://huggingface.co/${MODEL_EXPORTS["chronos-bolt-small"].repository}/resolve/${MODEL_EXPORTS["chronos-bolt-small"].revision}/config.json`);
    return Response.json({ model_type: "chronos-bolt", variant: "small", files: { untrusted: { sha256: "wrong" } } });
  };
  for (const [model, revision, file] of [
    ["__proto__", "main", "config.json"],
    ["chronos-bolt-small", "main", "config.json"],
    ["chronos-bolt-small", MODEL_EXPORTS["chronos-bolt-small"].revision, "../../secret"],
  ]) await assert.rejects(() => serveModelAsset(model, revision, file, request), /not found/);
  assert.equal(calls, 0);
  const response = await serveModelAsset("chronos-bolt-small", MODEL_EXPORTS["chronos-bolt-small"].revision, "config.json", request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /immutable/);
  const config = await response.json() as { files: unknown };
  assert.deepEqual(config.files, MODEL_EXPORTS["chronos-bolt-small"].files);
  assert.equal(calls, 1);
});

test("model binaries stream through without buffering or cloning the upstream body", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const bytes = new Uint8Array([11, 12, 13]);
  globalThis.fetch = async () => {
    const upstream = new Response(bytes, { headers: { "content-length": "3", "set-cookie": "not-forwarded=value" } });
    for (const method of ["arrayBuffer", "text", "clone"] as const)
      Object.defineProperty(upstream, method, { value: () => { throw new Error("Large assets must be streamed"); } });
    return upstream;
  };
  const response = await serveModelAsset("chronos-bolt-tiny", MODEL_EXPORTS["chronos-bolt-tiny"].revision, "onnx/model_fp16w.f16", request);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("runtime paths are allowlisted and upstream failures do not return cacheable success", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `https://cdn.jsdelivr.net/npm/onnxruntime-web@${MODEL_RUNTIME_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`);
    return new Response(new Uint8Array([0, 97, 115, 109]));
  };
  const response = await serveRuntimeAsset(MODEL_RUNTIME_VERSION, "ort-wasm-simd-threaded.asyncify.wasm", request);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  await assert.rejects(() => serveRuntimeAsset("latest", "ort-wasm-simd-threaded.asyncify.wasm", request), /not found/);
  await assert.rejects(() => serveRuntimeAsset(MODEL_RUNTIME_VERSION, "../../example.js", request), /not found/);
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(() => serveRuntimeAsset(MODEL_RUNTIME_VERSION, "ort-wasm-simd-threaded.asyncify.wasm", request), /temporarily unavailable/);
});

test("oversized model configs are rejected before parsing", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("x".repeat(65_537));
  await assert.rejects(() => serveModelAsset("chronos-bolt-small", MODEL_EXPORTS["chronos-bolt-small"].revision, "config.json", request), /configuration could not be loaded/);
});
