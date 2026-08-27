/**
 * Railway private Postgres (*.railway.internal) does not speak SSL.
 * Public proxy URLs (*.rlwy.net) need SSL with a relaxed cert check.
 */
export function pgSsl(
  connectionString = process.env.DATABASE_URL ?? "",
): false | { rejectUnauthorized: boolean } | undefined {
  if (!connectionString) return undefined;
  if (/sslmode=disable/i.test(connectionString)) return false;
  if (/railway\.internal/i.test(connectionString) || /localhost|127\.0\.0\.1/i.test(connectionString)) {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function describeDatabaseTarget(connectionString = process.env.DATABASE_URL ?? ""): string {
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:/i, "http:");
    const url = new URL(normalized);
    const host = url.hostname || "(no-host)";
    const port = url.port || "5432";
    const db = url.pathname || "/";
    return `${host}:${port}${db}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
