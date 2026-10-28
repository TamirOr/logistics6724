import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { contentSecurityPolicy } from "./src/lib/csp";

// GitHub Pages serves the app under /<repo>/; the deploy workflow sets it.
const base = process.env.BASE_PATH ?? "/";

const REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

// A build without the project settings would ship an app that cannot reach
// its server. Fail here, in the workflow, instead.
function requireEnv(env: Record<string, string>) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}: set them in .env.local or the build environment`);
}

function contentSecurityPolicyTag(env: Record<string, string>): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(env.VITE_SUPABASE_URL, env.VITE_SENTRY_DSN) },
      injectTo: "head-prepend",
    }],
  };
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env } as Record<string, string>;
  if (command === "build") requireEnv(env);
  return {
    base,
    // Source maps go to Sentry from the deploy job and are removed before
    // the site is published; "hidden" leaves no link to them in the bundle.
    build: { sourcemap: "hidden" },
    plugins: [
      react(),
      contentSecurityPolicyTag(env),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        // A new version waits until the user taps the update banner, which
        // reloads only when no write is waiting to be sent (UpdateBanner).
        registerType: "prompt",
        injectRegister: false,
        manifest: {
          name: "לוגיסטיקה גדודית",
          short_name: "לוגיסטיקה",
          lang: "he",
          dir: "rtl",
          start_url: "./",
          scope: "./",
          display: "standalone",
          background_color: "#111418",
          theme_color: "#111418",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"] },
      }),
    ],
    // The shared Excel and label modules live next to the Edge Functions.
    server: { fs: { allow: [".."] } },
  };
});
