/**
 * Resolve TypeScript's extensionless relative imports for `node --experimental-strip-types`.
 *
 * TS source writes `import { x } from "./tempo"`, which a bundler resolves and
 * bare Node does not. The type-stripping runner executes the file as-is, so a
 * module importing a sibling fails on resolution before any test runs. This
 * hook tries the extensions TS would have tried.
 *
 * `@/...` path aliases need no handling: every one in this codebase is a
 * type-only import, which type stripping erases before resolution happens.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[A-Za-z0-9]+$/.test(specifier);

  if (relative && !hasExtension && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(base.href + extension);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
  }

  return next(specifier, context);
}
