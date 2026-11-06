/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :8700 (`latexstudio`); the built app is served by that same server.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:8700" } },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 400 },
  test: { environment: "jsdom", globals: true },
});
