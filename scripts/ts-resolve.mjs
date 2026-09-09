/** Registers the resolver in ts-resolve-hooks.mjs. Use with `node --import`. */
import { register } from "node:module";
register("./ts-resolve-hooks.mjs", import.meta.url);
