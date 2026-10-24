import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the built UI from dist/ and the dev server on a fixed port.
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2022",
  },
});
