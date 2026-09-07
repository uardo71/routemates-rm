import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pure-function unit tests only — node environment, no jsdom / UI testing library.
// The `@/` alias is resolved to ./src the same way tsconfig.json's paths map it.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
