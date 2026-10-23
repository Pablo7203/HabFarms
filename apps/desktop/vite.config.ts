import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { zod: fileURLToPath(new URL("./node_modules/zod/index.js", import.meta.url)) } },
  server: { fs: { allow: ["../.."] } },
});
