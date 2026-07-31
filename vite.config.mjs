import { defineConfig } from "vite";

const litterboxProxy = {
  "/api/litterbox": {
    target: "https://litterbox.catbox.moe",
    changeOrigin: true,
    secure: true,
    rewrite: () => "/resources/internals/api.php",
  },
};

export default defineConfig({
  server: {
    cors: true,
    proxy: litterboxProxy,
  },
  preview: {
    cors: true,
    proxy: litterboxProxy,
  },
});
