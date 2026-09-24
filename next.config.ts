import type { NextConfig } from "next";

/**
 * En-tetes de securite globaux.
 *
 * La Content-Security-Policy n'est volontairement PAS ici : elle porte un nonce
 * regenere a chaque requete, elle vit donc dans src/proxy.ts. Les en-tetes ci-dessous
 * sont constants et ont leur place dans la configuration.
 */
const securityHeaders = [
  // Un an, sous-domaines compris. A n'activer qu'une fois le certificat en place :
  // un HSTS pose trop tot rend le domaine inaccessible en clair pour la duree du
  // max-age, y compris pour corriger l'erreur.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Aucune de ces interfaces n'est utilisee par l'application.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Application privee : on demande explicitement a ne pas etre indexee, en plus
  // du robots.txt, qui n'est qu'une consigne a la racine du site.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  // Produit .next/standalone : une image finale sans node_modules complet.
  output: "standalone",

  // N'expose pas la version de Next dans les en-tetes de reponse.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
