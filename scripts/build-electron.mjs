import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
  loader: { ".node": "file" }
};

await build({
  ...shared,
  entryPoints: ["src/main/main.ts"],
  outfile: "dist-electron/main.mjs",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); import { fileURLToPath as __utcode_f2p } from 'node:url'; import { dirname as __utcode_dn } from 'node:path'; const __filename = __utcode_f2p(import.meta.url); const __dirname = __utcode_dn(__filename);"
  }
});

await build({
  ...shared,
  entryPoints: ["src/main/preload.ts"],
  outfile: "dist-electron/preload.js",
  format: "cjs",
  platform: "node"
});
