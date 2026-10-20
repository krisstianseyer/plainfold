import { defineConfig } from "vite";

// Tauri serves the dev front end at a fixed port and expects a static build.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    sourcemap: false,
  },
});
