# Scripts QA manuels (Playwright + WebAuthn virtuel)

Pas une suite automatisée branchée sur `npm test` : des scripts de reference pour
qui doit refranchir l'authentification WebAuthn en local, a la main ou en CI plus
tard. Ecrits le 2026-08-30 lors du premier passage QA sur l'app rendue.

## Prerequis

- `playwright` est desormais une **devDependency declaree** du projet, epinglee a
  `1.62.1`. Un simple `npm install` a la racine suffit, il n'y a plus rien a
  installer a la main :
  ```
  npm install
  ```
  Motif de ce choix : cette recette est le seul moyen connu de franchir
  l'authentification WebAuthn en automatisation sur ce projet, et elle a coute
  trois essais avant de fonctionner. Non declaree, elle etait inutilisable sans
  reinstallation manuelle, et la prochaine personne repartait de zero.

  Cela ne pese rien en production : l'etage final du `Dockerfile` ne recopie que
  `.next/standalone`, `.next/static` et `public`. Verifie par mesure le
  2026-08-30, image reconstruite avant et apres l'ajout : **406 Mo dans les deux
  cas**, et `playwright` absent de l'image finale.

- Le **navigateur** Chromium, lui, n'est pas dans le paquet npm et doit etre
  telecharge une fois par machine (environ 150 Mo, dans un cache global hors du
  depot) :
  ```
  npx playwright install --dry-run chromium   # dit s'il est deja en cache
  npx playwright install chromium             # sinon, le telecharge
  ```
  Ni `playwright` ni `playwright-core` n'ont de script `postinstall` en 1.62.1 :
  rien ne se telecharge tout seul, ni sur ta machine ni pendant le build Docker.

## Rejouer la recette, commande exacte

Depuis la **racine du depot**, avec le serveur de developpement lance a cote :

```
rm -f data/budget.db data/budget.db-shm data/budget.db-wal   # base vierge
npm run dev                                                   # dans un autre terminal
node e2e/enroll.mjs
```

Le script lit `INITIAL_ENROLLMENT_CODE` depuis l'environnement. Si ton `.env`
n'est pas charge automatiquement, passe-le explicitement :

```
INITIAL_ENROLLMENT_CODE=<la valeur de ton .env> node e2e/enroll.mjs
```
- **Executer les scripts depuis la racine du projet.** Node resout les modules
  ESM depuis l'emplacement du fichier, pas depuis le cwd : un script place hors
  de l'arbre du depot ne retrouvera jamais `node_modules/playwright`.
- Un `.env` local avec un `INITIAL_ENROLLMENT_CODE` connu (voir `.env.example`).
  Pour un enrolement reproductible, vider `data/budget.db*` avant de lancer le
  serveur : `seedInitialEnrollmentCode()` ne seme un code que si `credentials`
  est vide.

## La recette qui a marche, ce qui a coince avant

- **CDP `WebAuthn.addVirtualAuthenticator`** est le chemin normal, confirme par
  le brief : `protocol: "ctap2"`, `transport: "internal"`, `hasResidentKey:
  true`, `hasUserVerification: true`, `isUserVerified: true`,
  `automaticPresenceSimulation: true`. Sans `automaticPresenceSimulation`, la
  ceremonie reste en attente indefiniment (aucun geste humain simule).
- Le parcours d'enrolement de cette app est coupe en DEUX ecrans successifs
  (voir `EnrollBoard.tsx`) : saisie du code -> clic "Continuer", PUIS un ecran
  d'explication -> clic "J'y vais" qui declenche reellement
  `navigator.credentials.create()`. Un script qui ne clique que sur
  "Continuer" ne verra jamais la ceremonie WebAuthn.
- Le lien "Mois suivant" / "Mois precedent" du calendrier est un `<Link>`
  (role `link`), pas un `<button>` : `getByRole('button', {name: /mois
  suivant/i})` ne trouve jamais rien, silencieusement (timeout, pas d'erreur
  explicite). Utiliser `getByRole('link', ...)`.
- Pour reutiliser une session entre deux scripts sans refranchir WebAuthn a
  chaque fois : `context.storageState({ path })` en fin de script, puis
  `browser.newContext({ storageState: path })` dans le suivant.

## Fichiers

- `enroll.mjs` : enrolement complet (code -> explication -> ceremonie WebAuthn)
  sur une base vierge, jusqu'a l'ecran d'accueil. Log l'URL finale et le texte
  visible, utile pour verifier en un coup d'oeil qu'aucune redirection
  intempestive n'a coupe le parcours avant la fin.
