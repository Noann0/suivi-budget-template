/**
 * Journalisation structuree, en JSON sur la sortie standard : c'est ce que Dokploy
 * et Docker collectent. Aucun console.log nu dans le reste du code.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentThreshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVELS[configured] ?? LEVELS.info;
}

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < currentThreshold()) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...fields,
  });
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};

/** Rend une erreur inconnue journalisable sans fuiter d'objet non serialisable. */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorMessage: String(error) };
}
