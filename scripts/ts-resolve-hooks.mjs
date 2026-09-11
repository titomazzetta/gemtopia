/**
 * Resolve TypeScript's extensionless relative imports and `@/` path aliases
 * for `node --experimental-strip-types`.
 *
 * TS source writes `import { x } from "./tempo"`, which a bundler resolves and
 * bare Node does not. The type-stripping runner executes the file as-is, so a
 * module importing a sibling fails on resolution before any test runs. This
 * hook tries the extensions TS would have tried.
 *
 * `@/...` aliases used to need no handling, because every one of them was a
 * type-only import and type stripping erases those before resolution happens.
 * That stopped being true the moment a module imported a *value* through the
 * alias — `share.ts` importing `releaseUrl` from `@/lib/discogs-links`. Rather
 * than push that one import back to a relative path, the alias is resolved
 * here the way tsconfig declares it, so the next value import through `@/`
 * does not rediscover this the hard way.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

/** Mirrors `"@/*": ["./src/*"]` in tsconfig.json. */
const SRC = new URL("../src/", import.meta.url);

/** Try the file as written, then each extension TS would have tried. */
function firstExisting(base) {
  if (/\.[A-Za-z0-9]+$/.test(base.pathname) && existsSync(fileURLToPath(base))) {
    return base;
  }
  for (const extension of EXTENSIONS) {
    const candidate = new URL(base.href + extension);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const resolved = firstExisting(new URL(specifier.slice(2), SRC));
    if (resolved) return next(resolved.href, context);
  }

  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[A-Za-z0-9]+$/.test(specifier);

  if (relative && !hasExtension && context.parentURL) {
    const resolved = firstExisting(new URL(specifier, context.parentURL));
    if (resolved) return next(resolved.href, context);
  }

  return next(specifier, context);
}
