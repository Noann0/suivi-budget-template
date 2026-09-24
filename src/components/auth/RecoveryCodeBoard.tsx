"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AuthButton, AuthCard, AuthError } from "@/components/auth/AuthCard";
import { RecoveryCodeReveal } from "@/components/auth/RecoveryCodeReveal";
import { screenErrorMessage } from "@/components/lib/screenErrors";
import { acknowledgeRecoveryCode, revealRecoveryCode } from "@/actions/auth";

type Props = {
  /** Ou revenir une fois le code acquitte. */
  destination: string;
  /** Vrai quand elle arrive ici parce qu'un code emis n'a jamais ete acquitte. */
  pendingAck: boolean;
};

/**
 * Ecran du code de secours (contrat docs/API.md section 5.3.1).
 *
 * Deux temps, et le decoupage n'est pas cosmetique.
 *
 * D'abord l'avertissement, ensuite le code. `revealRecoveryCode()` REGENERE le code
 * et invalide le precedent a chaque appel : c'est la seule facon honnete de
 * reafficher un secret qui n'est stocke que hache. Consequence pour elle, un
 * rechargement rend caduc le papier qu'elle vient d'ecrire. Elle doit donc lire cet
 * avertissement AVANT qu'un code n'apparaisse, pas apres.
 *
 * Le declenchement par bouton, et non au montage, sert aussi a la mesure : l'action
 * consomme le seau `enrollmentCreate`, dix par heure et par session. Un appel dans un
 * effet en brulerait deux a chaque affichage a cause du double montage de
 * developpement, et un rechargement machinal en brulerait un de plus.
 */
export function RecoveryCodeBoard({ destination, pendingAck }: Props) {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, startRevealing] = useTransition();
  const [acknowledging, startAcknowledging] = useTransition();

  const reveal = () => {
    setError(null);
    startRevealing(async () => {
      const result = await revealRecoveryCode();
      if (!result.ok) {
        setError(screenErrorMessage(result.error));
        return;
      }
      setCode(result.data.recoveryCode);
    });
  };

  const acknowledge = () => {
    setError(null);
    startAcknowledging(async () => {
      const result = await acknowledgeRecoveryCode();
      if (!result.ok) {
        setError(screenErrorMessage(result.error));
        return;
      }
      router.replace(destination);
      router.refresh();
    });
  };

  if (code !== null) {
    return <RecoveryCodeReveal code={code} onDone={acknowledge} pending={acknowledging} />;
  }

  return (
    <AuthCard
      title={pendingAck ? "Une dernière chose à mettre de côté" : "Nouveau code de secours"}
      intro={
        pendingAck
          ? "Votre budget est prêt. Il reste un code à ranger, et vous n'y toucherez plus jamais."
          : "Vous êtes sur le point de créer un nouveau code de secours."
      }
    >
      <div className="flex items-start gap-3 rounded-md border border-line bg-carried px-4 py-4">
        <KeyRound size={24} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-ink" />
        <div className="text-base text-ink">
          <p>
            Ce code sert une seule fois, le jour où le téléphone serait perdu ou
            remplacé. <strong className="font-semibold">Il est destiné à l&apos;administrateur</strong>,
            qui le rangera dans son gestionnaire de mots de passe.
          </p>
          <p className="mt-3">
            Le code ne peut pas être conservé en clair de notre côté, c&apos;est ce qui
            le protège. Il est donc impossible de vous remontrer celui d&apos;avant :
            l&apos;afficher revient toujours à en{" "}
            <strong className="font-semibold">créer un nouveau</strong>, et
            l&apos;ancien cesse aussitôt de fonctionner.
          </p>
          <p className="mt-3">
            Avant d&apos;appuyer, ayez de quoi le noter sous la main. Ne rechargez pas
            la page une fois qu&apos;il sera affiché.
          </p>
        </div>
      </div>

      {error ? <AuthError message={error} /> : null}

      <div className="mt-5">
        <AuthButton onClick={reveal} disabled={revealing}>
          {revealing ? "Un instant..." : "Je suis prête, afficher le code"}
        </AuthButton>
      </div>

      {/* Sortie possible UNIQUEMENT quand aucun code n'est en attente d'acquittement.
          Quand il y en a un, l'ecran ne se quitte pas : c'est exactement ce que la
          regle de la coquille authentifiee garantit. */}
      {pendingAck ? null : (
        <p className="mt-4 text-center text-sm text-ink-soft">
          <Link
            href={destination}
            className="font-medium text-accent-ink underline underline-offset-4"
          >
            Finalement non, revenir en arrière
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
