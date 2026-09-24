import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card px-4 py-6">
      <h1 className="font-display text-xl font-bold text-ink">Page introuvable</h1>
      <p className="mt-2 text-base text-ink-soft">
        Ce lien ne mène nulle part. Revenez au mois en cours, tout y est.
      </p>
      <Link
        href="/"
        className="tap mt-4 inline-flex items-center rounded-sm bg-accent px-5 text-base font-semibold text-white"
      >
        Voir le mois en cours
      </Link>
    </div>
  );
}
