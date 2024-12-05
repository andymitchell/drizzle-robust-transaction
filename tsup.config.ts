import { defineConfig } from "tsup";
 
export default defineConfig({
  entry: ["src/index.ts"],
  publicDir: false,
  clean: true,
  minify: false,
  target: ['esnext'],
  external: ["@electric-sql/pglite", "@libsql/client", "better-sqlite3", "drizzle-kit", "drizzle-orm"],
  format: ['esm'], 
  dts: true
});



