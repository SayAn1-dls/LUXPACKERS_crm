import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  root: "web",
  plugins: [
    react(),
    // Share one local D1 with `npm run db:migrate:local` (state lives in the repo-root .wrangler).
    cloudflare({ configPath: "../wrangler.jsonc", persistState: { path: "../.wrangler/state" } }),
  ],
  build: { outDir: "../dist", emptyOutDir: true },
});
