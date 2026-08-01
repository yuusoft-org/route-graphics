import esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

// Route Graphics always uses the default Opus decoder without speech-quality
// enhancement. Replace its unreachable optional import so the 4 MiB ML model
// is not embedded in the single-file bundle.
const excludeUnusedOpusMlPlugin = {
  name: "exclude-unused-opus-ml",
  setup(build) {
    build.onResolve({ filter: /^@wasm-audio-decoders\/opus-ml$/ }, () => ({
      namespace: "unused-opus-ml",
      path: "unused-opus-ml",
    }));
    build.onLoad({ filter: /.*/, namespace: "unused-opus-ml" }, () => ({
      contents: [
        "export const OpusMLDecoder = undefined;",
        "export const OpusMLDecoderWebWorker = undefined;",
      ].join("\n"),
      loader: "js",
    }));
  },
};

try {
  const buildBundle = async ({ outdir, minify, sourcemap }) => {
    await Promise.all([
      rm(path.join(outdir, "RouteGraphics.js"), { force: true }),
      rm(path.join(outdir, "RouteGraphics.js.map"), { force: true }),
      rm(path.join(outdir, "chunks"), { force: true, recursive: true }),
    ]);

    await esbuild.build({
      entryPoints: ["./src/index.js"],
      bundle: true,
      minify,
      sourcemap,
      outfile: path.join(outdir, "RouteGraphics.js"),
      format: "esm",
      plugins: [excludeUnusedOpusMlPlugin],
    });
  };

  const buildCliBundle = async () => {
    const outdir = "./dist/cli";

    await rm(outdir, { force: true, recursive: true });
    await esbuild.build({
      entryPoints: ["./src/cli/routeGraphicsCli.js"],
      bundle: true,
      minify: false,
      sourcemap: false,
      outfile: path.join(outdir, "routeGraphicsCli.js"),
      format: "esm",
      platform: "node",
      packages: "external",
    });
  };

  await Promise.all([
    buildCliBundle(),
    buildBundle({
      outdir: "./dist",
      minify: true,
      sourcemap: false,
    }),
    buildBundle({
      outdir: "./playground/static",
      minify: true,
      sourcemap: false,
    }),
    buildBundle({
      outdir: "./vt/static",
      minify: false,
      sourcemap: true,
    }),
  ]);

  await rm("./.rettangoli/vt/_site/chunks", {
    force: true,
    recursive: true,
  });
  await mkdir("./.rettangoli/vt/_site", { recursive: true });
  await Promise.all([
    cp(
      "./vt/static/RouteGraphics.js",
      "./.rettangoli/vt/_site/RouteGraphics.js",
    ),
    cp(
      "./vt/static/RouteGraphics.js.map",
      "./.rettangoli/vt/_site/RouteGraphics.js.map",
    ),
  ]);
} catch (error) {
  console.error(error);
  process.exit(1);
}
