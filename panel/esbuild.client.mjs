import * as esbuild from "esbuild";

esbuild.build({
  bundle: true,
  entryPoints: ["src/client/main.tsx"],
  format: "esm",
  loader: {
    ".css": "css"
  },
  minify: false,
  outfile: "dist/public/assets/client.js",
  sourcemap: false
}).catch(() => process.exit(1));
