import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    env: { VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test-anon-key" },
    include: ["src/**/*.test.ts", "../supabase/functions/_shared/**/*.test.ts"],
  },
  server: { fs: { allow: [".."] } },
});
