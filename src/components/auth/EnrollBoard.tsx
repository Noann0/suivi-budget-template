"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { Fingerprint, LifeBuoy, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";

import { useBrowserValue } from "@/components/lib/browserValue";

import { AuthButton, AuthCard, AuthError } from "@/components/auth/AuthCard";
import { CodeInput } from "@/components/auth/CodeInput";
import {
  friendlyActionError,
  friendlyWebAuthnError,
  type FriendlyError,
} from "@/components/lib/authMessages";
import type { AuthErrorReason } from "@/lib/result";
import { finishEnrollment, startEnrollment } from "@/actions/auth";

/** Cle de passage depuis /recover, pour ne pas faire transiter le code par l'URL. */
export const ENROLL_CODE_HANDOFF = "bud:enroll-code";
/** Echeance du code passe par /recover, en ISO. Cle separee, et facultative. */
export const ENROLL_CODE_HANDOFF_DEADLINE = "bud:enroll-code-deadline";

type Step = "code" | "explain";

function readHandoffCode(): string {
  try {
    return window.sessionStorage.getItem(ENROLL_CODE_HANDOFF) ?? "";
  } catch {
    return "";
  }
}

function readHandoffDeadline(): string {
  try {
    return window.sessionStorage.getItem(ENROLL_CODE_HANDOFF_DEADLINE) ?? "";
  } catch {
    return "";
  }
}

function forgetHandoff(): void {
  try {
    window.sessionStorage.removeItem(ENROLL_CODE_HANDOFF);
    window.sessionStorage.removeItem(ENROLL_CODE_HANDOFF_DEADLINE);
  } catch {
    // Sans stockage il n'y avait rien a effacer.
  }
}

/**
 * Heure d'echeance, au format "14h32", dans le fuseau de l'appareil.
 *
 * Une heure de fin est plus utilisable qu'une duree : "un quart d'heure" demande de
 * savoir depuis quand on compte, "jusqu'a 14h32" se lit d'un coup d'oeil et se
 * compare a l'horloge qu'elle a deja sous les yeux.
 */
function deadlineLabel(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const at = new Date(time);
  return `${String(at.getHours()).padStart(2, "0")}h${String(at.getMinutes()).padStart(2, "0")}`;
}

/** Motifs qui condamnent definitivement le code : le reproposer serait une boucle. */
function isCodeDead(reason: AuthErrorReason | undefined): boolean {
  return (
    reason === "enrollment_code_expired" ||
    reason === "enrollment_code_used" ||
    reason === "enrollment_code_unknown" ||
    reason === "enrollment_code_race"
  );
}

function deviceName(): string {
  if (typeof navigator === "undefined") return "Appareil";
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "Téléphone" : "Ordinateur";
}

/**
 * Premier enregistrement d'un appareil.
 *
 * Le parcours est volontairement coupe en DEUX gestes, et pas un seul :
 *
 * 1. le code est verifie par le serveur, qui prepare la demande ;
 * 2. on lui explique ce qui va s'ouvrir, PUIS elle appuie, et la fenetre systeme
 *    apparait dans la foulee immediate de son doigt.
 *
 * Deux raisons, l'une humaine et l'autre technique. Humaine : une boite de dialogue
 * systeme qui surgit sans prevenir fait annuler, et le mot "passkey" ne lui dirait
 * rien. Technique : `navigator.credentials.create()` veut une activation utilisateur
 * fraiche, or un aller-retour serveur au milieu du clic peut la consommer. En
 * separant, l'appel part d'un clic tout neuf.
 *
 * DEUX ENTREES, et c'est la correction principale de cet ecran.
 *
 * Elle arrive soit avec un code que l'administrateur lui a donne, qu'elle tape, soit depuis
 * /recover, ou le code a ete prepare en coulisses et ou elle n'a jamais rien vu. Le
 * champ etait auparavant pre-rempli avec ce code de coulisses, sans un mot pour dire
 * d'ou il venait ni jusqu'a quand il valait : elle a valide une valeur qu'elle
 * n'avait pas tapee, elle avait expire, et le message l'a envoyee sur le mauvais
 * ecran. La reponse n'est pas de vider ce champ, ce qui lui demanderait de retaper
 * une valeur qu'elle n'a jamais lue et casserait le dernier filet du parcours : c'est
 * de supprimer l'etape de saisie quand le code est deja connu, et de dire a l'ecran
 * ce qui a ete prepare et jusqu'a quelle heure. Une porte de sortie reste ouverte
 * pour taper un autre code, le cas ou l'administrateur en donne un au telephone.
 */
