#!/usr/bin/env node

import { runRouteGraphicsCli } from "../dist/cli/routeGraphicsCli.js";

const exitCode = await runRouteGraphicsCli();
process.exitCode = exitCode;
