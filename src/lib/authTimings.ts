/**
 * Les durees de la ceremonie WebAuthn, en un seul endroit.
 *
 * Elles ne sont pas independantes : elles decrivent le meme chronometre, celui du
 * defi, observe depuis trois points du parcours. Les tenir dans deux fichiers
 * eloignes revenait a confier leur coherence a des commentaires, c'est-a-dire a
 * personne. Elle est desormais portee par le code.
 *
 * Ce module est volontairement PUR : aucune importation serveur, aucune lecture
 * d'environnement, aucun effet de bord autre que la verification ci-dessous. Il est
 * importe a la fois par la ceremonie cote serveur (src/server/auth/webauthn.ts) et
 * par l'ecran de connexion, qui est un composant client. Une seule dependance
 * serveur ici casserait le bundle client.
 */

/**
 * Duree de vie du defi cote serveur.
 *
 * Le compte a rebours demarre a la GENERATION des options, pas au clic : sur l'ecran
 * de connexion elles sont prechargees au montage de la page, et sur l'ecran
 * d'enrolement elles sont produites a la saisie du code, avant l'ecran
 * d'explication. Le temps passe a lire, a chercher son telephone ou a le deverrouiller
 * est donc deja entame sur ce budget.
 */
export const CHALLENGE_TTL_SECONDS = 10 * 60;

/** La meme duree en millisecondes, unite de tout ce qui suit. */
export const CHALLENGE_TTL_MS = CHALLENGE_TTL_SECONDS * 1000;

/**
 * Delai laisse a la fenetre du systeme, passe a l'authentificateur.
 *
 * Sans lui, la bibliotheque applique 60 000 ms : une minute pour lire une
 * explication, prendre son telephone et poser son doigt. C'est trop peu pour une
 * premiere fois, et l'echec ressemble alors a une panne alors que c'est un
 * chronometre. 300 000 ms est la valeur recommandee par la specification WebAuthn
 * pour une ceremonie avec verification de l'utilisatrice.
 */
export const CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Age au-dela duquel des options de connexion prechargees sont jetees et redemandees
 * au clic (voir l'ecran de connexion, src/components/auth/LoginBoard.tsx).
 *
 * VALEUR DERIVEE, ET C'EST LE POINT. Elle n'est pas "cinq minutes comme la ceremonie",
 * elle est ce qui RESTE du budget du defi une fois la ceremonie provisionnee. Les deux
 * lectures donnent le meme nombre aujourd'hui (10 - 5 = 5) et c'est une coincidence
 * arithmetique : le jour ou le defi passe a quinze minutes, seule la soustraction
 * reste juste.
 *
 * Le raisonnement tient au sens de l'erreur, qui n'est pas symetrique. Au clic, les
 * options peuvent avoir jusqu'a OPTIONS_FRESHNESS_MS d'age, et la fenetre du systeme
 * peut ensuite tenir jusqu'a CEREMONY_TIMEOUT_MS. Le serveur, lui, n'accepte la
 * reponse que si elle arrive avant l'echeance posee A LA GENERATION
 * (`expires_at > now`, src/server/repositories/auth.ts:344-355). Il faut donc que
 * age + ceremonie tienne dans la duree de vie du defi :
 *
 *     OPTIONS_FRESHNESS_MS + CEREMONY_TIMEOUT_MS <= CHALLENGE_TTL_MS
 *
 * Trop grande, elle laisse l'utilisatrice aller au bout du geste, empreinte comprise,
 * pour un defi que le serveur a deja jete : un refus au pire moment, sans rien a
 * faire de son geste. Trop petite, elle coute un aller-retour serveur inutile avant
 * la fenetre systeme. La borne est donc un maximum, et la difference est la plus
 * grande valeur sure : on la prend.
 */
export const OPTIONS_FRESHNESS_MS = CHALLENGE_TTL_MS - CEREMONY_TIMEOUT_MS;

/**
 * Reste une seule facon de rompre la coherence : donner a la ceremonie un delai
 * superieur ou egal a la duree de vie du defi. La fraicheur derivee tomberait alors a
 * zero ou dans le negatif, ce qui veut dire qu'aucun instant du clic ne garantit plus
 * d'aller au bout du geste. C'est exactement l'assertion qui vivait dans webauthn.ts,
 * ecrite ici sur la valeur derivee : elle couvre donc aussi la constante du client,
 * qui ne peut plus, elle, etre desynchronisee.
 *
 * L'echec est volontairement brutal et immediat : il se produit au chargement du
 * module, donc au demarrage du serveur comme a la compilation des pages qui
 * l'importent. Un demarrage refuse se voit ; une authentification qui refuse une
 * reponse sur deux ne se voit pas.
 */
if (OPTIONS_FRESHNESS_MS <= 0) {
  throw new Error(
    "CEREMONY_TIMEOUT_MS doit rester strictement inferieur a CHALLENGE_TTL_SECONDS : " +
      "sans cela, le navigateur accepte encore une reponse pour un defi deja jete par le serveur.",
  );
}
