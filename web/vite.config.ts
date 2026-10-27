import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app under /<repo>/; the deploy workflow sets it.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
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
});