export function EnrollBoard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("code");
  // Le code peut arriver de /recover par le stockage de session. Deux valeurs lues
  // separement, et pas un objet : `useSyncExternalStore` compare les instantanes par
  // identite, un objet reconstruit a chaque lecture ferait boucler le rendu.
  const handedOverCode = useBrowserValue(readHandoffCode, "");
  const handedOverDeadline = useBrowserValue(readHandoffDeadline, "");
  const [typedCode, setTypedCode] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  /**
   * Code reellement accepte a l'etape 1, fige dans l'etat.
   *
   * Il ne peut PAS etre relu du stockage au moment de la ceremonie : `readHandoffCode`
   * est un instantane externe relu a chaque rendu, donc toute suppression de la cle
   * entre les deux etapes ferait partir la ceremonie avec un code vide. C'est ce qui
   * arrivait : le stockage etait efface des la validation du code, et l'etape 2
   * envoyait une chaine vide au serveur, apres que la fenetre systeme se soit ouverte
   * et qu'elle ait pose son doigt.
   */
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const [options, setOptions] = useState<PublicKeyCredentialCreationOptionsJSON | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [pending, startPending] = useTransition();
  const [ceremony, setCeremony] = useState(false);
  const supported = useBrowserValue(browserSupportsWebAuthn, true);
  // Il y en aura au moins trois, dont plusieurs du meme type. Trois lignes
  // identiques dans les reglages, et personne ne saura laquelle revoquer dans six
  // mois. On propose donc un nom, et elle le precise.
  const suggestedName = useBrowserValue(deviceName, "Appareil");
  const [typedName, setTypedName] = useState<string | null>(null);
  const label = typedName ?? suggestedName;

  const relayed = handedOverCode !== "" && !manualEntry;

  const submitCode = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setError({ message: "Tapez d'abord le code que l'administrateur vous a donné.", step: "retry" });
      return;
    }
    setError(null);
    startPending(async () => {
      const result = await startEnrollment({ code: trimmed });
      if (!result.ok) {
        // Un code condamne ne doit pas revenir tout seul a l'ecran suivant : sans
        // cet oubli, l'ecran reproposerait indefiniment un code que le serveur vient
        // de refuser pour de bon.
        if (isCodeDead(result.error.reason) && trimmed === handedOverCode.trim()) {
          forgetHandoff();
        }
        setError(friendlyActionError(result.error, "enroll"));
        return;
      }
      // Le stockage n'est PAS efface ici. Le serveur ne consomme le code qu'a l'etape
      // suivante, une fois la passkey reellement creee : l'effacer maintenant faisait
      // du moindre retour en arriere, rechargement compris, un cul-de-sac alors que
      // le code etait encore parfaitement valide.
      setSubmittedCode(trimmed);
      setOptions(result.data.options);
      setStep("explain");
    });
  };

  const runCeremony = async () => {
    if (options === null || submittedCode === null) return;
    setError(null);
    setCeremony(true);
    try {
      const response = await startRegistration({ optionsJSON: options });
      const result = await finishEnrollment({
        code: submittedCode,
        response,
        deviceName: label.trim() === "" ? suggestedName : label.trim(),
      });
      if (!result.ok) {
        const friendly = friendlyActionError(result.error, "enroll");
        setCeremony(false);
        if (isCodeDead(result.error.reason)) forgetHandoff();
        /**
         * Le defi est consomme PAR VALEUR des que le serveur regarde la reponse : ces
         * options ne valent plus rien, quel que soit le motif du refus. Les garder en
         * memoire laissait le bouton rejouer un defi mort, en boucle et sans fin.
         *
         * On revient donc a l'etape precedente, ou le bouton Continuer redemande une
         * demande neuve. Y compris quand cet appareil est deja enregistre : son code
         * n'a pas ete consomme, et le geste qui la sauve est souvent de recommencer
         * depuis un autre appareil.
         *
         * Une seule exception, la securite de debit : elle se declenche AVANT que le
         * serveur ne regarde le defi, donc les options en memoire sont encore bonnes
         * et le meme bouton suffira une fois le delai passe.
         */
        if (friendly.step !== "wait") {
          setOptions(null);
          setStep("code");
        }
        setError(friendly);
        return;
      }
      // Le code a servi, il est brule cote serveur : plus rien a garder.
      forgetHandoff();
      // On n'affiche PAS `result.data.recoveryCode` ici, meme s'il est renvoye.
      // Poser le cookie de session declenche une revalidation du segment, qui
      // re-rend enroll/page.tsx, qui redirige vers l'accueil avant que ce rendu
      // n'atteigne l'ecran. Mesure du backend : le code etait bien cree en base et
      // n'etait jamais montre, le filet de securite restait vide sans que personne
      // ne le sache. La coquille authentifiee prend le relais sur
      // `pendingRecoveryAck`, un etat persistant plutot qu'une course.
      router.replace("/");
      router.refresh();
    } catch (caught) {
      // Fenetre fermee ou refusee : le serveur n'a rien vu, le defi n'a pas ete
      // touche. Le meme bouton rejoue la meme demande, on reste donc sur place.
      setError(friendlyWebAuthnError(caught, "enroll"));
      setCeremony(false);
    }
  };

  if (!supported) {
    return (
      <AuthCard title="Ce navigateur ne convient pas">
        <p className="text-base text-ink">
          Cette page a besoin d&apos;un navigateur un peu plus récent pour reconnaître
          votre empreinte. Sur votre téléphone, ouvrez le site avec <strong>Chrome</strong>.
          Si le problème persiste, appelez l&apos;administrateur.
        </p>
      </AuthCard>
    );
  }

  if (step === "explain") {
    return (
      <AuthCard
        title="Votre appareil va vous le demander"
        intro="Encore une étape, et c'est la dernière."
      >
        <div className="flex items-start gap-3 rounded-md border border-line bg-carried px-4 py-4">
          <Fingerprint size={24} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-ink" />
          <div className="text-base text-ink">
            <p>
              Quand vous appuierez sur le bouton, votre appareil ouvrira sa propre
              fenêtre et vous demandera <strong>votre empreinte</strong>, votre visage
              ou le code qui le déverrouille. C&apos;est normal, et c&apos;est votre
              appareil qui pose la question, pas nous.
            </p>
            {/* Sur un ordinateur, cette fenetre propose souvent de passer par le
                telephone via un carre a photographier. Le prevenir coute une phrase
                et evite qu'elle referme la fenetre en croyant s'etre trompee. Aucune
                detection d'appareil ici : la phrase couvre les deux cas. */}
            <p className="mt-3">
              Sur un ordinateur, il se peut qu&apos;elle affiche un carré noir et blanc
              à photographier avec votre téléphone. C&apos;est prévu : votre téléphone
              prend alors le relais, et vous continuez sur lui.
            </p>
          </div>
        </div>

        <label className="mt-5 flex flex-col gap-2">
          <span className="text-base font-medium text-ink">
            Quel est cet appareil ?
          </span>
          <span className="text-sm text-ink-soft">
            Ce nom sert seulement à le reconnaître dans la liste, plus tard. Par
            exemple « Ordinateur du salon ».
          </span>
          <input
            type="text"
            value={label}
            onChange={(event) => setTypedName(event.target.value)}
            maxLength={40}
            autoComplete="off"
            enterKeyHint="done"
            className="tap rounded-sm border border-line bg-surface px-3 text-base text-ink"
          />
        </label>

        <p className="mt-4 text-base text-ink-soft">
          Laissez la fenêtre ouverte jusqu&apos;au bout. Ensuite, vous n&apos;aurez plus
          jamais de code à taper.
        </p>

        {error ? <AuthError message={error.message} step={error.step} /> : null}

        <div className="mt-5 flex flex-col gap-3">
          <AuthButton onClick={runCeremony} disabled={ceremony}>
            {ceremony ? "En cours..." : "J'y vais"}
          </AuthButton>
          <AuthButton
            variant="quiet"
            disabled={ceremony}
            onClick={() => {
              setStep("code");
              setOptions(null);
              setError(null);
            }}
          >
            Revenir en arrière
          </AuthButton>
        </div>
      </AuthCard>
    );
  }

  /**
   * Entree par le code de secours : rien a taper, et surtout rien a verifier a
   * l'aveugle. L'ecran dit d'ou vient cet enregistrement et jusqu'a quand il vaut.
   */
  if (relayed) {
    const deadline = deadlineLabel(handedOverDeadline);
    return (
      <AuthCard
        title="Votre code de secours a été reconnu"
        intro="Il ne reste plus qu'à enregistrer cet appareil."
      >
        <div className="flex items-start gap-3 rounded-md border border-line bg-carried px-4 py-4">
          <LifeBuoy size={24} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-ink" />
          <div className="text-base text-ink">
            <p>
              À partir de votre code de secours, nous avons préparé l&apos;enregistrement
              de cet appareil. <strong>Vous n&apos;avez rien à taper</strong>, tout est
              déjà en place.
            </p>
            <p className="mt-3 text-ink-soft">
              {deadline === null
                ? "C'est valable un petit quart d'heure. Passé ce délai, il suffira de retaper votre code de secours, et tout sera préparé à nouveau."
                : `C'est valable jusqu'à ${deadline}. Passé cette heure, il suffira de retaper votre code de secours, et tout sera préparé à nouveau.`}
            </p>
          </div>
        </div>

        {error ? <AuthError message={error.message} step={error.step} /> : null}

        <div className="mt-5">
          <AuthButton onClick={() => submitCode(handedOverCode)} disabled={pending}>
            {pending ? "Vérification..." : "Continuer"}
          </AuthButton>
        </div>

        {/* Porte de sortie : l'administrateur peut lui donner un autre code au telephone
            pendant qu'elle est sur cet ecran. Sans elle, l'ecran serait sans issue. */}
        <p className="mt-6 border-t border-line pt-5 text-sm text-ink-soft">
          L&apos;administrateur vient de vous donner un code à taper ?{" "}
          <button
            type="button"
            onClick={() => {
              setManualEntry(true);
              setError(null);
            }}
            className="font-medium text-accent-ink underline underline-offset-4"
          >
            Taper ce code
          </button>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Bienvenue dans votre budget"
      intro={
        <>
          L&apos;administrateur vous a donné un code. Vous le tapez une seule fois, aujourd&apos;hui.
          Ensuite, votre appareil vous reconnaîtra tout seul.
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitCode(typedCode);
        }}
        className="flex flex-col gap-5"
      >
        <CodeInput
          value={typedCode}
          onChange={setTypedCode}
          label="Votre code"
          hint="Recopiez-le exactement. Les tirets ne comptent pas, les minuscules non plus."
          invalid={error !== null && error.step === "retry"}
          disabled={pending}
          autoFocus
        />

        {error ? <AuthError message={error.message} step={error.step} /> : null}

        <AuthButton type="submit" disabled={pending}>
          {pending ? "Vérification..." : "Continuer"}
        </AuthButton>
      </form>

      {/* Retour possible vers l'enregistrement prepare, tant qu'il n'a pas ete
          condamne par le serveur : elle a pu ouvrir cette saisie par erreur. */}
      {manualEntry && handedOverCode !== "" ? (
        <p className="mt-4 text-sm text-ink-soft">
          <button
            type="button"
            onClick={() => {
              setManualEntry(false);
              setError(null);
            }}
            className="font-medium text-accent-ink underline underline-offset-4"
          >
            Revenir à l&apos;enregistrement préparé pour cet appareil
          </button>
        </p>
      ) : null}

      <div className="mt-6 flex items-start gap-3 border-t border-line pt-5">
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-soft" />
        <p className="text-sm text-ink-soft">
          Il n&apos;y a aucun mot de passe à retenir dans cette application. Votre
          appareil garde la clé, et lui seul.
        </p>
      </div>

      <p className="mt-4 text-sm text-ink-soft">
        Vous aviez déjà enregistré cet appareil ?{" "}
        <Link href="/login" className="font-medium text-accent-ink underline underline-offset-4">
          Se connecter
        </Link>
      </p>
    </AuthCard>
  );
}
