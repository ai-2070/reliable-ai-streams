import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Test environment
    environment: "node",

    // Global test setup
    globals: true,

    // Setup files - run before all tests
    setupFiles: ["./tests/setup.ts"],

    // Exclude integration tests from unit test runs
    exclude: ["**/node_modules/**", "**/dist/**", "**/integration/**"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/**",
        "img/**",
        "dist/**",
        "tests/**",
        "integration/**",
        "examples/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/types/**",
        "vitest.config.ts",
        "src/**/index.ts",
        "src/adapters/**",
        "src/runtime/opentelemetry.ts",
        "src/runtime/sentry.ts",
      ],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },

    // Test timeout
    testTimeout: 10000,
    hookTimeout: 10000,

    // Retry failed tests
    retry: 0,

    // Mock options
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },

  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
