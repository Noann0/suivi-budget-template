import { NextResponse } from "next/server";

import { getDb, queryOne } from "@/db/client";
import { getSchemaVersion, LATEST_VERSION } from "@/db/migrate";
import { describeError, logger } from "@/lib/logger";

/**
 * Sonde de sante lue par Dokploy.
 *
 * Elle TOUCHE REELLEMENT la base : un 200 en dur ne prouverait rien, et surtout pas
 * que le volume /data est monte et accessible. Or c'est le mode de panne le plus
 * probable en production, et celui qu'un conteneur "en bonne sante" masquerait le
 * mieux. On lit donc la version de schema et on compte une table metier.
 *
 * La version lue est comparee a LATEST_VERSION, pas a 1. Un simple `version < 1` ne
 * mesurait que l'existence d'un schema : apres une migration echouee, la base restait
 * en version ancienne, la sonde repondait 200, l'hebergeur declarait le conteneur sain
 * et l'application servait du code neuf sur un schema perime pendant qu'on saisit
 * dedans. L'egalite stricte couvre aussi le sens inverse, une image plus ancienne
 * remise en service sur une base deja migree : la aussi le code et le schema ne se
 * correspondent pas, et la aussi il vaut mieux un conteneur refuse qu'une ecriture
 * fausse. Meme comparaison que `npm run db:migrate`, qui sortait deja en erreur sur
 * cette condition exacte.
 */

// Jamais mise en cache : une sonde de sante servie depuis un cache ne mesure rien.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    const version = getSchemaVersion(db);
    const row = queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM categories");

    if (version !== LATEST_VERSION || row === null) {
      throw new Error(
        `Base joignable mais schema en version ${version}, attendu ${LATEST_VERSION}`,
      );
    }

    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        migrations: version,
        categories: row.total,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Sonde de sante en echec", describeError(error));
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
