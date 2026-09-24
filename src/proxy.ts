import { NextResponse, type NextRequest } from "next/server";

/**
 * Barriere d'entree.
 *
 * Le fichier s'appelle `proxy.ts` et non `middleware.ts` : Next.js 16 a deprecie puis
 * renomme cette convention. Voir docs/API.md section 1.3.
 *
 * Ce controle est volontairement OPTIMISTE : il regarde la seule presence du cookie et
 * ne touche jamais la base. La verification reelle de la session se fait dans la couche
 * donnees, via requireSession(), appelee par chaque Server Action. C'est la
 * recommandation de Next.js, et cela evite de reposer sur une barriere unique.
 */

/** Chemins accessibles sans session, AVEC leur sous-arbre (voir isPublic). */
const PUBLIC_PATHS = ["/login", "/enroll", "/recover", "/api/health"];

/**
 * Chemins accessibles sans session, a l'identique et SANS leur sous-arbre.
 *
 * Le manifeste doit repondre sans cookie. Chrome le recupere dans une requete a part,
 * anonyme par defaut : sans `crossorigin="use-credentials"` sur le <link>, le cookie de
 * session n'est pas envoye. Derriere la barriere, il repondait donc 307 vers /login,
 * mesure le 2026-08-31 en local comme en production. Consequence pour l'utilisatrice :
 * l'ajout a l'ecran d'accueil echoue en silence, sans le moindre message.
 *
 * Liste separee de PUBLIC_PATHS parce que celle-ci ouvre aussi tout ce qui commence par
 * `<chemin>/`. Ici on ouvre une URL, une seule, pas un prefixe.
 *
 * Ce qui est expose : un nom, deux couleurs et des chemins d'icones. Aucune donnee de
 * session, aucun montant, rien qui touche a la base.
 */
const PUBLIC_EXACT_PATHS = ["/manifest.webmanifest"];

const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Politique de securite du contenu, a nonce, selon le patron officiel de Next.js.
 *
 * Deux points meritent d'etre explicites plutot que subis :
 *
 * - `style-src-attr 'unsafe-inline'` est indispensable. React pose ses styles inline
 *   sous forme d'attributs `style=`, et Recharts en produit massivement dans ses SVG.
 *   Sans cette directive, les graphiques s'affichent sans mise en forme. La directive
 *   n'autorise QUE les attributs de style, pas les balises <style> arbitraires : la
 *   surface ouverte reste tres inferieure a un `'unsafe-inline'` sur `style-src`.
 * - `'unsafe-eval'` n'est ajoute qu'en developpement, ou le rechargement a chaud en a
 *   besoin. Il n'apparait jamais en production.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Applique la CSP a la requete et a la reponse, et propage le nonce a Next. */
function withCsp(request: NextRequest, build: (headers: Headers) => NextResponse): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  // Next lit ces deux en-tetes pour etiqueter automatiquement ses propres balises.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = build(requestHeaders);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function cookieName(): string {
  return process.env.SESSION_COOKIE_NAME ?? "budget_session";
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Options communes du cookie de session, pour ne pas les desynchroniser. */
function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(cookieName())?.value;

  if (isPublic(pathname)) {
    /**
     * Cookie present alors que la session n'existe plus en base.
     *
     * Un Server Component n'a pas le droit d'effacer un cookie : la couche donnees
     * constate seulement la session morte et redirige vers /login?expired=1. Le proxy
     * est le seul endroit qui puisse reellement nettoyer, c'est donc ici que ca se fait.
     *
     * Sans ce traitement, l'application etait TOTALEMENT inaccessible, et pas seulement
     * degradee : mesure avec un cookie perime, "/" redirigeait vers "/login?expired=1",
     * que la regle ci-dessous renvoyait aussitot vers "/". Boucle infinie, donc
     * ERR_TOO_MANY_REDIRECTS, sans aucune issue pour l'utilisatrice puisqu'il aurait
     * fallu vider les cookies a la main. Le cas se produit a l'expiration au bout d'un
     * an, et surtout apres une restauration de sauvegarde, ou les sessions de l'ancien
     * fichier ne correspondent plus a rien.
     */
    const sessionExpired = request.nextUrl.searchParams.get("expired") === "1";
    if (token && sessionExpired) {
      return withCsp(request, (headers) => {
        const response = NextResponse.next({ request: { headers } });
        response.cookies.set(cookieName(), "", sessionCookieOptions(0));
        return response;
      });
    }

    // Deja connectee sur un ecran de connexion : on la renvoie chez elle plutot que
    // de lui redemander de s'identifier.
    if (token && (pathname === "/login" || pathname === "/enroll")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return withCsp(request, (headers) => NextResponse.next({ request: { headers } }));
  }

  if (!token) {
    const target = new URL("/login", request.url);
    // On garde la destination voulue pour l'y ramener apres connexion.
    if (pathname !== "/") target.searchParams.set("next", pathname);
    return NextResponse.redirect(target);
  }

  return withCsp(request, (headers) => {
    const response = NextResponse.next({ request: { headers } });
    // Prolongation glissante cote navigateur. La session en base est prolongee de son
    // cote par getSession(). Objectif produit : elle ouvre le site et elle est dedans,
    // sans jamais rien retaper, meme apres des mois.
    response.cookies.set(cookieName(), token, sessionCookieOptions(SESSION_MAX_AGE_SECONDS));
    return response;
  });
}

export const config = {
  /**
   * Sans matcher, le proxy tournerait aussi sur les fichiers statiques et bloquerait
   * le CSS, le JavaScript et les images avant meme l'ecran de connexion.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
