import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8", // or 'v8'
      reporter: ["html"],
    },
  },
});
