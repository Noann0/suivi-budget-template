import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const WORKER_URL = new URL("./concurrent-add-worker.ts", import.meta.url);
const REGISTER_LOADER = fileURLToPath(new URL("./register.mjs", import.meta.url));

export type ConcurrentOutcome = { accepted: boolean; amountCents: number | null };

type ConcurrentEntryJob = {
  kind: "entry";
  databasePath: string;
  monthId: string;
  subcategoryId: string;
  deltaCents: number;
};

type ConcurrentAllocationJob = {
  kind: "allocation";
  databasePath: string;
  allocationId: string;
  deltaCents: number;
};

/**
 * Lance `count` connexions SQLite independantes qui tentent TOUTES le meme ajout au
 * meme instant, via une double barriere `Atomics` : chaque worker s'annonce pret,
 * puis attend le relachement group pose par ce fil une fois que tous le sont. C'est
 * la maniere la plus serree de reproduire "deux ajouts concurrents" sans dependre du
 * minutage flou de deux appels reseau HTTP.
 */
export async function runConcurrent(
  job: ConcurrentEntryJob | ConcurrentAllocationJob,
  count: number,
): Promise<ConcurrentOutcome[]> {
  const readySab = new SharedArrayBuffer(4);
  const goSab = new SharedArrayBuffer(4);
  const ready = new Int32Array(readySab);
  const go = new Int32Array(goSab);

  const workers = Array.from({ length: count }, (_, index) => {
    return new Worker(WORKER_URL, {
      execArgv: ["--import", REGISTER_LOADER],
      workerData: { ...job, readySab, goSab, index },
    });
  });

  const results = Promise.all(
    workers.map(
      (worker) =>
        new Promise<ConcurrentOutcome>((resolve, reject) => {
          worker.once("message", (message: ConcurrentOutcome) => resolve(message));
          worker.once("error", reject);
        }),
    ),
  );

  // Poll court plutot qu'un Atomics.wait bloquant sur ce fil : le fil principal doit
  // rester libre de recevoir les messages d'erreur des workers pendant l'attente.
  const deadline = Date.now() + 5000;
  while (Atomics.load(ready, 0) < count) {
    if (Date.now() > deadline) {
      throw new Error(`Seuls ${Atomics.load(ready, 0)}/${count} workers se sont annonces prets.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  Atomics.store(go, 0, 1);
  Atomics.notify(go, 0, count);

  try {
    return await results;
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
