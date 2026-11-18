#!/usr/bin/env node
/**
 * Run the browser flows: every file in e2e/flows, or the ones named.
 *
 *   npm run e2e                 # all of them
 *   npm run e2e -- crate usability   # some of them
 *
 * Each flow exports a default async function that returns true when every
 * check passed. The process exits non-zero if any flow fails, so this can sit
 * in CI behind a built, running app. See e2e/README.md.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const files = readdirSync(join(here, "flows"))
  .filter((f) => f.endsWith(".mjs"))
  .filter((f) => wanted.length === 0 || wanted.includes(f.replace(/\.mjs$/, "")))
  .sort();

let failed = 0;
for (const file of files) {
  const mod = await import(pathToFileURL(join(here, "flows", file)).href);
  const passed = await mod.default();
  if (!passed) failed += 1;
}
console.log(failed === 0 ? `all ${files.length} flows ok` : `${failed} of ${files.length} flows failed`);
process.exit(failed === 0 ? 0 : 1);
