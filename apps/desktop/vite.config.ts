import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    proxy: {
      "/api": {
        target: "https://clipmind.prodream.cn",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("X-ClipMind-Desktop", "1");
          });
          proxy.on("proxyRes", (proxyRes) => {
            const setCookie = proxyRes.headers["set-cookie"];
            if (!setCookie) return;
            proxyRes.headers["set-cookie"] = setCookie.map((cookie) =>
              cookie
                .replace(/;\s*Secure/gi, "")
                .replace(/;\s*SameSite=None/gi, "; SameSite=Lax"),
            );
          });
        },
      },
    },
  },
  ssr: {
    noExternal: ["novel", "react-tweet"],
  },
});
