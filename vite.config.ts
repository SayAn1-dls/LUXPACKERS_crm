import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  root: "web",
  plugins: [react(), cloudflare({ configPath: "../wrangler.jsonc" })],
  build: { outDir: "../dist", emptyOutDir: true },
});
