#!/usr/bin/env node
import { launch } from "../../cli/launch.ts";

// Keep the standalone entry point on the shared CLI.
await launch(["ascii", ...process.argv.slice(2)]);
