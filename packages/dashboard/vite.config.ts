import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://127.0.0.1:4317";

// `base: "./"` keeps every asset URL relative, so the build works under any path
// prefix and inside the VS Code webview iframe. welcome.html is the landing page (/welcome).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: api },
      "/mcp": { target: api },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { main: "index.html", welcome: "welcome.html" } },
  },
});
