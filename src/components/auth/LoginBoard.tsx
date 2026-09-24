"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication as startBrowserAuthentication,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBrowserValue } from "@/components/lib/browserValue";

import { AuthButton, AuthCard, AuthError } from "@/components/auth/AuthCard";
import {
  friendlyActionError,
  friendlyWebAuthnError,
  safeNextPath,
  type FriendlyError,
} from "@/components/lib/authMessages";
import { OPTIONS_FRESHNESS_MS } from "@/lib/authTimings";
import { finishAuthentication, startAuthentication } from "@/actions/auth";

/**
 * Ecran de connexion.
 *
 * En pratique elle ne le verra presque jamais : la session dure un an et se prolonge
 * a chaque visite. Quand il apparait, il n'y a donc qu'une chose a faire, et un seul
 * bouton pour la faire. Pas de formulaire, pas de champ, rien a retenir.
 *
 * Les options de connexion sont prechargees au montage, pas au clic : elles portent
 * un defi a usage unique, et le clic n'a alors plus qu'a ouvrir la fenetre du
 * systeme, sans aller-retour serveur au milieu du geste.
 *
 * Le prechargement a un cout : le chronometre du defi demarre a sa GENERATION, donc
 * pendant qu'elle lit l'ecran, cherche son telephone ou repond au telephone. Passe la
 * duree de vie du defi, elle ferait tout le geste, empreinte comprise, pour se voir
 * refuser a l'arrivee. C'est le pire moment pour echouer.
 *
 * L'arbitrage retenu : on garde le prechargement, mais on jette les options passe
 * OPTIONS_FRESHNESS_MS et on en redemande au clic. Le cout, un aller-retour serveur
 * avant la fenetre systeme, qui peut consommer l'activation utilisateur, n'est donc
 * paye QUE dans le cas ou l'alternative etait un echec certain. Le seuil vaut la
 * duree de la ceremonie elle-meme : au moment du clic, il reste ainsi toujours de
 * quoi aller au bout du geste avant que le serveur ne jette le defi.
 */
export function LoginBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeNextPath(searchParams.get("next"));
  // Pose par les ecrans du budget quand la session n'est plus valide. Sans cette
  // explication, l'ecran de connexion surgirait au milieu de sa saisie sans raison
  // apparente, et elle croirait avoir perdu ce qu'elle venait de taper.
  const expired = searchParams.get("expired") === "1";

  // Au rendu serveur on suppose le navigateur compatible : afficher un ecran
  // d'incompatibilite le temps de l'hydratation la ferait fuir pour rien.
  const supported = useBrowserValue(browserSupportsWebAuthn, true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useRef<PublicKeyCredentialRequestOptionsJSON | null>(null);
  /** Instant de generation des options en memoire, pour mesurer leur fraicheur. */
  const optionsIssuedAt = useRef(0);

  const fetchOptions = useCallback(async (): Promise<
    PublicKeyCredentialRequestOptionsJSON | null
  > => {
    const result = await startAuthentication();
    if (!result.ok) {
      options.current = null;
      setError(friendlyActionError(result.error, "login"));
      return null;
    }
    options.current = result.data.options;
    optionsIssuedAt.current = Date.now();
    return result.data.options;
  }, []);

  useEffect(() => {
    // Prechargement silencieux, dans une ref et non dans un etat : une erreur ici ne
    // doit ni redessiner l'ecran, ni l'accueillir avec un message rouge alors
    // qu'elle n'a encore rien fait. Le clic redemandera des options fraiches.
    void startAuthentication().then((result) => {
      if (result.ok) {
        options.current = result.data.options;
        optionsIssuedAt.current = Date.now();
      }
    });
  }, []);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      // Des options trop vieilles sont jetees AVANT d'ouvrir la fenetre : mieux vaut
      // un aller-retour de plus qu'un refus apres qu'elle a pose son doigt.
      const fresh =
        options.current !== null && Date.now() - optionsIssuedAt.current < OPTIONS_FRESHNESS_MS;
      const current = fresh ? options.current : await fetchOptions();
      if (current === null) {
        setBusy(false);
        return;
      }

      let response;
      try {
        response = await startBrowserAuthentication({ optionsJSON: current });
      } catch (caught) {
        setError(friendlyWebAuthnError(caught, "login"));
        // Rien n'est parti au serveur ici : le defi n'a pas ete touche et reste
        // valable. On garde donc les options, et c'est le controle de fraicheur
        // ci-dessus qui decidera au prochain clic s'il faut en redemander. Les jeter
        // systematiquement faisait payer un aller-retour serveur juste apres une
        // fenetre refermee, c'est-a-dire au moment ou elle reappuie tout de suite.
        setBusy(false);
        return;
      }

      const result = await finishAuthentication({ response });
      if (!result.ok) {
        setError(friendlyActionError(result.error, "login"));
        // Le serveur a regarde la reponse, donc consomme le defi par sa valeur : ces
        // options sont mortes quel que soit le motif du refus. Les garder ferait
        // rejouer un defi mort a chaque appui, sans fin.
        options.current = null;
        setBusy(false);
        return;
      }

      router.replace(destination);
      router.refresh();
    } catch {
      setError({
        message: "La connexion n'a pas abouti. Réessayez dans un instant.",
        step: "retry",
      });
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <AuthCard title="Ce navigateur ne convient pas">
        <p className="text-base text-ink">
          Cette page a besoin d&apos;un navigateur un peu plus récent pour reconnaître
          votre empreinte. Sur votre téléphone, ouvrez le site avec <strong>Chrome</strong>.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Votre budget"
      intro={
        expired
          ? "Vous avez été déconnectée. Vos données sont intactes, il suffit de vous identifier à nouveau."
          : "Votre téléphone va vous reconnaître."
      }
    >
      <div className="flex flex-col items-center gap-5">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-positive-soft text-positive"
        >
          <Fingerprint size={32} />
        </span>

        <AuthButton onClick={connect} disabled={busy}>
          {busy ? "Un instant..." : "Entrer dans mon budget"}
        </AuthButton>
      </div>

      {error ? <AuthError message={error.message} step={error.step} /> : null}

      <p className="mt-6 border-t border-line pt-5 text-sm text-ink-soft">
        Vous avez changé de téléphone, ou vous l&apos;avez perdu ?{" "}
        <Link href="/recover" className="font-medium text-accent-ink underline underline-offset-4">
          Utiliser le code de secours
        </Link>
      </p>
    </AuthCard>
  );
}
