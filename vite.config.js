import { defineConfig } from "vite";
import { resolve } from "node:path";

const web = resolve(import.meta.dirname, "web");

/**
 * Dev only: runs the real API (server/app.js, file storage in ./data) inside the
 * Vite dev server and mimics the production rewrites (/admin, /<gift-code>).
 */
function devApi() {
  return {
    name: "xd-dev-api",
    apply: "serve",
    async configureServer(server) {
      const { loadEnv } = await import("./server/env.js");
      loadEnv();
      process.env.STORAGE ??= "fs";
      if (!process.env.ADMIN_PASSWORD) {
        process.env.ADMIN_PASSWORD = "admin";
        server.config.logger.warn("\n  ⚠ ADMIN_PASSWORD není v .env – pro vývoj platí heslo do dílny „admin“.\n");
      }
      const { handleApi, pageFor } = await import("./server/node-adapter.js");
      server.middlewares.use(async (req, res, next) => {
        const { pathname } = new URL(req.url, "http://x");
        if (pathname.startsWith("/api/")) {
          try { await handleApi(req, res); } catch (e) { next(e); }
          return;
        }
        const page = pageFor(pathname);
        if (page && pathname !== "/") req.url = page;
        next();
      });
    }
  };
}

export default defineConfig({
  root: web,
  base: "./",                 // relative asset URLs → works in a sub-folder on PHP hosting too
  appType: "mpa",
  plugins: [devApi()],
  build: {
    outDir: resolve(import.meta.dirname, process.env.XD_OUT || "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(web, "index.html"),
        admin: resolve(web, "admin.html")
      }
    }
  },
  server: { port: 5173 }
});
