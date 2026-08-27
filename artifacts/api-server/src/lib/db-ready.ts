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
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***").slice(0, 240);
}

export function isDatabaseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /relation |column |ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ssl|timeout expired|password authentication|no pg_hba|does not exist|connect |remaining connection slots|too many clients/i.test(
    message,
  );
}
