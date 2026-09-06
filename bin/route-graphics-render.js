#!/usr/bin/env node

// Compatibility entry point for the original PNG-only command.
import { runRouteGraphicsCli } from "../dist/cli/routeGraphicsCli.js";

process.exitCode = await runRouteGraphicsCli({
  argv: ["render", ...process.argv.slice(2)],
});
