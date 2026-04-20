import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/**/index.ts",
        "packages/*/src/**/*.d.ts",
        "packages/bot/src/main.ts",
        "packages/daemon/src/main.ts",
        // Dashboard entry + React UI files are covered by Vite dev/build and
        // exercised manually; their .tsx siblings aren't in the include glob
        // to begin with. usePolling wraps a React hook and can't be exercised
        // without a DOM testing harness.
        "packages/dashboard/src/util/usePolling.ts",
        // Thin factory for `node-pty`: the body just wires the native module.
        // Covered by real integration (and a smoke test on createNodePtySpawn
        // itself). Excluded so we don't need node-pty's native build in CI.
        "packages/daemon/src/pty.ts"
      ],
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 90,
        statements: 98
      }
    }
  }
});
