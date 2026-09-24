"use client";

import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState, useTransition } from "react";

import { HuePicker, type PreviewSlice } from "@/components/HuePicker";
import { IntensityToggle } from "@/components/IntensityToggle";
import { cn } from "@/components/lib/cn";
import { useActionError } from "@/components/lib/useActionError";
import { Pastille } from "@/components/ui/Pastille";
import { Sheet } from "@/components/ui/Sheet";
import {
  archiveCategory,
  createCategory,
  reorderCategories,
  updateCategory,
} from "@/actions/categories";
import {
  archiveSubcategory,
  createSubcategory,
  updateSubcategory,
} from "@/actions/subcategories";
import type { CategoryKind, CategoryWithSubs, ColorIntensity, Hue } from "@/lib/types";

type Props = {
  categories: CategoryWithSubs[];
  intensity: ColorIntensity;
};

/**
 * Ecran des reglages et des categories (plan, section 8).
 *
 * Le reordonnancement se fait par deux boutons de 44px, pas par glisser-deposer :
 * sur un Android tenu a une main, un drag reste la manipulation la plus ratee, et
 * elle n'a aucun equivalent clavier. Deux fleches sont utilisables du premier coup.
 */
export function SettingsBoard({
  categories: initial,
  intensity: initialIntensity,
}: Props) {
  const [categories, setCategories] = useState(initial);
  const [intensity, setIntensity] = useState<ColorIntensity>(initialIntensity);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resolveError = useActionError();

  const openCategory = categories.find((category) => category.id === openId) ?? null;

  const previewSlices = useMemo<PreviewSlice[]>(
    () =>
      categories
        .filter((category) => category.kind === "expense")
        .slice(0, 6)
        .map((category, index) => ({
          id: category.id,
          label: category.name,
          hue: category.hue,
          // Poids decroissants : l'apercu montre des secteurs de tailles differentes,
          // ce qui est plus fidele qu'un camembert regulier.
          amountCents: 6000 - index * 800,
        })),
    [categories],
  );

  const replace = useCallback((updated: CategoryWithSubs) => {
    setCategories((current) =>
      current.map((category) => (category.id === updated.id ? { ...category, ...updated } : category)),
    );
  }, []);

  const move = (id: string, direction: -1 | 1) => {
    const category = categories.find((item) => item.id === id);
    if (!category) return;
    const sameKind = categories.filter((item) => item.kind === category.kind);
    const index = sameKind.findIndex((item) => item.id === id);
    const target = index + direction;
    if (target < 0 || target >= sameKind.length) return;

    const reordered = [...sameKind];
    const [moved] = reordered.splice(index, 1);
    if (moved) reordered.splice(target, 0, moved);

    const others = categories.filter((item) => item.kind !== category.kind);
    setCategories(
      category.kind === "income" ? [...reordered, ...others] : [...others, ...reordered],
    );

    setError(null);
    startTransition(async () => {
      const result = await reorderCategories({ ids: reordered.map((item) => item.id) });
      if (!result.ok) {
        setError(resolveError(result.error));
        setCategories(initial);
      }
    });
  };

  const addCategory = (kind: CategoryKind) => {
    setError(null);
    // Aucune teinte n'est envoyee : c'est `pickHue` cote serveur qui attribue, avec
    // un compteur par nature (depenses depuis la tete de sequence, revenus depuis la
    // queue). Recalculer la sequence ici donnerait deux implementations de la meme
    // regle mesuree, et elles finiraient par diverger. On affiche ce que le serveur
    // renvoie, elle peut ensuite en changer dans la fiche.
    startTransition(async () => {
      const result = await createCategory({ name: "Nouvelle catégorie", kind });
      if (!result.ok) {
        setError(resolveError(result.error));
        return;
      }
      setCategories((current) => [...current, { ...result.data, subcategories: [] }]);
      setOpenId(result.data.id);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="rounded-md border border-negative/40 bg-negative-soft px-4 py-3 text-base text-ink">
          {error}
        </p>
      ) : null}

      <IntensityToggle intensity={intensity} onError={setError} onPreview={setIntensity} />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      {(["expense", "income"] as const).map((kind) => (
        <section key={kind} aria-labelledby={`settings-${kind}`} className="card px-3 py-3">
          <header className="flex items-baseline justify-between px-1 pb-2">
            <h2 id={`settings-${kind}`} className="font-display text-lg font-semibold text-ink">
              {kind === "expense" ? "Catégories de dépenses" : "Catégories de revenus"}
            </h2>
          </header>

          <ul className="flex flex-col">
            {categories
              .filter((category) => category.kind === kind && !category.isArchived)
              .map((category, index, list) => (
                <li
                  key={category.id}
                  className="flex items-center gap-1 border-b border-line/60 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(category.id)}
                    className="tap flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1 text-left"
                  >
                    <Pastille hue={category.hue} intensity={category.intensity} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-ink">{category.name}</span>
                      <span className="text-sm text-ink-soft">
                        {category.subcategories.filter((sub) => !sub.isArchived).length} sous-catégories
                      </span>
                    </span>
                    <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-soft" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(category.id, -1)}
                    disabled={index === 0 || pending}
                    className="tap flex shrink-0 items-center justify-center rounded-sm text-ink-soft disabled:opacity-30"
                  >
                    <ChevronUp size={18} aria-hidden="true" />
                    <span className="sr-only">Monter {category.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(category.id, 1)}
                    disabled={index === list.length - 1 || pending}
                    className="tap flex shrink-0 items-center justify-center rounded-sm text-ink-soft disabled:opacity-30"
                  >
                    <ChevronDown size={18} aria-hidden="true" />
                    <span className="sr-only">Descendre {category.name}</span>
                  </button>
                </li>
              ))}
          </ul>

          <button
            type="button"
            onClick={() => addCategory(kind)}
            disabled={pending}
            className="tap mt-2 flex items-center gap-2 rounded-sm px-2 text-base font-medium text-accent-ink disabled:opacity-50"
          >
            <Plus size={18} aria-hidden="true" />
            Ajouter une catégorie
          </button>
        </section>
      ))}
      </div>

      <CategorySheet
        category={openCategory}
        intensity={intensity}
        usedHues={categories
          .filter((category) => category.id !== openId)
          .map((category) => category.hue)}
        previewSlices={previewSlices}
        onClose={() => setOpenId(null)}
        onError={setError}
        onReplace={replace}
        onArchived={(id) => {
          setCategories((current) => current.filter((category) => category.id !== id));
          setOpenId(null);
        }}
      />
    </div>
  );
}

