import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "../supabase/functions/_shared/**/*.test.ts"] },
  server: { fs: { allow: [".."] } },
});
