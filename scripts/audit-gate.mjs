/**
 * CI's dependency audit: `npm run audit:ci`. The rules are in audit-gate-lib.mjs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluate } from "./audit-gate-lib.mjs";

function audit(args) {
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const allow = JSON.parse(readFileSync(new URL("../.github/audit-allowlist.json", import.meta.url), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const result = evaluate({ full: audit([]), prod: audit(["--omit=dev"]), allow, today });

for (const line of result.accepted) console.log(`accepted  ${line}`);
for (const line of result.notes) console.log(`note      ${line}`);
for (const line of result.failures) console.error(`FAIL      ${line}`);
console.log(result.ok ? "Dependency audit passed." : "Dependency audit failed.");
process.exit(result.ok ? 0 : 1);
