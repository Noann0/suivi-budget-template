import { parentPort, workerData } from "node:worker_threads";

/**
 * Un writer independant : sa PROPRE connexion `DatabaseSync` sur le meme fichier, pas
 * celle du fil principal. C'est ce qui rend le test suivant probant : deux appels
 * asynchrones dans le meme processus Node ne se recouvrent jamais vraiment (le JS est
 * mono-thread, chaque `run()` synchrone du driver s'execute en entier avant le
 * suivant) alors que deux CONNEXIONS SQLite distinctes, elles, peuvent authentiquement
 * se disputer la meme ligne. C'est cette dispute-la que `addToEntry`/`addToAllocation`
 * doivent trancher sans rien perdre.
 */
type WorkerInput = {
  databasePath: string;
  readySab: SharedArrayBuffer;
  goSab: SharedArrayBuffer;
  index: number;
  kind: "entry" | "allocation";
  monthId?: string;
  subcategoryId?: string;
  allocationId?: string;
  deltaCents: number;
};

const input = workerData as WorkerInput;
process.env.DATABASE_PATH = input.databasePath;

const { addToEntry, addToAllocation } = await import("@/server/repositories/months");

const ready = new Int32Array(input.readySab);
const go = new Int32Array(input.goSab);

// Signale au fil principal que la connexion est ouverte et prete, puis attend le
// relachement group (`Atomics.notify` depuis le fil principal) : tous les workers
// prets se reveillent dans la meme fenetre, au lieu de partir en file indienne au fur
// et a mesure de leur demarrage.
Atomics.add(ready, 0, 1);
Atomics.wait(go, 0, 0);

const outcome =
  input.kind === "entry"
    ? (() => {
        const entry = addToEntry({
          monthId: input.monthId!,
          subcategoryId: input.subcategoryId!,
          deltaCents: input.deltaCents,
        });
        return entry
          ? { accepted: true as const, amountCents: entry.amountCents }
          : { accepted: false as const, amountCents: null };
      })()
    : (() => {
        const changes = addToAllocation(input.allocationId!, input.deltaCents);
        return { accepted: changes > 0, amountCents: null };
      })();

parentPort!.postMessage(outcome);
