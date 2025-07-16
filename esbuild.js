import esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["./src/index.js"],
    bundle: true,
    minify: true,
    sourcemap: false,
    outfile: "./dist/RouteGraphics.js",
    format: "esm",
  })
  .catch(() => process.exit(1));

esbuild
  .build({
    entryPoints: ["./src/index.js"],
    bundle: true,
    minify: false,
    sourcemap: true,
    outfile: "./vt/static/RouteGraphics.js",
    format: "esm",
  })
  .catch(() => process.exit(1));
