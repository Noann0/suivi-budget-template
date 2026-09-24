"use client";

import { useState, useTransition } from "react";

import { useActionError } from "@/components/lib/useActionError";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { setColorIntensity } from "@/actions/preferences";
import type { ColorIntensity } from "@/lib/types";

const OPTIONS = [
  { value: "soft", label: "Douces" },
  { value: "vivid", label: "Franches" },
] as const;

type Props = {
  intensity: ColorIntensity;
  onError: (message: string | null) => void;
  /** Appele avec la valeur choisie, pour mettre a jour l'apercu sans attendre. */
  onPreview: (intensity: ColorIntensity) => void;
};

/**
 * Interrupteur global d'intensite (plan, decision 1).
 *
 * Un seul reglage pour toutes les categories, volontairement. Le melange libre
 * pastel/franche passe la mesure de distinction, mais un secteur sature au milieu
 * de pastels laisse croire a une hierarchie de depenses qui n'existe pas. Seize
 * teintes plus un interrupteur, ca fait dix-sept decisions au lieu de trente-deux.
 */
export function IntensityToggle({ intensity, onError, onPreview }: Props) {
  const [pending, startTransition] = useTransition();
  const resolveError = useActionError();
  // Etat local plutot que useOptimistic : la valeur serveur n'est rafraichie que
  // par une navigation, un optimistic reviendrait a l'ancienne valeur en fin de
  // transition et l'interrupteur reculerait sous son doigt.
  const [shown, setShown] = useState<ColorIntensity>(intensity);

  return (
    <div className="card px-4 py-4">
      <h2 className="font-display text-lg font-semibold text-ink">Couleurs</h2>
      <p className="mt-1 mb-3 text-sm text-ink-soft">
        Le réglage s&apos;applique à toutes vos catégories d&apos;un coup.
      </p>
      <SegmentedControl
        label="Intensité des couleurs"
        options={OPTIONS}
        value={shown}
        disabled={pending}
        onChange={(next) => {
          onError(null);
          onPreview(next);
          setShown(next);
          startTransition(async () => {
            const result = await setColorIntensity({ intensity: next });
            if (!result.ok) {
              onError(resolveError(result.error));
              setShown(intensity);
              onPreview(intensity);
            }
          });
        }}
      />
    </div>
  );
}
