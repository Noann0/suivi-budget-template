/**
 * Generateur d'icones de l'application.
 *
 *   node scripts/generate-icons.mjs
 *   node scripts/generate-icons.mjs --master design/icon-concepts/concept-1.svg
 *   node scripts/generate-icons.mjs --master <master.svg> --dense <dense.svg>
 *   node scripts/generate-icons.mjs --check          (ne reecrit rien, verifie l'existant)
 *
 * Changer de concept doit couter UNE commande. Tout ce qui suit derive d'un seul
 * fichier maitre : passer `--master design/icon-concepts/concept-2.svg` regenere les
 * six fichiers d'un coup. Rien n'est fige en dur ici, pas meme les couleurs, elles
 * sont relues dans le maitre.
 *
 * Sorties (table "Fichiers a produire" de design/ICON_PLAN.md) :
 *   src/app/icon.svg         copie conforme du maitre, favicon vectoriel
 *   src/app/apple-icon.png   180 x 180, ecran d'accueil iOS
 *   src/app/favicon.ico      16 + 32 + 48 dans un seul conteneur ICO
 *   public/icons/icon-192.png
 *   public/icons/icon-512.png
 *
 * Variante dense : le maitre a cinq elements, illisibles a 16 px. Le plan prevoit une
 * variante a trois elements agrandis pour les deux petites tailles du .ico. Elle est
 * cherchee automatiquement dans scripts/icon-src/<nom-du-maitre>-dense.svg. Absente,
 * le maitre est utilise partout et le script le dit clairement.
 *
 * Dependances : `sharp` uniquement, deja present dans node_modules (dependance
 * optionnelle de Next.js, utilisee par son optimiseur d'images). Aucune installation,
 * aucun ajout a package.json : ce script est un outil de developpement, il ne tourne
 * ni au build ni au runtime.
 *
 * Le format ICO n'est pas ecrit par sharp et n'a besoin d'aucune bibliotheque : le
 * conteneur est un en-tete de 6 octets, une entree de repertoire de 16 octets par
 * image, puis les charges PNG concatenees. Il est assemble plus bas.
 */

import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_MASTER = "design/icon-concepts/concept-3.svg";

/** Facteur de suréchantillonnage : on rastérise a N fois la taille cible, puis on
 *  reduit en lanczos3. Sur des aplats vectoriels c'est ce qui donne les bords les
 *  plus propres, sans le halo d'un rendu direct a 16 px. */
const SUPERSAMPLE = 4;

// --- lecture des arguments ---------------------------------------------------