function CategorySheet({
  category,
  intensity,
  usedHues,
  previewSlices,
  onClose,
  onError,
  onReplace,
  onArchived,
}: {
  category: CategoryWithSubs | null;
  intensity: ColorIntensity;
  usedHues: readonly number[];
  previewSlices: readonly PreviewSlice[];
  onClose: () => void;
  onError: (message: string | null) => void;
  onReplace: (category: CategoryWithSubs) => void;
  onArchived: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const resolveError = useActionError();

  if (category === null) {
    return <Sheet open={false} onClose={onClose} title="Catégorie">{null}</Sheet>;
  }

  const rename = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === category.name) return;
    onError(null);
    startTransition(async () => {
      const result = await updateCategory({ id: category.id, name: trimmed });
      if (!result.ok) {
        onError(resolveError(result.error));
        return;
      }
      onReplace({ ...category, ...result.data });
    });
  };

  const pickHue = (hue: Hue) => {
    onError(null);
    onReplace({ ...category, hue });
    startTransition(async () => {
      const result = await updateCategory({ id: category.id, hue });
      if (!result.ok) {
        onError(resolveError(result.error));
        onReplace(category);
      }
    });
  };

  return (
    <Sheet
      open
      onClose={() => {
        setConfirmingArchive(false);
        onClose();
      }}
      title={category.name}
      description="Renommez, choisissez une couleur, gérez les sous-catégories."
    >
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1">
          <span className="text-base text-ink-soft">Nom</span>
          <input
            type="text"
            defaultValue={category.name}
            maxLength={60}
            onBlur={(event) => rename(event.target.value)}
            className="tap rounded-sm border border-line bg-surface px-3 text-base text-ink"
          />
        </label>

        <HuePicker
          value={category.hue}
          onChange={pickHue}
          intensity={intensity}
          usedHues={usedHues}
          previewSlices={previewSlices}
          previewSliceId={category.id}
        />

        <SubcategoryList
          category={category}
          pending={pending}
          onError={onError}
          onReplace={onReplace}
        />

        <div className="border-t border-line pt-4">
          {confirmingArchive ? (
            <div className="rounded-md border border-line bg-bg px-3 py-3">
              <p className="text-base text-ink">
                Supprimer « {category.name} » ? Les mois déjà remplis continueront de
                l&apos;afficher, rien de votre historique ne disparaît.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    onError(null);
                    startTransition(async () => {
                      const result = await archiveCategory({ id: category.id });
                      if (!result.ok) {
                        onError(resolveError(result.error));
                        return;
                      }
                      onArchived(category.id);
                    });
                  }}
                  className="tap rounded-sm bg-negative px-4 text-base font-semibold text-white disabled:opacity-60"
                >
                  Oui, supprimer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingArchive(false)}
                  className="tap rounded-sm px-4 text-base font-medium text-ink"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingArchive(true)}
              className="tap flex items-center gap-2 rounded-sm px-1 text-base font-medium text-negative"
            >
              <Trash2 size={18} aria-hidden="true" />
              Supprimer cette catégorie
            </button>
          )}
          {confirmingArchive ? null : (
            <p className="mt-1 px-1 text-sm text-ink-soft">
              Elle disparaîtra de vos prochains mois. Les mois déjà remplis la gardent.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function SubcategoryList({
  category,
  pending,
  onError,
  onReplace,
}: {
  category: CategoryWithSubs;
  pending: boolean;
  onError: (message: string | null) => void;
  onReplace: (category: CategoryWithSubs) => void;
}) {
  const [adding, startAdding] = useTransition();
  const resolveError = useActionError();
  const active = category.subcategories.filter((sub) => !sub.isArchived);

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold text-ink">Sous-catégories</h3>
      <ul className="flex flex-col">
        {active.map((sub) => (
          <li key={sub.id} className="flex items-center gap-2 border-b border-line/60 last:border-b-0">
            <input
              type="text"
              defaultValue={sub.name}
              maxLength={60}
              aria-label={`Nom de ${sub.name}`}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name === "" || name === sub.name) return;
                onError(null);
                startAdding(async () => {
                  const result = await updateSubcategory({ id: sub.id, name });
                  if (!result.ok) {
                    onError(resolveError(result.error));
                    return;
                  }
                  onReplace({
                    ...category,
                    subcategories: category.subcategories.map((item) =>
                      item.id === sub.id ? result.data : item,
                    ),
                  });
                });
              }}
              className={cn(
                "tap min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1",
                "text-base text-ink focus:border-line focus:bg-surface",
              )}
            />
            <button
              type="button"
              disabled={pending || adding}
              onClick={() => {
                onError(null);
                startAdding(async () => {
                  const result = await archiveSubcategory({ id: sub.id });
                  if (!result.ok) {
                    onError(resolveError(result.error));
                    return;
                  }
                  onReplace({
                    ...category,
                    subcategories: category.subcategories.map((item) =>
                      item.id === sub.id ? { ...item, isArchived: true } : item,
                    ),
                  });
                });
              }}
              className="tap flex shrink-0 items-center justify-center rounded-sm text-ink-soft disabled:opacity-40"
            >
              <Trash2 size={18} aria-hidden="true" />
              <span className="sr-only">Retirer {sub.name} de vos prochains mois</span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={adding}
        onClick={() => {
          onError(null);
          startAdding(async () => {
            const result = await createSubcategory({
              categoryId: category.id,
              name: "Nouvelle ligne",
            });
            if (!result.ok) {
              onError(resolveError(result.error));
              return;
            }
            onReplace({
              ...category,
              subcategories: [...category.subcategories, result.data],
            });
          });
        }}
        className="tap mt-2 flex items-center gap-2 rounded-sm px-1 text-base font-medium text-accent-ink disabled:opacity-50"
      >
        <Plus size={18} aria-hidden="true" />
        Ajouter une ligne
      </button>
    </div>
  );
}
