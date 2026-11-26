import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "worker/migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // MFA_KEY here is a throwaway test-only key (base64 of 32 bytes), never used anywhere real.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, MFA_KEY: "dGVzdC1vbmx5LW1mYS1rZXktMzItYnl0ZXMtbG9uZyE=" } },
      }),
    ],
    test: { include: ["worker/test/**/*.test.ts"], setupFiles: [] },
  };
});
