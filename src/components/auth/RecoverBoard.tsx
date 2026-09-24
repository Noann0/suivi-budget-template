"use client";

import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AuthButton, AuthCard, AuthError } from "@/components/auth/AuthCard";
import { CodeInput } from "@/components/auth/CodeInput";
import {
  ENROLL_CODE_HANDOFF,
  ENROLL_CODE_HANDOFF_DEADLINE,
} from "@/components/auth/EnrollBoard";
import { friendlyActionError, type FriendlyError } from "@/components/lib/authMessages";
import { redeemRecoveryCode } from "@/actions/auth";

/**
 * Chemin de secours, emprunte le jour ou le telephone est perdu ou remplace.
 *
 * Le code de secours ne connecte pas directement : il rend un code d'enrolement, qui
 * sert ensuite a enregistrer le nouvel appareil. On enchaine donc toute seule vers
 * l'enregistrement, en passant le code par le stockage de session plutot que par
 * l'URL : un secret n'a rien a faire dans un historique de navigation.
 *
 * L'echeance voyage avec le code, dans une cle a part. Elle etait jusqu'ici rendue
 * par le serveur puis jetee, et l'ecran suivant affichait donc un code sans jamais
 * dire jusqu'a quand il valait : un quart d'heure, ce qui se depasse tres vite quand
 * on cherche son telephone. Cle separee et non objet serialise, pour qu'un
 * enregistrement deja en cours au moment d'une mise en ligne reste lisible.
 */
export function RecoverBoard() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [pending, startPending] = useTransition();

  const submit = () => {
    const trimmed = code.trim();
    if (trimmed === "") {
      setError({ message: "Tapez d'abord votre code de secours.", step: "retry" });
      return;
    }
    setError(null);
    startPending(async () => {
      const result = await redeemRecoveryCode({ code: trimmed });
      if (!result.ok) {
        setError(friendlyActionError(result.error, "recover"));
        return;
      }
      try {
        // Echeance d'abord, code ensuite : c'est la presence du code qui declenche
        // l'ecran d'enregistrement prepare. Dans cet ordre, un stockage qui refuse a
        // mi-chemin ne peut pas produire un enregistrement prepare sans son heure.
        window.sessionStorage.setItem(ENROLL_CODE_HANDOFF_DEADLINE, result.data.expiresAt);
        window.sessionStorage.setItem(ENROLL_CODE_HANDOFF, result.data.enrollmentCode);
      } catch {
        // Sans stockage, on ne peut pas passer le code discretement. Plutot que de
        // le mettre dans l'URL, on l'affiche et elle le recopie a l'ecran suivant.
        // L'echeance part avec, sinon elle recopierait un code sans savoir qu'il se
        // perime dans un quart d'heure.
        window.alert(
          "Notez ce code, il vous sera demandé à l'écran suivant : " +
            `${result.data.enrollmentCode}\n\n` +
            "Il est valable un quart d'heure. Au-delà, revenez ici et retapez votre code de secours.",
        );
      }
      router.push("/enroll");
    });
  };

  return (
    <AuthCard
      title="Retrouver l'accès"
      intro="Le code de secours est celui que l'administrateur a mis de côté le premier jour."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-5"
      >
        <CodeInput
          value={code}
          onChange={setCode}
          label="Votre code de secours"
          hint="Recopiez-le en entier. Les tirets ne comptent pas, les minuscules non plus."
          invalid={error !== null && error.step === "retry"}
          disabled={pending}
          autoFocus
        />

        {error ? <AuthError message={error.message} step={error.step} /> : null}

        <AuthButton type="submit" disabled={pending}>
          {pending ? "Vérification..." : "Continuer"}
        </AuthButton>
      </form>

      <div className="mt-6 flex items-start gap-3 border-t border-line pt-5">
        <LifeBuoy size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-soft" />
        <p className="text-sm text-ink-soft">
          Vous ne retrouvez pas ce code ? Appelez l&apos;administrateur, il peut vous en redonner un
          depuis son propre appareil. Rien n&apos;est perdu, vos mois sont toujours là.
        </p>
      </div>

      <p className="mt-4 text-sm text-ink-soft">
        <Link href="/login" className="font-medium text-accent-ink underline underline-offset-4">
          Revenir à la connexion
        </Link>
      </p>
    </AuthCard>
  );
}
