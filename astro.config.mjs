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
    optimizeDeps: { entries: ["src/components/Dashboard.tsx"] },
  },
});
