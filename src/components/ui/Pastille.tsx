import { cn } from "@/components/lib/cn";
import { hueName, hueStyle } from "@/components/lib/palette";
import type { ColorIntensity } from "@/lib/types";

type Props = {
  hue: number;
  intensity?: ColorIntensity | null;
  /** 12px dans les listes et legendes, 20px dans les reglages. */
  size?: 12 | 16 | 20;
  className?: string;
};

/**
 * Pastille de couleur d'une categorie.
 *
 * Elle n'identifie jamais seule : le plan impose pastille + nom partout. Le nom de
 * la teinte part donc dans le titre accessible, et la pastille reste `aria-hidden`
 * puisque le libelle textuel est toujours a cote.
 */
export function Pastille({ hue, intensity = null, size = 12, className }: Props) {
  return (
    <span
      aria-hidden="true"
      title={hueName(hue)}
      style={{ ...hueStyle(hue, intensity), width: size, height: size }}
      className={cn(
        "inline-block shrink-0 rounded-full bg-[var(--cat-surface)]",
        "ring-1 ring-black/5",
        className,
      )}
    />
  );
}
