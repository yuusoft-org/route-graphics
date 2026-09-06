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

  const target = process.argv[2] ?? "package";
  if (!["package", "playground", "visual", "all"].includes(target)) {
    throw new Error(`Unknown build target: ${target}`);
  }
  const packageBuild = target === "package" || target === "all";
  const playgroundBuild = target === "playground" || target === "all";
  const visualBuild = target === "visual" || target === "all";
  if (packageBuild) {
    await rm("./dist", { force: true, recursive: true });
  }
  const jobs = [];
  if (packageBuild || playgroundBuild) {
    jobs.push(
      buildBundle({ outdir: "./dist", minify: true, sourcemap: false }).then(
        async () => {
          if (playgroundBuild) {
            await mkdir("./playground/static", { recursive: true });
            await cp(
              "./dist/RouteGraphics.js",
              "./playground/static/RouteGraphics.js",
            );
          }
        },
      ),
    );
  }
  if (packageBuild) {
    jobs.push(buildCliBundle());
  }
  if (visualBuild) {
    jobs.push(
      buildBundle({
        outdir: "./vt/static",
        minify: false,
        sourcemap: true,
      }).then(async () => {
        const site = "./.rettangoli/vt/_site";
        await rm(path.join(site, "chunks"), { force: true, recursive: true });
        await mkdir(site, { recursive: true });
        await Promise.all(
          ["RouteGraphics.js", "RouteGraphics.js.map"].map((name) =>
            cp(path.join("./vt/static", name), path.join(site, name)),
          ),
        );
      }),
    );
  }
  await Promise.all(jobs);
} catch (error) {
  console.error(error);
  process.exit(1);
}
