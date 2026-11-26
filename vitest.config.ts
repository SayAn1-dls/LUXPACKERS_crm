import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "worker/migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // MFA_KEY and the Google client here are throwaway test-only values, never used anywhere real.
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            MFA_KEY: "dGVzdC1vbmx5LW1mYS1rZXktMzItYnl0ZXMtbG9uZyE=",
            GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
            GOOGLE_CLIENT_SECRET: "test-only-client-secret",
          },
        },
      }),
    ],
    test: { include: ["worker/test/**/*.test.ts"], setupFiles: [] },
  };
});
