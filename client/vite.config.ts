import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "client",
  base: process.env.VITE_BASE_PATH ?? "/pixel-guess/",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared/src", import.meta.url))
    }
  },
  server: {
    port: 5173
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  }
});
