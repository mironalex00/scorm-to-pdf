#!/usr/bin/env node
import { launch } from "../../cli/launch.ts";

// Compatibilidad con la ruta del conversor anterior. La orden y sus opciones son las del CLI principal.
await launch(["ascii", ...process.argv.slice(2)]);
