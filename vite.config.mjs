import { defineConfig } from "vite";
import { resolve, sep } from "node:path";

const publicAssetsDirectory = resolve("public/assets");
const publicAssetsPrefix = `${publicAssetsDirectory}${sep}`;

const publicAssetReload = {
  name: "public-asset-reload",
  configureServer(server) {
    server.watcher.add(publicAssetsDirectory);
    server.middlewares.use((request, response, next) => {
      if (request.url?.startsWith("/assets/")) {
        response.setHeader("Cache-Control", "no-store");
      }
      next();
    });

    const reloadAsset = (file) => {
      if (file === publicAssetsDirectory || file.startsWith(publicAssetsPrefix)) {
        server.ws.send({ type: "full-reload", path: "*" });
      }
    };
    server.watcher.on("add", reloadAsset);
    server.watcher.on("change", reloadAsset);
    server.watcher.on("unlink", reloadAsset);
  },
};

export default defineConfig({
  plugins: [publicAssetReload],
  server: {
    cors: true,
    watch: process.platform === "win32"
      ? { usePolling: true, interval: 300 }
      : undefined,
  },
  preview: {
    cors: true,
  },
});
