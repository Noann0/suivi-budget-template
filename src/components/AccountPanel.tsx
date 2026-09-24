"use client";

import { Download, KeyRound, LogOut, Monitor, Plus, ShieldOff, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/components/lib/cn";
import { useActionError } from "@/components/lib/useActionError";
import { friendlyActionError } from "@/components/lib/authMessages";
import { isUnauthorized } from "@/components/lib/screenErrors";
import {
  createEnrollmentCode,
  logout,
  removeDevice,
  renameDevice,
  revokeAllSessions,
} from "@/actions/auth";
import { exportCsv, exportJson } from "@/actions/export";
import type { DeviceSummary } from "@/lib/types";

type Props = {
  devices: DeviceSummary[];
};

/**
 * Sauvegarde et appareils, dans les reglages.
 *
 * L'export est sa sauvegarde a elle : la seule copie de son historique qu'elle
 * controle, sans dependre de personne ni d'un serveur qui tiendrait toujours.
 */
export function AccountPanel({ devices: initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [confirmingRevokeAll, setConfirmingRevokeAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const resolveError = useActionError();

  /**
   * Le contenu arrive du serveur sous forme de chaine, deja complete.
   * Pour le CSV elle porte deja son BOM UTF-8 : on ne le rajoute pas et on ne le
   * retire pas, sinon Excel en francais afficherait des accents casses.
   */
  const download = (kind: "csv" | "json") => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = kind === "csv" ? await exportCsv() : await exportJson();
      if (!result.ok) {
        setError(resolveError(result.error));
        return;
      }

      const mime = kind === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
      const blob = new Blob([result.data.content], { type: mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setMessage(`Fichier ${result.data.filename} enregistré sur votre appareil.`);
    });
  };

  const askDeviceCode = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await createEnrollmentCode();
      if (!result.ok) {
        if (isUnauthorized(result.error)) {
          setError(resolveError(result.error));
          return;
        }
        setError(friendlyActionError(result.error, "addDevice").message);
        return;
      }
      setDeviceCode(result.data.code);
    });
  };

  const rename = (device: DeviceSummary, nextName: string) => {
    const trimmed = nextName.trim();
    if (trimmed === "" || trimmed === (device.deviceName ?? "")) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await renameDevice({ id: device.id, deviceName: trimmed });
      if (!result.ok) {
        setError(resolveError(result.error));
        return;
      }
      setDevices((current) =>
        current.map((item) => (item.id === device.id ? { ...item, deviceName: trimmed } : item)),
      );
    });
  };

  const forget = (device: DeviceSummary) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await removeDevice({ id: device.id });
      if (!result.ok) {
        if (isUnauthorized(result.error)) {
          setError(resolveError(result.error));
          return;
        }
        // Le refus de retirer le dernier appareil est un garde-fou, pas une panne :
        // sans lui, un seul geste la mettrait dehors sans moyen de revenir.
        setError(
          result.error.code === "CONFLICT"
            ? "C'est votre seul appareil enregistré. Si vous le retiriez, vous ne pourriez plus entrer. Ajoutez d'abord un autre appareil."
            : friendlyActionError(result.error, "addDevice").message,
        );
        return;
      }
      setDevices((current) => current.filter((item) => item.id !== device.id));
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="backup-title" className="card px-4 py-4">
        <h2 id="backup-title" className="font-display text-lg font-semibold text-ink">
          Sauvegarder mes données
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Tout votre historique dans un fichier, sur votre appareil. C&apos;est votre
          copie à vous, gardez-la où vous voulez.
        </p>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => download("csv")}
            disabled={pending}
            className="tap flex items-center justify-center gap-2 rounded-sm bg-accent px-4 text-base font-semibold text-white disabled:opacity-60"
          >
            <Download size={18} aria-hidden="true" />
            Pour Excel (CSV)
          </button>
          <button
            type="button"
            onClick={() => download("json")}
            disabled={pending}
            className="tap flex items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-base font-medium text-ink disabled:opacity-60"
          >
            <Download size={18} aria-hidden="true" />
            Copie complète (JSON)
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Le fichier Excel s&apos;ouvre directement avec vos accents et vos colonnes en
          place. Le fichier complet sert à tout remettre en cas de besoin.
        </p>
      </section>

      <section aria-labelledby="devices-title" className="card px-4 py-4">
        <h2 id="devices-title" className="font-display text-lg font-semibold text-ink">
          Mes appareils
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Les appareils qui peuvent ouvrir votre budget sans code. Touchez un nom pour le changer.
        </p>

        <ul className="mt-3 flex flex-col">
          {devices.map((device) => {
            const isPhone = /phone|télé|tele|android|mobile/i.test(device.deviceName ?? "");
            const Icon = isPhone ? Smartphone : Monitor;
            return (
              <li
                key={device.id}
                className="flex items-center gap-3 border-b border-line/60 py-1 last:border-b-0"
              >
                <Icon size={20} aria-hidden="true" className="shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 py-1">
                  <span className="flex items-baseline gap-2">
                    <input
                      type="text"
                      defaultValue={device.deviceName ?? "Appareil"}
                      maxLength={40}
                      disabled={pending}
                      aria-label={`Nom de ${device.deviceName ?? "cet appareil"}`}
                      onBlur={(event) => rename(device, event.target.value)}
                      className={cn(
                        "min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-1",
                        "text-base text-ink focus:border-line focus:bg-bg",
                      )}
                    />
                    {device.isCurrent ? (
                      <span className="shrink-0 text-sm font-normal text-positive">
                        celui-ci
                      </span>
                    ) : null}
                  </span>
                  <span className="px-1 text-sm text-ink-soft">
                    Ajouté le {formatDay(device.createdAt)}
                  </span>
                </span>
                {devices.length > 1 && !device.isCurrent ? (
                  <button
                    type="button"
                    onClick={() => forget(device)}
                    disabled={pending}
                    className="tap flex shrink-0 items-center justify-center rounded-sm text-ink-soft disabled:opacity-40"
                  >
                    <Trash2 size={18} aria-hidden="true" />
                    <span className="sr-only">
                      Retirer {device.deviceName ?? "cet appareil"}
                    </span>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {deviceCode === null ? (
          <button
            type="button"
            onClick={askDeviceCode}
            disabled={pending}
            className="tap mt-3 flex items-center gap-2 rounded-sm px-1 text-base font-medium text-accent-ink disabled:opacity-50"
          >
            <Plus size={18} aria-hidden="true" />
            Ajouter un autre appareil
          </button>
        ) : (
          <div className="mt-3 rounded-md border border-line bg-carried px-4 py-3">
            <p className="text-base text-ink">
              Sur l&apos;autre appareil, ouvrez le même site et tapez ce code. Il est
              valable dix minutes.
            </p>
            <p className="amount mt-3 rounded-sm border-2 border-dashed border-accent-ink/40 bg-bg px-4 py-3 text-center text-xl font-semibold tracking-[0.12em] text-ink select-all">
              {deviceCode}
            </p>
            <button
              type="button"
              onClick={() => setDeviceCode(null)}
              className="tap mt-2 rounded-sm px-1 text-base font-medium text-accent-ink"
            >
              J&apos;ai fini
            </button>
          </div>
        )}
      </section>

      {message ? (
        <p className="rounded-md border border-positive/40 bg-positive-soft px-4 py-3 text-base text-ink">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-negative/40 bg-negative-soft px-4 py-3 text-base text-ink">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="security-title" className="card px-4 py-4">
        <h2 id="security-title" className="font-display text-lg font-semibold text-ink">
          Sécurité
        </h2>

        <Link
          href="/code-de-secours?retour=%2Freglages"
          className="tap mt-3 flex items-center gap-2 rounded-sm text-base font-medium text-accent-ink"
        >
          <KeyRound size={18} aria-hidden="true" />
          Créer un nouveau code de secours
        </Link>
        <p className="mt-1 text-sm text-ink-soft">
          Le code précédent cessera de fonctionner au moment où le nouveau
          s&apos;affichera. Ne le faites que si l&apos;ancien est perdu, ou si
          quelqu&apos;un d&apos;autre a pu le voir.
        </p>

        <div className="mt-4 border-t border-line pt-4">
          {confirmingRevokeAll ? (
            <div className="rounded-md border border-negative/40 bg-negative-soft px-3 py-3">
              <p className="text-base text-ink">
                Tous les appareils, <strong className="font-semibold">y compris
                celui-ci</strong>, seront déconnectés. Vos données ne bougent pas.
                Chaque appareil devra se réidentifier, ce qu&apos;il sait faire tout
                seul avec votre empreinte.
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setMessage(null);
                    startTransition(async () => {
                      const result = await revokeAllSessions();
                      if (!result.ok) {
                        setError(resolveError(result.error));
                        return;
                      }
                      router.replace("/login");
                      router.refresh();
                    });
                  }}
                  className="tap rounded-sm bg-negative px-4 text-base font-semibold text-white disabled:opacity-60"
                >
                  Oui, tout déconnecter
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRevokeAll(false)}
                  className="tap rounded-sm border border-line bg-surface px-4 text-base font-medium text-ink"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmingRevokeAll(true)}
                className="tap flex items-center gap-2 rounded-sm text-base font-medium text-negative"
              >
                <ShieldOff size={18} aria-hidden="true" />
                Déconnecter tous les appareils
              </button>
              <p className="mt-1 text-sm text-ink-soft">
                Une connexion dure un an. C&apos;est ce bouton qui vous permet d&apos;y
                mettre fin partout d&apos;un coup, si vous avez un doute.
              </p>
            </>
          )}
        </div>
      </section>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await logout();
            router.replace("/login");
            router.refresh();
          });
        }}
        className={cn(
          "tap flex items-center justify-center gap-2 rounded-sm border border-line",
          "bg-surface text-base font-medium text-ink disabled:opacity-60",
        )}
      >
        <LogOut size={18} aria-hidden="true" />
        Me déconnecter
      </button>
    </div>
  );
}

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatDay(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "date inconnue";
  return dayFormatter.format(new Date(time));
}
