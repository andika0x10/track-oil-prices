import { MODEL_EXPORTS, MODEL_RUNTIME_VERSION } from "../lib/modelAssets";
import type { BrowserModel } from "../lib/types";
import { ServiceError } from "./http";

const IMMUTABLE = "public, max-age=31536000, immutable";
const RUNTIME_FILES = new Set(
  ["ort-wasm-simd-threaded", "ort-wasm-simd-threaded.asyncify", "ort-wasm-simd-threaded.jsep", "ort-wasm-simd-threaded.jspi"]
    .flatMap((base) => [`${base}.mjs`, `${base}.wasm`]),
);

async function download(url: string, request: Request) {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]),
    });
  } catch {
    throw new ServiceError("MODEL_DOWNLOAD_FAILED", "The model download is temporarily unavailable. Try again.", 502);
  }
  if (!response.ok || !response.body)
    throw new ServiceError("MODEL_DOWNLOAD_FAILED", "The model download is temporarily unavailable. Try again.", 502);
  return response;
}

function streamAsset(upstream: Response, contentType: string) {
  const headers = new Headers({ "Content-Type": contentType, "Cache-Control": IMMUTABLE });
  for (const name of ["content-length", "content-encoding", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // No arrayBuffer(), cloning or application-level buffering of the 96 MB model.
  // Preserve the upstream encoding while streaming; the browser caches immutable files.
  return new Response(upstream.body, { headers, encodeBody: "manual" });
}

async function readConfig(upstream: Response) {
  const reader = upstream.body!.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65_536) {
        await reader.cancel();
        throw new Error("Config exceeds the size limit");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new ServiceError("INVALID_MODEL_CONFIG", "The prediction model configuration could not be loaded. Try again.", 502);
  } finally { reader.releaseLock(); }
}

export async function serveModelAsset(model: string, revision: string, file: string, request: Request) {
  if (!Object.hasOwn(MODEL_EXPORTS, model))
    throw new ServiceError("MODEL_ASSET_NOT_FOUND", "Model file not found.", 404);
  const entry = MODEL_EXPORTS[model as BrowserModel];
  if (revision !== entry.revision || (file !== "config.json" && !Object.hasOwn(entry.files, file)))
    throw new ServiceError("MODEL_ASSET_NOT_FOUND", "Model file not found.", 404);
  const upstream = await download(`https://huggingface.co/${entry.repository}/resolve/${entry.revision}/${file}`, request);
  if (file !== "config.json") return streamAsset(upstream, "application/octet-stream");
  const config = await readConfig(upstream);
  if (config.model_type !== "chronos-bolt" || config.variant !== model.replace("chronos-bolt-", ""))
    throw new ServiceError("INVALID_MODEL_CONFIG", "The prediction model configuration could not be loaded. Try again.", 502);
  // Custom-origin loading must retain SHA-256 verification against our pinned manifest.
  return Response.json({ ...config, files: entry.files }, { headers: { "Cache-Control": IMMUTABLE } });
}

export async function serveRuntimeAsset(version: string, file: string, request: Request) {
  if (version !== MODEL_RUNTIME_VERSION || !RUNTIME_FILES.has(file))
    throw new ServiceError("MODEL_ASSET_NOT_FOUND", "Runtime file not found.", 404);
  const upstream = await download(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${MODEL_RUNTIME_VERSION}/dist/${file}`, request);
  return streamAsset(upstream, file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
}
