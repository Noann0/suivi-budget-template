import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Hook de resolution ESM pour `node --test`.
 *
 * Node execute nativement du TypeScript depuis la 24 (type-stripping), mais son
 * resolveur ESM ignore `tsconfig.json` : ni l'alias `@/*` ni l'omission d'extension
 * (`from "./migrate"`) ne fonctionnent tels quels. next/tsc les comprennent via
 * `moduleResolution: "bundler"`, `node --test` non. Ce hook reproduit UNIQUEMENT ces
 * deux regles, sans dependance ajoutee (juste `node:module`, disponible nativement),
 * pour pouvoir importer le vrai code de production sans le dupliquer ni le transpiler
 * a la main.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = resolvePath(ROOT, "src");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function firstExisting(basePath) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = basePath + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = firstExisting(resolvePath(SRC, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasKnownExtension = /\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier);
  if (isRelative && !hasKnownExtension && context.parentURL?.startsWith("file://")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const found = firstExisting(resolvePath(parentDir, specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // `next` (et d'autres paquets sans champ `exports`) resolvent des sous-chemins
    // (`next/server`) sans extension : le CJS legacy de `require` la devine, le
    // resolveur ESM natif de Node non. Les bundlers (webpack/Turbopack) la devinent
    // aussi, d'ou l'ecart uniquement visible sous `node --test`. Meme filet que pour
    // `@/*` ci-dessus : une seule tentative de repli en `.js`, avant d'abandonner.
    if (error?.code === "ERR_MODULE_NOT_FOUND" && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}
