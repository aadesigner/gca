import { describeDatabaseTarget } from "@workspace/db";

export type DbReadyState = {
  migrations: "pending" | "ok" | "error";
  lastError: string | null;
  attempt: number;
  target: string;
  adminSeeded: boolean;
};

export const dbReady: DbReadyState = {
  migrations: "pending",
  lastError: null,
  attempt: 0,
  target: describeDatabaseTarget(),
  adminSeeded: false,
};

export function sanitizeDbError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 4 && current; i++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts
    .join(" | ")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***")
    .slice(0, 500);
}

export function isDatabaseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /relation |column |ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ssl|timeout expired|password authentication|no pg_hba|does not exist|connect |remaining connection slots|too many clients/i.test(
    message,
  );
}

/** Pool saturation / brief outages — safe to retry once for auth/session. */
export function isTransientConnectionError(err: unknown): boolean {
  const message = sanitizeDbError(err).toLowerCase();
  return (
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("timeout expired") ||
    message.includes("remaining connection slots") ||
    message.includes("too many clients") ||
    message.includes("econnrefused") ||
    message.includes("etimedout")
  );
}
