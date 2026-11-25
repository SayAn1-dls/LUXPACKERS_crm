/// <reference path="../../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
import type { Env as AppEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
