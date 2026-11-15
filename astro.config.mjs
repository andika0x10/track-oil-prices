// @ts-check
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

import react from "@astrojs/react";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  output: "server",
  devToolbar: { enabled: false },
  adapter: cloudflare({ imageService: "passthrough" }),
  session: false,
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    server: { watch: { ignored: ["**/.qa/**", "**/test-results/**", "**/playwright-report/**"] } },
    optimizeDeps: { entries: ["src/components/Dashboard.tsx"], exclude: ["forecast-web"] },
    worker: { format: "es" },
    resolve: {
      // Runtime binaries are fetched from the versioned CDN by ONNX, not bundled
      // as oversized Cloudflare static assets.
      conditions: ["onnxruntime-web-use-extern-wasm", "module", "browser", "development|production"],
      // forecast-web imports the default ONNX entry; include the GPU provider as well.
      alias: [{ find: /^onnxruntime-web$/, replacement: "onnxruntime-web/webgpu" }],
    },
  },
});
