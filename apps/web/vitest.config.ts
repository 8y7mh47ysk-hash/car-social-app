import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Vitest turns CSS into empty strings unless it is listed here. The global stylesheet is
    // compiled as Next.js compiles it, with postcss.config.mjs and so Tailwind CSS, so that
    // src/app/globals.test.ts can check the result.
    css: { include: [/globals\.css/] },
  },
});
