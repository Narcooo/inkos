import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
          if (
            id.includes("/@shikijs/core/")
            || id.includes("/@shikijs/engine-javascript/")
            || id.includes("/@shikijs/types/")
          ) {
            return "vendor-shiki-core";
          }
          if (id.includes("/@shikijs/themes/")) return "vendor-shiki-themes";
          if (id.includes("/shiki/dist/core") || id.includes("/shiki/dist/engine")) {
            return "vendor-shiki-core";
          }
          if (id.includes("/shiki/dist/themes/")) return "vendor-shiki-themes";
          if (id.includes("/shiki/") || id.includes("/@shikijs/")) return undefined;
          if (
            id.includes("/@streamdown/math/")
            || id.includes("/katex/")
            || id.includes("/rehype-katex/")
            || id.includes("/remark-math/")
          ) {
            return "vendor-markdown-math";
          }
          if (id.includes("/@streamdown/mermaid/")) return "vendor-markdown-mermaid";
          if (id.includes("/mermaid/")) return "vendor-mermaid";
          if (
            id.includes("/streamdown/")
            || id.includes("/@streamdown/")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/motion/")) return "vendor-motion";
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4567,
    proxy: {
      "/api/v1/events": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4569"}`,
        changeOrigin: true,
        // SSE needs unbuffered streaming — bypass http-proxy response handling
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          });
        },
      },
      "/api": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4569"}`,
        changeOrigin: true,
      },
    },
  },
});
