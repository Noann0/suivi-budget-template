import { register } from "node:module";

/**
 * Point d'entree charge via `node --import`. Enregistre le hook de resolution
 * (`resolve-hooks.mjs`) qui donne un sens a `@/*` et aux imports sans extension pour
 * `node --test`, exactement comme le fait `tsconfig.json` (`moduleResolution:
 * "bundler"`) pour Next et tsc.
 */
register("./resolve-hooks.mjs", import.meta.url);