function parseArgs(argv) {
  const args = { master: DEFAULT_MASTER, dense: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--check") {
      args.check = true;
    } else if (flag === "--master" || flag === "--dense") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} attend un chemin de fichier.`);
      }
      args[flag.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`Option inconnue : ${flag}`);
    }
  }
  return args;
}

// --- rendu -------------------------------------------------------------------

/**
 * Couleur de fond du maitre, relue dans le SVG plutot que recopiee ici : le premier
 * rectangle plein cadre porte le fond de tuile. Sert a aplatir le canal alpha, pour
 * que les PNG soient opaques bord a bord (exigence maskable) et plus legers.
 */
function backgroundOf(svg) {
  const match = svg.match(/<rect[^>]*\bwidth="(?:512|100%)"[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/);
  if (!match) {
    throw new Error(
      "Fond introuvable dans le maitre : il faut un <rect width=\"512\"> avec un fill hexadecimal.",
    );
  }
  return match[1];
}

/** Rasterise un SVG en PNG carre. `flatten` retire le canal alpha (PNG opaque). */
async function raster(svg, size, background, { flatten }) {
  const render = size * SUPERSAMPLE;
  // La densite pilote la rasterisation de librsvg : le maitre a un viewBox de 512 et
  // aucune dimension intrinseque, il sort donc a 512 * densite / 72 pixels. On rend a
  // `render`, puis une seule reduction lanczos3 amene a la taille cible.
  let pipeline = sharp(Buffer.from(svg), { density: (72 * render) / 512 }).resize(size, size, {
    kernel: "lanczos3",
  });

  pipeline = flatten ? pipeline.flatten({ background }) : pipeline.flatten({ background }).ensureAlpha(1);

  // `palette: false` est explicite et volontaire : dans sharp 0.35, passer `effort`,
  // `quality`, `colours` ou `dither` bascule silencieusement le PNG en 8 bits indexes.
  // Les charges du .ico doivent rester en RGBA reel, sinon l'entree du repertoire ICO
  // qui annonce 32 bits par pixel devient un mensonge.
  return pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();
}

// --- conteneur ICO -----------------------------------------------------------

/**
 * Assemble un .ico a partir de charges PNG deja encodees.
 *
 * ICONDIR      : 6 octets   reserve(2)=0, type(2)=1 (icone), nombre d'images(2)
 * ICONDIRENTRY : 16 octets  largeur(1), hauteur(1)  -  0 signifie 256  - , couleurs de la
 *                palette(1)=0 pour "plus de 256", reserve(1)=0, plans(2)=1,
 *                bits par pixel(2)=32, taille de la charge(4), offset de la charge(4)
 * puis les charges, dans l'ordre des entrees.
 *
 * Les charges sont des PNG RGBA : c'est le mode "PNG compresse" du format ICO, lu par
 * tous les navigateurs et par Windows depuis Vista. Les 32 bits par pixel declares
 * dans l'entree sont donc exacts, pas une valeur de complaisance.
 */
function buildIco(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(ENTRY * images.length);
  let offset = HEADER + ENTRY * images.length;

  images.forEach(({ size, png }, index) => {
    const at = index * ENTRY;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

// --- verifications -----------------------------------------------------------

/** Un PNG dont un pixel n'est pas opaque casse le rendu maskable : on le refuse. */
async function assertOpaque(label, buffer) {
  const { isOpaque } = await sharp(buffer).stats();
  if (!isOpaque) {
    throw new Error(`${label} contient des pixels transparents, le fond doit etre plein.`);
  }
}

async function describe(label, buffer) {
  const { width, height, channels } = await sharp(buffer).metadata();
  console.log(`  ${label.padEnd(26)} ${String(width).padStart(3)}x${height}  ${channels} canaux  ${buffer.length} octets`);
}

// --- programme ---------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const masterPath = path.resolve(ROOT, args.master);
  const master = await readFile(masterPath, "utf8");
  const background = backgroundOf(master);

  const denseGuess =
    args.dense ??
    path.join("scripts/icon-src", `${path.basename(masterPath, ".svg")}-dense.svg`);
  let dense = master;
  let denseLabel = "aucune, le maitre sert les trois tailles";
  try {
    dense = await readFile(path.resolve(ROOT, denseGuess), "utf8");
    denseLabel = denseGuess;
  } catch {
    if (args.dense) throw new Error(`Variante dense introuvable : ${args.dense}`);
  }

  console.log(`Maitre        : ${args.master}`);
  console.log(`Variante 16/32: ${denseLabel}`);
  console.log(`Fond detecte  : ${background}`);
  if (dense === master) {
    console.log(
      "  ! Pas de variante dense pour ce concept. A 16 px, un motif a cinq elements\n" +
        "    devient illisible : produire scripts/icon-src/" +
        `${path.basename(masterPath, ".svg")}-dense.svg avant de livrer.`,
    );
  }

  // .ico : variante dense pour 16 et 32, maitre pour 48 (section .ico du plan).
  const ico = buildIco([
    { size: 16, png: await raster(dense, 16, background, { flatten: false }) },
    { size: 32, png: await raster(dense, 32, background, { flatten: false }) },
    { size: 48, png: await raster(master, 48, background, { flatten: false }) },
  ]);

  const outputs = [
    { file: "src/app/icon.svg", data: Buffer.from(master, "utf8") },
    { file: "src/app/favicon.ico", data: ico },
    { file: "src/app/apple-icon.png", data: await raster(master, 180, background, { flatten: true }) },
    { file: "public/icons/icon-192.png", data: await raster(master, 192, background, { flatten: true }) },
    { file: "public/icons/icon-512.png", data: await raster(master, 512, background, { flatten: true }) },
  ];

  console.log("\nSorties :");
  for (const { file, data } of outputs) {
    if (file.endsWith(".png")) {
      await assertOpaque(file, data);
      await describe(file, data);
    } else {
      console.log(`  ${file.padEnd(26)} ${data.length} octets`);
    }
    if (args.check) continue;
    const target = path.resolve(ROOT, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  console.log(args.check ? "\n--check : rien n'a ete ecrit." : "\nEcrit.");
}

await main();
